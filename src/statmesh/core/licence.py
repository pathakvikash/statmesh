from __future__ import annotations

from typing import Literal

from statmesh.core.models import Licence


def can_serve(licence: Licence, mode: Literal["self_host", "hosted"]) -> bool:
    return mode == "self_host" or licence.redistribute == "yes"
