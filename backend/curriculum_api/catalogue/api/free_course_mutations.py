"""Bind canonical Free Course use cases to the existing Django adapters."""
from django.utils import timezone
from django.utils.http import quote_etag
from ..application import free_course_authoring_mutations as commands
from ..domain.free_course_authoring import MutationError, MAX_REQUEST_BYTES
from ..infrastructure import free_course_commands as storage
from . import free_course_authoring as documents


def _queue_saved_videos(*args):
    from ..infrastructure.free_course_video_jobs import queue_saved_videos
    return queue_saved_videos(*args)


def create_course(payload, *, staff_id, idempotency_key):
    return commands.create_course(
        payload, staff_id=staff_id, idempotency_key=idempotency_key,
        storage=storage, documents=documents, store_cover=storage._stored_cover,
        queue_saved_videos=_queue_saved_videos, clock=timezone.now, quote_etag=quote_etag,
    )


def update_course(course_id, payload):
    return commands.update_course(
        course_id, payload, storage=storage, documents=documents,
        store_cover=storage._stored_cover, queue_saved_videos=_queue_saved_videos, clock=timezone.now,
    )


def delete_course(course_id, payload):
    return commands.delete_course(course_id, payload, storage=storage, documents=documents)


def clone_normal_module(payload, *, staff_id, idempotency_key):
    from .structure_composition import get_authoring_structure_payload
    return commands.clone_normal_module(
        payload, staff_id=staff_id, idempotency_key=idempotency_key,
        read_structure=get_authoring_structure_payload, create=create_course,
    )
