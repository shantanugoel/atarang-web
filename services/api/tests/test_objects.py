import hashlib
from uuid import uuid4

import pytest

from atarang_api.objects import FilesystemObjectStore


async def chunks(*values: bytes):
    for value in values:
        yield value


@pytest.mark.asyncio
async def test_part_is_only_published_after_length_and_hash_match(tmp_path):
    store = FilesystemObjectStore(str(tmp_path))
    body = b"verified multipart body"
    key, size = await store.write_part(
        uuid4(), 0, chunks(body[:5], body[5:]), len(body), hashlib.sha256(body).hexdigest()
    )
    assert size == len(body)
    with store.open_part(key) as source:
        assert source.read() == body


@pytest.mark.asyncio
async def test_bad_part_leaves_no_published_object(tmp_path):
    store = FilesystemObjectStore(str(tmp_path))
    upload_id = uuid4()
    with pytest.raises(ValueError, match="integrity"):
        await store.write_part(upload_id, 0, chunks(b"bad"), 3, "0" * 64)
    assert not list((tmp_path / "staging" / str(upload_id)).glob("*.part"))


@pytest.mark.asyncio
async def test_stream_honors_inclusive_byte_ranges(tmp_path):
    store = FilesystemObjectStore(str(tmp_path))
    body = b"0123456789"
    key, _ = await store.write_part(
        uuid4(), 0, chunks(body), len(body), hashlib.sha256(body).hexdigest()
    )
    received = b"".join([chunk async for chunk in store.stream(key, start=2, end=6)])
    assert received == b"23456"
    assert await store.size(key) == len(body)
