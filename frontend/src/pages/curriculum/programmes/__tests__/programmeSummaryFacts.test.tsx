import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { CurriculumProgramme, CurriculumStandard } from '@/lib/curriculumApi';
import { ProgrammeSummaryFacts } from '../ProgrammeSummaryFacts';

const programme = { id: 'P1', name: 'Recorded programme', cohorts: 4, groups: 4, modules: 5, weeks: 27, learners: 21,
  ksbTotal: 34, ksbMapped: 6, learnerKsbExpectedWeight: 100, learnerKsbLearnerCount: 21,
  learnerKsbProgressPercentage: 2, learnerKsbCodesStarted: 6, learnerKsbCodesTotal: 34,
  description: 'Recorded programme description',
} as CurriculumProgramme;
const standard = { minimumHours: '348', maxFunding: '£7,000', duration: '18 months', route: 'Business and administration',
  larsCode: '128', eqaProvider: 'Ofqual', approvedForDelivery: '19 August 2016', degree: 'Non-degree',
} as CurriculumStandard;
const source = { value: 'standard:ST1', title: 'Associate project manager', subtitle: 'Standard', detail: '31 K / 26 S / 5 B', ksbCount: 62, standard };
const props = () => ({ programme, source, loading: false, error: null, onOpenSource: vi.fn(), onRetry: vi.fn(), onOpen: vi.fn() });

describe('Selected programme facts', () => {
  it('retains all former standard facts and recorded learner progress without repeating the existing Overview counts', async () => {
    const callbacks = props();
    render(<ProgrammeSummaryFacts {...callbacks} />);
    const facts = within(screen.getByRole('group', { name: 'Programme facts' }));
    for (const text of ['348 hrs min', '£7,000 max funding', '18 months', 'Business and administration', 'LARS 128', 'Ofqual', '19 August 2016', 'Non-degree', '31 K / 26 S / 5 B', 'Recorded programme description', '2%']) {
      expect(facts.getByText(text)).toBeInTheDocument();
    }
    expect(facts.getByText(/6\/34 KSBs · 21 learners/)).toBeInTheDocument();
    expect(facts.queryByText('Cohorts')).not.toBeInTheDocument();
    await userEvent.click(facts.getByRole('button', { name: 'View KSBs for Associate project manager' }));
    expect(callbacks.onOpenSource).toHaveBeenCalledOnce();
    await userEvent.click(facts.getByRole('button', { name: 'Open KSB coverage for Recorded programme' }));
    expect(callbacks.onOpen).toHaveBeenLastCalledWith('coverage', 'mapping');
  });

  it('does not invent standard metadata for a profile or present mapping as learner progress', () => {
    render(<ProgrammeSummaryFacts {...props()} programme={{ ...programme, learnerKsbExpectedWeight: 0, learnerKsbLearnerCount: 0 }} source={{ ...source, standard: undefined }} />);
    expect(screen.queryByText('Maximum funding')).not.toBeInTheDocument();
    expect(screen.queryByText('Minimum compliance hours')).not.toBeInTheDocument();
    expect(screen.getByText('Mapping 18%')).toBeInTheDocument();
    expect(screen.getByText('No learners')).toBeInTheDocument();
    expect(screen.queryByText('2%')).not.toBeInTheDocument();
  });

  it('distinguishes source loading and failure while retaining independently recorded learner progress', async () => {
    const callbacks = props();
    const view = render(<ProgrammeSummaryFacts {...callbacks} loading />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading applied KSB source');
    expect(screen.queryByText('£7,000 max funding')).not.toBeInTheDocument();
    view.rerender(<ProgrammeSummaryFacts {...callbacks} error="Source unavailable" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Applied KSB source unavailable');
    expect(screen.getByText('2%')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry KSB source' }));
    expect(callbacks.onRetry).toHaveBeenCalledOnce();
  });
});
