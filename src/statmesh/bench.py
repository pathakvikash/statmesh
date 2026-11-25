"""Question benchmark: `statmesh bench` (offline) and `python -m statmesh.bench --llm` (optional).

The 200 questions in evals/benchmark.yaml run against a catalog built offline from every
connector's recorded fixtures ("fixture catalog": it tests the plumbing, not real coverage).
Per question, with `q` + `geo` and no source filter:
- recall@5: an expected series key is among the top 5 search hits;
- answerable: the first such hit returns a non-null value in [start, end] for that geo;
- cited: the same observations result carries a citation with licence, source URL, retrieved_at;
- answer rate: the share of questions that pass all three.
Non-core indicators (WHO GHO, World Bank) are fetched on demand; here that replays the recorded
fixtures, so the run needs no network. Thresholds live in evals/results/thresholds.json.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import shutil
import sys
import time
from collections import defaultdict
from datetime import UTC, date, datetime
from pathlib import Path

import httpx
import yaml

from statmesh import service
from statmesh.core.catalog import Catalog
from statmesh.core.connector import connector_dir
from statmesh.settings import Settings
from statmesh.testing import fixture_catalog
from statmesh.testing.fixtures import fixtures_dir, replay_http

QUESTIONS = Path("evals/benchmark.yaml")
DATA_DIR = Path("evals/bench_data")
OUT_DIR = Path("evals/results")
MARKER = ".statmesh-bench"
METRICS = ("recall_at_5", "answerable", "cited", "answer_rate")
FLOOR, STEP, MARGIN = 0.75, 0.05, 0.05
K = 5
DEFAULT_MODEL = "claude-sonnet-5-5"


class DataDirError(ValueError):
    """--data-dir is not something the bench may build into or delete."""


def load_questions(path: Path | str = QUESTIONS) -> list[dict]:
    qs = yaml.safe_load(Path(path).read_text("utf-8"))
    for i, q in enumerate(qs, 1):
        q["id"] = q.get("id") or f"b{i:03d}"
    return qs


def sources_with_fixtures(settings: Settings) -> list[str]:
    root = connector_dir("bls", settings).parent
    out = []
    for p in sorted(root.iterdir()):
        try:
            if p.is_dir() and fixtures_dir(p.name, settings).exists():
                out.append(p.name)
        except KeyError:
            continue
    return out


def inputs_hash(settings: Settings, questions: Path | str = QUESTIONS) -> str:
    """Hash of everything the built data depends on: fixtures, the questions file, the bench code
    and the fixture-catalog builder."""
    h = hashlib.sha256()
    files = [Path(questions), Path(__file__), Path(fixture_catalog.__file__)]
    for sid in sources_with_fixtures(settings):
        files += sorted(f for f in fixtures_dir(sid, settings).rglob("*") if f.is_file())
    for f in files:
        h.update(f.name.encode() + b"\0" + f.read_bytes() + b"\0")
    return h.hexdigest()


def _clear_for_build(data_dir: Path) -> None:
    """Delete data_dir only when it is missing, empty, or marked as a bench build."""
    if not data_dir.exists():
        return
    if not data_dir.is_dir():
        raise DataDirError(f"--data-dir {data_dir} is not a directory")
    if (data_dir / MARKER).exists():
        shutil.rmtree(data_dir)
    elif any(data_dir.iterdir()):
        raise DataDirError(
            f"refusing to delete --data-dir {data_dir}: it is not empty and has no {MARKER} "
            "marker (the bench only deletes directories it built itself)"
        )


def build_data(
    data_dir: Path = DATA_DIR, rebuild: bool = False, questions: Path | str = QUESTIONS
) -> tuple[Settings, dict]:
    """Catalog + parquet store from every source's fixtures. Reused while the hash stored in the
    marker matches the fixtures, the questions file and the bench code; rebuilt otherwise."""
    data_dir = Path(data_dir)
    settings = Settings(data_dir=data_dir.resolve())
    want = inputs_hash(settings, questions)
    marker = data_dir / MARKER
    if (
        not rebuild
        and (data_dir / "catalog.sqlite").exists()
        and marker.exists()
        and marker.read_text("utf-8").strip() == want
    ):
        return settings, {}
    _clear_for_build(data_dir)
    data_dir.mkdir(parents=True, exist_ok=True)
    marker.write_text("building\n", "utf-8")  # marks the dir as ours; no hash until it finished
    settings, errors = fixture_catalog.build(data_dir, sources_with_fixtures(settings))
    marker.write_text(want + "\n", "utf-8")
    return settings, errors


def open_service(settings: Settings) -> None:
    """Point the service at the data and make on-demand fetches replay the fixtures."""
    clients: dict[str, object] = {}

    def replay(source_id, st, _catalog):
        if source_id not in clients:
            clients[source_id] = replay_http(source_id, st)
        return clients[source_id]

    service.configure(settings, http_for=replay)


def missing_keys(questions: list[dict], settings: Settings) -> list[str]:
    """Expected series keys that the built catalog does not hold."""
    cat = Catalog(settings.data_dir / "catalog.sqlite", readonly=True)
    try:
        keys = dict.fromkeys(k for q in questions for k in q["expected"])
        return [k for k in keys if not cat.get_series(k)]
    finally:
        cat.close()


def _key(series_id: str) -> str:
    return ":".join(series_id.split(":")[:3])


def _cited(citations) -> bool:
    return any(
        c.licence_name and str(c.source_url or "").startswith("http") and c.retrieved_at
        for c in citations
    )


def run_question(q: dict) -> dict:
    row = {"id": q["id"], "q": q["q"], "source": q["source"], "topic": q["topic"],
           "expected": q["expected"], "recall": False, "answerable": False, "cited": False,
           "got": [], "error": None}  # fmt: skip
    try:
        hits = service.search_series(q["q"], geo=q["geo"], limit=K, _log_gaps=False).hits
    except Exception as e:  # noqa: BLE001 - a failing question is a miss, not a crash
        row["error"] = f"search: {type(e).__name__}: {e}"
        return row
    row["got"] = [_key(h.series_id) for h in hits]
    hit = next((h for h in hits if _key(h.series_id) in q["expected"]), None)
    if hit is None:
        return row
    row["recall"] = True
    row["hit"] = _key(hit.series_id)
    try:
        res = service.get_observations(
            hit.series_id, start=q["start"], end=q["end"], geo=q["geo"], limit=10_000
        )
    except Exception as e:  # noqa: BLE001
        row["error"] = f"observations: {type(e).__name__}: {e}"
        return row
    if res.status == "ok" and "value" in res.columns:
        i = res.columns.index("value")
        row["answerable"] = any(r[i] is not None for r in res.rows)
    row["cited"] = _cited(res.citations)
    return row


def _rates(rows: list[dict]) -> dict:
    n = len(rows) or 1
    ok = sum(r["recall"] and r["answerable"] and r["cited"] for r in rows)
    return {
        "n": len(rows),
        "recall_at_5": sum(r["recall"] for r in rows) / n,
        "answerable": sum(r["answerable"] for r in rows) / n,
        "cited": sum(r["cited"] for r in rows) / n,
        "answer_rate": ok / n,
    }


def summarize(rows: list[dict]) -> dict:
    by_source, by_topic = defaultdict(list), defaultdict(list)
    for r in rows:
        by_source[r["source"]].append(r)
        by_topic[r["topic"]].append(r)
    return {
        "metrics": _rates(rows),
        "by_source": {k: _rates(v) for k, v in sorted(by_source.items())},
        "by_topic": {k: _rates(v) for k, v in sorted(by_topic.items())},
    }


def threshold_for(measured: float) -> float:
    """First measured value minus 0.05, rounded down to 0.05, never below 0.75."""
    return round(max(FLOOR, math.floor((measured - MARGIN) / STEP + 1e-9) * STEP), 2)


def make_thresholds(metrics: dict) -> dict:
    return {m: round(threshold_for(metrics[m]), 2) for m in METRICS}


def check(metrics: dict, thresholds: dict) -> list[str]:
    return [
        f"{m} {metrics[m]:.3f} < {thresholds[m]:.2f}"
        for m in METRICS
        if m in thresholds and metrics[m] < thresholds[m]
    ]


# ---- --llm: the model answers with the tools running in-process ----

TOOLS = [
    {"name": "search_series", "description": "Search the catalog for statistical series.",
     "input_schema": {"type": "object", "properties": {"q": {"type": "string"},
      "geo": {"type": "string"}, "limit": {"type": "integer"}}, "required": ["q"]}},
    {"name": "get_observations", "description": "Observations of one series id (source:dataset:indicator[:geo]).",
     "input_schema": {"type": "object", "properties": {"series_id": {"type": "string"},
      "start": {"type": "string"}, "end": {"type": "string"}, "geo": {"type": "string"}},
      "required": ["series_id"]}},
]  # fmt: skip
NUM = re.compile(r"\d[\d,]*(?:\.\d+)?")
RETRY_STATUS = {429, 529}  # and every 5xx
TRIES = 4


def _run_tool(name: str, args: dict) -> str:
    try:
        if name == "search_series":
            return service.search_series(
                args["q"], geo=args.get("geo"), limit=5, _log_gaps=False
            ).model_dump_json()
        d = lambda k: date.fromisoformat(args[k]) if args.get(k) else None
        res = service.get_observations(
            args["series_id"], start=d("start"), end=d("end"), geo=args.get("geo"), limit=50
        )
        return res.model_dump_json()
    except Exception as e:  # noqa: BLE001
        return f"error: {type(e).__name__}: {e}"


def observed_numbers(results: list[str]) -> tuple[list[float], set[str]]:
    """(numeric values, years) of get_observations tool results (JSON strings)."""
    vals, years = [], set()
    for text in results:
        try:
            res = json.loads(text)
            cols, rows = res["columns"], res["rows"]
        except (ValueError, KeyError, TypeError):
            continue
        idx = [cols.index("value")] if "value" in cols else range(len(cols))
        for r in rows:
            vals += [
                float(r[i])
                for i in idx
                if isinstance(r[i], (int, float)) and not isinstance(r[i], bool)
            ]
            years |= {c[:4] for c in r if isinstance(c, str) and re.match(r"\d{4}-\d\d", c)}
    return vals, years


def _matches(num: str, vals: list[float], years: set[str]) -> bool:
    """A number of the answer matches an observed value up to the precision it is shown with
    (half a unit of its last digit) or 0.5 percent; a bare year matches an observation year."""
    if re.fullmatch(r"\d{4}", num) and num in years:
        return True
    a, dec = float(num), len(num.partition(".")[2])
    return any(abs(a - v) <= max(0.5 * 10**-dec, 0.005 * abs(v)) + 1e-9 for v in vals)


def grade_answer(question: str, answer: str, results: list[str]) -> bool:
    """Has a number, and every number in it equals a value from the get_observations results
    (numbers of the question itself, such as years, do not count)."""
    vals, years = observed_numbers(results)
    asked = {n.replace(",", "") for n in NUM.findall(question)}
    nums = [n.replace(",", "").rstrip(".") for n in NUM.findall(answer)]
    nums = [n for n in nums if n not in asked]
    return bool(nums) and all(_matches(n, vals, years) for n in nums)


def _post(key: str):
    return lambda body: httpx.post(
        "https://api.anthropic.com/v1/messages", json=body, timeout=120,
        headers={"x-api-key": key, "anthropic-version": "2023-06-01"},
    ).raise_for_status().json()  # fmt: skip


def post_with_retry(post, body: dict, sleep=time.sleep) -> dict:
    """At most TRIES attempts; 429, 529, 5xx and transport errors back off 1, 2, 4 s."""
    for n in range(1, TRIES + 1):
        try:
            return post(body)
        except (httpx.HTTPStatusError, httpx.TransportError) as e:
            status = e.response.status_code if isinstance(e, httpx.HTTPStatusError) else None
            retryable = status is None or status in RETRY_STATUS or status >= 500
            if n == TRIES or not retryable:
                raise
            sleep(2 ** (n - 1))
    raise AssertionError("unreachable")


def ask_llm(q: dict, key: str, model: str, post=None, sleep=time.sleep) -> dict:
    post = post or _post(key)
    text = f"{q['q']} (country: {q['geo']}, period: {q['start']} to {q['end']}). Use the tools; quote numbers exactly."
    msgs, obs, answer = [{"role": "user", "content": text}], [], ""
    for _ in range(6):
        out = post_with_retry(
            post, {"model": model, "max_tokens": 1024, "tools": TOOLS, "messages": msgs}, sleep
        )
        msgs.append({"role": "assistant", "content": out["content"]})
        answer = "".join(b.get("text", "") for b in out["content"] if b["type"] == "text")
        calls = [b for b in out["content"] if b["type"] == "tool_use"]
        if out.get("stop_reason") != "tool_use" or not calls:
            break
        done = [{"type": "tool_result", "tool_use_id": c["id"], "content": _run_tool(c["name"], c["input"])} for c in calls]  # fmt: skip
        obs += [d["content"] for c, d in zip(calls, done) if c["name"] == "get_observations"]
        msgs.append({"role": "user", "content": done})
    return {"id": q["id"], "answer": answer, "pass": grade_answer(q["q"], answer, obs), "error": None}  # fmt: skip


def run_llm(
    questions: list[dict], model: str | None = None, post=None, sleep=time.sleep
) -> dict | None:
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key and post is None:
        print("--llm: ANTHROPIC_API_KEY is not set; skipping", file=sys.stderr)
        return None
    model = model or os.environ.get("STATMESH_BENCH_MODEL") or DEFAULT_MODEL
    rows = []
    for q in questions:
        try:
            rows.append(ask_llm(q, key or "", model, post, sleep))
        except Exception as e:  # noqa: BLE001 - one failed question must not lose the run
            rows.append({"id": q["id"], "answer": "", "pass": False, "error": f"{type(e).__name__}: {e}"})  # fmt: skip
    return {"model": model, "n": len(rows), "pass_rate": sum(r["pass"] for r in rows) / (len(rows) or 1), "errors": sum(bool(r["error"]) for r in rows), "rows": rows}  # fmt: skip


# ---- output ----


def render_report(res: dict, thresholds: dict | None) -> str:
    m = res["metrics"]
    out = [
        "# Benchmark report", "",
        (
            f"{m['n']} questions on the fixture catalog (offline; it tests the plumbing, not real "
            f"coverage). Generated {res['generated']}."
        ),
        "",
        "| metric | value | threshold |", "|---|---|---|",
    ]  # fmt: skip
    for k in METRICS:
        t = f"{thresholds[k]:.2f}" if thresholds and k in thresholds else "-"
        out.append(f"| {k} | {m[k]:.3f} | {t} |")
    for title, key in (("Source", "by_source"), ("Topic", "by_topic")):
        out += ["", f"## By {title.lower()}", "", f"| {title} | n | recall@5 | answerable | cited | answer rate |", "|---|---|---|---|---|---|"]  # fmt: skip
        for k, v in res[key].items():
            out.append(f"| {k} | {v['n']} | {v['recall_at_5']:.2f} | {v['answerable']:.2f} | {v['cited']:.2f} | {v['answer_rate']:.2f} |")  # fmt: skip
    bad = [r for r in res["questions"] if not (r["recall"] and r["answerable"] and r["cited"])]
    out += ["", f"## Questions that did not pass ({len(bad)})", ""]
    for r in bad:
        why = "miss" if not r["recall"] else "no value" if not r["answerable"] else "no citation"
        out.append(f"- {r['id']} ({why}): {r['q']} | want {', '.join(r['expected'])} | got {', '.join(r['got']) or '-'}" + (f" | {r['error']}" if r["error"] else ""))  # fmt: skip
    if res["missing_keys"]:
        out += ["", f"## Expected keys missing from the catalog ({len(res['missing_keys'])})", ""]
        out += [f"- {k}" for k in res["missing_keys"]]
    if res.get("llm"):
        out += ["", f"## LLM mode ({res['llm']['model']})", "", f"pass rate {res['llm']['pass_rate']:.3f} on {res['llm']['n']} questions ({res['llm']['errors']} failed with an error)"]  # fmt: skip
    return "\n".join(out) + "\n"


def run(questions: list[dict], settings: Settings) -> dict:
    open_service(settings)
    rows = [run_question(q) for q in questions]
    return {"generated": datetime.now(UTC).strftime("%Y-%m-%d"), "catalog": "fixture catalog",
            **summarize(rows), "missing_keys": missing_keys(questions, settings),
            "questions": rows}  # fmt: skip


def bench_cmd(args: argparse.Namespace) -> int:
    g = lambda k, d=None: getattr(args, k, None) or d
    out_dir = Path(g("out", OUT_DIR))
    qpath = g("questions", QUESTIONS)
    qs = load_questions(qpath)
    if g("limit"):
        qs = qs[: g("limit")]
    try:
        settings, errors = build_data(Path(g("data_dir", DATA_DIR)), bool(g("rebuild")), qpath)
    except DataDirError as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    for k, v in errors.items():
        print("SKIPPED", k, v, file=sys.stderr)
    res = run(qs, settings)
    if g("llm"):
        res["llm"] = run_llm(qs, g("model"))
    tpath = out_dir / "thresholds.json"
    if g("write_thresholds"):
        out_dir.mkdir(parents=True, exist_ok=True)
        tpath.write_text(json.dumps(make_thresholds(res["metrics"]), indent=2) + "\n", "utf-8")
    thresholds = json.loads(tpath.read_text("utf-8")) if tpath.exists() else None
    if not g("no_write"):
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / "results.json").write_text(
            json.dumps(res, indent=1, default=str) + "\n", "utf-8"
        )
        (out_dir / "REPORT.md").write_text(render_report(res, thresholds), "utf-8")
    m = res["metrics"]
    print("  ".join(f"{k}={m[k]:.3f}" for k in METRICS), f"n={m['n']}")
    fails = check(m, thresholds or {})
    if res["missing_keys"]:
        fails.append(f"{len(res['missing_keys'])} expected keys not in the catalog")
        for k in res["missing_keys"]:
            print("MISSING", k, file=sys.stderr)
    for f in fails:
        print("FAIL", f, file=sys.stderr)
    return 1 if fails else 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        prog="python -m statmesh.bench", description=__doc__.split("\n")[0]
    )
    ap.add_argument(
        "--llm", action="store_true", help="also grade model answers (needs ANTHROPIC_API_KEY)"
    )
    ap.add_argument(
        "--rebuild", action="store_true", help="rebuild evals/bench_data from the fixtures"
    )
    ap.add_argument("--write-thresholds", action="store_true", help="set thresholds from this run")
    ap.add_argument("--no-write", action="store_true", help="do not write results.json / REPORT.md")
    ap.add_argument(
        "--model", help=f"--llm model (default: $STATMESH_BENCH_MODEL, else {DEFAULT_MODEL})"
    )
    ap.add_argument("--limit", type=int)
    ap.add_argument("--questions")
    ap.add_argument("--data-dir")
    ap.add_argument("--out")
    return bench_cmd(ap.parse_args(argv))


if __name__ == "__main__":
    raise SystemExit(main())
