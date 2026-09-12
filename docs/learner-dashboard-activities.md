# Learner dashboard activities

The learner sidebar no longer advertises Readiness, Community or Help. The working Community destinations appear under **Activities & rewards** beneath the dashboard progress metrics, with descriptive labels and no sample counters. Opening those destinations keeps Dashboard highlighted in the sidebar.

The new links retain the former Community group and destination permissions, and its apprenticeship audience. They remain hidden for commercial learners and pre-teaching statuses (Fresh user, Onboarding and Delivery). The dashboard adds no engagement API requests; each destination loads its existing data when opened.

## Source review

| Destination | Existing implementation | Placement |
| --- | --- | --- |
| Clubs & meetings | `api/engagement.ts` reads `/engagement_api/clubs/`; Django reads clubs and filters learner memberships | Dashboard |
| Events & bookings | Existing event and learner booking API clients; Django reads `Event` and booking records | Dashboard |
| Points & rewards | Existing reward, points, recognition and claim API clients; Django reads the stored records | Dashboard |
| Flash cards | Existing deck API client; Django returns published decks to learners | Dashboard |
| Gateway Readiness | Page imports `LEARNER_PROFILE`, `gateway-readiness` mock data and hardcoded completion figures | Hidden from learner navigation |
| Help / Knowledge Base | Pages use example tickets, local state and mock profile/articles | Hidden from learner navigation |

This was a code-path review, not a claim that each learner currently has clubs, rewards or decks available. Existing empty and error states remain on the destination pages. The underlying Readiness and Help routes remain available for later development; this change does not convert their sample data into real data. The dashboard's existing Message coach action remains in place.

## Verification

The learner page, dashboard, sidebar and navigation-gate suites cover the placement change and retained permissions. `node scripts/dashboard-activities-smoke.mjs` checks the isolated component at 1600, 1024, 768, 390 and 320px and all four link destinations, with API requests blocked. No database changes are required.
