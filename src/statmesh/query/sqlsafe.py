"""Layer 2 of SQL safety: parse with DuckDB's own parser and walk the AST.

Layer 1 (engine.py) is the DuckDB lock-down; this layer gives clear errors and does not
rely on the lock-down alone. Allowed: exactly one SELECT whose FROM clauses use only
allowlisted tables/views (or CTE names), subqueries, joins and VALUES. No table functions.
"""

from __future__ import annotations

import json
from collections.abc import Collection

import duckdb

ALLOWED_VIEWS = frozenset(
    {
        "observations", "observations_vintages", "series", "datasets", "sources",
        "entities", "entity_xref", "geos", "geo_groups",
    }
)  # fmt: skip
_TABLE_OK = {"BASE_TABLE", "SUBQUERY", "JOIN", "EXPRESSION_LIST", "EMPTY"}
# Table refs have no "class" key (expressions do); anything else seen with these types is rejected.
_TABLE_TYPES = _TABLE_OK | {"TABLE_FUNCTION", "PIVOT", "SHOW_REF", "COLUMN_DATA", "CTE"}


class SqlRejected(ValueError):
    pass


# Catalog-reading builtins (pg_get_viewdef leaks view SQL with absolute paths): every pg_*, has_*_privilege,
# *_description, format_type, map_to_pg_oid, current_query, plus the settings/env readers.
_BAD_FUNCS = (
    "duckdb_", "pg_", "has_", "format_type", "obj_description", "col_description",
    "shobj_description", "map_to_pg_oid", "current_query", "current_setting", "getenv",
    "getvariable",
)  # fmt: skip
_BAD_CHARS = set("/\\.*\"'")


_BAD_CTE = ("_", "duckdb_", "sqlite_", "pragma_", "information_schema", "pg_")


def _walk(n, ok: frozenset[str], allowed: frozenset[str] = ALLOWED_VIEWS) -> None:
    if isinstance(n, dict):
        # A CTE is visible to LATER CTEs of the same WITH and to the query body, never to its own
        # body (the engine would bind a real object of that name) - except the recursive branch.
        cm = (n.get("cte_map") or {}).get("map", [])
        for e in cm:
            name = e["key"].lower()
            if name not in allowed and name.startswith(_BAD_CTE):
                raise SqlRejected(f"CTE name {name!r} is not allowed")
            _walk(e["value"], ok, allowed)
            ok = ok | {name}
        if n.get("type") == "RECURSIVE_CTE_NODE":
            own = ok | {(n.get("cte_name") or "").lower()}
            for k, v in n.items():
                _walk(v, own if k == "right" else ok, allowed)
            return
        t = n.get("type")
        if t in _TABLE_TYPES and "class" not in n:
            if t not in _TABLE_OK:
                raise SqlRejected(f"{t.lower().replace('_', ' ')} is not allowed")
            if t == "BASE_TABLE":
                name = (n.get("table_name") or "").lower()
                if n.get("catalog_name") or n.get("schema_name") not in ("", "main", None):
                    raise SqlRejected(f"table {name!r} is not allowed")
                if name not in ok or _BAD_CHARS & set(name):
                    raise SqlRejected(f"table {name!r} is not allowed")
        if n.get("class") == "FUNCTION":
            fn = (n.get("function_name") or "").lower()
            if fn.startswith(_BAD_FUNCS):
                raise SqlRejected(f"function {fn!r} is not allowed")
        for v in n.values():
            _walk(v, ok, allowed)
    elif isinstance(n, list):
        for v in n:
            _walk(v, ok, allowed)


def check(sql: str, allowed: Collection[str] = ALLOWED_VIEWS) -> None:
    """Raise SqlRejected unless `sql` is one SELECT over allowlisted views."""
    con = duckdb.connect()
    try:
        raw = con.execute("SELECT json_serialize_sql(?)", [sql]).fetchone()[0]
    except (duckdb.Error, RecursionError) as e:
        raise SqlRejected(str(e)) from e
    finally:
        con.close()
    try:
        _check_doc(json.loads(raw), allowed)
    except RecursionError as e:
        raise SqlRejected("query is nested too deeply") from e


def _check_doc(doc, allowed) -> None:
    if doc.get("error"):
        msg = doc.get("error_message", "")
        if "Only SELECT" in msg:
            msg = "only a single SELECT statement is allowed"
        raise SqlRejected(msg)
    if len(doc["statements"]) != 1:
        raise SqlRejected("exactly one statement is allowed")
    allow = frozenset(a.lower() for a in allowed)
    _walk(doc, allow, allow)
