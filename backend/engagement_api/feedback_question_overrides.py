"""Apply a recipient's lecture correction only to responses started afterward."""


def effective_question_ids(pinned_ids, replacements, started_at=None, *, as_of):
    selected = set(pinned_ids)
    reference_time = started_at if started_at is not None else as_of
    for original_id, replacement_id, effective_at in replacements:
        if reference_time < effective_at:
            continue
        if original_id in selected:
            selected.remove(original_id)
            selected.add(replacement_id)
    return selected
