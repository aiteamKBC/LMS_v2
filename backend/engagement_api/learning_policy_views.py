"""Authenticated settings in the existing Engagement > Points & Rules workspace."""
import json
from django.db import connections, DatabaseError
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from login.sessions import authenticate_request
from .permissions import require_staff
from .learning_policy import at, publish, DEFAULTS, ACTIVITY_TYPES
from .segment_rules import RewardError

@csrf_exempt
@require_staff
def settings_view(request):
    response = None
    try:
        account = authenticate_request(request)
        if not account.is_active:
            return JsonResponse({"error":"Sign in again."},status=401)
        if request.method == "GET":
            with connections["default"].cursor() as cursor:
                current = at(cursor)
                cursor.execute('SELECT id,effective_at,settings FROM "Engagement".learning_reward_policies ORDER BY id DESC LIMIT 20')
                history = [{"id":r[0],"effectiveAt":r[1].isoformat(),
                    "settings":json.loads(r[2]) if isinstance(r[2],str) else r[2]} for r in cursor.fetchall()]
            response = JsonResponse({"policy": {"id":current["id"],"effectiveAt":current["effectiveAt"].isoformat(),
                "settings":current["settings"]} if current else None,
                "defaults":DEFAULTS,"activityTypes":ACTIVITY_TYPES,"history":history})
        elif request.method == "POST":
            if request.headers.get("X-Requested-With") != "XMLHttpRequest":
                return JsonResponse({"error":"Missing request security header."},status=403)
            if len(request.body)>8192:
                raise RewardError("request_too_large",413)
            body = json.loads(request.body)
            if not isinstance(body,dict) or set(body)!={"expectedId","settings"} or (
                    body["expectedId"] is not None and type(body["expectedId"]) is not int):
                raise RewardError("invalid_request",400)
            response = JsonResponse({"policy":publish(body["settings"],account.pk,body["expectedId"])})
        else:
            response = JsonResponse({"error":"Method not allowed."},status=405)
    except RewardError as exc:
        response = JsonResponse({"error":exc.code.replace("_"," "),"code":exc.code},status=exc.status)
    except (ValueError,TypeError,UnicodeDecodeError):
        response = JsonResponse({"error":"Invalid settings."},status=400)
    except DatabaseError:
        response = JsonResponse({"error":"Settings could not be loaded or saved. Please retry."},status=503)
    response["Cache-Control"]="private, no-store"
    return response
