import type { LearnerKind } from '@/api/learnerDetail';
import { getEvidenceDownloadUrl } from '@/api/evidence';
import type { MonthlyReportAttachment } from '@/api/monthlyReports';

/** Whether this attachment can be opened yet.
 *
 * A monthly-report document goes through the evidence pipeline, so it is in
 * quarantine until the scan clears it and the download endpoint refuses it
 * until then. Rows written before `status` was recorded omit it; those are
 * treated as openable so the server stays the one that decides. */
export function canOpenAttachment(attachment: MonthlyReportAttachment) {
  return !attachment.status || attachment.status === 'approved';
}

/** Open one attached document in a new tab via a short-lived download URL.
 *
 * Shared by the monthly-activity hero and the report wizard so both offer the
 * same action against the same endpoint. Throws with a readable message, which
 * the caller shows next to whatever it was the learner clicked. */
export async function openMonthlyReportAttachment(
  learnerKind: LearnerKind,
  learnerId: string,
  attachment: MonthlyReportAttachment,
) {
  const url = await getEvidenceDownloadUrl(learnerKind, learnerId, attachment.id);
  window.open(url, '_blank', 'noopener,noreferrer');
}
