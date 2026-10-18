"""Per-call identity and attribution for an authenticated MCP request.

Inside the block the request carries the token's account as
``request.login_account`` -- so ``login.sessions.authenticate_request`` and every
permission decorator short-circuit to it -- and curriculum history records the
account as the actor with source ``mcp:<client name>``. Everything is undone in
``finally``, exceptions included: worker threads are reused, and a leaked actor
would credit one person's save to the next request's caller.

The source is set with ``versioning.set_source`` rather than ``versioning.source``:
the latter only accepts the fixed ``SOURCES`` labels and would silently drop
``mcp:*``. The revision column is free text (varchar 64); the label is capped at
32 characters like every request source.
"""
import re
from contextlib import contextmanager

from curriculum_api import versioning

SOURCE_PREFIX = "mcp:"


def source_label(client_name):
    name = re.sub(r"[^A-Za-z0-9 ._-]", "", client_name or "").strip() or "client"
    return f"{SOURCE_PREFIX}{name}"[:32]


@contextmanager
def mcp_call(request, account, client):
    previous_source = versioning.current_source()
    request.login_account = account
    versioning.set_actor(account)
    versioning.set_source(source_label(client.client_name))
    try:
        yield
    finally:
        versioning.set_actor(None)
        versioning.set_source(previous_source)
        request.login_account = None
