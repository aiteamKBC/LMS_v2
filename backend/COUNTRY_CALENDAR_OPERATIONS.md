# Delivery calendars and Custom weeks

England remains the existing default. Existing cohorts/modules have no calendar policy after migration; their GOV.UK calendar, manually authored holidays and existing delivery behavior continue unchanged. A foreign country or explicit module override opts into the new calendar policy. Weekly rest days and public holidays are separate choices.

## Staff workflow

1. In Curriculum Studio, create/edit the cohort and open **Calendar & holidays**. Choose the country; confirm or change the weekly rest days; review the public holiday dates. England uses the existing GOV.UK source. Other supported countries import national holidays from Calendarific for each required year.
2. Create/edit a module in Module Builder. Keep the cohort calendar or choose **Customize this module**. A module override can change rest days, untick a holiday to permit teaching, switch public holidays off, or add a scoped manual closure. **Use cohort calendar** restores inheritance. Review affected session dates before saving an existing module calendar change.
3. Keep the existing one-session weekly default, or select Custom with 2-7 weekly live sessions. New Custom weeks start on the first scheduled live session; every live component keeps its own date within the module period. Seven-day delivery requires clearing all weekly rest days explicitly.
4. In **Holiday Calendars** (`/curriculum/holiday-calendars`, with the existing England URL retained), use **Sync saved calendars** to refresh already-imported country/year calendars. Importing a new country uses a separate cache entry. Manual definitions, exclusions and module exceptions are not overwritten by provider sync.

Country calendars do not automatically adopt England's public holidays or its global manual closures. Existing manual definitions remain stored; add the required closures explicitly to the foreign cohort/module calendar. Country presets are suggestions that staff confirm. US/Canada/Australia entries are national/federal calendars, not a guarantee of every regional holiday.

## Cache, failure and Teams behavior

A fresh saved country/year is reused. Serving processes with `CALENDARIFIC_API_KEY` check saved calendars daily and refresh those at least 25 days old. After 30 days, expired reference data is unavailable and is purged if refresh fails. Missing/expired data produces an explicit error instead of silently applying England. `COUNTRY_HOLIDAY_AUTO_SYNC=false` disables the serving-process scheduler; a deployment using this option must arrange the refresh command itself.

Manual command: `python manage.py sync_country_holidays` refreshes due saved country/year calendars; `--force` refreshes all saved entries. Routine validation must mock the provider. Do not use live Teams or repair commands as regression tests.

Scheduling retains the existing behavior of showing non-delivery warnings for planned slots; it does not automatically move existing sessions. Teams create/update validates the saved module calendar. Calendar sync does not recreate, cancel, move or notify existing meetings and does not rewrite historical attendance. Use the separate reviewed Teams update flow when a meeting must change.

## Reviewed release and rollback

The AWS workflow does not apply database migrations. Before a schema-changing release, verify the actual deployment database and restore point, record the previous application/image/frontend revision, and review the exact migration plan. The current additive release requires `0089_module_week_starts_on` followed by `0090_delivery_calendars`; inspect with `python manage.py migrate curriculum_api 0090_delivery_calendars --plan` through the approved deployment environment. Execute the reviewed migration through that environment and verify the ledger/table/nullable columns afterward. Never run a developer test runner against production.

Migration 0090 adds `curriculum.country_holiday_calendars` and nullable `calendar_policy` columns to cohorts/modules, refreshing existing module read views. It does not backfill existing delivery choices or import provider data. The application must be deployed only from reviewed, merged main. Schema validation on a production-cloned Neon child is separate evidence and does not mean production has been migrated.

Configure the existing backend secret store with `CALENDARIFIC_API_KEY` and inject that environment variable into the curriculum API's deployed task/process. A key saved only in local `backend/.env` is not present in ECS. Never commit the key, put it in a browser bundle, print secret values, or change IAM permissions to make a test pass. Confirm the key is available by a scoped staff import, without printing it. Keep the existing England configuration intact.

After migration/deploy, verify backend health, England single-session delivery, a synthetic foreign-country Custom schedule, cohort inheritance/module override/reset and visible sync errors. Live meeting validation needs its separately approved environment and scope. Record PR, merged/deployed revisions, image/task revision, build/check results and migration verification.

For rollback, redeploy the recorded previous main image/frontend through the established release workflow. These migrations are additive; their reverse operations intentionally leave new nullable columns/cache data in place. Do not drop columns or rewrite existing delivery data as an application rollback shortcut.
