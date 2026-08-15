"""The lifecycle the web app drives, with a fake yt-dlp standing in for YouTube."""

import asyncio
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from atarang_acquisition import ephemeral
from atarang_api.config import Settings

KEY = "test-deployment-key-0123456789"
URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
HEADERS = {"X-Atarang-Key": KEY, "Idempotency-Key": "0123456789abcdef"}
BODY = {"source": {"kind": "youtube", "url": URL}, "processingMode": "browser"}

# A yt-dlp that writes the mp3 the real one would and prints the JSON line the
# fetch reads its title out of. Everything after the subprocess is under test.
FAKE = """
import json, sys
out = [a for a in sys.argv if a.endswith("source.%(ext)s")][0]
open(out.replace("%(ext)s", "mp3"), "wb").write(b"ID3fake-audio")
print(json.dumps({"title": "A Song", "uploader": "A Channel"}))
"""


@pytest.fixture
def client(tmp_path: Path, monkeypatch):
    fake = tmp_path / "fake-ytdlp.py"
    fake.write_text(FAKE)
    monkeypatch.setattr(ephemeral.settings, "ytdlp_bin", sys.executable)
    real_exec = asyncio.create_subprocess_exec

    async def exec_with_fake(program, *args, **kwargs):
        return await real_exec(program, str(fake), *args, **kwargs)

    monkeypatch.setattr(asyncio, "create_subprocess_exec", exec_with_fake)
    with TestClient(ephemeral.create_app(Settings(deployment_key=KEY))) as client:
        yield client


def test_fetch_lifecycle(client):
    assert client.get("/api/v1/capabilities").status_code == 401
    assert client.get("/api/v1/capabilities", headers=HEADERS).json()["youtubeEnabled"] is True

    created = client.post("/api/v1/jobs", json=BODY, headers=HEADERS).json()
    auth = {"Authorization": f"Bearer {created['capabilityToken']}"}
    job_id = created["jobId"]

    for _ in range(200):
        job = client.get(f"/api/v1/jobs/{job_id}", headers=auth).json()
        if job["state"] in ("ready", "failed"):
            break
    assert job["state"] == "ready", job.get("errorCode")
    assert job["sourceTitle"] == "A Song"
    assert job["byteLength"] == len(b"ID3fake-audio")

    assert client.get(f"/api/v1/jobs/{job_id}/source").status_code == 401
    assert client.get(f"/api/v1/jobs/{job_id}/source", headers=auth).content == b"ID3fake-audio"

    assert client.delete(f"/api/v1/jobs/{job_id}", headers=auth).json()["state"] == "deleting"
    assert client.get(f"/api/v1/jobs/{job_id}", headers=auth).status_code == 401


def test_rejects_server_separation_and_bad_urls(client):
    server = client.post("/api/v1/jobs", json={**BODY, "processingMode": "server"}, headers=HEADERS)
    assert server.status_code == 403
    assert server.json()["error"]["code"] == "cloud_separation_unavailable"

    bad = client.post(
        "/api/v1/jobs",
        json={"source": {"kind": "youtube", "url": "https://evil.example/watch?v=x"}, "processingMode": "browser"},
        headers=HEADERS,
    )
    assert bad.json()["error"]["code"] == "invalid_youtube_url"
