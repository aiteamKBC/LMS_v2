"""Concrete catalogue / infrastructure / cover image storage capabilities extracted from the curriculum entry point.

Existing algorithms and call contracts are preserved; dependencies have explicit owners.
No import of the legacy views module.
"""
from curriculum_api import upload_storage
from curriculum_api.catalogue.domain.authoring_errors import CoverImageError
from curriculum_api.catalogue.domain.read_contracts import MODULE_COVER_DATA_URI
from curriculum_api.catalogue.domain.read_contracts import MODULE_COVER_EXTENSIONS
from curriculum_api.catalogue.domain.read_contracts import MODULE_COVER_UPLOAD_SLOT
from curriculum_api.catalogue.domain.values import clean_str
from curriculum_api.catalogue.infrastructure.media_runtime import safe_upload_segment
from curriculum_api.catalogue.infrastructure.runtime_config import logger
from curriculum_api.catalogue.infrastructure.upload_paths import COMPONENT_UPLOAD_ROOT
from datetime import datetime
from django.core.files.base import ContentFile
import base64
import re


def stored_module_cover_image(module_catalogue_id, value):
    """A module cover as a URL, storing the bytes first when it arrives inline.

    The builder's picker reads the chosen file and sends it as a
    ``data:image/...;base64,...`` URL, and that string used to be written
    straight into ``curriculum.modules.cover_image_url`` -- up to 3 MB of base64
    in a column every module list selects. Five modules doing it was 1.52 MB of a
    1.79 MB ``/curriculum/modules/?compact=true`` response, 83% of it, and the
    column is also read whole by the payload build and by My Learning. The
    picture is the same size either way; what changes is that a list of 281
    modules stops carrying it.

    So the bytes go where every other authoring upload goes -- Azure when it is
    configured, local disk when it is not -- and the column keeps the same
    ``/curriculum_api/curriculum/uploads/...`` URL shape a component upload
    stores. One cover per module, so the path has a fixed slot and a new upload
    simply replaces the old one.

    Anything that is not an inline value is returned untouched: an https:// URL
    a curator pasted is already a URL, and '' still means "remove the cover".

    A ``data:`` value is never handed back for a column. One that is not a
    base64 image of a known type, does not decode, or cannot be stored raises
    ``CoverImageError`` and the save is refused: no image is kept as base64.
    """
    value = clean_str(value)
    if not value.lower().startswith('data:'):
        return value
    match = MODULE_COVER_DATA_URI.match(value)
    content_type = match.group(1).lower() if match else ''
    if content_type not in MODULE_COVER_EXTENSIONS:
        raise CoverImageError('Choose a JPG, PNG, GIF, WebP, AVIF, SVG or BMP image.')
    try:
        raw = base64.b64decode(re.sub(r'\s+', '', match.group(2)), validate=True)
    except Exception:
        logger.warning('Module %s sent a cover image that is not valid base64.', module_catalogue_id)
        raise CoverImageError('The image could not be read. Choose it again.')
    if not raw:
        return ''
    module_segment = safe_upload_segment(module_catalogue_id, 'module')
    extension = MODULE_COVER_EXTENSIONS[content_type]
    timestamp = datetime.utcnow().strftime('%Y%m%d%H%M%S%f')
    relative_path = (
        f'{COMPONENT_UPLOAD_ROOT}/{module_segment}/{MODULE_COVER_UPLOAD_SLOT}/cover-{timestamp}{extension}'
    )
    try:
        saved_path = upload_storage.store(ContentFile(raw), relative_path, content_type)
    except Exception:
        logger.exception('Unable to store the cover image for module %s.', module_catalogue_id)
        raise CoverImageError('The image could not be uploaded right now. Try again.')
    public_path = saved_path.removeprefix(f'{COMPONENT_UPLOAD_ROOT}/')
    return f'/curriculum_api/curriculum/uploads/{public_path}'
