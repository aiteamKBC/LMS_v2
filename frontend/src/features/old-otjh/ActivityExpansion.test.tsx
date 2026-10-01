import { act, cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { ActivityExpansion } from './ActivityExpansion';
import type { Activity } from './api';

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ auth: { account: { id: 1 } } }) }));
afterEach(() => { cleanup(); vi.useRealTimers(); });

it('keeps an opened material without polling or focus-triggered timeouts', async () => {
  const row: Activity = { id: 7, title: 'Reading', category: 'Reading', activity_date: null,
    activity_time: null, planned_hours: 0, actual_hours: 1, timestamp_label: '',
    completion_note: null, accepted: true, documents: [], results: [] };
  const loadContent = vi.fn().mockResolvedValue({ id: 7, parts: [{ id: 10, title: 'PDF',
    url: '/learner_api/monthly-logs/1/2025-07/activities/7/materials/10/',
    content_type: 'application/pdf', html: null, quiz: null }] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><ActivityExpansion row={row} month="2025-07"
    loadContent={loadContent} contentScope="learner:1" onClose={() => {}} /></QueryClientProvider>);
  const frame = await screen.findByTitle('PDF');
  vi.useFakeTimers();
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); window.dispatchEvent(new Event('focus')); });
  expect(loadContent).toHaveBeenCalledTimes(1);
  expect(screen.getByTitle('PDF')).toBe(frame);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  client.clear();
});
