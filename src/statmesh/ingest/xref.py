"""Inferred CIK/UK-company-number -> LEI links from legal name + location. Pure, deterministic, no fuzzy matching.

Name key: casefold, strip accents, '&'->'and', drop dots/apostrophes, other punctuation -> space,
drop a trailing '/DE/'-style state tag, drop leading 'the', drop trailing legal-suffix tokens (inc, corp, ltd, llc, plc, ...).
Candidates = LEIs with the same name key and compatible country. Confidence per candidate:
  0.9  a state or a 5-digit postcode agrees (HQ or legal address of the LEI)
  0.6  no location to compare on one side (name-only)
  0.4  both sides have a state/postcode and none agree (address mismatch)
Different known countries = not a candidate. Several candidates tied at the best confidence =
ambiguous = no link. Every row is inferred=True.
uk:<number> (Companies House) ids also match a GBR LEI whose attrs.registered_as equals the number
(zero-padded to 8 digits): confidence 1.0, wins over name matching. UK postcodes compare compacted.
source_id is "gleif": 'statmesh' is not a registered source, so hosted mode would hide the rows;
gleif is, and the rows live in their own part directory (see runner.refresh_inferred_links).
ponytail: suffix drop ignores Corp vs Ltd (so 'Foo Inc' == 'Foo Ltd'); tighten if it misleads.
"""

from __future__ import annotations

import re
import unicodedata
from collections import defaultdict

import pyarrow as pa

from statmesh.core.schema import XREF_SCHEMA, empty_table

SOURCE = "gleif"
CONF_REGISTERED = 1.0
CONF_EXACT, CONF_NAME_ONLY, CONF_MISMATCH = 0.9, 0.6, 0.4
_SUFFIXES = {
    "inc", "incorporated", "corp", "corporation", "co", "company", "ltd", "limited", "llc",
    "lp", "llp", "plc", "sa", "nv", "ag", "gmbh", "pty", "lc", "pc", "trust",
}  # fmt: skip
_STATE_TAG = re.compile(r"\s*/[a-z]{2}/?\s*$")


def normalize_name(name: str) -> str:
    s = unicodedata.normalize("NFKD", name.casefold())
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = _STATE_TAG.sub("", s).replace("&", " and ").replace(".", "").replace("'", "")
    toks = re.sub(r"[^a-z0-9]+", " ", s).split()
    while toks and toks[0] == "the":
        toks.pop(0)
    while len(toks) > 1 and toks[-1] in _SUFFIXES:
        toks.pop()
    return " ".join(toks)


def _zip5(z: str | None) -> str | None:
    """US ZIP5, else a compacted UK-style postcode ('SW1A 1AA' -> 'SW1A1AA')."""
    m = re.match(r"\s*(\d{5})", z or "")
    if m:
        return m.group(1)
    return re.sub(r"[^A-Z0-9]", "", (z or "").upper()) or None


def _reg_no(n: str | None) -> str | None:
    n = (n or "").strip().upper()
    return (n.zfill(8) if n.isdigit() else n) or None


def _places(attrs: dict, address: str | None, keys: tuple[str, str, str, str]):
    """(states, zips) from attrs; falls back to parsing 'ST 12345' out of the address."""
    st_k, zp_k, lst_k, lzp_k = keys
    states = {attrs[k].upper() for k in (st_k, lst_k) if attrs.get(k)}
    zips = {z for k in (zp_k, lzp_k) if (z := _zip5(attrs.get(k)))}
    if not (states or zips) and address:
        m = re.search(r"\b([A-Z]{2})\s+(\d{5})(?:-\d{4})?\b", address)
        if m:
            states, zips = {m.group(1)}, {m.group(2)}
    return states, zips


def _row(e: dict):
    attrs = dict(e["attrs"] or {})
    if e["entity_id"].startswith(
        ("cik:", "uk:")
    ):  # SEC / Companies House: state / zip (or postcode) in attrs
        attrs.setdefault("postcode", attrs.get("zip"))
    return _places(attrs, e["address"], ("state", "postcode", "legal_state", "legal_postcode"))


def _score(cik: dict, lei: dict) -> float | None:
    if cik["country"] and lei["country"] and cik["country"] != lei["country"]:
        return None
    (cs, cz), (ls, lz) = _row(cik), _row(lei)
    if not (cs or cz) or not (ls or lz):
        return CONF_NAME_ONLY
    return CONF_EXACT if (cs & ls or cz & lz) else CONF_MISMATCH


def match_cik_to_lei(entities: pa.Table) -> pa.Table:
    rows = entities.to_pylist()
    leis: dict[str, list[dict]] = defaultdict(list)
    by_reg: dict[str, set[str]] = defaultdict(set)
    for e in rows:
        if e["entity_id"].startswith("lei:"):
            leis[normalize_name(e["name"])].append(e)
            reg = _reg_no(dict(e["attrs"] or {}).get("registered_as"))
            if reg and e["country"] == "GBR":
                by_reg[reg].add(e["entity_id"])
    now = max((e["retrieved_at"] for e in rows), default=None)
    out: dict[tuple[str, str], float] = {}
    for c in rows:
        if not c["entity_id"].startswith(("cik:", "uk:")):
            continue
        if (
            c["entity_id"].startswith("uk:")
            and len(ids := by_reg.get(_reg_no(c["entity_id"][3:]), ())) == 1
        ):
            out[c["entity_id"], next(iter(ids))] = CONF_REGISTERED
            continue
        scored = [(s, le["entity_id"]) for le in leis.get(normalize_name(c["name"]), [])
                  if (s := _score(c, le)) is not None]  # fmt: skip
        if not scored:
            continue
        best = max(s for s, _ in scored)
        top = sorted({to for s, to in scored if s == best})
        if len(top) == 1:  # a tie at the best score is ambiguous: no link
            out[c["entity_id"], top[0]] = max(best, out.get((c["entity_id"], top[0]), 0))
    if not out:
        return empty_table("entity_xref")
    pairs = sorted(out)
    return pa.table(
        {
            "from_id": [a for a, _ in pairs], "to_id": [b for _, b in pairs],
            "source_id": [SOURCE] * len(pairs), "confidence": [out[k] for k in pairs],
            "inferred": [True] * len(pairs), "retrieved_at": [now] * len(pairs),
        },
        schema=XREF_SCHEMA,
    )  # fmt: skip
