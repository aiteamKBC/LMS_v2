# Backfill: run the journal's own auto-import endpoint for the learner-months
# that were filled before the auto-import feature shipped (2026-08-13), so
# their completed LMS activities get filed the same way a page visit would.
# The endpoint is idempotent and skips signed-off months by itself.
import json
import time
import urllib.request

BASE = "http://127.0.0.1:8000/audit_api/last-audit/manual/rows/auto-import"

GAP_MONTHS = [
    (652, "2025-03"), (652, "2025-04"),
    (1303, "2025-06"), (1303, "2025-07"), (1303, "2025-08"), (1303, "2025-09"),
    (1303, "2025-10"), (1303, "2025-11"), (1303, "2025-12"),
    (1705, "2025-06"), (1705, "2025-07"), (1705, "2025-08"), (1705, "2025-09"),
    (1705, "2025-10"), (1705, "2025-11"), (1705, "2026-08"),
    (1757, "2025-05"), (1757, "2025-06"), (1757, "2025-07"), (1757, "2025-08"),
    (1757, "2025-09"), (1757, "2025-10"), (1757, "2025-11"), (1757, "2026-02"),
    (1757, "2026-03"),
    (1769, "2025-12"), (1769, "2026-06"),
    (3214, "2025-10"), (3214, "2026-03"), (3214, "2026-08"),
    (4334, "2025-10"), (4334, "2025-11"), (4334, "2025-12"), (4334, "2026-01"),
    (4334, "2026-02"), (4334, "2026-03"), (4334, "2026-04"),
    (4350, "2025-10"), (4350, "2025-11"), (4350, "2025-12"), (4350, "2026-01"),
    (4350, "2026-02"), (4350, "2026-03"), (4350, "2026-04"),
    (4564, "2026-01"),
    (6115, "2026-02"), (6115, "2026-03"), (6115, "2026-04"), (6115, "2026-05"),
    (6115, "2026-06"), (6115, "2026-07"),
    (6320, "2026-03"),
    (6324, "2026-03"),
    (6492, "2026-01"), (6492, "2026-03"), (6492, "2026-05"), (6492, "2026-06"),
    (6492, "2026-07"),
    (6498, "2026-01"), (6498, "2026-02"), (6498, "2026-04"), (6498, "2026-05"),
    (8534, "2026-01"), (8534, "2026-02"),
    (17254, "2026-06"),
    (18222, "2026-06"),
]


def call(aptem_id, month):
    body = json.dumps({
        "aptem_id": aptem_id,
        "month": month,
        "created_by": "backfill-gaps",
    }).encode()
    request = urllib.request.Request(
        BASE, data=body, headers={"Content-Type": "application/json"}, method="POST",
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        return json.loads(response.read())


def main():
    total_created = total_skipped = failures = 0
    started = time.time()
    for index, (aptem_id, month) in enumerate(GAP_MONTHS, 1):
        try:
            result = call(aptem_id, month)
        except Exception as error:  # noqa: BLE001 - log and continue
            failures += 1
            print(f"[{index}/{len(GAP_MONTHS)}] {aptem_id} {month}: FAILED {error}", flush=True)
            continue
        created = result.get("created", 0)
        skipped = result.get("skipped_existing", 0)
        locked = result.get("locked", False)
        total_created += created
        total_skipped += skipped
        note = " (locked/signed-off)" if locked else ""
        print(f"[{index}/{len(GAP_MONTHS)}] {aptem_id} {month}: created={created} skipped={skipped}{note}", flush=True)
    print(f"\nDONE in {time.time() - started:.0f}s: created={total_created} "
          f"skipped_existing={total_skipped} failures={failures}", flush=True)


if __name__ == "__main__":
    main()
