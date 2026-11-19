import base64
import io
import shutil
import subprocess
import threading
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from mcp import Client

from statmesh import service
from statmesh.api.app import create_app
from statmesh.mcp_server import build_server
from statmesh.sandbox.runner import docker_cmd, run_python
from statmesh.settings import Settings

PNG = base64.b64encode(b"\x89PNG\r\n" + b"x" * 8).decode()


class FakeProc:
    def __init__(self, out=b"", err=b"", hang=False):
        self.stdin, self.stdout, self.stderr = io.BytesIO(), io.BytesIO(out), io.BytesIO(err)
        self.hang, self.killed, self._ev = hang, False, threading.Event()

    def wait(self, timeout=None):
        if self.hang and not self.killed and not self._ev.wait(timeout):
            raise subprocess.TimeoutExpired("docker", timeout)

    def kill(self):
        self.killed = True


def fake(**kw):
    p = FakeProc(**kw)
    killed: list[str] = []
    return p, killed, {"popen": lambda cmd, **k: p, "kill": killed.append}


def test_isolation_flags():
    c = docker_cmd(Path("/d/obs"), "n")
    for pair in (("--network", "none"), ("--cap-drop", "ALL"), ("--security-opt", "no-new-privileges"),
                 ("--pids-limit", "128"), ("--memory", "512m"), ("--cpus", "1"),
                 ("--user", "nobody"), ("--tmpfs", "/tmp:rw,noexec,nosuid,size=64m")):  # fmt: skip
        assert c[c.index(pair[0]) + 1] == pair[1]
    assert {"--rm", "--read-only", "-i"} <= set(c)
    assert "/d/obs:/data/obs:ro" in c
    assert not any("-v" == a and "rw" in c[i + 1] for i, a in enumerate(c[:-1]))


def test_ok_with_image():
    _, killed, kw = fake(out=b"hi\n\n@@PNG@@" + PNG.encode() + b"\n")
    r = run_python("print(1)", Path("/d"), **kw)
    assert r.stdout == "hi\n" and r.images == [PNG] and not r.timed_out and not killed


def test_fake_marker_rejected():
    _, _, kw = fake(out=b"\n@@PNG@@bm90YXBuZw==\n")
    assert run_python("x", Path("/d"), **kw).images == []


def test_timeout_kills_container():
    p, killed, kw = fake(hang=True)
    r = run_python("while True: pass", Path("/d"), timeout=0.05, **kw)
    assert r.timed_out and p.killed and len(killed) == 1 and killed[0].startswith("statmesh-sbx-")


def test_output_cap_kills():
    _, killed, kw = fake(out=b"a" * 100)
    r = run_python("x", Path("/d"), max_out=10, **kw)
    assert r.truncated and len(r.stdout) == 10 and killed


def test_code_on_stdin():
    p, _, kw = fake()
    p.stdin.close = lambda: None
    run_python("print(1)", Path("/d"), **kw)
    assert p.stdin.getvalue() == b"print(1)"


def test_docker_missing(monkeypatch):
    def boom(*a, **k):
        raise FileNotFoundError

    with pytest.raises(ValueError, match="docker"):
        run_python("x", Path("/d"), popen=boom)


def _client(tmp_path, **kw):
    service.configure(Settings(data_dir=tmp_path, **kw))
    return TestClient(create_app(), base_url="http://localhost:8000")


def test_disabled_by_default(tmp_path):
    c = _client(tmp_path)
    assert c.post("/python", json={"code": "1"}).status_code == 404


async def _tools(tmp_path, **kw):
    service.configure(Settings(data_dir=tmp_path, **kw))
    async with Client(build_server()) as c:
        return {t.name for t in (await c.list_tools()).tools}


def test_mcp_tool_registration(tmp_path):
    import asyncio

    assert "run_python" not in asyncio.run(_tools(tmp_path))
    assert "run_python" in asyncio.run(_tools(tmp_path, python_sandbox=True))
    assert "run_python" not in asyncio.run(_tools(tmp_path, python_sandbox=True, mode="hosted"))


def test_rest_enabled_routes_to_runner(tmp_path, monkeypatch):
    c = _client(tmp_path, python_sandbox=True)
    seen = {}

    from statmesh.sandbox import PythonResult

    monkeypatch.setattr(
        "statmesh.sandbox.run_python",
        lambda code, d: seen.update(code=code, obs=d) or PythonResult(stdout="o", stderr=""),
    )
    r = c.post("/python", json={"code": "print(1)"})
    assert r.status_code == 200 and r.json()["stdout"] == "o"
    assert seen == {"code": "print(1)", "obs": tmp_path / "obs"}


@pytest.mark.live
@pytest.mark.skipif(not shutil.which("docker"), reason="no docker")
def test_real_docker(tmp_path):
    (tmp_path / "obs").mkdir()
    r = run_python(
        "import socket\n"
        "try: socket.create_connection(('1.1.1.1', 53), 2); print('NET')\n"
        "except OSError: print('nonet')\n"
        "try: open('/data/obs/x', 'w'); print('WROTE')\n"
        "except OSError: print('ro')\n"
        "import matplotlib.pyplot as plt; plt.plot([1, 2])\n",
        tmp_path / "obs",
    )
    assert r.stdout.split() == ["nonet", "ro"] and len(r.images) == 1, r
    assert run_python("while True: pass", tmp_path / "obs", timeout=3).timed_out
