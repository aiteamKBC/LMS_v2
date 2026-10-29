import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ProgrammeDeliveryTimeline, type ProgrammeTimelineRun } from '../ProgrammeDeliveryTimeline';

const run: ProgrammeTimelineRun = { id: 'M/1', name: 'Planning', groupId: 'G1', group: 'Same group name', cohortId: 'C1', cohort: 'Autumn', startDate: '2026-09-07', endDate: '2026-09-28', href: '/curriculum/module-builder?module=M%2F1' };
const show = (runs: ProgrammeTimelineRun[]) => render(<MemoryRouter><ProgrammeDeliveryTimeline runs={runs} /></MemoryRouter>);

describe('Programme delivery timeline', () => {
  it('uses the programme colour for every module bar and its hover card', async () => {
    render(<MemoryRouter><ProgrammeDeliveryTimeline runs={[run, { ...run, id: 'M2', name: 'Second module' }]} programmeColor="#0f766e" /></MemoryRouter>);
    await userEvent.click(screen.getByRole('button', { name: 'Autumn 1 group' }));
    const links = [screen.getByRole('link', { name: /Planning/ }), screen.getByRole('link', { name: /Second module/ })];
    links.forEach(link => expect(link).toHaveStyle({ backgroundColor: '#0f766e', borderColor: '#0f766e', color: '#ffffff' }));
    await userEvent.hover(links[0]);
    const dialog = screen.getByRole('dialog', { name: 'Planning details' });
    expect(dialog.querySelector('header')).toHaveStyle({ backgroundColor: '#0f766e', color: '#ffffff' });
    await userEvent.keyboard('{Escape}');
  });
  it('plots only complete recorded ranges and keeps the original module link', async () => {
    show([run, { ...run, id: 'M2', startDate: undefined }, { ...run, id: 'M3', startDate: '2026-02-30' }, { ...run, id: 'M4', endDate: '2026-09-01' }, { ...run, id: 'M5', startDate: '2026-09-07invalid' }]);
    expect(screen.queryByRole('link', { name: /Delivery workspace/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Autumn 1 group' }));
    const link = screen.getByRole('link', { name: /Planning/ });
    expect(link).toHaveAttribute('href', run.href);
    await userEvent.hover(link);
    expect(screen.getByRole('dialog', { name: 'Planning details' })).toHaveTextContent('7 Sept 2026');
    await userEvent.keyboard('{Escape}');
    expect(screen.getByText(/4 module runs have missing or invalid placement dates/)).toBeInTheDocument();
    expect(screen.getByText(/do not confirm actual attendance or delivery/)).toBeInTheDocument();
    await userEvent.click(within(screen.getByRole('group', { name: 'Timeline scale' })).getByRole('button', { name: 'Week' }));
    expect(screen.getByRole('button', { name: 'Week' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('opens only the chosen cohort and keeps same-named cohorts and groups separate by ID', async () => {
    show([run, { ...run, id: 'M2', name: 'Delivery', groupId: 'G2', cohortId: 'C2' }]);
    const toggles = screen.getAllByRole('button', { name: 'Autumn 1 group' });
    expect(toggles).toHaveLength(2);
    expect(screen.queryByText('Same group name')).not.toBeInTheDocument();
    await userEvent.click(toggles[0]);
    expect(toggles[0]).toHaveAttribute('aria-expanded', 'true');
    expect(toggles[1]).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('link', { name: /Planning/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Delivery.*7 Sept/ })).not.toBeInTheDocument();
    await userEvent.click(toggles[1]);
    expect(screen.getAllByText('Same group name')).toHaveLength(2);
    expect(screen.getByRole('link', { name: /Delivery.*7 Sept/ })).toBeInTheDocument();
    await userEvent.click(toggles[0]);
    expect(screen.queryByRole('link', { name: /Planning/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Delivery.*7 Sept/ })).toBeInTheDocument();
  });

  it('shows all groups under their parent cohort, including groups without dates', async () => {
    show([run, { ...run, id: 'M2', groupId: 'G2', group: 'Undated group', startDate: undefined }]);
    const toggle = screen.getByRole('button', { name: 'Autumn 2 groups' });
    toggle.focus();
    await userEvent.keyboard('{Enter}');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById(toggle.getAttribute('aria-controls')!)).toHaveTextContent('Undated group');
    expect(screen.getByText('No complete module placement dates for this group.')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /Planning/ })).toHaveLength(1);
  });

  it('reports missing dates without borrowing a cohort start or inventing durations', async () => {
    show([{ ...run, startDate: undefined, endDate: undefined }]);
    expect(screen.getByText('No complete module placement dates are available for this programme.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Autumn 1 group' }));
    expect(screen.getByText('Same group name')).toBeInTheDocument();
    expect(screen.getByText('No recorded date range')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Planning/ })).not.toBeInTheDocument();
  });

  it('does not attach unassigned records to a matching cohort display name', async () => {
    show([run, { ...run, id: 'M2', name: 'Unassigned run', cohortId: undefined, groupId: undefined }]);
    await userEvent.click(screen.getByRole('button', { name: 'Autumn 1 group' }));
    expect(screen.queryByRole('link', { name: /Unassigned run/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'No cohort assigned 1 group' }));
    expect(screen.getByText('No group assigned')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Unassigned run/ })).toBeInTheDocument();
  });

  it('shows recorded details on hover and focus, keeping the preview hoverable and dismissible', async () => {
    show([{ ...run, tutor: 'Tutor A', coach: 'Coach B', schedule: 'Tuesday · 09:00 – 11:00', sessionCount: 16,
      holidays: [{ id: 'H1', label: 'Reading week', startDate: '2026-09-14', endDate: '2026-09-20', type: 'Workshop' }],
      sessions: [{ id: 'S1', title: 'Recorded session', date: '2026-09-21', skippedHolidays: ['2026-09-14'] }] }]);
    await userEvent.click(screen.getByRole('button', { name: 'Autumn 1 group' }));
    const link = screen.getByRole('link', { name: /Planning/ });
    await userEvent.hover(link);
    const preview = screen.getByRole('dialog', { name: 'Planning details' });
    expect(preview).toHaveTextContent('Tutor A'); expect(preview).toHaveTextContent('Coach B');
    expect(preview).toHaveTextContent('16'); expect(preview).toHaveTextContent('Tuesday · 09:00 – 11:00');
    expect(preview).toHaveTextContent('Reading week'); expect(preview).toHaveTextContent('Recorded session · 21 Sept 2026');
    await userEvent.unhover(link); await userEvent.hover(preview);
    expect(preview).toBeInTheDocument();
    await userEvent.click(within(preview).getByRole('button', { name: 'Close module details' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    link.focus();
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Planning details' })).toBeInTheDocument());
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens the chooser on click, preserves verified links and calls only the chosen placement editor', async () => {
    const onEditSchedule = vi.fn();
    show([{ ...run, overviewHref: '/curriculum/modules/M%2F1', onEditSchedule }]);
    await userEvent.click(screen.getByRole('button', { name: 'Autumn 1 group' }));
    const link = screen.getByRole('link', { name: /Planning/ });
    await userEvent.click(link);
    const chooser = screen.getByRole('dialog', { name: 'Choose What To Edit' });
    expect(screen.queryByRole('dialog', { name: 'Planning details' })).not.toBeInTheDocument();
    expect(within(chooser).getByRole('link', { name: /Edit module catalogue/ })).toHaveAttribute('href', run.href);
    expect(within(chooser).getByRole('link', { name: /Module Overview/ })).toHaveAttribute('href', '/curriculum/modules/M%2F1');
    expect(onEditSchedule).not.toHaveBeenCalled();
    await userEvent.click(within(chooser).getByRole('button', { name: /Edit schedule assignment/ }));
    expect(onEditSchedule).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog', { name: 'Choose What To Edit' })).not.toBeInTheDocument();
  });

  it('opens the chooser from the keyboard and restores focus on Escape without opening an editor', async () => {
    const onEditSchedule = vi.fn();
    show([{ ...run, onEditSchedule }]);
    await userEvent.click(screen.getByRole('button', { name: 'Autumn 1 group' }));
    const link = screen.getByRole('link', { name: /Planning/ });
    link.focus(); await userEvent.keyboard('{Enter}');
    expect(screen.getByRole('dialog', { name: 'Choose What To Edit' })).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Choose What To Edit' })).not.toBeInTheDocument();
    expect(link).toHaveFocus(); expect(onEditSchedule).not.toHaveBeenCalled();
  });

  it('does not invent unavailable counts, staff, holidays or editable destinations', async () => {
    show([run]);
    await userEvent.click(screen.getByRole('button', { name: 'Autumn 1 group' }));
    const link = screen.getByRole('link', { name: /Planning/ });
    await userEvent.hover(link);
    const preview = screen.getByRole('dialog', { name: 'Planning details' });
    expect(preview).toHaveTextContent('Not recorded'); expect(preview).toHaveTextContent('Not assigned'); expect(preview).toHaveTextContent('Not included');
    await userEvent.click(link);
    const chooser = screen.getByRole('dialog', { name: 'Choose What To Edit' });
    expect(within(chooser).getByRole('button', { name: /Edit schedule assignment/ })).toBeDisabled();
    expect(within(chooser).getByRole('button', { name: /Module Overview/ })).toBeDisabled();
  });
});
