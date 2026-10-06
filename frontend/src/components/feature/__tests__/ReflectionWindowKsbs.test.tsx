import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReflectionWindow } from '../ReflectionWindow';
import type { ComponentKsbMapping, LearnerKsbItem } from '@/api/learnerDetail';

vi.mock('@/api/evidence', () => ({ uploadEvidence: vi.fn() }));
vi.mock('@/api/reflectionVoice', () => ({
  proofreadLearningReflection: vi.fn(),
  transcribeVoiceReflection: vi.fn(),
}));
vi.mock('@/api/reflectionSubmission', () => ({
  loadLearningReflectionSubmission: vi.fn().mockResolvedValue(null),
  saveLearningReflectionSubmission: vi.fn(),
}));

const programmeKsbs: LearnerKsbItem[] = [
  { code: 'K1', type: 'K', number: '1', description: 'Marketing principles' },
  { code: 'S2', type: 'S', number: '2', description: 'Campaign planning' },
];

function renderWindow(autoKsbs: ComponentKsbMapping[] | undefined, learnerKsbs = programmeKsbs) {
  render(
    <ReflectionWindow
      noun="reading"
      learnerKsbs={learnerKsbs}
      autoKsbs={autoKsbs}
      elapsedSeconds={0}
      plannedTimeLabel="30m"
      submitting={false}
      submitError={null}
      onSubmit={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'KSBs' }));
}

describe('ReflectionWindow KSB tab', () => {
  beforeEach(() => {
    vi.stubGlobal('AppIcon', ({ className }: { className?: string }) => <i className={className} />);
  });

  it('lets the learner pick programme KSBs when the component has no mapped KSBs', () => {
    renderWindow([]);

    expect(screen.getByText('Select the programme KSBs this activity developed')).toBeInTheDocument();
    expect(screen.getByText('Select at least one KSB above to explain and rate it.')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Why is K1 relevant/)).not.toBeInTheDocument();

    const k1 = screen.getByRole('checkbox', { name: /K1\s*Marketing principles/ });
    fireEvent.click(k1);

    expect(k1).toBeChecked();
    expect(screen.getByPlaceholderText(/Why is K1 relevant/)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Why is S2 relevant/)).not.toBeInTheDocument();
    // Learner-chosen KSBs carry no authored weight, so none is shown.
    expect(screen.queryByText(/weight$/)).not.toBeInTheDocument();
    expect(screen.getByText('Selected KSBs')).toBeInTheDocument();
  });

  it('groups programme KSBs into K, S and B tabs', () => {
    renderWindow([], [...programmeKsbs, { code: 'S3', type: 'S', number: '3', description: 'Data analysis' }]);

    expect(screen.getByRole('tab', { name: /K\s*1/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /B\s*0/ })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /K1/ })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /S2/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /S\s*2/ }));
    expect(screen.queryByRole('checkbox', { name: /K1/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: /S3\s*Data analysis/ }));

    // A selection survives switching tabs and shows in the tab's count.
    expect(screen.getByRole('tab', { name: /S\s*1\/2/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /K\s*1/ }));
    expect(screen.getByPlaceholderText(/Why is S3 relevant/)).toBeInTheDocument();
  });

  it('keeps the KSB section incomplete until at least one programme KSB is chosen', () => {
    renderWindow([]);
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));

    expect(screen.getByText('Programme KSBs selected, explained and rated').closest('p'))
      .not.toHaveClass('text-emerald-700');
  });

  it('shows only the authored KSBs when the component has a mapping', () => {
    renderWindow([{ code: 'S2', description: 'Campaign planning', weight: 40, classification: 'primary' }]);

    expect(screen.queryByText('Select the programme KSBs this activity developed')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Why is S2 relevant/)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Why is K1 relevant/)).not.toBeInTheDocument();
    expect(screen.getByText('40% weight')).toBeInTheDocument();
  });

  it('does not block submission when neither the component nor the programme has KSBs', () => {
    renderWindow([], []);

    expect(screen.getByText('No KSBs are mapped to this activity and your programme has no KSBs to choose from.'))
      .toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    expect(screen.getByText('No mapped KSBs to rate').closest('p')).toHaveClass('text-emerald-700');
  });
});
