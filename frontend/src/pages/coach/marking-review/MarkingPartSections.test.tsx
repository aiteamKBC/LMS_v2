import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MarkingPartSections } from './MarkingPartSections';
import type { MarkingSection } from '@/features/coach/marking/types/marking.types';

const longAnswer = `${'The project budget was set from contractor quotations. '.repeat(20)}\nSecond paragraph.`;

const sections: MarkingSection[] = [
  {
    step: 2,
    title: 'Assignment answer',
    entries: [{ label: 'Assignment answer', text: longAnswer, format: 'text' }],
  },
  {
    step: 3,
    title: 'Evidence & cross-referencing',
    entries: [{
      label: 'Evidence attached', text: 'Plan (https://example.test/plan)', format: 'evidence',
      items: [{ name: 'Plan', url: 'https://example.test/plan', points: '1, 2' }],
    }],
  },
  {
    step: 4,
    title: 'KSBs & hours claimed',
    entries: [
      { label: 'Hours claimed', text: '4.5', format: 'value' },
      {
        label: 'Time entries', text: 'two entries', format: 'time',
        items: [{ date: '2026-11-04', topic: 'Financial planning', hours: '2' }, { date: '2026-11-09', topic: 'Estimating', hours: '2.5' }],
      },
      { label: 'KSB claims', text: 'K7: tracked budgets', format: 'ksbs', items: [{ code: 'K7', explanation: 'I tracked budgets weekly.' }] },
      {
        label: 'Confirmations', text: 'checks', format: 'checks',
        items: [{ label: 'Completed during paid working hours', passed: true }, { label: 'Evidence sharing accepted by employer', passed: false }],
      },
    ],
  },
];

function openTab(name: RegExp) {
  fireEvent.click(within(screen.getByRole('tablist', { name: 'Steps in this part' })).getByRole('tab', { name }));
}

describe('MarkingPartSections', () => {
  it('shows each step in its own tab, with feedback as the tab after the steps', () => {
    render(<MarkingPartSections sections={sections} feedback={<p>Feedback panel</p>} />);

    const tabs = within(screen.getByRole('tablist', { name: 'Steps in this part' })).getAllByRole('tab');
    expect(tabs.map(tab => tab.textContent)).toEqual(['2Assignment answer', '3Evidence & cross-referencing', '4KSBs & hours claimed', 'Feedback & decision']);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('heading', { level: 4, name: 'Assignment answer' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'KSBs & hours claimed' })).not.toBeInTheDocument();
    expect(screen.queryByText('Feedback panel')).not.toBeInTheDocument();

    openTab(/Feedback & decision/);
    expect(screen.getByText('Feedback panel')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 4, name: 'Assignment answer' })).not.toBeInTheDocument();
  });

  it('moves between step tabs with the arrow keys', () => {
    render(<MarkingPartSections sections={sections} feedback={<p>Feedback panel</p>} />);
    const tablist = screen.getByRole('tablist', { name: 'Steps in this part' });
    fireEvent.keyDown(tablist, { key: 'ArrowRight' });
    expect(screen.getByRole('heading', { name: 'Evidence & cross-referencing' })).toBeInTheDocument();
    fireEvent.keyDown(tablist, { key: 'End' });
    expect(screen.getByText('Feedback panel')).toBeInTheDocument();
    fireEvent.keyDown(tablist, { key: 'ArrowRight' });
    expect(screen.getByRole('heading', { level: 4, name: 'Assignment answer' })).toBeInTheDocument();
  });

  it('lays each answer out by the kind of answer it holds', () => {
    render(<MarkingPartSections sections={sections} />);

    openTab(/KSBs & hours claimed/);
    const table = screen.getByRole('table');
    expect(within(table).getByText('Financial planning')).toBeInTheDocument();
    expect(within(table).getByText('4.5 h')).toBeInTheDocument();
    expect(screen.getByText('K7')).toBeInTheDocument();
    expect(screen.getByText('I tracked budgets weekly.')).toBeInTheDocument();
    expect(screen.getByText('Completed during paid working hours').closest('li')).toHaveAttribute('data-passed', 'true');
    expect(screen.getByText('Evidence sharing accepted by employer').closest('li')).toHaveAttribute('data-passed', 'false');

    openTab(/Evidence & cross-referencing/);
    expect(screen.getByRole('link', { name: 'Plan' })).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByText('Linked to answer points: 1, 2')).toBeInTheDocument();
  });

  it('collapses long answers until the coach expands them', () => {
    render(<MarkingPartSections sections={sections} />);
    const toggle = screen.getByRole('button', { name: 'Show full answer' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Show less' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Second paragraph.')).toBeInTheDocument();
  });

  it('says so when a step was left empty', () => {
    render(<MarkingPartSections sections={[{ step: 6, title: 'Impact & employer benefit', entries: [] }]} />);
    expect(screen.getByText('Nothing was entered for this step.')).toBeInTheDocument();
  });
});
