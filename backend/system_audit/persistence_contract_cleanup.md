# Canonical persistence contracts and retirement inventory

Decision recorded 24 November 2026: retain `revisionStartedAt` using canonical revision events, and replace the classified 38 retired/mixed test contracts. No timestamp-feed recovery is restored. The original removal is commit `fcf3a65c3fd69a2638b7072c0a268d58cc4e5350`.

## Current contracts

- `revisionStartedAt` gives the earliest stored `curriculum.record_revisions.created_at` for each registered record type in the selected workspace/type. It is independent of page, date window, action, search and actor filters. It is not a source-row creation date, nor proof that earlier history never existed.
- Return **null** when no canonical event supplies an authoritative timestamp (no rows, or no non-null event timestamp). Never use a source table, current time, first page event, recorded-at guess or retired recovery cache. Read errors remain HTTP 503, not invented nulls or fallback history.
- Read the canonical minimum each time, so a newly inserted earlier canonical event can move the start earlier. No historical event or timestamp is rewritten by this change.
- Missing history storage remains HTTP 200 with `available:false`, a reason and the existing empty history collections/counts. The client models this as an unavailable response, clears stale trail data and shows an unavailable message with retry. It does not claim zero changes or timestamp recovery. People-tab behavior is unchanged.
- Available feeds remain revision-only: no source-only event, actor, count or derived workspace. Authorization, canonical actor attribution and write-time created/recorded/updated rules remain unchanged. Timestamp evidence used by existing write-capture code is not the retired read-time reconstruction.

## Assertion preservation

The seven retired-only cases below now assert canonical-only/unavailable behavior rather than being deleted or skipped. The 30 mixed cases retain filtering, ordering, counts, labels, attribution, window and persistence invariants with explicit canonical fixtures. The metadata case is unchanged and now passes against the corrected canonical minimum.

Read fixtures insert explicit revision events with explicit actions, never inferred events from source timestamps. Real curriculum create/edit/no-op tests and the unchanged first-recorded, ORM persistence, rollback, actor, snapshot and KSB tests retain writer coverage. Canonical admin/coach read fixtures prove reader contracts, not that every application write path is instrumented.

The six previously passing hybrid tests, the derived registry consistency assertions and all previously passing core tests are retained. Existing authenticated HTTP/concurrency/authorization checks remain required. Source-only synthetic tables are used only to prove exclusion; they are not reintroduced as an application read path.

## All 38 replacements

R = retired contract; M = mixed contract with retained invariant; U = retained metadata decision. File links name the exact replacement method; old expectations below explain why changing the old assertion is justified.


### 01. M — `AuditTrailEndpointTests.test_the_trail_still_answers_when_history_is_switched_off`

Original expectation: Dropping both history tables still yields HTTP 200, authorRecorded=false and source=timestamps.

Replacement: [`AuditTrailEndpointTests.test_missing_history_is_explicitly_unavailable_without_fallback`](../curriculum_api/tests_audit_trail.py#L587). Timestamp reconstruction is retired; inspect this canonical/unavailable test for the retained exact assertions.


### 02. R — `AuditTrailPaginationTests.test_the_timestamp_fallback_names_the_workspaces_as_well`

Original expectation: With both history tables dropped, workspace options include curriculum and changeWorkspaces equals [curriculum].

Replacement: [`AuditTrailPaginationTests.test_missing_history_does_not_advertise_timestamp_coverage`](../curriculum_api/tests_audit_trail.py#L855). Timestamp reconstruction is retired; inspect this canonical/unavailable test for the retained exact assertions.


### 03. M — `AuditTrailPaginationTests.test_the_timestamp_fallback_pages_too`

Original expectation: With history dropped, timestamp events have stable total, ceil(total/3) pages, three first-page events, and unique entity/action pairs across all pages.

Replacement: [`AuditTrailPaginationTests.test_missing_history_does_not_fabricate_paged_results`](../curriculum_api/tests_audit_trail.py#L838). Timestamp reconstruction is retired; inspect this canonical/unavailable test for the retained exact assertions.


### 04. R — `HybridTrailTests.test_a_record_type_never_logged_is_recovered_for_the_whole_window`

Original expectation: Two interventions aged 2h and 100h with no revisions both appear as timestamp-created events in seven days; their boundary is null and engagement is derived-covered.

Replacement: [`HybridTrailTests.test_unlogged_type_has_no_events_and_null_authoritative_start`](tests_hybrid.py#L281). Timestamp reconstruction is retired; inspect this canonical/unavailable test for the retained exact assertions.


### 05. R — `HybridTrailTests.test_a_recovered_event_just_before_the_boundary_is_shown`

Original expectation: The row one second before first-revision minus BOUNDARY_GUARD is recovered at its source timestamp; the row one minute before first revision is excluded.

Replacement: [`HybridTrailTests.test_source_rows_on_either_side_of_the_old_guard_are_never_recovered`](tests_hybrid.py#L176). Timestamp reconstruction is retired; inspect this canonical/unavailable test for the retained exact assertions.


### 06. M — `HybridTrailTests.test_a_window_that_crosses_the_boundary_reads_both_sides_of_it`

Original expectation: A three-day window includes the revision aged 48h and the recovered absence aged 60h, excluding a source row aged 80h.

Replacement: [`HybridTrailTests.test_date_window_uses_revision_events_not_source_timestamps`](tests_hybrid.py#L270). Timestamp reconstruction is retired; inspect this canonical/unavailable test for the retained exact assertions.


### 07. M — `HybridTrailTests.test_coverage_names_each_kind_of_evidence`

Original expectation: Coach/admin appear as derived coverage, revision/derived lists are subsets of changeWorkspaces, uncovered is disjoint, and recoveredHistory is true.

Replacement: [`HybridTrailTests.test_coverage_advertises_registered_revisions_never_timestamp_sources`](tests_hybrid.py#L348). Timestamp reconstruction is retired; inspect this canonical/unavailable test for the retained exact assertions.


### 08. M — `HybridTrailTests.test_deep_pages_cross_from_the_log_into_recovered_history`

Original expectation: Eight revisions plus six recovered rows produce total 14, five pages of size three, 14 unique IDs in descending time, provenance 8/6, and stable later-page counts.

Replacement: [`HybridTrailTests.test_deep_canonical_pages_ignore_source_only_history`](tests_hybrid.py#L215). Timestamp reconstruction is retired; inspect this canonical/unavailable test for the retained exact assertions.


### 09. M — `HybridTrailTests.test_first_recorded_and_created_keep_their_meaning_before_the_log`

Original expectation: Pre-log staff rows infer recorded from update-only, created from equal creation/update, and created plus updated from distinct timestamps.

Replacement: [`HybridTrailTests.test_recorded_created_and_updated_keep_their_saved_meaning`](tests_hybrid.py#L314). Timestamp reconstruction is retired; inspect this canonical/unavailable test for the retained exact assertions.


### 10. M — `HybridTrailTests.test_identical_moments_are_ordered_the_same_way_every_time`

Original expectation: Repeated reads and limit-one paging match; at a tied moment a revision precedes recovered absence IDs 1 then 2.

Replacement: [`HybridTrailTests.test_identical_revision_moments_have_stable_id_order_across_pages`](tests_hybrid.py#L327). Timestamp reconstruction is retired; inspect this canonical/unavailable test for the retained exact assertions.


### 11. M — `HybridTrailTests.test_the_author_filter_applies_to_both_readings`

Original expectation: Filtering coach email returns one revision and one recovered intervention; actor menu counts coach=2 and other=1 despite active actor filter.

Replacement: [`HybridTrailTests.test_author_filter_and_options_use_only_saved_revision_actors`](tests_hybrid.py#L257). Timestamp reconstruction is retired; inspect this canonical/unavailable test for the retained exact assertions.


### 12. M — `HybridTrailTests.test_the_record_type_filter_applies_to_both_readings`

Original expectation: coach_meeting filter returns revision M-90 and recovered M-1 only, with entityCounts coach_meeting=2.

Replacement: [`HybridTrailTests.test_record_type_filters_canonical_events_before_paging`](tests_hybrid.py#L244). Timestamp reconstruction is retired; inspect this canonical/unavailable test for the retained exact assertions.


### 13. M — `HybridTrailTests.test_the_workspace_filter_applies_to_both_readings`

Original expectation: Coach and admin each contain only their own entity, but each includes both revision and timestamp provenance.

Replacement: [`HybridTrailTests.test_workspace_filter_isolates_canonical_events_and_counts`](tests_hybrid.py#L231). Timestamp reconstruction is retired; inspect this canonical/unavailable test for the retained exact assertions.


### 14. R — `HybridTrailTests.test_two_sources_in_one_workspace_keep_their_own_revision_start`

Original expectation: Absence starts at 48h and meetings at 24h: source absence at 60h and meeting at 36h recover, while absence at 36h and meeting at 12h do not.

Replacement: [`HybridTrailTests.test_each_type_reports_only_its_canonical_start`](tests_hybrid.py#L161). Timestamp reconstruction is retired; inspect this canonical/unavailable test for the retained exact assertions.


### 15. R — `HybridWindowTests.test_the_boundary_and_its_guard_hold_in_every_window`

Original expectation: At each 7/30/60-day window, show the canonical creation and one source creation before the guard; exclude duplicate/inside-guard rows; total=2.

Replacement: [`HybridWindowTests.test_source_rows_never_duplicate_a_revision_in_any_window`](tests_hybrid.py#L425). Timestamp reconstruction is retired; inspect this canonical/unavailable test for the retained exact assertions.


### 16. M — `HybridWindowTests.test_the_system_wide_30_day_feed_recovers_every_workspace`

Original expectation: A 30-day response reports windowDays=30 and recovers 20-day-old coach/admin/engagement rows.

Replacement: [`HybridWindowTests.test_system_wide_30_days_includes_canonical_events_from_each_workspace`](tests_hybrid.py#L384). Timestamp reconstruction is retired; inspect this canonical/unavailable test for the retained exact assertions.


### 17. M — `HybridWindowTests.test_the_system_wide_60_day_feed_recovers_every_workspace`

Original expectation: 50-day source rows are absent at 30 days, recovered across coach/admin/engagement at 60 days, with windowDays=60.

Replacement: [`HybridWindowTests.test_system_wide_60_days_includes_canonical_events_outside_30_days`](tests_hybrid.py#L392). Timestamp reconstruction is retired; inspect this canonical/unavailable test for the retained exact assertions.


### 18. M — `HybridWindowTests.test_workspace_feeds_recover_their_own_history_at_30_and_60_days`

Original expectation: For coach/admin/engagement, 30 days yields the 20-day recovered row and 60 days yields both 20- and 45-day rows; windowDays stays 30/60.

Replacement: [`HybridWindowTests.test_workspace_30_and_60_day_feeds_use_only_their_canonical_events`](tests_hybrid.py#L402). Timestamp reconstruction is retired; inspect this canonical/unavailable test for the retained exact assertions.


### 19. M — `HybridTrailTests.test_a_recovered_event_names_no_author_the_row_does_not_record`

Original expectation: A recovered absence has blank author name/email, no diff, null snapshot and label Recovered from timestamps, despite a signed-in reader.

Replacement: [`HybridTrailTests.test_canonical_blank_author_never_becomes_the_signed_in_reader`](tests_hybrid.py#L305). Timestamp reconstruction is retired; inspect this canonical/unavailable test for the retained exact assertions.


### 20. U — `HybridTrailTests.test_the_revision_at_the_boundary_is_in_the_feed`

Original expectation: Exactly one canonical revision is present with label Revision history and saved coach email; revisionStartedAt[absence_report] equals its first-revision time.

Replacement: [`HybridTrailTests.test_the_revision_at_the_boundary_is_in_the_feed`](tests_hybrid.py#L186). The metadata assertions remain unchanged; the application now supplies authoritative event minima.


### 21. M — `DerivedTrailTests.test_a_coach_source_appears`

Original expectation: With history absent, a raw absence becomes a created event whose title includes the learner name.

Replacement: [`DerivedTrailTests.test_a_coach_source_appears`](tests_derived.py#L47). Timestamp reconstruction is retired; inspect this canonical/unavailable test for the retained exact assertions.


### 22. M — `DerivedTrailTests.test_a_missing_author_is_not_filled_in`

Original expectation: With no log, raw absence/intervention rows lacking author yield empty actorName, actorEmail and actorType, never the signed-in reader or System.

Replacement: [`DerivedTrailTests.test_a_missing_author_is_not_filled_in`](tests_derived.py#L155). Timestamp reconstruction is retired; inspect this canonical/unavailable test for the retained exact assertions.


### 23. M — `DerivedTrailTests.test_a_missing_creation_stamp_is_never_a_creation`

Original expectation: Without a log, update-only staff yields one recorded event, unstamped staff yields none, and no created event is fabricated.

Replacement: [`DerivedTrailTests.test_missing_creation_stamps_never_synthesize_events`](tests_derived.py#L139). Timestamp reconstruction is retired; inspect this canonical/unavailable test for the retained exact assertions.


### 24. M — `DerivedTrailTests.test_a_second_write_is_an_edit_and_the_first_is_the_creation`

Original expectation: One raw staff row with creation 10h ago/update 2h ago becomes exactly created and updated events.

Replacement: [`DerivedTrailTests.test_actual_create_then_edit_produces_two_canonical_events`](tests_derived.py#L147). Timestamp reconstruction is retired; inspect this canonical/unavailable test for the retained exact assertions.


### 25. R — `DerivedTrailTests.test_a_workspace_whose_only_table_disappears_stops_being_covered`

Original expectation: Dropping the only discovered admin source table removes admin from derivedWorkspaces and adds it to uncoveredWorkspaces.

Replacement: [`DerivedTrailTests.test_missing_source_table_does_not_remove_canonical_history_or_coverage`](tests_derived.py#L86). Timestamp reconstruction is retired; inspect this canonical/unavailable test for the retained exact assertions.


### 26. M — `DerivedTrailTests.test_admin_excludes_curriculum_and_coach`

Original expectation: No-log three-workspace source data, filtered admin, yields admin events only.

Replacement: [`DerivedTrailTests.test_admin_excludes_curriculum_and_coach`](tests_derived.py#L68). Timestamp reconstruction is retired; inspect this canonical/unavailable test for the retained exact assertions.


### 27. M — `DerivedTrailTests.test_an_admin_source_appears`

Original expectation: Raw staff row becomes a created event titled with staff name and entityLabel Staff record.

Replacement: [`DerivedTrailTests.test_an_admin_source_appears`](tests_derived.py#L40). Timestamp reconstruction is retired; inspect this canonical/unavailable test for the retained exact assertions.


### 28. M — `DerivedTrailTests.test_an_author_the_row_records_is_shown_and_filterable`

Original expectation: Raw intervention created_by email becomes actorEmail and actor menu entry; selecting that email yields total=1.

Replacement: [`DerivedTrailTests.test_an_author_the_revision_records_is_shown_and_filterable`](tests_derived.py#L165). Timestamp reconstruction is retired; inspect this canonical/unavailable test for the retained exact assertions.


### 29. M — `DerivedTrailTests.test_coach_excludes_curriculum_and_admin`

Original expectation: No-log three-workspace source data, filtered coach, yields coach events only.

Replacement: [`DerivedTrailTests.test_coach_excludes_curriculum_and_admin`](tests_derived.py#L71). Timestamp reconstruction is retired; inspect this canonical/unavailable test for the retained exact assertions.


### 30. R — `DerivedTrailTests.test_coverage_names_only_workspaces_whose_tables_were_found`

Original expectation: Discovered curriculum/admin/coach/engagement tables define derived/change coverage; finance/safeguarding/support/enrolment are uncovered; revision list empty; filtering does not change coverage.

Replacement: [`DerivedTrailTests.test_coverage_names_registered_revision_workspaces_not_source_tables`](tests_derived.py#L74). Timestamp reconstruction is retired; inspect this canonical/unavailable test for the retained exact assertions.


### 31. M — `DerivedTrailTests.test_curriculum_events_appear`

Original expectation: A component saved while log tables are absent is reconstructed as created with title Reading quiz.

Replacement: [`DerivedTrailTests.test_curriculum_events_appear`](tests_derived.py#L34). Timestamp reconstruction is retired; inspect this canonical/unavailable test for the retained exact assertions.


### 32. M — `DerivedTrailTests.test_curriculum_excludes_admin_and_coach`

Original expectation: No-log three-workspace source data, filtered curriculum, yields curriculum events only.

Replacement: [`DerivedTrailTests.test_curriculum_excludes_admin_and_coach`](tests_derived.py#L65). Timestamp reconstruction is retired; inspect this canonical/unavailable test for the retained exact assertions.


### 33. M — `DerivedTrailTests.test_pages_do_not_repeat_rows`

Original expectation: Ten raw staff/absence records generate a paged timestamp feed with no repeated event IDs and collected count equal total.

Replacement: [`DerivedTrailTests.test_pages_do_not_repeat_rows`](tests_derived.py#L117). Timestamp reconstruction is retired; inspect this canonical/unavailable test for the retained exact assertions.


### 34. M — `DerivedTrailTests.test_search_filters_the_whole_window_before_paging`

Original expectation: With limit=2, unique learner search finds the older absence behind five newer staff rows; total=1, pages=1, entity absence_report.

Replacement: [`DerivedTrailTests.test_search_filters_the_whole_window_before_paging`](tests_derived.py#L97). Timestamp reconstruction is retired; inspect this canonical/unavailable test for the retained exact assertions.


### 35. M — `DerivedTrailTests.test_the_date_window_filters_before_paging`

Original expectation: Three recent and three >72h staff rows produce totals 3 at one day and 6 at seven days, two narrow pages at limit=2, with only Recent titles on narrow page.

Replacement: [`DerivedTrailTests.test_the_date_window_filters_before_paging`](tests_derived.py#L106). Timestamp reconstruction is retired; inspect this canonical/unavailable test for the retained exact assertions.


### 36. M — `DerivedTrailTests.test_the_headline_counts_stay_still_across_pages`

Original expectation: First/last pages have identical actionCounts/entityCounts, with total equal summed action counts.

Replacement: [`DerivedTrailTests.test_the_headline_counts_stay_still_across_pages`](tests_derived.py#L131). Timestamp reconstruction is retired; inspect this canonical/unavailable test for the retained exact assertions.


### 37. M — `DerivedTrailTests.test_the_pages_rebuild_the_whole_filtered_window_in_order`

Original expectation: Concatenated limit-three created-event pages equal the limit-200 result; event times descend.

Replacement: [`DerivedTrailTests.test_the_pages_rebuild_the_whole_filtered_window_in_order`](tests_derived.py#L124). Timestamp reconstruction is retired; inspect this canonical/unavailable test for the retained exact assertions.


### 38. M — `DerivedTrailTests.test_the_system_wide_feed_carries_every_workspace_together`

Original expectation: With no log, curriculum/admin/coach source rows all appear in the unfiltered feed.

Replacement: [`DerivedTrailTests.test_the_system_wide_feed_carries_every_workspace_together`](tests_derived.py#L53). Timestamp reconstruction is retired; inspect this canonical/unavailable test for the retained exact assertions.


## Additional coverage and verification

Three additional backend cases guard: an 80-day canonical start outside the selected window/actor plus an earlier inserted event; null-to-first-event transition despite raw source stamps; and HTTP 503 without timestamp fallback on canonical read failure. Existing exact boundary-metadata, tied-time ordering, multi-page totals, source deletion, canonical write/no-op and per-workspace 30/60-day tests remain explicit assertions.

Frontend regression: systemAuditTrailPage.test.tsx verifies unavailable reason, absence of false zero-change/fallback notices, and successful retry with revalidation. The shared view is exercised through both system-wide and curriculum audit-trail suites. API type now expresses the unavailable variant.

Run in verified disposable PostgreSQL with external services mocked/blocked. Never run the synthetic fixture setup on Development or Production. No schema definitions, migrations, triggers, learner hours, Journal or Evidence logic changed. Execution evidence and exact commands are retained locally in `.local/backend-verification-20261124/cleanup-*.log` and `cleanup-*-result.json`; the final handoff distinguishes results from implementation claims.
