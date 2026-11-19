# Image for the opt-in run_python sandbox. Build: docker build -t statmesh-sandbox -f docker/sandbox.Dockerfile docker
FROM python:3.12-slim
RUN pip install --no-cache-dir pandas pyarrow duckdb matplotlib numpy scipy
COPY sandbox_entry.py /opt/entry.py
USER nobody
ENTRYPOINT ["python", "-I", "/opt/entry.py"]
