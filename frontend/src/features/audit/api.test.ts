import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchAuditLearners, fetchLearnerAudit, saveAuditSignoff } from './api';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('audit api', () => {
  it('loads Aptem/LMS audit learners with search and limit parameters', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      results: [
        {
          learnerId: '3221',
          fullName: 'Andrew Raslan',
          programName: 'Level 6 Project Controls Professional',
          completedOtjh: 341,
          aptemComponentCount: 113,
          hasAptemData: true,
          hasLmsData: true,
          warnings: [],
        },
      ],
    }));

    const learners = await fetchAuditLearners({ search: 'Andrew', limit: 25 });

    expect(fetchMock).toHaveBeenCalledWith('/audit_api/learners/?search=Andrew&limit=25');
    expect(learners[0].learnerId).toBe('3221');
    expect(learners[0].aptemComponentCount).toBe(113);
  });

  it('loads structured learner audit details', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      learnerId: '3221',
      learner: { id: 3221, name: 'Andrew Raslan', programme_name: 'Level 6 Project Controls Professional', programme_key: 'Level 6 Project Controls Professional' },
      summary: { completed_otjh: 341 },
      months: [],
      signoffs: {},
      warnings: [],
      field_sources: {},
      source_status: { has_aptem_data: true, has_lms_data: true },
      audit_version: 'aptem-lms-reconciliation-v1',
      snapshot_hash: 'hash',
    }));

    const audit = await fetchLearnerAudit('3221');

    expect(audit.learner.name).toBe('Andrew Raslan');
    expect(audit.audit_version).toBe('aptem-lms-reconciliation-v1');
  });

  it('saves monthly role-specific signoffs', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      learnerId: '3221',
      month: '2026-03',
      signoffs: { learner: null, coach: null },
    }));

    await saveAuditSignoff('3221', {
      monthKey: '2026-03',
      roles: {
        learner: { signerName: 'Andrew Raslan', signature: 'data:image/png;base64,test', confirmed: true, signedAt: '2026-03-31T10:00:00Z' },
        coach: { signerName: 'Coach One', signature: '', confirmed: false, signedAt: '' },
      },
    });

    expect(fetchMock).toHaveBeenCalledWith('/audit_api/learners/3221/signoff/?month=2026-03', expect.objectContaining({ method: 'POST' }));
  });
});

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
