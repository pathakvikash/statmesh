from __future__ import annotations

import os
import re
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

_MEM = re.compile(r"\d+(\.\d+)?\s*(KB|MB|GB|TB|KiB|MiB|GiB|TiB)", re.IGNORECASE)
_ORIGIN = re.compile(r"https?://[A-Za-z0-9.\-]+(\[[0-9A-Fa-f:]+\])?(:\d{1,5})?")


def _get(env: Mapping[str, str], name: str, default):
    """env value, or `default` when unset or empty (hosted platforms pass "" for unset)."""
    v = env.get(name)
    return default if v is None or not v.strip() else v


def _flag(env: Mapping[str, str], name: str, default: bool) -> bool:
    v = _get(env, name, None)
    if v is None:
        return default
    v = v.strip().lower()
    if v in ("1", "true", "yes", "on"):
        return True
    if v in ("0", "false", "no", "off"):
        return False
    raise ValueError(f"{name} must be on/off (1/true/yes/on or 0/false/no/off), got {v!r}")


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
    duckdb_memory_limit: str = "2GB"
    ondemand: bool = True
    cors_origins: tuple[str, ...] = ()
    cache_max_age_s: int = 0
    shares_enabled: bool = True
    gap_log: bool = True  # record zero-hit search queries (text only) in data_dir/gaps.sqlite
    share_max_bytes: int = 512_000
    share_ttl_days: int = 0  # 0 = forever
    export_max_rows: int = 5_000_000
    allowed_hosts: tuple[str, ...] = (
        "localhost:*",
        "127.0.0.1:*",
        "[::1]:*",
        "api:*",
    )  # MCP Host check; ("*",) disables
    public_url: str | None = None  # hosted: public origin, http(s)://host[:port]; no path

    def validate(self) -> None:
        """Startup check for serve / worker / mcp."""
        from statmesh.core.connector import list_connectors

        if not _MEM.fullmatch(self.duckdb_memory_limit):
            raise ValueError(
                f"STATMESH_DUCKDB_MEMORY must look like 2GB or 512MB, got {self.duckdb_memory_limit!r}"
            )
        if float(re.match(r"\d+(\.\d+)?", self.duckdb_memory_limit)[0]) == 0:
            raise ValueError("STATMESH_DUCKDB_MEMORY must be greater than 0")
        for name, var, lo in (
            ("cache_max_age_s", "STATMESH_CACHE_MAX_AGE", 0),
            ("share_ttl_days", "STATMESH_SHARE_TTL_DAYS", 0),
            ("share_max_bytes", "STATMESH_SHARE_MAX_BYTES", 1),
            ("export_max_rows", "STATMESH_EXPORT_MAX_ROWS", 1),
        ):
            if getattr(self, name) < lo:
                raise ValueError(f"{var} must be >= {lo}, got {getattr(self, name)}")
        if self.mode == "hosted" and self.share_max_bytes > 262_144:
            raise ValueError(
                f"STATMESH_SHARE_MAX_BYTES must be <= 262144 in hosted mode (nginx body cap), "
                f"got {self.share_max_bytes}"
            )
        if self.public_url and not _ORIGIN.fullmatch(self.public_url):
            raise ValueError(
                f"STATMESH_PUBLIC_URL must be http(s)://host[:port] with no path, got {self.public_url!r}"
            )
        for o in self.cors_origins:
            if o != "*" and not (
                (m := _ORIGIN.fullmatch(o)) and int(o.rsplit(":", 1)[1] if m[2] else 0) <= 65535
            ):
                raise ValueError(
                    f"STATMESH_CORS_ORIGINS entries must be * or scheme://host[:port] "
                    f"with no path, got {o!r}"
                )
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
        hosted = mode == "hosted"
        cdir = env.get("STATMESH_CONNECTORS_DIR")
        return cls(
            data_dir=Path(env.get("STATMESH_DATA_DIR", "data")),
            mode=mode,  # type: ignore[arg-type]
            contact_email=env.get("STATMESH_CONTACT_EMAIL") or None,
            disabled=frozenset(
                s.strip() for s in env.get("STATMESH_DISABLE", "").split(",") if s.strip()
            ),
            connectors_dir=Path(cdir) if cdir else None,
            sql_timeout_s=float(_get(env, "STATMESH_SQL_TIMEOUT_S", d.sql_timeout_s)),
            sql_max_rows=int(_get(env, "STATMESH_SQL_MAX_ROWS", d.sql_max_rows)),
            fetch_timeout_s=float(_get(env, "STATMESH_FETCH_TIMEOUT_S", d.fetch_timeout_s)),
            fetch_max_rows=int(_get(env, "STATMESH_FETCH_MAX_ROWS", d.fetch_max_rows)),
            fetch_max_wait_s=float(_get(env, "STATMESH_FETCH_MAX_WAIT_S", d.fetch_max_wait_s)),
            sql_max_bytes=int(_get(env, "STATMESH_SQL_MAX_BYTES", d.sql_max_bytes)),
            allowed_hosts=tuple(
                h.strip() for h in env["STATMESH_ALLOWED_HOSTS"].split(",") if h.strip()
            )
            if "STATMESH_ALLOWED_HOSTS" in env
            else d.allowed_hosts,
            duckdb_memory_limit=_get(env, "STATMESH_DUCKDB_MEMORY", d.duckdb_memory_limit).strip(),
            ondemand=_flag(env, "STATMESH_ONDEMAND", not hosted),
            cors_origins=tuple(
                o.strip() for o in env.get("STATMESH_CORS_ORIGINS", "").split(",") if o.strip()
            ),
            public_url=env.get("STATMESH_PUBLIC_URL", "").strip() or None,
            cache_max_age_s=int(_get(env, "STATMESH_CACHE_MAX_AGE", 300 if hosted else 0)),
            shares_enabled=_flag(env, "STATMESH_SHARES", d.shares_enabled),
            # hosted: off unless set (ephemeral disk, no shell: `statmesh gaps` cannot read it; no durable store yet)
            gap_log=_flag(env, "STATMESH_GAP_LOG", not hosted),
            share_max_bytes=int(
                _get(env, "STATMESH_SHARE_MAX_BYTES", 262_144 if hosted else d.share_max_bytes)
            ),
            share_ttl_days=int(_get(env, "STATMESH_SHARE_TTL_DAYS", 90 if hosted else 0)),
            export_max_rows=int(_get(env, "STATMESH_EXPORT_MAX_ROWS", d.export_max_rows)),
            python_sandbox=_flag(env, "STATMESH_PYTHON_SANDBOX", False),
        )
