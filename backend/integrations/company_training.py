"""Company scoped allocations for the explicitly labelled APM demo modules."""
from django.db import transaction
from django.http import JsonResponse
from django.views.decorators.http import require_GET, require_POST
from .models import ExternalPersonLink, DepartmentMapping, CompanyTrainingRule, CompanyTrainingAllocation
from .permissions import integration_access
from .views import _connection, _in_actor_tenant, _body

MODULES = [
    {"id": "demo-m1", "name": "Professional Practice & Foundations", "plannedHours": 150, "ksbs": 12},
    {"id": "demo-m2", "name": "Business Cases & Stakeholders", "plannedHours": 200, "ksbs": 15},
    {"id": "demo-m3", "name": "Project Planning & Delivery", "plannedHours": 250, "ksbs": 18},
    {"id": "demo-m4", "name": "Governance & Professional Portfolio", "plannedHours": 250, "ksbs": 17},
]


def checked_connection(request, connection_id):
    connection = _connection(connection_id)
    return connection if connection and _in_actor_tenant(request, connection) else None


def apply_rules(connection):
    for rule in CompanyTrainingRule.objects.filter(connection_id=connection.id):
        people = ExternalPersonLink.objects.filter(connection_id=connection.id, department_external_id="" if rule.department_id == "__unassigned__" else rule.department_id)
        for person in people:
            for module_id in rule.module_ids:
                CompanyTrainingAllocation.objects.get_or_create(
                    person_link_id=person.id, module_id=module_id,
                    defaults={"connection_id": connection.id},
                )


@require_GET
@integration_access(allow_employer=True)
def training(request, connection_id):
    connection = checked_connection(request, connection_id)
    if not connection:
        return JsonResponse({"error": "Connection not found."}, status=404)
    people = list(ExternalPersonLink.objects.filter(connection_id=connection.id).order_by('external_employee_id'))
    allocations = list(CompanyTrainingAllocation.objects.filter(connection_id=connection.id).values('person_link_id', 'module_id', 'demo_metrics'))
    rules = list(CompanyTrainingRule.objects.filter(connection_id=connection.id).values('id', 'department_id', 'module_ids'))
    return JsonResponse({"modules": MODULES, "departments": [
        {"id": d.external_department_id, "name": d.external_name}
        for d in DepartmentMapping.objects.filter(connection_id=connection.id)
    ] + ([{"id": "__unassigned__", "name": "No department assigned"}] if any(not p.department_external_id for p in people) else []), "employees": [{"id": str(p.id), "name": p.display_name or 'Employee',
        "departmentId": p.department_external_id, "department": p.department_name,
        "allocations": [{"moduleId": a['module_id'], "metrics": a['demo_metrics']}
                        for a in allocations if a['person_link_id'] == p.id]} for p in people],
        "rules": [{"id": str(r['id']), "departmentId": r['department_id'], "moduleIds": r['module_ids']} for r in rules]})


@require_POST
@integration_access(allow_employer=False, allow_hr_employer=True)
def save_rule(request, connection_id):
    connection = checked_connection(request, connection_id)
    if not connection:
        return JsonResponse({"error": "Connection not found."}, status=404)
    body = _body(request)
    department = str(body.get('departmentId') or '')
    modules = body.get('moduleIds')
    if not isinstance(modules, list) or not modules or any(m not in [v['id'] for v in MODULES] for m in modules):
        return JsonResponse({"error": "Select valid demo modules."}, status=400)
    unassigned = department == '__unassigned__' and ExternalPersonLink.objects.filter(connection_id=connection.id, department_external_id='').exists()
    if not unassigned and not DepartmentMapping.objects.filter(connection_id=connection.id, external_department_id=department).exists():
        return JsonResponse({"error": "Select a department in this company."}, status=400)
    if body.get('confirmed') is not True:
        return JsonResponse({"error": "HR confirmation is required."}, status=400)
    with transaction.atomic():
        CompanyTrainingRule.objects.update_or_create(connection_id=connection.id, department_id=department,
            defaults={"module_ids": list(dict.fromkeys(modules)), "confirmed_by": request.integration_actor.id})
        apply_rules(connection)
    return JsonResponse({"ok": True})
