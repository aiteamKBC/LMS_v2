import { StrictMode } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { clearAllCachedResources } from '@/api/cachedRequest';
import type { LearnerDetail } from '@/api/learnerDetail';
import type { StudentActivityResponse } from '@/api/studentActivity';
import { StudentActivityPanel } from './SubjectWorkspace';

beforeEach(() => { clearAllCachedResources(); vi.stubGlobal('fetch', vi.fn()); });
afterEach(() => { clearAllCachedResources(); vi.unstubAllGlobals(); });

it('starts metadata before the plan/history and shares one HTTP request across StrictMode and arriving data', async () => {
  let finish!: (response: Response) => void;
  vi.mocked(fetch).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const real = { components: [{ moduleId: 'MOD-1', module: 'Leadership', componentId: 'C1', component: 'Introduction', type: 'reading' }] } as LearnerDetail;
  const metadata = { covers: {}, current_subjects: [{ id: 'MOD-1', title: 'Leadership' }] };
  const view = (plan: LearnerDetail | null, loading: boolean, data: StudentActivityResponse | null = null) =>
    <StrictMode><MemoryRouter><StudentActivityPanel kind="commercial" learnerId="132" real={plan} data={data} loading={loading} error={null} onRetry={() => {}} /></MemoryRouter></StrictMode>;
  const { rerender } = render(view(null, true));
  expect(fetch).toHaveBeenCalledOnce();
  expect(String(vi.mocked(fetch).mock.calls[0][0])).toBe('/learner_api/subject-covers/132/?refs=');
  rerender(view(real, true));
  expect(fetch).toHaveBeenCalledOnce();
  await act(async () => finish(new Response(JSON.stringify(metadata))));
  expect(screen.getByRole('status')).toHaveTextContent('Loading subjects');
  expect(screen.queryByRole('button', { name: /Leadership/ })).not.toBeInTheDocument();
  rerender(view(real, false, { activities: [], covers: {} } as unknown as StudentActivityResponse));
  await waitFor(() => expect(screen.getByRole('button', { name: /Leadership/ })).toBeVisible());
  expect(fetch).toHaveBeenCalledOnce();
});

it('keeps historical artwork from the activity response when metadata loads independently', async () => {
  vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ covers: {}, current_subjects: [] })));
  const data = { subjects: [{ id: 8, name: 'Project controls' }], activities: [], covers: { 'legacy:8': '/test-cover.png' } } as unknown as StudentActivityResponse;
  render(<MemoryRouter><StudentActivityPanel kind="commercial" learnerId="132" data={data} loading={false} error={null} onRetry={() => {}} /></MemoryRouter>);
  expect(await screen.findByRole('img', { name: 'Project controls cover' })).toHaveAttribute('src', '/test-cover.png');
});
