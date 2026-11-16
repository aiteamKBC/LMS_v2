import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import ActionsList from './components/ActionsList';
import ConcernList from './components/ConcernList';
import HealthOverview from './components/HealthOverview';
import OverviewKpis from './components/OverviewKpis';
import QualityDonuts from './components/QualityDonuts';
import RegistryTable from './components/RegistryTable';
import type { FormDefinition, QualityRecord } from '@/types/qms';

afterEach(cleanup);

describe('executive overview source availability', () => {
  it('distinguishes unavailable indicators from a confirmed empty result', () => {
    const { rerender } = render(<MemoryRouter><OverviewKpis records={[]} actions={[]} forms={[]}
      availability={{ actions: false, criticalIssues: false, feedback: false }} /></MemoryRouter>);
    expect(screen.getAllByText('—')).toHaveLength(3);
    expect(screen.getByText('Critical issue data is unavailable')).toBeInTheDocument();
    expect(screen.getByText('Action status data is unavailable')).toBeInTheDocument();
    expect(screen.getByText('Feedback response data is unavailable')).toBeInTheDocument();
    expect(screen.queryByText('No critical concerns in scope')).not.toBeInTheDocument();
    rerender(<MemoryRouter><OverviewKpis records={[]} actions={[]} forms={[]}
      availability={{ actions: true, criticalIssues: true, feedback: true }} /></MemoryRouter>);
    expect(screen.queryByText('Critical issue data is unavailable')).not.toBeInTheDocument();
    expect(screen.getByText('No critical concerns in scope')).toBeInTheDocument();
    expect(screen.getByText('0 past target date')).toBeInTheDocument();
  });

  it('does not claim actions were resolved when their statuses are unavailable', () => {
    render(<MemoryRouter><ActionsList actions={[]} available={false} /></MemoryRouter>);
    expect(screen.getByText('Action status data is unavailable')).toBeInTheDocument();
    expect(screen.queryByText('No open actions in scope')).not.toBeInTheDocument();
    expect(screen.queryByText('All improvement actions for these filters are resolved or closed.')).not.toBeInTheDocument();
  });

  it('retains the confirmed empty-action state when action data is available', () => {
    render(<MemoryRouter><ActionsList actions={[]} available /></MemoryRouter>);
    expect(screen.getByText('No open actions in scope')).toBeInTheDocument();
    expect(screen.getByText('All improvement actions for these filters are resolved or closed.')).toBeInTheDocument();
  });

  it('does not report zero critical outcomes when critical flags are unavailable', () => {
    render(<HealthOverview records={[]} actions={[]} availability={{ actions: false, criticalIssues: false }} />);
    expect(screen.getByText('Critical issue data is unavailable')).toBeInTheDocument();
    expect(screen.queryByText('No critical red outcomes in scope')).not.toBeInTheDocument();
  });

  it('does not claim concern themes were extracted when the source is unavailable', () => {
    render(<ConcernList themes={[]} available={false} />);
    expect(screen.getByText('Recurring concern data is unavailable. No trend is inferred.')).toBeInTheDocument();
    expect(screen.queryByText(/Themes are extracted from linked records only/)).not.toBeInTheDocument();
  });

  it('retains every stored criterion rating instead of dropping Gold and Not applicable', () => {
    const record: QualityRecord = {
      id: 'synthetic-review', formId: 'MCM', formName: 'Synthetic MCM', category: 'Quality Audit',
      subjectType: 'Coach', subjectName: 'Synthetic Coach', department: 'Not available', programme: 'Not available',
      respondentType: 'Coach', respondentName: 'Synthetic Coach', auditor: 'Synthetic Reviewer', assessedOn: '2026-10-20',
      rag: 'unrated', policyVersion: null, critical: false, summary: 'Completed review', learnerRef: null,
      answeredQuestions: 3, totalQuestions: 3, ratingCounts: { gold: 1, green: 1, amber: 0, red: 0, na: 1 },
    };
    render(<QualityDonuts records={[record]} selectedCoach="All coaches" selectedTutor="All tutors" feedbackAvailable={false} />);
    const ratings = within(screen.getByRole('region', { name: 'Criterion ratings' }));
    expect(ratings.getByText('Gold')).toBeInTheDocument();
    expect(ratings.getByText('Not applicable')).toBeInTheDocument();
    expect(ratings.getByText('3 criteria with stored ratings')).toBeInTheDocument();
    expect(ratings.queryByText('100%')).not.toBeInTheDocument();
  });

  it('distinguishes unavailable feedback scores from a confirmed empty distribution', () => {
    const { rerender } = render(<QualityDonuts records={[]} selectedCoach="All coaches" selectedTutor="All tutors" feedbackAvailable={false} />);
    const feedback = within(screen.getByRole('region', { name: 'Feedback quality' }));
    expect(feedback.getByText('Feedback rating data is unavailable.')).toBeInTheDocument();
    expect(feedback.queryByRole('img')).not.toBeInTheDocument();
    rerender(<QualityDonuts records={[]} selectedCoach="All coaches" selectedTutor="All tutors" feedbackAvailable />);
    expect(feedback.queryByText('Feedback rating data is unavailable.')).not.toBeInTheDocument();
    expect(feedback.getByText('No feedback responses rated returned')).toBeInTheDocument();
  });

  it('identifies saved-record completion without inventing a schedule denominator', () => {
    const form: FormDefinition = {
      id: 'MCM', name: 'Synthetic MCM', shortName: 'Synthetic MCM', category: 'Quality Audit', version: '1',
      sourceTable: 'synthetic', owner: 'Quality Assurance', respondentType: 'Coach', subjectType: 'Coach',
      questionCount: 1, answerTypes: ['Criteria rating'], scoringMethod: 'Criteria captured', policyId: null,
      policyVersion: null, policySummary: 'No approved policy', requiresAction: false, access: 'Curriculum quality access',
      scheduled: 0, submissions: 1, latest: '2026-10-20', completionRate: 1, ragSupported: false,
      rag: { green: 0, amber: 0, red: 0, unrated: 1, na: 0, total: 1 },
    };
    render(<RegistryTable forms={[form]} />);
    expect(screen.getByText('100% of saved records completed')).toBeInTheDocument();
    expect(screen.queryByText('100% of 0')).not.toBeInTheDocument();
  });
});
