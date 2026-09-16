# Import learners from the Users page

1. Open **Users** and select **Download template**.
2. Fill in the **Students** sheet, one learner per row. **First name**, **Surname** and **Email** are required. Keep the column headings unchanged.
3. Use the workbook's lookup sheets for programme, cohort, group, employer and case owner values. Programme, cohort and group must belong together. Optional fields may be left blank.
4. Save the workbook as `.xlsx`, then select **Upload learners** on the Users page.
5. Review the preview. If validation reports errors, correct the indicated rows in Excel and upload the corrected file.
6. Select **Import learners** to save the validated rows. The directory updates after a successful import.

Each upload accepts at most **500 learners** in a file up to **5 MB**. The template includes instructions for dates and identifiers such as phone numbers with leading zeroes.

Imported learners follow the current Create user form: commercial learner type, User role and FullUser subscription. Cohort dates and case owner assignments use the existing enrolment logic. Their platform accounts are prepared without sending invitation emails; invitations remain a separate action.

Duplicate email addresses within the file or against existing records are reported before saving. Re-uploading a successfully imported file does not create another set of the same learners. If validation or account creation fails, the batch is not saved.

## API

Both endpoints require the same staff access as the learner directory.

- `GET /learner_api/enrolment-users/import-template/`: downloads the Excel workbook.
- `POST /learner_api/enrolment-users/import/`: accepts multipart fields `file` and `dryRun`. Use `dryRun=true` to validate without saving; use `dryRun=false` to revalidate and import.

Requests use the authenticated session cookie and `X-Requested-With: XMLHttpRequest`. Upload requests leave `Content-Type` to the browser so that it includes the multipart boundary.
