"""JSON API for enrolment users (no DRF — plain Django views).

Routes (mounted under /learner_api/ in config/urls.py):
    GET  /learner_api/enrolment-users/            -> {count, results:[UserListRow]}
    POST /learner_api/enrolment-users/            -> create; returns the new UserListRow
    GET  /learner_api/enrolment-users/options/    -> canonical dropdown option lists
    GET  /learner_api/enrolment-users/<id>/       -> EnrolmentBoard
    PATCH/PUT /learner_api/enrolment-users/<id>/  -> update flat fields; returns board

CSRF is exempted: this is an internal same-origin dev API reached through the
Vite proxy, with no cookie-based auth.
"""
import json

from django.db import DatabaseError
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt

from .active_users import sync_active_user
from .constants import STATUS_CHOICES, TYPE_CHOICES, PROGRAMME_STATUS_CHOICES
from .mappers import (
    ValidationError,
    to_board,
    to_commercial_row,
    to_list_row,
    write_commercial_fields,
    write_fields,
)
from .models import CommercialUser, EnrolmentUser


def _parse_body(request):
    if not request.body:
        return {}
    try:
        return json.loads(request.body.decode("utf-8"))
    except (ValueError, UnicodeDecodeError) as exc:
        raise ValidationError(f"Invalid JSON body: {exc}")


def _error(message, status):
    return JsonResponse({"error": message}, status=status)


@csrf_exempt
def enrolment_users(request):
    if request.method == "GET":
        try:
            rows = [to_list_row(u) for u in EnrolmentUser.objects.all().order_by("id")]
        except DatabaseError as exc:
            return _error(f"Database error: {exc}", 502)
        return JsonResponse({"count": len(rows), "results": rows})

    if request.method == "POST":
        try:
            payload = _parse_body(request)
            fields = write_fields(payload, require_create=True)
        except ValidationError as exc:
            return _error(str(exc), 400)

        # Stamp who/when enrolled, server-side.
        stamp = timezone.now().strftime("%d/%m/%Y %H:%M:%S")
        fields.setdefault("enrolled_time_and_user", f"{stamp} by Enrolment Officer")

        try:
            user = EnrolmentUser.objects.create(**fields)
        except DatabaseError as exc:
            return _error(f"Database error: {exc}", 502)
        return JsonResponse(to_list_row(user), status=201)

    return _error("Method not allowed.", 405)


@csrf_exempt
def enrolment_user_options(request):
    if request.method != "GET":
        return _error("Method not allowed.", 405)
    return JsonResponse(
        {
            "status": STATUS_CHOICES,
            "type": TYPE_CHOICES,
            "programmeStatus": PROGRAMME_STATUS_CHOICES,
        }
    )


@csrf_exempt
def enrolment_user_detail(request, pk):
    try:
        user = EnrolmentUser.objects.get(pk=pk)
    except EnrolmentUser.DoesNotExist:
        return _error("User not found.", 404)
    except DatabaseError as exc:
        return _error(f"Database error: {exc}", 502)

    if request.method == "GET":
        return JsonResponse(to_board(user))

    if request.method in ("PATCH", "PUT"):
        try:
            payload = _parse_body(request)
            fields = write_fields(payload)
        except ValidationError as exc:
            return _error(str(exc), 400)
        if fields:
            for attr, value in fields.items():
                setattr(user, attr, value)
            try:
                # Only write the flat columns we touched — never the JSON columns.
                user.save(update_fields=list(fields.keys()))
            except DatabaseError as exc:
                return _error(f"Database error: {exc}", 502)
        # Mirror into learner."Active_users" if this learner is now Active.
        sync_active_user(user)
        return JsonResponse(to_board(user))

    return _error("Method not allowed.", 405)


@csrf_exempt
def commercial_users(request):
    if request.method == "GET":
        try:
            rows = [to_commercial_row(u) for u in CommercialUser.objects.all().order_by("id")]
        except DatabaseError as exc:
            return _error(f"Database error: {exc}", 502)
        return JsonResponse({"count": len(rows), "results": rows})

    if request.method == "POST":
        try:
            payload = _parse_body(request)
            fields = write_commercial_fields(payload, require_create=True)
        except ValidationError as exc:
            return _error(str(exc), 400)

        try:
            user = CommercialUser.objects.create(**fields)
        except DatabaseError as exc:
            return _error(f"Database error: {exc}", 502)
        return JsonResponse(to_commercial_row(user), status=201)

    return _error("Method not allowed.", 405)


@csrf_exempt
def commercial_user_detail(request, pk):
    try:
        user = CommercialUser.objects.get(pk=pk)
    except CommercialUser.DoesNotExist:
        return _error("User not found.", 404)
    except DatabaseError as exc:
        return _error(f"Database error: {exc}", 502)

    if request.method == "GET":
        return JsonResponse(to_commercial_row(user))

    if request.method in ("PATCH", "PUT"):
        try:
            payload = _parse_body(request)
            fields = write_commercial_fields(payload)
        except ValidationError as exc:
            return _error(str(exc), 400)
        if fields:
            for attr, value in fields.items():
                setattr(user, attr, value)
            try:
                user.save(update_fields=list(fields.keys()))
            except DatabaseError as exc:
                return _error(f"Database error: {exc}", 502)
        # Mirror into learner."Active_users" if this learner is now Active.
        sync_active_user(user)
        return JsonResponse(to_commercial_row(user))

    return _error("Method not allowed.", 405)
