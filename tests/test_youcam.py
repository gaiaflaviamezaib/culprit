"""Checks the YouCam client against a fake server shaped like the documented V2 API.

No real requests are made, so these tests cost no API units.
"""

import asyncio
import json
import unittest
from unittest import mock

import httpx

from app import config, youcam

UPLOAD_URL = "https://upload.example.com/put-here"


class FakeYouCam:
    """Answers the four calls of the skin analysis flow and records what it received."""

    def __init__(self, task_error=None):
        self.calls = []
        self.uploaded = None
        self.task_body = None
        self.polls = 0
        self.task_error = task_error

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.calls.append((request.method, str(request.url)))
        url = str(request.url)
        if url.startswith(UPLOAD_URL):
            self.uploaded = request.content
            return httpx.Response(200)
        assert request.headers["Authorization"] == "Bearer sk-test"
        if request.method == "POST" and url == f"{youcam.BASE_URL}/file":
            body = json.loads(request.content)
            f = body["files"][0]
            return httpx.Response(200, json={"status": 200, "data": {"files": [{
                "file_name": f["file_name"], "content_type": f["content_type"], "file_id": "file-123",
                "requests": [{"method": "PUT", "url": UPLOAD_URL,
                              "headers": {"Content-Type": f["content_type"], "Content-Length": str(f["file_size"])}}],
            }]}})
        if request.method == "POST" and url == f"{youcam.BASE_URL}/task/skin-analysis":
            self.task_body = json.loads(request.content)
            return httpx.Response(200, json={"status": 200, "data": {"task_id": "task-9"}})
        if request.method == "GET" and url == f"{youcam.BASE_URL}/task/skin-analysis/task-9":
            self.polls += 1
            if self.polls < 2:
                return httpx.Response(200, json={"status": 200, "data": {"task_status": "running"}})
            if self.task_error:
                return httpx.Response(200, json={"status": 200, "data": {"task_status": "error", "error": self.task_error}})
            output = [{"type": c, "ui_score": 70 + i, "raw_score": 70.5 + i, "mask_urls": []}
                      for i, c in enumerate(youcam.CONCERNS)]
            return httpx.Response(200, json={"status": 200, "data": {
                "task_status": "success", "results": {"output": output}}})
        return httpx.Response(404, json={"error": "unexpected call"})


class YouCamClientTests(unittest.TestCase):
    def run_flow(self, fake):
        with mock.patch.object(config, "MOCK", False), \
             mock.patch.object(config, "YOUCAM_API_KEY", "sk-test"), \
             mock.patch.object(youcam, "_transport", httpx.MockTransport(fake)), \
             mock.patch("asyncio.sleep", new=mock.AsyncMock()):
            return asyncio.run(youcam.analyze_skin(b"fake-jpeg-bytes", "image/jpeg", "selfie.jpg"))

    def test_full_flow_matches_docs(self):
        fake = FakeYouCam()
        result = self.run_flow(fake)
        self.assertEqual(fake.uploaded, b"fake-jpeg-bytes")
        self.assertEqual(fake.task_body["src_file_id"], "file-123")
        # SD and HD concerns cannot be mixed, and every action must be a documented SD name.
        sd = {"wrinkle", "droopy_upper_eyelid", "droopy_lower_eyelid", "firmness", "acne", "moisture",
              "eye_bag", "dark_circle_v2", "age_spot", "radiance", "redness", "oiliness", "pore",
              "texture", "tear_trough", "skin_type"}
        self.assertTrue(set(fake.task_body["dst_actions"]) <= sd)
        self.assertEqual(result["scores"]["redness"], 70)
        self.assertEqual(set(result["scores"]), set(youcam.CONCERNS))
        self.assertFalse(result["mock"])

    def test_photo_error_is_readable(self):
        fake = FakeYouCam(task_error="error_src_face_too_small")
        with self.assertRaises(youcam.YouCamError) as ctx:
            self.run_flow(fake)
        self.assertIn("Face is too small", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
