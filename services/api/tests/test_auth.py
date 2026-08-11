from atarang_api.repository import token_hash, token_matches


def test_capability_token_is_stored_as_argon2id():
    token = "a" * 64
    encoded = token_hash(token)
    assert encoded.startswith("$argon2id$")
    assert token not in encoded
    assert token_matches(encoded, token)
    assert not token_matches(encoded, "b" * 64)
    assert not token_matches("damaged", token)
