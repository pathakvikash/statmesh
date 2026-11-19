from collections import Counter
from pathlib import Path

import pytest

from statmesh import bench
from statmesh.search.topics import TAXONOMY
from statmesh.settings import Settings
from statmesh.testing.fixture_catalog import build

QS = bench.load_questions(Path(__file__).parent.parent / "evals" / "benchmark.yaml")


def test_questions_cover_sources_and_topics():
    assert len(QS) == 200
    assert len({q["id"] for q in QS}) == 200
    for q in QS:
        assert set(q) == {"id", "q", "source", "topic", "expected", "geo", "start", "end"}
        assert q["topic"] in TAXONOMY and q["start"] <= q["end"]
        assert all(k.count(":") >= 2 for k in q["expected"])
        assert q["expected"][0].startswith(q["source"] + ":")
    assert min(Counter(q["source"] for q in QS).values()) >= 4
    topics = Counter(q["topic"] for q in QS)
    assert set(topics) == set(TAXONOMY) and min(topics.values()) >= 10
    assert sum(q["source"] == "who_gho" for q in QS) >= 15


def test_threshold_rule():
    assert bench.threshold_for(0.97) == 0.9
    assert bench.threshold_for(0.90) == 0.85
    assert bench.threshold_for(0.79) == 0.75  # floor
    assert bench.check({m: 0.8 for m in bench.METRICS}, {"cited": 0.85}) == ["cited 0.800 < 0.85"]


def _obs(*values, period="2012-01-01"):
    import json

    return json.dumps({"columns": ["period", "value"], "rows": [[period, v] for v in values]})


def test_grade_answer_numbers_not_substrings():
    g = bench.grade_answer
    assert g("US jobless rate in 2023", "It was 3.4 percent.", [_obs(3.4)])
    assert not g("q", "It was 3.5 percent.", [_obs(3.4)])
    assert not g("q", "no figure", [_obs(3.4)])
    assert not g("q", "It was 12.", [_obs(5.0)])  # "12" is not the "2012" of a date
    assert g("q", "About 4.82 percent.", [_obs(4.822)])  # rounding to the shown precision
    assert g("q", "About 5 percent.", [_obs(4.822)])
    assert not g("q", "About 4.9 percent.", [_obs(4.822)])
    assert g("q", "In 2012 it was 3.4.", [_obs(3.4)])  # a year of the observations
    assert not g("q", "It was 3.4.", ["not json", '{"columns": ["a"], "rows": []}'])


def test_llm_loop_retry_and_errors(monkeypatch):
    import httpx

    monkeypatch.setattr(bench, "_run_tool", lambda name, args: _obs(3.4))
    q = {"id": "b001", "q": "rate?", "geo": "USA", "start": "2023-01-01", "end": "2023-12-31"}

    def reply(stop, content):
        return {"stop_reason": stop, "content": content}

    use = {"type": "tool_use", "id": "t1", "name": "get_observations", "input": {"series_id": "x"}}
    replies = iter([reply("tool_use", [use]), reply("end_turn", [{"type": "text", "text": "3.4"}])])
    assert bench.ask_llm(q, "k", "m", post=lambda body: next(replies))["pass"]

    def status(code):
        return httpx.HTTPStatusError(
            "x", request=httpx.Request("POST", "http://x"), response=httpx.Response(code)
        )

    calls, sleeps = [], []

    def flaky(body):
        calls.append(1)
        if len(calls) < 3:
            raise status(529)
        return reply("end_turn", [{"type": "text", "text": "3.4"}])

    # 3.4 is not an observed value here (no tool call), so the grade fails but the call survives
    assert bench.post_with_retry(flaky, {}, sleeps.append)["stop_reason"] == "end_turn"
    assert sleeps == [1, 2]

    def always(code):
        def post(body):
            calls.append(1)
            raise status(code)

        return post

    calls.clear()
    with pytest.raises(httpx.HTTPStatusError):
        bench.post_with_retry(always(500), {}, lambda s: None)
    assert len(calls) == 4
    calls.clear()
    with pytest.raises(httpx.HTTPStatusError):
        bench.post_with_retry(always(400), {}, lambda s: None)
    assert len(calls) == 1

    # a question that keeps failing becomes an error row; the others still run
    monkeypatch.delenv("STATMESH_BENCH_MODEL", raising=False)
    out = bench.run_llm([q, {**q, "id": "b002"}], post=always(429), sleep=lambda s: None)
    assert out["model"] == "claude-sonnet-5-5" and out["errors"] == 2 and out["pass_rate"] == 0
    monkeypatch.setenv("STATMESH_BENCH_MODEL", "from-env")
    assert bench.run_llm([], post=always(429))["model"] == "from-env"
    assert bench.run_llm([], model="flag", post=always(429))["model"] == "flag"
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    assert bench.run_llm([q]) is None


def test_data_dir_is_only_deleted_when_ours(tmp_path):
    from statmesh.bench import DataDirError, _clear_for_build

    repo = tmp_path / "repo"
    repo.mkdir()
    (repo / "keep.txt").write_text("x")
    with pytest.raises(DataDirError, match="refusing"):
        _clear_for_build(repo)
    assert (repo / "keep.txt").exists()
    _clear_for_build(tmp_path / "missing")  # nothing to delete
    empty = tmp_path / "empty"
    empty.mkdir()
    _clear_for_build(empty)
    ours = tmp_path / "ours"
    ours.mkdir()
    (ours / bench.MARKER).write_text("h")
    (ours / "catalog.sqlite").write_text("x")
    _clear_for_build(ours)
    assert not ours.exists()


def test_bench_cmd_refuses_foreign_dir(tmp_path, capsys):
    from argparse import Namespace

    (tmp_path / "keep.txt").write_text("x")
    args = Namespace(data_dir=str(tmp_path), out=str(tmp_path / "o"), limit=1)
    assert bench.bench_cmd(args) == 2
    assert (tmp_path / "keep.txt").exists() and "refusing" in capsys.readouterr().err


def test_build_reuses_until_inputs_change(tmp_path, monkeypatch):
    built = []

    def fake_build(data_dir, sources):
        built.append(1)
        (data_dir / "catalog.sqlite").write_text("x")
        return Settings(data_dir=data_dir), {}

    monkeypatch.setattr(bench.fixture_catalog, "build", fake_build)
    qpath = tmp_path / "q.yaml"
    qpath.write_text("[]")
    d = tmp_path / "d"
    bench.build_data(d, questions=qpath)
    bench.build_data(d, questions=qpath)
    assert len(built) == 1
    qpath.write_text("[1]")  # the questions file changed
    bench.build_data(d, questions=qpath)
    assert len(built) == 2
    bench.build_data(d, rebuild=True, questions=qpath)
    assert len(built) == 3


def test_missing_expected_keys_fail_the_run(tmp_path, monkeypatch):
    from argparse import Namespace

    settings, _ = build(tmp_path / "d", ["bls"])
    q = next(q for q in QS if q["source"] == "bls")
    assert bench.missing_keys([q], settings) == []
    bad = {**q, "expected": [*q["expected"], "bls:nope:NOPE"]}
    assert bench.missing_keys([bad], settings) == ["bls:nope:NOPE"]
    res = bench.run([bad], settings)
    assert res["missing_keys"] == ["bls:nope:NOPE"]
    qfile = tmp_path / "q.yaml"
    import yaml

    qfile.write_text(yaml.safe_dump([bad]))
    args = Namespace(
        data_dir=str(tmp_path / "d"), out=str(tmp_path / "o"), questions=str(qfile), no_write=True
    )
    monkeypatch.setattr(bench, "build_data", lambda *a, **k: (settings, {}))  # already built
    assert bench.bench_cmd(args) == 1


def test_cited_needs_http_url():
    from types import SimpleNamespace as C

    ok = C(licence_name="L", source_url="https://x", retrieved_at=1)
    assert bench._cited([ok])
    assert not bench._cited([C(licence_name="L", source_url="ftp://x", retrieved_at=1)])
    assert not bench._cited([C(licence_name="L", source_url=None, retrieved_at=1)])


def test_question_runs_end_to_end(tmp_path):
    settings, errors = build(tmp_path / "d", ["bls"])
    assert not errors
    bench.open_service(settings)
    q = next(
        q for q in QS if q["source"] == "bls" and "2024" in q["q"] and "unemployment" in q["q"]
    )
    row = bench.run_question(q)
    assert row["recall"] and row["answerable"] and row["cited"], row


def test_annual_inflation_euro_area_keeps_the_hicp_rate(tmp_path):
    from statmesh.core.catalog import Catalog
    from statmesh.search.search import search

    settings, _ = bench.build_data(tmp_path / "bench")  # every connector's fixtures, offline
    cat = Catalog(settings.data_dir / "catalog.sqlite", readonly=True)
    try:
        keys = [r["series_key"] for r in search(cat, "annual inflation euro area", limit=3)]
    finally:
        cat.close()
    assert "ecb:ICP:000000.ANR" in keys
