"""Topic tagging: keyword rules (data/topics.yaml) over series and dataset titles, computed lazily."""

import re
from functools import cache
from importlib import resources

import yaml

TAXONOMY = ("Health", "Economy", "Labour", "Prices", "Trade", "Population", "Environment",
            "Energy", "Companies")  # fmt: skip


def _norm(text: str) -> tuple[str, ...]:
    return tuple(w.removesuffix("s") for w in re.findall(r"[a-z0-9]+", text.lower()))


@cache
def _rules() -> dict[str, tuple[tuple[str, ...], ...]]:
    raw = yaml.safe_load(
        resources.files("statmesh.data").joinpath("topics.yaml").read_text("utf-8")
    )
    assert tuple(raw) == TAXONOMY, "topics.yaml must list exactly the taxonomy, in order"
    return {t: tuple(_norm(k) for k in kws) for t, kws in raw.items()}


def classify(*texts: str | None) -> list[str]:
    """Topics (taxonomy order) whose keywords occur as whole words/phrases in any text."""
    grams = []
    for t in texts:
        w = _norm(t or "")
        grams += [w[i : i + n] for n in (1, 2, 3) for i in range(len(w) - n + 1)]
    seen = set(grams)
    return [t for t, kws in _rules().items() if any(k in seen for k in kws)]


def check_topics(names) -> list[str]:
    """Manifest-supplied topics, validated against the taxonomy (unknown names are dropped)."""
    by_lower = {t.lower(): t for t in TAXONOMY}
    return [
        by_lower[n.lower()] for n in names or [] if isinstance(n, str) and n.lower() in by_lower
    ]
