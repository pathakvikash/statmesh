import pytest

from statmesh.cli import build_parser, main

COMMANDS = ["serve", "mcp", "worker", "discover", "ingest", "search", "get", "sql", "export",
            "sources", "connector"]  # fmt: skip


def test_help_lists_every_command(capsys):
    with pytest.raises(SystemExit):
        main(["--help"])
    out = capsys.readouterr().out
    assert all(c in out for c in COMMANDS)


def test_unbuilt_target_reports_and_fails(capsys):
    from argparse import Namespace

    from statmesh.cli import _dispatch

    assert _dispatch("statmesh.no_such_module:fn", Namespace()) == 1
    assert _dispatch("statmesh.cli:no_such_fn", Namespace()) == 1
    assert capsys.readouterr().err.count("not built yet") == 2


def test_parses_args():
    a = build_parser().parse_args(["get", "s:d:i:IND", "--start", "2020", "--format", "json"])
    assert (a.series_id, a.start, a.format, a.local) == ("s:d:i:IND", "2020", "json", False)
    a = build_parser().parse_args(["connector", "new", "foo", "--kind", "file"])
    assert a.target.endswith("scaffold:new_cmd") and a.kind == "file"
    a = build_parser().parse_args(["export", "a", "b", "--out", "o"])
    assert a.series_ids == ["a", "b"] and a.format == "csv"


def test_get_and_search_pass_geo_and_limit(monkeypatch):
    from statmesh import sdk

    seen = {}

    class C:
        def _obs(self, sid, start, end, **kw):
            seen["obs"] = kw
            return {"columns": [], "rows": []}

        def _search(self, q, **kw):
            seen["search"] = kw
            return {"hits": []}

    monkeypatch.setattr(sdk, "_client", lambda a: C())
    assert main(["get", "s:d:i", "--geo", "IND", "--limit", "5", "--local"]) == 0
    assert seen["obs"]["geo"] == "IND" and seen["obs"]["limit"] == 5
    assert main(["search", "x", "--limit", "3", "--local"]) == 0
    assert seen["search"]["limit"] == 3
