"""Free programme HTTP read/save and conversion contracts.

Explicit capabilities preserve existing caller contracts during migration.
No views, settings or provider runtime is imported here.
"""


def curriculum_free_programme_modules(
    request,
    programme_id,
    *,
    FreeCourseInUse,
    JsonResponse,
    _legacy_free_writer_access,
    cached_curriculum_value,
    clean_str,
    conditional_json_response,
    encode_json_entry,
    get_free_programme_modules_payload,
    json_body,
    json_error,
    logger,
    request_bypasses_curriculum_cache,
    save_free_programme_modules,
):
    programme_id = clean_str(programme_id)
    if request.method == 'GET':
        def build_entry():
            modules = get_free_programme_modules_payload(programme_id)
            # One copy of the list: the client reads `results` (fetchCollection).
            return encode_json_entry({'results': modules, 'count': len(modules)})

        try:
            # Encoded once (JSON + gzip + ETag) and kept until a curriculum
            # write bumps the epoch -- the free-course save does. A browser
            # holding the current catalogue gets a 304 with no body.
            entry = cached_curriculum_value(
                f'free-programme-modules-response:{programme_id}',
                build_entry,
                force=request_bypasses_curriculum_cache(request),
            )
        except Exception:
            logger.exception('Unable to load free programme modules for %s.', programme_id)
            return json_error('Unable to load free programme modules.', status=500)
        return conditional_json_response(request, entry)

    if request.method != 'PATCH':
        return json_error('Method not allowed.', status=405)
    denied = _legacy_free_writer_access(request)
    if denied is not None:
        return denied
    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')
    try:
        modules = save_free_programme_modules(programme_id, payload)
    except FreeCourseInUse as exc:
        return json_error(str(exc), status=409)
    except ValueError as exc:
        return json_error(str(exc), status=400)
    except Exception:
        logger.exception('Unable to save free programme modules for %s.', programme_id)
        return json_error('Unable to save free programme modules.', status=500)
    # One copy of the list: the client reads `modules` (saveFreeProgrammeModules).
    return JsonResponse({'saved': True, 'programmeId': programme_id, 'modules': modules})


def curriculum_free_programme_convert(
    request,
    programme_id,
    *,
    FreeCourseInUse,
    JsonResponse,
    StaleModuleStructureWrite,
    clean_str,
    inject_free_course_into_group,
    json_body,
    json_error,
    logger,
):
    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)
    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')
    try:
        result = inject_free_course_into_group(
            clean_str(payload.get('courseId') or payload.get('course_id')),
            clean_str(payload.get('groupId') or payload.get('group_id')),
            free_programme_id=clean_str(programme_id),
            mode=clean_str(payload.get('mode')) or 'clone',
            start_date=payload.get('startDate'),
            end_date=payload.get('endDate'),
        )
    except StaleModuleStructureWrite as exc:
        # The target group already holds a module with the course's title, and
        # the conversion would have replaced that module's weeks with the
        # course's. Refused, with nothing written.
        return exc.as_response()
    except LookupError as exc:
        return json_error(str(exc) or 'Not found.', status=404)
    except FreeCourseInUse as exc:
        return json_error(str(exc), status=409)
    except ValueError as exc:
        return json_error(str(exc), status=400)
    except Exception:
        logger.exception('Unable to convert free course %s.', clean_str(payload.get('courseId')))
        return json_error('Unable to convert the free course.', status=500)
    return JsonResponse(result, status=201)


def curriculum_free_programme_import_module(
    request,
    programme_id,
    *,
    FreeCourseInUse,
    JsonResponse,
    clean_str,
    convert_module_to_free_course,
    json_body,
    json_error,
    logger,
):
    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)
    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')
    try:
        result = convert_module_to_free_course(
            clean_str(payload.get('moduleCatalogueId') or payload.get('module_catalogue_id') or payload.get('moduleId')),
            free_programme_id=clean_str(programme_id),
            mode=clean_str(payload.get('mode')) or 'clone',
        )
    except LookupError as exc:
        return json_error(str(exc) or 'Module not found.', status=404)
    except FreeCourseInUse as exc:
        return json_error(str(exc), status=409)
    except ValueError as exc:
        return json_error(str(exc), status=400)
    except Exception:
        logger.exception('Unable to convert module %s to a free course.', clean_str(payload.get('moduleCatalogueId')))
        return json_error('Unable to convert the module.', status=500)
    return JsonResponse(result, status=201)
