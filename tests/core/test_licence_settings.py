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
