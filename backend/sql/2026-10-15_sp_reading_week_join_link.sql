-- Restore only the PMI-SP G1-W Reading Week join link to its own saved
-- 30 September occurrence. The present manual override points at another
-- module's 2 October masterclass. Stop if an author changed this row since
-- the audit, rather than overwriting a newer manual choice.
BEGIN;

DO $$
DECLARE
    changed_rows integer;
BEGIN
    UPDATE curriculum.components AS c
    SET settings_json = jsonb_set(
            jsonb_set(c.settings_json - 'liveSessionLinkOverride',
                      '{liveSessionUrl}', to_jsonb(o.join_url), true),
            '{teamsMeetingUrl}', to_jsonb(o.join_url), true),
        live_sessions_link = o.join_url,
        updated_at = now()
    FROM curriculum.live_session_occurrences AS o,
         curriculum.live_session_occurrences AS wrong_o
    WHERE c.id = 'COMP-A8E775210F444954B339B654F2559452'
      AND c.module_catalogue_id = 'MOD-20261001105703419367E214F45713C3'
      AND c.week_id = 'WEEK-20261001105642649CSJY5L'
      AND c.deleted_at IS NULL
      AND o.id = 'OCC-DB0DEA1A47E44CEAB0AA8761333B9DD9'
      AND o.live_session_id = 'LIVE-10F575C538E240949F41B545CB2732A3'
      AND o.session_number = 5
      AND o.join_url <> ''
      AND wrong_o.live_session_id = 'LIVE-4479DD5B77014AF9B60AF112196ED80B'
      AND wrong_o.session_number = 1
      AND c.settings_json->>'teamsOccurrenceId' = o.id
      AND c.settings_json->>'teamsLiveSessionId' = o.live_session_id
      AND c.settings_json->>'liveSessionLinkOverride' = wrong_o.join_url
      AND c.live_sessions_link = wrong_o.join_url;

    GET DIAGNOSTICS changed_rows = ROW_COUNT;
    IF changed_rows <> 1 THEN
        RAISE EXCEPTION 'SP Reading Week link changed or source occurrence missing; updated % rows', changed_rows;
    END IF;
END $$;

COMMIT;
