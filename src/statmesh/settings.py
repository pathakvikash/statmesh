from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Literal


@dataclass(frozen=True)
class Settings:
    data_dir: Path = Path("data")
    mode: Literal["self_host", "hosted"] = "self_host"
    contact_email: str | None = None
    disabled: frozenset[str] = frozenset()
    connectors_dir: Path | None = None
    sql_timeout_s: float = 20
    sql_max_rows: int = 10_000
    sql_max_bytes: int = 50_000_000
    fetch_timeout_s: float = 30
    fetch_max_rows: int = 200_000
    fetch_max_wait_s: float = 5
    python_sandbox: bool = False
    allowed_hosts: tuple[str, ...] = (
        "localhost:*",
        "127.0.0.1:*",
        "[::1]:*",
        "api:*",
    )  # MCP Host check; ("*",) disables

    def validate(self) -> None:
        """Startup check for serve / worker / mcp."""
        from statmesh.core.connector import list_connectors

        if not self.contact_email and "sec_edgar" in list_connectors(self):
            raise ValueError(
                "STATMESH_CONTACT_EMAIL is required while sec_edgar is enabled (SEC EDGAR sends "
                "it in the User-Agent); set it or add sec_edgar to STATMESH_DISABLE"
            )

    @classmethod
    def from_env(cls, env: Mapping[str, str] = os.environ) -> Settings:
        mode = env.get("STATMESH_MODE", "self_host")
        if mode not in ("self_host", "hosted"):
            raise ValueError(f"STATMESH_MODE must be self_host or hosted, got {mode!r}")
        d = cls()
        cdir = env.get("STATMESH_CONNECTORS_DIR")
        return cls(
            data_dir=Path(env.get("STATMESH_DATA_DIR", "data")),
            mode=mode,  # type: ignore[arg-type]
            contact_email=env.get("STATMESH_CONTACT_EMAIL") or None,
            disabled=frozenset(
                s.strip() for s in env.get("STATMESH_DISABLE", "").split(",") if s.strip()
            ),
            connectors_dir=Path(cdir) if cdir else None,
            sql_timeout_s=float(env.get("STATMESH_SQL_TIMEOUT_S", d.sql_timeout_s)),
            sql_max_rows=int(env.get("STATMESH_SQL_MAX_ROWS", d.sql_max_rows)),
            fetch_timeout_s=float(env.get("STATMESH_FETCH_TIMEOUT_S", d.fetch_timeout_s)),
            fetch_max_rows=int(env.get("STATMESH_FETCH_MAX_ROWS", d.fetch_max_rows)),
            fetch_max_wait_s=float(env.get("STATMESH_FETCH_MAX_WAIT_S", d.fetch_max_wait_s)),
            sql_max_bytes=int(env.get("STATMESH_SQL_MAX_BYTES", d.sql_max_bytes)),
            allowed_hosts=tuple(
                h.strip() for h in env["STATMESH_ALLOWED_HOSTS"].split(",") if h.strip()
            )
            if "STATMESH_ALLOWED_HOSTS" in env
            else d.allowed_hosts,
            python_sandbox=env.get("STATMESH_PYTHON_SANDBOX", "").lower() in ("1", "true", "yes"),
        )
