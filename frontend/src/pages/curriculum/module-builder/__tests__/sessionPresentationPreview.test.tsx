import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LearnerPreview } from '../LearnerPreview';
import { createEmptyComponent, createEmptyWeek, createLocalModuleDraft } from '../moduleAuthoringData';

vi.mock('@/components/feature/SessionResults', () => ({ SessionResults: ({ seriesId, sessionNumber, recordingsOnly }: { seriesId: string; sessionNumber: number; recordingsOnly?: boolean }) =>
  <div data-testid="saved-session" data-series={seriesId} data-number={sessionNumber} data-recordings-only={String(!!recordingsOnly)}>Saved session preview</div> }));
vi.mock('@/pages/learner/video-watch/page', () => ({ ComponentBody: () => <p>Original learner content</p> }));

describe('unified session learner preview', () => {
  it('uses the linked session recording and keeps the recording reflection accessible', async () => {
    const live = { ...createEmptyComponent('W', 'live-session', 1), id: 'L', moduleId: 'M', title: 'Organisational Context',
      settings: { teamsLiveSessionId: 'SERIES', teamsSessionNumber: 1 } };
    const recording = { ...createEmptyComponent('W', 'recording-placeholder', 2), id: 'R', moduleId: 'M', title: 'Session Recording',
      reflectionRequired: true, reflectionQuestion: 'Reflect on this recording', settings: { linkedLiveSessionComponentId: 'L' } };
    const module = { ...createLocalModuleDraft({ programme: 'Programme', title: 'Module', description: '', weeks: 0, status: 'draft' }),
      id: 'M', catalogueId: 'M', weekStructure: [{ ...createEmptyWeek('M', 1), id: 'W', components: [live, recording] }] };
    const before = structuredClone(module);
    render(<LearnerPreview module={module} initialComponentId="R" onClose={vi.fn()} />);
    const navigation = screen.getByRole('navigation', { name: 'Module content' });
    expect(within(navigation).getAllByText('Organisational Context')).toHaveLength(1);
    expect(await screen.findByTestId('saved-session')).toHaveAttribute('data-series', 'SERIES');
    expect(screen.getByTestId('saved-session')).toHaveAttribute('data-recordings-only', 'true');
    expect(screen.getByRole('textbox', { name: 'Reflect on this recording' })).toBeVisible();
    fireEvent.click(within(navigation).getByRole('button', { name: 'Live session' }));
    expect(await screen.findByText('Original learner content')).toBeVisible();
    expect(screen.getByTestId('saved-session')).toHaveAttribute('data-recordings-only', 'false');
    expect(module).toEqual(before);
  });
});
