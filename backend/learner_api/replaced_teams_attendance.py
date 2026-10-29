"""Read attendance from the meeting a replaced module link actually opens.

``Replace Teams links`` deliberately changes only authored component links.  It
does not move Microsoft ownership or copy provider ids.  A destination module
therefore keeps its own occurrence identity while its learners attend another
module's meeting.  This lateral join resolves that source occurrence only when
the stored override, destination occurrence and source session number identify
exactly one candidate. An explicitly booked additional meeting uses its saved
series ID and session 1 instead. Ambiguity leaves the destination on its own evidence.
"""


REPLACED_ATTENDANCE_LATERAL_SQL = r'''
LEFT JOIN LATERAL (
    SELECT min(candidate.occurrence_id) AS occurrence_id,
           max(candidate.attendance_report_id) AS attendance_report_id,
           max(candidate.scheduled_start) AS scheduled_start,
           max(candidate.scheduled_end) AS scheduled_end,
           bool_or(candidate.additional_meeting) AS additional_meeting
    FROM (
        SELECT DISTINCT source_o.id AS occurrence_id,
               source_o.attendance_report_id,
               source_o.live_session_id=target_c.settings_json->>'extraTeamsLiveSessionId' AS additional_meeting,
               CASE WHEN nullif(btrim(target_c.settings_json->>'extraTeamsLiveSessionId'),'') IS NOT NULL
                    THEN source_o.scheduled_start END AS scheduled_start,
               CASE WHEN nullif(btrim(target_c.settings_json->>'extraTeamsLiveSessionId'),'') IS NOT NULL
                    THEN source_o.scheduled_end END AS scheduled_end
        FROM curriculum.components target_c
        LEFT JOIN curriculum.weeks target_w
          ON target_w.id=target_c.week_id
         AND target_w.module_catalogue_id=target_c.module_catalogue_id
        JOIN curriculum.live_session_occurrences source_o
          ON (
              (coalesce(nullif(btrim(target_c.settings_json->>'extraTeamsLiveSessionId'),''),'')=''
               AND source_o.session_number=o.session_number)
              OR (source_o.session_number=1
                  AND source_o.live_session_id=target_c.settings_json->>'extraTeamsLiveSessionId')
          )
        JOIN curriculum.live_sessions source_s
          ON source_s.id=source_o.live_session_id
        WHERE target_c.module_catalogue_id=s.module_catalogue_id
          AND target_c.deleted_at IS NULL
          AND NOT coalesce(target_c.is_programme_deleted,false)
          AND (target_w.id IS NULL OR
               (target_w.deleted_at IS NULL AND NOT coalesce(target_w.is_programme_deleted,false)))
          AND lower(replace(coalesce(target_c.type,''),'-','_'))='live_session'
          AND (
              coalesce(target_c.settings_json->>'teamsOccurrenceId',
                       target_c.settings_json #>> '{legacySettings,teamsOccurrenceId}')=o.id
              OR (
                  target_c.settings_json->>'teamsLiveSessionId'=s.id
                  AND target_c.settings_json->>'teamsSessionNumber'=o.session_number::text
              )
          )
          AND coalesce(nullif(btrim(target_c.settings_json->>'extraTeamsMeetingUrl'),''),
                       nullif(btrim(target_c.settings_json->>'liveSessionLinkOverride'),'')) IS NOT NULL
          AND coalesce(nullif(btrim(target_c.settings_json->>'extraTeamsMeetingUrl'),''),
                       nullif(btrim(target_c.settings_json->>'liveSessionLinkOverride'),''))=
              coalesce(nullif(btrim(source_o.join_url),''),nullif(btrim(source_s.join_url),''))
          AND source_s.module_catalogue_id IS DISTINCT FROM s.module_catalogue_id
          AND lower(btrim(source_s.status)) NOT IN ('cancelled','canceled','deleted','failed','superseded')
          AND lower(btrim(source_o.status)) NOT IN ('cancelled','canceled','deleted','failed','superseded')
    ) candidate
    HAVING count(DISTINCT candidate.occurrence_id)=1
) replaced_attendance ON true
'''


def additional_module_context(module_ids, series, read):
    """Allow only session 1 of a one-off explicitly booked on an assigned card.

    A pasted URL or another module's whole calendar grants no access. The
    server-derived assignment, active card/week and saved extra-meeting ID
    must all agree with the stored one-off series and its join URL.
    """
    if (not module_ids or series.get('status') != 'week-meeting'
            or series.get('meeting_type') != 'week-additional'
            or not series.get('id') or not series.get('join_url')):
        return []
    rows = read('''SELECT DISTINCT c.module_catalogue_id
        FROM curriculum.components c
        JOIN curriculum.modules m ON m.module_catalogue_id=c.module_catalogue_id
        JOIN curriculum.weeks w ON w.id=c.week_id AND w.module_catalogue_id=c.module_catalogue_id
        WHERE c.module_catalogue_id=ANY(%s)
          AND c.deleted_at IS NULL AND NOT coalesce(c.is_programme_deleted,false)
          AND m.deleted_at IS NULL AND NOT coalesce(m.is_programme_deleted,false)
          AND w.deleted_at IS NULL AND NOT coalesce(w.is_programme_deleted,false)
          AND lower(replace(coalesce(c.type,''),'-','_'))='live_session'
          AND c.settings_json->>'extraTeamsLiveSessionId'=%s
          AND btrim(c.settings_json->>'extraTeamsMeetingUrl')=%s
        ORDER BY c.module_catalogue_id''', [sorted(set(module_ids)), series['id'], series['join_url']])
    return [str(row['module_catalogue_id']) for row in rows]
