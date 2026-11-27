"""Licence matrix: hosted mode serves only redistribute=yes on EVERY surface; self-host serves all.

One synthetic catalog (sources, datasets and series at yes / review / no, plus overrides) is read
through every surface in SURFACES. Add a surface = add one `S(...)` line. Each surface says which
item kinds it must show in full (`must`); anything else it happens to show is only leak-checked.
`test_every_public_route_is_covered_or_exempt` fails when a public REST route is in neither list.
"""

from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from typing import Any
from urllib.parse import quote

import pyarrow as pa
import pytest
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from mcp import Client

from statmesh import service
from statmesh.api.app import create_app
from statmesh.core.catalog import Catalog
from statmesh.core.models import DatasetMeta, Licence, Manifest, SeriesMeta
from statmesh.core.schema import OBS_SCHEMA
from statmesh.core.storage import Storage
from statmesh.mcp_server import build_server
from statmesh.query.sqlsafe import ALLOWED_VIEWS
from statmesh.settings import Settings

TS = datetime(2026, 1, 1, tzinfo=UTC)


def lic(red: str) -> Licence:
    return Licence(name=f"L-{red}", url="https://l.example", redistribute=red, attribution="A")


YES, REVIEW, NO = lic("yes"), lic("review"), lic("no")
SRC = {"yessrc": YES, "revsrc": REVIEW, "nosrc": NO}

# (source, dataset, indicator, token, dataset licence, series licence or None, servable hosted)
# The token is a unique word in the series title; the dataset token is its dataset title's.
ROWS = [
    ("yessrc", "D", "Y1", "tokay1", YES, None, True),
    ("yessrc", "D", "Y2", "tokay2", YES, None, True),
    ("yessrc", "D", "SNO", "tokasno", YES, NO, False),  # series overrides a yes dataset
    ("yessrc", "DR", "R1", "tokayr1", REVIEW, None, False),  # dataset overrides a yes source
    ("yessrc", "DN", "N1", "tokayn1", NO, None, False),
    ("revsrc", "D", "RS1", "tokars1", REVIEW, None, False),
    ("revsrc", "DY", "RY1", "tokary1", YES, None, True),  # dataset overrides a review source
    ("nosrc", "D", "NS1", "tokans1", NO, None, False),
]
DS_TOKEN = {(s, d): f"dset{s}{d}x".lower() for s, d, *_ in ROWS}
KEYS = [f"{s}:{d}:{i}" for s, d, i, *_ in ROWS]
TOKEN = {f"{s}:{d}:{i}": t for s, d, i, t, *_ in ROWS}
SERVED_KEYS = {f"{s}:{d}:{i}" for s, d, i, _, _, _, ok in ROWS if ok}
SERVED_DS = {
    (s, d) for s, d, *_ in ROWS if f"{s}:{d}" in {k.rsplit(":", 1)[0] for k in SERVED_KEYS}
}
SERVED_SRC = {s for s, _ in SERVED_DS}

# Items a surface can show: ("series", key) | ("dataset", token) | ("source", id)
ALL_ITEMS = (
    {("series", k) for k in KEYS}
    | {("dataset", t) for t in DS_TOKEN.values()}
    | {("source", s) for s in SRC}
)
SERVED_ITEMS = (
    {("series", k) for k in SERVED_KEYS}
    | {("dataset", DS_TOKEN[d]) for d in SERVED_DS}
    | {("source", s) for s in SERVED_SRC}
)


def _obs(key: str):
    s, d, i = key.split(":")
    return [
        {
            "series_id": f"{key}:{g}",
            "source_id": s,
            "dataset_id": d,
            "indicator_id": i,
            "geo": g,
            "period_start": date(y, 1, 1),
            "period_end": date(y, 12, 31),
            "freq": "A",
            "value": float(y - 2019),
            "unit": "pct",
            "unit_mult": 0,
            "dims": [],
            "obs_status": None,
            "retrieved_at": TS,
            "vintage": None,
        }
        for g in ("IND", "USA")
        for y in (2020, 2021)
    ]


@pytest.fixture(scope="module")
def data_dir(tmp_path_factory):
    path = tmp_path_factory.mktemp("licence_matrix")
    cat = Catalog(path / "catalog.sqlite")
    for sid, sl in SRC.items():
        cat.upsert_source(Manifest(id=sid, name=f"Name {sid}", kind="custom", licence=sl))
    for sid in SRC:
        dss: dict[str, list] = {}
        for s, d, i, t, dl, sl, _ in ROWS:
            if s == sid:
                ser = SeriesMeta(
                    i,
                    f"Zebra {t} unemployment rate",
                    freq="A",
                    unit="pct",
                    geos=("IND", "USA"),
                    licence=sl,
                )
                dss.setdefault(d, [dl, []])[1].append(ser)
        cat.upsert_discovery(
            sid,
            [
                DatasetMeta(sid, d, f"Title {DS_TOKEN[sid, d]}", dl, series=tuple(ser))
                for d, (dl, ser) in dss.items()
            ],
            core=[],
        )
        for d in dss:
            cat.set_dataset_status(sid, d, "ingested", ingested_at=TS)
    cat.close()
    st = Storage(path)
    with st.update_manifest() as m:
        for s, d in DS_TOKEN:
            rows = [r for k in KEYS if k.startswith(f"{s}:{d}:") for r in _obs(k)]
            m["obs"][f"{s}/{d}"] = st.write_parts(
                pa.Table.from_pylist(rows, schema=OBS_SCHEMA), f"obs/{s}/{d}", "r1"
            )
    return path


@dataclass
class Env:
    mode: str
    client: TestClient

    def rest(self, path: str, **params) -> Any:
        r = self.client.get(path, params=params)
        return r.text if r.status_code == 200 else None

    def mcp(self, tool: str, **args) -> Any:
        async def go():
            async with Client(build_server()) as c:
                return await c.call_tool(tool, args)

        try:
            r = asyncio.run(go())
        except Exception:  # noqa: BLE001  tool errors (refused / not found) surface as exceptions
            return None
        out = r.structured_content
        if r.is_error or (
            isinstance(out, dict)
            and out.get("status") in ("forbidden", "not_found", "rate_limited", "error")
        ):
            return None  # a refusal comes back as a status, not an exception
        return json.dumps(out, default=str)


@pytest.fixture(scope="module", params=["hosted", "self_host"])
def env(request, data_dir):
    service.configure(
        Settings(
            data_dir=data_dir, mode=request.param, ondemand=False, allowed_hosts=("testserver",)
        )
    )
    with TestClient(create_app()) as c:
        yield Env(request.param, c)


def dump(o: Any) -> str:
    return json.dumps(o, default=str, sort_keys=True)


def ok_status(r: Any) -> Any:  # service results carry a status; only "ok" counts as served
    return dump(r.model_dump(mode="json")) if r.status == "ok" else None


def safe(fn, *a, **kw) -> Any:  # KeyError / ValueError = the service refused
    try:
        return fn(*a, **kw)
    except (KeyError, ValueError):
        return None


def stream(key: str) -> Any:
    r = safe(service.stream_observations, key)
    return None if r is None or not hasattr(r, "batches") else dump([r.columns, list(r.batches)])


def sql_all(env: Env, view: str) -> str:
    return dump(service.run_sql(f"SELECT * FROM {view}").model_dump(mode="json"))


def many(*outs: Any) -> str:  # a list surface that issues several calls
    return " ".join(o for o in outs if o)


@dataclass
class S:
    """kind 'list': fn(env) -> text; kind 'id': fn(env, series_key) -> text or None (refused).
    must: item kinds that must appear in full (hosted: the servable ones, self-host: all)."""

    name: str
    kind: str
    fn: Any
    must: tuple[str, ...] = ("series",)
    routes: tuple[str, ...] = ()
    id: str = field(init=False)

    def __post_init__(self):
        self.id = self.name


def search(**kw) -> Any:
    return lambda env: dump(service.search_series(**kw).model_dump(mode="json"))


SOURCES = list(SRC)
SURFACES = [
    # search_series: query, filters, no-query newest-first, per-source, redistribute filter
    S("svc.search.q", "list", lambda e: search(q="zebra", limit=100)(e), routes=("/search",)),
    S("svc.search.geo", "list", lambda e: search(q="", geo="IND", limit=100)(e)),
    S(
        "svc.search.years",
        "list",
        lambda e: search(q="zebra", start_year=2020, end_year=2021, limit=100)(e),
    ),
    S("svc.search.topic", "list", lambda e: search(q="", topic="Labour", limit=100)(e)),
    S(
        "svc.search.source",
        "list",
        lambda e: many(*(search(q="zebra", source=s, limit=100)(e) for s in SOURCES)),
    ),
    S(
        "svc.search.redistribute",
        "list",
        lambda e: many(
            *(search(q="zebra", redistribute=r, limit=100)(e) for r in ("yes", "review", "no"))
        ),
        must=(),
    ),
    S("rest.search", "list", lambda e: e.rest("/search", q="zebra", limit=100)),
    S(
        "rest.search.filters",
        "list",
        lambda e: many(
            e.rest("/search", geo="IND", limit=100),
            e.rest("/search", redistribute="no"),
            *(e.rest("/search", q="zebra", source=s, limit=100) for s in SOURCES),
        ),
    ),
    S("mcp.search_series", "list", lambda e: e.mcp("search_series", q="zebra", limit=100)),
    # describe_series
    S(
        "svc.describe",
        "id",
        lambda e, k: safe(lambda: dump(service.describe_series(k).model_dump(mode="json"))),
    ),
    S(
        "rest.describe",
        "id",
        lambda e, k: e.rest(f"/series/{k}"),
        routes=("/series/{series_id:path}",),
    ),
    S("mcp.describe_series", "id", lambda e, k: e.mcp("describe_series", series_id=k)),
    # observations (+ stream, CSV export)
    S(
        "svc.observations",
        "id",
        lambda e, k: ok_status(service.get_observations(k)),
        must=("series",),
    ),
    S("svc.observations_recent", "id", lambda e, k: ok_status(service.get_observations_recent(k))),
    S("svc.stream", "id", lambda e, k: stream(k)),
    S(
        "rest.observations",
        "id",
        lambda e, k: e.rest(f"/series/{k}/observations"),
        routes=("/series/{series_id:path}/observations",),
    ),
    S(
        "rest.observations.csv",
        "id",
        lambda e, k: e.rest(f"/series/{k}/observations.csv"),
        routes=("/series/{series_id:path}/observations.csv",),
    ),
    S("mcp.get_observations", "id", lambda e, k: e.mcp("get_observations", series_id=k)),
    S(
        "mcp.get_observations.limit",
        "id",
        lambda e, k: e.mcp("get_observations", series_id=k, limit=5),
    ),
    # related_series: every anchor, hits and anchor
    S(
        "svc.related",
        "id",
        lambda e, k: safe(
            lambda: dump(service.related_series(k, limit=100).model_dump(mode="json"))
        ),
    ),
    S(
        "rest.related",
        "id",
        lambda e, k: e.rest(f"/series/{k}/related", limit=100),
        routes=("/series/{series_id:path}/related",),
    ),
    S("mcp.related_series", "id", lambda e, k: e.mcp("related_series", series_id=k, limit=100)),
    # sources and datasets
    S(
        "svc.sources",
        "list",
        lambda e: dump([s.model_dump(mode="json") for s in service.list_sources()]),
        must=("source",),
    ),
    S(
        "svc.sources.filters",
        "list",
        lambda e: many(
            *(
                dump([s.model_dump(mode="json") for s in service.list_sources(**f)])
                for f in (
                    {"q": "name"},
                    {"redistribute": "no"},
                    {"redistribute": "review"},
                    {"status": "data"},
                )
            )
        ),
        must=("source",),
    ),
    S("rest.sources", "list", lambda e: e.rest("/sources"), must=("source",), routes=("/sources",)),
    S("mcp.list_sources", "list", lambda e: e.mcp("list_sources"), must=("source",)),
    S("rest.schema", "list", lambda e: e.rest("/schema"), must=(), routes=("/schema",)),
    S("mcp.describe_schema", "list", lambda e: e.mcp("describe_schema"), must=()),
    # run_sql over every allowlisted view: VIEW_KINDS says what each must show in full
    *(
        S(f"svc.sql.{v}", "list", lambda e, v=v: sql_all(e, v), must=m)
        for v, m in {
            "observations": ("series",),
            "observations_vintages": ("series",),
            "series": ("series",),
            "datasets": ("dataset",),
            "sources": ("source",),
            "entities": (),
            "entity_xref": (),
            "geos": (),
            "geo_groups": (),
        }.items()
    ),
    S(
        "rest.query",
        "list",
        lambda e: many(
            *(
                (e.client.post("/query", json={"sql": f"SELECT * FROM {v}"}).text)
                for v in sorted(ALLOWED_VIEWS)
            )
        ),
        must=("series", "dataset", "source"),
        routes=("/query",),
    ),
    S(
        "mcp.run_sql",
        "list",
        lambda e: many(
            *(e.mcp("run_sql", sql=f"SELECT * FROM {v}") for v in sorted(ALLOWED_VIEWS))
        ),
        must=("series", "dataset", "source"),
    ),
]

if hasattr(service, "graph"):  # another agent adds it; covered only once it exists
    SURFACES += [
        S(
            "svc.graph",
            "list",
            lambda e: many(
                dump(service.graph().model_dump(mode="json")),
                *(
                    dump(safe(service.graph, f"source:{s}").model_dump(mode="json"))
                    for s in SOURCES
                    if safe(service.graph, f"source:{s}")
                ),
                dump(safe(service.graph, "topic:Labour").model_dump(mode="json"))
                if safe(service.graph, "topic:Labour")
                else "",
            ),
            must=(),
        ),
        S(
            "svc.graph.indicator",
            "id",
            lambda e, k: safe(
                lambda: dump(service.graph(f"indicator:{k}").model_dump(mode="json"))
            ),
        ),
        S(
            "rest.graph",
            "list",
            lambda e: many(
                e.rest("/graph"),
                e.rest("/graph", expand="topic:Labour"),
                *(e.rest("/graph", expand=f"source:{s}") for s in SOURCES),
            ),
            must=(),
            routes=("/graph",),
        ),
        S("rest.graph.indicator", "id", lambda e, k: e.rest("/graph", expand=f"indicator:{k}")),
    ]

# Public REST routes that carry no catalogue data, with the reason.
EXEMPT = {
    "/healthz": "liveness probe, constant body",
    "/readyz": "readiness probe: ops status only, no catalogue rows",
    "/llms.txt": "static usage text, no catalogue rows",
    "/shares": "stores ids and params, never values (decisions.md, 2026-11-24)",
    "/shares/{share_id}": "returns stored ids and params only, never values",
    "/python": "absent in hosted mode (sandbox is self-host only)",
    "/.well-known/orrery-app.json": "static app manifest, no catalogue rows",
    "/openapi.json": "API description, no catalogue rows",
    "/docs": "swagger UI shell",
    "/docs/oauth2-redirect": "swagger UI shell",
    "/redoc": "redoc UI shell",
}


def exposed(s: S, env: Env) -> set[tuple[str, str]]:
    """Items of ALL_ITEMS that appear in what the surface returned."""
    if s.kind == "list":
        texts = [s.fn(env) or ""]
        keys: set[str] = set()
    else:
        outs = {k: s.fn(env, k) for k in KEYS}
        keys = {k for k, o in outs.items() if o}
        texts = [o for o in outs.values() if o]
    text = " ".join(texts).lower()
    found = {("series", k) for k in keys}
    found |= {("series", k) for k in KEYS if k.lower() in text or TOKEN[k] in text}
    found |= {("dataset", t) for t in DS_TOKEN.values() if t in text}
    found |= {("source", sid) for sid in SRC if sid in text}
    return found


@pytest.mark.parametrize("s", SURFACES, ids=lambda s: s.id)
def test_surface_respects_the_licence(s: S, env: Env):
    got = exposed(s, env)
    allowed = SERVED_ITEMS if env.mode == "hosted" else ALL_ITEMS
    assert not got - allowed, f"{s.id} leaks in {env.mode}: {sorted(got - allowed)}"
    must = {i for i in allowed if i[0] in s.must}
    assert must <= got, f"{s.id} hides servable items in {env.mode}: {sorted(must - got)}"


def test_universe_is_what_the_matrix_assumes():
    assert len(SERVED_KEYS) == 3 and len(KEYS) - len(SERVED_KEYS) == 5
    assert SERVED_SRC == {"yessrc", "revsrc"}
    assert {k for k in ("svc.sql." + v for v in ALLOWED_VIEWS)} <= {s.id for s in SURFACES}, (
        "a view was added to the SQL allowlist: add it to the run_sql surfaces here"
    )


def test_every_public_route_is_covered_or_exempt(env: Env):
    covered = {r for s in SURFACES for r in s.routes}
    top = env.client.app.routes
    flat = [
        x
        for r in top
        for x in (getattr(r, "original_router", r).routes if hasattr(r, "original_router") else [r])
    ]
    paths = {r.path for r in flat if isinstance(r, APIRoute)} | {  # docs routes are plain Routes
        r.path for r in top if type(r).__name__ == "Route"
    }
    missing = sorted(paths - covered - set(EXEMPT))
    assert not missing, f"public routes with no licence-matrix surface or exemption: {missing}"
    assert not {p for p in covered if p not in paths}, "a surface names a route that is gone"


def test_hosted_series_urls_quote_safely():  # ids carry ':' only; guards the f-string URLs above
    assert all(quote(k, safe=":") == k for k in KEYS)
