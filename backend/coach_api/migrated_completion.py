"""LMS-local completion rules for Aptem continuation reviews.

No operation in this module writes Aptem reviews, historical signature caches,
or native curriculum review instances.
"""
import base64
import binascii
import hashlib
import re
from html import escape
from io import BytesIO
from PIL import Image as PillowImage, UnidentifiedImageError

from django.db import transaction
from django.utils import timezone

from .migrated_reviews import validate_answers
from .models import ImportedReviewInstance, MigratedReviewDocument, MigratedReviewSignature


ROLES = ("advisor", "participant", "employer", "referrer")
# Audited against active native MCM/PR templates and their frozen instances.
FAMILY_REQUIRED_ROLES = {"MCM": ("advisor", "participant"), "PR": ("advisor", "participant", "employer")}
# This family previously used PR rules; separating template selection preserves them.
FAMILY_REQUIRED_ROLES["PR_SKILLS_RADAR"] = FAMILY_REQUIRED_ROLES["PR"]
IMAGE_PATTERN = re.compile(r"^data:image/(?:png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$", re.I)


def requirements_for_family(family):
    if family not in FAMILY_REQUIRED_ROLES:
        raise ValueError("Unsupported migrated review family.")
    return {role: role in FAMILY_REQUIRED_ROLES[family] for role in ROLES}


def required_roles(overlay):
    rules = overlay.signature_requirements or {}
    if not rules:
        rules = requirements_for_family(overlay.migrated_template.review_family)
    return tuple(role for role in ROLES if rules.get(role) is True)


def signature_states(overlay):
    rows = {row.role: row for row in overlay.migrated_signatures.all()}
    required = set(required_roles(overlay))
    return {role: {
        "required": role in required,
        "signed": role in rows,
        "signedBy": rows[role].signer_email if role in rows else None,
        "signedName": rows[role].signer_name if role in rows else None,
        "signedAt": rows[role].signed_at.isoformat() if role in rows else None,
        "signature": rows[role].signature if role in rows else None,
    } for role in ROLES}


def submit(overlay, answers):
    if overlay.status != ImportedReviewInstance.STATUS_IN_PROGRESS:
        raise ValueError("Only an in-progress migrated review can be submitted.")
    validate_answers(overlay.template_snapshot, answers, completing=True)
    overlay.signature_requirements = requirements_for_family(overlay.migrated_template.review_family)
    overlay.answers = answers
    overlay.status = ImportedReviewInstance.STATUS_AWAITING_SIGNATURE
    overlay.save(update_fields=["answers", "signature_requirements", "status", "updated_at"])


def validate_signature_image(signature):
    if not isinstance(signature, str) or len(signature) > 500_000:
        raise ValueError("A PNG, JPEG or WebP signature image is required.")
    match = IMAGE_PATTERN.fullmatch(signature)
    if not match:
        raise ValueError("A PNG, JPEG or WebP signature image is required.")
    try:
        decoded = base64.b64decode(match.group(1), validate=True)
    except binascii.Error:
        raise ValueError("The signature image is invalid.") from None
    if not decoded or len(decoded) > 350_000:
        raise ValueError("The signature image is empty or too large.")
    try:
        with PillowImage.open(BytesIO(decoded)) as image:
            if image.format not in {"PNG", "JPEG", "WEBP"} or image.width > 4000 or image.height > 4000:
                raise ValueError("The signature image format or dimensions are invalid.")
            image.verify()
    except (UnidentifiedImageError, OSError, SyntaxError):
        raise ValueError("The signature image is invalid.") from None
    return signature


def sign(overlay, role, *, account, signature):
    if overlay.status != ImportedReviewInstance.STATUS_AWAITING_SIGNATURE:
        raise ValueError("Only a submitted migrated review can be signed.")
    if role not in required_roles(overlay):
        raise ValueError("This signature role is not required for this review.")
    if overlay.migrated_signatures.filter(role=role).exists():
        raise ValueError("This role has already signed the review.")
    signature = validate_signature_image(signature)
    name = str(account.display_name or "").strip()
    if not name:
        raise ValueError("The signed-in account needs a display name before signing.")
    return MigratedReviewSignature.objects.create(
        overlay=overlay, role=role, signer_account_id=account.pk,
        signer_name=name, signer_email=account.email or "",
        signature=signature, signed_at=timezone.now(),
    )


def complete(overlay):
    if overlay.status != ImportedReviewInstance.STATUS_AWAITING_SIGNATURE:
        raise ValueError("Only a review awaiting signatures can be completed.")
    validate_answers(overlay.template_snapshot, overlay.answers, completing=True)
    signed = set(overlay.migrated_signatures.values_list("role", flat=True))
    if set(required_roles(overlay)) - signed:
        raise ValueError("All required signatures must be saved before completion.")
    overlay.status = ImportedReviewInstance.STATUS_COMPLETED
    overlay.completed_at = timezone.now()
    overlay.save(update_fields=["status", "completed_at", "updated_at"])


def _visible_fields(snapshot, answers):
    """Yield frozen fields in section order, omitting hidden conditional branches."""
    def walk(field):
        yield field
        branch = "ifTrue" if answers.get(field["key"]) == "yes" else "ifFalse" if answers.get(field["key"]) == "no" else None
        for child in field.get(branch, []) if branch else []:
            yield from walk(child)
    for section in snapshot["sections"]:
        yield section, [item for field in section["fields"] for item in walk(field)]


def build_pdf(overlay, *, learner_name, learner_email, programme, scheduled_date, coach_name):
    """Render only frozen definition, saved answers/signatures and LMS metadata."""
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.platypus import Image, Paragraph, SimpleDocTemplate, Spacer

    if overlay.status != ImportedReviewInstance.STATUS_COMPLETED or not overlay.completed_at:
        raise ValueError("The migrated review must be completed before PDF generation.")
    validate_answers(overlay.template_snapshot, overlay.answers, completing=True)
    signatures = {row.role: row for row in overlay.migrated_signatures.all()}
    if set(required_roles(overlay)) - set(signatures):
        raise ValueError("Required signatures are missing.")
    buffer = BytesIO()
    styles = getSampleStyleSheet()
    story = []
    def line(label, value):
        story.append(Paragraph(f"<b>{escape(label)}:</b> {escape(str(value or ''))}", styles["Normal"]))
        story.append(Spacer(1, 7))
    story.append(Paragraph("LMS Generated Migrated Review", styles["Title"]))
    story.append(Spacer(1, 12))
    line("Source", "Aptem imported review; completed in LMS")
    line("Review", overlay.template_snapshot.get("name", ""))
    # These rules were frozen on submission; PDF output never consults a live
    # template whose metadata may subsequently be edited or deactivated.
    line("Family", "PR" if overlay.signature_requirements.get("employer") else "MCM")
    line("Learner", learner_name)
    line("Learner email", learner_email)
    line("Programme", programme)
    line("Coach", coach_name)
    line("Scheduled", scheduled_date)
    line("Completed", overlay.completed_at.isoformat())
    for section, fields in _visible_fields(overlay.template_snapshot, overlay.answers):
        story.append(Spacer(1, 10))
        story.append(Paragraph(escape(str(section.get("title") or "Section")), styles["Heading2"]))
        for field in fields:
            key = field["key"]
            if key in overlay.answers:
                line(str(field.get("title") or key), overlay.answers[key])
    story.append(Paragraph("LMS signatures", styles["Heading2"]))
    for role in required_roles(overlay):
        row = signatures[role]
        line(role.title(), f"{row.signer_name} — {row.signed_at.isoformat()}")
        match = IMAGE_PATTERN.fullmatch(row.signature)
        if not match:
            raise ValueError("A saved signature image is missing.")
        image = Image(BytesIO(base64.b64decode(match.group(1), validate=True)))
        image.drawWidth, image.drawHeight = 120, 50
        story.append(image)
    SimpleDocTemplate(buffer, pagesize=A4).build(story)
    return buffer.getvalue()


def ensure_document(overlay, **context):
    """Caller holds the overlay row lock; failed generation leaves no document."""
    existing = MigratedReviewDocument.objects.filter(overlay=overlay).first()
    if existing:
        return existing
    content = build_pdf(overlay, **context)
    with transaction.atomic():
        return MigratedReviewDocument.objects.create(
            overlay=overlay, pdf_bytes=content, sha256=hashlib.sha256(content).hexdigest(),
        )
