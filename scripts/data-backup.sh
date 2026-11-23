#!/usr/bin/env bash
# Archive a statmesh data dir (tar + zstd, else gzip) with a sha256 sidecar. Never deletes anything.
#   scripts/data-backup.sh DATA_DIR TARGET_DIR
#   scripts/data-backup.sh --verify ARCHIVE
set -euo pipefail

sha() { if command -v sha256sum >/dev/null; then sha256sum "$@"; else shasum -a 256 "$@"; fi; }

if [ "${1:-}" = "--verify" ]; then
  [ $# -eq 2 ] && [ -f "$2" ] || { echo "usage: $0 --verify ARCHIVE" >&2; exit 2; }
  a=$2; [ -f "$a.sha256" ] || { echo "missing $a.sha256" >&2; exit 1; }
  want=$(cut -d' ' -f1 "$a.sha256"); got=$(sha "$a" | cut -d' ' -f1)
  [ "$want" = "$got" ] || { echo "sha256 MISMATCH for $a" >&2; exit 1; }
  tar -tf "$a" >/dev/null || { echo "tar listing failed for $a" >&2; exit 1; }
  echo "ok: $a"; exit 0
fi

[ $# -eq 2 ] || { echo "usage: $0 DATA_DIR TARGET_DIR | --verify ARCHIVE" >&2; exit 2; }
src=${1%/}; dst=${2%/}
[ -d "$src" ] || { echo "no such data dir: $src" >&2; exit 2; }
[ -d "$dst" ] || { echo "no such target dir: $dst" >&2; exit 2; }

# Same lock the ingest code takes (storage.update_manifest: flock on manifest.lock). Held => refuse.
if [ -f "$src/manifest.lock" ]; then
  python3 - "$src/manifest.lock" <<'PY' || { echo "refusing: $src/manifest.lock is held (ingest running?)" >&2; exit 1; }
import fcntl, sys
with open(sys.argv[1], "a+") as f:
    try:
        fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        sys.exit(1)
PY
fi

if command -v zstd >/dev/null; then ext=tar.zst; comp=(--use-compress-program "zstd -T0"); else ext=tar.gz; comp=(-z); fi
out="$dst/$(basename "$src")-$(date -u +%Y%m%dT%H%M%SZ).$ext"
[ ! -e "$out" ] && [ ! -e "$out.sha256" ] || { echo "refusing to overwrite $out" >&2; exit 1; }

tar "${comp[@]}" -cf "$out" -C "$(dirname "$src")" "$(basename "$src")"
(cd "$dst" && sha "$(basename "$out")" > "$(basename "$out").sha256")
"$0" --verify "$out"
echo "$out"
