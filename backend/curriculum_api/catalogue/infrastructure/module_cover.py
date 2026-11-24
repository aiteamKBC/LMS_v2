"""Module artwork row update with the existing live-row SQL predicate.

Named capabilities are supplied by the existing composition seam during migration.
No application settings, legacy views or provider runtime is imported here.
"""


def update_module_cover_row(identifier, image, *, connection, archive_state):
    with connection.cursor() as cursor:
        # Only a live (not archived) module takes a cover.
        cursor.execute(f'''UPDATE curriculum.modules SET cover_image_url=%s,updated_at=CURRENT_TIMESTAMP
                              WHERE module_catalogue_id=%s AND {archive_state.live_sql()}
                              RETURNING module_catalogue_id''', [image, identifier])
        updated_row = cursor.fetchone()
    return updated_row
