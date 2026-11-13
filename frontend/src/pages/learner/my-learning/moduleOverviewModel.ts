import type { LearnerComponentEntry } from '@/api/learnerDetail';
import type { ModuleOverviewContent, MyLearningCard, MyLearningModule } from '@/api/myLearning';
import type { PlanModule } from '@/api/trainingPlanDashboard';
import { quizAttemptsFor } from '@/utils/learnerJourney';
import { subjectsFrom, type Subject } from './learningSummary';

/** Plural labels for the curriculum preview, keyed by component type. */
const TYPE_LABELS: Record<string, [string, string]> = {
  live_session: ['Live session', 'Live sessions'], video: ['Video', 'Videos'], podcast: ['Podcast', 'Podcasts'],
  audio: ['Audio activity', 'Audio activities'], reading: ['Reading', 'Readings'], powerpoint: ['Presentation', 'Presentations'],
  quiz: ['Quiz', 'Quizzes'], reading_quiz: ['Reading & quiz', 'Readings & quizzes'], assignment: ['Assignment', 'Assignments'],
  checkpoint: ['Checkpoint', 'Checkpoints'], reflection: ['Reflection', 'Reflections'],
};

/**
 * Native New LMS modules get the overview step. Old LMS, imported and
 * replacement courses keep opening their existing material browser directly.
 */
export function hasModuleOverview(subject: Pick<Subject, 'source' | 'importedCourseRef' | 'replacementCourseRef' | 'id'>) {
  return subject.source === 'current' && !subject.importedCourseRef && !subject.replacementCourseRef && subject.id.startsWith('current:');
}

export function componentType(component: Pick<LearnerComponentEntry, 'type' | 'isQuiz'>) {
  if (component.isQuiz) return 'quiz';
  return (component.type || 'activity').toLowerCase().replace(/-/g, '_');
}

export function typeLabel(type: string, count = 1) {
  const known = TYPE_LABELS[type];
  if (known) return count === 1 ? known[0] : known[1];
  const words = type.replace(/_/g, ' ');
  return count === 1 ? words.charAt(0).toUpperCase() + words.slice(1) : 'Other activities';
}

/**
 * One curriculum row. `completed` is the learner's real completion state from
 * the existing learning summary (true/false), or null when it is not known --
 * the editor preview, or a component the summary cannot identify. Null is never
 * shown as complete or incomplete.
 */
export type OverviewItem = { id: string; title: string; type: string; questions: number | null; completed: boolean | null };
export type OverviewWeek = { key: string; label: string; items: OverviewItem[] };
/** An authored Description-tab section, split for rendering. Text only. */
export type OverviewSectionView = { id: string; heading: string; paragraphs: string[]; bullets: string[] };
/** A quiz result the learner already sees in their workspace. Nothing is calculated beyond the best attempt. */
export type OverviewGrade = { id: string; title: string; week: string; attempts: number; bestPercent: number | null; passed: boolean };
export type OverviewInstructor = { name: string; bio: string; photoUrl: string };

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
const list = (value: unknown) => (Array.isArray(value) ? value.map(text).filter(Boolean) : []);
export const paragraphs = (value: unknown) => text(value).split(/\n{2,}/).map(paragraph => paragraph.trim()).filter(Boolean);

/**
 * The learner's completion for each native component of the module, keyed by
 * componentId. Reuses the learning summary that drives the workspace's own
 * Complete / Not complete badges (completedComponentIds + isComponentComplete),
 * so no new completion rule is introduced here.
 */
export function moduleCompletion(module: MyLearningModule | null | undefined, subjectId: string): Map<string, boolean> | null {
  if (!module) return null;
  const subject = subjectsFrom(module.activity, module.detail, module.metadata).find(item => item.id === subjectId);
  const completion = new Map<string, boolean>();
  for (const entry of subject?.activities || []) {
    const componentId = text(entry.native?.componentId);
    if (componentId) completion.set(componentId, entry.completed === true);
  }
  return completion;
}

/** Weeks in the order the module read returns its components. Titles only: no content is copied. */
export function curriculumWeeks(components: LearnerComponentEntry[], completion: Map<string, boolean> | null = null): OverviewWeek[] {
  const weeks = new Map<string, OverviewWeek>();
  components.forEach((component, index) => {
    const title = text(component.component);
    if (!title) return;
    const label = text(component.week) || 'Additional activities';
    const key = text(component.weekId) || label;
    if (!weeks.has(key)) weeks.set(key, { key, label, items: [] });
    const componentId = text(component.componentId);
    const questions = component.isQuiz && typeof component.quizMeta?.questions === 'number' && component.quizMeta.questions > 0 ? component.quizMeta.questions : null;
    weeks.get(key)!.items.push({
      id: componentId || `${key}:${index}`, title, type: componentType(component), questions,
      completed: componentId && completion?.has(componentId) ? completion.get(componentId)! : null,
    });
  });
  return [...weeks.values()];
}

export function typeCounts(weeks: OverviewWeek[]) {
  const counts = new Map<string, number>();
  weeks.forEach(week => week.items.forEach(item => counts.set(item.type, (counts.get(item.type) || 0) + 1)));
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([type, count]) => ({ type, count, label: typeLabel(type, count) }));
}

/** Authored sections, in authored order. Sections without a heading are not shown. */
export function overviewSections(value: ModuleOverviewContent['descriptionSections']): OverviewSectionView[] {
  return (Array.isArray(value) ? value : []).flatMap((section, index) => {
    const heading = text(section?.heading);
    if (!heading) return [];
    return [{ id: text(section.id) || `section-${index + 1}`, heading, paragraphs: paragraphs(section.body), bullets: list(section.bullets) }];
  });
}

/**
 * The learner's own quiz results for this module, from the authorised module
 * read. Best score is the highest recorded attempt, exactly as the learning
 * workspace shows it; no overall grade is derived.
 */
export function moduleGrades(module: MyLearningModule | null | undefined, moduleId?: string): OverviewGrade[] {
  const components = (module?.detail.components || []).filter(component => component.isQuiz
    && (!moduleId || !component.moduleId || String(component.moduleId) === String(moduleId)));
  return components.flatMap((component, index) => {
    const title = text(component.component);
    if (!title) return [];
    const attempts = component.quizMeta ? quizAttemptsFor(component, module?.detail.quizAttempts) : [];
    const scores = attempts.map(attempt => attempt.grade * 100).filter(Number.isFinite);
    return [{
      id: text(component.componentId) || `quiz:${component.quizMeta?.quizId ?? index}`,
      title, week: text(component.week), attempts: attempts.length,
      bestPercent: scores.length ? Math.max(...scores) : null,
      passed: attempts.some(attempt => attempt.passed),
    }];
  });
}

export type ModuleOverviewModel = {
  title: string; programme: string; summary: string; descriptionParagraphs: string[];
  sections: OverviewSectionView[]; highlights: string[];
  /** Custom sidebar cards, shown below the system-managed sidebar information. */
  sidebarSections: OverviewSectionView[];
  outcomes: string[]; targetAudience: string[]; prerequisites: string[]; requirements: string[];
  instructor: OverviewInstructor | null; tutorName: string;
  weeks: OverviewWeek[]; counts: ReturnType<typeof typeCounts>; activityTotal: number;
  /** null: grades are not shown (no module read, e.g. the editor preview). */
  grades: OverviewGrade[] | null;
};

const UNASSIGNED = /^(unassigned|to be assigned|tba|tbc)$/i;

/**
 * The model both the learner page and the Module Builder preview render.
 * Dynamic values (title, programme, tutor, curriculum) come from existing
 * records; only `overview` is authored text.
 */
export function composeOverviewModel(input: {
  title: string; programme: string; tutorName: string; outcomes: string[]; weeks: OverviewWeek[];
  overview: Partial<ModuleOverviewContent> | null | undefined; grades: OverviewGrade[] | null;
}): ModuleOverviewModel {
  const overview = input.overview || null;
  const instructor = overview?.instructor && text(overview.instructor.name)
    ? { name: text(overview.instructor.name), bio: text(overview.instructor.bio), photoUrl: text(overview.instructor.photoUrl) }
    : null;
  const tutor = text(input.tutorName);
  return {
    title: text(input.title),
    programme: text(input.programme),
    summary: text(overview?.summary),
    descriptionParagraphs: paragraphs(overview?.description),
    sections: overviewSections(overview?.descriptionSections),
    sidebarSections: overviewSections(overview?.sidebarSections),
    highlights: list(overview?.highlights),
    outcomes: [...new Set(list(input.outcomes))],
    targetAudience: list(overview?.targetAudience),
    prerequisites: list(overview?.prerequisites),
    requirements: list(overview?.requirements),
    instructor,
    tutorName: instructor?.name || (UNASSIGNED.test(tutor) ? '' : tutor),
    weeks: input.weeks,
    counts: typeCounts(input.weeks),
    activityTotal: input.weeks.reduce((sum, week) => sum + week.items.length, 0),
    grades: input.grades,
  };
}

export function buildModuleOverviewModel({ moduleId, title, card, module }: {
  moduleId?: string; title: string; card?: MyLearningCard | null; module?: MyLearningModule | null;
}): ModuleOverviewModel {
  const plan: Partial<PlanModule> | null = module?.schedule.modules.find(item => String(item.id) === String(moduleId))
    || (card?.planModule as Partial<PlanModule> | null | undefined) || null;
  const components = (module?.detail.components || []).filter(component => !moduleId || !component.moduleId || String(component.moduleId) === String(moduleId));
  return composeOverviewModel({
    title: text(plan?.title) || title,
    programme: text(plan?.programme_name),
    tutorName: text(plan?.tutor_name),
    outcomes: list(plan?.learning_outcomes),
    weeks: curriculumWeeks(components, module && moduleId ? moduleCompletion(module, `current:${moduleId}`) : null),
    overview: module?.overview || null,
    grades: module ? moduleGrades(module, moduleId) : null,
  });
}
