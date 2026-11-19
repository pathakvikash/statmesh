from __future__ import annotations

from statmesh.settings import Settings
from statmesh.testing.fixtures import record


def record_cmd(args) -> int | None:
    record(args.id, Settings.from_env())
    print(f"recorded fixtures for {args.id}")
