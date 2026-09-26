"""Token counting. Uses tiktoken when installed; otherwise a conservative
character estimate so chunk sizing still works (actual billed tokens always come
from the provider's reported usage, never from this estimate)."""
import math

try:  # optional dependency, added after the server compatibility check
    import tiktoken
    _ENCODING = tiktoken.get_encoding("cl100k_base")
except Exception:  # noqa: BLE001 - absent or unusable: fall back
    _ENCODING = None


def count_tokens(text):
    if not text:
        return 0
    if _ENCODING is not None:
        return len(_ENCODING.encode(text))
    return math.ceil(len(text) / 3.5)


def exact():
    return _ENCODING is not None
