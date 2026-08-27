// ============================================================================
// Tutor workspace API client.
//
// One read: the modules a tutor is assigned to, and their next live session.
// GET /curriculum_api/curriculum/tutor-workspace/?email=<email>&name=<name>
//
// Both keys are sent because the login account and the curriculum tutor profile
// are separate records referencing each other by neither id nor foreign key.
// The server prefers email and falls back to name; sending both keeps that
// choice server-side, where the profile rows actually are.
//
// Deliberately not routed through lib/curriculumApi's fetchJson: that layer
// carries the authoring caches and mutation-epoch invalidation the curriculum
// builder needs, and a tutor opening their own workspace wants the current
// timetable, not a cached one.
// ============================================================================

const BASE = '/curriculum_api/curriculum/tutor-workspace/';

/** One module the tutor is assigned to deliver. */
export interface TutorModule {
  moduleCatalogueId: string;
  title: string;
  description: string;
  programmeName: string;
  cohortName: string;
  groupName: string;
  colour: string;
  /** Planned off-the-job hours. Sent as a decimal string by the API. */
  totalOtjh: string | number | null;
  sessionsNumber: number | null;
  startDate: string;
  endDate: string;
  /** The module's planned weekly slot — its intent, not a booked meeting. */
  sessionWeekDay: string;
  sessionStartTime: string;
  sessionEndTime: string;
  /**
   * This module's own next session, so opening a module needs no second request
   * to find out when it next runs. Null when nothing upcoming is scheduled
   * against it — which is independent of the other modules.
   */
  nextSession: TutorNextSession | null;
}

/** One component inside a week, as the module structure reports it. */
export interface ModuleComponent {
  id: string;
  type: string;
  title: string;
  description: string;
  expectedOtjh: number | null;
  points: number | null;
  reflectionRequired: boolean;
  workplaceEvidenceRequired: boolean;
  tutorValidationRequired: boolean;
}

export interface ModuleWeek {
  id: string;
  weekNumber: number;
  title: string;
  summary: string;
  components: ModuleComponent[];
}

/**
 * A module's authored structure.
 *
 * Read from the curriculum builder's own endpoint rather than a tutor-specific
 * one: the weeks and components a tutor needs to see are exactly the weeks and
 * components the builder wrote, and a second query over the same tables would
 * be a copy to keep in step for no gain.
 */
export interface ModuleStructure {
  weeks: ModuleWeek[];
}

/**
 * The current or next scheduled occurrence across every assigned module.
 *
 * `scheduledStart`/`scheduledEnd` are UTC ISO timestamps. `timezone` is the
 * Windows zone name the series was created in (e.g. "GMT Standard Time").
 * The tutor workspace displays and gates the meeting in UK time.
 */
export interface TutorNextSession {
  liveSessionId: string;
  moduleCatalogueId: string;
  moduleTitle: string;
  sessionNumber: number | null;
  scheduledStart: string;
  scheduledEnd: string;
  timezone: string;
  durationMinutes: number | null;
  repeatPattern: string;
  repeatOccurrences: number | null;
  joinUrl: string;
  status: string;
}

export interface TutorWorkspace {
  /**
   * False when no tutor profile matches this account by email or name.
   *
   * Distinct from "linked with nothing assigned": the account exists but cannot
   * be matched to any record holding assignments, which is a different thing to
   * tell somebody than an empty timetable.
   */
  linked: boolean;
  /**
   * Which key resolved the tutor: 'email', 'name', or '' when unlinked.
   * Reported so "why does this account see these modules?" is answerable
   * without re-deriving the match.
   */
  matchedBy: string;
  tutor: { id: string; name: string; email: string; jobTitle: string } | null;
  /** Only the explicit assigned_module_ids grant on the tutor profile. */
  assignedModuleIds: string[];
  modules: TutorModule[];
  nextSession: TutorNextSession | null;
}

const STRUCTURE_BASE = '/curriculum_api/curriculum/modules';

export async function fetchModuleStructure(
  moduleCatalogueId: string,
  signal?: AbortSignal,
): Promise<ModuleStructure> {
  const url = `${STRUCTURE_BASE}/${encodeURIComponent(moduleCatalogueId)}/structure/`;
  let response: Response;
  try {
    response = await fetch(url, { signal });
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') throw error;
    throw new Error('Could not reach the server.');
  }
  const text = await response.text();
  let data: { weekStructure?: unknown[]; error?: string } | null = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`The server returned an unexpected response (${response.status}).`);
  }
  if (!response.ok) throw new Error(data?.error || `Request failed (${response.status})`);

  // The builder's payload is much wider than this view needs; only the week and
  // component fields shown on the page are carried across, so an unrelated
  // change to the rest of it cannot break this screen.
  const weeks = (Array.isArray(data?.weekStructure) ? data!.weekStructure : []) as Record<string, unknown>[];
  return {
    weeks: weeks.map((week) => ({
      id: String(week.id ?? ''),
      weekNumber: Number(week.weekNumber ?? 0),
      title: String(week.title ?? ''),
      summary: String(week.summary ?? ''),
      components: (Array.isArray(week.components) ? week.components : []).map((raw) => {
        const component = raw as Record<string, unknown>;
        return {
          id: String(component.id ?? ''),
          type: String(component.type ?? ''),
          title: String(component.title ?? ''),
          description: String(component.description ?? ''),
          expectedOtjh: component.expectedOtjh == null ? null : Number(component.expectedOtjh),
          points: component.points == null ? null : Number(component.points),
          reflectionRequired: Boolean(component.reflectionRequired),
          workplaceEvidenceRequired: Boolean(component.workplaceEvidenceRequired),
          tutorValidationRequired: Boolean(component.tutorValidationRequired),
        };
      }),
    })),
  };
}

export async function fetchTutorWorkspace(
  identity: { email?: string; name?: string },
  signal?: AbortSignal,
): Promise<TutorWorkspace> {
  const query = new URLSearchParams();
  if (identity.email) query.set('email', identity.email);
  if (identity.name) query.set('name', identity.name);

  let response: Response;
  try {
    response = await fetch(`${BASE}?${query.toString()}`, { signal });
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') throw error;
    throw new Error('Could not reach the server. Is the backend running on port 8000?');
  }
  const text = await response.text();
  let data: (Partial<TutorWorkspace> & { error?: string }) | null = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`The server returned an unexpected response (${response.status}).`);
  }
  if (!response.ok) {
    throw new Error(data?.error || `Request failed (${response.status})`);
  }
  return {
    linked: Boolean(data?.linked),
    matchedBy: data?.matchedBy ?? '',
    tutor: data?.tutor ?? null,
    assignedModuleIds: Array.isArray(data?.assignedModuleIds)
      ? data.assignedModuleIds.map(String)
      : [],
    modules: data?.modules ?? [],
    nextSession: data?.nextSession ?? null,
  };
}
