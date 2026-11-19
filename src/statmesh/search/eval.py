"""Search eval: recall@k over evals/search_questions.yaml.

Each entry: {q: str, expected: [series_key, ...], geo?, freq?, source?}. A question is a hit when
any expected series_key is in the top k results.
"""

import sys
from pathlib import Path

import yaml

from statmesh.core.catalog import Catalog
from statmesh.search.search import search


def evaluate(catalog: Catalog, path: Path | str, k: int = 5) -> tuple[float, list[dict]]:
    """(recall@k, misses); each miss is {q, expected, got}."""
    qs = yaml.safe_load(Path(path).read_text("utf-8"))
    misses = []
    for item in qs:
        opts = {x: item[x] for x in ("geo", "freq", "source") if x in item}
        got = [r["series_key"] for r in search(catalog, item["q"], limit=k, **opts)]
        if not set(item["expected"]) & set(got):
            misses.append({"q": item["q"], "expected": item["expected"], "got": got})
    return 1 - len(misses) / len(qs), misses


def run(catalog: Catalog, path: Path | str, k: int = 5) -> float:
    return evaluate(catalog, path, k)[0]


if __name__ == "__main__":  # python -m statmesh.search.eval <catalog.sqlite> [questions.yaml]
    cat = Catalog(Path(sys.argv[1]), readonly=True)
    recall, misses = evaluate(
        cat, sys.argv[2] if len(sys.argv) > 2 else "evals/search_questions.yaml"
    )
    for m in misses:
        print("MISS", m["q"], "| want", m["expected"], "| got", m["got"])
    print(f"recall@5 = {recall:.2f}")
