from __future__ import annotations

import subprocess
import sys

from statmesh.core.connector import connector_dir
from statmesh.settings import Settings


def test_cmd(args) -> int:
    """Run the connector folder's pytest suite; --live runs only @pytest.mark.live tests."""
    tests = connector_dir(args.id, Settings.from_env()) / "tests"
    mode = ["-m", "live", "--force-enable-socket"] if args.live else ["-m", "not live"]
    sock = [] if args.live else ["--disable-socket", "--allow-unix-socket"]
    cmd = [
        sys.executable,
        "-m",
        "pytest",
        "-q",
        "--import-mode=importlib",
        *mode,
        *sock,
        str(tests),
    ]
    return subprocess.run(cmd, check=False).returncode
