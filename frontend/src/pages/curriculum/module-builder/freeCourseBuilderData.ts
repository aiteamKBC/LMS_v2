import type { FreeCourseAuthoringComponent, FreeCourseAuthoringDocument, FreeCourseAuthoringWeek } from '@/lib/curriculumApi';
import type { ModuleComponent } from './moduleAuthoringData';

/** The shared editor receives a view of the canonical activity, never a module identity. */
export function freeCourseEditorComponent(component: FreeCourseAuthoringComponent): ModuleComponent {
  return {
    ...component,
    weekId: component.freeCourseWeekId,
    type: component.type as ModuleComponent['type'],
    expectedOtjh: Number(component.expectedOtjh || 0),
    reflectionQuestion: '',
    coachValidationRequired: false,
    ksbMappings: [],
    settings: component.settings as ModuleComponent['settings'],
  };
}

export function freeCourseComponentChange(component: FreeCourseAuthoringComponent, patch: Partial<ModuleComponent>): FreeCourseAuthoringComponent {
  // Module-only fields are deliberately excluded from the Free Course contract.
  const { title, description, points, reflectionRequired, workplaceEvidenceRequired, tutorValidationRequired, settings } = patch;
  return {
    ...component,
    ...(title !== undefined ? { title } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(points !== undefined ? { points } : {}),
    ...(reflectionRequired !== undefined ? { reflectionRequired } : {}),
    ...(workplaceEvidenceRequired !== undefined ? { workplaceEvidenceRequired } : {}),
    ...(tutorValidationRequired !== undefined ? { tutorValidationRequired } : {}),
    ...(settings !== undefined ? { settings } : {}),
  };
}

export function freeCourseSaveInput(stored: FreeCourseAuthoringDocument, draft: FreeCourseAuthoringDocument) {
  const weekIds = new Set(stored.weeks.map(week => week.freeCourseWeekId));
  const componentIds = new Set(stored.weeks.flatMap(week => week.components.map(component => component.id)));
  const keptWeeks = new Set(draft.weeks.map(week => week.freeCourseWeekId));
  const keptComponents = new Set(draft.weeks.flatMap(week => week.components.map(component => component.id)));
  return {
    expectedRevision: stored.revision,
    // Course displayOrder belongs to catalogue reordering, which requires its own revision.
    course: {
      courseName: draft.course.courseName.trim(),
      description: draft.course.description,
      coverImageUrl: draft.course.coverImageUrl,
      courseType: draft.course.courseType,
      isForSale: draft.course.isForSale,
      price: draft.course.isForSale ? draft.course.price : null,
      currency: draft.course.currency,
    },
    weeks: draft.weeks.map((week, index) => ({
      ...week,
      freeCourseWeekId: weekIds.has(week.freeCourseWeekId) ? week.freeCourseWeekId : undefined,
      ...(!weekIds.has(week.freeCourseWeekId) ? { clientId: week.freeCourseWeekId } : {}),
      displayOrder: index,
      weekNumber: index + 1,
      components: week.components.map((component, componentIndex) => ({
        ...component,
        id: componentIds.has(component.id) ? component.id : undefined,
        ...(!componentIds.has(component.id) ? { clientId: component.id } : {}),
        displayOrder: componentIndex,
      })),
    })),
    deletedWeekIds: [...weekIds].filter(id => !keptWeeks.has(id)),
    deletedComponentIds: [...componentIds].filter(id => !keptComponents.has(id)),
  };
}

export function newFreeCourseWeek(index: number): FreeCourseAuthoringWeek {
  return {
    freeCourseWeekId: `draft-week:${crypto.randomUUID()}`, legacyCopiedFromWeekId: null,
    weekNumber: index + 1, displayOrder: index, title: `Week ${index + 1}`, summary: '',
    learningOutcomes: [], status: 'active', holidayNoteEnabled: false, holidayNote: '', components: [],
  };
}

export function freeCourseReturnTo(value: string | null) {
  // Return destinations come from the two catalogue screens, never arbitrary URLs.
  const [path, query = ''] = (value || '').split('?');
  if (path === '/curriculum/free-courses') return value!;
  if (path === '/curriculum/module-builder') {
    const params = new URLSearchParams(query);
    params.delete('freeCourse');
    params.delete('returnTo');
    params.set('catalogue', 'free');
    return `${path}?${params}`;
  }
  return '/curriculum/module-builder?catalogue=free';
}
