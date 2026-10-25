import { beforeEach, describe, expect, it, vi } from 'vitest';
import { adoptMigratedReviewBooking, fetchReviewInstanceForm, initializeMigratedReview } from '@/api/reviewInstances';
import { adoptExistingMigratedMeeting, loadImportedReviewForBooking } from './importedReviewBooking';
import { importedBookingDefinition, scheduledImportedBooking } from './__tests__/importedBookingFixtures';

vi.mock('@/api/reviewInstances', () => ({
  adoptMigratedReviewBooking: vi.fn(), fetchReviewInstanceForm: vi.fn(), initializeMigratedReview: vi.fn(),
}));

const existing = () => {
  const data = scheduledImportedBooking({ localStatus: 'not-scheduled' });
  data.template.reviewTypeCode = 'aptem_mcm';
  data.booking = { ...data.booking!, canAttach: true, canReschedule: false };
  return data;
};
beforeEach(() => vi.resetAllMocks());

describe('automatic imported meeting adoption', () => {
  it.each(['aptem_mcm', 'aptem_progress_review'])('adopts %s using only the form identity', async family => {
    const data = existing();
    data.template.reviewTypeCode = family;
    const updated = scheduledImportedBooking();
    const signal = new AbortController().signal;
    vi.mocked(adoptMigratedReviewBooking).mockResolvedValue(updated);
    expect(await adoptExistingMigratedMeeting(data, { viewingAsCoach: false, signal })).toBe(updated);
    expect(adoptMigratedReviewBooking).toHaveBeenCalledExactlyOnceWith(data.instance.id, signal);
  });

  it.each(['viewAs', 'native', 'preview', 'readOnly', 'completed', 'scheduled', 'in-progress', 'templateConflict', 'bookingConflict', 'unsynced', 'unbooked', 'noPermission', 'psp', 'aborted'])('does not write for %s', async reason => {
    const data = existing();
    const controller = new AbortController();
    if (reason === 'native') data.source = undefined;
    if (reason === 'preview') data.previewOnly = true;
    if (reason === 'readOnly') data.readOnly = true;
    if (reason === 'completed') data.instance.completedAt = '2026-09-23T10:00:00Z';
    if (['scheduled', 'in-progress'].includes(reason)) data.localStatus = reason;
    if (reason === 'templateConflict') data.templateSync = { status: 'conflict', upToDate: false };
    if (reason === 'bookingConflict') data.booking!.conflict = true;
    if (reason === 'unsynced') data.booking!.syncState = 'failed';
    if (reason === 'unbooked') data.booking!.booked = false;
    if (reason === 'noPermission') data.booking!.canAttach = false;
    if (reason === 'psp') data.template.reviewTypeCode = 'aptem_psp';
    if (reason === 'aborted') controller.abort();
    expect(await adoptExistingMigratedMeeting(data, { viewingAsCoach: reason === 'viewAs', signal: controller.signal })).toBe(data);
    expect(adoptMigratedReviewBooking).not.toHaveBeenCalled();
  });

  it('adopts a verified booking discovered after form initialization', async () => {
    vi.mocked(fetchReviewInstanceForm).mockResolvedValueOnce(importedBookingDefinition({ migratedForm: false, formAvailable: false, canInitialize: true }))
      .mockResolvedValueOnce(existing());
    vi.mocked(adoptMigratedReviewBooking).mockResolvedValue(scheduledImportedBooking());
    const result = await loadImportedReviewForBooking('imported-review:31', { viewingAsCoach: false });
    expect(initializeMigratedReview).toHaveBeenCalledOnce();
    expect(adoptMigratedReviewBooking).toHaveBeenCalledOnce();
    expect(result.localStatus).toBe('scheduled');
  });

  it('exposes an adoption failure instead of reporting a scheduled review', async () => {
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(existing());
    vi.mocked(adoptMigratedReviewBooking).mockRejectedValue(new Error('Booking conflict'));
    await expect(loadImportedReviewForBooking('imported-review:31', { viewingAsCoach: false })).rejects.toThrow('Booking conflict');
  });

  it('retains the loaded definition and reports the adoption error separately when recovery is supported', async () => {
    const data = existing();
    const error = new Error('Temporarily unavailable');
    const onAdoptionError = vi.fn();
    const onAdopted = vi.fn();
    vi.mocked(fetchReviewInstanceForm).mockResolvedValue(data);
    vi.mocked(adoptMigratedReviewBooking).mockRejectedValue(error);
    expect(await loadImportedReviewForBooking(data.instance.id, { viewingAsCoach: false, onAdoptionError, onAdopted })).toBe(data);
    expect(onAdoptionError).toHaveBeenCalledExactlyOnceWith(error);
    expect(onAdopted).not.toHaveBeenCalled();
  });
});
