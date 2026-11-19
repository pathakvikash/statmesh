"""POST /shares and GET /shares/{id}; the logic lives in statmesh.shares."""

from fastapi import APIRouter, HTTPException, Request

from statmesh import service, shares

router = APIRouter()


@router.post("/shares")
async def create_share(request: Request) -> dict:
    settings = service._engine().settings
    try:
        return {"id": shares.create(settings, await request.body())}
    except shares.Disabled:
        raise HTTPException(404, "shares are disabled") from None
    except shares.TooLarge:
        raise HTTPException(413, f"share exceeds {settings.share_max_bytes} bytes") from None


@router.get("/shares/{share_id}")
def get_share(share_id: str) -> dict:
    return shares.get(service._engine().settings, share_id)  # KeyError -> 404
