"""Bounded, lossless compatibility for Graph transcript resource IDs.

Some list responses use MessagePack-CSharp Lz4BlockArray envelopes (extension 98),
while the content endpoint accepts the identical uncompressed MessagePack ID.
Only retry a rejected GET; never change the stored artifact or meeting identity.
"""
import base64
import binascii
from contextlib import contextmanager
from urllib.error import HTTPError
from urllib.parse import quote, unquote, urlsplit, urlunsplit
from urllib.request import Request
import re

import msgpack

MAX_ID_BYTES = 16 * 1024


def _lz4_block(data, expected):
    """Decode one small raw block, checking every read and expansion boundary."""
    if not isinstance(data, bytes) or type(expected) is not int or not 0 < expected <= MAX_ID_BYTES:
        raise ValueError('Invalid resource ID block.')
    output, position = bytearray(), 0

    def length(value):
        nonlocal position
        if value == 15:
            while True:
                if position >= len(data):
                    raise ValueError('Incomplete resource ID length.')
                extra = data[position]
                position += 1
                value += extra
                if value > expected:
                    raise ValueError('Resource ID expansion exceeds its limit.')
                if extra != 255:
                    break
        return value

    while position < len(data):
        token = data[position]
        position += 1
        literals = length(token >> 4)
        if position + literals > len(data) or len(output) + literals > expected:
            raise ValueError('Incomplete resource ID literals.')
        output.extend(data[position:position + literals])
        position += literals
        if position == len(data):
            break
        if position + 2 > len(data):
            raise ValueError('Incomplete resource ID offset.')
        offset = int.from_bytes(data[position:position + 2], 'little')
        position += 2
        if not 0 < offset <= len(output):
            raise ValueError('Invalid resource ID offset.')
        matched = length(token & 15) + 4
        if len(output) + matched > expected:
            raise ValueError('Resource ID expansion exceeds its limit.')
        for _ in range(matched):
            output.append(output[-offset])
    if len(output) != expected:
        raise ValueError('Incomplete resource ID block.')
    return bytes(output)


def uncompressed_resource_id(value):
    """Return the same serialized identity without its compression envelope."""
    if not isinstance(value, str) or not value or len(value) > MAX_ID_BYTES:
        return None
    try:
        encoded = base64.b64decode(value + '=' * (-len(value) % 4), altchars=b'-_', validate=True)
        envelope = msgpack.unpackb(encoded, raw=False, max_array_len=17, max_map_len=16,
                                  max_bin_len=MAX_ID_BYTES, max_str_len=MAX_ID_BYTES, max_ext_len=128)
        if (not isinstance(envelope, list) or len(envelope) < 2
                or not isinstance(envelope[0], msgpack.ExtType) or envelope[0].code != 98):
            return None
        sizes = msgpack.Unpacker(raw=False, max_buffer_size=128)
        sizes.feed(envelope[0].data)
        lengths = list(sizes)
        if (len(lengths) != len(envelope) - 1 or any(type(size) is not int or size <= 0 for size in lengths)
                or sum(lengths) > MAX_ID_BYTES):
            return None
        raw = b''.join(_lz4_block(block, size) for block, size in zip(envelope[1:], lengths))
        identity = msgpack.unpackb(raw, raw=False, max_array_len=64, max_map_len=16,
                                  max_bin_len=MAX_ID_BYTES, max_str_len=MAX_ID_BYTES, max_ext_len=128)
        if not isinstance(identity, list) or not identity:
            return None
        return base64.urlsafe_b64encode(raw).decode('ascii').rstrip('=')
    except (ValueError, TypeError, UnicodeError, binascii.Error, msgpack.UnpackException):
        return None


def normalized_transcript_url(url):
    try:
        parsed = urlsplit(url)
        allowed = (parsed.scheme == 'https' and parsed.hostname == 'graph.microsoft.com'
                   and parsed.port in (None, 443) and not parsed.username
                   and not parsed.password and not parsed.fragment)
    except (TypeError, ValueError):
        return None
    if not allowed:
        return None
    match = re.fullmatch(r'(.*/transcripts/)([^/]+)(/content)', parsed.path)
    if not match:
        return None
    identity = uncompressed_resource_id(unquote(match[2]))
    if not identity:
        return None
    return urlunsplit(parsed._replace(path=match[1] + quote(identity, safe='') + match[3]))


def open_transcript(open_request, request, *, timeout):
    """Use the caller's redirect policy and credentials for at most two GETs."""
    try:
        return open_request(request, timeout=timeout)
    except HTTPError as failure:
        replacement = (normalized_transcript_url(request.full_url)
                       if failure.code == 400 and request.get_method() == 'GET' else None)
        if not replacement:
            raise
        failure.close()
        retry = Request(replacement, headers=dict(request.header_items()), method='GET')
        return open_request(retry, timeout=timeout)


@contextmanager
def transcript_stream(transport, url, *, headers):
    replacement = None
    with transport.stream('GET', url, headers=headers) as response:
        if response.status_code == 400:
            replacement = normalized_transcript_url(url)
        if not replacement:
            yield response
            return
    with transport.stream('GET', replacement, headers=headers) as response:
        yield response

