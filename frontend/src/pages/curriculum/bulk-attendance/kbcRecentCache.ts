import type { BulkAttendanceKbcHistoryRecord } from "@/api/bulkAttendanceLearners";

type KbcRecent = Record<string, BulkAttendanceKbcHistoryRecord[]>;

// Last 4 as last read, kept for the browser tab's lifetime: going back to the
// register shows it at once while the visible page is read again behind it.
let lastKbcRecent: KbcRecent = {};

export function readKbcRecentCache(): KbcRecent {
  return lastKbcRecent;
}

export function writeKbcRecentCache(next: KbcRecent) {
  lastKbcRecent = next;
}

/** Tests only: forget the Last 4 kept between mounts. */
export function resetKbcRecentCache() {
  lastKbcRecent = {};
}
