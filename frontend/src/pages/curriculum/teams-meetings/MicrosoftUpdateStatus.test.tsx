import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { coachFetch } from '@/lib/coachFetch';
import { MicrosoftUpdateStatus } from './MicrosoftUpdateStatus';
import { microsoftUpdateFromSave, readMicrosoftUpdate, type MicrosoftUpdateSummary } from './microsoftUpdateState';

vi.mock('@/lib/coachFetch', () => ({ coachFetch: vi.fn() }));
vi.mock('@/lib/curriculumApi', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/curriculumApi')>()), clearCurriculumGetCache: vi.fn(),
}));

const refused = {
  status: 403, code: 'Forbidden', message: 'insufficient permissions',
  requestId: '2b7979e0-6f5a-411b-b0fa-6a087e438bc5', at: '2026-10-08T12:00:00+00:00',
};
const failed: MicrosoftUpdateSummary = {
  state: 'failed', pendingGroups: ['settings'], lastError: refused, retryable: true,
  message: 'Microsoft refused this meeting’s lobby, recording, transcription and language. Invitations and dates are saved.',
};

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => cleanup());

describe('save results', () => {
  it('an invitation-only save Microsoft accepted is Saved', () => {
    expect(microsoftUpdateFromSave({ optionsApplied: true, optionsPending: [], warnings: [] })?.state).toBe('saved');
  });

  it('a refused settings write is Failed, with Microsoft’s request ID, never Saved', () => {
    const status = microsoftUpdateFromSave({
      optionsApplied: false, optionsPending: ['settings'], partial: true,
      warnings: [{ code: 'teams_meeting_options_not_applied', message: 'Invitations and dates were saved, but…', graphError: refused }],
    });
    expect(status?.state).toBe('failed');
    expect(status?.retryable).toBe(true);
    expect(status?.lastError?.requestId).toBe(refused.requestId);
  });

  it('options left from an earlier save are Pending Microsoft update', () => {
    expect(microsoftUpdateFromSave({ optionsApplied: true, optionsPending: ['roles'], warnings: [] })?.state).toBe('pending');
  });

  it('an older response without the fields shows no state rather than guessing', () => {
    expect(microsoftUpdateFromSave({ updated: true, warnings: [] })).toBeNull();
    expect(readMicrosoftUpdate({ state: 'done' })).toBeNull();
  });
});

describe('Microsoft update status', () => {
  it('shows Failed with the request ID and retries with one POST to the retry endpoint only', async () => {
    vi.mocked(coachFetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        retried: ['settings'], confirmed: ['settings'], remaining: [], message: 'Microsoft confirmed the meeting settings.',
        microsoftUpdate: { state: 'saved', pendingGroups: [], lastError: null, retryable: false, message: 'Microsoft holds everything saved here.' },
      }),
    } as Response);
    const onChange = vi.fn();
    render(<MicrosoftUpdateStatus liveSessionId="LIVE-1" status={failed} onChange={onChange} />);
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getByText(/request ID 2b7979e0-6f5a-411b-b0fa-6a087e438bc5/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry Microsoft update' }));
    expect(await screen.findByText('Saved')).toBeInTheDocument();
    expect(screen.getByText('Microsoft confirmed the meeting settings.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry Microsoft update' })).not.toBeInTheDocument();
    expect(coachFetch).toHaveBeenCalledExactlyOnceWith(
      '/curriculum_api/curriculum/teams-meetings/LIVE-1/retry-options/',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
    );
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ state: 'saved' }));
  });

  it('a retry Microsoft still refuses stays Failed', async () => {
    vi.mocked(coachFetch).mockResolvedValue({
      ok: true,
      json: async () => ({ retried: ['settings'], remaining: ['settings'], message: 'Microsoft did not confirm every setting.', microsoftUpdate: failed }),
    } as Response);
    render(<MicrosoftUpdateStatus liveSessionId="LIVE-1" status={failed} />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry Microsoft update' }));
    expect(await screen.findByText('Microsoft did not confirm every setting.')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
  });

  it('a retry that could not run says nothing changed and keeps the state', async () => {
    vi.mocked(coachFetch).mockResolvedValue({
      ok: false, json: async () => ({ error: 'The retry could not finish. Invitations and dates are unchanged.' }),
    } as Response);
    render(<MicrosoftUpdateStatus liveSessionId="LIVE-1" status={failed} />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry Microsoft update' }));
    expect(await screen.findByText('The retry could not finish. Invitations and dates are unchanged.')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
  });

  it('Saved offers no retry, and no status renders nothing', () => {
    const { container, rerender } = render(<MicrosoftUpdateStatus liveSessionId="LIVE-1"
      status={{ state: 'saved', pendingGroups: [], lastError: null, retryable: false, message: '' }} />);
    expect(screen.getByText('Saved')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    rerender(<MicrosoftUpdateStatus liveSessionId="LIVE-1" status={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
