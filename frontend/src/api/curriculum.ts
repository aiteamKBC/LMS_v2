// ============================================================================
// Curriculum lookups for the training-plan builder.
// Read-only cascade sourced from the `curriculum` schema (Training_plan +
// module_authoring_* tables) via the Django backend.
// ============================================================================

const BASE = '/learner_api/curriculum';

export interface CurriculumItem {
  id: string;
  title: string;
}
export interface WeekItem extends CurriculumItem {
  weekNumber: number;
}
export interface ComponentItem extends CurriculumItem {
  type: string;
}

async function request<T>(url: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { 'Content-Type': 'application/json' } });
  } catch {
    throw new Error('Could not reach the server. Is the backend running on port 8000?');
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
  return data as T;
}

const qs = (params: Record<string, string>) =>
  new URLSearchParams(params).toString();

/** Distinct programmes (Training_plan.Program). */
export async function fetchProgrammes(): Promise<string[]> {
  return (await request<{ results: string[] }>(`${BASE}/programmes/`)).results;
}

/** Cohorts for a programme. */
export async function fetchCohorts(programme: string): Promise<string[]> {
  return (await request<{ results: string[] }>(`${BASE}/cohorts/?${qs({ programme })}`)).results;
}

/** Groups for a programme + cohort. */
export async function fetchGroups(programme: string, cohort: string): Promise<string[]> {
  return (await request<{ results: string[] }>(`${BASE}/groups/?${qs({ programme, cohort })}`)).results;
}

/** Modules for a programme (independent of cohort/group). */
export async function fetchModules(programme: string): Promise<CurriculumItem[]> {
  return (await request<{ results: CurriculumItem[] }>(`${BASE}/modules/?${qs({ programme })}`)).results;
}

/** Weeks for a module. */
export async function fetchWeeks(moduleId: string): Promise<WeekItem[]> {
  return (await request<{ results: WeekItem[] }>(`${BASE}/weeks/?${qs({ module: moduleId })}`)).results;
}

/** Humanise a component type slug, e.g. 'live_session' -> 'Live session'. */
function humaniseType(type: string): string {
  if (!type) return '';
  const spaced = type.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Components for a week.
 * Imported modules often store an unhelpful component title (e.g. "Week 1"),
 * so we surface the component TYPE and only append the title when it adds info.
 */
export async function fetchComponents(weekId: string): Promise<ComponentItem[]> {
  const results = (await request<{ results: ComponentItem[] }>(`${BASE}/components/?${qs({ week: weekId })}`)).results;
  return results.map((c) => {
    const typeLabel = humaniseType(c.type);
    const showTitle = c.title && c.title.trim().toLowerCase() !== typeLabel.toLowerCase();
    return { ...c, title: showTitle ? `${typeLabel} · ${c.title}` : typeLabel || c.title };
  });
}
