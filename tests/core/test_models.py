from datetime import date

import pytest
import yaml
from pydantic import ValidationError

from statmesh.core.models import (
    FetchRequest,
    Manifest,
    RawChunk,
    make_series_id,
    split_series_id,
)

GOOD = {
    "id": "demo",
    "name": "Demo",
    "kind": "sdmx",
    "licence": {"name": "CC0", "url": "https://x", "redistribute": "yes", "attribution": "Demo"},
}


def test_manifest_good_and_defaults():
    m = Manifest.model_validate(GOOD)
    assert m.auth == "none" and m.cache_ttl_days == 7 and m.rate_limit.per_hour is None


def test_manifest_rate_limit_alias():
    m = Manifest.model_validate({**GOOD, "rate_limit": {"max_downloads_per_hour": 60}})
    assert m.rate_limit.per_hour == 60


def test_manifest_load(tmp_path):
    p = tmp_path / "manifest.yaml"
    p.write_text(yaml.safe_dump(GOOD))
    assert Manifest.load(p).id == "demo"


@pytest.mark.parametrize(
    "patch",
    [
        {"id": "Bad-Id"},  # id pattern
        {"kind": "graphql"},  # unknown kind
        {"licence": None},  # licence is mandatory
        {"auth": "free_key"},  # key_env required
        {"surprise": 1},  # extra keys forbidden
        {"licence": {**GOOD["licence"], "redistribute": "maybe"}},  # enum
        {"refresh": {"schedule": "* * *"}},  # not 5-field cron
    ],
)
def test_manifest_bad(patch):
    data = {**GOOD, **patch}
    if data.get("licence") is None:
        del data["licence"]
    with pytest.raises(ValidationError):
        Manifest.model_validate(data)


def test_manifest_load_rejects_non_mapping(tmp_path):
    p = tmp_path / "m.yaml"
    p.write_text("- a\n")
    with pytest.raises(TypeError):
        Manifest.load(p)


def test_series_id_roundtrip():
    sid = make_series_id("wb", "WDI", "SL.UEM", "IND")
    assert sid == "wb:WDI:SL.UEM:IND"
    assert split_series_id(sid) == ("wb", "WDI", "SL.UEM", "IND")
    assert split_series_id("wb:WDI:SL.UEM") == ("wb", "WDI", "SL.UEM", None)
    assert split_series_id("wb:WDI:X:region:WLD")[3] == "region:WLD"
    assert make_series_id("s", "a:b", "c:d", "IND") == "s:a_b:c_d:IND"
    with pytest.raises(ValueError):
        split_series_id("wb:WDI")


def test_fetch_request_cache_key_stable_and_order_free():
    a = FetchRequest(
        "D", ("a", "b"), ("IND", "USA"), date(2020, 1, 1), filters={"x": "1", "y": "2"}
    )
    b = FetchRequest(
        "D", ("b", "a"), ("USA", "IND"), date(2020, 1, 1), filters={"y": "2", "x": "1"}
    )
    assert a.cache_key() == b.cache_key() and len(a.cache_key()) == 16
    assert a.cache_key() != FetchRequest("D").cache_key()


def test_rawchunk_sha256():
    from datetime import UTC, datetime

    c = RawChunk("s", "d", b"abc", "text/csv", "u", {}, datetime.now(UTC))
    assert c.sha256.startswith("ba7816bf")
