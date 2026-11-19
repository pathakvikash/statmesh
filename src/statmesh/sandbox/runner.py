"""Opt-in sandboxed Python: one `docker run` per call, code on stdin, nothing written to the host.

Trade-off: the process that calls this needs access to the Docker socket (root-equivalent on the
host). Enable only on a self-hosted machine you control; `hosted` mode never enables it.
"""

from __future__ import annotations

import base64
import re
import subprocess
import threading
import uuid
from pathlib import Path

from pydantic import BaseModel

IMAGE = "statmesh-sandbox"
WALL_S = 30
MAX_OUT = 1_000_000
_PNG = re.compile(r"\n@@PNG@@([A-Za-z0-9+/=]+)\n?")


class PythonResult(BaseModel):
    stdout: str
    stderr: str
    images: list[str] = []  # base64 PNG
    timed_out: bool = False
    truncated: bool = False


def docker_cmd(obs_dir: Path, name: str, image: str = IMAGE) -> list[str]:
    return [
        "docker", "run", "--rm", "-i", "--name", name,
        "--network", "none", "--read-only", "--cap-drop", "ALL",
        "--security-opt", "no-new-privileges", "--pids-limit", "128",
        "--memory", "512m", "--memory-swap", "512m", "--cpus", "1", "--user", "nobody",
        "--tmpfs", "/tmp:rw,noexec,nosuid,size=64m",
        "-e", "HOME=/tmp", "-e", "MPLCONFIGDIR=/tmp",
        "-v", f"{obs_dir.resolve()}:/data/obs:ro",
        image,
    ]  # fmt: skip


def _kill(name: str) -> None:
    subprocess.run(["docker", "kill", name], capture_output=True, timeout=10, check=False)


def run_python(
    code: str, obs_dir: Path, *, timeout: float = WALL_S, max_out: int = MAX_OUT,
    popen=subprocess.Popen, kill=_kill, image: str = IMAGE,
) -> PythonResult:  # fmt: skip
    name = f"statmesh-sbx-{uuid.uuid4().hex[:12]}"
    try:
        p = popen(docker_cmd(obs_dir, name, image), stdin=subprocess.PIPE,
                  stdout=subprocess.PIPE, stderr=subprocess.PIPE)  # fmt: skip
    except FileNotFoundError:
        raise ValueError("docker is not installed or not on PATH") from None
    bufs: dict[str, bytes] = {}
    over = threading.Event()

    def drain(key: str, f) -> None:
        # Stop reading at the cap and kill the container: no unbounded host memory.
        data = f.read(max_out + 1)
        bufs[key] = data[:max_out]
        if len(data) > max_out:
            over.set()
            kill(name)

    ts = [threading.Thread(target=drain, args=(k, f), daemon=True)
          for k, f in (("out", p.stdout), ("err", p.stderr))]  # fmt: skip
    for t in ts:
        t.start()
    try:
        p.stdin.write(code.encode())
        p.stdin.close()
    except OSError:
        pass  # container already exited; its output explains why
    timed_out = False
    try:
        p.wait(timeout)
    except subprocess.TimeoutExpired:
        timed_out = True
        kill(name)
        p.kill()
        p.wait()
    for t in ts:
        t.join(5)
    out = bufs.get("out", b"").decode(errors="replace")
    images = []
    for b64 in _PNG.findall(out):
        try:
            png = base64.b64decode(b64, validate=True)
        except ValueError:
            continue
        if png.startswith(b"\x89PNG"):
            images.append(b64)
    return PythonResult(
        stdout=_PNG.sub("", out), stderr=bufs.get("err", b"").decode(errors="replace"),
        images=images, timed_out=timed_out, truncated=over.is_set(),
    )  # fmt: skip
