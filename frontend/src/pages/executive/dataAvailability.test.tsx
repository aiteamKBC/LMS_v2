import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import ConcernList from './components/ConcernList';
import HealthOverview from './components/HealthOverview';
import OverviewKpis from './components/OverviewKpis';
import QualityDonuts from './components/QualityDonuts';
import RegistryTable from './components/RegistryTable';
import type { FormDefinition, QualityRecord } from '@/types/qms';

afterEach(cleanup);

describe('executive overview source availability', () => {
  it('distinguishes unavailable indicators from a confirmed empty result', () => {
    const { rerender } = render(<MemoryRouter><OverviewKpis records={[]} forms={[]}
      availability={{ actions: false, criticalIssues: false, feedback: false, feedbackScores: false }} /></MemoryRouter>);
    expect(screen.getAllByText('—')).toHaveLength(3);
    expect(screen.getAllByText('Feedback classification data is unavailable')).toHaveLength(2);
    expect(screen.getByText('Feedback response data is unavailable')).toBeInTheDocument();
    expect(screen.queryByText('Open actions')).not.toBeInTheDocument();
    expect(screen.queryByText('Not assessed')).not.toBeInTheDocument();
    expect(screen.queryByText('No Negative feedback in scope')).not.toBeInTheDocument();
    rerender(<MemoryRouter><OverviewKpis records={[]} forms={[]}
      availability={{ actions: true, criticalIssues: true, feedback: true, feedbackScores: true }} /></MemoryRouter>);
    expect(screen.queryByText('Feedback classification data is unavailable')).not.toBeInTheDocument();
    expect(screen.getByText('No Negative feedback in scope')).toBeInTheDocument();
  });

  it('no longer shows an Assessed records card', () => {
    const base: QualityRecord = {
      id: 'completed-review', formId: 'MCM', formName: 'Synthetic MCM', category: 'Quality Audit',
      subjectType: 'Coach', subjectName: 'Synthetic Coach', department: 'Not available', programme: 'Not available',
      respondentType: 'Coach', respondentName: 'Synthetic Coach', auditor: 'Synthetic Reviewer', assessedOn: '2026-10-20',
      rag: 'unrated', policyVersion: null, critical: false, summary: 'Completed review', learnerRef: null,
      answeredQuestions: 1, totalQuestions: 1, reviewStatus: 'completed',
    };
    render(<MemoryRouter><OverviewKpis records={[base, { ...base, id: 'assessed-review', rag: 'green', policyVersion: 'qms-v1' }]}
      forms={[]} availability={{ actions: true, criticalIssues: true, feedback: true, feedbackScores: true }} /></MemoryRouter>);
    expect(screen.queryByText('Assessed records')).not.toBeInTheDocument();
  });

  it('counts Negative feedback as critical and Neutral plus Negative as needing review without marking them assessed', () => {
    const feedback: QualityRecord = {
      id: 'neutral-feedback', formId: 'feedback-1', formName: 'Synthetic Feedback', category: 'Learner Feedback',
      subjectType: 'Coach', subjectName: 'Synthetic Coach', department: 'Not available', programme: 'Not available',
      respondentType: 'Learner', respondentName: 'Synthetic Learner', auditor: 'Feedback response', assessedOn: '2026-10-20',
      rag: 'unrated', policyVersion: null, critical: false, summary: 'Completed feedback', learnerRef: 'learner-1',
      answeredQuestions: 1, totalQuestions: 1, reviewStatus: 'completed', feedbackClassification: 'neutral',
    };
    render(<MemoryRouter><OverviewKpis records={[feedback, { ...feedback, id: 'negative-feedback', feedbackClassification: 'negative' }, { ...feedback, id: 'positive-feedback', feedbackClassification: 'positive' }]}
      forms={[]} availability={{ actions: false, criticalIssues: false, feedback: true, feedbackScores: true }} /></MemoryRouter>);
    expect(screen.getByText('Feedback to review')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Review feedback' })).toHaveAttribute('href', '/curriculum/quality-demo?view=feedbacks&classification=review');
    expect(within(screen.getByText('Feedback to review').closest('.group') as HTMLElement).getByText('2')).toBeInTheDocument();
    expect(within(screen.getByText('Critical feedback').closest('.group') as HTMLElement).getByText('1')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Review critical feedback' })).toHaveAttribute('href', '/curriculum/quality-demo?view=feedbacks&classification=negative');
    expect(screen.getByText('Review the original responses and decide whether follow-up is required')).toBeInTheDocument();
  });

  it('shows scored feedback health separately from formal QA assessment', () => {
    const base: QualityRecord = {
      id: 'feedback-1', formId: 'feedback-form-1', formName: 'Synthetic Feedback', category: 'Learner Feedback',
      subjectType: 'Coach', subjectName: 'Synthetic Coach', department: 'Not available', programme: 'Not available',
      respondentType: 'Learner', respondentName: 'Synthetic Learner', auditor: 'Feedback response', assessedOn: '2026-10-20',
      rag: 'unrated', policyVersion: null, critical: false, summary: 'Completed feedback', learnerRef: 'learner-1',
      answeredQuestions: 1, totalQuestions: 1, reviewStatus: 'completed', feedbackClassification: 'positive',
    };
    const records = [
      base,
      { ...base, id: 'feedback-2', feedbackClassification: 'neutral' as const },
      { ...base, id: 'feedback-3', feedbackClassification: 'negative' as const },
      { ...base, id: 'feedback-4', feedbackClassification: 'unscored' as const },
    ];
    render(<HealthOverview records={records} availability={{ feedbackScores: true }} />);
    const feedback = within(screen.getByRole('region', { name: 'Feedback response health' }));
    for (const label of ['Positive', 'Neutral', 'Negative']) {
      expect(within(feedback.getByText(label).closest('div') as HTMLElement).getByText('1')).toBeInTheDocument();
    }
    expect(feedback.getByText('3 scored responses in scope', { exact: false })).toHaveTextContent('1 unscored');
    expect(screen.queryByText('Formal QA policy outcomes')).not.toBeInTheDocument();
  });

  it('reports unavailable feedback health without showing false zeroes', () => {
    render(<HealthOverview records={[]} availability={{ feedbackScores: false }} />);
    const feedback = within(screen.getByRole('region', { name: 'Feedback response health' }));
    expect(feedback.getByText('Feedback classification data is unavailable.')).toBeInTheDocument();
    expect(feedback.queryByText('Positive')).not.toBeInTheDocument();
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
  it('shows the evaluation rule and per-form outcome breakdown instead of a status mix', () => {
    const form: FormDefinition = {
      id: 'feedback-7', name: 'Synthetic Feedback', shortName: 'Synthetic Feedback', category: 'Learner Feedback', version: '1',
      sourceTable: 'synthetic', owner: 'Learner Experience', respondentType: 'Learner', subjectType: 'Tutor',
      questionCount: 4, answerTypes: ['Rating'], scoringMethod: 'Response score classification', policyId: 'Feedback score bands',
      policyVersion: '1', policySummary: 'Positive ≥75%', requiresAction: false, access: 'Feedback analytics access',
      scheduled: 0, submissions: 3, latest: '2026-10-20', completionRate: null, ragSupported: false,
      rag: { green: 0, amber: 0, red: 0, unrated: 3, na: 0, total: 3 },
    };
    const record: QualityRecord = {
      id: 'r1', formId: 'feedback-7', formName: 'Synthetic Feedback', category: 'Learner Feedback',
      subjectType: 'Tutor', subjectName: 'Synthetic Tutor', department: 'Not available', programme: 'Not available',
      respondentType: 'Learner', respondentName: 'Synthetic Learner', auditor: 'Feedback response', assessedOn: '2026-10-20',
      rag: 'unrated', policyVersion: null, critical: false, summary: 'Completed feedback', learnerRef: null,
      answeredQuestions: 4, totalQuestions: 4, reviewStatus: 'completed', feedbackClassification: 'positive',
    };
    render(<RegistryTable forms={[form]} records={[record, { ...record, id: 'r2' }, { ...record, id: 'r3', feedbackClassification: 'negative' }]} />);
    expect(screen.queryByText('Evaluation policy')).not.toBeInTheDocument();
    expect(screen.queryByText('Status mix')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Detail/ }));
    expect(within(screen.getByText('Positive').closest('div') as HTMLElement).getByText('2')).toBeInTheDocument();
    expect(within(screen.getByText('Negative').closest('div') as HTMLElement).getByText('1')).toBeInTheDocument();
    expect(screen.getByText('Evaluation rule')).toBeInTheDocument();
  });
});
