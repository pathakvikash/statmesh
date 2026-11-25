"""Gap log. Search tests use a synthetic hand-built catalog (not the recorded fixtures), offline."""

import json
import sqlite3

import pytest
from tests.api.test_related_series import _build

from statmesh import gaps, service
from statmesh.cli import main
from statmesh.settings import Settings


def _s(tmp_path, **kw):
    return Settings(data_dir=tmp_path / "d", **kw)


def test_roundtrip_and_filter_merge(tmp_path):
    s = _s(tmp_path)
    assert not (s.data_dir / "gaps.sqlite").exists() and gaps.top(s) == []  # lazy
    gaps.record(s, "3D Printing!", source="a", geo=["IND"])
    gaps.record(s, "  3d   printing ", source=["b", "a"], topic="health")
    gaps.record(s, "drones")
    top = gaps.top(s)
    assert [(r["q"], r["n"]) for r in top] == [("3d printing", 2), ("drones", 1)]
    assert top[0]["filters"] == {"source": ["a", "b"], "geo": ["IND"], "topic": ["health"]}
    assert top[0]["last_seen"].endswith("Z") and len(top[0]["last_seen"]) == 17  # minute only
    assert gaps.top(s, since_days=1)[0]["q"] == "3d printing"
    assert gaps.top(s, limit=1) == top[:1]


def test_normalise():
    assert gaps.normalise("  Robotics,  (AI)!! ") == "robotics ai"
    assert gaps.normalise("x" * 200) == "x" * 80
    assert (
        gaps.normalise("ab") is None and gaps.normalise("!!") is None and gaps.normalise("") is None
    )


@pytest.mark.parametrize(
    "q",
    [
        "mail me@example.com",
        "https://example.com/a",
        "www.example.com",
        "id 1234567",
        "call 555-123-4567",
        "one two three four five six seven eight nine",
    ],
)
def test_privacy_skips(tmp_path, q):
    s = _s(tmp_path)
    gaps.record(s, q)
    assert gaps.top(s) == []


def test_cap_evicts_oldest_one_off(tmp_path, monkeypatch):
    s = _s(tmp_path)
    monkeypatch.setattr(gaps, "MAX_ROWS", 2)
    for q in ("alpha", "beta", "alpha", "gamma"):  # alpha n=2 stays, beta (n=1) is evicted
        gaps.record(s, q)
    assert {r["q"]: r["n"] for r in gaps.top(s)} == {"alpha": 2, "gamma": 1}
    gaps.record(s, "gamma")
    gaps.record(s, "delta")  # none has n=1: oldest row goes
    assert {r["q"] for r in gaps.top(s)} == {"gamma", "delta"}


def test_filter_values_sanitised(tmp_path):
    s = _s(tmp_path)
    gaps.record(s, "drones", source="a", known_sources={"a"})
    gaps.record(s, "robots", source="me@x.com", known_sources={"a"})  # bogus source: no gap
    gaps.record(s, "lasers", geo="I\x1b[31mND")
    assert {r["q"] for r in gaps.top(s)} == {"drones", "lasers"}
    assert {r["q"]: r["filters"] for r in gaps.top(s)}["lasers"] == {"geo": ["I[31mND"]}


def test_cli_strips_control_chars(tmp_path, monkeypatch, capsys):
    s = _s(tmp_path)
    gaps.record(s, "drones", source="a\x1b[2Jb")
    monkeypatch.setattr(service, "_engine", lambda: type("E", (), {"settings": s})())
    main(["gaps"])
    assert "\x1b" not in capsys.readouterr().out


def test_setting_off_records_nothing(tmp_path):
    assert Settings.from_env({"STATMESH_GAP_LOG": "0"}).gap_log is False
    assert Settings.from_env({}).gap_log is True
    assert Settings.from_env({"STATMESH_MODE": "hosted"}).gap_log is False
    assert Settings.from_env({"STATMESH_MODE": "hosted", "STATMESH_GAP_LOG": "1"}).gap_log is True
    s = _s(tmp_path, gap_log=False)
    gaps.record(s, "drones")
    assert not s.data_dir.exists()


def test_search_records_only_zero_hit_first_page(tmp_path):
    _build(tmp_path)
    s = service._engine().settings
    service.search_series("zzzzqq robotics", source="open")
    service.search_series("zzzzqq robotics", source="open", geo="IND")
    assert service.search_series("life expectancy").hits
    service.search_series("zzzzqq other", offset=5)  # not the first page
    service.search_series("", source="open")  # filter-only browsing
    rows = service.top_gaps()
    assert [(r["q"], r["n"]) for r in rows] == [("zzzzqq robotics", 2)]
    assert rows[0]["filters"]["source"] == ["open"] and rows[0]["filters"]["geo"] == ["IND"]
    assert s.data_dir == tmp_path


def test_strict_filters_and_bogus_source_not_recorded(tmp_path):
    _build(tmp_path)
    service.search_series("zzzzqq robotics", start_year=1900, end_year=1901)
    service.search_series("zzzzqq robotics", redistribute="yes")
    service.search_series("zzzzqq robotics", freq="A")
    service.search_series("zzzzqq robotics", updated_since="2999-01-01")
    service.search_series("zzzzqq robotics", source="nosuchsource")
    service.search_series("zzzzqq robotics", _log_gaps=False)
    assert service.top_gaps() == []


def test_failing_store_does_not_break_search(tmp_path):
    _build(tmp_path)
    (tmp_path / "gaps.sqlite").mkdir()  # unopenable as a database
    assert service.search_series("zzzzqq robotics").hits == []
    assert not any((tmp_path / "gaps.sqlite").iterdir())


def test_cli_table_and_json(tmp_path, monkeypatch, capsys):
    s = _s(tmp_path)
    gaps.record(s, "drones", source="a")
    gaps.record(s, "drones")
    monkeypatch.setattr(service, "_engine", lambda: type("E", (), {"settings": s})())
    assert main(["gaps"]) == 0
    out = capsys.readouterr().out
    assert "COUNT" in out and "drones" in out and "source=a" in out and out.split()[-0] == "COUNT"
    assert main(["gaps", "--json", "--top", "5", "--since", "1"]) == 0
    data = json.loads(capsys.readouterr().out)
    assert data[0]["q"] == "drones" and data[0]["n"] == 2
    sqlite3.connect(s.data_dir / "gaps.sqlite").close()
