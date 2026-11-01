import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  connectImportedCalendar, confirmImportedCalendarUpdate, disconnectOrganizationCalendar,
  fetchOrganizationCalendarConnection, type OrganizationCalendarConnection,
} from '@/lib/curriculumApi';
import { coachFetch } from '@/lib/coachFetch';
import { OrganizationCalendarConnectionPanel } from '../OrganizationCalendarConnectionPanel';

vi.mock('@/lib/curriculumApi', () => ({
  connectImportedCalendar: vi.fn(), disconnectOrganizationCalendar: vi.fn(),
  fetchOrganizationCalendarConnection: vi.fn(), fetchImportedCalendarConnection: vi.fn(),
  previewImportedCalendarUpdate: vi.fn(), confirmImportedCalendarUpdate: vi.fn(), checkImportedCalendarUpdate: vi.fn(),
}));
vi.mock('@/lib/coachFetch', () => ({ coachFetch: vi.fn() }));

const state = (changes: Partial<OrganizationCalendarConnection> = {}): OrganizationCalendarConnection => ({
  applicable: true, available: true, connected: false, organizationManaged: false, calendarKind: 'group',
  state: 'disconnected', canManageOrganization: false, revision: 'synthetic-revision',
  message: 'An LMS administrator connects this calendar for authorised staff.', ...changes,
});
const connected = (changes: Partial<OrganizationCalendarConnection> = {}) => state({
  connected: true, organizationManaged: true, state: 'active',
  message: 'Connected for the organization. Microsoft access is refreshed automatically.', ...changes,
});

function open() {
  const onChanged = vi.fn();
  return { onChanged, ...render(<OrganizationCalendarConnectionPanel liveSessionId="LIVE-ORG" disabled={false} onChanged={onChanged} />) };
}

beforeEach(() => {
  vi.mocked(fetchOrganizationCalendarConnection).mockReset().mockResolvedValue(state());
  vi.mocked(disconnectOrganizationCalendar).mockReset().mockResolvedValue({ disconnected: true });
  vi.mocked(connectImportedCalendar).mockReset().mockResolvedValue({
    authorizationUrl: 'https://login.microsoftonline.com/synthetic/authorize', callbackOrigin: 'https://lms.example.invalid',
  });
  vi.mocked(confirmImportedCalendarUpdate).mockReset();
  vi.mocked(coachFetch).mockReset().mockRejectedValue(new Error('Unexpected API transport'));
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Live networking is forbidden'); }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('organization calendar access', () => {
  it('shows staff the admin prerequisite without asking them to sign in or disconnect', async () => {
    open();
    expect(await screen.findByText(state().message!)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Connect organization calendar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Disconnect organization calendar' })).not.toBeInTheDocument();
    expect(connectImportedCalendar).not.toHaveBeenCalled();
  });

  it('shows existing institutional access to staff without per-user connection controls', async () => {
    vi.mocked(fetchOrganizationCalendarConnection).mockResolvedValue(connected());
    open();
    expect(await screen.findByText('Connected · renews automatically')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Connect organization calendar' })).not.toBeInTheDocument();
    expect(disconnectOrganizationCalendar).not.toHaveBeenCalled();
  });

  it('rechecks original-calendar access when staff explicitly refresh institutional status', async () => {
    vi.mocked(fetchOrganizationCalendarConnection).mockResolvedValue(connected());
    const { onChanged } = open();
    await userEvent.click(await screen.findByRole('button', { name: 'Refresh organization connection' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledOnce());
    expect(connectImportedCalendar).not.toHaveBeenCalled();
    expect(confirmImportedCalendarUpdate).not.toHaveBeenCalled();
  });

  it('lets an admin establish renewable access and refreshes the editor only after server confirmation', async () => {
    vi.mocked(fetchOrganizationCalendarConnection)
      .mockResolvedValueOnce(state({ canManageOrganization: true }))
      .mockResolvedValue(connected({ canManageOrganization: true }));
    const popup = { location: { href: '' }, closed: false, close: vi.fn() } as unknown as Window;
    vi.spyOn(window, 'open').mockReturnValue(popup);
    const { onChanged, unmount } = open();
    await userEvent.click(await screen.findByRole('button', { name: 'Connect organization calendar' }));
    expect(connectImportedCalendar).toHaveBeenCalledExactlyOnceWith('LIVE-ORG', 'group', true);
    fireEvent(window, new MessageEvent('message', {
      source: popup, origin: 'https://lms.example.invalid', data: { type: 'lms:teams-calendar-connected', liveSessionId: 'LIVE-ORG', ok: true },
    }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledOnce());
    expect(fetchOrganizationCalendarConnection).toHaveBeenCalledTimes(3);
    expect(confirmImportedCalendarUpdate).not.toHaveBeenCalled();
    unmount();
  });

  it('does not accept a personal connection as the requested institutional connection', async () => {
    vi.mocked(fetchOrganizationCalendarConnection)
      .mockResolvedValueOnce(state({ canManageOrganization: true }))
      .mockResolvedValue(connected({ organizationManaged: false }));
    const popup = { location: { href: '' }, closed: false, close: vi.fn() } as unknown as Window;
    vi.spyOn(window, 'open').mockReturnValue(popup);
    const { onChanged, unmount } = open();
    await userEvent.click(await screen.findByRole('button', { name: 'Connect organization calendar' }));
    fireEvent(window, new MessageEvent('message', {
      source: popup, origin: 'https://lms.example.invalid', data: { type: 'lms:teams-calendar-connected', liveSessionId: 'LIVE-ORG', ok: true },
    }));
    expect(await screen.findByRole('alert')).toHaveTextContent('original group calendar');
    expect(onChanged).not.toHaveBeenCalled();
    unmount();
  });

  it('disconnects only the displayed revision and then rechecks original-calendar access', async () => {
    vi.mocked(fetchOrganizationCalendarConnection).mockResolvedValueOnce(connected({ canManageOrganization: true }))
      .mockResolvedValue(state({ canManageOrganization: true }));
    const { onChanged } = open();
    await userEvent.click(await screen.findByText('Manage organization connection'));
    await userEvent.click(screen.getByRole('button', { name: 'Disconnect organization calendar' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledOnce());
    expect(disconnectOrganizationCalendar).toHaveBeenCalledExactlyOnceWith('LIVE-ORG', 'synthetic-revision');
    expect(connectImportedCalendar).not.toHaveBeenCalled();
    expect(confirmImportedCalendarUpdate).not.toHaveBeenCalled();
  });

  it('keeps failed disconnects visible without reporting success or retrying the mutation', async () => {
    vi.mocked(fetchOrganizationCalendarConnection).mockResolvedValue(connected({ canManageOrganization: true }));
    vi.mocked(disconnectOrganizationCalendar).mockRejectedValue(new Error('The organization connection changed. Reload its status.'));
    const { onChanged } = open();
    await userEvent.click(await screen.findByText('Manage organization connection'));
    await userEvent.click(screen.getByRole('button', { name: 'Disconnect organization calendar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('connection changed');
    expect(disconnectOrganizationCalendar).toHaveBeenCalledOnce();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('does not start consent while the required migration is unavailable', async () => {
    vi.mocked(fetchOrganizationCalendarConnection).mockResolvedValue(state({
      available: false, state: 'migration_required', canManageOrganization: true, message: 'Apply the organization calendar migration.',
    }));
    open();
    expect(await screen.findByText('Apply the organization calendar migration.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Connect organization calendar' })).not.toBeInTheDocument();
  });

  it('stays out of personal calendars and ignores replies for a previous module', async () => {
    let finish!: (value: OrganizationCalendarConnection) => void;
    vi.mocked(fetchOrganizationCalendarConnection).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }))
      .mockResolvedValue(state({ applicable: false, state: 'not_applicable' }));
    const { rerender, container } = open();
    rerender(<OrganizationCalendarConnectionPanel liveSessionId="OTHER" disabled={false} onChanged={vi.fn()} />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    await act(async () => finish(connected()));
    expect(container).toBeEmptyDOMElement();
  });
});

describe('organization connection transport', () => {
  it('reads institutional status without sending credentials or starting consent', async () => {
    const api = await vi.importActual<typeof import('@/lib/curriculumApi')>('@/lib/curriculumApi');
    vi.mocked(coachFetch).mockResolvedValue(new Response(JSON.stringify(connected()), { status: 200 }));
    await api.fetchOrganizationCalendarConnection('LIVE /scope');
    expect(coachFetch).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('/LIVE%20%2Fscope/imported-calendar/connection/?organization=1'), { cache: 'no-store' });
  });

  it('sends an explicit institutional flag and exact revision, without automatically retrying a failed disconnect', async () => {
    const api = await vi.importActual<typeof import('@/lib/curriculumApi')>('@/lib/curriculumApi');
    vi.mocked(coachFetch).mockRejectedValue(new Error('Connection lost'));
    await expect(api.disconnectOrganizationCalendar('LIVE-ORG', 'reviewed-revision')).rejects.toThrow('Connection lost');
    expect(coachFetch).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('/LIVE-ORG/imported-calendar/connect/'),
      expect.objectContaining({ method: 'POST', body: JSON.stringify({
        calendarKind: 'group', organizationManaged: true, action: 'disconnect', organizationRevision: 'reviewed-revision',
      }) }));
  });
});
