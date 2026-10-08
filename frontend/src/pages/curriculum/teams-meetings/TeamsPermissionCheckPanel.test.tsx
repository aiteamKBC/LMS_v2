import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { coachFetch } from '@/lib/coachFetch';
import { TeamsPermissionCheckPanel } from './TeamsPermissionCheckPanel';

vi.mock('@/lib/coachFetch', () => ({ coachFetch: vi.fn() }));

const report = {
  checkedAt: '2026-10-08T12:00:00+00:00', readOnly: true, verdict: 'fail',
  app: { clientId: 'app-client-id', tenantId: 'tenant', permissionContext: 'application (client credentials)' },
  organizer: { email: 'tutor@example.invalid', objectId: '737679b4-8eac-4fe9-a491-76d8cdf65f6d', directoryObjectId: '' },
  meeting: { onlineMeetingId: 'M', graphPath: 'users/737679b4/onlineMeetings/M' },
  checks: [{ key: 'meeting_access', status: 'fail', summary: 'Microsoft refused to let the app read this meeting as its organiser.',
    graphError: { status: 403, code: 'Forbidden', message: 'No application access policy found for this app', requestId: 'req-1', at: '2026-10-08T12:00:00+00:00' } }],
  actions: ['Ask a Teams administrator to confirm the application access policy.'],
  adminCommands: ['Connect-MicrosoftTeams'],
};

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => cleanup());

describe('Microsoft permission check', () => {
  it('reads once with GET and shows the organiser, the Graph error and what to do', async () => {
    vi.mocked(coachFetch).mockResolvedValue({ ok: true, json: async () => report } as Response);
    render(<TeamsPermissionCheckPanel liveSessionId="LIVE-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Check Microsoft permissions' }));
    expect(await screen.findByText('737679b4-8eac-4fe9-a491-76d8cdf65f6d')).toBeInTheDocument();
    expect(screen.getByText(/request ID req-1/)).toBeInTheDocument();
    expect(screen.getByText('Ask a Teams administrator to confirm the application access policy.')).toBeInTheDocument();
    expect(coachFetch).toHaveBeenCalledExactlyOnceWith(
      '/curriculum_api/curriculum/teams-meetings/LIVE-1/permission-check/', { method: 'GET' });
  });

  it('says the check failed without claiming anything changed', async () => {
    vi.mocked(coachFetch).mockResolvedValue({ ok: false, json: async () => ({ error: 'The permission check could not finish. Nothing was changed.' }) } as Response);
    render(<TeamsPermissionCheckPanel liveSessionId="LIVE-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Check Microsoft permissions' }));
    expect(await screen.findByText('The permission check could not finish. Nothing was changed.')).toBeInTheDocument();
  });
});
