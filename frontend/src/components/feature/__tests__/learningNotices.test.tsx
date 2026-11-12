import { useState } from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LearnerLoadError } from '../LearnerLoadError';
import { Notice } from '@/components/ui/Notice';
import { WeekHolidayNotice } from '@/pages/curriculum/shared/entities/sessionShiftPreview';
import { KsbRemapNotice } from '@/pages/curriculum/module-builder/KsbRemapNotice';
import type { KsbRemapReport } from '@/pages/curriculum/module-builder/moduleAuthoringData';

afterEach(cleanup);

describe('readable learning and curriculum messages', () => {
  it('keeps a load failure visible with a retry and does not expose server details', async () => {
    const retry = vi.fn();
    render(<LearnerLoadError error={'relation "private.internal_table" does not exist; token=synthetic-secret; <html>502</html>'} onRetry={retry} />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Could not load your learning data');
    expect(alert).toHaveTextContent('contact your tutor or the support team');
    expect(alert).not.toHaveTextContent(/private|internal_table|token|synthetic-secret|502/);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('keeps the next step and an attention message visible while optional detail starts closed', async () => {
    const { container } = render(<Notice tone="attention" title="Review the calendar" details={<p>One date was not accepted.</p>} actions={<button>Review dates</button>}>Check the dates before sending invitations.</Notice>);
    expect(screen.getByRole('note')).toHaveTextContent('Check the dates before sending invitations.');
    expect(screen.getByRole('button', { name: 'Review dates' })).toBeVisible();
    expect(container.querySelector('details')).not.toHaveAttribute('open');
    expect(screen.getByText('One date was not accepted.')).not.toBeVisible();
    await userEvent.click(screen.getByText('View details'));
    expect(screen.getByText('One date was not accepted.')).toBeVisible();
  });

  it('retains holiday dates and the published learner note without changing it when details open', async () => {
    const change = vi.fn();
    const { container } = render(<WeekHolidayNotice compact slot={{ slotNumber: 5, date: '2026-12-23', holidays: [{ label: 'Winter break', startDate: '2026-12-19', endDate: '2027-01-01', source: 'manual' }] }} note={{ enabled: true, message: 'Read chapter two this week.', onChange: change }} />);
    const summary = container.querySelector('summary')!;
    expect(within(summary).getByText('Winter break')).toBeVisible();
    expect(screen.getByText('Read chapter two this week.')).toBeVisible();
    expect(screen.getByText('Shown to learners')).toBeVisible();
    expect(container.querySelector('details')).not.toHaveAttribute('open');
    await userEvent.click(summary);
    expect(container.querySelector('details')).toHaveAttribute('open');
    expect(screen.getByTestId('week-holiday-notice')).toHaveTextContent('19 Dec 2026');
    expect(screen.getByTestId('week-holiday-notice')).toHaveTextContent('01 Jan 2027');
    expect(change).not.toHaveBeenCalled();
  });

  it('preserves the learner-note editor and clears publication when the author clears its text', async () => {
    function Editor() {
      const [note, setNote] = useState({ enabled: true, message: 'Read chapter two.' });
      return <WeekHolidayNotice compact slot={{ slotNumber: 1, date: '2026-12-23', holidays: [] }} note={{ ...note, onChange: setNote }} />;
    }
    render(<Editor />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit note for learners' }));
    await userEvent.clear(screen.getByRole('textbox'));
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(screen.getByRole('checkbox')).toBeDisabled();
    await userEvent.type(screen.getByRole('textbox'), 'Read chapter three.');
    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.getByText('Read chapter three.')).toBeVisible();
    expect(screen.getByText('Shown to learners')).toBeVisible();
  });

  it('groups copied links by code, preserves each reason and does not imply that the report was repaired', async () => {
    const report: KsbRemapReport = { status: 'partial', matchedCount: 7, createdAt: '2026-10-01T12:00:00Z', unmatched: [
      { code: 'K1', location: 'week', path: 'weekStructure[0].ksbMappings[0]', reason: 'Code not found in the destination source.' },
      { code: 'K1', location: 'component', path: 'weekStructure[0].components[0].ksbMappings[0]', reason: 'Check the destination source.' },
      { code: 'S2', location: 'module', path: 'moduleKsbMappings[0]', reason: 'Code not found in the destination source.' },
    ] };
    const original = structuredClone(report);
    const review = vi.fn();
    const { container } = render(<KsbRemapNotice report={report} onReview={review} />);
    expect(screen.getByText('Review copied KSB links')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Review current mappings' })).toBeVisible();
    expect(container.querySelector('details')).not.toHaveAttribute('open');
    await userEvent.click(screen.getByText('View copy report · 2 codes'));
    expect(screen.getByText(/3 copied links could not be matched/)).toBeVisible();
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    const row = within(table).getByRole('row', { name: /K1/ });
    expect(within(row).getByRole('cell', { name: '2' })).toBeVisible();
    expect(row).toHaveTextContent('Check the destination source.');
    expect(row).toHaveTextContent('Code not found in the destination source.');
    expect(report).toEqual(original);
    expect(review).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Review current mappings' }));
    expect(review).toHaveBeenCalledOnce();
  });

  it('shows no copied-link warning when there is no unmatched report', () => {
    const { container } = render(<KsbRemapNotice onReview={vi.fn()} report={{ status: 'complete', matchedCount: 1, unmatched: [], createdAt: '2026-10-01T12:00:00Z' }} />);
    expect(container).toBeEmptyDOMElement();
  });
});
