import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { RecordingInsights } from './RecordingInsights';
import { loadRecordingInsights } from '@/api/recordingInsights';

vi.mock('@/api/recordingInsights', () => ({ loadRecordingInsights: vi.fn() }));
const file = { id: 'R', type: 'recording' as const, state: 'ready' as const };
beforeEach(() => vi.resetAllMocks());

it('loads staff detail only when opened and distinguishes missing provider data from zero', async () => {
  vi.mocked(loadRecordingInsights).mockResolvedValue({ audience: 'staff', learners: 2, finished: 1, watchedSeconds: 600,
    completionPercent: 50, updatedAt: '2026-11-10T10:00:00Z', provider: { state: 'unavailable' } });
  render(<RecordingInsights seriesId="S" file={file} />);
  expect(loadRecordingInsights).not.toHaveBeenCalled();
  const details = screen.getByText('Viewing insights').closest('details')!;
  details.open = true;
  fireEvent(details, new Event('toggle'));
  expect(await screen.findByText('50%')).toBeInTheDocument();
  expect(screen.getByText(/Bunny statistics are temporarily unavailable/)).toBeInTheDocument();
  expect(screen.queryByText(/0 Bunny/)).not.toBeInTheDocument();
});

it('keeps small learner counts and unavailable insights invisible', async () => {
  vi.mocked(loadRecordingInsights).mockResolvedValue({ audience: 'learner', highlights: { watched: 4, finished: 2 } });
  const view = render(<RecordingInsights seriesId="S" file={file} learner={{ kind: 'commercial', id: '1' }} />);
  await act(async () => undefined);
  expect(view.container).toBeEmptyDOMElement();
  vi.mocked(loadRecordingInsights).mockRejectedValue(new Error('Unavailable'));
  view.rerender(<RecordingInsights seriesId="S" file={{ ...file, id: 'OTHER' }} learner={{ kind: 'commercial', id: '1' }} />);
  await act(async () => undefined);
  expect(view.container).toBeEmptyDOMElement();
});

it('shows only verified positive learner counts without staff percentages or controls', async () => {
  vi.mocked(loadRecordingInsights).mockResolvedValue({ audience: 'learner', highlights: { watched: 120, finished: 35 } });
  render(<RecordingInsights seriesId="S" file={file} learner={{ kind: 'apprenticeship', id: '1' }} />);
  expect(await screen.findByLabelText('Learning community')).toHaveTextContent('120 learners watched');
  expect(screen.getByLabelText('Learning community')).toHaveTextContent('35 finished watching');
  expect(screen.queryByText('Viewing insights')).not.toBeInTheDocument();
  expect(screen.queryByText('%')).not.toBeInTheDocument();
});

it('does not show another recording’s counts while the next request is pending', async () => {
  vi.mocked(loadRecordingInsights).mockResolvedValueOnce({ audience: 'learner', highlights: { watched: 20, finished: 5 } });
  const learner = { kind: 'commercial' as const, id: '1' };
  const view = render(<RecordingInsights seriesId="S" file={file} learner={learner} />);
  await screen.findByLabelText('Learning community');
  vi.mocked(loadRecordingInsights).mockReturnValue(new Promise(() => {}));
  view.rerender(<RecordingInsights seriesId="S" file={{ ...file, id: 'OTHER' }} learner={learner} />);
  expect(view.container).toBeEmptyDOMElement();
});
