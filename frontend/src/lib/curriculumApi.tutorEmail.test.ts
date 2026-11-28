import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The two tutor-email calls must go through `coachFetch`.
 *
 * `tutor_notifications` is one of the very few curriculum views that is NOT
 * `@csrf_exempt` — it sends real mail to a real person and keeps the
 * protection. This module's own `fetchJson` sends no CSRF token, because the 61
 * exempt views never needed one, so a POST built on it is rejected by Django's
 * CSRF middleware before the view runs. That surfaced to the author as a bare
 * "The email could not be sent", with nothing in the backend logs, because the
 * request never reached the backend's own code.
 *
 * Nothing else catches this: every drawer test mocks `@/lib/curriculumApi`
 * wholesale, so the transport underneath it is invisible to them. Hence this
 * test, which is about the transport and nothing else.
 */

const coachFetchMock = vi.fn();
vi.mock('@/lib/coachFetch', () => ({ coachFetch: (...args: unknown[]) => coachFetchMock(...args) }));

const { fetchTutorAssignmentEmailStatus, sendTutorAssignmentEmail } = await import('./curriculumApi');

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as unknown as Response;
}

describe('tutor assignment email transport', () => {
  beforeEach(() => coachFetchMock.mockReset());

  it('sends the assignment email through the CSRF-bearing client', async () => {
    coachFetchMock.mockResolvedValue(jsonResponse({ sent: true, tutor: 'Tutor One', modules: 2 }));

    await expect(sendTutorAssignmentEmail(['MOD-A', 'MOD-B'])).resolves.toEqual({
      sent: true, tutor: 'Tutor One', modules: 2,
    });

    expect(coachFetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = coachFetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/curriculum/modules/tutor-email/');
    // A POST, so coachFetch attaches X-CSRFToken. Were this built on the
    // module's own fetchJson there would be no token and Django would refuse it.
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ moduleIds: ['MOD-A', 'MOD-B'] });
  });

  it('reports the server its own refusal rather than a status code', async () => {
    coachFetchMock.mockResolvedValue(
      jsonResponse({ error: 'Tutor One has no email address in the staff directory.' }, false, 409),
    );
    await expect(sendTutorAssignmentEmail(['MOD-A'])).rejects.toThrow(
      'Tutor One has no email address in the staff directory.',
    );
  });

  it('names the status code when the refusal carries no sentence', async () => {
    coachFetchMock.mockResolvedValue(jsonResponse(null, false, 403));
    await expect(sendTutorAssignmentEmail(['MOD-A'])).rejects.toThrow('403');
  });

  it('asks for the status of several deliveries against the chosen tutor', async () => {
    coachFetchMock.mockResolvedValue(jsonResponse({
      tutor: { name: 'Tutor One', hasEmail: true },
      total: 2, emailed: 1, lastSentAt: null, deliveries: [],
    }));

    await fetchTutorAssignmentEmailStatus(['MOD-A', 'MOD-B'], 'Tutor One');

    const [url, init] = coachFetchMock.mock.calls[0] as [string, RequestInit | undefined];
    expect(url).toContain('moduleIds=MOD-A%2CMOD-B');
    // The tutor the author has selected, which is not necessarily the one
    // stored on the module — that is what keeps a swap from reading the
    // previous tutor's record.
    expect(url).toContain('tutor=Tutor+One');
    expect(init?.method).toBeUndefined();
  });
});
