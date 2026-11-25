"""Canonical Free Course create/update/delete and clone use cases.

Storage, document reads and effects are supplied at the API composition boundary.
"""
from decimal import Decimal
from uuid import uuid4
from ..domain.free_course_authoring import (
    MutationError, _clean, _integer, _decimal, _expected, _check_revision,
    _client_id, _normalise_component, _normalise_week, _course_values,
    _validate_shape, request_digest, validate_idempotency_key, _replay,
    MAX_WEEKS, MAX_COMPONENTS, MAX_COMPONENTS_PER_WEEK,
)

def _new_id(prefix):
    return f"{prefix}-{uuid4().hex.upper()}"


def _catalogue_revision(rows=None, *, documents, storage):
    return documents.catalogue_revision(rows if rows is not None else storage.catalogue_rows())


def create_course(payload, *, staff_id, idempotency_key, storage, documents, store_cover, queue_saved_videos, clock, quote_etag):
    if not isinstance(payload, dict):
        raise MutationError("validation_error", "Request body must be an object.")
    expected = _expected(payload)
    key = validate_idempotency_key(idempotency_key)
    digest = request_digest(payload)
    raw_weeks = payload.get("weeks")
    _validate_shape(raw_weeks)

    storage.require_mode("canonical")
    with storage.atomic():
        storage._purge_expired_idempotency()
        existing_ledger = storage._ledger_row(staff_id, key, lock=True)
        if existing_ledger:
            return _replay(existing_ledger, digest)
        storage.require_mode("canonical")
        with storage.session() as session:
            claimed = session.claim_create(staff_id, key, digest)
        if not claimed:
            return _replay(storage._ledger_row(staff_id, key, lock=True), digest)

        storage._catalogue_lock()
        storage.require_mode("canonical")
        courses = storage._course_rows(lock=True)
        _check_revision(expected, _catalogue_revision(courses, documents=documents, storage=storage), scope="catalogue")

        course_id = _new_id("FREECOURSE")
        course = _course_values(payload.get("course"))
        course["cover_image_url"] = store_cover(course_id, course["cover_image_url"])
        client_map = {"courses": {}, "weeks": {}, "components": {}}
        seen_clients = set()
        course_client = _client_id(payload.get("clientId"), seen_clients, "course clientId")
        client_map["courses"][course_client] = course_id
        now = clock()
        with storage.session() as session:
            session.insert_course(course_id, course, courses, now)
            component_count = 0
            total_otjh = Decimal("0")
            for week_index, raw_week in enumerate(raw_weeks):
                week = _normalise_week(raw_week, index=week_index)
                week_client = _client_id(raw_week.get("clientId"), seen_clients, "week clientId")
                week_id = _new_id("FREEWEEK")
                client_map["weeks"][week_client] = week_id
                components = raw_week.get("components", [])
                week_total = sum((_decimal(item.get("expectedOtjh"), label="expectedOtjh") for item in components), Decimal("0"))
                session.insert_week(week_id, course_id, week, components, week_total, now)
                for component_index, raw_component in enumerate(components):
                    values = _normalise_component(raw_component, index=component_index)
                    component_client = _client_id(raw_component.get("clientId"), seen_clients, "component clientId")
                    component_id = _new_id("FREECOMP")
                    client_map["components"][component_client] = component_id
                    session.insert_component(component_id, week_id, values, now)
                component_count += len(components)
                total_otjh += week_total
            session.set_course_totals(raw_weeks, component_count, total_otjh, now, course_id)

        document = documents.course_document(course_id, read_snapshot=False)
        document["clientIdMap"] = client_map
        queue_saved_videos(course_id, [], document)
        etag = quote_etag(document["revision"])
        location = f"/curriculum_api/curriculum/free-courses/{course_id}/authoring/"
        with storage.session() as session:
            session.complete_create(course_id, document, etag, location, claimed)
        return {"replayed": False, "status": 201, "body": document, "etag": etag, "location": location}


def update_course(course_id, payload, *, storage, documents, store_cover, queue_saved_videos, clock):
    if not isinstance(payload, dict):
        raise MutationError("validation_error", "Request body must be an object.")
    expected = _expected(payload)
    storage.require_mode("canonical")
    with storage.atomic():
        storage._catalogue_lock()
        storage.require_mode("canonical")
        course, weeks, components = storage._tree(course_id, lock=True)
        current_document = documents.course_document(course_id, read_snapshot=False)
        _check_revision(expected, current_document["revision"], scope="course")
        if current_document["integrity"]["status"] == "blocked":
            raise MutationError("free_course_integrity_blocked", "Resolve blocking Free Course integrity issues before saving.", status=409,
                                issues=current_document["integrity"]["issues"])

        week_by_id = {row["id"]: row for row in weeks}
        component_by_id = {row["id"]: row for row in components}
        deleted_weeks = {_clean(value, maximum=128) for value in payload.get("deletedWeekIds", [])}
        deleted_components = {_clean(value, maximum=128) for value in payload.get("deletedComponentIds", [])}
        if not deleted_weeks.issubset(week_by_id):
            raise MutationError("cross_course_id", "A deleted week does not belong to this course.", status=409)
        if not deleted_components.issubset(component_by_id):
            raise MutationError("cross_course_id", "A deleted component does not belong to this course.", status=409)

        if deleted_weeks or deleted_components:
            # Archive content in place. Assignments, completions and quizzes keep
            # their original identities; a new component never inherits history.
            for week_id in deleted_weeks:
                remaining = [row["id"] for row in components if row["free_module_id"] == week_id and row["id"] not in deleted_components]
                if remaining:
                    raise MutationError("week_not_empty", "Delete or move no components before deleting a week.", status=409,
                                        freeCourseWeekId=week_id)

        raw_weeks = payload.get("weeks", [])
        if not isinstance(raw_weeks, list):
            raise MutationError("validation_error", "weeks must be a list.")
        if len(weeks) - len(deleted_weeks) + sum(1 for row in raw_weeks if not row.get("freeCourseWeekId")) > MAX_WEEKS:
            raise MutationError("limit_exceeded", "A course can contain at most 100 weeks.")
        seen_ids, seen_clients = set(), set()
        client_id_map = {"course": {}, "weeks": {}, "components": {}}
        now = clock()
        with storage.session() as session:
            course_patch = payload.get("course") or {}
            if course_patch:
                merged = {
                    "courseName": course_patch.get("courseName", course["course_name"]),
                    "description": course_patch.get("description", course.get("description")),
                    "coverImageUrl": course_patch.get("coverImageUrl", course.get("cover_image_url")),
                    "courseType": course_patch.get("courseType", course.get("course_type")),
                    "isForSale": course_patch.get("isForSale", course.get("is_for_sale")),
                    "price": course_patch.get("price", course.get("price")),
                }
                values = _course_values(merged)
                values["cover_image_url"] = store_cover(course_id, values["cover_image_url"])
                session.update_row("free_courses", course_id, course, values)
                if "displayOrder" in course_patch:
                    catalogue_expected = _expected(payload, "expectedCatalogueRevision")
                    all_courses = storage._course_rows(lock=True)
                    _check_revision(catalogue_expected, _catalogue_revision(all_courses, documents=documents, storage=storage), scope="catalogue")
                    ordered = [row["id"] for row in all_courses if row["id"] != course_id]
                    target = min(_integer(course_patch["displayOrder"], minimum=0, label="displayOrder"), len(ordered))
                    ordered.insert(target, course_id)
                    for order, ident in enumerate(ordered):
                        session.set_course_order(order, now, ident)

            for index, raw_week in enumerate(raw_weeks):
                week_id = _clean(raw_week.get("freeCourseWeekId"), maximum=128)
                if week_id:
                    if week_id in seen_ids:
                        raise MutationError("duplicate_id", "A week id appears more than once.")
                    seen_ids.add(week_id)
                    existing_week = week_by_id.get(week_id)
                    if not existing_week or week_id in deleted_weeks:
                        raise MutationError("cross_course_id", "A week does not belong to this course.", status=409)
                    week_values = _normalise_week(raw_week, index=index, existing=existing_week)
                    session.update_row("free_course_weeks", week_id, existing_week, week_values)
                else:
                    client_id = _client_id(raw_week.get("clientId"), seen_clients, "week clientId")
                    week_id = _new_id("FREEWEEK")
                    client_id_map["weeks"][client_id] = week_id
                    week_values = _normalise_week(raw_week, index=index)
                    session.insert_empty_week(week_id, course_id, week_values, now)

                raw_components = raw_week.get("components", [])
                if not isinstance(raw_components, list) or len(raw_components) > MAX_COMPONENTS_PER_WEEK:
                    raise MutationError("limit_exceeded", "A week can contain at most 100 components.")
                if week_values["status"] == "active" and not raw_components and not any(
                    row["free_module_id"] == week_id and row["id"] not in deleted_components for row in components
                ):
                    raise MutationError("active_week_empty", "Active weeks must contain at least one component.")
                for component_index, raw_component in enumerate(raw_components):
                    component_id = _clean(raw_component.get("id"), maximum=128)
                    if component_id:
                        if component_id in seen_ids:
                            raise MutationError("duplicate_id", "An id appears more than once.")
                        seen_ids.add(component_id)
                        existing_component = component_by_id.get(component_id)
                        if not existing_component or component_id in deleted_components:
                            raise MutationError("cross_course_id", "A component does not belong to this course.", status=409)
                        if existing_component["free_module_id"] != week_id:
                            raise MutationError("component_move_forbidden", "Existing components cannot move between Free Weeks.", status=409)
                        values = _normalise_component(raw_component, index=component_index, existing=existing_component)
                        session.update_row("free_programme_components", component_id, existing_component, values)
                    else:
                        client_id = _client_id(raw_component.get("clientId"), seen_clients, "component clientId")
                        component_id = _new_id("FREECOMP")
                        values = _normalise_component(raw_component, index=component_index)
                        session.insert_added_component(component_id, week_id, values, now)
                        client_id_map["components"][client_id] = component_id

            if deleted_components:
                session.archive_components(now, deleted_components)
            if deleted_weeks:
                session.archive_weeks(now, deleted_weeks)

            session.refresh_week_totals(now, course_id)
            session.refresh_course_totals(now, course_id)
            week_count, component_count, active_nonempty, active_empty = session.structure_counts(course_id)
            if not week_count or not active_nonempty:
                raise MutationError("validation_error", "A course needs at least one active, non-empty week.")
            if active_empty:
                raise MutationError("active_week_empty", "Active weeks must contain at least one component.")
            if component_count > MAX_COMPONENTS:
                raise MutationError("limit_exceeded", "A course can contain at most 500 components.")
            duplicate_order = session.duplicate_order(course_id)
            if duplicate_order:
                raise MutationError("duplicate_display_order", "Week and component displayOrder values must be unique.")

        result = documents.course_document(course_id, read_snapshot=False)
        result["clientIdMap"] = client_id_map
        queue_saved_videos(course_id, components, result, payload.get('importVideoComponentIds', []))
        return result


def delete_course(course_id, payload, *, storage, documents):
    expected = _expected(payload if isinstance(payload, dict) else {})
    storage.require_mode("canonical")
    with storage.atomic():
        storage._catalogue_lock()
        storage.require_mode("canonical")
        # Permanent course deletion must also protect history of archived content.
        _course, weeks, components = storage._tree(course_id, lock=True, include_deleted=True)
        current = documents.course_document(course_id, read_snapshot=False)
        _check_revision(expected, current["revision"], scope="course")
        counts = storage._dependency_counts(course_id, [row["id"] for row in weeks], [row["id"] for row in components])
        linked = []
        for row in components:
            settings, _issue = documents._decode_settings(row.get("settings_json") or {})
            if isinstance(settings, dict) and str(settings.get("linkedQuizId") or "").strip():
                linked.append(row["id"])
        if any(counts.values()) or linked:
            raise MutationError("dependent_records", "This Free Course has assignments, progress or quiz history and cannot be deleted.", status=409,
                                dependencies={**counts, "linkedComponents": linked})
        with storage.session() as session:
            session.delete_components(weeks)
            session.delete_weeks(course_id)
            session.delete_course(course_id)
        return {"deleted": True, "courseId": course_id, "catalogueRevision": _catalogue_revision(documents=documents, storage=storage)}


def clone_normal_module(payload, *, staff_id, idempotency_key, read_structure, create):
    """Clone a normal Module into new canonical rows; never move its source."""
    if not isinstance(payload, dict):
        raise MutationError("validation_error", "Request body must be an object.")
    if str(payload.get("mode") or "clone").strip().lower() != "clone":
        raise MutationError("clone_only", "Normal Curriculum content can only be cloned into Free Courses.", status=409)
    module_id = _clean(payload.get("moduleCatalogueId"), maximum=128, required=True, label="moduleCatalogueId")

    structure = read_structure(module_id)
    if not structure:
        raise MutationError("module_not_found", "Module not found.", status=404)
    weeks = []
    for week_index, week in enumerate(structure.get("weekStructure") or []):
        week_client = f"week:{week_index}:{week.get('id') or week_index}"
        components = []
        for component_index, component in enumerate(week.get("components") or []):
            settings = dict(component.get("settings") or {}) if isinstance(component.get("settings"), dict) else {}
            components.append({
                "clientId": f"component:{week_index}:{component_index}:{component.get('id') or component_index}",
                "type": component.get("type"),
                "title": component.get("title") or "Untitled activity",
                "description": component.get("description") or "",
                "expectedOtjh": component.get("expectedOtjh") or 0,
                "points": component.get("points") or 0,
                "reflectionRequired": bool(component.get("reflectionRequired")),
                "workplaceEvidenceRequired": bool(component.get("workplaceEvidenceRequired")),
                "tutorValidationRequired": bool(component.get("tutorValidationRequired")),
                "displayOrder": component_index,
                "settings": settings,
            })
        weeks.append({
            "clientId": week_client,
            "legacyCopiedFromWeekId": week.get("id") or None,
            "weekNumber": week.get("weekNumber") or week_index + 1,
            "title": week.get("title") or f"Week {week_index + 1}",
            "summary": week.get("summary") or "",
            "learningOutcomes": week.get("learningOutcomes") or [],
            "status": "active",
            "displayOrder": week_index,
            "components": components,
        })
    if not weeks:
        raise MutationError("module_empty", "The selected Module has no weeks to clone.", status=409)
    create_payload = {
        "expectedRevision": payload.get("expectedRevision"),
        "clientId": payload.get("clientId") or f"module:{module_id}",
        "course": {
            "courseName": structure.get("title") or "Untitled course",
            "description": structure.get("description") or "",
            "coverImageUrl": structure.get("coverImage") or "",
            "courseType": "free",
        },
        "weeks": weeks,
    }
    return create(
        create_payload,
        staff_id=staff_id,
        idempotency_key=idempotency_key,
    )
