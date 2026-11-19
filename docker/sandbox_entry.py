"""Runs the code read from stdin; open matplotlib figures are appended as marker lines of base64 PNG."""

import base64
import io
import sys

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

try:
    exec(compile(sys.stdin.read(), "<run_python>", "exec"), {"__name__": "__main__"})  # noqa: S102 - running untrusted code is the sandbox's purpose (it is the container boundary)
finally:
    sys.stdout.flush()
    for n in plt.get_fignums()[:4]:
        buf = io.BytesIO()
        plt.figure(n).savefig(buf, format="png", dpi=80)
        print("\n@@PNG@@" + base64.b64encode(buf.getvalue()).decode(), flush=True)
