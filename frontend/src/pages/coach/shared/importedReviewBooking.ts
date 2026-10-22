/** Shared eligibility + load path for an imported Aptem review's own booking.
 *
 * The Review workspace and the Meeting Details page both offer the same
 * booking action for one imported Aptem review, so the server-side eligibility
 * flags are read through one helper rather than restated on each surface: a
 * surface that drifts from `canInitialize`/`canBook` would either hide a usable
 * booking or offer one the server refuses.
 */
import {
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
  options: { viewingAsCoach: boolean; signal?: AbortSignal },
): Promise<ReviewInstanceFormDefinition> {
  const data = await fetchReviewInstanceForm(instanceId, options.signal);
  if (options.viewingAsCoach || !canInitializeMigratedReview(data)) return data;
  try {
    await initializeMigratedReview(data.instance.id);
  } catch {
    return data;
  }
  return fetchReviewInstanceForm(instanceId, options.signal);
}
