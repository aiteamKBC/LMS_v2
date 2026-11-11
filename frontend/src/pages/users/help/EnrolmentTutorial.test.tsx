import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EnrolmentTutorial } from './EnrolmentTutorial';
import { chapterTime, enrolmentTutorials, tutorialForLocation } from './tutorials';

const originalShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute('open', ''); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute('open'); } });
});
afterEach(() => {
  cleanup(); vi.restoreAllMocks();
  for (const [key, descriptor] of [['showModal', originalShowModal], ['close', originalClose]] as const) {
    if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, key, descriptor);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, key);
  }
});

describe('Enrolment page guides', () => {
  it.each(enrolmentTutorials)('provides a specific guide for $title', tutorial => {
    expect(tutorialForLocation(tutorial.path)?.tutorial.id).toBe(tutorial.id);
  });

  it('selects the current wizard step and learner-record tab without using learner identity', () => {
    const wizard = tutorialForLocation('/users/847/wizard/policies', '?source=commercial')!;
    expect(wizard.tutorial.id).toBe('wizard');
    expect(wizard.tutorial.chapters[wizard.chapter].id).toBe('policies');
    const board = tutorialForLocation('/users/92', '?tab=documents&source=apprenticeship')!;
    expect(board.tutorial.id).toBe('enrolment-details');
    expect(board.tutorial.chapters[board.chapter].id).toBe('documents');
    expect(tutorialForLocation('/users/92/wizard/custom-step')?.chapter).toBe(0);
    expect(tutorialForLocation('/training-plan/commercial/92')?.tutorial.id).toBe('training-plan');
  });

  it.each(['/workspace/learner/apprenticeship/1', '/employers/1', '/curriculum', '/users/my-courses/other'])('keeps guides out of unrelated screens: %s', path => {
    expect(tutorialForLocation(path)).toBeNull();
  });

  it('opens an accessible video with a complete readable explanation and restores focus on close', () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'Watch guide'; document.body.append(trigger); trigger.focus();
    document.body.style.overflow = 'auto';
    const onClose = vi.fn();
    const tutorial = enrolmentTutorials[0];
    const view = render(<EnrolmentTutorial tutorial={tutorial} initialChapter={0} onClose={onClose} />);
    const modal = screen.getByRole('dialog', { name: tutorial.title });
    expect(modal).toHaveAttribute('open');
    expect(document.body.style.overflow).toBe('hidden');
    expect(screen.getByLabelText(`${tutorial.title} screen recording`)).toHaveAttribute('controls');
    for (const chapter of tutorial.chapters) expect(screen.getByText(chapter.text)).toBeVisible();
    fireEvent(modal, new Event('cancel', { cancelable: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(trigger).toHaveFocus(); expect(document.body.style.overflow).toBe('auto');
    trigger.remove(); document.body.style.overflow = '';
  });

  it('starts at the relevant chapter, seeks after metadata, and tracks playback chapters', () => {
    const tutorial = enrolmentTutorials[0];
    render(<EnrolmentTutorial tutorial={tutorial} initialChapter={1} onClose={vi.fn()} />);
    const video = screen.getByLabelText(`${tutorial.title} screen recording`) as HTMLVideoElement;
    fireEvent.loadedMetadata(video);
    expect(video.currentTime).toBe(chapterTime(tutorial, 1));
    Object.defineProperty(video, 'readyState', { configurable: true, value: 1 });
    fireEvent.click(screen.getByRole('button', { name: new RegExp(tutorial.chapters[2].title) }));
    expect(video.currentTime).toBe(chapterTime(tutorial, 2));
    video.currentTime = chapterTime(tutorial, 3) + .1;
    fireEvent.timeUpdate(video);
    expect(screen.getByRole('button', { name: new RegExp(tutorial.chapters[3].title) })).toHaveAttribute('aria-current', 'step');
  });

  it('keeps the full explanation and download available when the media fails, and retries the source', () => {
    const tutorial = enrolmentTutorials[0];
    render(<EnrolmentTutorial tutorial={tutorial} initialChapter={0} onClose={vi.fn()} />);
    const video = screen.getByLabelText(`${tutorial.title} screen recording`);
    fireEvent.error(video.querySelector('source')!);
    expect(screen.getByRole('alert')).toHaveTextContent('The video could not be loaded');
    expect(screen.getByText(tutorial.chapters[0].text)).toBeVisible();
    expect(screen.getByRole('link', { name: 'Download video' })).toHaveAttribute('download');
    fireEvent.click(screen.getByRole('button', { name: 'Try video again' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByLabelText(`${tutorial.title} screen recording`)).not.toBe(video);
  });
});
