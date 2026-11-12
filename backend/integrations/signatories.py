from __future__ import annotations

from django.db import DatabaseError
from django.db.models import Q
from django.utils import timezone

from .models import IntegrationTenant, ManagerSignatoryGrant


def employer_can_sign_progress_review(account) -> bool:
    """Require an explicit grant once the employer is connected to Breathe.

    Existing employers without an integration tenant keep the established LMS
    signing flow. Once a tenant is connected, the Breathe reporting line is only
    a suggestion; a current LMS grant is required for legally relevant signing.
    """
    if account is None or getattr(account, "role", None) != "employer":
        return True
    try:
        tenant_ids = list(IntegrationTenant.objects.filter(
            employer_id=account.subject_id,
            active=True,
        ).values_list("id", flat=True))
        if not tenant_ids:
            return True
        now = timezone.now()
        return ManagerSignatoryGrant.objects.filter(
            tenant_id__in=tenant_ids,
            login_account_id=account.id,
            can_sign=True,
        ).filter(Q(starts_at__isnull=True) | Q(starts_at__lte=now)).filter(Q(ends_at__isnull=True) | Q(ends_at__gte=now)).exists()
    except DatabaseError:
        # This opt-in integration helper must not grant permission on a failed
        # lookup. It is deliberately not part of the existing employer flow.
        return False
