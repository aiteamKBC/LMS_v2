/**
 * Two kinds of marking, and which one a submission needs.
 *
 * An assignment is a work product: the learner produces something — a report,
 * a case study, a presentation — and the coach assesses it against the KSBs the
 * activity carries and against the end-point assessment plan. That is the full
 * marking judgement, and it is what the AI-assisted draft is built for.
 *
 * Everything else — a video watched, a reading completed, a podcast, a quiz —
 * is evidenced by the learner's reflection on it. There is no artefact to
 * assess; the coach is validating that the reflection is genuine, that the
 * claimed time is reasonable, and that the learner has drawn something useful
 * from the activity. Running the assignment marking policy over that would
 * produce a thousand words of assessment about a fifteen-minute video.
 *
 * Split on the activity type rather than on whether evidence files happen to be
 * attached, because the distinction is about what the activity *is*, not about
 * what the learner remembered to upload.
 */
export type MarkingKind = 'assignment' | 'reflection';

/** Activity types that are assessed as a work product. */
const ASSIGNMENT_TYPES = new Set(['assignment']);

export function markingKind(activityType: string | null | undefined): MarkingKind {
  return ASSIGNMENT_TYPES.has(String(activityType ?? '').trim().toLowerCase())
    ? 'assignment'
    : 'reflection';
}

export function isAssignment(activityType: string | null | undefined): boolean {
  return markingKind(activityType) === 'assignment';
}
