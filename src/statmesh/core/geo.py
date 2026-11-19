from __future__ import annotations

import csv
import re
from collections.abc import Mapping
from functools import cache
from importlib import resources
from pathlib import Path
from typing import Literal

import pycountry


def _rows(name: str) -> list[dict[str, str]]:
    text = resources.files("statmesh.data").joinpath(name).read_text(encoding="utf-8")
    return list(csv.DictReader(l for l in text.splitlines() if not l.startswith("#")))


@cache
def _regions() -> dict[str, str]:
    return {r["code"]: r["name"] for r in _rows("regions.csv")}


@cache
def _groups() -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    for r in _rows("groups.csv"):
        out.setdefault(r["group"], []).append(r["geo"])
    return out


@cache
def _in_states() -> dict[str, str]:
    """LGD code, ISO code, name or alias (normalised) -> ISO 3166-2 code."""
    return {
        _norm(k.replace("&", "and")): r["iso"]
        for r in _rows("geo/in_states.csv")
        for k in (r["lgd_code"], r["iso"], r["name"], *r["aliases"].split("|"))
        if k
    }


def to_geo(
    code: str,
    scheme: Literal["iso2", "iso3", "m49", "name", "lgd_state"],
    overrides: Mapping[str, str] | None = None,
) -> str:
    """Returns ISO3, 'region:<code>', or 'unmapped:<code>'. `overrides` is geo_map.csv."""
    raw = str(code).strip()
    if overrides and raw in overrides:
        return overrides[raw]
    c = None
    if scheme == "iso2":
        c = pycountry.countries.get(alpha_2=raw.upper())
    elif scheme == "iso3":
        c = pycountry.countries.get(alpha_3=raw.upper())
        if c is None and raw.upper() in _regions():
            return f"region:{raw.upper()}"
    elif scheme == "m49":
        if raw.isdigit():
            c = pycountry.countries.get(numeric=raw.zfill(3))
    elif scheme == "name":
        key = _norm(raw)
        c = _name_index().get(key)
    elif scheme == "lgd_state":  # LGD code, IN-XX, name or alias -> IN-XX
        return _in_states().get(_norm(raw.replace("&", "and")), f"unmapped:{raw}")
    else:
        raise ValueError(f"unknown scheme {scheme!r}")
    return c.alpha_3 if c else f"unmapped:{raw}"


def load_geo_map(connector_dir: Path) -> dict[str, str]:
    """geo_map.csv: src_code,geo. Empty dict when the file is absent."""
    p = Path(connector_dir) / "geo_map.csv"
    if not p.exists():
        return {}
    with p.open(newline="", encoding="utf-8") as f:
        return {r["src_code"]: r["geo"] for r in csv.DictReader(f)}


def is_valid_geo(geo: str) -> bool:
    if geo.startswith("unmapped:"):
        return len(geo) > len("unmapped:")
    if geo.startswith("region:"):
        return geo[7:] in _regions()
    if re.fullmatch(r"[A-Z]{3}", geo):
        return pycountry.countries.get(alpha_3=geo) is not None
    if re.fullmatch(r"[A-Z]{2}-[A-Z0-9]{1,3}", geo):
        return pycountry.subdivisions.get(code=geo) is not None
    return False


def geo_name(geo: str) -> str:
    if geo.startswith("region:"):
        return _regions().get(geo[7:], geo)
    if geo.startswith("unmapped:"):
        return geo[9:]
    c = pycountry.countries.get(alpha_3=geo) if len(geo) == 3 else None
    if c:
        return getattr(c, "common_name", None) or c.name
    s = pycountry.subdivisions.get(code=geo) if "-" in geo else None
    return s.name if s else geo


def group_members(group: str) -> list[str]:
    return list(_groups().get(group, []))


# ---- country names in free text -------------------------------------------------------------

_ALIASES = {
    "US": "USA", "U.S.": "USA", "United States of America": "USA", "America": "USA",
    "UK": "GBR", "U.K.": "GBR", "Britain": "GBR", "Great Britain": "GBR",
    "Russia": "RUS", "Vietnam": "VNM", "Turkey": "TUR", "Iran": "IRN", "Syria": "SYR",
    "South Korea": "KOR", "Korea": "KOR", "North Korea": "PRK", "Laos": "LAO",
    "Bolivia": "BOL", "Venezuela": "VEN", "Tanzania": "TZA", "Czech Republic": "CZE",
    "Taiwan": "TWN", "Moldova": "MDA", "Ivory Coast": "CIV", "Cape Verde": "CPV",
    "Brunei": "BRN", "Swaziland": "SWZ", "Macedonia": "MKD", "Hong Kong": "HKG",
    "Palestine": "PSE", "Congo-Kinshasa": "COD", "DR Congo": "COD", "DRC": "COD",
    "Burma": "MMR", "Holland": "NLD", "UAE": "ARE", "Kyrgyz Republic": "KGZ",
    "Slovak Republic": "SVK", "Turkiye": "TUR", "Egypt": "EGY",
}  # fmt: skip


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", s.casefold().replace("ü", "u").strip())


@cache
def _name_index() -> dict[str, object]:
    idx: dict[str, object] = {}
    for c in pycountry.countries:
        for n in (c.name, getattr(c, "common_name", None), getattr(c, "official_name", None)):
            if n:
                idx.setdefault(_norm(n), c)
        # "Korea, Republic of" -> also "Republic of Korea" is official; keep literal only
    for n, a3 in _ALIASES.items():
        idx[_norm(n)] = pycountry.countries.get(alpha_3=a3)
    return idx


@cache
def _name_regex() -> re.Pattern[str]:
    # short all-caps aliases (US, UK, UAE...) match only in that case: "show us GDP" is not USA
    caps = [n for n in _ALIASES if n.isupper() and len(n) <= 4]
    skip = {_norm(n) for n in caps} | {"america"}
    names = sorted((n for n in _name_index() if n not in skip), key=len, reverse=True)
    alt = "|".join(re.escape(n) for n in names)
    cs = "|".join(re.escape(n) for n in sorted(caps, key=len, reverse=True))
    # bare "America" is the US, but not Latin/North/South/Central America
    america = r"(?<!latin )(?<!north )(?<!south )(?<!central )america"
    return re.compile(rf"(?<![\w.])((?-i:{cs})|{america}|{alt})(?![\w])", re.IGNORECASE)


def find_geos_in_text(text: str) -> tuple[list[str], str]:
    """(ISO3 codes found in order, unique; text with the country names removed)."""
    found: list[str] = []

    def sub(m: re.Match[str]) -> str:
        c = _name_index()[_norm(m.group(1))]
        if c.alpha_3 not in found:  # type: ignore[attr-defined]
            found.append(c.alpha_3)  # type: ignore[attr-defined]
        return " "

    rest = _name_regex().sub(sub, text)
    return found, re.sub(r"\s+", " ", rest).strip()
