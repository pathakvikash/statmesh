"""GET /series/{id}/observations.csv: streamed CSV of one series (all geos of a 3-part key)."""

from __future__ import annotations

import logging
import re
from datetime import date

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse, StreamingResponse

from statmesh import service
from statmesh.export import csv_chunks

router = APIRouter()
_FILTER = Query(default=[])
CODES = {"not_found": 404, "forbidden": 403, "rate_limited": 429}


def _latin1(s: str) -> str:  # header values must survive latin-1 and hold no line breaks
    return " ".join(s.split()).encode("latin-1", "replace").decode("latin-1")


@router.get("/series/{series_id:path}/observations.csv")
def observations_csv(series_id: str, start: date | None = None, end: date | None = None,
                     geo: str | None = None, filter: list[str] = _FILTER):  # fmt: skip
    """Streams `text/csv` (CRLF, header row). At most STATMESH_EXPORT_MAX_ROWS rows are sent and the
    stream just ends there, so the cap is announced up front in `X-Statmesh-Row-Cap`; compare it
    with the row count you received. Errors use the observations JSON body with 403/404/429 (Retry-After)."""
    r = service.stream_observations(
        series_id, start=start, end=end, geo=geo, filters=service.parse_filters(filter)
    )
    if not hasattr(r, "batches"):
        h = {"Retry-After": str(int(r.retry_after) + 1)} if r.retry_after else None
        return JSONResponse(r.model_dump(mode="json"), CODES.get(r.status, 200), h)
    name = re.sub(r"[^\w.-]+", "_", series_id, flags=re.ASCII)  # header values must be latin-1
    cap = service._engine().settings.export_max_rows
    headers = {
        "Content-Disposition": f'attachment; filename="{name}.csv"',
        "X-Statmesh-Row-Cap": str(cap),
    }
    if r.citation:
        headers["X-Statmesh-Attribution"] = _latin1(r.citation.attribution)

    def counted():
        n = 0
        for b in r.batches:
            n += len(b)
            yield b
        if n >= cap:  # headers are gone by now; the log is the only trailer
            logging.getLogger(__name__).warning("export of %s hit the %d-row cap", series_id, cap)

    return StreamingResponse(
        csv_chunks(r.columns, counted()), media_type="text/csv; charset=utf-8", headers=headers
    )
