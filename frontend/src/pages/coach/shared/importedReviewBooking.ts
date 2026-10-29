import { firstAvailableBookingDate } from '@/pages/learner/reviews/bookingDates';
/** Shared eligibility + load path for an imported Aptem review's own booking.
 *
 * The Review workspace and the Meeting Details page both offer the same
 * booking action for one imported Aptem review, so the server-side eligibility
 * flags are read through one helper rather than restated on each surface: a
 * surface that drifts from `canInitialize`/`canBook` would either hide a usable
 * booking or offer one the server refuses.
 */
import {
  adoptMigratedReviewBooking,
  fetchReviewInstanceForm,
  initializeMigratedReview,
  type ReviewInstanceFormDefinition,
} from '@/api/reviewInstances';

/** The server's own eligibility, never a locally inferred one. */
export function canInitializeMigratedReview(data: ReviewInstanceFormDefinition): boolean {
  return data.source === 'aptem'
    && data.instance.id.startsWith('imported-review:')
    && data.canInitialize === true
    && !data.migratedForm
    && (!data.formAvailable || data.template.reviewTypeCode === 'aptem_psp')
    && data.sourceStatus?.trim().toLowerCase() !== 'completed'
    && data.instance.status.trim().toLowerCase() !== 'completed'
    && !data.instance.completedAt;
}

/** Adopt only the existing booking approved by the server, never create one. */
export async function adoptExistingMigratedMeeting(
  data: ReviewInstanceFormDefinition,
  options: { viewingAsCoach: boolean; signal?: AbortSignal },
): Promise<ReviewInstanceFormDefinition> {
  if (options.viewingAsCoach || options.signal?.aborted || data.source !== 'aptem'
    || !data.migratedForm || data.readOnly || data.previewOnly || data.instance.completedAt
    || data.templateSync?.status === 'conflict'
    || !['aptem_mcm', 'aptem_progress_review'].includes(data.template.reviewTypeCode || '')
    || data.localStatus !== 'not-scheduled'
    || !data.booking?.canAttach || !data.booking.booked || data.booking.conflict
    || data.booking.syncState !== 'synced') return data;
  return adoptMigratedReviewBooking(data.instance.id, options.signal);
}

/** Read one imported review, preparing its form for the assigned coach.
 *
 * Mirrors the Review workspace: opening an eligible import initializes it, so
 * the same booking controls are offered whichever screen the coach opened
 * first. An admin reading another workspace never initializes anything, and a
 * failed initialization resolves to the pre-initialization definition so the
 * caller can still render the review's own state.
 */
export async function loadImportedReviewForBooking(
  instanceId: string,
  options: {
    viewingAsCoach: boolean; signal?: AbortSignal;
    onAdopted?: (data: ReviewInstanceFormDefinition) => void;
    onAdoptionError?: (error: unknown) => void;
  },
): Promise<ReviewInstanceFormDefinition> {
  let data = await fetchReviewInstanceForm(instanceId, options.signal);
  if (options.viewingAsCoach) return data;
  if (canInitializeMigratedReview(data)) {
    try {
      await initializeMigratedReview(data.instance.id);
    } catch {
      return data;
    }
    data = await fetchReviewInstanceForm(instanceId, options.signal);
  }
  let updated: ReviewInstanceFormDefinition;
  try {
    updated = await adoptExistingMigratedMeeting(data, options);
  } catch (error) {
    if (options.signal?.aborted || !options.onAdoptionError) throw error;
    options.onAdoptionError(error);
    return data;
  }
  if (updated !== data && !options.signal?.aborted) options.onAdopted?.(updated);
  return updated;
}

/** The server decides whether this is a booking; a planned date is only a suggestion. */
export function initialReviewBookingDate(definition: ReviewInstanceFormDefinition, monthly: boolean): string {
  const booking = definition.booking;
  if (booking?.reserved || booking?.booked || booking?.canReschedule || booking?.canAttach) return booking.scheduledDate || '';
  return firstAvailableBookingDate(booking?.scheduledDate || definition.instance.targetDate, definition.bookingCalendar, monthly);
}

/** Default new appointments to one hour; keep the duration of an existing reservation. */
export function initialReviewBookingDuration(definition: ReviewInstanceFormDefinition): number {
  const booking = definition.booking;
  return booking?.reserved || booking?.booked || booking?.canReschedule || booking?.canAttach
    ? booking.durationMinutes || 60 : 60;
}
