from pathlib import Path

import pytest

from statmesh.core.licence import can_serve
from statmesh.core.models import Licence
from statmesh.settings import Settings


@pytest.mark.parametrize(
    ("redistribute", "mode", "ok"),
    [("yes", "hosted", True), ("no", "hosted", False), ("review", "hosted", False),
     ("no", "self_host", True), ("review", "self_host", True)],
)  # fmt: skip
def test_can_serve(redistribute, mode, ok):
    lic = Licence(name="n", url="u", redistribute=redistribute, attribution="a")
    assert can_serve(lic, mode) is ok


def test_settings_defaults_and_env():
    s = Settings.from_env({})
    assert s.mode == "self_host" and s.data_dir == Path("data") and s.sql_max_rows == 10_000
    s = Settings.from_env({
        "STATMESH_MODE": "hosted", "STATMESH_DATA_DIR": "/d", "STATMESH_DISABLE": "a, b,,",
        "STATMESH_SQL_TIMEOUT_S": "1.5", "STATMESH_PYTHON_SANDBOX": "1",
        "STATMESH_CONNECTORS_DIR": "/c", "STATMESH_CONTACT_EMAIL": "x@y.z",
    })  # fmt: skip
    assert s.mode == "hosted" and s.disabled == {"a", "b"} and s.sql_timeout_s == 1.5
    assert s.python_sandbox and s.connectors_dir == Path("/c") and s.contact_email == "x@y.z"


def test_settings_bad_mode():
    with pytest.raises(ValueError):
        Settings.from_env({"STATMESH_MODE": "cloud"})


HOSTED_DEFAULTS = {
    "ondemand": False, "cache_max_age_s": 300, "share_max_bytes": 262_144, "share_ttl_days": 90,
}  # fmt: skip


def test_m2_settings_self_host_defaults():
    s = Settings.from_env({})
    assert (s.duckdb_memory_limit, s.ondemand, s.cors_origins, s.cache_max_age_s) == ("2GB", True, (), 0)  # fmt: skip
    assert (s.shares_enabled, s.share_max_bytes, s.share_ttl_days) == (True, 512_000, 0)
    assert s.export_max_rows == 5_000_000


def test_m2_settings_hosted_defaults_and_overrides():
    s = Settings.from_env({"STATMESH_MODE": "hosted"})
    assert {k: getattr(s, k) for k in HOSTED_DEFAULTS} == HOSTED_DEFAULTS
    assert s.shares_enabled and s.export_max_rows == 5_000_000
    s = Settings.from_env({
        "STATMESH_MODE": "hosted", "STATMESH_ONDEMAND": "yes", "STATMESH_CACHE_MAX_AGE": "0",
        "STATMESH_SHARE_MAX_BYTES": "100", "STATMESH_SHARE_TTL_DAYS": "0",
        "STATMESH_SHARES": "0", "STATMESH_DUCKDB_MEMORY": "512MB",
        "STATMESH_CORS_ORIGINS": "https://a.io, http://b:3000,,", "STATMESH_EXPORT_MAX_ROWS": "9",
    })  # fmt: skip
    assert s.ondemand and s.cache_max_age_s == 0 and s.share_max_bytes == 100
    assert s.share_ttl_days == 0 and not s.shares_enabled and s.duckdb_memory_limit == "512MB"
    assert s.cors_origins == ("https://a.io", "http://b:3000") and s.export_max_rows == 9
    assert not Settings.from_env({"STATMESH_ONDEMAND": "false"}).ondemand


@pytest.mark.parametrize(
    ("env", "msg"),
    [({"STATMESH_DUCKDB_MEMORY": "lots"}, "STATMESH_DUCKDB_MEMORY"),
     ({"STATMESH_CACHE_MAX_AGE": "-1"}, "STATMESH_CACHE_MAX_AGE"),
     ({"STATMESH_SHARE_TTL_DAYS": "-5"}, "STATMESH_SHARE_TTL_DAYS"),
     ({"STATMESH_SHARE_MAX_BYTES": "0"}, "STATMESH_SHARE_MAX_BYTES"),
     ({"STATMESH_EXPORT_MAX_ROWS": "0"}, "STATMESH_EXPORT_MAX_ROWS"),
     ({"STATMESH_CORS_ORIGINS": "example.com"}, "STATMESH_CORS_ORIGINS"),
     ({"STATMESH_CORS_ORIGINS": "https://a.io/path"}, "STATMESH_CORS_ORIGINS"),
     ({"STATMESH_ONDEMAND": "maybe"}, "STATMESH_ONDEMAND"),
     ({"STATMESH_SHARES": "2"}, "STATMESH_SHARES")],
)  # fmt: skip
def test_m2_settings_reject_bad_values(env, msg):
    with pytest.raises(ValueError, match=msg):
        Settings.from_env(env).validate()
