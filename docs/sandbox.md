# Sandboxed Python (opt-in)

`STATMESH_PYTHON_SANDBOX=1` adds `POST /python` and the MCP tool `run_python`. Each call runs the
submitted code in one throwaway Docker container. It is off by default.

## Read this before turning it on

1. Enabling it requires giving the API process the Docker socket. That is root-equivalent on the
   host: anyone who can make the API run arbitrary `docker` commands owns the machine.
2. Turn it on only on a single-operator machine where every user who can reach `/python` or the MCP
   `run_python` tool is trusted. Never turn it on for an instance reachable from the internet or a
   shared network. There is no authentication on the API.
3. The container limits (no network, read-only data mount, 30 s, 512 MB, 128 pids) restrict the
   submitted code. They are not a defence against a container escape or against misuse of the
   socket itself.
4. It is disabled in `STATMESH_MODE=hosted` whatever the flag says: the route and the tool are not
   registered.
5. The default `docker-compose.yml` does not mount the socket. Enabling it means adding the mount
   yourself (below). Rootless Docker or Podman is the recommended way to reduce the blast radius.

## What a call does

`docker run --rm -i` with `--network none`, `--read-only`, `--cap-drop ALL`,
`--security-opt no-new-privileges`, `--pids-limit 128`, `--memory 512m` (no swap), `--cpus 1`,
`--user nobody`, a 64 MB `noexec` tmpfs at `/tmp`, and the Parquet observations mounted read-only
at `/data/obs`. Code goes in on stdin. Wall clock is 30 s, then the container is killed. Output is
capped at 1 MB per stream (`truncated: true`); the container is killed at the cap. Matplotlib
figures come back as base64 PNGs in `images`. Pandas, pyarrow, duckdb, matplotlib, numpy and scipy
are in the image.

Build the image once:

```sh
docker build -t statmesh-sandbox -f docker/sandbox.Dockerfile docker
```

Result fields: `stdout`, `stderr`, `images`, `timed_out`, `truncated`.

## Enabling it

The simple way is to run the API on the host, where `docker` is already available:

```sh
STATMESH_PYTHON_SANDBOX=1 uv run --env-file .env statmesh serve
```

With docker compose you would add the socket to the `api` service yourself:

```yaml
services:
  api:
    environment:
      STATMESH_PYTHON_SANDBOX: "1"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
```

Two things make that route unreliable as shipped: the `statmesh` image has no `docker` CLI, and the
`-v <data dir>/obs:/data/obs` bind is resolved by the host's daemon, so it points at a host path.
Inside the container that path is `/data/obs`, which on the host is not your data folder unless you
mount the same path. Not tested; run on the host instead.

## Tested and not tested

`tests/sandbox/test_runner.py` checks the generated `docker run` arguments, the output cap, the
timeout kill, and the route and tool registration, using a fake process. One test,
`test_real_docker`, is marked `live` and skipped without Docker. It has not been run against a real
Docker daemon, so nothing here has shown on a real container that the network is cut, the mount is
read-only or a loop is killed. At most four figures are returned per call.
