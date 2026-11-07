/** Labels only: never write these derived titles back to a component or meeting. */
export function sessionDisplayTitle(currentTitle: string, weekTitle: string | null | undefined, typeLabel: string): string {
  const title = weekTitle?.trim();
  return title ? `${title} (${typeLabel})` : currentTitle;
}

interface SessionComponent {
  id?: string;
  title: string;
  type: string;
  weekId: string;
  moduleId?: string;
}

export interface SessionTitleWeek {
  id: string;
  title: string;
  moduleId?: string;
}

export function componentSessionTitle(component: SessionComponent, week: SessionTitleWeek | undefined, currentTitle = component.title): string {
  const typeLabel = component.type === 'live-session' ? 'Live Teams Session'
    : component.type === 'recording-placeholder' ? 'Recording Session' : '';
  if (!typeLabel || !week || !component.weekId || component.weekId !== week.id
    || (component.moduleId && week.moduleId && component.moduleId !== week.moduleId)) return currentTitle;
  return sessionDisplayTitle(currentTitle, week.title, typeLabel);
}

/** Planned rows may be reordered; only a stored series/session identity may name them. */
export function seriesSessionWeekTitle(
  weeks: readonly (SessionTitleWeek & { components: readonly (SessionComponent & { settings: Record<string, unknown> })[] })[],
  moduleId: string, seriesId: string | undefined, sessionNumber: number | undefined,
): string {
  if (!seriesId || !sessionNumber) return '';
  const matches = weeks.flatMap(week => week.components.filter(component =>
    component.type === 'live-session' && !!week.id && component.weekId === week.id
    && (!week.moduleId || week.moduleId === moduleId)
    && (!component.moduleId || component.moduleId === moduleId)
    && component.settings?.teamsLiveSessionId === seriesId
    && String(component.settings?.teamsSessionNumber) === String(sessionNumber)).map(() => week.title?.trim() || ''));
  return matches.length === 1 ? matches[0] : '';
}
