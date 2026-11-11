import catalog from './tutorials.json';
import recordedTimings from './tutorialTimings.json';

export type EnrolmentTutorial = typeof catalog[number];
export const enrolmentTutorials = catalog;
const timings: Record<string, number[]> = recordedTimings;
export const tutorialAsset = (id: string, extension: 'webm' | 'vtt' | 'jpg') => `/help/enrolment/v1/${id}.${extension}`;
export const chapterTime = (tutorial: EnrolmentTutorial, chapter: number) => timings[tutorial.id]?.[chapter] ?? 0;

/** Match only Enrolment screens; learner and employer workspaces keep their own chrome. */
export function tutorialForLocation(pathname: string, search = '') {
  const path = pathname.replace(/\/$/, '') || '/';
  let id = catalog.find(tutorial => tutorial.path === path)?.id;
  let chapter = 0;
  const wizard = path.match(/^\/users\/[^/]+\/wizard(?:\/([^/]+))?$/);
  if (wizard) {
    id = 'wizard';
    chapter = Math.max(0, catalog.find(tutorial => tutorial.id === id)!.chapters.findIndex(item => item.id === wizard[1]));
  } else if (!id && /^\/users\/[^/]+$/.test(path)) {
    id = 'enrolment-details';
  } else if (/^\/training-plan\/(?:apprenticeship|commercial)\/[^/]+$/.test(path)) {
    id = 'training-plan';
  }
  const tutorial = catalog.find(item => item.id === id);
  if (!tutorial) return null;
  if (id === 'enrolment-details') {
    const tab = new URLSearchParams(search).get('tab');
    chapter = Math.max(0, tutorial.chapters.findIndex(item => item.id === tab));
  }
  return { tutorial, chapter };
}
