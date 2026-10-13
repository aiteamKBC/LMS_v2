"""Staff evidence verification only; learners cannot self-award bonuses."""
from datetime import date
import json
import os
from django.conf import settings
from django.db import DatabaseError
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from login.sessions import authenticate_request
from login.permissions import auth_gate_enabled
from .segment_rules import RewardError


@csrf_exempt
def verify_bonus(request):
    def response(data,status=200):
        result=JsonResponse(data,status=status)
        result["Cache-Control"]="private, no-store"
        return result
    if request.method!="POST":
        return response({"code":"method_not_allowed"},405)
    if (getattr(settings,"KBC_SHARED_REWARDS_READY",False) is not True or not auth_gate_enabled()
        or os.environ.get("API_REQUIRE_AUTH","1").lower() in {"0","false","no","off"}):
        return response({"code":"rewards_not_enabled"},503)
    account=authenticate_request(request)
    if account is None or not account.is_active:
        return response({"code":"unauthenticated"},401)
    if account.role not in {"staff","admin"}:
        return response({"code":"staff_only"},403)
    if request.headers.get("X-Requested-With")!="XMLHttpRequest":
        return response({"code":"csrf"},403)
    try:
        if len(request.body)>8192:
            raise RewardError("request_too_large",413)
        data=json.loads(request.body)
        fields={"learnerId","opportunity","verificationId","evidenceReference","completionDate","confirmedWinner"}
        if not isinstance(data,dict) or set(data)-fields:
            raise RewardError("invalid_request",400)
        if type(data.get("confirmedWinner",False)) is not bool:
            raise RewardError("invalid_winner_confirmation",400)
        from learner_api.models import EnrolmentUser,LearnerProfile
        from learner_api.learner_detail import build_learner_detail
        from .shared_rewards import verify_bonus as service,PILOT_MODULE
        learner_id=data.get("learnerId")
        if not isinstance(learner_id,str) or not learner_id.isdecimal():
            raise RewardError("invalid_learner_id",400)
        source=EnrolmentUser.all_learners.filter(pk=int(learner_id)).first()
        if source is None or not LearnerProfile.objects.filter(
            enrolment_id=source.pk,lifecycle_status="active").exists():
            raise RewardError("learner_not_eligible",404)
        detail=build_learner_detail(source,source.pk,compact=True)
        if any(isinstance(detail.get(k),dict) and detail[k].get("blocked") is True
               for k in ("learningAccess","accessGate")):
            raise RewardError("learning_access_blocked",403)
        if not any(c.get("moduleId")==PILOT_MODULE for c in detail.get("components",[])):
            raise RewardError("module_not_assigned",404)
        result=service(learner_id=str(source.pk),learner_name=str(getattr(source,"username","") or ""),
            module_id=PILOT_MODULE,opportunity=data.get("opportunity"),verification_id=data.get("verificationId"),
            evidence_reference=data.get("evidenceReference"),completion_date=date.fromisoformat(data.get("completionDate","")),
            staff_id=str(account.pk),confirmed_winner=data.get("confirmedWinner",False),
            learner_kind=str(source.learner_type or "").lower())
        return response(result)
    except RewardError as exc:
        return response({"code":exc.code},exc.status)
    except (ValueError,TypeError,UnicodeDecodeError):
        return response({"code":"invalid_request"},400)
    except DatabaseError:
        return response({"code":"lms_unavailable"},503)
