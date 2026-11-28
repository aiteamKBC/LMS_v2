import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ReviewSectionDefinition } from '@/api/reviewInstances';
import { SkillsRadarSection } from '../SkillsRadarSection';
import { ReviewFormRenderer } from '../ReviewFormRenderer';

function section(maximum = 5): ReviewSectionDefinition {
  return { id: 'lms-skills-radar', title: 'Skills Radar', displayOrder: 1, estimatedMinutes: 0, enabled: true,
    fields: (['learner', 'coach', 'goal'] as const).map((kind, index) => ({
      id: kind, title: kind, fieldType: 'list_item', required: false, displayOrder: index,
      configuration: { skillsRadar: { questionId: '12:34', standardId: '12', standard: 'Example standard',
        question: 'B1: Complete work professionally', kind, role: kind === 'learner' ? 'participant' : 'advisor',
        levels: Array.from({ length: maximum }, (_, i) => ({ value: String(i + 1), label: `Competence description ${i + 1}` })),
        ...(kind === 'coach' ? { capturedAt: '2026-03-01T10:00:00Z', baseline: [{ role: 'advisor', value: '4', at: '2026-02-01T10:00:00Z' }],
          history: [{ role: 'advisor', value: '3', at: '2026-03-02T10:00:00Z' }] } : {}),
      } },
    })) };
}

function Form({ role, readOnly = false, maximum = 5, initial = { learner: '2', coach: '4', goal: '5' },
  change = vi.fn() }: { role?: 'participant' | 'employer'; readOnly?: boolean; maximum?: number;
    initial?: Record<string, string>; change?: (id: string, value: unknown) => void }) {
  const [answers, setAnswers] = useState<Record<string, unknown>>(initial);
  return <SkillsRadarSection section={section(maximum)} answers={answers} respondentRole={role} readOnly={readOnly}
    onAnswerChange={(id, value) => { change(id, value); setAnswers(previous => ({ ...previous, [id]: value })); }} />;
}

function openQuestion() {
  fireEvent.click(screen.getByRole('button', { name: 'Assess B1: Complete work professionally' }));
  return screen.getByRole('dialog');
}

describe('Skills Radar review assessments', () => {
  it.each([5, 8])('shows all %s assessment and goal options in read-only coach preview without allowing changes', maximum => {
    const change = vi.fn();
    render(<Form readOnly maximum={maximum} change={change} />);
    const panel = openQuestion();
    expect(within(panel).getByText(/Read-only preview/)).toBeInTheDocument();
    const coach = within(panel).getByRole('group', { name: 'Coach assessment' });
    const radios = within(coach).getAllByRole('radio');
    expect(radios).toHaveLength(maximum);
    for (const radio of radios) {
      expect(radio).toBeDisabled();
      fireEvent.click(radio);
    }
    expect(within(coach).getByRole('radio', { name: 'Competence description 4' })).toBeChecked();
    const goal = within(panel).getByRole('combobox', { name: 'Goal' });
    expect(goal).toBeDisabled();
    fireEvent.change(goal, { target: { value: '1' } });
    fireEvent.click(within(panel).getByText('View goal options'));
    expect(within(within(panel).getByRole('list', { name: 'Goal options' })).getAllByRole('listitem')).toHaveLength(maximum);
    expect(change).not.toHaveBeenCalled();
  });

  it('shows carried ratings as editable starting values with separate provenance', () => {
    const carried = section();
    for (const field of carried.fields) {
      const metadata = field.configuration.skillsRadar as Record<string, unknown>;
      metadata.continuation = { status: 'copied', message: 'Started from the previous review’s saved assessments.', plannedDate: '2026-10-01' };
      metadata.carriedAnswer = field.id === 'goal' ? '5' : '4';
    }
    const change = vi.fn();
    render(<SkillsRadarSection section={carried} answers={{ learner: '4', coach: '4', goal: '5' }} onAnswerChange={change} />);
    expect(screen.getByRole('status')).toHaveTextContent('Previous review:');
    expect(screen.getByText('Working Toward')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show history' }));
    expect(screen.getByText(/Previous review coach assessment: 4/)).toBeInTheDocument();
    const panel = openQuestion();
    fireEvent.click(within(within(panel).getByRole('group', { name: 'Coach assessment' })).getByRole('radio', { name: 'Competence description 5' }));
    expect(change).toHaveBeenCalledWith('coach', '5');
    expect(within(panel).getByRole('group', { name: 'Learner assessment' })).toBeDisabled();
  });

  it('switches answer and goal wording between knowledge, skill and behaviour questions', () => {
    const typed = section();
    typed.fields = (['K', 'S', 'B'] as const).flatMap(code => section().fields.map(field => {
      const labels = code === 'K'
        ? ['No understanding', 'Slight understanding', 'Moderate understanding', 'Strong understanding', 'Significant understanding']
        : ['Never', 'Rarely', 'Sometimes', 'Often', 'Always'];
      return { ...field, id: `${code}:${field.id}`, configuration: { ...field.configuration, skillsRadar: {
        ...(field.configuration.skillsRadar as Record<string, unknown>), questionId: code, question: `${code}1: Example competency`,
        levels: labels.map((label, index) => ({ value: String(index + 1), label })),
      } } };
    }));
    const change = vi.fn();
    render(<SkillsRadarSection section={typed} answers={{}} onAnswerChange={change} />);
    fireEvent.click(screen.getByRole('button', { name: 'Assess K1: Example competency' }));
    let panel = screen.getByRole('dialog');
    expect(within(panel).getByRole('radio', { name: 'Significant understanding' })).toBeInTheDocument();
    expect(within(panel).getByRole('option', { name: '5 — Significant understanding' })).toBeInTheDocument();
    fireEvent.change(within(panel).getByRole('combobox', { name: 'Goal' }), { target: { value: '4' } });
    expect(change).toHaveBeenLastCalledWith('K:goal', '4');
    for (const code of ['S', 'B']) {
      fireEvent.click(within(panel).getByRole('button', { name: 'Next question' }));
      panel = screen.getByRole('dialog');
      expect(within(panel).getByRole('heading', { name: `${code}1: Example competency` })).toBeInTheDocument();
      expect(within(panel).getByRole('radio', { name: 'Always' })).toBeInTheDocument();
      expect(within(panel).getByRole('option', { name: '5 — Always' })).toBeInTheDocument();
      expect(within(panel).queryByRole('option', { name: '5 — Significant understanding' })).not.toBeInTheDocument();
    }
  });

  it.each([['4', '5', 'Working Toward'], ['5', '5', 'Achieved'], ['5', '4', 'Achieved'], ['', '5', 'Not assessed'], ['4', '', 'Not assessed']])(
    'compares coach %s against goal %s, independently of learner score', (coach, goal, expected) => {
      render(<Form initial={{ learner: '1', coach, goal }} />);
      expect(screen.getByText(expected)).toBeInTheDocument();
    });

  it('allows the coach to choose their score and goal while preserving the learner score', () => {
    const change = vi.fn(); render(<Form change={change} />);
    const panel = openQuestion();
    const coach = within(panel).getByRole('group', { name: 'Coach assessment' });
    const learner = within(panel).getByRole('group', { name: 'Learner assessment' });
    expect(learner).toBeDisabled();
    expect(within(learner).getByText('2 — Competence description 2')).toBeInTheDocument();
    fireEvent.click(within(coach).getByRole('radio', { name: 'Competence description 5' }));
    fireEvent.change(within(panel).getByRole('combobox', { name: 'Goal' }), { target: { value: '4' } });
    expect(change.mock.calls).toEqual([['coach', '5'], ['goal', '4']]);
    expect(within(panel).getByText('Achieved')).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole('button', { name: 'Done' }));
    expect(screen.getByRole('img', { name: 'Learner assessment: 2' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Coach assessment: 5' })).toBeInTheDocument();
    openQuestion(); expect(screen.getByRole('combobox', { name: 'Goal' })).toHaveValue('4');
  });

  it('allows learner self-assessment only; employer and frozen views are read-only', () => {
    const { unmount } = render(<Form role="participant" />);
    let panel = openQuestion();
    expect(within(panel).getByRole('group', { name: 'Learner assessment' })).not.toBeDisabled();
    expect(within(panel).getByRole('group', { name: 'Coach assessment' })).toBeDisabled();
    expect(within(panel).getByRole('combobox', { name: 'Goal' })).toBeDisabled();
    unmount();
    const employer = render(<Form role="employer" />); panel = openQuestion();
    expect(within(panel).getAllByRole('group').every(control => (control as HTMLFieldSetElement).disabled)).toBe(true);
    expect(within(panel).getByRole('combobox', { name: 'Goal' })).toBeDisabled(); employer.unmount();
    render(<Form readOnly />); panel = openQuestion();
    // The goal-options disclosure is also an ARIA group; it stays browsable.
    expect(within(panel).getByRole('group', { name: 'Learner assessment' })).toBeDisabled();
    expect(within(panel).getByRole('group', { name: 'Coach assessment' })).toBeDisabled();
    expect(within(panel).getByRole('combobox', { name: 'Goal' })).toBeDisabled();
  });

  it('uses the imported scale including an eight-point standard', () => {
    render(<Form maximum={8} initial={{}} />); const panel = openQuestion();
    expect(within(panel).getAllByRole('radio')).toHaveLength(8);
    expect(within(panel).getByRole('option', { name: '8 — Competence description 8' })).toBeInTheDocument();
    expect(within(panel).getByRole('combobox', { name: 'Goal' })).toHaveValue('');
  });

  it('closes with Escape and returns keyboard focus to the question', () => {
    render(<Form />);
    const button = screen.getByRole('button', { name: /Assess B1/ }); button.focus();
    const panel = openQuestion();
    expect(within(panel).getByRole('button', { name: 'Close' })).toHaveFocus();
    fireEvent.keyDown(panel, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(button).toHaveFocus();
  });

  it('labels imported reference separately from the current review history and answers', () => {
    render(<Form initial={{}} />); fireEvent.click(screen.getByRole('checkbox', { name: 'Show history' }));
    expect(screen.getByText(/Coach assessment: 3/)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Imported Aptem reference/));
    expect(screen.getByText(/these are not assessments recorded in this review/)).toBeInTheDocument();
    expect(screen.getByText(/Imported staff assessment: 4/)).toBeInTheDocument();
    expect(screen.getByText('Not assessed')).toBeInTheDocument();
  });

  it('renders the assessment panel through the shared form before the historical adapter', () => {
    const adapter = vi.fn(() => <p>Historical adapter</p>);
    render(<ReviewFormRenderer sections={[section()]} answers={{}} onAnswerChange={vi.fn()} openSectionId="lms-skills-radar"
      onOpenSectionChange={vi.fn()} renderSectionContent={adapter} />);
    expect(screen.getByRole('button', { name: /Assess B1/ })).toBeInTheDocument();
    expect(adapter).not.toHaveBeenCalled();
  });
});
