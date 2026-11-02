"""Client for the YouCam AI Skin Analysis API (V2).

Flow (docs.perfectcorp.com/reference/ai_skin_analysis):
  1. POST /file              -> file_id + pre-signed upload URL
  2. PUT  <upload url>       -> upload the photo bytes
  3. POST /task/skin-analysis with src_file_id + dst_actions
  4. GET  /task/skin-analysis/<task_id> until task_status is success or error

YouCam's ui_score runs 1 to 100 where higher means healthier skin for that concern.
"""

import asyncio
import hashlib

import httpx

from . import config

BASE_URL = "https://yce-api-01.makeupar.com/s2s/v2.0"

# The concerns that matter for spotting a product reaction.
CONCERNS = ["redness", "acne", "texture", "pore", "oiliness", "moisture"]


# Tests swap in a fake transport so the client can be checked without spending API units.
_transport = None

# Readable versions of the photo errors YouCam returns. Failed tasks cost no units.
PHOTO_ERRORS = {
    "error_below_min_image_size": "Photo is too small. Use a photo at least 480 px on the short side.",
    "error_exceed_max_image_size": "Photo is too large.",
    "error_src_face_too_small": "Face is too small. Hold the camera closer so your face fills most of the frame.",
    "error_src_face_out_of_bound": "Face is cut off. Keep your whole face inside the frame.",
    "error_lighting_dark": "Photo is too dark. Try again facing a window or a lamp.",
}


class YouCamError(RuntimeError):
    pass


def _photo_error(payload) -> str | None:
    text = str(payload)
    for code, message in PHOTO_ERRORS.items():
        if code in text:
            return message
    return None


def _find(obj, key):
    """Return the first value stored under `key` anywhere in a nested JSON object."""
    if isinstance(obj, dict):
        if key in obj:
            return obj[key]
        for value in obj.values():
            found = _find(value, key)
            if found is not None:
                return found
    elif isinstance(obj, list):
        for item in obj:
            found = _find(item, key)
            if found is not None:
                return found
    return None


def _check(resp: httpx.Response) -> dict:
    if resp.status_code >= 400:
        friendly = _photo_error(resp.text)
        raise YouCamError(friendly or f"YouCam API error {resp.status_code}: {resp.text[:300]}")
    return resp.json()


async def analyze_skin(image: bytes, content_type: str = "image/jpeg", file_name: str = "selfie.jpg") -> dict:
    """Return {"scores": {concern: ui_score}, "skin_age": int | None, "mock": bool}."""
    if config.MOCK:
        return _mock_scores(image)

    headers = {"Authorization": f"Bearer {config.YOUCAM_API_KEY}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=60, transport=_transport) as client:
        init = _check(await client.post(
            f"{BASE_URL}/file",
            headers=headers,
            json={"files": [{"content_type": content_type, "file_name": file_name, "file_size": len(image)}]},
        ))
        file_id = _find(init, "file_id")
        upload = _find(init, "requests")
        if not file_id or not upload:
            raise YouCamError(f"Unexpected upload response: {str(init)[:300]}")
        upload = upload[0]
        upload_headers = upload.get("headers") or {"Content-Type": content_type}
        upload_headers.setdefault("Content-Length", str(len(image)))
        put = await client.request(upload.get("method", "PUT"), upload["url"], headers=upload_headers, content=image)
        if put.status_code >= 400:
            raise YouCamError(f"Photo upload failed ({put.status_code})")

        task = _check(await client.post(
            f"{BASE_URL}/task/skin-analysis",
            headers=headers,
            json={"src_file_id": file_id, "dst_actions": CONCERNS, "format": "json"},
        ))
        task_id = _find(task, "task_id")
        if not task_id:
            raise YouCamError(f"Unexpected task response: {str(task)[:300]}")

        for _ in range(45):
            await asyncio.sleep(2)
            poll = _check(await client.get(f"{BASE_URL}/task/skin-analysis/{task_id}", headers=headers))
            status = _find(poll, "task_status")
            if status == "success":
                return _parse_result(poll)
            if status == "error":
                raise YouCamError(_photo_error(poll) or f"Skin analysis failed: {str(poll)[:300]}")
        raise YouCamError("Skin analysis timed out")


def _parse_result(poll: dict) -> dict:
    scores = {}
    for item in _find(poll, "output") or []:
        concern = str(item.get("type", "")).removeprefix("hd_")
        if concern in CONCERNS and item.get("ui_score") is not None:
            scores[concern] = int(item["ui_score"])
    if not scores:
        raise YouCamError("No scores in YouCam response")
    return {"scores": scores, "skin_age": _find(poll, "skin_age"), "mock": False}


def _mock_scores(image: bytes) -> dict:
    """Stable fake scores (same photo gives the same result) so the app works without a key."""
    digest = hashlib.sha256(image).digest()
    scores = {c: 62 + digest[i] % 18 for i, c in enumerate(CONCERNS)}
    return {"scores": scores, "skin_age": 20 + digest[10] % 15, "mock": True}
