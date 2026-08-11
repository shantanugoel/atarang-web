import pytest

from atarang_api.youtube import normalize_youtube_url, youtube_source_key


@pytest.mark.parametrize(
    "value",
    [
        "https://www.youtube.com/watch?v=Ajxn0PKbv7I",
        "https://youtu.be/Ajxn0PKbv7I?t=10",
        "https://music.youtube.com/watch?v=Ajxn0PKbv7I&feature=share",
    ],
)
def test_normalizes_allowlisted_youtube_urls(value):
    video_id, canonical = normalize_youtube_url(value)
    assert video_id == "Ajxn0PKbv7I"
    assert canonical == "https://www.youtube.com/watch?v=Ajxn0PKbv7I"
    assert youtube_source_key(video_id) == "youtube:Ajxn0PKbv7I:mp3-v1"


@pytest.mark.parametrize(
    "value",
    [
        "http://www.youtube.com/watch?v=Ajxn0PKbv7I",
        "https://youtube.com.evil.test/watch?v=Ajxn0PKbv7I",
        "https://www.youtube.com/embed/Ajxn0PKbv7I",
        "https://user@www.youtube.com/watch?v=Ajxn0PKbv7I",
        "https://127.0.0.1/watch?v=Ajxn0PKbv7I",
        "https://youtu.be/not-valid",
    ],
)
def test_rejects_noncanonical_or_unsafe_urls(value):
    with pytest.raises(ValueError, match="invalid_youtube_url"):
        normalize_youtube_url(value)
