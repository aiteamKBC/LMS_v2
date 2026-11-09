"""Token minting and hashing for the MCP OAuth tables.

Mirrors ``login.security``: the plaintext exists only in the response that hands
it to the client; the database keeps the SHA-256 hex digest and looks it up by
equality on that digest. A full-entropy token needs no slow KDF (see the design
notes in ``login.security``).
"""
import hashlib
import secrets

#: 48 bytes of entropy, URL-safe (64 characters). Larger than the session token
#: because an access token is presented on every MCP call by a third party.
TOKEN_BYTES = 48


def new_token():
    """Return a fresh high-entropy token. This is the only place it exists in plaintext."""
    return secrets.token_urlsafe(TOKEN_BYTES)


def hash_token(token):
    """SHA-256 hex digest of a token -- the only form ever written to the database."""
    return hashlib.sha256(str(token).encode("utf-8")).hexdigest()
