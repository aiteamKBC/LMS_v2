import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadModuleSessions, requestSessionSync, type ModuleSessionResults } from '@/api/sessionResults';
import { ModuleSessions } from '../ModuleSessions';

vi.mock('@/api/sessionResults', async importOriginal => ({
  ...await importOriginal<typeof import('@/api/sessionResults')>(),
  loadModuleSessions: vi.fn(), requestSessionSync: vi.fn(),
}));
vi.mock('@/components/feature/SessionResults', () => ({
  SessionResults: ({ seriesId, sessionNumber, displayTitle }: { seriesId: string; sessionNumber: number; displayTitle?: string }) =>
    <p>{seriesId}:{sessionNumber}:{displayTitle}</p>,
}));

function result(itemWeekTitle: string | null): ModuleSessionResults {
  return { jobs: [], series: [{ id: 'S1', title: 'Module', sessions: [{
    id: 'O7', seriesId: 'S1', sessionNumber: 7, itemTitle: 'Live Teams Session 1', itemWeekTitle,
    startsAt: '2026-11-06T09:00:00Z', endsAt: '2026-11-06T11:00:00Z', state: 'scheduled', reportReady: false,
  }] }] };
}

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('module session display titles', () => {
  it('opens the same series and occurrence with the owning week label', async () => {
    const data = result('Pricing');
    const original = structuredClone(data);
    vi.mocked(loadModuleSessions).mockResolvedValue(data);
    render(<ModuleSessions moduleId="M1" />);
    fireEvent.click(await screen.findByRole('button', { name: /Pricing \(Live Teams Session\)/ }));
    expect(screen.getByText('S1:7:Pricing (Live Teams Session)')).toBeInTheDocument();
    expect(data).toEqual(original);
    expect(requestSessionSync).not.toHaveBeenCalled();
  });

  it.each([null, '', '   '])('keeps the current item title without a confirmed week title', async title => {
    vi.mocked(loadModuleSessions).mockResolvedValue(result(title));
    render(<ModuleSessions moduleId="M1" />);
    expect(await screen.findByText('Live Teams Session 1')).toBeInTheDocument();
  });
});
