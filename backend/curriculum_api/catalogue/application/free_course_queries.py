"""Coordinate canonical Free Course reads and document construction.

``reads`` supplies catalogue selectors, quiz selectors, table checks and a
snapshot context manager. The caller binds the concrete adapter; application
code imports neither Django nor infrastructure. Test doubles need no writers.
"""
from contextlib import nullcontext
from ..domain.free_course_integrity import FreeCourseNotFound, normalize_course_id, _decode_components
from .free_course_documents import _catalogue_from_rows, _assemble_course_document
from curriculum_api.catalogue.domain.free_course_revisions import CATALOGUE_REVISION_PREFIX
from curriculum_api.catalogue.domain.free_course_revisions import _revision

def catalogue_document(*, reads, read_snapshot=True):
    reads.require_catalogue_tables()
    with (reads._read_snapshot() if read_snapshot else nullcontext()):
        return _catalogue_from_rows(reads.free_course_catalogue.courses())


def catalogue_with_documents(*, reads):
    """The catalogue plus every course's document, read in one snapshot.

    ``revision`` stays the catalogue revision (writers send it back as
    expectedRevision). ``documentsRevision`` also covers every course revision,
    so it is the one to use as the ETag: a 304 must not hide a course edit.
    """
    reads._require_course_tables()
    with reads._read_snapshot():
        rows = reads.free_course_catalogue.courses()
        document = _catalogue_from_rows(rows)
        documents = course_documents(rows, reads=reads)
    document["documents"] = documents
    document["documentsRevision"] = _revision(CATALOGUE_REVISION_PREFIX, {
        "version": 1,
        "catalogue": document["revision"],
        "courses": [item["revision"] for item in documents],
    })
    return document


def course_document(course_id, *, reads, read_snapshot=True):
    course_id = normalize_course_id(course_id)
    reads._require_course_tables()
    with (reads._read_snapshot() if read_snapshot else nullcontext()):
        courses = reads.free_course_catalogue.courses(course_ids=[course_id])
        if not courses:
            raise FreeCourseNotFound(course_id)
        course = courses[0]
        weeks = reads.free_course_catalogue.weeks(course_ids=[course_id])
        week_ids = [str(row.get("id") or "") for row in weeks]
        components = reads.free_course_catalogue.components(week_ids=week_ids)

        decoded = _decode_components(components)
        quiz_ids = set(decoded[1])
        quiz_links = reads._quiz_link_rows(course_id, quiz_ids)
        quiz_ids.update(str(link.get("quiz_id") or "") for link in quiz_links if link.get("quiz_id"))
        quizzes = reads._quiz_rows(quiz_ids)
        return _assemble_course_document(course, weeks, components, decoded, quiz_links, quizzes)


def course_documents(course_rows, *, reads):
    """Build the course document for every row in ``course_rows`` in one pass.

    Same output as calling ``course_document`` once per course, but the weeks,
    components, quiz links and quizzes are each read once for all the courses
    instead of once per course. Call inside the caller's read snapshot.
    """
    course_rows = list(course_rows)
    if not course_rows:
        return []
    reads._require_course_tables()
    course_ids = [str(row.get("id") or "") for row in course_rows]
    weeks = reads.free_course_catalogue.weeks(course_ids=course_ids)
    components = reads.free_course_catalogue.components(
        week_ids=[str(row.get("id") or "") for row in weeks]
    )
    weeks_by_course = {}
    for week in weeks:
        weeks_by_course.setdefault(str(week.get("course_id") or ""), []).append(week)
    week_course = {str(week.get("id") or ""): str(week.get("course_id") or "") for week in weeks}
    components_by_course = {}
    for component in components:
        owner = week_course.get(str(component.get("free_module_id") or ""))
        components_by_course.setdefault(owner, []).append(component)

    decoded_by_course = {
        course_id: _decode_components(components_by_course.get(course_id, []))
        for course_id in course_ids
    }
    all_quiz_ids = set().union(*(decoded[1] for decoded in decoded_by_course.values()))
    all_links = reads._quiz_link_rows_for_courses(course_ids, all_quiz_ids)
    all_quiz_ids.update(str(link.get("quiz_id") or "") for link in all_links if link.get("quiz_id"))
    all_quizzes = reads._quiz_rows(all_quiz_ids)

    documents = []
    for course in course_rows:
        course_id = str(course.get("id") or "")
        decoded = decoded_by_course[course_id]
        referenced = decoded[1]
        # The same rows reads._quiz_link_rows(course_id, referenced) would return.
        quiz_links = [
            link for link in all_links
            if str(link.get("free_course_id") or "") == course_id
            or (str(link.get("quiz_id") or "") in referenced and link.get("free_course_week_id") is not None)
        ]
        quiz_ids = set(referenced)
        quiz_ids.update(str(link.get("quiz_id") or "") for link in quiz_links if link.get("quiz_id"))
        quizzes = [row for row in all_quizzes if str(row.get("id") or "") in quiz_ids]
        documents.append(_assemble_course_document(
            course, weeks_by_course.get(course_id, []), components_by_course.get(course_id, []),
            decoded, quiz_links, quizzes,
        ))
    return documents
