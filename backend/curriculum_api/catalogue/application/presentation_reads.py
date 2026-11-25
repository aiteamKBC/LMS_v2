"""Choose a stamped presentation or an explicitly marked surviving render."""


def read_uploaded_presentation(
    relative_path, *, content_stamp, cached_for_stamp, local_copy, source_exists,
    cached_model, render_model, UnsupportedDeck,
):
    stamp = content_stamp(relative_path)
    cached = cached_for_stamp(relative_path, stamp)
    if cached is not None:
        return cached, None
    absolute_path, release_copy = local_copy(relative_path)
    if not source_exists(absolute_path):
        cached = cached_model(relative_path)
        return ({**cached, 'sourceMissing': True} if cached is not None else None), None
    try:
        return render_model(relative_path, absolute_path, stamp=stamp), None
    except UnsupportedDeck as error:
        return None, str(error)
    finally:
        release_copy()
