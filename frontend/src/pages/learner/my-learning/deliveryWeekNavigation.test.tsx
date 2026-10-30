import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { SubjectActivityWorkspace } from './SubjectActivityWorkspace';
import { nativeHref, subjectWeeks } from './subjectLearning';
import type { Subject, SubjectEntry } from './learningSummary';

const entries: SubjectEntry[] = [
  { id: 'LIVE', title: 'October live session', category: 'live_session', completed: true, position: 1, week: 'Week 5',
    schedule: { date: '2026-10-30', month: '2026-10', date_source: 'builder_session' },
    native: { componentId: 'LIVE', moduleId: 'M1', weekId: 'W5', title: 'October live session', type: 'live_session',
      expectedOtjh: 1, sessionDate: '2026-10-30', liveSessionUrl: 'https://example.invalid/join' } },
  { id: 'READ', title: 'Linked reading', category: 'reading', completed: false, position: 2, week: 'Week 5',
    schedule: { date: '2026-11-02', month: '2026-11', date_source: 'builder_session' },
    native: { componentId: 'READ', moduleId: 'M1', weekId: 'W5', title: 'Linked reading', type: 'reading',
      expectedOtjh: 1, pointNumber: 1, contentHtml: '<p>Synthetic reading</p>' } },
  { id: 'RECORDING', title: 'Linked recording', category: 'recording_placeholder', completed: false, position: 3, week: 'Week 5',
    schedule: { date: '2026-11-03', month: '2026-11', date_source: 'builder_session' },
    native: { componentId: 'RECORDING', moduleId: 'M1', weekId: 'W5', title: 'Linked recording', type: 'recording_placeholder',
      expectedOtjh: 1, pointNumber: 1, recordingSeriesId: 'SERIES', recordingSessionNumber: 5, recordingDate: '2026-10-30' } },
  { id: 'NEXT', title: 'November live session', category: 'live_session', completed: false, position: 1, week: 'Week 6',
    schedule: { date: '2026-11-06', month: '2026-11', date_source: 'builder_session' },
    native: { componentId: 'NEXT', moduleId: 'M1', weekId: 'W6', title: 'November live session', type: 'live_session',
      expectedOtjh: 1, sessionDate: '2026-11-06', liveSessionUrl: 'https://example.invalid/next' } },
];
const subject: Subject = { id: 'current:M1', title: 'Synthetic module', source: 'current', activities: entries };

describe('session-anchored material navigation', () => {
  it.each(['commercial', 'apprenticeship'])('retains original activity/recording links, point membership and an open draft (%s)', kind => {
    const weeks = subjectWeeks(subject);
    const before = JSON.stringify(subject);
    const view = (requestedActivity: string, requestedWeek = '2026-11-02') => <MemoryRouter><SubjectActivityWorkspace
      subject={subject} weeks={weeks} requestedWeek={requestedWeek} requestedActivity={requestedActivity}
      kind={kind} learnerId="synthetic" search="" progress={null} renderWeekProgress={() => null}
      renderActivity={entry => <article aria-label={`${entry.id} player`}>
        <a href={nativeHref(entry, kind, 'synthetic')!}>Original {entry.id}</a>
        <textarea aria-label={`${entry.id} draft`} defaultValue="" />
      </article>} /></MemoryRouter>;
    const { rerender } = render(view('READ'));
    expect(screen.getByRole('region', { name: 'Week 5 materials' })).toHaveTextContent('October 2026');
    expect(screen.getByRole('region', { name: 'Week 5 materials' })).toHaveTextContent('30 Oct 2026 – 5 Nov 2026');
    expect(screen.getByRole('link', { name: 'Original READ' })).toHaveAttribute('href', `/learner/component/${kind}/synthetic/READ?week=Week%205`);
    const point = screen.getByRole('list', { name: 'Point 1 activities' });
    expect(within(point).getAllByRole('button').map(button => button.textContent)).toEqual(['ReadingLinked reading', 'RecordingLinked recording']);
    fireEvent.change(screen.getByRole('textbox', { name: 'READ draft' }), { target: { value: 'Keep my unfinished answer' } });
    rerender(view('RECORDING'));
    expect(screen.getByRole('link', { name: 'Original RECORDING' })).toHaveAttribute('href', `/learner/component/${kind}/synthetic/RECORDING?week=Week%205`);
    rerender(view('NEXT', 'W6'));
    expect(screen.getByRole('region', { name: 'Week 6 materials' })).toHaveTextContent('November 2026');
    rerender(view('READ', 'W5'));
    expect(screen.getByRole('textbox', { name: 'READ draft' })).toHaveValue('Keep my unfinished answer');
    expect(JSON.stringify(subject)).toBe(before);
  });
});
