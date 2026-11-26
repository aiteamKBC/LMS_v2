import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createGroupModule,
  CurriculumApiError,
  curriculumErrorMessage,
  isTutorConflictError,
  tutorConflictMessage,
} from './curriculumApi';

const path = '/curriculum/groups/GROUP-1/modules/';
const fallback = 'Unable to create module.';
const migrationMessage = 'Apply curriculum migration 0063 before saving per-day times.';

afterEach(() => vi.unstubAllGlobals());

describe('curriculum validation error messages', () => {
  it('keeps the migration remedy visible after a failed group module request', async () => {
    const payload = {
      error: 'Module authoring payload is invalid.',
      validationErrors: [{ path: 'weeklySchedule', message: migrationMessage }],
      fields: ['weeklySchedule'],
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const error = await createGroupModule('GROUP-1', {
      moduleName: 'Advanced Project and Logistics Management',
      weeks: 2,
      weeklySchedule: [
        { day: 'Monday', startTime: '10:00', endTime: '12:00' },
        { day: 'Wednesday', startTime: '10:00', endTime: '12:00' },
      ],
    }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(CurriculumApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(curriculumErrorMessage(error, fallback)).toBe(`${payload.error} - ${migrationMessage}`);
    expect(curriculumErrorMessage(error, fallback)).not.toContain('Curriculum API returned');
    expect((error as CurriculumApiError).message).toBe(
      `Curriculum API returned 400 for ${path}: ${payload.error} - ${migrationMessage}`,
    );
  });

  it('deduplicates validation details and ignores malformed entries', () => {
    const error = new CurriculumApiError('diagnostic', 400, path, {
      error: 'Invalid module.',
      validationErrors: [
        null, {}, { message: 42 }, { message: ' ' },
        { message: 'Invalid module.' },
        { message: ' Choose a delivery day. ' },
      ],
      errors: ['Choose a delivery day.', { message: 'Enter an end time.' }],
    });
    expect(curriculumErrorMessage(error, fallback)).toBe(
      'Invalid module. - Choose a delivery day.; Enter an end time.',
    );
  });

  it('shows validation details when no top-level error sentence is supplied', () => {
    const error = new CurriculumApiError('diagnostic', 400, path, {
      validationErrors: [{ path: 'weeklySchedule', message: migrationMessage }],
    });
    expect(curriculumErrorMessage(error, fallback)).toBe(migrationMessage);
  });

  it('preserves ordinary refusals and tutor conflict handling', () => {
    const message = 'Tutor One is already teaching another module at 10:00.';
    const ordinary = new CurriculumApiError('diagnostic', 400, path, { error: message });
    const conflict = new CurriculumApiError('diagnostic', 409, path, {
      error: message, tutorConflicts: [], tutor: 'Tutor One', moduleName: 'Module A',
    });
    expect(curriculumErrorMessage(ordinary, fallback)).toBe(message);
    expect(curriculumErrorMessage(conflict, fallback)).toBe(message);
    expect(isTutorConflictError(conflict)).toBe(true);
    expect(tutorConflictMessage(conflict)).toBe(message);
  });

  it.each([undefined, 'invalid', { error: 42 }, { validationErrors: [null, { message: false }] }])(
    'uses the fallback for an unreadable response: %j',
    data => {
      expect(curriculumErrorMessage(new CurriculumApiError('diagnostic', 400, path, data), fallback)).toBe(fallback);
    },
  );

  it('does not expose raw diagnostic messages for non-API errors', () => {
    expect(curriculumErrorMessage(new Error('internal diagnostic'), fallback)).toBe(fallback);
  });
});
