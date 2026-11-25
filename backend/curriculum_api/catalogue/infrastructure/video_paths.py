"""Resolve existing generated LMS video paths without upload orchestration."""
import re
from curriculum_api import upload_storage


UPLOAD_ROOT = 'curriculum_component_uploads'


VIDEO_PATH = re.compile(r'videos/(?:module|template|free_course)/[\w-]+/[\w-]+/[\w-]+\.mp4', re.ASCII)


def stored_video_path(source):
    """Only resolve our generated video paths, never arbitrary URLs or disk paths."""
    if not source.startswith(upload_storage.UPLOAD_URL_PREFIX):
        return None
    relative = source[len(upload_storage.UPLOAD_URL_PREFIX):]
    return f'{UPLOAD_ROOT}/{relative}' if VIDEO_PATH.fullmatch(relative) else None
