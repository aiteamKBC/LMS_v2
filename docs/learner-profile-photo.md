# Learner profile photo

The Overview avatar and learner Profile page share `LearnerProfilePhoto`. Clicking the camera opens the file picker. JPG, PNG and WebP files up to 5 MB are accepted; the saved image replaces the initials. Failed replacements keep the previously saved image and allow retrying.

## Persistence and access

- `GET /learner_api/profile-photo/{kind}/{id}/` returns the saved JPEG, or 204 when no photo exists.
- `POST` to the same endpoint accepts multipart field `photo`. Session ownership/staff access and Django CSRF protection apply.
- Azure container: `AZURE_LEARNER_PHOTOS_CONTAINER`, default `learner-photos`. Existing Azure account credentials are reused. The private container is created on the first explicit upload if missing.
- Canonical blob: `enrolment/{Created_users.id}/profile.jpg`. Commercial and apprenticeship learners share this primary-key namespace. Replacements overwrite this single blob; no photo field, SQL or migration is required.
- The server decodes the actual file, accepts at most 20 megapixels, applies EXIF orientation, crops/resizes to 512 × 512, flattens transparency and encodes a fresh JPEG without original metadata. Original bytes are not stored.
- Reads stay authenticated and return `private, no-store`; no public or signed Azure URL is exposed. The photo loads independently of learner-page content. Navigation or reload retrieves the current saved photo.

## Verification

- 10 backend tests passed using `SimpleTestCase` and mocked Azure storage: image validation/normalization, persistence, identity isolation, CSRF, storage errors and missing-photo reads.
- 5 photo frontend tests and 10 existing Overview panel tests passed: upload transport, rereading after remount, retry, failed replacement, stale-response protection and learner switching.
- Headless browser fixtures exercised the actual camera/file picker, upload, refresh and navigation to Profile. Widths 1763, 768 and 390 px had no horizontal page overflow or JavaScript errors.
- Production build passed. Type checking reports the same six pre-existing errors outside this feature.
- Live read-only checks confirmed the route requires authentication and Azure reports no existing photo/container yet. No real photo was uploaded, no container was created, and no database records were changed during implementation or verification.
