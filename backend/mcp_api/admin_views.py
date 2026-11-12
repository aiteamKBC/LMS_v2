"""Step 11.2: super-admin controls for MCP connections.

Super-admin only (``login.permissions.require_access`` with no other grant listed: super-admin
always passes, everyone else is refused), cookie session with Django CSRF on the POSTs. Not
behind ``MCP_ENABLED``: an administrator must be able to cut connections off whatever the flag.

- ``GET  /oauth/admin/tokens?account_id=<id>`` -- live token families (one per connection):
  account, client, connected, last used, expiry. Hashes are never returned.
- ``POST /oauth/admin/revoke`` ``{"family_id": "..."}`` or ``{"account_id": n}`` -- revoke one
  connection, or every MCP connection of an account (the owner's Step 3 requirement: closes the
  suspend -> restore gap for tokens unused while the account was suspended).
- ``POST /oauth/admin/clients/<client_id>/disable`` -- disable a registered client and revoke its tokens.
"""
import json
import uuid

from django.db import transaction
from django.db.models import Max, Min
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_GET, require_POST

from learner_api.routers import ENROLMENT_DB
from login.permissions import require_access

from .auth import revoke_family
from .events import event
from .models import McpOAuthClient, McpOAuthToken

ADMIN_REASON = "revoked_by_admin"


def _body(request):
    try:
        data = json.loads(request.body or b"{}")
    except ValueError:
        return None
    return data if isinstance(data, dict) else None


@require_GET
@require_access()
def admin_tokens(request):
    now = timezone.now()
    live = McpOAuthToken.objects.filter(revoked_at__isnull=True, refresh_expires_at__gt=now)
    account_id = request.GET.get("account_id")
    if account_id:
        if not account_id.isdigit():
            return JsonResponse({"error": "account_id must be a number."}, status=400)
        live = live.filter(account_id=int(account_id))
    families = (live.values("family_id", "account_id", "account__email", "client_id", "client__client_name")
                .annotate(connected_at=Min("created_at"), last_used_at=Max("last_used_at"),
                          refresh_expires_at=Max("refresh_expires_at"))
                .order_by("-last_used_at"))
    return JsonResponse({"connections": [{
        "family_id": str(row["family_id"]), "account_id": row["account_id"], "account_email": row["account__email"],
        "client_id": row["client_id"], "client_name": row["client__client_name"],
        "connected_at": row["connected_at"], "last_used_at": row["last_used_at"],
        "expires_at": row["refresh_expires_at"],
    } for row in families[:500]]})


@require_POST
@require_access()
def admin_revoke(request):
    data = _body(request)
    if data is None or ("family_id" in data) == ("account_id" in data):
        return JsonResponse({"error": "Send exactly one of family_id or account_id."}, status=400)
    live = McpOAuthToken.objects.filter(revoked_at__isnull=True)
    if "family_id" in data:
        try:
            family_ids = [uuid.UUID(str(data["family_id"]))]
        except ValueError:
            return JsonResponse({"error": "family_id is not valid."}, status=400)
        account_ids = set(live.filter(family_id=family_ids[0]).values_list("account_id", flat=True))
    else:
        if isinstance(data["account_id"], bool) or not isinstance(data["account_id"], int):
            return JsonResponse({"error": "account_id must be a number."}, status=400)
        account_ids = {data["account_id"]}
        family_ids = list(live.filter(account_id=data["account_id"]).values_list("family_id", flat=True).distinct())
    with transaction.atomic(using=ENROLMENT_DB):
        revoked = sum(revoke_family(family_id, ADMIN_REASON) for family_id in family_ids)
    for account_id in account_ids:
        event("mcp.token_revoked", account_id=account_id, reason=ADMIN_REASON, row_count=revoked)
    return JsonResponse({"revoked_connections": len(family_ids), "revoked_tokens": revoked})


@require_POST
@require_access()
def admin_disable_client(request, client_id):
    client = McpOAuthClient.objects.filter(client_id=client_id).first()
    if client is None:
        return JsonResponse({"error": "No such client."}, status=404)
    family_ids = list(McpOAuthToken.objects.filter(client_id=client_id, revoked_at__isnull=True)
                      .values_list("family_id", flat=True).distinct())
    with transaction.atomic(using=ENROLMENT_DB):
        if client.disabled_at is None:
            McpOAuthClient.objects.filter(pk=client.pk).update(disabled_at=timezone.now())
        revoked = sum(revoke_family(family_id, ADMIN_REASON) for family_id in family_ids)
    event("mcp.client_disabled", client=client, row_count=revoked)
    return JsonResponse({"client_id": client_id, "disabled": True, "revoked_tokens": revoked})
