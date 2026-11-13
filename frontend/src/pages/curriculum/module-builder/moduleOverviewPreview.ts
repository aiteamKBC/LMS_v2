import {
  componentType, composeOverviewModel, type ModuleOverviewModel, type OverviewWeek,
} from '@/pages/learner/my-learning/moduleOverviewModel';
import type { ModuleCatalogueItem } from './moduleAuthoringData';
import { photoUrlProblem, type ModuleOverviewFields, type ModuleOverviewRecord } from './moduleOverviewApi';

/**
 * The module's existing (not authored) values the preview shows: title,
 * programme, cover and curriculum. Read from the module's stored structure;
 * the editor never writes any of them.
 */
export type OverviewPreviewSource = {
  title: string;
  programme: string;
  coverUrl: string;
  weeks: OverviewWeek[];
  outcomes: string[];
};

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

export function previewSourceFromStructure(structure: Pick<ModuleCatalogueItem, 'title' | 'programmeName' | 'coverImage' | 'weekStructure'> | null | undefined,
  fallback: { title: string; programme?: string; coverUrl?: string } = { title: '' }): OverviewPreviewSource {
  // Kept in the order the structure read returns (display_order, week_number,
  // id) -- the same order the learner's module read uses for weeks and for
  // the learning outcomes collected from them. Never re-sorted here.
  const weeks = structure?.weekStructure || [];
  return {
    title: text(structure?.title) || fallback.title,
    programme: text(structure?.programmeName) || text(fallback.programme),
    coverUrl: text(structure?.coverImage) || text(fallback.coverUrl),
    weeks: weeks.flatMap(week => {
      const label = text(week.title) || (week.weekNumber ? `Week ${week.weekNumber}` : 'Additional activities');
      const items = (week.components || []).flatMap((component, index) => {
        const title = text(component.title);
        if (!title) return [];
        // No learner in the Module Builder: completion is unknown, so no lock or check is shown.
        return [{ id: text(component.id) || `${week.id}:${index}`, title, type: componentType({ type: component.type, isQuiz: component.type === 'quiz' }),
          questions: null, completed: null }];
      });
      return items.length ? [{ key: text(week.id) || label, label, items }] : [];
    }),
    outcomes: weeks.flatMap(week => week.learningOutcomes || []).map(text).filter(Boolean),
  };
}

/** The photo learners would see for the draft: a valid override, else the tutor's standard photo. */
export function previewPhotoUrl(fields: Pick<ModuleOverviewFields, 'instructorPhotoUrl'>, record: Pick<ModuleOverviewRecord, 'defaultPhotoUrl'> | null) {
  const url = fields.instructorPhotoUrl.trim();
  if (url) return photoUrlProblem(url) ? '' : url;
  return record?.defaultPhotoUrl || '';
}

/** The learner page model for the unsaved draft. Nothing here is persisted. */
export function buildPreviewModel(source: OverviewPreviewSource, record: ModuleOverviewRecord | null, fields: ModuleOverviewFields): ModuleOverviewModel {
  const tutor = text(record?.tutorName);
  return composeOverviewModel({
    title: source.title,
    programme: source.programme,
    tutorName: tutor,
    outcomes: source.outcomes,
    weeks: source.weeks,
    overview: {
      ...fields,
      instructor: tutor ? { name: tutor, bio: fields.instructorBio, photoUrl: previewPhotoUrl(fields, record) } : null,
    },
    // The learner's own results are not available in the Module Builder.
    grades: null,
  });
}
