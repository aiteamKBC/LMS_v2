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
  const picker = screen.queryByRole('button', { name: 'Choose KSBs' });
  if (picker) fireEvent.click(picker);
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

    expect(screen.getByRole('tab', { name: /All\s*3/ })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('tab', { name: /K\s*1/ }));
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

    expect(screen.getByText('Selected KSBs explained and rated (any K, S or B)').closest('p'))
      .not.toHaveClass('text-emerald-700');
  });

  it('shows unrated confidence honestly and lets a learner explicitly choose the minimum rating', () => {
    renderWindow([]);
    fireEvent.click(screen.getByRole('checkbox', { name: /K1\s*Marketing principles/ }));
    fireEvent.change(screen.getByPlaceholderText(/Why is K1 relevant/), { target: { value: 'Applied the principles.' } });
    expect(screen.getAllByText('Not rated')).toHaveLength(2);
    expect(screen.getByRole('slider', { name: 'K1: Confidence before' })).toHaveAttribute('aria-valuetext', 'Not rated');
    fireEvent.change(screen.getByRole('slider', { name: 'K1: Confidence after' }), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    expect(screen.getByText('K1: confidence before')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Complete KSBs' }));
    fireEvent.click(screen.getByRole('button', { name: 'K1: set confidence before to 1 out of 5' }));
    expect(screen.getByRole('slider', { name: 'K1: Confidence before' })).toHaveAttribute('aria-valuetext', '1 out of 5');
    expect(screen.queryByText('Not rated')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    expect(screen.queryByText('KSB information still needed')).not.toBeInTheDocument();
    expect(screen.getByText('Selected KSBs explained and rated (any K, S or B)').closest('p')).toHaveClass('text-emerald-700');
  });

  // The ticket changes this contract: authored mappings suggest choices rather
  // than hiding the rest of the learner's programme.
  it('offers the whole programme while keeping the authored KSB weight', () => {
    renderWindow([{ code: 'S2', description: 'Campaign planning', weight: 40, classification: 'primary' }]);

    expect(screen.getByText('Select the programme KSBs this activity developed')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /K1\s*Marketing principles/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: /S2\s*Campaign planning/ }));
    expect(screen.getByPlaceholderText(/Why is S2 relevant/)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Why is K1 relevant/)).not.toBeInTheDocument();
    expect(screen.getByText('40% weight')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: /K1\s*Marketing principles/ }));
    expect(screen.getByPlaceholderText(/Why is K1 relevant/)).toBeInTheDocument();
    expect(screen.getAllByText(/weight$/)).toHaveLength(2); // Summary label and S2's authored weight only.
    expect(screen.queryByText('0% weight')).not.toBeInTheDocument();
  });

  it('requires only the selected K code even when the activity also maps S and B codes', () => {
    renderWindow([
      { code: 'K1', description: 'Marketing principles', weight: 20, classification: 'primary' },
      { code: 'S2', description: 'Campaign planning', weight: 30, classification: 'primary' },
      { code: 'B1', description: 'Professional behaviour', weight: 10, classification: 'primary' },
    ]);
    fireEvent.click(screen.getByRole('checkbox', { name: /K1\s*Marketing principles/ }));
    fireEvent.change(screen.getByPlaceholderText(/Why is K1 relevant/), { target: { value: 'The reading developed my knowledge.' } });
    for (const slider of screen.getAllByRole('slider')) fireEvent.change(slider, { target: { value: '4' } });
    expect(screen.queryByPlaceholderText(/Why is S2 relevant/)).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Why is B1 relevant/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    expect(screen.getByText('Selected KSBs explained and rated (any K, S or B)').closest('p')).toHaveClass('text-emerald-700');
  });

  it('does not block submission when neither the component nor the programme has KSBs', () => {
    renderWindow([], []);

    expect(screen.getByText('No KSBs are mapped to this activity and your programme has no KSBs to choose from.'))
      .toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    expect(screen.getByText('No mapped KSBs to rate').closest('p')).toHaveClass('text-emerald-700');
  });

  it('shows the ticket K7/S5 descriptions from the programme in choices and explanation cards', () => {
    renderWindow([
      { code: 'K7', description: null, weight: 20, classification: 'main' },
      { code: 'S5', description: '', weight: 40, classification: 'secondary' },
    ], [
      { code: 'K7', type: 'K', number: '7', description: 'Understand legal and regulatory frameworks.' },
      { code: 'S5', type: 'S', number: '5', description: 'Collaborate with clients and stakeholders.' },
      { code: 'B1', type: 'B', number: '1', description: 'Act professionally.' },
    ]);
    expect(screen.getAllByText('Suggested for this activity')).toHaveLength(2);
    fireEvent.click(screen.getByRole('checkbox', { name: /K7\s*Understand legal/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /S5\s*Collaborate/ }));
    expect(screen.getAllByText('Understand legal and regulatory frameworks.')).toHaveLength(2);
    expect(screen.getAllByText('Collaborate with clients and stakeholders.')).toHaveLength(2);
    expect(screen.getByText('60%')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: /B1\s*Act professionally/ }));
    expect(screen.getByPlaceholderText(/Why is B1 relevant/)).toBeInTheDocument();
    expect(screen.getByText('60%')).toBeInTheDocument();
    expect(screen.queryByText('0% weight')).not.toBeInTheDocument();
  });

  it('uses the current programme wording ahead of an outdated activity description', () => {
    renderWindow([{ code: 'K1', description: 'Outdated wording', weight: 20, classification: 'main' }]);
    expect(screen.queryByText('Outdated wording')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: /K1\s*Marketing principles/ }));
    expect(screen.getAllByText('Marketing principles')).toHaveLength(2);
  });

  it('does not offer activity mappings from outside the learner programme', () => {
    renderWindow([{ code: 'K99', description: 'Another programme', weight: 50, classification: 'main' }]);
    expect(screen.queryByRole('checkbox', { name: /K99/ })).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /K1/ })).toBeInTheDocument();
  });

  it('searches code and description without losing selections when a search is empty', () => {
    renderWindow([]);
    const search = screen.getByRole('searchbox', { name: 'Search KSBs' });
    expect(search).toHaveFocus();
    fireEvent.change(search, { target: { value: 's2' } });
    expect(screen.queryByRole('checkbox', { name: /K1/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: /S2/ }));
    fireEvent.change(search, { target: { value: 'no matching wording' } });
    expect(screen.getByRole('status')).toHaveTextContent('No KSBs match your search');
    expect(screen.getByPlaceholderText(/Why is S2 relevant/)).toBeInTheDocument();
    fireEvent.change(search, { target: { value: 'MARKETING' } });
    expect(screen.getByRole('checkbox', { name: /K1/ })).toBeInTheDocument();
    fireEvent.change(search, { target: { value: '' } });
    expect(screen.getByRole('checkbox', { name: /S2/ })).toBeChecked();
  });

  it('closes with Escape, returns keyboard focus, and retains choices when reopened', () => {
    renderWindow([]);
    fireEvent.click(screen.getByRole('checkbox', { name: /K1/ }));
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Escape' });
    const toggle = screen.getByRole('button', { name: 'Choose KSBs' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveFocus();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Why is K1 relevant/)).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.getByRole('checkbox', { name: /K1/ })).toBeChecked();
  });

  it('preserves the mapped-only flow without a programme catalogue and explains a missing description', () => {
    renderWindow([{ code: 'K7', description: null, weight: 20, classification: 'main' }], []);
    fireEvent.click(screen.getByRole('checkbox', { name: /K7\s*Description not available/ }));
    expect(screen.getAllByText('Description not available for this KSB.')).toHaveLength(2);
    expect(screen.getByText('20% weight')).toBeInTheDocument();
  });
});
