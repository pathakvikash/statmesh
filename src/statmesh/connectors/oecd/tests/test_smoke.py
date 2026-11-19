import pytest


@pytest.mark.live
@pytest.mark.enable_socket
def test_live_doctor():
    from statmesh.doctor import check

    r = check("oecd")
    if r.status == "skip":
        pytest.skip(r.detail)
    assert r.status == "ok", r.detail
