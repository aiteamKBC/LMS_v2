"""MCP OAuth and write-preview tables -- the ``login`` schema on the enrolment (Neon) database.

DDL: ``sql/2026-10-18_mcp_oauth/01_create.sql``, applied by hand. ``managed = False``
throughout, as for every Neon-backed model in this project.

``mcp_api`` is not one of ``learner_api.routers.EnrolmentRouter``'s app labels, so
these models pin themselves to the enrolment alias (``_EnrolmentModel``) instead of
widening the router. Without that, reads and new-row saves would fall back to
``default``.

Codes and tokens are stored only as ``crypto.hash_token`` digests, like
``login.LoginSession.token_hash``: a read of these tables does not let the reader
act as anyone.
"""
import uuid

from django.db import models

from learner_api.routers import ENROLMENT_DB
from login.models import LoginAccount


class _EnrolmentManager(models.Manager):
    def get_queryset(self):
        return super().get_queryset().using(ENROLMENT_DB)


class _EnrolmentModel(models.Model):
    """Reads and writes go to the enrolment alias unless a caller names another."""

    objects = _EnrolmentManager()

    class Meta:
        abstract = True

    def save(self, *args, using=None, **kwargs):
        super().save(*args, using=using or ENROLMENT_DB, **kwargs)

    def delete(self, using=None, keep_parents=False):
        return super().delete(using=using or ENROLMENT_DB, keep_parents=keep_parents)


class McpOAuthClient(_EnrolmentModel):
    """A dynamically registered connector (RFC 7591) -- login."Mcp_oauth_clients"."""

    id = models.BigAutoField(primary_key=True, db_column="id")
    client_id = models.TextField(db_column="Client_id", unique=True)
    client_name = models.TextField(db_column="Client_name")
    redirect_uris = models.JSONField(db_column="Redirect_uris", default=list)
    created_at = models.DateTimeField(db_column="Created_at", auto_now_add=True)
    disabled_at = models.DateTimeField(db_column="Disabled_at", null=True, blank=True)

    class Meta:
        managed = False
        db_table = 'login"."Mcp_oauth_clients'

    def __str__(self):
        return f"{self.client_name} [{self.client_id}]"


class McpOAuthCode(_EnrolmentModel):
    """A single-use PKCE authorization code -- login."Mcp_oauth_codes"."""

    id = models.BigAutoField(primary_key=True, db_column="id")
    code_hash = models.CharField(db_column="Code_hash", max_length=64, unique=True)
    client = models.ForeignKey(
        McpOAuthClient,
        on_delete=models.DO_NOTHING,
        to_field="client_id",
        db_column="Client_id",
        related_name="codes",
    )
    # related_name="+": no reverse accessor is added to LoginAccount.
    account = models.ForeignKey(
        LoginAccount, on_delete=models.DO_NOTHING, db_column="Account_id", related_name="+"
    )
    code_challenge = models.TextField(db_column="Code_challenge")
    redirect_uri = models.TextField(db_column="Redirect_uri")
    scope = models.TextField(db_column="Scope", blank=True, default="")
    expires_at = models.DateTimeField(db_column="Expires_at")
    used_at = models.DateTimeField(db_column="Used_at", null=True, blank=True)
    created_at = models.DateTimeField(db_column="Created_at", auto_now_add=True)

    class Meta:
        managed = False
        db_table = 'login"."Mcp_oauth_codes'


class McpOAuthToken(_EnrolmentModel):
    """An access token and its refresh token -- login."Mcp_oauth_tokens".

    Refreshing rotates into a new row with the same ``family_id``; presenting an
    already-rotated refresh token revokes the whole family.
    """

    id = models.BigAutoField(primary_key=True, db_column="id")
    access_hash = models.CharField(db_column="Access_hash", max_length=64, unique=True)
    refresh_hash = models.CharField(
        db_column="Refresh_hash", max_length=64, unique=True, null=True, blank=True
    )
    family_id = models.UUIDField(db_column="Family_id")
    client = models.ForeignKey(
        McpOAuthClient,
        on_delete=models.DO_NOTHING,
        to_field="client_id",
        db_column="Client_id",
        related_name="tokens",
    )
    account = models.ForeignKey(
        LoginAccount, on_delete=models.DO_NOTHING, db_column="Account_id", related_name="+"
    )
    scope = models.TextField(db_column="Scope", blank=True, default="")
    expires_at = models.DateTimeField(db_column="Expires_at")
    refresh_expires_at = models.DateTimeField(db_column="Refresh_expires_at", null=True, blank=True)
    revoked_at = models.DateTimeField(db_column="Revoked_at", null=True, blank=True)
    revoked_reason = models.TextField(db_column="Revoked_reason", null=True, blank=True)
    last_used_at = models.DateTimeField(db_column="Last_used_at", null=True, blank=True)
    created_at = models.DateTimeField(db_column="Created_at", auto_now_add=True)

    class Meta:
        managed = False
        db_table = 'login"."Mcp_oauth_tokens'


class McpPendingChange(_EnrolmentModel):
    """A write tool's preview awaiting the user's confirmation -- login."Mcp_pending_changes"."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, db_column="id")
    account = models.ForeignKey(
        LoginAccount, on_delete=models.DO_NOTHING, db_column="Account_id", related_name="+"
    )
    client = models.ForeignKey(
        McpOAuthClient,
        on_delete=models.DO_NOTHING,
        to_field="client_id",
        db_column="Client_id",
        related_name="pending_changes",
    )
    tool = models.TextField(db_column="Tool")
    payload = models.JSONField(db_column="Payload")
    payload_hash = models.CharField(db_column="Payload_hash", max_length=64)
    preview = models.JSONField(db_column="Preview", null=True, blank=True)
    expires_at = models.DateTimeField(db_column="Expires_at")
    applied_at = models.DateTimeField(db_column="Applied_at", null=True, blank=True)
    cancelled_at = models.DateTimeField(db_column="Cancelled_at", null=True, blank=True)
    result = models.JSONField(db_column="Result", null=True, blank=True)
    created_at = models.DateTimeField(db_column="Created_at", auto_now_add=True)

    class Meta:
        managed = False
        db_table = 'login"."Mcp_pending_changes'
