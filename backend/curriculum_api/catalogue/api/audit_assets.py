"""Read-only programme audit status and material HTTP responses."""


def programme_audit_status(
    request, *, JsonResponse, PROGRAMME_AUDIT_SCHEMA, PROGRAMME_AUDIT_TABLE, table_exists,
):
    exists = table_exists()
    return JsonResponse({
        'schema': PROGRAMME_AUDIT_SCHEMA,
        'table': PROGRAMME_AUDIT_TABLE,
        'ready': exists,
    })


def programme_audit_materials(
    request, *, JsonResponse, UI_MATERIAL_TABLES, clean, fetch_ui_material,
):
    programme = clean(request.GET.get('programme')).upper()
    account = getattr(request, 'login_account', None)
    if account is not None and clean(getattr(account, 'role', '')).lower() == 'learner':
        return JsonResponse({'error': 'Programme audit materials are not available to learners.'}, status=403)
    keys = [
        key for key, definition in UI_MATERIAL_TABLES.items()
        if not programme or definition['programme'] == programme
    ]
    results = [fetch_ui_material(key, include_results=False) for key in keys]
    return JsonResponse({'programme': programme, 'count': len(results), 'results': results})


def programme_audit_material(
    request, material_key, *, JsonResponse, ProgrammeAuditNotFound, clean, fetch_ui_material,
):
    account = getattr(request, 'login_account', None)
    if account is not None and clean(getattr(account, 'role', '')).lower() == 'learner':
        return JsonResponse({'error': 'Programme audit materials are not available to learners.'}, status=403)
    try:
        material = fetch_ui_material(material_key, include_results=True)
    except ProgrammeAuditNotFound as exc:
        return JsonResponse({'error': str(exc)}, status=404)
    if not material['ready']:
        return JsonResponse({'error': 'Material table is not available.'}, status=404)
    return JsonResponse(material)
