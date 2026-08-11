import re
from urllib.parse import parse_qs, urlsplit


VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
ALLOWED_HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"}


def normalize_youtube_url(value: str) -> tuple[str, str]:
    try:
        parsed = urlsplit(value.strip())
    except ValueError as error:
        raise ValueError("invalid_youtube_url") from error
    host = (parsed.hostname or "").lower().rstrip(".")
    if parsed.scheme != "https" or host not in ALLOWED_HOSTS or parsed.username or parsed.password or parsed.port not in (None, 443):
        raise ValueError("invalid_youtube_url")
    if host == "youtu.be":
        video_id = parsed.path.removeprefix("/").split("/", 1)[0]
    elif parsed.path == "/watch":
        video_id = parse_qs(parsed.query, keep_blank_values=True).get("v", [""])[0]
    else:
        raise ValueError("invalid_youtube_url")
    if not VIDEO_ID.fullmatch(video_id):
        raise ValueError("invalid_youtube_url")
    return video_id, f"https://www.youtube.com/watch?v={video_id}"


def youtube_source_key(video_id: str) -> str:
    if not VIDEO_ID.fullmatch(video_id):
        raise ValueError("invalid_youtube_url")
    return f"youtube:{video_id}:mp3-v1"
