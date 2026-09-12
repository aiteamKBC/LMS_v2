# Aptem withdrawal display

Verified on 12 September 2026 against the configured database using read-only
connections. The current source is `"LMS"."Aptem_users"."Program-Status"`, matched
to `enrolment."Created_users".aptem_id` by Aptem ID.

The current Aptem table marks eight existing platform learners as Withdrawn
while their local lifecycle is Delivery. Their older `Last_audit.learners`
snapshot still says Active, so it must not override the current Aptem state.

| Enrolment ID | Learner |
| --- | --- |
| 132 | Anna Rundell |
| 159 | JORDEN GUEST |
| 194 | Adam Edmondson |
| 304 | Hannah Killick |
| 372 | Lauren Sinclair |
| 397 | Martha Pitcher |
| 431 | Philip Durham |
| 465 | Sienna Parkinson |

`aptem_status.programme_status` gives an explicit current Aptem Withdrawn status
precedence in the directory, enrolment board, edit fields, commercial responses,
learner detail and lightweight summary. These learners report `isActive=false`
and do not display the pre-start waiting gate. Automatic progression stops
before any activation or profile synchronization.

Other Aptem statuses retain the local platform lifecycle. In particular, Aptem
Active does not activate an uninvited platform learner. A local Withdrawn status
also remains intact. Plans, activity history and saved progress remain available.

The directory adds the status to its existing SQL projection, keeping a single
learner query instead of a separate lookup for every person. Individual records
read the external status once per loaded object. Invalid or missing Aptem IDs
do not fall back to name matching. This is a read-only display rule; it does not
persist status changes and requires no owner-run SQL.

The live directory query returned 369 learners: 8 Withdrawn, 358 Delivery and
3 Active. The source has other withdrawn learners who have never been imported;
this change only reflects status for existing platform records.

[Read-only verification results](../reports/aptem-withdrawn-status-2026-09-12.json)

Validation: 146 backend tests and 16 frontend tests passed, including current
withdrawal precedence, preventing automatic activation, preserving invitation
gating, cached per-record identity reads, directory performance, summary status,
and keeping local lifecycle values unchanged.
