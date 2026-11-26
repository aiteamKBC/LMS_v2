"""Active UI file projection only; never use for history, audit or mutations.

Only complete file identities on the same canonical progress are coalesced.
Split/recovery and unknown source records retain independent identities.
"""


def active_relation():
    return '''(SELECT * FROM (
        SELECT d.*,row_number() OVER (
            PARTITION BY learner_id,progress_id,container,blob_name,
                CASE WHEN progress_id IS NULL OR nullif(btrim(container),'') IS NULL
                       OR nullif(btrim(blob_name),'') IS NULL
                       OR source_system NOT IN ('journal','aptem','aptem_evidence','aptem-evidence')
                       OR source_system IS NULL OR source_document_id ~ ':part[0-9]+$'
                     THEN id END
            ORDER BY id) AS file_rank
        FROM "Learner".learner_activity_documents d WHERE deleted_at IS NULL
    ) ranked WHERE file_rank=1)'''
