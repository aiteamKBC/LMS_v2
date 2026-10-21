import type { ReviewInstanceFormDefinition } from '@/api/reviewInstances';

export function importedBookingDefinition(overrides: Partial<ReviewInstanceFormDefinition> = {}): ReviewInstanceFormDefinition {
  return {
    source: 'aptem', migratedForm: true, formAvailable: true, sourceStatus: 'Not Scheduled', localStatus: 'not-scheduled',
    instance: {
      id: 'imported-review:31', reviewTemplateId: '', learnerId: 31, programmeId: 'programme-1',
      occurrenceNumber: null, targetDate: '2026-09-22', status: 'not-scheduled', startedAt: null, completedAt: null,
    },
    template: {
      id: 'template-1', name: 'Progress review',
      signatures: { advisor: true, participant: true, employer: false, referrer: false },
      visibleTo: { advisor: true, participant: true, employer: false, referrer: false },
      recurrence: { interval: 1, unit: 'month' }, notifications: {}, allowEditingPriorDays: 0,
    },
    sections: [], signatures: {
      advisor: { required: true, signed: false }, participant: { required: true, signed: false },
      employer: { required: false, signed: false }, referrer: { required: false, signed: false },
    }, manualOverride: null,
    booking: { booked: false, conflict: false, canBook: true, canAttach: false, eventKey: null,
      scheduledDate: null, scheduledTime: null, durationMinutes: null, meetingLink: null, syncState: null },
    ...overrides,
  };
}

export function scheduledImportedBooking(overrides: Partial<ReviewInstanceFormDefinition> = {}): ReviewInstanceFormDefinition {
  return importedBookingDefinition({
    localStatus: 'scheduled',
    booking: { booked: true, conflict: false, canBook: false, canReschedule: true, eventKey: 'native-booking:31',
      scheduledDate: '2026-09-22', scheduledTime: '10:00', durationMinutes: 75,
      meetingLink: 'https://example.invalid/meeting', syncState: 'synced' },
    ...overrides,
  });
}

export function personalSupportBooking(scheduled = false): ReviewInstanceFormDefinition {
  const base = scheduled ? scheduledImportedBooking() : importedBookingDefinition();
  return { ...base, migratedForm: false, formAvailable: false, summaryOnly: true, readOnly: true,
    canInitialize: false, localStatus: null, template: { ...base.template, name: 'Personal Support Plan' },
    booking: { ...base.booking!, formRequired: false, status: scheduled ? 'scheduled' : 'not-scheduled',
      eventKey: scheduled ? base.instance.id : null },
  };
}

// JSDOM does not implement the native dialog's top-layer methods.
export function installDialogTestSupport() {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
}
