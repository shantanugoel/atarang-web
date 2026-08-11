import secrets
import time
from uuid import UUID


def uuid7() -> UUID:
    """Generate an RFC 9562 UUIDv7 on the Python 3.12 runtime."""
    timestamp_ms = int(time.time() * 1000)
    random_value = int.from_bytes(secrets.token_bytes(10))
    value = (timestamp_ms & ((1 << 48) - 1)) << 80
    value |= 0x7 << 76
    value |= ((random_value >> 64) & 0xFFF) << 64
    value |= 0b10 << 62
    value |= random_value & ((1 << 62) - 1)
    return UUID(int=value)
