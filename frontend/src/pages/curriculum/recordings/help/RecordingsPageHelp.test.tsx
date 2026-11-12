import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RecordingsPageHelp } from './RecordingsPageHelp';
import tutorials from './tutorials.json';
import timings from './tutorialTimings.json';

const originalShow = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute('open', ''); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute('open'); } });
});
afterEach(() => {
  cleanup(); sessionStorage.clear(); vi.restoreAllMocks();
  for (const [key, value] of [['showModal', originalShow], ['close', originalClose]] as const) {
    if (value) Object.defineProperty(HTMLDialogElement.prototype, key, value);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, key);
  }
});
describe('Recordings page guides', () => {
  it.each(tutorials)('opens the English video and matching chapters for $title', tutorial => {
    render(<MemoryRouter initialEntries={[tutorial.path]}><RecordingsPageHelp guideId={tutorial.id as 'recordings-hub' | 'tutor-recordings' | 'coach-meetings'} /></MemoryRouter>);
    const trigger = screen.getByRole('button', { name: `Watch ${tutorial.title} page guide` });
    trigger.focus(); fireEvent.click(trigger);
    expect(screen.getByRole('dialog', { name: tutorial.title })).toBeVisible();
    const video = screen.getByLabelText(`${tutorial.title} screen recording`) as HTMLVideoElement;
    expect(video.querySelector('source')).toHaveAttribute('src', `/help/recordings/v1/${tutorial.id}.webm`);
    expect(video.querySelector('track')).toHaveAttribute('srclang', 'en');
    expect(video).toHaveAttribute('poster', `/help/recordings/v1/${tutorial.id}.jpg`);
    for (const chapter of tutorial.chapters) expect(screen.getByText(chapter.text)).toBeVisible();
    Object.defineProperty(video, 'readyState', { configurable: true, value: 1 });
    fireEvent.click(screen.getByText(tutorial.chapters[1].title, { exact: true }).closest('button')!);
    expect(video.currentTime).toBe((timings as Record<string, number[]>)[tutorial.id][1]);
    fireEvent.click(screen.getByRole('button', { name: 'Close page guide' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(trigger).toHaveFocus();
  });
  it('does not render on a different workspace or a nested quality page', () => {
    const view = render(<MemoryRouter initialEntries={['/coach/recordings']}><RecordingsPageHelp guideId="coach-meetings" /></MemoryRouter>);
    expect(screen.queryByRole('button')).not.toBeInTheDocument(); view.unmount();
    render(<MemoryRouter initialEntries={['/curriculum/coaching-recordings/reviews']}><RecordingsPageHelp guideId="coach-meetings" /></MemoryRouter>);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
  it('keeps the recording hint separate from the enrolment hint and preserves the launcher after dismissal', () => {
    sessionStorage.setItem('enrolment-help-hint-hidden', '1');
    render(<MemoryRouter initialEntries={['/curriculum/recordings-hub']}><RecordingsPageHelp guideId="recordings-hub" /></MemoryRouter>);
    expect(screen.getByText('Need help on this page? Click here')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Hide help message' }));
    expect(sessionStorage.getItem('recordings-help-hint-hidden')).toBe('1');
    expect(screen.getByRole('button', { name: 'Watch Recordings hub page guide' })).toBeVisible();
  });
});
