import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AppIcon } from '@/components/feature/AppIcon';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { showCurriculumAlert } from '@/components/feature/CurriculumSweetAlert';
import { findModule, formatProgrammeLevel, namedCurriculumWorkspacePath, programmeIdentity, visibleNotes } from '@/pages/curriculum/shared/entities/model';
// Editing the programme, or adding a cohort or group from this page,
// opens the same drawer that record's own page opens. One form per record type in
// the whole studio, so nothing behaves differently depending on the door taken.
import { CohortFormDrawer, GroupFormDrawer, ProgrammeFormDrawer } from '@/pages/curriculum/shared/entities/forms';
import { ModuleFormDrawer, moduleFormTarget, type ModuleFormTarget } from '@/pages/curriculum/shared/entities/moduleForm';
import {
  ScopeAchievementPanel,
  ScopeLearnerAchievementDetail,
  type KsbCredit,
} from '@/pages/curriculum/shared/entities/scopeAchievement';
// The same rule applies to reading: the record tables, filter bars and workspace
// chrome here are the shared ones the Cohort, Group and Module workspaces use, so
// a programme is a lens on those records rather than a second rendering of them.
// Anything that belongs to one record — a module's Teams series, a week's
// components, a cohort's holidays — is reached by opening that record, not
// re-drawn here.
import {
  DetailRow,
  EntityEmptyState,
  EntityFilterBar,
  EntityTable,
  InlineError,
  NamedActions,
  PlainCell,
  RowActions,
  StackedCell,
  StatusBadge,
  WorkspaceHeader,
  WorkspacePanel,
  WorkspaceTabs,
} from '@/pages/curriculum/shared/entities/ui';
import { archiveCohortWithConfirm, archiveGroupWithConfirm, archiveModuleWithConfirm } from '@/pages/curriculum/shared/entities/archive';
import { curriculumNavItems } from '@/mocks/navigation';
import type {
  CurriculumCohort,
  CurriculumComponent,
  CurriculumGroup,
  CurriculumKsbEntry,
  CurriculumModule,
  CurriculumOverview,
  CurriculumProgramme,
  CurriculumProgrammeDetail,
  CurriculumProgrammeAssignedLearner,
  CurriculumProgrammeLearnerRosterResponse,
  CurriculumSession,
  CurriculumStaffProfile,
  CurriculumHoliday,
  CurriculumKsbCoverageResponse,
  CurriculumKsbSet,
  CurriculumStandard,
} from '@/lib/curriculumApi';
import {
  fetchCurriculumComponents,
  fetchCurriculumLiveSessionOccurrences,
  type CurriculumLiveSessionOccurrence,
  fetchCurriculumProgrammes,
  fetchCurriculumProgrammeDetail,
  fetchCurriculumProgrammeKsbCoverage,
  fetchCurriculumScopeLearnerRoster,
  fetchCurriculumKsbSets,
  fetchCurriculumKsbFrameworks,
  fetchCurriculumCoaches,
  fetchCurriculumHolidays,
  fetchCurriculumStandards,
  fetchCurriculumTutors,
  tutorConflictMessage,
  updateCurriculumGroup,
} from '@/lib/curriculumApi';
import { SlideDeckViewer } from '@/components/feature/SlideDeckViewer';
import { VideoPlayer, parseVideoUrl } from '@/components/feature/VideoPlayer';
import { resolveDocEmbed } from '@/lib/docEmbed';
import { type KsbMapping } from '../module-builder/moduleAuthoringData';
import { SessionsTree } from './SessionsTree';

// ============================================================
// Types — Full Programme Hierarchy
// ============================================================

interface Session {
  id: string;
  title: string;
  type: 'Live Session' | 'Workshop' | 'Self-study' | 'Assignment' | 'Quiz' | 'OTJH' | 'Collaboration' | 'Review';
  day: string;
  date: string;
  startTime: string;
  endTime: string;
  duration: number;
  tutor: string;
  venue: string;
  deliveryMode: string;
  ksbRefs: string[];
  skippedHolidays?: string[];
  scheduleWarnings?: string[];
  status: 'scheduled' | 'completed' | 'cancelled' | 'pending';
}

interface Week {
  id: string;
  number: number;
  title: string;
  startDate: string;
  endDate: string;
  otjh: number;
  components?: ProgrammeWeekComponent[];
  sessions: Session[];
}

type ProgrammeWeekComponent = Partial<CurriculumComponent> & {
  id: string;
  title: string;
  type: string;
  duration: number;
  status: CurriculumComponent['status'];
  contentSections: number;
  quizQuestions?: number | null;
  ksbRefs: string[];
};

type KsbEvidenceItem = {
  module: string;
  scope: 'module' | 'week' | 'component' | 'live';
  week?: string;
  component?: string;
  componentType?: string;
  classification?: string;
  groups?: string[];
  weight: number;
};
type ModuleKsbMappingSummary = { ksb: string; weight: number; count?: number; evidence?: KsbEvidenceItem[]; source?: 'authoring' | 'fallback'; sourceType?: string; sourceId?: string };
type KsbHeatmapRow = {
  id?: string;
  ksb: string;
  title: string;
  description?: string;
  coverage: Record<string, number | null>;
  counts?: Record<string, number>;
  evidence?: Record<string, KsbEvidenceItem[]>;
  totalOccurrences?: number;
  totalWeight?: number;
  sourceType?: string;
  sourceId?: string;
  sourceName?: string;
  sourceLabel?: string;
  missing?: boolean;
};

interface Module {
  id: string;
  sourceId?: string | number;
  moduleId?: string;
  moduleCatalogueId?: string;
  catalogueId?: string;
  structureId?: string;
  name: string;
  description: string;
  cohortId?: string;
  cohort?: string;
  groupId?: string;
  group?: string;
  coach?: string;
  tutor?: string;
  weeks: number;
  /**
   * The module's own placement dates, as the record holds them — including an end
   * that holidays moved or a tutor set by hand. Kept apart from the week span in
   * `weeksData`, which is where the authored sessions happen to fall: a module
   * whose last week has one session on 5 Oct can still legitimately end on 15 Oct,
   * and printing the week span as the module's dates contradicted its own record.
   */
  startDate?: string;
  endDate?: string;
  otjh: number;
  status: 'published' | 'approved' | 'in-review' | 'draft';
  ksbTags: string[];
  ksbMapping: ModuleKsbMappingSummary[];
  weeksData: Week[];
}

function isCanonicalModuleBuilderId(value: unknown) {
  return /^MOD-[A-Z0-9][A-Z0-9_-]*$/i.test(clean(value));
}

function moduleBuilderIdentifier(module: Pick<Module, 'id' | 'sourceId' | 'moduleId' | 'moduleCatalogueId' | 'catalogueId' | 'structureId'>) {
  const candidates = uniqueCleanValues([
    module.moduleCatalogueId,
    module.catalogueId,
    module.structureId,
    module.moduleId,
    module.id,
    module.sourceId,
  ]);
  return candidates.find(isCanonicalModuleBuilderId) || candidates[0] || '';
}

function moduleBuilderUrl(
  module: Pick<Module, 'id' | 'sourceId' | 'moduleId' | 'moduleCatalogueId' | 'catalogueId' | 'structureId' | 'name'>,
  programme?: Pick<Programme, 'id' | 'sourceId' | 'name'>,
  /** Deep-links straight past the module's landing view into one week or
   *  component's own editor — the same `week`/`component` params Module
   *  Builder's own deep-link handler (`moduleBuilderDeepLinkTarget`) already
   *  reads on load, so this is landing on a door it already opens for itself. */
  target?: { weekId?: string; componentId?: string },
) {
  const params = new URLSearchParams();
  const moduleId = moduleBuilderIdentifier(module);
  if (moduleId) params.set('module', moduleId);
  // A genuine second attempt, not only the id's last resort: the delivery
  // side and Module Builder's own catalogue sometimes disagree on which id is
  // canonical for the same module, so a guessed id that Module Builder cannot
  // match still gets found by name rather than reporting the module missing.
  const moduleName = clean(module.name);
  if (moduleName) params.set('moduleTitle', moduleName);
  const programmeId = clean(programme?.sourceId || programme?.id || programme?.name);
  if (programmeId) params.set('programme', programmeId);
  const programmeName = clean(programme?.name);
  if (programmeName) params.set('programmeName', programmeName);
  const weekId = clean(target?.weekId);
  if (weekId) params.set('week', weekId);
  const componentId = clean(target?.componentId);
  if (componentId) params.set('component', componentId);
  const query = params.toString();
  return `/curriculum/module-builder${query ? `?${query}` : ''}`;
}

/**
 * The module's own workspace — its schedule, components, KSB weights, Teams
 * series and sessions. The identity precedence matches `moduleIdentity` in the
 * shared model, which is what that page resolves the route param with.
 */
function moduleWorkspaceUrl(module: Pick<Module, 'id' | 'moduleId' | 'moduleCatalogueId' | 'catalogueId' | 'name'>) {
  const identity = clean(module.moduleCatalogueId)
    || clean(module.catalogueId)
    || clean(module.moduleId)
    || clean(module.id);
  return identity ? namedCurriculumWorkspacePath('modules', identity, module.name) : '';
}

interface Group {
  id: string;
  name: string;
  learners: number;
  coach: string;
  tutor: string;
  startDate: string;
  endDate: string;
  status: 'active' | 'planned' | 'completed';
  modules: Module[];
  schedule: string;
  mode: string;
}

interface Cohort {
  id: string;
  name: string;
  startDate: string;
  /** End of the practical period. */
  endDate: string;
  /** When the apprenticeship ends: the authored date when there is one, otherwise the practical end date plus the EPA period. Blank when neither is recorded. */
  apprenticeshipEndDate: string;
  /** True when the date above was typed rather than calculated. */
  apprenticeshipEndIsManual: boolean;
  epaMonths: number | null;
  status: 'active' | 'planned' | 'completed';
  learners: number;
  groups: Group[];
  holidayIds?: string[];
  holidays?: CurriculumHoliday[];
}

interface Programme {
  id: string;
  sourceId?: string;
  ksbProfileSourceId?: string;
  structureType?: 'scheduled' | 'free' | string;
  name: string;
  standard: string;
  level: string;
  owner: string;
  color: string;
  description: string;
  duration: string;
  /**
   * The two windows the apprenticeship model distinguishes, read across every
   * cohort on the programme. Both open on the earliest cohort start; the
   * practical period closes on the latest practical end, and the apprenticeship
   * runs on past it by the EPA window.
   */
  practicalWindow: string;
  apprenticeshipWindow: string;
  cohorts: Cohort[];
  modules: Module[];
  ksbHeatmap: KsbHeatmapRow[];
  moduleNames: string[];
  /**
   * Off-the-job hours a learner must complete across the whole programme.
   * null means no target has been set, which is not the same as a target of
   * zero: without one there is nothing for authored OTJH to be a share of.
   */
  requiredOtjh: number | null;
  /**
   * What the learners have actually evidenced, from the Component Progress
   * snapshot (`learner_progress_ksbs`) by way of programme_learner_ksb_progress.
   * A different question from the coverage heatmap above, which measures how
   * much of the standard the *design* touches, so the two never share a figure.
   */
  learnerKsbProgressPercentage: number;
  learnerKsbCodesStarted: number;
  learnerKsbCodesComplete: number;
  learnerKsbCodesTotal: number;
  learnerKsbLearnerCount: number;
}

// A delivery session shown on the Sessions tab, derived from real week-builder
// components: `live-session` components are Live, `video` components are Recorded.
type DeliverySessionKind = 'live' | 'recorded';
export interface DeliverySession {
  id: string;
  kind: DeliverySessionKind;
  title: string;
  module: string;
  /** The module the row belongs to — the link target for "Open in builder". */
  moduleCatalogueId: string;
  week: number;
  /** The authored week's own id — the deep-link target for jumping straight to
   *  this week in Module Builder, whether to review it or to create the meeting
   *  it doesn't have yet. */
  weekId: string;
  /** The week's own title, empty when the author never gave it one. */
  weekTitle: string;
  /** The week's first teaching date. Context for a live row, whose own date is
   *  its schedule; for a recording, which has no date of its own, this is what
   *  the Sessions tree groups the row by. */
  weekStartDate: string;
  /** The meeting's own scheduled date and time. Empty means unscheduled. */
  date: string;
  /** The best machine-sortable instant for this session (occurrence start when
   *  tracked, else the authored date). Drives month grouping and ordering. */
  dateIso: string;
  time: string;
  groups: string[];
  url: string;
  provider: string;
  durationMinutes: number;
  attendanceRequired: boolean;
  recordingExpected: boolean;
  ksbRefs: string[];
  /** Real occurrence status from the sync service ('scheduled' | 'completed' |
   *  'cancelled'); falls back to a planned/authoring status when untracked, or to
   *  `'not-created'` for a week that plans a live session — see
   *  every-week-gets-its-own-live-session — but has no Teams meeting attached. */
  status: CurriculumComponent['status'] | string;
  /** The live-session series id (component.settings.teamsLiveSessionId), needed
   *  to lazy-load a completed session's attendance/transcript/recording. */
  liveSessionId: string;
  /** This session's occurrence id + number, used to pick its row out of the
   *  series' artifacts payload. */
  occurrenceId: string;
  sessionNumber: number;
  /** Populated only for completed occurrences (from the sync service). */
  actualStart: string;
  actualEnd: string;
  participantCount: number;
  /** When the sync service last pulled this occurrence's recording, transcript
   *  and attendance from Teams. Empty on a completed occurrence means the
   *  meeting ended but nothing has synced yet — distinct from a sync that ran
   *  and genuinely found no recording. */
  artifactsSyncedAt: string;
}

// A week and a session are two different records and neither may borrow the
// other's name or date. The week is the container the module authored; the
// session is one Teams meeting inside it. So an untitled week prints as "Week 3"
// instead of "Week 3 · Week 3", a week never inherits its first meeting's title,
// and a meeting with no date of its own says so rather than showing its week's
// start date under a column headed "Scheduled".
function sessionWeekLabel(session: DeliverySession) {
  return session.weekTitle ? `Week ${session.week} · ${session.weekTitle}` : `Week ${session.week}`;
}

// Classify a component as a Live session or a Recorded video. NOTE: the
// `/curriculum/components/` list endpoint returns a *display* type — live-session
// becomes "Live Session" but video/podcast/reading/powerpoint all collapse to
// "Self-study" — so `type` alone can't isolate video. We match on the tolerant
// type string first, then fall back to the component's own authoring settings
// keys (which stay type-specific), so this works whichever endpoint fed us.
function deliveryKindForComponent(component: { type?: string; settings?: Record<string, unknown> }): DeliverySessionKind | null {
  const settings = (component.settings || {}) as Record<string, unknown>;
  const key = normalise(component.type);
  if (key.includes('live') || 'liveSessionUrl' in settings || 'sessionDate' in settings || 'attendanceRequired' in settings || 'recordingExpected' in settings) {
    return 'live';
  }
  // `videoUrl` only, not `requiredProgressPercentage` — a podcast component
  // tracks listening progress under that same key, so sniffing on it alone
  // classified every podcast as a recorded video too.
  if (key.includes('video') || 'videoUrl' in settings) {
    return 'recorded';
  }
  return null;
}

// ============================================================
// Defaults
// ============================================================

const EMPTY_PROGRAMME: Programme = {
  id: '',
  sourceId: '',
  name: 'Programme',
  standard: 'Standard not set',
  level: '',
  owner: '',
  color: '#6941c6',
  description: '',
  duration: 'Live curriculum',
  practicalWindow: '',
  apprenticeshipWindow: '',
  cohorts: [],
  modules: [],
  ksbHeatmap: [],
  moduleNames: [],
  requiredOtjh: null,
  learnerKsbProgressPercentage: 0,
  learnerKsbCodesStarted: 0,
  learnerKsbCodesComplete: 0,
  learnerKsbCodesTotal: 0,
  learnerKsbLearnerCount: 0,
};

function clean(value: unknown, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function normalise(value: unknown) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * The address behind a session's Watch/Join link.
 *
 * A component authored with the Embed source stores an `<iframe>` snippet, not
 * an address, so handing it to an `href` made the browser resolve the whole tag
 * as a relative path and land on the router's 404. The snippet's `src` is the
 * part that can be opened. Anything that is not an absolute http(s) address is
 * dropped rather than linked: a stray `javascript:` in authored settings would
 * otherwise run on click.
 */
function watchableUrl(value: unknown) {
  const text = clean(value);
  if (!text) return '';
  const source = text.includes('<')
    ? clean(text.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1]).replace(/&amp;/g, '&')
    : text;
  if (!source) return '';
  const absolute = source.startsWith('//') ? `https:${source}` : source;
  return /^https?:\/\//i.test(absolute) ? absolute : '';
}

function slugify(value: unknown) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'item';
}

type KsbKind = 'knowledge' | 'skill' | 'behaviour' | 'other';

function ksbKind(code: string): KsbKind {
  const prefix = clean(code).charAt(0).toUpperCase();
  if (prefix === 'K') return 'knowledge';
  if (prefix === 'S') return 'skill';
  if (prefix === 'B') return 'behaviour';
  return 'other';
}

function formatKsbCode(code: string) {
  const value = clean(code).toUpperCase();
  const match = value.match(/^([KSB])(\d+(?:\.\d+)?)$/);
  if (!match) return value;
  const [, prefix, number] = match;
  if (number.includes('.') || number.length === 1) return `${prefix}${number}`;
  return `${prefix}${number.slice(0, 1)}.${number.slice(1)}`;
}

function ksbTone(kind: KsbKind) {
  if (kind === 'knowledge') return 'bg-sky-50 text-sky-700 border-sky-200/70';
  if (kind === 'skill') return 'bg-emerald-50 text-emerald-700 border-emerald-200/70';
  if (kind === 'behaviour') return 'bg-amber-50 text-amber-700 border-amber-200/70';
  return 'bg-foreground-100 text-foreground-600 border-foreground-200/70';
}

function sortKsbCodes(a: string, b: string) {
  const order: Record<string, number> = { K: 0, S: 1, B: 2 };
  const parse = (code: string) => {
    const formatted = formatKsbCode(code);
    const match = formatted.match(/^([KSB])(\d+)(?:\.(\d+))?$/);
    return {
      prefix: match?.[1] || 'Z',
      major: Number(match?.[2] || 999),
      minor: Number(match?.[3] || -1),
      label: formatted,
    };
  };
  const left = parse(a);
  const right = parse(b);
  return (order[left.prefix] ?? 9) - (order[right.prefix] ?? 9)
    || left.major - right.major
    || left.minor - right.minor
    || left.label.localeCompare(right.label);
}

type KsbRollupItem = {
  ksb: string;
  title: string;
  weight: number;
  count: number;
  evidence: KsbEvidenceItem[];
  source: 'authoring' | 'fallback';
  sourceType?: string;
  sourceId?: string;
};

function uniqueCleanValues(values: unknown[]) {
  const seen = new Set<string>();
  return values.map(value => clean(value)).filter(value => {
    const key = normalise(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isInternalGroupIdentifier(value: string) {
  const cleaned = clean(value);
  return /^GROUP-\d{10,}$/i.test(cleaned)
    || /^GRP-?[A-Z0-9]{10,}$/i.test(cleaned)
    || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cleaned);
}

function displayGroupValues(values: unknown[]) {
  const expanded = values.flatMap(value => clean(value).split(',').map(part => part.trim()));
  return uniqueCleanValues(expanded).filter(value => !isInternalGroupIdentifier(value));
}

function ksbKey(code: string) {
  return formatKsbCode(code);
}

function normaliseKsbSourceType(sourceType?: string, sourceId?: string) {
  const explicit = normalise(sourceType);
  if (explicit) return explicit;
  const id = clean(sourceId).toLowerCase();
  if (id.startsWith('standard:')) return 'standard';
  if (id) return 'framework';
  return '';
}

function normaliseKsbSourceId(sourceId?: string) {
  return normalise(clean(sourceId).replace(/^(profile|framework|standard):/i, ''));
}

function ksbRollupIdentity(value: { code?: string; ksb?: string; sourceType?: string; sourceId?: string }) {
  const code = ksbKey(value.code || value.ksb || '');
  if (!code) return '';
  return [normaliseKsbSourceType(value.sourceType, value.sourceId), normaliseKsbSourceId(value.sourceId), code].join('|');
}

function ksbSetSourceIdForProgrammeDetail(set?: CurriculumKsbSet) {
  if (!set) return '';
  const key = set.frameworkId || (set.profileId ? `ksb-${set.profileId}` : '') || set.programmeId || set.programmeName || set.standard;
  return clean(key);
}

type KsbCoverageSourceRequest = { sourceType?: string; sourceId?: string };

function splitProgrammeKsbSource(value?: string): KsbCoverageSourceRequest {
  const stored = clean(value);
  if (!stored) return {};
  const match = stored.match(/^([a-z_-]+):(.*)$/i);
  if (!match) return { sourceType: 'framework', sourceId: stored };
  const [, rawType, rawId] = match;
  const sourceId = clean(rawId);
  if (!sourceId) return {};
  const sourceType = normalise(rawType);
  if (['standard', 'skills_standard', 'skills-england', 'skills_england'].includes(sourceType)) {
    return { sourceType: 'standard', sourceId };
  }
  if (['profile', 'ksb_profile', 'framework'].includes(sourceType)) {
    return { sourceType: 'framework', sourceId };
  }
  return { sourceType: sourceType || 'framework', sourceId };
}

function programmeKsbCoverageSource(programme: Pick<Programme, 'ksbProfileSourceId' | 'standard'>): KsbCoverageSourceRequest {
  const explicit = splitProgrammeKsbSource(programme.ksbProfileSourceId);
  if (explicit.sourceId) return explicit;
  const standardId = rawSkillsStandardIdentifier(programme as Programme);
  return standardId ? { sourceType: 'standard', sourceId: standardId } : {};
}

function inferProgrammeKsbCoverageSource(
  programme: Pick<Programme, 'id' | 'sourceId' | 'name' | 'standard' | 'ksbProfileSourceId'>,
  ksbSets: CurriculumKsbSet[],
  standards: CurriculumStandard[],
): KsbCoverageSourceRequest {
  const explicit = programmeKsbCoverageSource(programme as Programme);
  if (explicit.sourceId) return explicit;

  const programmeIds = uniqueCleanValues([programme.sourceId, programme.id, programme.name]);
  const linkedProfile = ksbSets.find(set => {
    const linkedProgrammeIds = uniqueCleanValues([set.programmeId, ...(set.programmeIds || [])]);
    return programmeIds.some(id => linkedProgrammeIds.some(linkedId => normalise(id) === normalise(linkedId)));
  });
  if (linkedProfile) {
    const sourceId = ksbSetSourceIdForProgrammeDetail(linkedProfile);
    if (sourceId) return { sourceType: 'framework', sourceId };
  }

  const linkedStandard = standards.find(standard => (
    normalise(standard.id) === normalise(programme.standard)
    || normalise(standard.name) === normalise(programme.standard)
    || normalise(standard.standardRef) === normalise(programme.standard)
  ));
  return linkedStandard ? { sourceType: 'standard', sourceId: linkedStandard.id } : {};
}

function sourceMatchesProgrammeSource(row: Pick<KsbHeatmapRow, 'sourceType' | 'sourceId'>, source: KsbCoverageSourceRequest) {
  if (!source.sourceId) return true;
  const rowSourceId = normaliseKsbSourceId(row.sourceId);
  if (!rowSourceId) return true;
  const rowSourceType = normaliseKsbSourceType(row.sourceType, row.sourceId);
  const requiredType = normaliseKsbSourceType(source.sourceType, source.sourceId);
  return rowSourceId === normaliseKsbSourceId(source.sourceId) && (!requiredType || !rowSourceType || rowSourceType === requiredType);
}

function filterHeatmapRowsByProgrammeSource(rows: KsbHeatmapRow[], source: KsbCoverageSourceRequest) {
  return source.sourceId ? rows.filter(row => sourceMatchesProgrammeSource(row, source)) : rows;
}

function ksbDescriptionKeys(code: string, sourceType?: string, sourceId?: string) {
  const formatted = formatKsbCode(code);
  const compact = formatted.replace('.', '');
  const codes = uniqueCleanValues([formatted, compact, clean(code).toUpperCase()]);
  const type = normaliseKsbSourceType(sourceType, sourceId);
  const source = normaliseKsbSourceId(sourceId);
  return codes.flatMap(item => [
    type || source ? `${type}|${source}|${item}` : '',
    `||${item}`,
  ]).filter(Boolean);
}

function addKsbDescription(lookup: Map<string, string>, code: string, description: string, sourceType?: string, sourceId?: string) {
  const text = clean(description);
  if (!code || !text || normalise(text) === normalise(code)) return;
  ksbDescriptionKeys(code, sourceType, sourceId).forEach(key => {
    if (!lookup.has(key)) lookup.set(key, text);
  });
}

function buildKsbDescriptionLookup(ksbSets: CurriculumKsbSet[], standards: CurriculumStandard[]) {
  const lookup = new Map<string, string>();
  const visitEntry = (entry: CurriculumKsbEntry & { children?: CurriculumKsbEntry[] }, sourceType: string, sourceId: string) => {
    const codes = uniqueCleanValues([entry.code, entry.rawCode, entry.fullCode]);
    codes.forEach(code => addKsbDescription(lookup, code, clean(entry.description || entry.title), sourceType, sourceId));
    (entry.children || []).forEach(child => visitEntry(child, sourceType, sourceId));
  };
  ksbSets.forEach(set => {
    const sourceIds = uniqueCleanValues([
      ksbSetSourceIdForProgrammeDetail(set),
      set.frameworkId,
      set.ksbProfileId,
      set.profileId ? String(set.profileId) : '',
      set.profileId ? `KSBP-${set.profileId}` : '',
      set.programmeId,
      set.programmeName,
      set.standard,
    ]);
    set.ksbs.forEach(entry => sourceIds.forEach(sourceId => visitEntry(entry as CurriculumKsbEntry & { children?: CurriculumKsbEntry[] }, 'framework', sourceId)));
    set.ksbs.forEach(entry => visitEntry(entry as CurriculumKsbEntry & { children?: CurriculumKsbEntry[] }, '', ''));
  });
  standards.forEach(standard => {
    const sourceIds = uniqueCleanValues([standard.id, standard.code, standard.standardRef, standard.name]);
    (standard.ksbs || standard.sampleKsbs || []).forEach(entry => {
      sourceIds.forEach(sourceId => addKsbDescription(lookup, entry.code, entry.description, 'standard', sourceId));
      addKsbDescription(lookup, entry.code, entry.description);
    });
  });
  return lookup;
}

function lookupKsbDescription(lookup: Map<string, string>, code: string, sourceType?: string, sourceId?: string) {
  for (const key of ksbDescriptionKeys(code, sourceType, sourceId)) {
    const found = lookup.get(key);
    if (found) return found;
  }
  return '';
}

function clampCoverageWeight(value: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(100, Math.round(parsed * 100) / 100));
}

function addKsbRollupMapping(rollup: Map<string, KsbRollupItem>, mapping: Pick<KsbMapping, 'code' | 'description' | 'weight' | 'sourceType' | 'sourceId'>, evidence: KsbEvidenceItem) {
  const code = ksbKey(mapping.code);
  const key = ksbRollupIdentity(mapping);
  if (!key) return;
  const current = rollup.get(key) || {
    ksb: code,
    title: clean(mapping.description, code),
    weight: 0,
    count: 0,
    evidence: [],
    source: 'authoring' as const,
    sourceType: mapping.sourceType,
    sourceId: mapping.sourceId,
  };
  rollup.set(key, {
    ...current,
    title: current.title === code ? clean(mapping.description, code) : current.title,
    weight: current.weight + Number(mapping.weight || 0),
    count: current.count + 1,
    evidence: [...current.evidence, evidence],
  });
}

function collectComponentKsbRollup(components: CurriculumComponent[], moduleName: string): KsbRollupItem[] {
  const rollup = new Map<string, KsbRollupItem>();
  components.forEach(component => {
    const componentGroups = displayGroupValues([
      (component as CurriculumComponent & { group?: string; groupName?: string }).group,
      (component as CurriculumComponent & { group?: string; groupName?: string }).groupName,
    ]);
    (component.ksbMappings || []).forEach(mapping => addKsbRollupMapping(rollup, mapping, {
      module: moduleName,
      scope: 'component',
      week: component.week,
      component: component.title,
      componentType: component.type,
      classification: mapping.classification || mapping.type,
      groups: componentGroups,
      weight: clampCoverageWeight(mapping.weight),
    }));
  });
  return [...rollup.values()]
    .map(item => ({ ...item, weight: clampCoverageWeight(item.weight) }))
    .sort((left, right) => sortKsbCodes(left.ksb, right.ksb));
}

function fallbackKsbRollup(codes: string[], moduleName: string, weight?: number): KsbRollupItem[] {
  const unique = [...new Set(codes.map(ksbKey).filter(Boolean))].sort(sortKsbCodes);
  const fallbackWeight = clampCoverageWeight(weight || 0);
  return unique.map(code => ({
    ksb: code,
    title: code,
    weight: fallbackWeight,
    count: 1,
    source: 'fallback' as const,
    evidence: [{
      module: moduleName,
      scope: 'live',
      weight: fallbackWeight,
    }],
  }));
}

function cohortStatus(status: string): Cohort['status'] {
  if (status === 'planned' || status === 'completed') return status;
  return 'active';
}

function groupStatus(status: string): Group['status'] {
  if (status === 'completed') return 'completed';
  if (status === 'planned' || status === 'pending') return 'planned';
  return 'active';
}

/**
 * An archived module, by any of the signals the payload carries.
 *
 * Archiving a module soft-deletes it (`isProgrammeDeleted`) and leaves `status`
 * alone, so the delivery status is where it usually shows. This page fetches
 * `visibility: 'all'` so the cohort status filter can reach archived cohorts,
 * which means archived modules arrive here too and have to be dropped: archive
 * takes a module off this list and keeps its content, and the programme card
 * counts only the live ones — so counting them here made the workspace disagree
 * with the card it was opened from.
 */
function isArchivedCurriculumModule(module: Pick<CurriculumModule, 'status' | 'authoringStatus' | 'deliveryStatus' | 'isProgrammeDeleted'>): boolean {
  if (module.isProgrammeDeleted) return true;
  return [module.status, module.authoringStatus, module.deliveryStatus]
    .some(value => normalise(value) === 'archived');
}

function moduleStatus(status: string): Module['status'] {
  if (status === 'published' || status === 'approved' || status === 'in-review' || status === 'draft') return status;
  return status === 'review' ? 'in-review' : 'published';
}

function sessionStatus(status: string): Session['status'] {
  if (status === 'completed' || status === 'cancelled' || status === 'pending') return status;
  return 'scheduled';
}

// Some programme rows were saved with UTF-8 text that had been decoded as
// cp1252 ("1 Sept 2026 \u00e2\u20ac\u201c 11 Nov 2027"), so the stored description
// carries mojibake. Repair the known sequences at display time rather than
// rewriting historic rows, which keeps the fix reversible and avoids a bulk
// UPDATE over live data.
const MOJIBAKE_REPAIRS: Array<[RegExp, string]> = [
  [/\u00e2\u20ac\u201c/g, '\u2013'],
  [/\u00e2\u20ac\u201d/g, '\u2014'],
  [/\u00e2\u20ac\u2122/g, '\u2019'],
  [/\u00e2\u20ac\u0153/g, '\u201c'],
  [/\u00e2\u20ac\u009d/g, '\u201d'],
  [/\u00e2\u20ac\u00a6/g, '\u2026'],
  [/\u00c2\u00b7/g, '\u00b7'],
  [/\u00c2\u00a0/g, ' '],
];

function repairMojibake(value: string) {
  if (!value) return value;
  return MOJIBAKE_REPAIRS.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value);
}

// An unset date returns an empty string, not a placeholder. "TBD" told a
// reader neither what is missing nor who would fill it in, and it is truthy, so
// it also defeated the `|| 'Not scheduled'` fallbacks the call sites already
// carry and leaked into the module drawer's date inputs. Each caller below says
// what its own blank means.
function formatDateLabel(value: string) {
  if (!value) return '';
  // A date-only string ("2026-08-29") parses as UTC midnight; rendering it in the
  // browser's local zone then rolls it back a day for anyone west of UTC. Anchor
  // those to UTC noon and format in UTC so the calendar day is preserved. Full
  // ISO instants carry a real moment and keep their local rendering.
  const trimmed = value.trim();
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(trimmed);
  const date = new Date(dateOnly ? `${trimmed}T12:00:00Z` : trimmed);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', ...(dateOnly ? { timeZone: 'UTC' } : {}),
  });
}

function durationMinutes(startTime: string, endTime: string) {
  const toMinutes = (value: string) => {
    const [hours = '0', minutes = '0'] = clean(value).split(':');
    return Number(hours) * 60 + Number(minutes);
  };
  const start = toMinutes(startTime);
  const end = toMinutes(endTime);
  return end > start ? end - start : 0;
}

function isProgrammeMatch(programme: CurriculumProgramme, value: string) {
  const programmeNames = [programme.id, programme.sourceId, programme.name, programme.standard].map(normalise);
  return programmeNames.includes(normalise(value));
}

function programmeReferenceMatches(programme: CurriculumProgramme, value: unknown) {
  const key = normalise(value);
  if (!key) return false;
  return [
    programme.id,
    programme.sourceId,
    programme.sourceId ? `program-${slugify(programme.sourceId)}` : '',
    programme.name,
    programme.standard,
  ].some(candidate => normalise(candidate) === key);
}

function belongsToProgramme(programme: CurriculumProgramme, item: { programmeId?: string; programme?: string; programmeName?: string }) {
  return (
    (clean(item.programmeId) ? programmeReferenceMatches(programme, item.programmeId) : false) ||
    isProgrammeMatch(programme, item.programme || item.programmeName || '')
  );
}

function findProgramme(data: CurriculumOverview | null, routeId: string) {
  if (!data) return null;
  const routeKey = normalise(routeId);
  return data.programmes.find(programme => (
    normalise(programme.id) === routeKey ||
    normalise(programme.sourceId) === routeKey ||
    normalise(programme.name) === routeKey
  )) ?? null;
}

/** Staff roster plus anyone already named on a record, de-duplicated and sorted. */
function staffNameOptions(profiles: CurriculumStaffProfile[] | undefined, assigned: Array<string | undefined>) {
  const names = new Set<string>();
  (profiles || []).forEach(profile => {
    const name = clean(profile.name) || clean(profile.email);
    if (name) names.add(name);
  });
  assigned.forEach(value => {
    const name = clean(value);
    if (name && normalise(name) !== 'unassigned') names.add(name);
  });
  return Array.from(names).sort((a, b) => a.localeCompare(b));
}

function programmeDetailToOverview(
  detail: CurriculumProgrammeDetail,
  staff: { coaches?: CurriculumStaffProfile[]; tutors?: CurriculumStaffProfile[] } = {},
  supplemental: { programmes?: CurriculumProgramme[]; ksbSets?: CurriculumKsbSet[]; ksbFrameworks?: CurriculumOverview['ksbFrameworks']; holidays?: CurriculumHoliday[] } = {},
): CurriculumOverview {
  const modules = detail.flat.modules ?? [];
  const cohorts = detail.flat.cohorts ?? [];
  const groups = detail.flat.groups ?? [];
  const sessions = detail.flat.sessions ?? [];
  const components = detail.flat.components ?? [];
  const programmeCandidates = [detail.programme, ...(supplemental.programmes || [])];
  const programme = programmeCandidates.find(item => clean(item.ksbProfileSourceId) && programmeReferenceMatches(item, detail.programme.sourceId || detail.programme.id || detail.programme.name))
    || detail.programme;

  return {
    schema: detail.schema,
    stats: {
      programmes: 1,
      activeProgrammes: 1,
      cohorts: cohorts.length,
      groups: groups.length,
      modules: modules.length,
      ksbFrameworks: 0,
      sessions: sessions.length,
    },
    programmes: [programme],
    modules,
    ksbFrameworks: supplemental.ksbFrameworks || [],
    ksbSets: supplemental.ksbSets || [],
    cohorts,
    groups,
    sessions,
    components,
    holidays: supplemental.holidays || [],
    cohortAuthoringDetails: [],
    tutors: staff.tutors ?? [],
    coaches: staff.coaches ?? [],
  };
}

function useProgrammeDetailData(programmeId: string) {
  const [data, setData] = useState<CurriculumOverview | null>(null);
  const [loading, setLoading] = useState(true);
  // A silent reload is in flight behind a page that is still showing real data.
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // `silent` keeps what is on screen instead of dropping the whole page back to
  // a skeleton. Every save used to take the loud path, so finishing a save blanked
  // the programme for the length of the detail round trip -- seconds -- which read
  // as the page throwing the edit away. `skipCache` goes with a post-write reload
  // for the usual reason: the caller is asking for the state it just wrote.
  const load = useCallback(async (
    signal?: AbortSignal,
    options: { silent?: boolean; skipCache?: boolean } = {},
  ) => {
    if (!programmeId) {
      setData(null);
      setLoading(false);
      setRefreshing(false);
      return null;
    }
    if (options.silent) setRefreshing(true);
    else setLoading(true);
    try {
      // Archived cohorts/groups are fetched so the status filter can reach them.
      // The default view still hides them (see filteredCohorts), but "All statuses"
      // would otherwise silently omit rows that exist in the database.
      const detail = await fetchCurriculumProgrammeDetail(programmeId, signal, {
        visibility: 'all',
        skipCache: options.skipCache,
      });
      if (signal?.aborted) return null;
      const overview = programmeDetailToOverview(detail);
      setData(overview);
      setError(null);
      setLoading(false);
      // The programme itself has landed; the supplemental collections below are
      // additive and must not keep the refresh indicator running.
      setRefreshing(false);

      void Promise.all([
        fetchCurriculumCoaches(signal).catch(() => []),
        fetchCurriculumTutors(signal).catch(() => []),
        fetchCurriculumProgrammes(signal).catch(() => []),
        fetchCurriculumKsbFrameworks(signal).catch(() => []),
        fetchCurriculumHolidays(signal).catch(() => []),
      ]).then(([coaches, tutors, programmes, ksbFrameworks, holidays]) => {
        if (signal?.aborted) return;
        setData(programmeDetailToOverview(detail, { coaches, tutors }, { programmes, ksbFrameworks, holidays }));
      });
      return overview;
    } catch (err) {
      if (signal?.aborted) return null;
      setError(err instanceof Error ? err.message : 'Unable to load programme detail');
      // A failed background refresh leaves the good data on screen; only a
      // failed first load has nothing to show.
      if (!options.silent) setData(null);
      return null;
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [programmeId]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  return {
    data,
    loading,
    refreshing,
    error,
    reload: (options?: { silent?: boolean }) => load(undefined, { skipCache: true, ...options }),
  };
}

function rawSkillsStandardIdentifier(programme: Programme) {
  const value = clean(programme.standard);
  if (!value || /^standard not set$/i.test(value)) return '';
  if (/^standard:/i.test(value)) return value.replace(/^standard:/i, '').trim();
  if (/^ST\d+/i.test(value)) return value;
  return '';
}

function moduleDeliverySignature(module: Pick<CurriculumModule, 'programme' | 'name' | 'cohort' | 'group' | 'cohortId' | 'groupId'>) {
  return [
    module.programme,
    module.name,
    module.cohortId || module.cohort,
    module.groupId || module.group,
  ].map(normalise).join('|');
}

function removeAuthoringDuplicates(modules: CurriculumModule[]) {
  const deliverySignatures = new Set(
    modules
      .filter(module => normalise(module.sourceType) !== 'authoring')
      .map(moduleDeliverySignature)
      .filter(Boolean),
  );

  return modules.filter(module => (
    normalise(module.sourceType) !== 'authoring' ||
    !deliverySignatures.has(moduleDeliverySignature(module))
  ));
}

function componentWeekNumber(component: CurriculumComponent) {
  const label = clean(component.week);
  const match = label.match(/\d+/);
  return match ? Number(match[0]) : 1;
}

function isComponentForModule(component: CurriculumComponent, liveModule: { id: string; sourceId: number | string; catalogueId?: string; moduleId?: string; moduleCatalogueId?: string; structureId?: string; name: string }) {
  const componentIdentifierKeys = [component.moduleCatalogueId, component.moduleId].map(normalise).filter(Boolean);
  const moduleIdentifierKeys = [liveModule.moduleCatalogueId, liveModule.catalogueId, liveModule.moduleId, liveModule.structureId, liveModule.id, liveModule.sourceId].map(normalise).filter(Boolean);
  if (componentIdentifierKeys.length) {
    return moduleIdentifierKeys.some(key => componentIdentifierKeys.includes(key));
  }
  const componentModuleKeys = [component.module].map(normalise);
  const moduleKeys = [liveModule.name].map(normalise);
  return moduleKeys.some(key => key && componentModuleKeys.includes(key));
}

function buildModuleWeeks(
  moduleId: string,
  moduleName: string,
  sessions: CurriculumSession[],
  components: CurriculumComponent[] = [],
  authoredWeeks: Array<{ id?: string; weekNumber?: number; number?: number; title?: string; displayOrder?: number }> = [],
): Week[] {
  const byWeek = new Map<number, CurriculumSession[]>();
  sessions.forEach(session => {
    const weekNumber = Number(session.week || 1);
    byWeek.set(weekNumber, [...(byWeek.get(weekNumber) ?? []), session]);
  });

  const authoredWeekByNumber = new Map<number, { id?: string; weekNumber?: number; number?: number; title?: string; displayOrder?: number }>();
  authoredWeeks.forEach((week, index) => {
    const weekNumber = Number(week.weekNumber || week.number || index + 1);
    if (weekNumber > 0) authoredWeekByNumber.set(weekNumber, week);
  });

  const componentsByWeek = new Map<number, CurriculumComponent[]>();
  components.forEach(component => {
    const authoredWeek = authoredWeeks.find(week => clean(week.id) && clean(week.id) === clean(component.weekId));
    const weekNumber = Number(authoredWeek?.weekNumber || authoredWeek?.number || componentWeekNumber(component));
    componentsByWeek.set(weekNumber, [...(componentsByWeek.get(weekNumber) ?? []), component]);
  });

  const weekNumbers = [...new Set([...authoredWeekByNumber.keys(), ...byWeek.keys(), ...componentsByWeek.keys()])].sort((a, b) => a - b);

  return weekNumbers.map((weekNumber) => {
    const authoredWeek = authoredWeekByNumber.get(weekNumber);
    const weekSessions = byWeek.get(weekNumber) ?? [];
    const weekComponents = [...(componentsByWeek.get(weekNumber) ?? [])].sort((a, b) => {
      const orderDelta = Number(a.displayOrder ?? 9999) - Number(b.displayOrder ?? 9999);
      if (orderDelta !== 0) return orderDelta;
      return clean(a.title).localeCompare(clean(b.title));
    });
    const sorted = [...weekSessions].sort((a, b) => clean(a.date).localeCompare(clean(b.date)));
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    // Programme OTJH is authored curriculum: only a component's explicit
    // expected OTJH contributes. Generated timetable sessions (and a generic
    // component duration) must not invent planned OTJH before content exists.
    const componentOtjh = weekComponents.reduce(
      (sum, component) => sum + (Number(component.expectedOtjh) || 0),
      0,
    );
    const weekTitle = clean(weekComponents.find(component => clean(component.weekTitle))?.weekTitle);

    return {
      id: clean(authoredWeek?.id) || `${moduleId}-week-${weekNumber}`,
      number: weekNumber,
      // Deliberately no `first?.title` fallback: naming an untitled week after
      // its first live session made a week wear a session's name.
      title: clean(authoredWeek?.title) || weekTitle || `Week ${weekNumber}`,
      startDate: formatDateLabel(first?.date || ''),
      endDate: formatDateLabel(last?.date || first?.date || ''),
      otjh: Math.round(componentOtjh * 10) / 10,
      components: weekComponents,
      sessions: sorted.map(session => ({
        id: session.id,
        title: session.title || moduleName,
        type: 'Live Session',
        day: session.day || '',
        date: formatDateLabel(session.date),
        startTime: session.startTime || '',
        endTime: session.endTime || '',
        duration: durationMinutes(session.startTime, session.endTime),
        tutor: session.tutor || 'Unassigned',
        venue: session.venue || 'LMS',
        deliveryMode: session.venue || 'LMS',
        ksbRefs: session.ksbCodes || [],
        skippedHolidays: session.skippedHolidays || [],
        scheduleWarnings: session.scheduleWarnings || [],
        status: sessionStatus(session.status),
      })),
    };
  });
}

function buildLiveProgramme(data: CurriculumOverview | null, routeId: string): { programme: Programme; found: boolean } {
  const source = findProgramme(data, routeId);
  if (!data || !source) return { programme: EMPTY_PROGRAMME, found: false };

  const programmeSessions = data.sessions.filter(session => belongsToProgramme(source, session));
  const programmeGroups = data.groups.filter(group => belongsToProgramme(source, group));
  const programmeCohorts = data.cohorts.filter(cohort => belongsToProgramme(source, cohort));
  const moduleNamesFromStructure = new Set([
    ...programmeSessions.map(session => session.module),
    ...programmeGroups.flatMap(group => group.modules),
    ...programmeCohorts.flatMap(cohort => cohort.modules),
  ].filter(Boolean).map(name => clean(name)));
  // An archived programme keeps its modules on show: everything beneath it was
  // archived with it, so a page (and a card) reading "no modules" would say that
  // deleting it removes nothing. A live programme drops the ones archived on
  // their own — this is the same rule the programme card counts by, in
  // enrich_programmes_with_module_counts.
  const programmeIsArchived = normalise(source.status) === 'archived' || Boolean(source.isArchived);
  const programmeModules = data.modules.filter(module => (
    belongsToProgramme(source, module) && (programmeIsArchived || !isArchivedCurriculumModule(module))
  ));
  const relatedAuthoringModulesBySignature = new Map<string, CurriculumModule[]>();
  programmeModules.forEach(module => {
    if (normalise(module.sourceType) !== 'authoring') return;
    const signature = moduleDeliverySignature(module);
    relatedAuthoringModulesBySignature.set(signature, [...(relatedAuthoringModulesBySignature.get(signature) ?? []), module]);
  });
  const liveModules = removeAuthoringDuplicates(programmeModules);
  const moduleSource: Array<{
    id: string;
    sourceId: number | string;
    sourceType?: string;
    catalogueId?: string;
    moduleId?: string;
    moduleCatalogueId?: string;
    structureId?: string;
    name: string;
    programmeId?: string;
    programme: string;
    cohortId?: string;
    cohort?: string;
    groupId?: string;
    group?: string;
    coach?: string;
    tutor?: string;
    weeks: number;
    ksbCount: number;
    lessons: number;
    quizzes: number;
    assignments: number;
    status: string;
    author: string;
    lastUpdated: string;
    color: string;
    notes: string;
    sessionNames: string[];
    ksbCodes: string[];
    weekStructure?: Array<{ id?: string; weekNumber?: number; number?: number; title?: string; displayOrder?: number }>;
    startDate?: string;
    endDate?: string;
  }> = liveModules.length > 0
    ? liveModules
    : [...moduleNamesFromStructure].map((name, index) => ({
        id: `module-${normalise(name) || index}`,
        sourceId: index,
        name,
        programme: source.name,
        cohort: '',
        group: '',
        weeks: 0,
        ksbCount: 0,
        lessons: 0,
        quizzes: 0,
        assignments: 0,
        status: 'published',
        author: '',
        lastUpdated: '',
        color: source.color,
        notes: '',
        sessionNames: [],
        ksbCodes: [],
      }));

  const modules = moduleSource.map((liveModule) => {
    const relatedAuthoringModules = relatedAuthoringModulesBySignature.get(moduleDeliverySignature(liveModule as CurriculumModule)) ?? [];
    const moduleIdentityKeys = uniqueCleanValues([
      liveModule.sourceId,
      liveModule.id,
      liveModule.catalogueId,
      liveModule.moduleId,
      liveModule.moduleCatalogueId,
      liveModule.structureId,
    ]).map(normalise).filter(Boolean);
    const moduleSessions = programmeSessions.filter(session => {
      const sessionIdentityKeys = uniqueCleanValues([
        session.trainingPlanId,
        session.deliveryRowId,
        session.moduleId,
        session.moduleCatalogueId,
        session.deliveryModuleId,
      ]).map(normalise).filter(Boolean);
      const identifierMatch = sessionIdentityKeys.some(key => moduleIdentityKeys.includes(key));
      const contextualNameMatch = normalise(session.module) === normalise(liveModule.name)
        && (!liveModule.cohortId || normalise(session.cohortId || session.cohort) === normalise(liveModule.cohortId || liveModule.cohort))
        && (!liveModule.groupId || normalise(session.groupId || session.group) === normalise(liveModule.groupId || liveModule.group));
      return identifierMatch || contextualNameMatch;
    });
    const moduleComponents = (data.components ?? []).filter(component => (
      (isComponentForModule(component, liveModule) || relatedAuthoringModules.some(relatedModule => isComponentForModule(component, relatedModule))) &&
      (!component.programme || isProgrammeMatch(source, component.programme))
    ));
    const weeksData = buildModuleWeeks(liveModule.id, liveModule.name, moduleSessions, moduleComponents, liveModule.weekStructure || []);
    const fallbackKsbCodes = liveModule.ksbCodes?.length ? liveModule.ksbCodes : [...new Set([
      ...moduleSessions.flatMap(session => session.ksbCodes || []),
      ...moduleComponents.flatMap(component => [
        ...(component.ksbRefs || []),
        ...(component.ksbMappings || []).map(mapping => mapping.code),
      ]),
    ])];
    const componentRollup = collectComponentKsbRollup(moduleComponents, liveModule.name);
    const ksbRollup = componentRollup.length ? componentRollup : fallbackKsbRollup(fallbackKsbCodes, liveModule.name);
    const ksbTags = ksbRollup.map(item => item.ksb);
    const moduleOtjh = Math.round(weeksData.reduce((sum, week) => sum + Number(week.otjh || 0), 0) * 10) / 10;

    return {
      id: liveModule.id,
      sourceId: liveModule.sourceId,
      moduleId: liveModule.moduleId,
      moduleCatalogueId: liveModule.moduleCatalogueId,
      catalogueId: liveModule.catalogueId,
      structureId: liveModule.structureId,
      name: liveModule.name,
      description: [liveModule.cohort, liveModule.group].filter(Boolean).join(' - ') || visibleNotes(liveModule.notes) || `${liveModule.name} linked to ${source.name}.`,
      cohortId: liveModule.cohortId || '',
      cohort: liveModule.cohort || '',
      groupId: liveModule.groupId || '',
      group: liveModule.group || '',
      coach: liveModule.coach || '',
      tutor: liveModule.tutor || '',
      weeks: weeksData.length || liveModule.weeks || 0,
      startDate: clean(liveModule.startDate),
      endDate: clean(liveModule.endDate),
      otjh: moduleOtjh,
      status: moduleStatus(liveModule.status),
      ksbTags,
      ksbMapping: ksbRollup.map(item => ({
        ksb: item.ksb,
        weight: item.weight,
        count: item.count,
        evidence: item.evidence,
        source: item.source,
        sourceType: item.sourceType,
        sourceId: item.sourceId,
      })),
      weeksData,
    };
  });

  const groupsByCohort = new Map<string, CurriculumGroup[]>();
  programmeGroups.forEach(group => {
    groupsByCohort.set(group.cohortId, [...(groupsByCohort.get(group.cohortId) ?? []), group]);
  });
  const holidayById = new Map((data.holidays || []).map(holiday => [String(holiday.id), holiday]));

  const moduleMatchesGroup = (module: Module, cohortName: string, group: CurriculumGroup | { id: string; name: string; moduleIds?: string[]; modules?: string[] }) => {
    const moduleGroupId = normalise(module.groupId);
    if (moduleGroupId) return moduleGroupId === normalise(group.id);

    const moduleGroupName = normalise(module.group);
    if (moduleGroupName) {
      const sameCohort = !module.cohort || normalise(module.cohort) === normalise(cohortName);
      return moduleGroupName === normalise(group.name) && sameCohort;
    }

    const moduleIdentityKeys = uniqueCleanValues([
      module.moduleCatalogueId,
      module.catalogueId,
      module.structureId,
      module.moduleId,
      module.id,
      module.sourceId,
    ]).map(normalise);
    const groupModuleIds = (group.moduleIds ?? []).map(normalise);
    if (groupModuleIds.length && moduleIdentityKeys.some(key => groupModuleIds.includes(key))) return true;

    // Name-only membership is retained for legacy rows with no group context.
    // It must never override an explicit group id/name from another group.
    return (group.modules ?? []).some(name => normalise(name) === normalise(module.name));
  };

  const cohorts = programmeCohorts.map(cohort => ({
    id: cohort.id,
    name: cohort.name,
    startDate: formatDateLabel(cohort.startDate),
    endDate: formatDateLabel(cohort.endDate),
    apprenticeshipEndDate: formatDateLabel(cohort.apprenticeshipEndDate || ''),
    apprenticeshipEndIsManual: Boolean(cohort.apprenticeshipEndOverride),
    epaMonths: cohort.epaMonths ?? null,
    status: cohortStatus(cohort.status),
    learners: cohort.learners || 0,
    holidayIds: (cohort.holidayIds || []).map(String),
    holidays: (cohort.holidayIds || []).map(id => holidayById.get(String(id))).filter((holiday): holiday is CurriculumHoliday => Boolean(holiday)),
    groups: (groupsByCohort.get(cohort.id) ?? []).map(group => ({
      id: group.id,
      name: group.name,
      learners: group.learners || 0,
      coach: group.coach || 'Unassigned',
      tutor: group.tutor || 'Unassigned',
      startDate: formatDateLabel(group.startDate),
      endDate: formatDateLabel(group.endDate),
      status: groupStatus(group.status),
      schedule: group.schedule || '',
      mode: group.mode || 'Live',
      modules: modules.filter(module => moduleMatchesGroup(module, cohort.name, group)),
    })),
  }));

  // Cohorts are only the programme's cohort records. A module whose stored
  // cohort is not one of them used to have a cohort synthesized for it here,
  // which is why this page's cohort count could disagree with the Cohorts
  // page's for the same programme. Such a module is now reported as the data
  // problem it is, on the Overview tab, and the count stays honest.
  const deliveryStart = programmeCohorts.map(cohort => clean(cohort.startDate)).filter(Boolean).sort()[0] || '';
  const deliveryEnd = programmeCohorts.map(cohort => clean(cohort.endDate)).filter(Boolean).sort().at(-1) || '';
  // A cohort's endDate is its practical end; apprenticeshipEndDate carries the
  // same date plus the EPA window. Falling back to the practical end keeps the
  // apprenticeship window readable for cohorts with no EPA months recorded.
  const apprenticeshipEnd = programmeCohorts
    .map(cohort => clean(cohort.apprenticeshipEndDate) || clean(cohort.endDate))
    .filter(Boolean).sort().at(-1) || '';
  const dateWindow = (start: string, end: string) => [
    start ? formatDateLabel(start) : '',
    end ? formatDateLabel(end) : '',
  ].filter(Boolean).join(' – ');
  const practicalWindow = dateWindow(deliveryStart, deliveryEnd);
  const apprenticeshipWindow = dateWindow(deliveryStart, apprenticeshipEnd);
  const deliveryWindow = practicalWindow;

  const programmeSourceIds = [source.id, source.sourceId, source.name].map(normalise).filter(Boolean);
  const ksbSet = data.ksbSets.find(set => {
    const linkedProgrammeIds = [set.programmeId, ...(set.programmeIds || [])].map(normalise).filter(Boolean);
    return programmeSourceIds.some(id => linkedProgrammeIds.includes(id));
  }) || data.ksbSets.find(set => isProgrammeMatch(source, set.standard));
  const ksbEntries: CurriculumKsbEntry[] = ksbSet?.ksbs ?? [];
  const moduleNames = modules.map((module, index) => `M${index + 1}`);
  const moduleLabelByName = new Map(modules.map((module, index) => [normalise(module.name), moduleNames[index]]));
  const emptyCoverage = moduleNames.reduce<Record<string, number | null>>((coverage, label) => ({ ...coverage, [label]: null }), {});
  const emptyCounts = moduleNames.reduce<Record<string, number>>((counts, label) => ({ ...counts, [label]: 0 }), {});
  const emptyEvidence = moduleNames.reduce<Record<string, KsbEvidenceItem[]>>((evidence, label) => ({ ...evidence, [label]: [] }), {});
  const ksbSetSourceId = ksbSetSourceIdForProgrammeDetail(ksbSet);
  const ksbDefinitions = new Map<string, { code: string; title: string; description: string; modules: string[]; sourceType?: string; sourceId?: string }>();
  ksbEntries.forEach(entry => {
    const code = ksbKey(entry.code);
    if (!code) return;
    const sourceType = ksbSetSourceId ? 'framework' : '';
    const sourceId = ksbSetSourceId;
    const key = ksbRollupIdentity({ code, sourceType, sourceId });
    ksbDefinitions.set(key, {
      code,
      title: entry.title || code,
      description: entry.description || entry.title || '',
      modules: entry.modules || [],
      sourceType,
      sourceId,
    });
  });
  modules.forEach(module => {
    module.ksbMapping.forEach(mapping => {
      const code = ksbKey(mapping.ksb);
      const key = ksbRollupIdentity(mapping);
      if (!code || ksbDefinitions.has(key)) return;
      ksbDefinitions.set(key, { code, title: code, description: '', modules: [], sourceType: mapping.sourceType, sourceId: mapping.sourceId });
    });
  });
  const ksbHeatmap = [...ksbDefinitions.values()].sort((left, right) => sortKsbCodes(left.code, right.code)).map(definition => {
    const definitionKey = ksbRollupIdentity({ ksb: definition.code, sourceType: definition.sourceType, sourceId: definition.sourceId });
    const coverage = definition.modules.reduce<Record<string, number | null>>((currentCoverage, moduleName) => {
      const label = moduleLabelByName.get(normalise(moduleName));
      return label ? { ...currentCoverage, [label]: 100 } : currentCoverage;
    }, { ...emptyCoverage });
    const counts = { ...emptyCounts };
    const evidence = { ...emptyEvidence };
    modules.forEach((module, index) => {
      const label = moduleNames[index];
      const mapped = module.ksbMapping.find(item => ksbRollupIdentity(item) === definitionKey);
      if (!mapped) return;
      if (mapped.source !== 'fallback') {
        coverage[label] = Math.max(Number(coverage[label] || 0), clampCoverageWeight(mapped.weight));
      }
      counts[label] = mapped.count || 1;
      evidence[label] = mapped.evidence || [];
    });
    const totalOccurrences = Object.values(counts).reduce((total, count) => total + count, 0);
    const totalWeight = Object.values(coverage).reduce((total, value) => total + Number(value || 0), 0);
    return {
      id: definition.code,
      ksb: definition.code,
      title: definition.title,
      description: definition.description,
      coverage,
      counts,
      evidence,
      totalOccurrences,
      totalWeight,
      sourceType: definition.sourceType,
      sourceId: definition.sourceId,
      missing: totalOccurrences === 0,
    };
  });
  return {
    found: true,
    programme: {
      id: source.id,
      sourceId: String(source.sourceId || ''),
      ksbProfileSourceId: clean(source.ksbProfileSourceId),
      structureType: source.structureType,
      name: source.name,
      standard: source.standard,
      level: source.level || 'Level not set',
      owner: source.owner || '',
      color: source.color || '#6941c6',
      description: repairMojibake(source.description || `${deliveryWindow || source.standard} curriculum plan.`),
      duration: deliveryWindow || 'Live curriculum',
      practicalWindow,
      apprenticeshipWindow,
      cohorts,
      modules,
      ksbHeatmap,
      moduleNames,
      requiredOtjh: Number.isFinite(Number(source.requiredOtjh)) && source.requiredOtjh !== null ? Number(source.requiredOtjh) : null,
      learnerKsbProgressPercentage: Number(source.learnerKsbProgressPercentage || 0),
      learnerKsbCodesStarted: Number(source.learnerKsbCodesStarted || 0),
      learnerKsbCodesComplete: Number(source.learnerKsbCodesComplete || 0),
      learnerKsbCodesTotal: Number(source.learnerKsbCodesTotal || 0),
      learnerKsbLearnerCount: Number(source.learnerKsbLearnerCount || 0),
    },
  };
}

// ============================================================
// Programme-level UI
//
// Only three things live here. Everything else this page draws — filter bars,
// record tables, empty states, panels, the header — comes from
// `shared/entities/ui`, which is what keeps the four Curriculum workspaces
// looking like one product.
// ============================================================

// Curriculum treats 'Unassigned' as a sentinel rather than a real staff name, so
// every staffing read goes through here instead of comparing strings ad hoc.
const UNASSIGNED_STAFF = 'Unassigned';

function isStaffAssigned(value?: string) {
  const name = clean(value);
  return Boolean(name) && normalise(name) !== normalise(UNASSIGNED_STAFF);
}

// A staffing slot that shows the assigned person, or an explicit "needs a coach"
// affordance that assigns one in place. Reading 'Unassigned' as plain body text
// was the main complaint: it looked like data rather than a gap to fix.
//
// Only ever used for a group's coach. A group has no tutor — that is assigned per
// module, in the module form — so there is no tutor slot on a group anywhere.
function StaffSlot({
  role,
  icon,
  name,
  options,
  onAssign,
  saving,
}: {
  role: string;
  icon: string;
  name: string;
  options: CurriculumStaffProfile[];
  onAssign?: (value: string) => void | Promise<void>;
  saving?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const assigned = isStaffAssigned(name);
  const canEdit = Boolean(onAssign);

  if (editing && canEdit) {
    return (
      <div className="flex min-w-0 items-center gap-1.5 self-center" onClick={event => event.stopPropagation()}>
        <select
          autoFocus
          defaultValue=""
          disabled={saving}
          aria-label={`Assign ${role}`}
          onChange={async event => {
            const value = event.target.value;
            if (!value) return;
            await onAssign?.(value);
            setEditing(false);
          }}
          className="h-8 min-w-0 flex-1 rounded-lg border border-primary-300 bg-background-50 px-2 text-[11px] font-semibold text-foreground-900 outline-none focus:ring-2 focus:ring-primary-100"
        >
          <option value="">{saving ? 'Saving...' : `Select ${role.toLowerCase()}...`}</option>
          {options.map(option => {
            const label = clean(option.name) || clean(option.email) || String(option.id);
            return <option key={String(option.id)} value={label}>{label}</option>;
          })}
        </select>
        <button
          onClick={() => setEditing(false)}
          disabled={saving}
          aria-label="Cancel"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-background-200 text-foreground-500 transition-smooth hover:bg-background-100 disabled:opacity-40"
        >
          <AppIcon className="ri-close-line text-[13px]"></AppIcon>
        </button>
      </div>
    );
  }

  return (
    <span className="group/staff flex min-w-0 items-center gap-2 self-center" onClick={event => event.stopPropagation()}>
      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ${assigned ? 'bg-primary-50 text-primary-600' : 'bg-amber-50 text-amber-600'}`}>
        <AppIcon className={`${icon} text-[11px]`}></AppIcon>
      </span>
      {assigned ? (
        <span className="min-w-0 truncate text-[12px] font-semibold text-foreground-800">{clean(name)}</span>
      ) : canEdit ? (
        <button
          onClick={() => setEditing(true)}
          className="inline-flex items-center gap-1 text-[12px] font-bold text-amber-700 transition-smooth hover:text-amber-800 hover:underline"
        >
          <AppIcon className="ri-add-circle-line text-[11px]"></AppIcon> Assign {role.toLowerCase()}
        </button>
      ) : (
        <span className="text-[12px] font-semibold text-amber-700">Not assigned</span>
      )}
      {assigned && canEdit && (
        <button
          onClick={() => setEditing(true)}
          aria-label={`Change ${role}`}
          title={`Change ${role.toLowerCase()}`}
          className="ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-foreground-400 opacity-0 transition-smooth hover:bg-background-100 hover:text-foreground-700 focus:opacity-100 group-hover/staff:opacity-100"
        >
          <AppIcon className="ri-pencil-line text-[11px]"></AppIcon>
        </button>
      )}
    </span>
  );
}

/**
 * One readiness measure on the Overview tab. Deliberately a proportion of
 * something countable — mapped KSBs, published components — rather than a score,
 * so the number always has a definition the reader can check.
 */
function ReadinessBar({ label, value, detail, color }: { label: string; value: number; detail: string; color: string }) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-[12px] font-semibold text-foreground-700">{label}</span>
        <span className="text-[13px] font-heading font-bold text-foreground-950">{value}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-background-200">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
      </div>
      <p className="mt-1 text-[11px] text-foreground-400">{detail}</p>
    </div>
  );
}

/**
 * One gap worth acting on, with the action attached. This is what the Overview
 * tab exists for: the programme-level questions ("is anything unstaffed, is
 * anything unmapped") that no single-record page can answer, each pointing at
 * the one place the gap is actually fixed.
 */
function AttentionRow({ icon, tone, title, detail, action }: {
  icon: string;
  tone: 'amber' | 'rose' | 'sky';
  title: string;
  detail: string;
  action: { label: string; onClick: () => void };
}) {
  const tones = {
    amber: 'border-amber-200 bg-amber-50/70 text-amber-700',
    rose: 'border-rose-200 bg-rose-50/70 text-rose-700',
    sky: 'border-sky-200 bg-sky-50/70 text-sky-700',
  } as const;
  return (
    <li className={`flex flex-col gap-2 rounded-xl border px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${tones[tone]}`}>
      <span className="flex min-w-0 items-start gap-2.5">
        <AppIcon className={`${icon} mt-0.5 shrink-0 text-base`}></AppIcon>
        <span className="min-w-0">
          <span className="block text-[13px] font-bold">{title}</span>
          <span className="block text-[11px] font-semibold opacity-80">{detail}</span>
        </span>
      </span>
      <button
        type="button"
        onClick={action.onClick}
        className="inline-flex h-9 shrink-0 items-center gap-1.5 self-start rounded-lg border border-background-200 bg-background-50 px-3 text-[11px] font-bold transition-smooth hover:bg-background-100 sm:self-center"
      >
        {action.label}
        <AppIcon className="ri-arrow-right-line text-xs"></AppIcon>
      </button>
    </li>
  );
}

/**
 * A pointer to the page that owns a record type, carrying this programme's count
 * of it. The Cohorts, Groups and Module Builder pages are where those records are
 * managed across the whole curriculum; this workspace scopes them to one
 * programme, and says so rather than pretending to be a separate catalogue.
 */
function RecordHomeLink({ icon, label, count, hint, to }: {
  icon: string;
  label: string;
  count: number;
  hint: string;
  to: string;
}) {
  return (
    <Link
      to={to}
      className="flex items-center gap-3 rounded-xl border border-background-200 bg-background-100/60 p-3 transition-smooth hover:border-primary-200 hover:bg-primary-50/40"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-background-50 text-primary-600">
        <AppIcon className={`${icon} text-base`}></AppIcon>
      </span>
      <span className="min-w-0 flex-1">
        {/* One text node between the two, so the accessible name reads
            "3 cohorts" rather than "3cohorts". */}
        <span className="flex items-baseline gap-1.5">
          <span className="text-[15px] font-heading font-bold text-foreground-950">{count}</span>
          {' '}
          <span className="text-[12px] font-bold text-foreground-700">{label}</span>
        </span>
        <span className="block truncate text-[11px] text-foreground-400">{hint}</span>
      </span>
      <AppIcon className="ri-arrow-right-line shrink-0 text-sm text-foreground-300"></AppIcon>
    </Link>
  );
}

// Read-only view of the learners the enrolment team placed into a group.
// Curriculum owns the delivery structure, not the placements, so this panel
// deliberately offers no allocation controls.
//
// The roster it is handed is already the group's own — asked for at
// `/curriculum/groups/<id>/learner-roster/` — so it lists what it is given and
// filters nothing. It used to be handed the whole programme's roster and match
// rows on cohort and group *names*, which quietly dropped learners whose stored
// labels had drifted from the records they were placed in.
//
// Each row is a button, because the roster is the way into the one thing a
// designer actually comes here to ask: what has this person achieved in this
// group. The figures themselves belong to the achievement read, not to this
// panel, so the row opens them rather than restating them.
function EnrolledLearnersPanel({
  roster,
  loading,
  error,
  selectedLearnerId,
  onSelectLearner,
  emptyHint,
}: {
  roster: CurriculumProgrammeLearnerRosterResponse | null;
  loading: boolean;
  error: string | null;
  selectedLearnerId: string;
  onSelectLearner: (learner: CurriculumProgrammeAssignedLearner | null) => void;
  emptyHint?: string;
}) {
  const learners = roster?.assignedLearners || [];
  // The Learners column in the table above counts active placements; this list
  // is asked for with learnerStatus=all, because someone paused or withdrawn is
  // still a person this group holds and still keeps whatever they earned here.
  // Where the two disagree, say why rather than leaving the reader to wonder
  // which number is wrong.
  const inactive = learners.filter(learner => normalise(learner.lifecycleStatus) !== 'active').length;

  return (
    <>
      {loading && <p className="text-[12px] text-foreground-500">Loading assigned learners…</p>}

      {!loading && error && (
        <p className="rounded-lg border border-amber-200/60 bg-amber-50 px-3 py-2 text-[12px] text-amber-700">{error}</p>
      )}

      {!loading && !error && learners.length === 0 && (
        <p className="rounded-lg border border-background-200 bg-background-100 px-3 py-2 text-[12px] text-foreground-500">
          {emptyHint || 'No learners have been assigned here by the enrolment team yet.'}
        </p>
      )}

      {!loading && !error && learners.length > 0 && (
        <>
          <p className="mb-2 text-[11px] text-foreground-500">
            {learners.length} learner{learners.length === 1 ? '' : 's'} placed in this group
            {inactive ? `, ${inactive} of them no longer active — the count above is active placements only` : ''}.
            {' '}Open one to see the off-the-job hours and KSBs they have achieved here.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {learners.map(learner => {
              const key = String(learner.id);
              const selected = key === selectedLearnerId;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => onSelectLearner(selected ? null : learner)}
                  aria-pressed={selected}
                  className={`flex w-full flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left transition-smooth ${
                    selected
                      ? 'border-primary-300 bg-primary-50'
                      : 'border-background-200 bg-background-100 hover:border-primary-200 hover:bg-background-50'
                  }`}
                >
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 truncate text-[12px] font-semibold text-foreground-900">
                      <AppIcon className={`${selected ? 'ri-subtract-line' : 'ri-add-line'} text-[12px] text-foreground-400`}></AppIcon>
                      {learner.name || learner.email || `Learner ${learner.id}`}
                    </p>
                    <p className="truncate pl-4 text-[11px] text-foreground-500">
                      {learner.email || 'No email on record'}
                      {learner.group ? ` · ${learner.group}` : ''}
                      {learner.coachName ? ` · Coach: ${learner.coachName}` : ''}
                    </p>
                  </div>
                  {learner.lifecycleStatus && (
                    <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold ${normalise(learner.lifecycleStatus) === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-foreground-100 text-foreground-500'}`}>
                      {learner.lifecycleStatus}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}

// ============================================================
// Component
// ============================================================

/**
 * The Programme workspace.
 *
 * A programme is the top of the curriculum hierarchy — Programme → Cohort →
 * Group → Module → Week → Component — and each level below it already has a page
 * that owns it: the Cohorts and Groups lists, the Module Builder catalogue, and
 * the Cohort / Group / Module workspaces. So this page deliberately answers only
 * the questions that need the *whole* programme in view:
 *
 *   Overview  — is this programme complete and ready to deliver, and what is the
 *               one gap stopping it? Nothing else aggregates across cohorts.
 *   Delivery  — the shape of delivery: which cohorts run, which groups sit under
 *               them, who coaches them. Rows open the real cohort/group workspace.
 *   Modules   — every module on the programme at once, with its delivery context.
 *               A module's own content, Teams series and KSB weights live in the
 *               Module workspace and the Module Builder, and are opened, not
 *               redrawn.
 *   Sessions  — every live session and recording across every module, which is
 *               neither per-module (Module workspace) nor whole-college (Session
 *               Calendar).
 *   KSB       — coverage of the programme's KSB source across its modules. The
 *               only place this roll-up exists.
 *   Achieved  — the other half of KSB: not what the curriculum plans, but what
 *               the learners assigned to it have actually earned. Scoped by a
 *               picker down the hierarchy — programme, one cohort, one group, one
 *               module — because "how are we doing" is asked at every level and
 *               the answer has to be computed the same way each time. It reads;
 *               each child's own workspace still owns its record.
 *
 * Tabs that used to re-render a lower level's own view (a flat Groups list, a
 * module's week timeline, and a "Review" tab that drew cohorts, groups, modules
 * and weeks a third time) are gone: they were the same records with different
 * chrome, and every one of them now has exactly one home.
 */

type Tab = 'overview' | 'cohorts' | 'groups' | 'modules' | 'sessions' | 'coverage' | 'achievement' | 'quality';

// Actions now carries the "Groups" jump plus Edit and Archive, so the fixed
// 120px column that fit "Groups" alone is widened to a minmax that keeps room
// for all three without squeezing them onto a second line.
const COHORT_GRID = 'grid grid-cols-[minmax(170px,1.4fr)_minmax(150px,1.1fr)_minmax(130px,.9fr)_80px_80px_minmax(100px,.8fr)_minmax(200px,auto)]';
/**
 * The date window shown on a module row.
 *
 * The record's own placement dates first: an end that holidays moved, or that a
 * tutor set by hand, lives there and nowhere else. The authored week span is the
 * fallback for a module with no dates stored yet — labelled as the weeks, because
 * the last week's last session is not the module's end date and this row used to
 * print one as the other.
 */
function moduleDatesLabel(mod: Pick<Module, 'startDate' | 'endDate' | 'weeksData'>): string {
  const recorded = [mod.startDate, mod.endDate].map(value => clean(value)).filter(Boolean);
  if (recorded.length) return recorded.map(formatDateLabel).join(' – ');

  const weekSpan = [
    mod.weeksData[0]?.startDate,
    mod.weeksData.at(-1)?.endDate || mod.weeksData.at(-1)?.startDate,
  ].filter(Boolean).join(' – ');
  return weekSpan ? `${weekSpan} (authored weeks)` : 'No dates set';
}

/**
 * The date window shown on a group row.
 *
 * A group has no start/end fields of its own in its drawer — only cohorts and
 * modules do — so a group's row shows the three dates carried on the cohort it
 * runs inside, the same cohort this table is already scoped to, each labelled
 * so "12 Dec 2026" doesn't get read as whichever of the three a reader expects.
 */
function groupDatesLabel(cohort: { startDate: string; endDate: string; apprenticeshipEndDate: string }): ReactNode {
  const parts = [
    cohort.startDate && `Cohort start ${cohort.startDate}`,
    cohort.endDate && `Cohort practical end ${cohort.endDate}`,
    cohort.apprenticeshipEndDate && `Cohort apprenticeship end ${cohort.apprenticeshipEndDate}`,
  ].filter(Boolean) as string[];
  if (!parts.length) return 'Not scheduled';
  const text = parts.join(' · ');
  return <span title={text}>{text}</span>;
}

// Actions need room for "Add first module", "Learners", Edit and Archive on one
// line. Below this width EntityTable scrolls horizontally instead of squeezing
// the buttons or turning a single row into an uneven two-line layout.
const GROUP_GRID = 'grid grid-cols-[minmax(200px,1.35fr)_minmax(160px,1fr)_minmax(180px,1fr)_90px_90px_minmax(290px,auto)]';
const MODULE_GRID = 'grid grid-cols-[minmax(190px,1.5fr)_minmax(150px,1.1fr)_minmax(130px,.9fr)_70px_100px_80px_70px_minmax(210px,auto)]';

const TAB_LABELS: Record<Tab, string> = {
  overview: 'Overview',
  cohorts: 'Cohorts',
  groups: 'Groups',
  modules: 'Modules',
  sessions: 'Sessions',
  coverage: 'KSB Coverage',
  achievement: 'Achievement KSBs',
  quality: 'Quality',
};

const LEGACY_TAB_MAP: Record<string, Tab> = {
  design: 'modules',
  delivery: 'cohorts',
  ksb: 'coverage',
};

/**
 * Whether a `?tab=` value names a real tab. An unknown or missing one falls back
 * to Overview rather than rendering nothing, so a stale bookmark or a hand-typed
 * URL still opens the programme.
 */
function isProgrammeDetailTab(value: string | null): value is Tab {
  return Boolean(value) && Object.prototype.hasOwnProperty.call(TAB_LABELS, value as string);
}

export default function ProgrammeDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data, loading, refreshing, error, reload } = useProgrammeDetailData(id || '');
  const [detailComponents, setDetailComponents] = useState<CurriculumComponent[]>([]);
  const hydratedData = useMemo(() => data ? { ...data, components: detailComponents } : data, [data, detailComponents]);
  const { programme: liveProgramme, found } = useMemo(() => buildLiveProgramme(hydratedData, id || ''), [hydratedData, id]);
  const [backendCoverage, setBackendCoverage] = useState<CurriculumKsbCoverageResponse | null>(null);
  const [backendCoverageLoading, setBackendCoverageLoading] = useState(false);
  const [backendCoverageError, setBackendCoverageError] = useState<string | null>(null);
  // Learner placements come from the enrolment team's records. Curriculum
  // displays them read-only and never writes an allocation of its own.
  // Which level of the hierarchy the Achievement tab is reporting on. Defaults
  // to the programme; the picker walks down to a single module.
  const [achievementScope, setAchievementScope] = useState<AchievementScope>(() => ({
    scope: 'programme',
    identifier: '',
    label: 'Programme',
    description: '',
  }));
  const [learnerRoster, setLearnerRoster] = useState<CurriculumProgrammeLearnerRosterResponse | null>(null);
  const [learnerRosterLoading, setLearnerRosterLoading] = useState(false);
  const [learnerRosterError, setLearnerRosterError] = useState<string | null>(null);
  // The learner whose achievement in the selected group is open. Held as the
  // roster row rather than the id alone so the detail can be titled with the
  // name enrolment holds before its own read has landed.
  const [selectedLearner, setSelectedLearner] = useState<CurriculumProgrammeAssignedLearner | null>(null);
  const [programmeKsbSets, setProgrammeKsbSets] = useState<CurriculumKsbSet[]>([]);
  const [skillsStandards, setSkillsStandards] = useState<CurriculumStandard[]>([]);
  // The programme's off-the-job hours as the learner records hold them, which is
  // the only place a *completed* hour exists: authored OTJH is a plan, and
  // `Learner.learners` is where enrolment keeps what each learner has done
  // against what they are targeted to do (completed_hours / target_hours, which
  // is what the learner-roster endpoint reads).
  const [learnerOtjh, setLearnerOtjh] = useState<{ completed: number; target: number; learners: number } | null>(null);
  const [learnerOtjhLoading, setLearnerOtjhLoading] = useState(false);
  const coverageRequestKeyRef = useRef('');
  const rosterRequestKeyRef = useRef('');
  const learnerOtjhRequestKeyRef = useRef('');
  const componentsRequestKeyRef = useRef('');
  const PROGRAMME = useMemo(() => {
    const sourceLabels = buildKsbSourceLabelMap(data);
    const ksbDescriptions = buildKsbDescriptionLookup(programmeKsbSets, skillsStandards);
    const heatmapRows = backendCoverageToProgrammeHeatmap(backendCoverage, sourceLabels, liveProgramme.modules, ksbDescriptions);
    const effectiveSource = inferProgrammeKsbCoverageSource(liveProgramme, programmeKsbSets, skillsStandards);
    const scopedRows = heatmapRows ? filterHeatmapRowsByProgrammeSource(heatmapRows.rows, effectiveSource) : null;
    return {
      ...liveProgramme,
      moduleNames: heatmapRows?.moduleNames || liveProgramme.moduleNames,
      ksbHeatmap: scopedRows || filterHeatmapRowsByProgrammeSource(liveProgramme.ksbHeatmap, effectiveSource),
    };
  }, [backendCoverage, data, liveProgramme, programmeKsbSets, skillsStandards]);

  // The tab lives in the query string, so a link can land on the view it means.
  // The programme cards do exactly that: their Cohorts figure opens Delivery,
  // their Modules figure opens Modules, and so on, instead of dropping the
  // reader on Overview to find the same number a second time. It also makes the
  // browser Back button walk tabs and a pasted URL reopen what the sender saw.
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const requestedView = searchParams.get('view');
  const compatibleTab = requestedTab === 'delivery' && requestedView === 'sessions'
    ? 'sessions'
    : requestedTab === 'coverage' && requestedView === 'achievement'
      ? 'achievement'
      : requestedTab && LEGACY_TAB_MAP[requestedTab];
  const tab: Tab = compatibleTab || (isProgrammeDetailTab(requestedTab) ? requestedTab : 'overview');
  const setTab = useCallback((next: Tab) => {
    // Replace rather than push: switching tabs is not a navigation the reader
    // should have to unwind one step at a time to get back to the card grid.
    setSearchParams(previous => {
      const params = new URLSearchParams(previous);
      if (next === 'overview') params.delete('tab');
      else params.set('tab', next);
      params.delete('view');
      return params;
    }, { replace: true });
  }, [setSearchParams]);
  // Delivery tab: which cohort's groups are shown, and which group's learners.
  const [selectedCohort, setSelectedCohort] = useState('');
  const [selectedGroup, setSelectedGroup] = useState('');
  const [cohortSearch, setCohortSearch] = useState('');
  const [cohortStatusFilter, setCohortStatusFilter] = useState('');
  const [groupSearch, setGroupSearch] = useState('');
  const [groupCoachFilter, setGroupCoachFilter] = useState('');
  const [moduleSearch, setModuleSearch] = useState('');
  const [moduleCohortFilter, setModuleCohortFilter] = useState('');
  const [moduleGroupFilter, setModuleGroupFilter] = useState('');
  const [sessionKind, setSessionKind] = useState<'live' | 'recorded'>('live');
  const [sessionSearch, setSessionSearch] = useState('');
  const [sessionModuleFilter, setSessionModuleFilter] = useState('');
  // Real per-occurrence status/dates from the sync service, keyed for O(1) lookup
  // by occurrence id and by `${liveSessionId}::${sessionNumber}` (a component
  // carries one or both). The Sessions tab reads status from here — it never
  // decides scheduled/completed from a date itself.
  const [liveOccurrences, setLiveOccurrences] = useState<Map<string, CurriculumLiveSessionOccurrence>>(() => new Map());
  const [occurrencesLoading, setOccurrencesLoading] = useState(false);
  const occurrencesRequestKeyRef = useRef('');
  const [ksbSearch, setKsbSearch] = useState('');
  // Which class the KSB coverage tab is reporting on. A module belongs to one
  // group, so the whole-programme matrix answers for a delivery nobody is
  // enrolled on; these two narrow it to a real one.
  const [coverageCohortId, setCoverageCohortId] = useState('');
  const [coverageGroupId, setCoverageGroupId] = useState('');
  const [coverageStanding, setCoverageStanding] = useState<'all' | 'taught' | 'missing'>('all');
  const [coverageExpandedRow, setCoverageExpandedRow] = useState('');
  // The placement whose component is being previewed, and the KSB the reader
  // arrived from — so the preview can mark which of the component's mappings is
  // the one they were reading about.
  const [placementPreview, setPlacementPreview] = useState<{
    placement: KsbPlacement;
    ksb: string;
    /** Known gone rather than merely unmatched: an achievement credit's own
     *  activity record already says so, so the preview can say it plainly
     *  instead of sending the reader to Module Builder to find out the hard
     *  way. Coverage placements carry no such signal and leave this unset. */
    moduleKnownDeleted?: boolean;
  } | null>(null);
  /**
   * Which reading of the same scoped rows the coverage tab is showing.
   *
   *  - `list`       — KSB first: every KSB, and where it is placed.
   *  - `components` — the inverse: every component, and which KSBs sit inside
   *                   it. The list above cannot answer "what does this
   *                   component carry" without opening 71 rows and reading
   *                   every placement for the one name.
   *  - `matrix`     — KSB by module, for a read across the programme at once.
   */
  const [coverageView, setCoverageView] = useState<'list' | 'components' | 'matrix'>('list');
  const [coverageComponentId, setCoverageComponentId] = useState('');
  /** Empty means "every component in view" — picking narrows the By-component
   *  table to just these, for the reader who wants two or three specific
   *  components side by side rather than the whole programme's worth. */
  const [pickedComponentIds, setPickedComponentIds] = useState<string[]>([]);
  const [componentPickerOpen, setComponentPickerOpen] = useState(false);
  const [programmeDrawerOpen, setProgrammeDrawerOpen] = useState(false);
  const [cohortDrawerOpen, setCohortDrawerOpen] = useState(false);
  // Set only when the cohort drawer is editing an existing record rather than
  // creating one; the drawer reads it as its `cohort` prop.
  const [editingCohort, setEditingCohort] = useState<CurriculumCohort | null>(null);
  // The cohort the new group belongs to; '' when the user has not narrowed it.
  const [groupDrawerCohortId, setGroupDrawerCohortId] = useState<string | null>(null);
  // Same idea for the group drawer: set only while editing.
  const [editingGroup, setEditingGroup] = useState<CurriculumGroup | null>(null);
  const [savingAction, setSavingAction] = useState<string | null>(null);
  // Archived from this page's own row action, taken out of the tables straight
  // away rather than waiting on the reload behind it — see `assignGroupCoach`'s
  // sibling comment on why: the refresh takes seconds, and a row still on screen
  // after "Archive" reads as though nothing happened.
  const [archivedCohortIds, setArchivedCohortIds] = useState<Set<string>>(() => new Set());
  const [archivedGroupIds, setArchivedGroupIds] = useState<Set<string>>(() => new Set());
  const [archivedModuleIds, setArchivedModuleIds] = useState<Set<string>>(() => new Set());
  // Set only while editing a module; the drawer is the shared module form.
  const [editingModule, setEditingModule] = useState<ModuleFormTarget | null>(null);

  const coverageProgrammeIds = useMemo(() => {
    const withoutRoutePrefix = clean(id || '').replace(/^program-/i, '');
    const candidates = [
      liveProgramme.sourceId,
      liveProgramme.id,
      withoutRoutePrefix,
      id || '',
      liveProgramme.name,
    ].map(value => clean(value)).filter(Boolean);
    const seen = new Set<string>();
    return candidates.filter(candidate => {
      const key = normalise(candidate);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [id, liveProgramme.id, liveProgramme.name, liveProgramme.sourceId]);
  const coverageKsbSource = useMemo(
    () => inferProgrammeKsbCoverageSource(liveProgramme, programmeKsbSets, skillsStandards),
    [liveProgramme, programmeKsbSets, skillsStandards],
  );
  const coverageKsbSourceLabel = useMemo(
    () => ksbCoverageSourceLabel(coverageKsbSource, data, programmeKsbSets, skillsStandards),
    [coverageKsbSource, data, programmeKsbSets, skillsStandards],
  );
  const coverageKsbSourceDetail = useMemo(
    () => ksbCoverageSourceDetail(coverageKsbSource, data, programmeKsbSets, skillsStandards),
    [coverageKsbSource, data, programmeKsbSets, skillsStandards],
  );
  // An applied source is the one saved on the programme. Anything else on this
  // row was matched from the programme's standard text, and says so rather than
  // reading as a deliberate assignment.
  const coverageKsbSourceApplied = Boolean(splitProgrammeKsbSource(liveProgramme.ksbProfileSourceId).sourceId);

  const loadBackendCoverage = useCallback((signal?: AbortSignal) => {
    if (!coverageProgrammeIds.length) return Promise.resolve();
    setBackendCoverageLoading(true);
    setBackendCoverageError(null);
    return (async () => {
      let lastError: unknown = null;
      for (const programmeId of coverageProgrammeIds) {
        try {
          return await fetchCurriculumProgrammeKsbCoverage(programmeId, coverageKsbSource, signal);
        } catch (error) {
          if (signal?.aborted) throw error;
          lastError = error;
        }
      }
      throw lastError || new Error('Unable to load backend KSB coverage heatmap.');
    })()
      .then(result => {
        setBackendCoverage(result);
        setBackendCoverageError(null);
      })
      .catch(error => {
        if (signal?.aborted) return;
        console.warn('Unable to load backend KSB coverage heatmap.', error);
        setBackendCoverage(null);
        setBackendCoverageError(error instanceof Error ? error.message : 'No actual KSB coverage data was returned by the backend.');
      })
      .finally(() => {
        if (!signal?.aborted) setBackendCoverageLoading(false);
      });
  }, [coverageKsbSource, coverageProgrammeIds]);

  // Summed rather than averaged: the programme's progress is what its learners
  // have between them completed out of what they are between them targeted, so
  // one learner running ahead cannot cover for a cohort that is behind.
  const loadLearnerOtjh = useCallback((signal?: AbortSignal) => {
    if (!coverageProgrammeIds.length) return Promise.resolve();
    setLearnerOtjhLoading(true);
    return (async () => {
      let lastError: unknown = null;
      for (const programmeId of coverageProgrammeIds) {
        try {
          // 'all': a paused or completed placement is still a learner whose
          // hours count towards the programme.
          return await fetchCurriculumScopeLearnerRoster('programme', programmeId, { learnerStatus: 'all' }, signal);
        } catch (error) {
          if (signal?.aborted) throw error;
          lastError = error;
        }
      }
      throw lastError || new Error('Unable to load the programme learner roster.');
    })()
      .then(result => {
        if (signal?.aborted) return;
        const rows = result?.assignedLearners || [];
        setLearnerOtjh({
          completed: rows.reduce((total, row) => total + Number(row.completedHours || 0), 0),
          target: rows.reduce((total, row) => total + Number(row.targetHours || 0), 0),
          learners: rows.length,
        });
      })
      .catch(error => {
        if (signal?.aborted) return;
        console.warn('Unable to load learner off-the-job hours for this programme.', error);
        setLearnerOtjh(null);
      })
      .finally(() => {
        if (!signal?.aborted) setLearnerOtjhLoading(false);
      });
  }, [coverageProgrammeIds]);

  useEffect(() => {
    if (tab !== 'overview' || !coverageProgrammeIds.length) return;
    const otjhKey = `programme-otjh:${coverageProgrammeIds.join('|')}`;
    if (learnerOtjhRequestKeyRef.current === otjhKey) return;
    learnerOtjhRequestKeyRef.current = otjhKey;
    const controller = new AbortController();
    void loadLearnerOtjh(controller.signal);
    return () => {
      controller.abort();
      if (learnerOtjhRequestKeyRef.current === otjhKey) learnerOtjhRequestKeyRef.current = '';
    };
  }, [coverageProgrammeIds, loadLearnerOtjh, tab]);

  // Overview reads the same coverage the KSB tab draws — its readiness figure and
  // the header's coverage stat are that heatmap counted, not a second calculation
  // — so landing on the page loads it once and both agree.
  const needsCoverage = tab === 'overview' || tab === 'coverage' || tab === 'achievement' || tab === 'quality';

  useEffect(() => {
    if (!needsCoverage) return;
    const coverageKey = [coverageProgrammeIds.join('|'), coverageKsbSource.sourceType || '', coverageKsbSource.sourceId || ''].join('::');
    if (!coverageKey || coverageRequestKeyRef.current === coverageKey) return;
    coverageRequestKeyRef.current = coverageKey;
    const controller = new AbortController();
    void loadBackendCoverage(controller.signal);
    return () => {
      controller.abort();
      if (coverageRequestKeyRef.current === coverageKey) coverageRequestKeyRef.current = '';
    };
  }, [coverageKsbSource.sourceId, coverageKsbSource.sourceType, coverageProgrammeIds, loadBackendCoverage, needsCoverage]);

  // The roster is asked for at the group's own scope rather than the
  // programme's. It used to read the whole programme and then filter the rows
  // down by cohort *name* and group *name* in the browser — and a learner whose
  // placement labels differed by so much as a renamed cohort dropped out of a
  // group that plainly contains them. The group endpoint resolves the group by
  // id, walks its own lineage, and returns everyone enrolment placed in it, so
  // "Learners" shows the group's roster and not a name match.
  const loadLearnerRoster = useCallback((groupId: string, signal?: AbortSignal) => {
    if (!groupId) return Promise.resolve();
    setLearnerRosterLoading(true);
    setLearnerRosterError(null);
    // 'all': a paused or completed placement is still someone this group holds,
    // and hiding them makes the count above the table disagree with the list.
    return fetchCurriculumScopeLearnerRoster('group', groupId, { learnerStatus: 'all' }, signal)
      .then(result => {
        if (signal?.aborted) return;
        setLearnerRoster(result || null);
        setLearnerRosterError(null);
      })
      .catch(error => {
        if (signal?.aborted) return;
        console.warn('Unable to load the group learner roster.', error);
        setLearnerRoster(null);
        setLearnerRosterError(error instanceof Error ? error.message : 'Unable to load learners assigned by enrolment.');
      })
      .finally(() => {
        if (!signal?.aborted) setLearnerRosterLoading(false);
      });
  }, []);

  useEffect(() => {
    if (tab !== 'groups' || !selectedGroup) return;
    const rosterKey = `group:${selectedGroup}`;
    if (rosterRequestKeyRef.current === rosterKey) return;
    rosterRequestKeyRef.current = rosterKey;
    const controller = new AbortController();
    void loadLearnerRoster(selectedGroup, controller.signal);
    return () => {
      controller.abort();
      if (rosterRequestKeyRef.current === rosterKey) rosterRequestKeyRef.current = '';
    };
  }, [loadLearnerRoster, selectedGroup, tab]);

  useEffect(() => {
    setDetailComponents([]);
    componentsRequestKeyRef.current = '';
    coverageRequestKeyRef.current = '';
    rosterRequestKeyRef.current = '';
    learnerOtjhRequestKeyRef.current = '';
    setLearnerOtjh(null);
    occurrencesRequestKeyRef.current = '';
    setLiveOccurrences(new Map());
    setLearnerRoster(null);
    setLearnerRosterError(null);
    setSelectedLearner(null);
  }, [id]);

  useEffect(() => {
    if (!data) return;
    const moduleCatalogueIds = [...new Set(data.modules.flatMap(module => [
      module.moduleCatalogueId,
      module.catalogueId,
      module.structureId,
      module.moduleId,
      ...(module.relatedCatalogueIds || []),
    ]).map(value => clean(value)).filter(Boolean))];
    if (!moduleCatalogueIds.length) return;
    const componentsKey = moduleCatalogueIds.join('|');
    if (componentsRequestKeyRef.current === componentsKey) return;
    componentsRequestKeyRef.current = componentsKey;
    const controller = new AbortController();
    fetchCurriculumComponents(controller.signal, { moduleCatalogueIds })
      .then(setDetailComponents)
      .catch(error => {
        if (!controller.signal.aborted) {
          componentsRequestKeyRef.current = '';
          console.warn('Unable to load programme components.', error);
        }
      });
    return () => {
      controller.abort();
      if (componentsRequestKeyRef.current === componentsKey) componentsRequestKeyRef.current = '';
    };
  }, [data]);

  const programmeModuleCatalogueIds = useMemo(() => {
    if (!data) return [] as string[];
    return [...new Set(data.modules.flatMap(module => [
      module.moduleCatalogueId,
      module.catalogueId,
      module.structureId,
      module.moduleId,
      ...(module.relatedCatalogueIds || []),
    ]).map(value => clean(value)).filter(Boolean))];
  }, [data]);

  const loadLiveOccurrences = useCallback(async (options: { skipCache?: boolean } = {}) => {
    if (!programmeModuleCatalogueIds.length) {
      setLiveOccurrences(new Map());
      return;
    }
    setOccurrencesLoading(true);
    try {
      const response = await fetchCurriculumLiveSessionOccurrences({
        moduleCatalogueIds: programmeModuleCatalogueIds,
        skipCache: options.skipCache,
      });
      const next = new Map<string, CurriculumLiveSessionOccurrence>();
      for (const occurrence of response.occurrences) {
        if (occurrence.occurrenceId) next.set(occurrence.occurrenceId, occurrence);
        if (occurrence.liveSessionId && occurrence.sessionNumber) {
          next.set(`${occurrence.liveSessionId}::${occurrence.sessionNumber}`, occurrence);
        }
        // Components created before the per-occurrence link was stamped carry only
        // the series id + their scheduled instant (never the session number). The
        // instant is the reliable join in that case — it matches the occurrence's
        // scheduled_start exactly. Key by epoch ms so tz spelling can't matter.
        const instant = Date.parse(occurrence.scheduledStart);
        if (occurrence.liveSessionId && Number.isFinite(instant)) {
          next.set(`${occurrence.liveSessionId}::inst:${instant}`, occurrence);
        }
      }
      setLiveOccurrences(next);
    } catch (error) {
      console.warn('Unable to load live-session occurrences.', error);
    } finally {
      setOccurrencesLoading(false);
    }
  }, [programmeModuleCatalogueIds]);

  // Fetch real occurrence status once, when the Sessions tab is first opened for
  // a programme. Keyed on the module set so switching programmes refetches, but
  // re-opening the same tab does not.
  useEffect(() => {
    if (tab !== 'sessions') return;
    const key = programmeModuleCatalogueIds.join('|');
    if (!key) return;
    if (occurrencesRequestKeyRef.current === key) return;
    occurrencesRequestKeyRef.current = key;
    void loadLiveOccurrences();
  }, [tab, programmeModuleCatalogueIds, loadLiveOccurrences]);

  useEffect(() => {
    if (!needsCoverage) return undefined;
    if (programmeKsbSets.length) return undefined;
    const controller = new AbortController();
    fetchCurriculumKsbSets(controller.signal)
      .then(setProgrammeKsbSets)
      .catch(error => {
        if (!controller.signal.aborted) console.warn('Unable to load KSB profiles for programme descriptions.', error);
      });
    return () => controller.abort();
  }, [needsCoverage, programmeKsbSets.length]);

  useEffect(() => {
    if (!needsCoverage) return undefined;
    if (skillsStandards.length) return undefined;
    const controller = new AbortController();
    fetchCurriculumStandards(controller.signal)
      .then(setSkillsStandards)
      .catch(error => {
        if (!controller.signal.aborted) console.warn('Unable to load Skills England standards for programme link.', error);
      });
    return () => controller.abort();
  }, [needsCoverage, skillsStandards.length]);


  // ---------------------------------------------------------------- delivery

  // Archived cohorts are loaded but treated as opt-in: they stay out of the
  // default list (and out of "All statuses", which means "all live statuses") so
  // day-to-day delivery views are not padded with retired cohorts. Choosing
  // "Archived" explicitly is the only way to surface them.
  const archivedCohortCount = useMemo(
    () => PROGRAMME.cohorts.filter(cohortItem => normalise(cohortItem.status) === 'archived').length,
    [PROGRAMME.cohorts],
  );
  // Headline counts must keep meaning "cohorts you are delivering", so every
  // stat and tab counter reads this rather than the raw array length.
  const liveCohortCount = PROGRAMME.cohorts.length - archivedCohortCount;
  const allGroups = useMemo(
    () => PROGRAMME.cohorts.flatMap(cohortItem => cohortItem.groups.map(group => ({ cohort: cohortItem, group }))),
    [PROGRAMME.cohorts],
  );
  const totalGroups = allGroups.length;
  const unstaffedGroupCount = allGroups.filter(({ group }) => !isStaffAssigned(group.coach)).length;

  const filteredCohorts = useMemo(() => {
    const query = normalise(cohortSearch);
    return PROGRAMME.cohorts.filter(cohortItem => {
      // Taken out the moment "Archive" is confirmed, ahead of the reload that
      // will otherwise leave it out — see `archiveCohort`.
      if (archivedCohortIds.has(cohortItem.id)) return false;
      const isArchived = normalise(cohortItem.status) === 'archived';
      if (cohortStatusFilter === 'archived' ? !isArchived : isArchived) return false;
      const matchesQuery = !query || [cohortItem.name, cohortItem.status, cohortItem.startDate, cohortItem.endDate]
        .some(value => normalise(value).includes(query));
      const matchesStatus = !cohortStatusFilter || cohortStatusFilter === 'archived' || cohortItem.status === cohortStatusFilter;
      return matchesQuery && matchesStatus;
    });
  }, [PROGRAMME.cohorts, archivedCohortIds, cohortSearch, cohortStatusFilter]);

  // The groups panel always shows a cohort that is actually in the table above
  // it, so filtering can never leave it describing a hidden row.
  useEffect(() => {
    if (!filteredCohorts.length) {
      if (selectedCohort) setSelectedCohort('');
      return;
    }
    if (!filteredCohorts.some(cohortItem => cohortItem.id === selectedCohort)) {
      setSelectedCohort(filteredCohorts[0].id);
    }
  }, [filteredCohorts, selectedCohort]);

  const groupCohorts = useMemo(
    () => PROGRAMME.cohorts.filter(cohortItem => normalise(cohortItem.status) !== 'archived'),
    [PROGRAMME.cohorts],
  );
  const activeCohort = useMemo(
    () => groupCohorts.find(cohortItem => cohortItem.id === selectedCohort) || groupCohorts[0] || null,
    [groupCohorts, selectedCohort],
  );
  const filteredGroups = useMemo(() => {
    const query = normalise(groupSearch);
    return (activeCohort?.groups || []).filter(group => {
      // Same immediate drop as `filteredCohorts` above, for `archiveGroup`.
      if (archivedGroupIds.has(group.id)) return false;
      const matchesQuery = !query || [group.name, group.coach, group.schedule, group.mode]
        .some(value => normalise(value).includes(query));
      const hasCoach = isStaffAssigned(group.coach);
      const matchesCoach = !groupCoachFilter
        || (groupCoachFilter === 'assigned' ? hasCoach : !hasCoach);
      return matchesQuery && matchesCoach;
    });
  }, [activeCohort, archivedGroupIds, groupCoachFilter, groupSearch]);
  const activeGroup = useMemo(
    () => filteredGroups.find(group => group.id === selectedGroup) || null,
    [filteredGroups, selectedGroup],
  );

  useEffect(() => {
    if (selectedGroup && !filteredGroups.some(group => group.id === selectedGroup)) setSelectedGroup('');
  }, [filteredGroups, selectedGroup]);

  // The open learner belongs to the group whose roster was showing. Changing or
  // closing the group leaves a detail panel reporting a scope nobody is looking
  // at any more, so it closes with the roster it came from.
  useEffect(() => {
    setSelectedLearner(null);
  }, [selectedGroup]);

  // ----------------------------------------------------------------- modules

  const moduleCohorts = useMemo(
    () => [...new Set(PROGRAMME.modules.map(mod => clean(mod.cohort)).filter(Boolean))].sort(),
    [PROGRAMME.modules],
  );
  const moduleGroups = useMemo(
    () => [...new Set(PROGRAMME.modules.map(mod => clean(mod.group)).filter(Boolean))].sort(),
    [PROGRAMME.modules],
  );
  const filteredModules = useMemo(() => {
    const query = normalise(moduleSearch);
    return PROGRAMME.modules.filter(mod => {
      const matchesQuery = !query || [mod.name, mod.description, mod.cohort, mod.group, mod.tutor, ...mod.ksbTags]
        .some(value => normalise(value).includes(query));
      const matchesCohort = !moduleCohortFilter || clean(mod.cohort) === moduleCohortFilter;
      const matchesGroup = !moduleGroupFilter || clean(mod.group) === moduleGroupFilter;
      // Archived from the row action a moment ago, and still in the payload the
      // reload behind it has not replaced yet — same rule as the cohort rows.
      if (archivedModuleIds.has(mod.id)) return false;
      return matchesQuery && matchesCohort && matchesGroup;
    });
  }, [PROGRAMME.modules, archivedModuleIds, moduleSearch, moduleCohortFilter, moduleGroupFilter]);

  // ---------------------------------------------------------------- sessions

  const deliverySessions = useMemo<DeliverySession[]>(() => {
    const rows: DeliverySession[] = [];
    PROGRAMME.modules.forEach(mod => {
      const moduleCatalogueId = clean(mod.moduleCatalogueId || mod.catalogueId);
      mod.weeksData.forEach(wk => {
        const weekComponents = wk.components || [];
        let weekHasLiveComponent = false;
        weekComponents.forEach(component => {
          const kind = deliveryKindForComponent(component);
          if (!kind) return;
          if (kind === 'live') weekHasLiveComponent = true;
          const settings = (component.settings || {}) as Record<string, unknown>;
          const sessionDateTimeUtc = clean(settings.sessionDateTimeUtc);
          const parsedSessionDate = sessionDateTimeUtc ? new Date(sessionDateTimeUtc) : null;
          const sessionTimeUtc = parsedSessionDate && !Number.isNaN(parsedSessionDate.getTime())
            ? `${parsedSessionDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC', hour12: false })} UTC`
            : '';
          const groupNames = Array.isArray(settings.selectedGroupNames)
            ? (settings.selectedGroupNames as unknown[]).map(value => clean(value)).filter(Boolean)
            : [];
          // A generic "Week 3" is the absence of a title, not a title, so the
          // row is not made to print it twice.
          const authoredWeekTitle = clean(wk.title);

          // Match this live component to its real occurrence. The attach flow
          // stamps the occurrence id/number into the component's settings; the
          // occurrence carries the status the sync service authored. We never
          // decide scheduled/completed from a date here.
          const liveSessionId = clean(settings.teamsLiveSessionId);
          const occurrenceId = clean(settings.teamsOccurrenceId);
          const sessionNumber = Number(settings.teamsSessionNumber) || 0;
          // Match by occurrence id, then session number, then the scheduled
          // instant — the last covers components that only ever got the series id
          // stamped (no per-occurrence link), which is common in existing data.
          const componentInstant = parsedSessionDate && !Number.isNaN(parsedSessionDate.getTime())
            ? parsedSessionDate.getTime()
            : NaN;
          const occurrence = kind === 'live'
            ? (liveOccurrences.get(occurrenceId)
              || (liveSessionId && sessionNumber ? liveOccurrences.get(`${liveSessionId}::${sessionNumber}`) : undefined)
              || (liveSessionId && Number.isFinite(componentInstant) ? liveOccurrences.get(`${liveSessionId}::inst:${componentInstant}`) : undefined))
            : undefined;
          // The component's own settings first; the occurrence's own join link
          // covers a completed meeting whose component was never stamped with one.
          const sessionUrl = watchableUrl(settings.liveSessionUrl || settings.videoUrl || settings.embedCode)
            || (kind === 'live' ? clean(occurrence?.joinUrl) : '');

          const authoredDate = clean(settings.sessionDate);
          // Only positive, finite minutes are a duration; anything else is "—".
          const rawDuration = Number(settings.durationMinutes) || Number(component.duration) || 0;
          const safeDuration = Number.isFinite(rawDuration) && rawDuration > 0 ? Math.round(rawDuration) : 0;

          // Real status wins. Without a tracked occurrence, fall back to a plain
          // planned/authoring label (never "completed", which only the service sets).
          //
          // A live component with neither a series id nor a meeting link has had no
          // Teams work done on it at all: an authored date is the plan for the week,
          // not a meeting that exists, so calling it "scheduled" claimed a meeting
          // nobody has created. It reports the same gap a week with no live component
          // reports, and offers the same way to close it.
          const liveMeetingExists = Boolean(liveSessionId || sessionUrl || occurrence);
          const status = occurrence?.status
            || (kind === 'live' && !liveMeetingExists ? 'not-created' : null)
            || (kind === 'live' && (sessionUrl || authoredDate) ? 'scheduled' : component.status || 'draft');

          rows.push({
            id: component.id,
            kind,
            title: clean(component.title, kind === 'live' ? 'Live session' : 'Recorded video'),
            module: mod.name,
            moduleCatalogueId,
            week: wk.number,
            weekId: clean(wk.id),
            weekTitle: normalise(authoredWeekTitle) === normalise(`week ${wk.number}`) ? '' : authoredWeekTitle,
            weekStartDate: clean(wk.startDate),
            date: authoredDate,
            dateIso: clean(occurrence?.scheduledStart) || sessionDateTimeUtc || authoredDate,
            time: clean(settings.sessionTime) || sessionTimeUtc,
            groups: groupNames,
            url: sessionUrl,
            provider: clean(settings.provider || settings.sourceType),
            durationMinutes: safeDuration,
            attendanceRequired: kind === 'live' && settings.attendanceRequired !== false,
            recordingExpected: Boolean(settings.recordingExpected),
            ksbRefs: component.ksbRefs || [],
            status,
            liveSessionId,
            occurrenceId: clean(occurrence?.occurrenceId) || occurrenceId,
            sessionNumber,
            actualStart: clean(occurrence?.actualStart),
            actualEnd: clean(occurrence?.actualEnd),
            participantCount: occurrence?.participantCount || 0,
            artifactsSyncedAt: clean(occurrence?.artifactsSyncedAt),
          });
        });

        // Every authored week plans its own live session (see
        // every-week-gets-its-own-live-session) — one that hasn't had a Teams
        // meeting attached yet is still a real gap in the schedule, not a row
        // that silently doesn't exist. Reported here as its own row rather than
        // only as a programme-level count, so the reader lands on the exact week
        // that needs one.
        if (!weekHasLiveComponent) {
          const weekTitle = clean(wk.title);
          rows.push({
            id: `${moduleCatalogueId || mod.id}-week-${wk.number}-no-meeting`,
            kind: 'live',
            title: 'Live session',
            module: mod.name,
            moduleCatalogueId,
            week: wk.number,
            weekId: clean(wk.id),
            weekTitle: normalise(weekTitle) === normalise(`week ${wk.number}`) ? '' : weekTitle,
            weekStartDate: clean(wk.startDate),
            date: '',
            dateIso: '',
            time: '',
            groups: [],
            url: '',
            provider: '',
            durationMinutes: 0,
            attendanceRequired: false,
            recordingExpected: false,
            ksbRefs: [],
            status: 'not-created',
            liveSessionId: '',
            occurrenceId: '',
            sessionNumber: 0,
            actualStart: '',
            actualEnd: '',
            participantCount: 0,
            artifactsSyncedAt: '',
          });
        }
      });
    });
    return rows;
  }, [PROGRAMME.modules, liveOccurrences]);
  const liveSessions = useMemo(() => deliverySessions.filter(session => session.kind === 'live'), [deliverySessions]);
  const recordedSessions = useMemo(() => deliverySessions.filter(session => session.kind === 'recorded'), [deliverySessions]);
  const missingMeetingCount = useMemo(
    () => liveSessions.filter(session => session.status === 'not-created').length,
    [liveSessions],
  );
  const activeSessions = sessionKind === 'live' ? liveSessions : recordedSessions;
  const sessionModules = useMemo(
    () => [...new Set(activeSessions.map(session => session.module).filter(Boolean))].sort(),
    [activeSessions],
  );
  const filteredSessions = useMemo(() => {
    const query = normalise(sessionSearch);
    return activeSessions.filter(session => {
      const matchesModule = !sessionModuleFilter || session.module === sessionModuleFilter;
      const matchesQuery = !query || [session.title, session.module, sessionWeekLabel(session), session.provider, session.date, session.time, session.weekStartDate, ...session.groups, ...session.ksbRefs]
        .some(value => normalise(value).includes(query));
      return matchesModule && matchesQuery;
    });
  }, [activeSessions, sessionModuleFilter, sessionSearch]);

  // Resolve a session's "open in Module Builder" link once per module, keyed by
  // both catalogue id and name so a row matches however it identifies its module.
  // Deep-linked to the row's own week, which is what the reader came for —
  // whether to review that week or to create the meeting it hasn't got yet.
  const sessionModuleHref = useMemo(() => {
    const byId = new Map<string, Module>();
    const byName = new Map<string, Module>();
    for (const mod of PROGRAMME.modules) {
      const catalogueId = clean(mod.moduleCatalogueId || mod.catalogueId);
      if (catalogueId) byId.set(catalogueId, mod);
      if (mod.name) byName.set(mod.name, mod);
    }
    return (session: DeliverySession) => {
      const mod = (session.moduleCatalogueId && byId.get(session.moduleCatalogueId)) || byName.get(session.module);
      if (!mod) return '';
      return moduleBuilderUrl(mod, PROGRAMME, session.weekId ? { weekId: session.weekId } : undefined);
    };
  }, [PROGRAMME.modules, PROGRAMME]);

  // --------------------------------------------------------------------- KSB

  const programmeScopeId = coverageProgrammeIds[0] || PROGRAMME.sourceId || PROGRAMME.id;
  useEffect(() => {
    if (!programmeScopeId) return;
    setAchievementScope(current => (
      current.scope === 'programme' && current.identifier !== programmeScopeId
        ? { ...current, identifier: programmeScopeId, label: PROGRAMME.name || 'Programme' }
        : current
    ));
  }, [PROGRAMME.name, programmeScopeId]);

  /**
   * Where each module column sits in the delivery tree.
   *
   * `moduleNames[i]` is `liveProgramme.modules[i]`: `buildHeatmapModuleBindings`
   * labels the programme's own modules first, in order, and only then appends a
   * backend module that matched none of them — those trailing columns belong to
   * no group here and drop out of a filtered view, which is correct, since
   * nothing places them in one.
   */
  const moduleScopeByLabel = useMemo(() => {
    const map = new Map<string, ModuleDeliveryScope>();
    liveProgramme.modules.forEach((module, index) => {
      const label = PROGRAMME.moduleNames[index];
      if (!label) return;
      const identity = moduleWorkspaceIdentity(module);
      for (const cohort of PROGRAMME.cohorts) {
        for (const group of cohort.groups) {
          const belongs = group.modules.some(item => item === module
            || (identity && moduleWorkspaceIdentity(item) === identity));
          if (!belongs) continue;
          map.set(label, {
            cohortId: cohort.id,
            cohortName: cohort.name,
            groupId: group.id,
            groupName: group.name,
          });
          return;
        }
      }
      // No group claimed it, but the module row itself may still name one — a
      // group the programme's own cohort list does not carry, which the Overview
      // tab already reports as the data problem it is.
      if (module.cohortId || module.groupId) {
        map.set(label, {
          cohortId: module.cohortId || '',
          cohortName: module.cohort || '',
          groupId: module.groupId || '',
          groupName: module.group || '',
        });
      }
    });
    return map;
  }, [PROGRAMME.cohorts, PROGRAMME.moduleNames, liveProgramme.modules]);

  /**
   * Which module each coverage column actually is, so a placement can be
   * resolved back to the component the module holds. Same index alignment as
   * `moduleScopeByLabel`, and for the same reason: coverage rows carry labels,
   * never ids.
   */
  const moduleByLabel = useMemo(() => {
    const map = new Map<string, Module>();
    liveProgramme.modules.forEach((module, index) => {
      const label = PROGRAMME.moduleNames[index];
      if (label) map.set(label, module);
    });
    return map;
  }, [PROGRAMME.moduleNames, liveProgramme.modules]);

  const previewModule = placementPreview ? moduleByLabel.get(placementPreview.placement.moduleLabel) : undefined;
  const previewMatch = useMemo(
    () => (placementPreview ? findPlacementComponent(previewModule, placementPreview.placement) : null),
    [placementPreview, previewModule],
  );


  // The module columns the coverage tab is reading. Everything below is
  // recomputed from these, so a KSB taught only in another group reads as
  // missing here rather than borrowing that group's weight.
  const coverageModuleNames = useMemo(() => {
    if (!coverageCohortId && !coverageGroupId) return PROGRAMME.moduleNames;
    return PROGRAMME.moduleNames.filter(label => {
      const meta = moduleScopeByLabel.get(label);
      if (!meta) return false;
      if (coverageGroupId) return meta.groupId === coverageGroupId;
      return meta.cohortId === coverageCohortId;
    });
  }, [PROGRAMME.moduleNames, coverageCohortId, coverageGroupId, moduleScopeByLabel]);

  const coverageScopedRows = useMemo(() => {
    if (coverageModuleNames.length === PROGRAMME.moduleNames.length) return PROGRAMME.ksbHeatmap;
    return PROGRAMME.ksbHeatmap.map(row => scopeHeatmapRowToModules(row, coverageModuleNames));
  }, [PROGRAMME.ksbHeatmap, PROGRAMME.moduleNames.length, coverageModuleNames]);

  /**
   * Every component that carries a KSB in view, with the KSBs inside it.
   *
   * Built from the scoped rows rather than the searched ones, so the search box
   * can match a component's own name here instead of only the KSB text the list
   * view searches.
   */
  const coverageComponents = useMemo(
    () => componentPlacementGroups(coverageScopedRows, coverageModuleNames, moduleScopeByLabel),
    [coverageScopedRows, coverageModuleNames, moduleScopeByLabel],
  );

  const filteredCoverageComponents = useMemo(() => {
    const query = normalise(ksbSearch);
    const base = pickedComponentIds.length
      ? coverageComponents.filter(group => pickedComponentIds.includes(group.id))
      : coverageComponents;
    if (!query) return base;
    return base.filter(group => [
      group.component,
      group.componentType,
      group.moduleLabel,
      group.week,
      group.groupName,
      ...group.ksbs.flatMap(item => [formatKsbCode(item.ksb), item.ksb, item.title]),
    ].some(value => normalise(value).includes(query)));
  }, [coverageComponents, ksbSearch, pickedComponentIds]);

  // A pick surviving a cohort/group change that dropped its component would
  // sit invisibly in the count while showing nothing — dropped instead, the
  // moment its component leaves view.
  useEffect(() => {
    if (!pickedComponentIds.length) return;
    const stillThere = pickedComponentIds.filter(id => coverageComponents.some(group => group.id === id));
    if (stillThere.length !== pickedComponentIds.length) setPickedComponentIds(stillThere);
  }, [coverageComponents, pickedComponentIds]);

  const filteredKsbHeatmap = useMemo(() => {
    const query = normalise(ksbSearch);
    return coverageScopedRows.filter(row => {
      if (coverageStanding === 'taught' && !ksbRowIsMapped(row)) return false;
      if (coverageStanding === 'missing' && ksbRowIsMapped(row)) return false;
      return !query || [row.ksb, formatKsbCode(row.ksb), row.title, ksbSourceLabel(row)]
        .some(value => normalise(value).includes(query));
    });
  }, [coverageScopedRows, coverageStanding, ksbSearch]);

  // Coverage figures for the modules currently in view. The programme-wide
  // counts below keep their own names: the Quality tab and the Overview card
  // both ask "is anything taught nowhere on this programme", which no cohort
  // filter should be able to answer for them.
  const coverageTaughtCount = coverageScopedRows.filter(ksbRowIsMapped).length;
  const coverageMissingCount = coverageScopedRows.length - coverageTaughtCount;
  const coverageWeightTotal = coverageScopedRows.reduce((total, row) => total + ksbRowWeight(row), 0);
  const coveragePlacementTotal = coverageScopedRows.reduce((total, row) => total + ksbRowOccurrences(row), 0);
  const mappedKsbCount = PROGRAMME.ksbHeatmap.filter(ksbRowIsMapped).length;
  const missingKsbCount = PROGRAMME.ksbHeatmap.length - mappedKsbCount;
  const totalKsbWeight = PROGRAMME.ksbHeatmap.reduce((total, row) => total + ksbRowWeight(row), 0);
  const totalKsbOccurrences = PROGRAMME.ksbHeatmap.reduce((total, row) => total + Number(row.totalOccurrences || 0), 0);
  // Percentage of required KSBs that are placed somewhere — not a judgement on
  // how much weight each one carries.
  const ksbCoverage = PROGRAMME.ksbHeatmap.length
    ? Math.round((mappedKsbCount / PROGRAMME.ksbHeatmap.length) * 100)
    : 0;
  // The heatmap is only fetched on the tabs that draw it (see `needsCoverage`), so
  // an empty one on Modules or Sessions means "not read here", not "nothing to
  // read". The programme record carries its own source id either way, which is
  // what lets the header pill tell those two apart: deep-linking to ?tab=sessions
  // used to report "No KSB source" for a programme that has one applied.
  const hasKsbSource = Boolean(clean(PROGRAMME.ksbProfileSourceId)) || PROGRAMME.ksbHeatmap.length > 0;
  const ksbCoverageRead = PROGRAMME.ksbHeatmap.length > 0;

  // ---------------------------------------------------------------- readiness

  const allComponents = useMemo(
    () => PROGRAMME.modules.flatMap(mod => mod.weeksData.flatMap(wk => wk.components || [])),
    [PROGRAMME.modules],
  );
  const publishedComponents = allComponents.filter(component => component.status === 'published').length;
  const totalOtjh = PROGRAMME.modules.reduce((total, mod) => total + mod.otjh, 0);
  // Learner off-the-job hours: completed against targeted, both read off
  // `Learner.learners`. With no learner target recorded the programme's own
  // requirement stands in as the denominator, labelled as the programme's, since
  // it is a contracted figure and not something a learner has been set.
  const programmeRequiredOtjh = Number(PROGRAMME.requiredOtjh) > 0 ? Number(PROGRAMME.requiredOtjh) : 0;
  const learnerOtjhCompleted = learnerOtjh?.completed || 0;
  const learnerOtjhLearners = learnerOtjh?.learners || 0;
  const learnerOtjhTarget = learnerOtjh?.target || 0;
  const otjhTargetIsProgrammeRequirement = !learnerOtjhTarget && programmeRequiredOtjh > 0 && learnerOtjhLearners > 0;
  const otjhDenominator = learnerOtjhTarget || (otjhTargetIsProgrammeRequirement ? programmeRequiredOtjh * learnerOtjhLearners : 0);
  // Capped at 100 so a learner ahead of target still reads as a full bar rather
  // than a broken one.
  const otjhProgress = otjhDenominator ? Math.min(100, Math.round((learnerOtjhCompleted / otjhDenominator) * 100)) : 0;
  const totalLearners = PROGRAMME.cohorts.reduce((total, cohortItem) => total + cohortItem.learners, 0);
  // Counted exactly as the Modules table's own WEEKS column counts it, falling
  // back to the module's stored week count when no week has been opened in the
  // builder yet. Summing `weeksData.length` alone made the headline stat read
  // less than the column beneath it — and less than the programme card, which
  // reads the stored count from the same rows.
  const totalWeeks = PROGRAMME.modules.reduce((total, mod) => total + (mod.weeksData.length || mod.weeks || 0), 0);
  const emptyWeekCount = PROGRAMME.modules
    .flatMap(mod => mod.weeksData)
    .filter(wk => !(wk.components || []).length).length;
  // A useful first design slice is tangible rather than percentage-based: at
  // least one module, one authored week and one component learners can consume.
  const hasMinimumDesign = PROGRAMME.modules.length > 0 && totalWeeks > 0 && allComponents.length > 0;
  const untutoredModules = PROGRAMME.modules.filter(mod => !isStaffAssigned(mod.tutor));
  // Modules whose stored cohort is not one of this programme's cohort records.
  // This page used to invent a cohort row for them, which is why its cohort count
  // could disagree with the Cohorts page; now it reports them as the data problem
  // they are and leaves the count honest.
  const unlinkedModules = useMemo(() => {
    const cohortKeys = new Set(PROGRAMME.cohorts.flatMap(cohortItem => [normalise(cohortItem.id), normalise(cohortItem.name)]).filter(Boolean));
    return PROGRAMME.modules.filter(mod => {
      const key = normalise(mod.cohortId || mod.cohort);
      return !key || !cohortKeys.has(key);
    });
  }, [PROGRAMME.cohorts, PROGRAMME.modules]);

  // ------------------------------------------------------------------ drawers

  // This programme as the shared drawers expect it. Used as the programme list
  // when the detail payload has not landed yet, so opening "Add cohort" during a
  // reload still knows which programme it is adding to.
  const pageProgramme = useMemo<CurriculumProgramme>(() => ({
    id: PROGRAMME.id,
    sourceId: PROGRAMME.sourceId || PROGRAMME.id,
    name: PROGRAMME.name,
    standard: PROGRAMME.standard,
    level: PROGRAMME.level,
    modules: PROGRAMME.modules.length,
    weeks: totalWeeks,
    ksbMapped: mappedKsbCount,
    ksbTotal: PROGRAMME.ksbHeatmap.length,
    learners: totalLearners,
    cohorts: liveCohortCount,
    groups: totalGroups,
    lastUpdated: '',
    owner: PROGRAMME.owner,
    color: PROGRAMME.color,
    description: PROGRAMME.description,
    ksbProfileSourceId: PROGRAMME.ksbProfileSourceId,
    structureType: PROGRAMME.structureType,
  }), [PROGRAMME, liveCohortCount, mappedKsbCount, totalGroups, totalLearners, totalWeeks]);

  // What the shared Cohort / Group / Module drawers need. The programme list is
  // this programme alone, which is what fixes the parent for every record added
  // from here without locking the field out of the form.
  const drawerProgrammes = useMemo(
    () => (data?.programmes?.length ? data.programmes : [pageProgramme]),
    [data, pageProgramme],
  );
  const drawerProgramme = drawerProgrammes[0];
  const drawerProgrammeId = useMemo(
    () => (drawerProgramme ? programmeIdentity(drawerProgramme) : clean(liveProgramme.sourceId) || clean(liveProgramme.id) || clean(id || '')),
    [drawerProgramme, id, liveProgramme.id, liveProgramme.sourceId],
  );
  const drawerCoachNames = useMemo(() => staffNameOptions(data?.coaches, (data?.groups || []).map(group => group.coach)), [data]);
  const drawerTutorNames = useMemo(() => staffNameOptions(data?.tutors, (data?.modules || []).map(mod => mod.tutor)), [data]);

  // Assign a group's coach straight from the Delivery tab. The group PATCH is the
  // canonical endpoint, so nothing here bypasses the rules the form applies.
  const assignGroupCoach = async (groupId: string, value: string) => {
    setSavingAction(`coach:${groupId}`);
    try {
      await updateCurriculumGroup(groupId, { coach: value });
      await reload();
    } catch (updateError) {
      await showCurriculumAlert({
        title: 'Could not assign coach',
        text: tutorConflictMessage(updateError)
          || (updateError instanceof Error ? updateError.message : 'The coach could not be saved. Please try again.'),
        icon: 'error',
      });
    } finally {
      setSavingAction(null);
    }
  };

  /** Opens the cohort drawer against an existing record rather than a blank one. */
  const openEditCohort = (cohortId: string) => {
    setEditingCohort(data?.cohorts.find(item => item.id === cohortId) || null);
    setCohortDrawerOpen(true);
  };

  /**
   * Archives a cohort from its row here rather than sending the reader to the
   * Cohorts page — the "Add cohort" button for the same record already lives on
   * this tab, so archiving from elsewhere was the odd one out.
   * `archiveCohortWithConfirm` is the same confirm and API call that page uses.
   */
  const archiveCohort = async (cohortItem: Cohort) => {
    await archiveCohortWithConfirm(cohortItem, cohortItem.groups.length, async () => {
      // Drop the row now, same reason as `assignGroupCoach` above: the refresh
      // behind this takes seconds, and a cohort still listed after "Archive"
      // reads as though nothing happened.
      setArchivedCohortIds(previous => new Set(previous).add(cohortItem.id));
      await reload({ silent: true });
      setArchivedCohortIds(previous => {
        const next = new Set(previous);
        next.delete(cohortItem.id);
        return next;
      });
    });
  };

  /** Opens the group drawer against an existing record. */
  const openEditGroup = (groupId: string, cohortId: string) => {
    setEditingGroup(data?.groups.find(item => item.id === groupId) || null);
    setGroupDrawerCohortId(cohortId);
  };

  const archiveGroup = async (group: Group) => {
    await archiveGroupWithConfirm(group, group.modules.length, async () => {
      setArchivedGroupIds(previous => new Set(previous).add(group.id));
      await reload({ silent: true });
      setArchivedGroupIds(previous => {
        const next = new Set(previous);
        next.delete(group.id);
        return next;
      });
    });
  };

  /**
   * Opens the module drawer against an existing record, the same way the Cohorts
   * and Groups rows above open theirs. The full `CurriculumModule` from the
   * detail payload is preferred; the row itself stands in when the payload has
   * no record for it, so an unattached module is still editable from here.
   */
  const openEditModule = (mod: Module) => {
    const detailModule = findModule(data?.modules || [], moduleBuilderIdentifier(mod));
    setEditingModule(moduleFormTarget(detailModule) || {
      id: moduleBuilderIdentifier(mod),
      name: mod.name,
      programmeId: drawerProgrammeId,
      programme: PROGRAMME.name,
      cohortId: mod.cohortId,
      groupId: mod.groupId,
      weeks: mod.weeksData.length || mod.weeks,
      // The record's dates when it has them; the authored week span only for a
      // module with none, so the form never opens on a recalculated end date.
      startDate: clean(mod.startDate) || mod.weeksData[0]?.startDate,
      endDate: clean(mod.endDate) || mod.weeksData.at(-1)?.endDate || mod.weeksData.at(-1)?.startDate,
      tutor: mod.tutor,
      status: mod.status,
    });
  };

  /**
   * Archives a module from its row, for the same reason the cohort and group
   * rows do it here: the reader is already looking at the record, and the only
   * other door was the Module Builder. Archiving is the whole of it — a module
   * has no permanent delete — which `archiveModuleWithConfirm` says in the
   * confirm.
   */
  const archiveModule = async (mod: Module) => {
    const componentCount = mod.weeksData.reduce((total, wk) => total + (wk.components?.length || 0), 0);
    const moduleId = moduleBuilderIdentifier(mod);
    await archiveModuleWithConfirm({ id: moduleId, name: mod.name }, componentCount, async () => {
      // Off the table now; the reload behind this takes seconds and a module
      // still listed after "Archive" reads as though nothing happened.
      setArchivedModuleIds(previous => new Set(previous).add(mod.id));
      await reload({ silent: true });
      setArchivedModuleIds(previous => {
        const next = new Set(previous);
        next.delete(mod.id);
        return next;
      });
    });
  };

  const goToTab = (next: Tab) => {
    setTab(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const moduleBuilderProgrammeParams = new URLSearchParams({
    programme: clean(PROGRAMME.sourceId) || PROGRAMME.name,
    programmeName: PROGRAMME.name,
  });
  const moduleBuilderProgrammeUrl = `/curriculum/module-builder?${moduleBuilderProgrammeParams.toString()}`;
  const moduleBuilderGroupUrl = (cohortId: string, groupId: string) => {
    const params = new URLSearchParams({
      programme: clean(PROGRAMME.sourceId) || PROGRAMME.name,
      programmeName: PROGRAMME.name,
      cohort: cohortId,
      group: groupId,
      create: '1',
    });
    return `/curriculum/module-builder?${params.toString()}`;
  };

  if (loading && !found) {
    return (
      <WorkspaceShell role="curriculum" roleLabel="Curriculum Designer" navItems={curriculumNavItems} workspaceLabel="Curriculum Studio" pageTitle="Programme loading" pageSubtitle="Preparing live curriculum data from the database" userName="Rachel Myers" userRole="Curriculum Designer">
        <div className="min-h-full space-y-5 bg-background-50 p-4 sm:p-6">
          <div className="h-40 animate-pulse rounded-2xl border border-foreground-200/70 bg-background-100" />
          <div className="flex items-center gap-2 rounded-2xl border border-foreground-200/70 bg-background-50 p-1.5">
            {Object.values(TAB_LABELS).map(label => (
              <div key={label} className="h-10 w-28 animate-pulse rounded-xl bg-background-100" />
            ))}
          </div>
          <div className="h-64 animate-pulse rounded-2xl border border-foreground-200/70 bg-background-100" />
        </div>
      </WorkspaceShell>
    );
  }

  if (error || !found) {
    return (
      <WorkspaceShell role="curriculum" roleLabel="Curriculum Designer" navItems={curriculumNavItems} workspaceLabel="Curriculum Studio" pageTitle="Programme unavailable" pageSubtitle="The requested curriculum programme could not be opened" userName="Rachel Myers" userRole="Curriculum Designer">
        <div className="min-h-full bg-background-50 p-4 sm:p-6">
          <EntityEmptyState
            icon={error ? 'ri-wifi-off-line' : 'ri-folder-warning-line'}
            title={error ? 'Unable to load programme data' : 'Programme not found'}
            message={error || `There is no live curriculum programme matching "${id || 'this route'}". It may have been renamed or removed.`}
            action={error ? { label: 'Try again', onClick: () => void reload() } : undefined}
          />
          <div className="mt-4 flex justify-center">
            <Link
              to="/curriculum/programmes"
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-foreground-200 bg-background-50 px-4 text-[12px] font-bold text-foreground-700 transition-smooth hover:bg-background-100"
            >
              <AppIcon className="ri-arrow-left-line"></AppIcon>
              All programmes
            </Link>
          </div>
        </div>
      </WorkspaceShell>
    );
  }

  const tabs = [
    { key: 'overview', label: TAB_LABELS.overview, icon: 'ri-dashboard-line' },
    { key: 'cohorts', label: TAB_LABELS.cohorts, icon: 'ri-group-line', count: liveCohortCount },
    { key: 'groups', label: TAB_LABELS.groups, icon: 'ri-team-line', count: totalGroups },
    { key: 'modules', label: TAB_LABELS.modules, icon: 'ri-stack-line', count: PROGRAMME.modules.length },
    { key: 'sessions', label: TAB_LABELS.sessions, icon: 'ri-time-line', count: deliverySessions.length || undefined },
    { key: 'coverage', label: TAB_LABELS.coverage, icon: 'ri-node-tree', count: missingKsbCount || undefined },
    { key: 'achievement', label: TAB_LABELS.achievement, icon: 'ri-medal-line' },
    { key: 'quality', label: TAB_LABELS.quality, icon: 'ri-shield-check-line' },
  ];

  return (
    <WorkspaceShell
      role="curriculum"
      roleLabel="Curriculum Designer"
      navItems={curriculumNavItems}
      workspaceLabel="Curriculum Studio"
      pageTitle={PROGRAMME.name}
      pageSubtitle={`${PROGRAMME.duration} · ${liveCohortCount} cohort${liveCohortCount === 1 ? '' : 's'} · ${PROGRAMME.modules.length} module${PROGRAMME.modules.length === 1 ? '' : 's'}`}
      userName="Rachel Myers"
      userRole="Curriculum Designer"
    >
      <div className="min-h-full space-y-5 bg-background-50 p-4 sm:p-6">
        {error && <InlineError message={error} onRetry={() => void reload()} />}

        <WorkspaceHeader
          breadcrumbs={[
            { label: 'Curriculum', href: '/workspace/curriculum' },
            { label: 'Programmes', href: '/curriculum/programmes' },
            { label: PROGRAMME.name },
          ]}
          eyebrow="Programme"
          title={PROGRAMME.name}
          subtitle={[formatProgrammeLevel(PROGRAMME.level, ''), PROGRAMME.standard, PROGRAMME.duration].map(value => clean(value)).filter(Boolean).join(' · ')}
          accentColor={PROGRAMME.color}
          dense
          stats={[
            { icon: 'ri-group-line', label: 'Cohorts', value: liveCohortCount, detail: archivedCohortCount ? `${archivedCohortCount} archived` : undefined },
            { icon: 'ri-team-line', label: 'Groups', value: totalGroups, detail: unstaffedGroupCount ? `${unstaffedGroupCount} need a coach` : 'All coached' },
            { icon: 'ri-stack-line', label: 'Modules', value: PROGRAMME.modules.length, detail: untutoredModules.length ? `${untutoredModules.length} need a tutor` : 'All tutored' },
            { icon: 'ri-calendar-line', label: 'Weeks', value: totalWeeks, detail: `${allComponents.length} components` },
            { icon: 'ri-time-line', label: 'OTJH', value: `${formatHours(totalOtjh)}h` },
            {
              icon: 'ri-node-tree',
              label: 'KSB coverage',
              value: ksbCoverageRead ? `${ksbCoverage}%` : '—',
              detail: ksbCoverageRead
                ? `${mappedKsbCount}/${PROGRAMME.ksbHeatmap.length} mapped`
                : !hasKsbSource
                  ? 'No KSB source'
                  : backendCoverageLoading
                    ? 'Reading coverage…'
                    : 'Open KSB Coverage to read',
            },
          ]}
          actions={(
            <button
              type="button"
              onClick={() => setProgrammeDrawerOpen(true)}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary-600 px-4 text-[12px] font-bold text-white transition-smooth hover:bg-primary-700"
            >
              <AppIcon className="ri-edit-line text-sm"></AppIcon>
              Edit programme
            </button>
          )}
        />

        {tab === 'overview' && (
          <div className="flex flex-col gap-3 rounded-2xl border border-primary-100 bg-primary-50/45 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-background-50 text-primary-700 shadow-sm">
                <AppIcon className="ri-calendar-schedule-line"></AppIcon>
              </span>
              <div className="min-w-0">
                <p className="text-[11px] font-extrabold uppercase tracking-wide text-primary-700">Delivery setup</p>
                <p className="mt-0.5 text-[11px] leading-5 text-foreground-600">
                  Start with cohorts and groups, then assign tutors, coaches and scheduled sessions for this programme.
                </p>
              </div>
            </div>
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:shrink-0 sm:flex-row">
              <button type="button" onClick={() => liveCohortCount ? setTab('cohorts') : setCohortDrawerOpen(true)} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-primary-600 px-3 text-[11px] font-bold text-white hover:bg-primary-700">
                <AppIcon className="ri-group-line"></AppIcon> {liveCohortCount ? 'Manage Cohorts & Groups' : 'Add First Cohort'}
              </button>
              <button type="button" onClick={() => navigate(moduleBuilderProgrammeUrl)} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-primary-200 bg-background-50 px-3 text-[11px] font-bold text-primary-700 hover:bg-primary-100">
                Open Module Builder <AppIcon className="ri-arrow-right-line"></AppIcon>
              </button>
            </div>
          </div>
        )}

        <WorkspaceTabs
          tabs={tabs}
          active={tab}
          onChange={key => setTab(key as Tab)}
          trailing={tab === 'modules' ? (
            <button type="button" onClick={() => navigate(moduleBuilderProgrammeUrl)} className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-primary-600 px-3 text-[11px] font-bold text-white hover:bg-primary-700 sm:w-auto">
              <AppIcon className="ri-tools-line"></AppIcon> Open Module Builder
            </button>
          ) : undefined}
        />

        {/* ═══════════════════════════════════════════════════════════════════
            Overview — the only view that spans the whole programme
        ═══════════════════════════════════════════════════════════════════ */}
        {tab === 'overview' && (
          <div className="space-y-5">
            <div className="grid gap-5 xl:grid-cols-2">
              <WorkspacePanel title="Programme" description="The details the programme itself owns. Everything else belongs to a record beneath it.">
                <DetailRow label="Level" value={formatProgrammeLevel(PROGRAMME.level)} />
                <DetailRow
                  label="KSB source"
                  value={coverageKsbSource.sourceId ? (
                    <span className="flex flex-col items-end gap-1">
                      <span className="flex flex-wrap items-center justify-end gap-1.5">
                        {coverageKsbSourceDetail.kindLabel && (
                          <span className="rounded-full bg-primary-100 px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-primary-700">
                            {coverageKsbSourceDetail.kindLabel}
                          </span>
                        )}
                        <span>{coverageKsbSourceDetail.name || clean(coverageKsbSourceLabel) || coverageKsbSource.sourceId}</span>
                      </span>
                      {(() => {
                        const ksbCount = coverageKsbSourceDetail.ksbCount || PROGRAMME.ksbHeatmap.length;
                        const meta = [
                          coverageKsbSourceDetail.reference,
                          coverageKsbSourceDetail.level,
                          ksbCount ? `${ksbCount} KSBs` : '',
                        ].filter(Boolean).join(' · ');
                        return meta ? <span className="text-[10px] font-semibold text-foreground-400">{meta}</span> : null;
                      })()}
                      {!coverageKsbSourceApplied && (
                        <span className="text-[10px] font-semibold text-amber-700">
                          Matched from the programme standard, not applied on the Programmes page
                        </span>
                      )}
                    </span>
                  ) : <span className="text-amber-700">No source applied</span>}
                />
                <DetailRow label="Practical period" value={clean(PROGRAMME.practicalWindow, 'Not scheduled')} />
                <DetailRow label="Apprenticeship" value={clean(PROGRAMME.apprenticeshipWindow, 'Not scheduled')} />
                <DetailRow label="Learners" value={totalLearners} />
                <DetailRow label="Programme ID" value={<code className="text-[11px]">{clean(PROGRAMME.sourceId) || PROGRAMME.id || '—'}</code>} />
              </WorkspacePanel>

              <WorkspacePanel
                title="Readiness"
                description="Both figures are what the learners on this programme have actually done, read from their own records rather than from the plan."
                actions={(
                  <button
                    type="button"
                    onClick={() => goToTab('coverage')}
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-background-200 bg-background-50 px-3 text-[12px] font-bold text-foreground-600 transition-smooth hover:bg-background-100"
                  >
                    <AppIcon className="ri-bar-chart-line text-sm"></AppIcon>
                    Coverage detail
                  </button>
                )}
              >
                <div className="space-y-4">
                  <ReadinessBar
                    label="KSB progress"
                    value={PROGRAMME.learnerKsbProgressPercentage}
                    color="bg-primary-600"
                    detail={!PROGRAMME.learnerKsbLearnerCount
                      ? 'No learners are placed on this programme yet, so no KSB has been evidenced.'
                      : PROGRAMME.learnerKsbCodesTotal
                        ? `${PROGRAMME.learnerKsbCodesComplete} of ${PROGRAMME.learnerKsbCodesTotal} mapped KSBs are fully evidenced, across ${PROGRAMME.learnerKsbLearnerCount} ${PROGRAMME.learnerKsbLearnerCount === 1 ? 'learner' : 'learners'}.`
                        : 'No component maps a KSB yet, so these learners have nothing to evidence against.'}
                  />
                  <ReadinessBar
                    label="OTJH progress"
                    value={otjhProgress}
                    color="bg-emerald-500"
                    detail={learnerOtjhLoading && !learnerOtjh
                      ? 'Loading learner hours…'
                      : !learnerOtjh
                        ? 'Learner hours could not be read for this programme.'
                        : !learnerOtjhLearners
                          ? 'No learners are placed on this programme yet, so no hours have been completed.'
                          : otjhDenominator
                            ? `${formatHours(learnerOtjhCompleted)}h of ${formatHours(otjhDenominator)}h completed across ${learnerOtjhLearners} ${learnerOtjhLearners === 1 ? 'learner' : 'learners'}${otjhTargetIsProgrammeRequirement ? `, measured against the programme's own ${formatHours(programmeRequiredOtjh)}h requirement because no learner carries target hours.` : '.'}`
                          : `${formatHours(learnerOtjhCompleted)}h completed across ${learnerOtjhLearners} ${learnerOtjhLearners === 1 ? 'learner' : 'learners'}. Neither their records nor this programme carry target hours, so there is nothing to measure against.`}
                  />
                  <div className="grid grid-cols-2 gap-2 border-t border-background-200 pt-4 sm:grid-cols-4">
                    {[
                      { label: 'Weeks', value: totalWeeks },
                      { label: 'Components', value: allComponents.length },
                      { label: 'KSBs unmapped', value: missingKsbCount },
                      { label: 'Authored OTJH', value: `${formatHours(totalOtjh)}h` },
                    ].map(stat => (
                      <div key={stat.label} className="rounded-xl border border-background-200 bg-background-100/60 px-3 py-2">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-foreground-400">{stat.label}</p>
                        <p className="mt-0.5 text-[15px] font-heading font-bold text-foreground-950">{stat.value}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </WorkspacePanel>
            </div>

            <WorkspacePanel
              title="Needs attention"
              description="Gaps that only show up when the whole programme is in view, each pointing at the one place it is fixed."
            >
              {unstaffedGroupCount || untutoredModules.length || unlinkedModules.length || emptyWeekCount || missingKsbCount ? (
                <ul className="space-y-2">
                  {unstaffedGroupCount > 0 && (
                    <AttentionRow
                      icon="ri-user-search-line"
                      tone="amber"
                      title={`${unstaffedGroupCount} ${unstaffedGroupCount === 1 ? 'group has' : 'groups have'} no coach`}
                      detail="A group without a coach has nobody supporting its learners."
                      action={{ label: 'Open Groups', onClick: () => goToTab('groups') }}
                    />
                  )}
                  {untutoredModules.length > 0 && (
                    <AttentionRow
                      icon="ri-user-settings-line"
                      tone="amber"
                      title={`${untutoredModules.length} ${untutoredModules.length === 1 ? 'module has' : 'modules have'} no tutor`}
                      detail="The tutor is set on the module, and its sessions cannot be timetabled without one."
                      action={{ label: 'Open Modules', onClick: () => goToTab('modules') }}
                    />
                  )}
                  {unlinkedModules.length > 0 && (
                    <AttentionRow
                      icon="ri-link-unlink"
                      tone="rose"
                      title={`${unlinkedModules.length} ${unlinkedModules.length === 1 ? 'module is' : 'modules are'} not attached to a live cohort`}
                      detail={`Stored against ${unlinkedModules.slice(0, 2).map(mod => clean(mod.cohort, 'no cohort')).join(', ')}${unlinkedModules.length > 2 ? '…' : ''}, which is not a cohort record on this programme.`}
                      action={{ label: 'Open Modules', onClick: () => goToTab('modules') }}
                    />
                  )}
                  {emptyWeekCount > 0 && (
                    <AttentionRow
                      icon="ri-calendar-close-line"
                      tone="sky"
                      title={`${emptyWeekCount} ${emptyWeekCount === 1 ? 'week has' : 'weeks have'} no content`}
                      detail="A scheduled week with no components gives learners nothing to do."
                      action={{ label: 'Open Module Builder', onClick: () => navigate(moduleBuilderProgrammeUrl) }}
                    />
                  )}
                  {missingKsbCount > 0 && (
                    <AttentionRow
                      icon="ri-node-tree"
                      tone="sky"
                      title={`${missingKsbCount} ${missingKsbCount === 1 ? 'KSB is' : 'KSBs are'} not taught anywhere`}
                      detail="Every KSB in the programme's source has to be mapped to a component before delivery."
                      action={{ label: 'Open Coverage', onClick: () => goToTab('coverage') }}
                    />
                  )}
                </ul>
              ) : (
                <p className="rounded-xl border border-emerald-200 bg-emerald-50/70 px-4 py-3 text-[13px] font-semibold text-emerald-700">
                  <AppIcon className="ri-checkbox-circle-line mr-1.5"></AppIcon>
                  Every group has a coach, every module has a tutor, every week has content and every KSB is mapped.
                </p>
              )}
            </WorkspacePanel>

            <WorkspacePanel
              title="Where these records live"
              description="Cohorts, groups and modules are managed across the whole curriculum on their own pages. This workspace is the programme-scoped view of them, not a second catalogue — these links open the same records filtered to this programme."
            >
              <div className="grid gap-3 sm:grid-cols-3">
                <RecordHomeLink
                  icon="ri-calendar-event-line"
                  label={liveCohortCount === 1 ? 'cohort' : 'cohorts'}
                  count={liveCohortCount}
                  hint="Cohorts page, filtered to this programme"
                  to={`/curriculum/cohorts?programme=${encodeURIComponent(drawerProgrammeId)}`}
                />
                <RecordHomeLink
                  icon="ri-team-line"
                  label={totalGroups === 1 ? 'group' : 'groups'}
                  count={totalGroups}
                  hint="Groups page, filtered to this programme"
                  to={`/curriculum/groups?programme=${encodeURIComponent(drawerProgrammeId)}`}
                />
                <RecordHomeLink
                  icon="ri-stack-line"
                  label={PROGRAMME.modules.length === 1 ? 'module' : 'modules'}
                  count={PROGRAMME.modules.length}
                  hint="Module Builder catalogue, filtered to this programme"
                  to={moduleBuilderProgrammeUrl}
                />
              </div>
            </WorkspacePanel>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════
            Delivery — cohorts, and the groups under the one being read
        ═══════════════════════════════════════════════════════════════════ */}
        {tab === 'cohorts' && (
          <div className="space-y-5">
            <EntityFilterBar
              search={cohortSearch}
              onSearch={setCohortSearch}
              placeholder="Search cohorts, dates, status..."
              selects={[{
                label: 'Status',
                value: cohortStatusFilter,
                onChange: setCohortStatusFilter,
                options: [
                  { value: '', label: 'All statuses' },
                  { value: 'planned', label: 'Planned' },
                  { value: 'active', label: 'Active' },
                  { value: 'completed', label: 'Completed' },
                  // Surfaced with its count so an archived cohort is discoverable
                  // instead of looking like missing data.
                  ...(archivedCohortCount > 0 ? [{ value: 'archived', label: `Archived (${archivedCohortCount})` }] : []),
                ],
              }]}
              onReset={() => { setCohortSearch(''); setCohortStatusFilter(''); }}
              disabled={!PROGRAMME.cohorts.length}
              summary={cohortStatusFilter === 'archived'
                ? `Showing ${filteredCohorts.length} of ${archivedCohortCount} archived cohorts`
                : `Showing ${filteredCohorts.length} of ${liveCohortCount} cohorts${archivedCohortCount > 0 ? ` · ${archivedCohortCount} archived` : ''}`}
              trailing={PROGRAMME.cohorts.length ? (
                <button
                  type="button"
                  onClick={() => setCohortDrawerOpen(true)}
                  className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-primary-600 px-3 text-[12px] font-bold text-white transition-smooth hover:bg-primary-700"
                >
                  <AppIcon className="ri-add-line text-sm"></AppIcon>
                  Add cohort
                </button>
              ) : undefined}
            />

            <EntityTable
              columns={[
                { label: 'Cohort' },
                { label: 'Practical period' },
                { label: 'Apprenticeship end' },
                { label: 'Learners', align: 'center' },
                { label: 'Groups', align: 'center' },
                { label: 'Coached', align: 'center' },
                { label: 'Actions', align: 'right' },
              ]}
              gridClass={COHORT_GRID}
              rows={filteredCohorts}
              rowKey={cohortItem => cohortItem.id}
              getRowHref={cohortItem => `/curriculum/cohorts/${encodeURIComponent(cohortItem.id)}`}
              loading={loading && !PROGRAMME.cohorts.length}
              refreshing={refreshing}
              empty={(
                <EntityEmptyState
                  icon={PROGRAMME.cohorts.length ? 'ri-filter-off-line' : 'ri-group-line'}
                  title={PROGRAMME.cohorts.length ? 'No cohorts match these filters' : 'No cohorts yet'}
                  message={PROGRAMME.cohorts.length
                    ? 'Clear a filter, or search for a different cohort.'
                    : 'Cohorts define when a group of learners starts and finishes this programme. Add the first one to begin planning delivery.'}
                  action={PROGRAMME.cohorts.length ? undefined : { label: 'Add cohort', onClick: () => setCohortDrawerOpen(true) }}
                />
              )}
              renderRow={cohortItem => {
                const coached = cohortItem.groups.filter(group => isStaffAssigned(group.coach)).length;
                const selected = cohortItem.id === selectedCohort;
                return (
                  <>
                    <StackedCell
                      href={`/curriculum/cohorts/${encodeURIComponent(cohortItem.id)}`}
                      primary={(
                        <span className="flex items-center gap-2">
                          {selected && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary-600" aria-hidden="true" />}
                          {cohortItem.name}
                        </span>
                      )}
                      secondary={cohortItem.status}
                    />
                    <PlainCell>{[cohortItem.startDate, cohortItem.endDate].filter(Boolean).join(' – ') || '—'}</PlainCell>
                    <PlainCell>
                      {cohortItem.apprenticeshipEndDate || '—'}
                      {cohortItem.apprenticeshipEndDate && (
                        <span className="ml-1 text-[10px] font-bold uppercase text-foreground-400">
                          {cohortItem.apprenticeshipEndIsManual ? 'set' : cohortItem.epaMonths ? `${cohortItem.epaMonths}m EPA` : ''}
                        </span>
                      )}
                    </PlainCell>
                    <PlainCell align="center">{cohortItem.learners}</PlainCell>
                    <PlainCell align="center">{cohortItem.groups.length}</PlainCell>
                    <PlainCell align="center">
                      <span className={coached === cohortItem.groups.length ? 'font-bold text-emerald-700' : 'font-bold text-amber-700'}>
                        {coached}/{cohortItem.groups.length}
                      </span>
                    </PlainCell>
                    <span className="flex items-center justify-end gap-1.5">
                      <NamedActions
                        actions={[{
                          icon: 'ri-team-line',
                          label: 'Groups',
                          title: `Open the groups in ${cohortItem.name}`,
                          primary: selected,
                          onClick: () => {
                            setSelectedCohort(cohortItem.id);
                            setSelectedGroup('');
                            setTab('groups');
                          },
                        }]}
                      />
                      <RowActions
                        actions={[
                          { icon: 'ri-edit-line', label: 'Edit cohort', onClick: () => openEditCohort(cohortItem.id) },
                          { icon: 'ri-archive-line', label: 'Archive cohort', tone: 'danger', onClick: () => void archiveCohort(cohortItem) },
                        ]}
                      />
                    </span>
                  </>
                );
              }}
            />
          </div>
        )}

        {tab === 'groups' && (
          <div className="space-y-5">
            <EntityFilterBar
              search={groupSearch}
              onSearch={setGroupSearch}
              placeholder="Search groups, coaches, days or mode..."
              selects={[
                {
                  label: 'Cohort',
                  value: activeCohort?.id || '',
                  onChange: value => { setSelectedCohort(value); setSelectedGroup(''); },
                  options: groupCohorts.length
                    ? groupCohorts.map(item => ({ value: item.id, label: `${item.name} · ${item.groups.length} groups` }))
                    : [{ value: '', label: 'No cohorts yet' }],
                  disabled: !groupCohorts.length,
                  disabledHint: 'Add a cohort before filtering groups.',
                },
                {
                  label: 'Coaching',
                  value: groupCoachFilter,
                  onChange: setGroupCoachFilter,
                  options: [
                    { value: '', label: 'All coaching states' },
                    { value: 'assigned', label: 'Coach assigned' },
                    { value: 'unassigned', label: 'Needs a coach' },
                  ],
                  disabled: !activeCohort?.groups.length,
                  disabledHint: activeCohort
                    ? 'Add a group before filtering by coaching status.'
                    : 'Choose or create a cohort first.',
                },
              ]}
              onReset={() => { setGroupSearch(''); setGroupCoachFilter(''); }}
              searchDisabled={!activeCohort?.groups.length}
              isDirty={Boolean(activeCohort?.groups.length && (groupSearch || groupCoachFilter))}
              summary={activeCohort
                ? `Showing ${filteredGroups.length} of ${activeCohort.groups.length} groups in ${activeCohort.name}`
                : 'Showing 0 groups · add a cohort first'}
              trailing={activeCohort && activeCohort.groups.length ? (
                <button
                  type="button"
                  onClick={() => setGroupDrawerCohortId(activeCohort.id)}
                  className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-primary-600 px-3 text-[12px] font-bold text-white transition-smooth hover:bg-primary-700"
                >
                  <AppIcon className="ri-add-line text-sm"></AppIcon>
                  Add group
                </button>
              ) : undefined}
            />

            {activeCohort && (
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-[13px] font-heading font-bold text-foreground-950">Groups in {activeCohort.name}</h3>
                  <p className="mt-0.5 text-[12px] text-foreground-500">
                    Open a group to manage its learners, or add its first module to continue building the programme.
                  </p>
                </div>
              </div>
            )}

            <EntityTable
                  columns={[
                    { label: 'Group' },
                    { label: 'Coach' },
                    { label: 'Delivery' },
                    { label: 'Learners', align: 'center' },
                    { label: 'Modules', align: 'center' },
                    { label: 'Actions', align: 'right' },
                  ]}
                  gridClass={GROUP_GRID}
                  rows={filteredGroups}
                  rowKey={group => group.id}
                  getRowHref={group => namedCurriculumWorkspacePath('groups', group.id, group.name)}
                  refreshing={refreshing}
                  empty={activeCohort ? (
                    <EntityEmptyState
                      icon={activeCohort.groups.length ? 'ri-filter-off-line' : 'ri-team-line'}
                      title={activeCohort.groups.length ? 'No groups match these filters' : 'This cohort has no groups'}
                      message={activeCohort.groups.length
                        ? 'Clear a filter, or search for a different group.'
                        : 'Groups carry the weekly timetable and the coach who supports it. Add the first one to start scheduling.'}
                      action={activeCohort.groups.length ? undefined : { label: 'Add group', onClick: () => setGroupDrawerCohortId(activeCohort.id) }}
                    />
                  ) : (
                    <EntityEmptyState
                      icon="ri-group-line"
                      title="Add a cohort before creating groups"
                      message="Groups always belong to a cohort. Create the programme's first cohort, then return here to add its delivery groups."
                      action={{ label: 'Add first cohort', onClick: () => setCohortDrawerOpen(true) }}
                    />
                  )}
                  renderRow={group => (
                    <>
                      <StackedCell
                        href={namedCurriculumWorkspacePath('groups', group.id, group.name)}
                        primary={group.name}
                        secondary={activeCohort ? groupDatesLabel(activeCohort) : undefined}
                      />
                      <StaffSlot
                        role="Coach"
                        icon="ri-heart-line"
                        name={group.coach}
                        options={data?.coaches || []}
                        saving={savingAction === `coach:${group.id}`}
                        onAssign={value => assignGroupCoach(group.id, value)}
                      />
                      {/* The mode alone is not a delivery pattern: every group
                          defaults to Live, so "Live" on its own read as though a
                          day and time had been set. */}
                      <PlainCell>
                        {clean(group.schedule)
                          ? [group.schedule, group.mode].map(value => clean(value)).filter(Boolean).join(' · ')
                          : 'Not scheduled'}
                      </PlainCell>
                      <PlainCell align="center">{group.learners}</PlainCell>
                      <PlainCell align="center">{group.modules.length}</PlainCell>
                      <span className="flex items-center justify-end gap-1.5">
                        <NamedActions
                          actions={[
                            {
                              icon: 'ri-add-line',
                              label: group.modules.length ? 'Add module' : 'Add first module',
                              title: `Create a module for ${group.name}`,
                              primary: group.modules.length === 0,
                              onClick: () => navigate(moduleBuilderGroupUrl(activeCohort?.id || '', group.id)),
                            },
                            {
                              icon: group.id === selectedGroup ? 'ri-eye-line' : 'ri-graduation-cap-line',
                              label: 'Learners',
                              title: group.id === selectedGroup
                                ? `${group.name}'s learners are shown below`
                                : `Show the learners enrolment has assigned to ${group.name}`,
                              disabled: group.id === selectedGroup,
                              onClick: () => setSelectedGroup(group.id),
                            },
                          ]}
                        />
                        <RowActions
                          actions={[
                            { icon: 'ri-edit-line', label: 'Edit group', onClick: () => openEditGroup(group.id, activeCohort?.id || '') },
                            { icon: 'ri-archive-line', label: 'Archive group', tone: 'danger', onClick: () => void archiveGroup(group) },
                          ]}
                        />
                      </span>
                    </>
                  )}
                />

            {activeCohort && activeGroup && (
              <>
                <WorkspacePanel
                  title={`Learners in ${activeGroup.name}`}
                  description="Everyone the enrolment team placed in this group. Curriculum owns the delivery structure, not the placements, so the roster is read-only — open a learner to see what they have achieved here."
                  actions={(
                    <button
                      type="button"
                      onClick={() => setSelectedGroup('')}
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-background-200 bg-background-50 px-3 text-[12px] font-bold text-foreground-600 transition-smooth hover:bg-background-100"
                    >
                      <AppIcon className="ri-close-line text-sm"></AppIcon>
                      Hide
                    </button>
                  )}
                >
                  <EnrolledLearnersPanel
                    roster={learnerRoster}
                    loading={learnerRosterLoading}
                    error={learnerRosterError}
                    selectedLearnerId={selectedLearner ? String(selectedLearner.id) : ''}
                    onSelectLearner={setSelectedLearner}
                    emptyHint={`No learners have been assigned to ${activeGroup.name} by the enrolment team yet.`}
                  />
                </WorkspacePanel>

                {/* One learner, scoped to this group. The same
                    `learner-ksb-impact` read the Achievement tab uses, asked
                    for at the group and narrowed to the person clicked, so
                    the hours and KSB weight here are the same figures that
                    tab sums rather than a second calculation of them. */}
                {selectedLearner && (
                  <ScopeLearnerAchievementDetail
                    key={`${activeGroup.id}:${selectedLearner.id}`}
                    scope="group"
                    identifier={activeGroup.id}
                    learnerId={String(selectedLearner.id)}
                    learnerName={selectedLearner.name}
                    learnerEmail={selectedLearner.email}
                    scopeLabel={activeGroup.name}
                    onClose={() => setSelectedLearner(null)}
                  />
                )}
              </>
            )}
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════
            Modules — every module at once; each one opens its own workspace
        ═══════════════════════════════════════════════════════════════════ */}
        {tab === 'modules' && (
          <div className="space-y-5">
            <EntityFilterBar
              search={moduleSearch}
              onSearch={setModuleSearch}
              placeholder="Search modules, cohort, group, tutor, KSB..."
              selects={[
                {
                  label: 'Cohort',
                  value: moduleCohortFilter,
                  onChange: setModuleCohortFilter,
                  options: [{ value: '', label: 'All cohorts' }, ...moduleCohorts.map(name => ({ value: name, label: name }))],
                },
                {
                  label: 'Group',
                  value: moduleGroupFilter,
                  onChange: setModuleGroupFilter,
                  options: [{ value: '', label: 'All groups' }, ...moduleGroups.map(name => ({ value: name, label: name }))],
                },
              ]}
              onReset={() => { setModuleSearch(''); setModuleCohortFilter(''); setModuleGroupFilter(''); }}
              disabled={!PROGRAMME.modules.length}
              summary={`Showing ${filteredModules.length} of ${PROGRAMME.modules.length} modules · content, Teams meetings and KSB weights open in the module · Archive takes a module off this list and keeps its content — modules are never deleted`}
            />

            <EntityTable
              columns={[
                { label: 'Module' },
                { label: 'Cohort / Group' },
                { label: 'Tutor' },
                { label: 'Weeks', align: 'center' },
                { label: 'Components', align: 'center' },
                { label: 'OTJH', align: 'center' },
                { label: 'KSBs', align: 'center' },
                { label: 'Actions', align: 'right' },
              ]}
              gridClass={MODULE_GRID}
              rows={filteredModules}
              rowKey={mod => mod.id}
              getRowHref={mod => moduleWorkspaceUrl(mod) || undefined}
              loading={loading && !PROGRAMME.modules.length}
              refreshing={refreshing}
              empty={(
                <EntityEmptyState
                  icon={PROGRAMME.modules.length ? 'ri-filter-off-line' : 'ri-stack-line'}
                  title={PROGRAMME.modules.length ? 'No modules match these filters' : 'No modules yet'}
                  message={PROGRAMME.modules.length
                    ? 'Clear a filter, or search for a different module.'
                    : 'Modules carry the weekly content, sessions and OTJH for this programme. Create and author the first one in Module Builder.'}
                  action={PROGRAMME.modules.length ? undefined : { label: 'Open Module Builder', onClick: () => navigate(moduleBuilderProgrammeUrl) }}
                />
              )}
              renderRow={mod => {
                const componentCount = mod.weeksData.reduce((total, wk) => total + (wk.components?.length || 0), 0);
                const ksbCount = uniqueCleanValues([...mod.ksbTags, ...mod.ksbMapping.map(item => item.ksb)]).length;
                const workspaceUrl = moduleWorkspaceUrl(mod);
                const unlinked = unlinkedModules.some(item => item.id === mod.id);
                return (
                  <>
                    <StackedCell
                      href={workspaceUrl || undefined}
                      primary={mod.name}
                      secondary={moduleDatesLabel(mod)}
                    />
                    <StackedCell
                      primary={(
                        <span className="flex items-center gap-1.5">
                          {clean(mod.cohort, 'No cohort')}
                          {unlinked && (
                            <span
                              title="This cohort is not a cohort record on this programme."
                              className="rounded-full border border-rose-200 bg-rose-50 px-1.5 text-[9px] font-bold uppercase text-rose-700"
                            >
                              unlinked
                            </span>
                          )}
                        </span>
                      )}
                      secondary={clean(mod.group, 'No group')}
                    />
                    <PlainCell>
                      {isStaffAssigned(mod.tutor)
                        ? clean(mod.tutor)
                        : <span className="font-bold text-amber-700">Unassigned</span>}
                    </PlainCell>
                    <PlainCell align="center">{mod.weeksData.length || mod.weeks || 0}</PlainCell>
                    <PlainCell align="center">{componentCount}</PlainCell>
                    <PlainCell align="center">{formatHours(mod.otjh)}h</PlainCell>
                    <PlainCell align="center">{ksbCount}</PlainCell>
                    <span className="flex items-center justify-end gap-1.5">
                      <NamedActions
                        actions={[{
                          icon: 'ri-tools-line',
                          label: 'Builder',
                          title: `Author ${mod.name}'s weeks and components in the Module Builder`,
                          onClick: () => navigate(moduleBuilderUrl(mod, PROGRAMME)),
                        }]}
                      />
                      <RowActions
                        actions={[
                          { icon: 'ri-edit-line', label: 'Edit module', onClick: () => openEditModule(mod) },
                          { icon: 'ri-archive-line', label: 'Archive module', tone: 'danger', onClick: () => void archiveModule(mod) },
                        ]}
                      />
                    </span>
                  </>
                );
              }}
            />

            {hasMinimumDesign && (
              <div className="flex flex-col gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 sm:flex-row sm:items-center">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white">
                    <AppIcon className="ri-check-line"></AppIcon>
                  </span>
                  <div>
                    <p className="text-[12px] font-extrabold text-emerald-950">Design foundation ready</p>
                    <p className="mt-0.5 text-[11px] leading-5 text-emerald-800">This programme has a module, an authored week and learner-facing content. You can now review its KSB coverage.</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════
            Sessions — every live session and recording across every module
        ═══════════════════════════════════════════════════════════════════ */}
        {tab === 'sessions' && (
          <div className="space-y-5">
            <div className="flex flex-col gap-3 rounded-2xl border border-foreground-200/60 bg-background-50 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="inline-flex rounded-xl border border-background-200 bg-background-100 p-1">
                {([
                  { kind: 'live' as const, label: 'Live', icon: 'ri-broadcast-line', count: liveSessions.length },
                  { kind: 'recorded' as const, label: 'Recorded', icon: 'ri-film-line', count: recordedSessions.length },
                ]).map(option => (
                  <button
                    key={option.kind}
                    type="button"
                    onClick={() => setSessionKind(option.kind)}
                    aria-pressed={sessionKind === option.kind}
                    className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-[12px] font-bold transition-smooth ${
                      sessionKind === option.kind ? 'bg-primary-600 text-white shadow-sm' : 'text-foreground-600 hover:text-foreground-900'
                    }`}
                  >
                    <AppIcon className={`${option.icon} text-sm`}></AppIcon>
                    {option.label}
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${sessionKind === option.kind ? 'bg-white/20 text-white' : 'bg-foreground-100 text-foreground-500'}`}>
                      {option.count}
                    </span>
                  </button>
                ))}
              </div>
              <p className="text-[12px] leading-5 text-foreground-500 sm:max-w-md sm:text-right">
                {sessionKind === 'live'
                  ? 'Microsoft Teams sessions across every module on this programme. Attendance and recordings are fetched in the module that owns the meeting.'
                  : 'Recorded learning across every module on this programme, with its provider and watch requirements.'}
              </p>
            </div>

            {sessionKind === 'live' && missingMeetingCount > 0 && (
              // Every authored week plans its own live session, so a week with no
              // Teams meeting is a real gap rather than a row that doesn't exist.
              // The count is the placeholder rows in the tree below, not a separate
              // calculation, so the summary and the list can never disagree.
              <p className="rounded-lg border border-amber-200/60 bg-amber-50 px-3 py-2 text-[12px] text-amber-700">
                {missingMeetingCount} of {liveSessions.length} planned session{liveSessions.length === 1 ? '' : 's'} on this programme
                {missingMeetingCount === 1 ? ' has' : ' have'} no Teams meeting yet — each is listed below against the week that needs one.
              </p>
            )}

            <EntityFilterBar
              search={sessionSearch}
              onSearch={setSessionSearch}
              placeholder={sessionKind === 'live' ? 'Search sessions, dates, groups or KSBs...' : 'Search videos, providers, modules or KSBs...'}
              selects={[{
                label: 'Module',
                value: sessionModuleFilter,
                onChange: setSessionModuleFilter,
                options: [{ value: '', label: 'All modules' }, ...sessionModules.map(name => ({ value: name, label: name }))],
              }]}
              onReset={() => { setSessionSearch(''); setSessionModuleFilter(''); }}
              summary={`${filteredSessions.length} ${sessionKind === 'live' ? 'live session' : 'recording'}${filteredSessions.length === 1 ? '' : 's'} across ${new Set(filteredSessions.map(session => session.module)).size} module${new Set(filteredSessions.map(session => session.module)).size === 1 ? '' : 's'}`}
              trailing={(
                <button
                  type="button"
                  onClick={() => { void reload({ silent: true }); void loadLiveOccurrences({ skipCache: true }); }}
                  disabled={occurrencesLoading || refreshing}
                  className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-background-200 bg-background-50 px-3 text-[12px] font-bold text-foreground-700 transition-smooth hover:bg-background-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <AppIcon className={`${occurrencesLoading || refreshing ? 'ri-loader-4-line animate-spin' : 'ri-refresh-line'} text-sm`}></AppIcon>
                  Refresh
                </button>
              )}
            />

            {loading && !deliverySessions.length ? (
              <div className="flex items-center justify-center gap-2 rounded-2xl border border-foreground-200/60 bg-background-50 px-4 py-10 text-[12px] text-foreground-500">
                <AppIcon className="ri-loader-4-line animate-spin text-base"></AppIcon>
                Loading sessions…
              </div>
            ) : (
              <SessionsTree
                sessions={filteredSessions}
                moduleHrefFor={sessionModuleHref}
                // Skip the cache: the sync has just written new occurrence rows,
                // and a cached read would answer with the pre-sync ones.
                onSynced={() => { void loadLiveOccurrences({ skipCache: true }); }}
                empty={(
                  <EntityEmptyState
                    icon={activeSessions.length ? 'ri-filter-off-line' : sessionKind === 'live' ? 'ri-broadcast-line' : 'ri-film-line'}
                    title={activeSessions.length
                      ? 'No rows match these filters'
                      : sessionKind === 'live' ? 'No live sessions yet' : 'No recorded videos yet'}
                    message={activeSessions.length
                      ? 'Clear a filter, or search for a different session.'
                      : sessionKind === 'live'
                        ? 'Add a Live Teams Session component to a week in the Module Builder and it will appear here.'
                        : 'Add a Video component to a week in the Module Builder and it will appear here.'}
                  />
                )}
              />
            )}
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════
            KSB coverage — the programme-wide roll-up, which exists nowhere else
        ═══════════════════════════════════════════════════════════════════ */}
        {tab === 'coverage' && (
          <WorkspacePanel
            title="KSB coverage heatmap"
            description="Component KSB mappings rolled up into weeks, modules and programme coverage. An empty cell means the KSB is not addressed in that module."
            /* One action, because there is one thing to do from here: the
               weights, the mappings and the authored durations all live in the
               Module Builder. The detail drawer and the global worklist were
               second and third readings of the table already on this page. */
            actions={(
              <button
                type="button"
                onClick={() => navigate(moduleBuilderProgrammeUrl)}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary-600 px-3 text-[12px] font-bold text-white transition-smooth hover:bg-primary-700"
              >
                <AppIcon className="ri-tools-line text-sm"></AppIcon>
                Open module builder
              </button>
            )}
          >
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-2 rounded-lg border border-primary-200 bg-primary-50 px-3 py-1.5 text-[11px] font-bold text-primary-700">
                <AppIcon className="ri-bookmark-3-line text-sm"></AppIcon>
                {coverageKsbSource.sourceId
                  ? [
                    `KSBs from: ${coverageKsbSourceDetail.name || coverageKsbSourceLabel || coverageKsbSource.sourceId}`,
                    coverageKsbSourceDetail.kindLabel,
                    coverageKsbSourceDetail.reference,
                  ].filter(Boolean).join(' · ')
                  : 'No KSB source applied to this programme'}
              </span>
            </div>

            {/* The filter comes before the numbers, because it decides what
                they are numbers of. */}
            <div className="mb-4">
              <DeliveryScopeFilter
                cohorts={PROGRAMME.cohorts}
                cohortId={coverageCohortId}
                groupId={coverageGroupId}
                summary={`${coverageModuleNames.length} ${coverageModuleNames.length === 1 ? 'module' : 'modules'}`}
                onChange={next => {
                  setCoverageCohortId(next.cohortId);
                  setCoverageGroupId(next.groupId);
                  setCoverageExpandedRow('');
                }}
              />
            </div>

            {backendCoverageLoading ? (
              <div className="rounded-xl border border-background-200 bg-background-100 px-4 py-8 text-center text-[12px] font-semibold text-foreground-600">
                <AppIcon className="ri-loader-4-line mr-2 animate-spin text-primary-600"></AppIcon>
                Loading KSB coverage…
              </div>
            ) : backendCoverageError ? (
              <InlineError
                message={`Unable to load actual backend KSB coverage. No fallback or sample KSB data is being shown. ${backendCoverageError}`}
                onRetry={() => { void loadBackendCoverage(); }}
              />
            ) : PROGRAMME.ksbHeatmap.length === 0 ? (
              <EntityEmptyState
                icon="ri-node-tree"
                title="No KSB coverage data returned"
                message="The backend did not return any heatmap rows for this programme, so no fallback or sample KSB data is being shown."
                action={{ label: 'Retry', onClick: () => { void loadBackendCoverage(); } }}
              />
            ) : (
              <>
                <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[
                    { label: 'Taught', value: coverageTaughtCount, note: 'placed on at least one component', tone: 'border-emerald-100 bg-emerald-50 text-emerald-700' },
                    { label: 'Missing', value: coverageMissingCount, note: 'nowhere to be taught here', tone: 'border-amber-100 bg-amber-50 text-amber-700' },
                    { label: 'Total weight', value: `${formatHours(coverageWeightTotal)}%`, note: 'summed across every placement', tone: 'border-sky-100 bg-sky-50 text-sky-700' },
                    { label: 'Placements', value: coveragePlacementTotal, note: 'components carrying a KSB', tone: 'border-primary-100 bg-primary-50 text-primary-700' },
                  ].map(stat => (
                    <div key={stat.label} className={`rounded-xl border px-4 py-3 ${stat.tone}`}>
                      <p className="text-[10px] font-bold uppercase tracking-wider">{stat.label}</p>
                      <p className="mt-1 text-lg font-heading font-bold">{stat.value}</p>
                      <p className="mt-0.5 text-[10px] font-semibold opacity-70">{stat.note}</p>
                    </div>
                  ))}
                </div>

                <div className="mb-4 flex flex-wrap items-center gap-2">
                  {/* Taught / Missing is a fact about a KSB, so it stands down
                      in the component view rather than sitting there filtering
                      rows nobody is looking at. */}
                  {coverageView !== 'components' && (
                  <div className="flex items-center gap-1 rounded-xl border border-background-200 bg-background-100/70 p-1">
                    {([
                      { key: 'all', label: 'All KSBs', count: coverageScopedRows.length },
                      { key: 'taught', label: 'Taught', count: coverageTaughtCount },
                      { key: 'missing', label: 'Missing', count: coverageMissingCount },
                    ] as Array<{ key: 'all' | 'taught' | 'missing'; label: string; count: number }>).map(item => (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => setCoverageStanding(item.key)}
                        className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[12px] font-bold transition-smooth ${
                          coverageStanding === item.key
                            ? item.key === 'missing'
                              ? 'bg-amber-500 text-white'
                              : item.key === 'taught'
                                ? 'bg-emerald-600 text-white'
                                : 'bg-foreground-800 text-white'
                            : 'text-foreground-600 hover:bg-background-50'
                        }`}
                      >
                        {item.label}
                        <span className="rounded bg-black/10 px-1 text-[10px] tabular-nums">{item.count}</span>
                      </button>
                    ))}
                  </div>
                  )}
                  <span className="relative min-w-[200px] flex-1">
                    <AppIcon className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-sm text-foreground-400"></AppIcon>
                    <input
                      value={ksbSearch}
                      onChange={event => setKsbSearch(event.target.value)}
                      placeholder={coverageView === 'components'
                        ? 'Search component, module, week or KSB...'
                        : 'Search KSB code or outcome...'}
                      className="h-9 w-full rounded-lg border border-background-200 bg-background-50 pl-9 pr-3 text-[12px] text-foreground-900 outline-none transition-smooth focus:border-primary-300"
                    />
                  </span>
                  {/* Three readings of the same scoped rows. Lit is where you
                      are, not where the button will take you \u2014 with three of
                      them, naming the destination stops telling you which one
                      you are looking at. */}
                  <div className="flex items-center gap-1 rounded-xl border border-background-200 bg-background-100/70 p-1">
                    {([
                      { key: 'list', label: 'KSB list', icon: 'ri-list-check-3', hint: 'Every KSB, its total weight, and each component that carries it.' },
                      { key: 'components', label: 'By component', icon: 'ri-stack-line', hint: 'The inverse: every component, and which KSBs are placed inside it.' },
                      { key: 'matrix', label: 'Matrix', icon: 'ri-grid-line', hint: 'The KSB by module grid, for a read across the whole programme at once.' },
                    ] as Array<{ key: 'list' | 'components' | 'matrix'; label: string; icon: string; hint: string }>).map(item => (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => setCoverageView(item.key)}
                        aria-pressed={coverageView === item.key}
                        title={item.hint}
                        className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[12px] font-bold transition-smooth ${
                          coverageView === item.key ? 'bg-primary-600 text-white' : 'text-foreground-600 hover:bg-background-50'
                        }`}
                      >
                        <AppIcon className={item.icon}></AppIcon>
                        {item.label}
                      </button>
                    ))}
                  </div>
                  {coverageView === 'components' && (
                    <button
                      type="button"
                      onClick={() => setComponentPickerOpen(value => !value)}
                      aria-pressed={componentPickerOpen}
                      title="Show only a component or two you pick, instead of every one in view."
                      className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-[12px] font-bold transition-smooth ${
                        pickedComponentIds.length || componentPickerOpen
                          ? 'border-primary-300 bg-primary-50 text-primary-700'
                          : 'border-background-200 bg-background-50 text-foreground-600 hover:bg-background-100'
                      }`}
                    >
                      <AppIcon className="ri-checkbox-multiple-line"></AppIcon>
                      Pick components
                      {pickedComponentIds.length > 0 && (
                        <span className="rounded-full bg-primary-600 px-1.5 text-[10px] font-bold text-white">{pickedComponentIds.length}</span>
                      )}
                    </button>
                  )}
                  <span className="text-[11px] font-semibold text-foreground-400">
                    {coverageView === 'components'
                      ? `${filteredCoverageComponents.length} of ${coverageComponents.length} components`
                      : `${filteredKsbHeatmap.length} of ${coverageScopedRows.length} KSBs`}
                  </span>
                </div>

                {coverageView === 'components' && componentPickerOpen && (
                  <ComponentPickerPanel
                    components={coverageComponents}
                    pickedIds={pickedComponentIds}
                    onToggle={id => setPickedComponentIds(ids => (
                      ids.includes(id) ? ids.filter(existing => existing !== id) : [...ids, id]
                    ))}
                    onClear={() => setPickedComponentIds([])}
                    onClose={() => setComponentPickerOpen(false)}
                  />
                )}

                {coverageView === 'components' && !componentPickerOpen && pickedComponentIds.length > 0 && (
                  <div className="mb-3 flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-foreground-400">Showing only:</span>
                    {pickedComponentIds.map(id => {
                      const group = coverageComponents.find(item => item.id === id);
                      if (!group) return null;
                      return (
                        <span
                          key={id}
                          className="inline-flex items-center gap-1 rounded-full border border-primary-200 bg-primary-50 py-0.5 pl-2.5 pr-1.5 text-[10px] font-bold text-primary-700"
                        >
                          {group.component}
                          <button
                            type="button"
                            onClick={() => setPickedComponentIds(ids => ids.filter(existing => existing !== id))}
                            title={`Stop showing ${group.component} on its own`}
                            className="flex h-4 w-4 items-center justify-center rounded-full hover:bg-primary-200"
                          >
                            <AppIcon className="ri-close-line text-[11px]"></AppIcon>
                          </button>
                        </span>
                      );
                    })}
                    <button
                      type="button"
                      onClick={() => setPickedComponentIds([])}
                      className="text-[10px] font-bold text-foreground-400 underline decoration-dotted hover:text-foreground-700"
                    >
                      Show all {coverageComponents.length}
                    </button>
                  </div>
                )}

                {coverageView === 'components' ? (
                  filteredCoverageComponents.length === 0 ? (
                    <EntityEmptyState
                      icon="ri-stack-line"
                      title={coverageComponents.length ? 'No component matches this search' : 'No component in view carries a KSB'}
                      message={coverageComponents.length
                        ? 'Clear the search, or widen the cohort and group above.'
                        : 'Map KSBs onto components in the Module Builder and they will be listed here.'}
                    />
                  ) : (
                    <KsbComponentTable
                      groups={filteredCoverageComponents}
                      expandedId={coverageComponentId}
                      onToggle={setCoverageComponentId}
                      onPreview={group => setPlacementPreview({ placement: group.placement, ksb: group.ksbs[0]?.ksb || '' })}
                    />
                  )
                ) : filteredKsbHeatmap.length === 0 ? (
                  <EntityEmptyState
                    icon="ri-list-check-3"
                    title="No KSB matches this filter"
                    message="Clear the search, switch back to All KSBs, or widen the cohort and group above."
                  />
                ) : coverageView === 'matrix' ? (
                  // In place of the list, not underneath it: appended, the grid
                  // opened 71 rows below the button that opened it, so the
                  // toggle looked like it had done nothing at all.
                  <>
                    <KsbHeatmapLegend />
                    <KsbHeatmapMatrix rows={filteredKsbHeatmap} moduleNames={coverageModuleNames} />
                  </>
                ) : (
                  <KsbCoverageTable
                    rows={filteredKsbHeatmap}
                    moduleNames={coverageModuleNames}
                    scopeByLabel={moduleScopeByLabel}
                    expandedRowId={coverageExpandedRow}
                    onToggleRow={setCoverageExpandedRow}
                    onPreviewPlacement={(placement, ksb) => setPlacementPreview({ placement, ksb })}
                  />
                )}
              </>
            )}
          </WorkspacePanel>
        )}

        {/* ═══════════════════════════════════════════════════════════════════
            Achievement — what the learners actually earned, at any level
        ═══════════════════════════════════════════════════════════════════ */}
        {tab === 'achievement' && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-background-200 bg-background-100/70 p-3">
              <ScopePicker
                programme={PROGRAMME}
                value={achievementScope}
                onChange={setAchievementScope}
              />
            </div>

            <ScopeAchievementPanel
              key={`${achievementScope.scope}:${achievementScope.identifier}`}
              scope={achievementScope.scope}
              identifier={achievementScope.identifier}
              title={`${achievementScope.label} — learner achievement`}
              description={achievementScope.description}
              learnerStatus="all"
              active
              onPreviewCredit={(credit: KsbCredit, ksbCode: string) => setPlacementPreview({
                placement: {
                  module: credit.module,
                  moduleLabel: credit.module,
                  scope: 'component',
                  week: credit.week,
                  component: credit.component,
                  weight: credit.weight,
                  cohortName: '',
                  groupName: '',
                },
                ksb: ksbCode,
                moduleKnownDeleted: credit.moduleStatus === 'deleted' || credit.moduleStatus === 'unknown',
              })}
            />
          </div>
        )}

        {tab === 'quality' && (
          <div className="space-y-5">
            <WorkspacePanel
              title="Programme quality checks"
              description="These checks come from the programme's current structure, content, staffing and KSB mappings. They do not imply an approval or publishing state."
              actions={(
                <button type="button" onClick={() => void reload({ silent: true })} disabled={refreshing} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-foreground-200 bg-background-50 px-3 text-[12px] font-bold text-foreground-700 transition-smooth hover:bg-background-100 disabled:opacity-60">
                  <AppIcon className={refreshing ? 'ri-loader-4-line animate-spin' : 'ri-refresh-line'}></AppIcon>
                  Refresh checks
                </button>
              )}
            >
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                <QualityCheckCard
                  title="KSB mapping"
                  count={missingKsbCount}
                  clearText="Every KSB is mapped"
                  issueText={`${missingKsbCount} ${missingKsbCount === 1 ? 'KSB has' : 'KSBs have'} nowhere to be taught`}
                  icon="ri-node-tree"
                  onClick={() => goToTab('coverage')}
                />
                <QualityCheckCard
                  title="Week content"
                  count={emptyWeekCount}
                  clearText="Every week has content"
                  issueText={`${emptyWeekCount} ${emptyWeekCount === 1 ? 'week is' : 'weeks are'} empty`}
                  icon="ri-calendar-close-line"
                  onClick={() => navigate(moduleBuilderProgrammeUrl)}
                />
                <QualityCheckCard
                  title="Tutor assignment"
                  count={untutoredModules.length}
                  clearText="Every module has a tutor"
                  issueText={`${untutoredModules.length} ${untutoredModules.length === 1 ? 'module needs' : 'modules need'} a tutor`}
                  icon="ri-user-settings-line"
                  onClick={() => goToTab('modules')}
                />
                <QualityCheckCard
                  title="Coach assignment"
                  count={unstaffedGroupCount}
                  clearText="Every group has a coach"
                  issueText={`${unstaffedGroupCount} ${unstaffedGroupCount === 1 ? 'group needs' : 'groups need'} a coach`}
                  icon="ri-user-search-line"
                  onClick={() => goToTab('groups')}
                />
                <QualityCheckCard
                  title="Delivery links"
                  count={unlinkedModules.length}
                  clearText="Every module is linked to delivery"
                  issueText={`${unlinkedModules.length} ${unlinkedModules.length === 1 ? 'module is' : 'modules are'} not linked to a live cohort`}
                  icon="ri-link-unlink"
                  onClick={() => goToTab('modules')}
                />
                <QualityCheckCard
                  title="Published content"
                  count={Math.max(0, allComponents.length - publishedComponents)}
                  clearText="Every component is published"
                  issueText={`${Math.max(0, allComponents.length - publishedComponents)} components are not published`}
                  icon="ri-draft-line"
                  onClick={() => navigate(moduleBuilderProgrammeUrl)}
                />
              </div>
            </WorkspacePanel>

            <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-[11px] leading-5 text-sky-800">
              <div className="flex items-start gap-2">
                <AppIcon className="ri-information-line mt-0.5 text-sm"></AppIcon>
                <p><strong>Approval workflow is intentionally separate.</strong> Draft, Review, Approved and Published lifecycle states will only appear here when the backend owns real versions and reviewer decisions.</p>
              </div>
            </div>
          </div>
        )}
      </div>

      <ProgrammeFormDrawer
        open={programmeDrawerOpen}
        programme={drawerProgramme}
        onClose={() => setProgrammeDrawerOpen(false)}
        onSaved={() => reload({ silent: true })}
      />
      <CohortFormDrawer
        open={cohortDrawerOpen}
        cohort={editingCohort}
        defaults={{ programmeId: drawerProgrammeId }}
        programmes={drawerProgrammes}
        holidays={data?.holidays || []}
        onClose={() => { setCohortDrawerOpen(false); setEditingCohort(null); }}
        onSaved={() => reload({ silent: true })}
      />
      <GroupFormDrawer
        open={groupDrawerCohortId !== null}
        group={editingGroup}
        defaults={{ programmeId: drawerProgrammeId, cohortId: groupDrawerCohortId || undefined }}
        programmes={drawerProgrammes}
        cohorts={data?.cohorts || []}
        coachNames={drawerCoachNames}
        onClose={() => { setGroupDrawerCohortId(null); setEditingGroup(null); }}
        onSaved={() => reload({ silent: true })}
      />
      <ModuleFormDrawer
        open={Boolean(editingModule)}
        module={editingModule}
        defaults={{ programmeId: drawerProgrammeId }}
        programmes={drawerProgrammes}
        cohorts={data?.cohorts || []}
        groups={data?.groups || []}
        holidays={data?.holidays || []}
        tutorNames={drawerTutorNames}
        onClose={() => setEditingModule(null)}
        onSaved={() => reload({ silent: true })}
      />
      {placementPreview && (
        <KsbPlacementPreviewModal
          placement={placementPreview.placement}
          ksb={placementPreview.ksb}
          component={previewMatch?.component}
          week={previewMatch?.week}
          moduleKnownDeleted={placementPreview.moduleKnownDeleted}
          builderHref={!placementPreview.moduleKnownDeleted && previewModule
            ? moduleBuilderUrl(previewModule, PROGRAMME, { weekId: previewMatch?.week?.id, componentId: previewMatch?.component?.id })
            : ''}
          onClose={() => setPlacementPreview(null)}
        />
      )}
    </WorkspaceShell>
  );
}

// ============================================================
// Helper Components
// ============================================================

function QualityCheckCard({ title, count, clearText, issueText, icon, onClick }: { title: string; count: number; clearText: string; issueText: string; icon: string; onClick: () => void }) {
  const clear = count === 0;
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex min-h-32 flex-col rounded-xl border border-background-200 bg-background-100/50 p-4 text-left transition-smooth hover:border-primary-200 hover:bg-background-50 hover:shadow-sm"
    >
      <div className="flex w-full items-start justify-between gap-3">
        <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${clear ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
          <AppIcon className={clear ? 'ri-checkbox-circle-line' : icon}></AppIcon>
        </span>
        <span className={`rounded-full px-2.5 py-1 text-[9px] font-extrabold uppercase ${clear ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
          {clear ? 'Clear' : count}
        </span>
      </div>
      <p className="mt-3 text-[12px] font-bold text-foreground-900">{title}</p>
      <p className={`mt-1 text-[11px] leading-5 ${clear ? 'text-emerald-700' : 'text-foreground-500'}`}>{clear ? clearText : issueText}</p>
      <span className="mt-auto inline-flex items-center gap-1 pt-3 text-[10px] font-bold text-primary-700">{clear ? 'Review' : 'Fix issue'} <AppIcon className="ri-arrow-right-line transition-transform group-hover:translate-x-0.5"></AppIcon></span>
    </button>
  );
}

// The Achievement tab's level selector.
//
// A flat list of every module in the programme would be unreadable by the second
// cohort, so the picker is the hierarchy itself: choose a cohort, then optionally
// a group inside it, then optionally a module inside that. Each step narrows the
// next, and the chosen level is what the panel below reports on.
type AchievementScope = {
  scope: 'programme' | 'cohort' | 'group' | 'module';
  identifier: string;
  label: string;
  description: string;
};

function ScopePicker({
  programme,
  value,
  onChange,
}: {
  programme: Programme;
  value: AchievementScope;
  onChange: (scope: AchievementScope) => void;
}) {
  const programmeId = clean(programme.sourceId) || clean(programme.id);
  const cohort = programme.cohorts.find(item => item.id === value.identifier)
    || programme.cohorts.find(item => item.groups.some(group => group.id === value.identifier))
    || programme.cohorts.find(item => item.groups.some(group => group.modules.some(module => moduleWorkspaceIdentity(module) === value.identifier)));
  const group = cohort?.groups.find(item => item.id === value.identifier)
    || cohort?.groups.find(item => item.modules.some(module => moduleWorkspaceIdentity(module) === value.identifier));
  const moduleOptions = group?.modules || cohort?.groups.flatMap(item => item.modules) || [];

  const selectClass = 'h-9 min-w-[160px] rounded-lg border border-background-200 bg-background-50 px-2 text-[12px] font-semibold text-foreground-800 outline-none transition-smooth focus:border-primary-300';

  return (
    <div className="flex flex-wrap items-end gap-3">
      <button
        type="button"
        onClick={() => onChange({
          scope: 'programme',
          identifier: programmeId,
          label: programme.name || 'Programme',
          description: '',
        })}
        className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-[12px] font-bold transition-smooth ${
          value.scope === 'programme'
            ? 'border-primary-300 bg-primary-50 text-primary-700'
            : 'border-background-200 bg-background-50 text-foreground-600 hover:bg-background-100'
        }`}
      >
        <AppIcon className="ri-book-2-line"></AppIcon>
        Whole programme
      </button>

      <label className="flex flex-col gap-1">
        <span className="text-[10px] font-bold uppercase tracking-wider text-foreground-400">Cohort</span>
        <select
          className={selectClass}
          value={cohort?.id || ''}
          onChange={event => {
            const next = programme.cohorts.find(item => item.id === event.target.value);
            if (!next) {
              onChange({ scope: 'programme', identifier: programmeId, label: programme.name || 'Programme', description: '' });
              return;
            }
            onChange({
              scope: 'cohort',
              identifier: next.id,
              label: next.name,
              description: `Every group and module running in ${next.name}, and the learners enrolment placed in it.`,
            });
          }}
        >
          <option value="">All cohorts</option>
          {programme.cohorts.map(item => (
            <option key={item.id} value={item.id}>{item.name}</option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[10px] font-bold uppercase tracking-wider text-foreground-400">Group</span>
        <select
          className={selectClass}
          disabled={!cohort}
          value={group?.id || ''}
          onChange={event => {
            const next = cohort?.groups.find(item => item.id === event.target.value);
            if (!next) {
              if (cohort) {
                onChange({
                  scope: 'cohort',
                  identifier: cohort.id,
                  label: cohort.name,
                  description: `Every group and module running in ${cohort.name}, and the learners enrolment placed in it.`,
                });
              }
              return;
            }
            onChange({
              scope: 'group',
              identifier: next.id,
              label: next.name,
              description: `The timetabled class ${next.name}: its modules, and the learners enrolment placed in it.`,
            });
          }}
        >
          <option value="">All groups in this cohort</option>
          {(cohort?.groups || []).map(item => (
            <option key={item.id} value={item.id}>{item.name}</option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[10px] font-bold uppercase tracking-wider text-foreground-400">Module</span>
        <select
          className={selectClass}
          disabled={!moduleOptions.length}
          value={value.scope === 'module' ? value.identifier : ''}
          onChange={event => {
            const next = moduleOptions.find(item => moduleWorkspaceIdentity(item) === event.target.value);
            if (!next) {
              if (group) {
                onChange({
                  scope: 'group',
                  identifier: group.id,
                  label: group.name,
                  description: `The timetabled class ${group.name}: its modules, and the learners enrolment placed in it.`,
                });
              } else if (cohort) {
                onChange({ scope: 'cohort', identifier: cohort.id, label: cohort.name, description: '' });
              }
              return;
            }
            onChange({
              scope: 'module',
              identifier: moduleWorkspaceIdentity(next),
              label: next.name,
              // Said plainly, because a module has no roster of its own and a
              // reader would otherwise assume it does.
              description: `${next.name}: its own components, and the learners in the group that delivers it.`,
            });
          }}
        >
          <option value="">All modules in this scope</option>
          {moduleOptions.map(item => (
            <option key={item.id} value={moduleWorkspaceIdentity(item)}>{item.name}</option>
          ))}
        </select>
      </label>

      {/* Said back in words. Three selects reading "Sept 2026 / Group B / -"
          is a setting; "Showing Group B" is what the numbers below are of. */}
      <span className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-primary-200 bg-primary-50 px-3 text-[11px] font-bold text-primary-700">
        <AppIcon className="ri-filter-3-line"></AppIcon>
        Showing {value.label || 'the whole programme'}
      </span>
    </div>
  );
}

/** The identifier the scope endpoints resolve a module by. */
function moduleWorkspaceIdentity(module: Pick<Module, 'id' | 'moduleId' | 'moduleCatalogueId' | 'catalogueId'>) {
  return clean(module.moduleCatalogueId) || clean(module.catalogueId) || clean(module.moduleId) || clean(module.id);
}


function formatHours(value: number | string) {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed)) return '0';
  return Number.isInteger(parsed) ? String(parsed) : parsed.toFixed(1).replace(/\.0$/, '');
}

function KsbBadge({ code, compact = false }: { code: string; compact?: boolean }) {
  return (
    <span className={`${compact ? 'text-[9px] px-1.5 py-0.5' : 'text-[10px] px-2 py-0.5'} inline-flex items-center rounded-md border font-semibold ${ksbTone(ksbKind(code))}`}>
      {formatKsbCode(code)}
    </span>
  );
}

function ksbKindLabel(kind: KsbKind) {
  if (kind === 'knowledge') return 'Knowledge';
  if (kind === 'skill') return 'Skill';
  if (kind === 'behaviour') return 'Behaviour';
  return 'Other';
}

function sourceLabelKeys(sourceType: unknown, sourceId: unknown) {
  const type = clean(sourceType);
  const id = clean(sourceId);
  if (!id) return [];
  return uniqueCleanValues([
    `${type}:${id}`,
    id,
    id.replace(/^ksb[-_]/i, ''),
    `ksb-${id}`,
  ]).map(normalise).filter(Boolean);
}

function frameworkDisplayLabel(framework: CurriculumOverview['ksbFrameworks'][number]) {
  const name = clean(framework.name);
  const programmeName = clean(framework.programmeName);
  const standard = clean(framework.standard || framework.ifateRef);
  const label = name || programmeName || standard;
  if (!label) return '';
  if (standard && normalise(label) !== normalise(standard) && !normalise(label).includes(normalise(standard))) {
    return `${label} (${standard})`;
  }
  return label;
}

function buildKsbSourceLabelMap(data: CurriculumOverview | null) {
  const labels = new Map<string, string>();
  (data?.ksbFrameworks || []).forEach(framework => {
    const label = frameworkDisplayLabel(framework);
    if (!label) return;
    sourceLabelKeys('framework', framework.id).forEach(key => labels.set(key, label));
    sourceLabelKeys('profile', framework.id).forEach(key => labels.set(key, label));
    sourceLabelKeys('framework', framework.profileId).forEach(key => labels.set(key, label));
    sourceLabelKeys('profile', framework.profileId).forEach(key => labels.set(key, label));
  });
  (data?.ksbSets || []).forEach(set => {
    const label = clean(set.programmeName || set.standard);
    if (!label) return;
    sourceLabelKeys('framework', set.frameworkId || set.profileId).forEach(key => {
      if (!labels.has(key)) labels.set(key, label);
    });
    sourceLabelKeys('profile', set.frameworkId || set.profileId).forEach(key => {
      if (!labels.has(key)) labels.set(key, label);
    });
  });
  return labels;
}

function ksbCoverageSourceLabel(
  source: KsbCoverageSourceRequest,
  data: CurriculumOverview | null,
  ksbSets: CurriculumKsbSet[],
  standards: CurriculumStandard[],
) {
  const sourceId = clean(source.sourceId);
  if (!sourceId) return '';
  const sourceType = clean(source.sourceType || 'framework');
  const labelMap = buildKsbSourceLabelMap(data);
  const mappedLabel = sourceLabelKeys(sourceType, sourceId).map(key => labelMap.get(key)).find(Boolean);
  if (mappedLabel) return mappedLabel;

  const sourceKey = normaliseKsbSourceId(sourceId);
  if (normaliseKsbSourceType(sourceType, sourceId) === 'standard') {
    const standard = standards.find(item => [item.id, item.code, item.standardRef, item.name, item.larsCode].some(value => normaliseKsbSourceId(String(value || '')) === sourceKey));
    return clean(standard?.name || standard?.standardRef || standard?.code || sourceId);
  }

const framework = (data?.ksbFrameworks || []).find(item => [item.id, item.profileId, item.ksbProfileId].some(value => normaliseKsbSourceId(String(value || '')) === sourceKey));
  if (framework) return frameworkDisplayLabel(framework) || sourceId;

  const set = ksbSets.find(item => normaliseKsbSourceId(ksbSetSourceIdForProgrammeDetail(item)) === sourceKey);
  return clean(set?.programmeName || set?.standard || sourceId);
}

/**
 * The applied KSB source as a record rather than a bare name: which kind it is
 * (a KSB framework or a Skills England standard), its own reference and its
 * size, read off the framework/standard actually applied. The name alone is
 * ambiguous — a framework and a standard can both be called "Project controls
 * professional" — so the row that reports it says which one coverage counts.
 */
type KsbCoverageSourceDetail = {
  kindLabel: string;
  name: string;
  reference: string;
  level: string;
  ksbCount: number;
};

function ksbCoverageSourceDetail(
  source: KsbCoverageSourceRequest,
  data: CurriculumOverview | null,
  ksbSets: CurriculumKsbSet[],
  standards: CurriculumStandard[],
): KsbCoverageSourceDetail {
  const sourceId = clean(source.sourceId);
  const kind = normaliseKsbSourceType(source.sourceType, sourceId);
  const empty: KsbCoverageSourceDetail = { kindLabel: '', name: '', reference: '', level: '', ksbCount: 0 };
  if (!sourceId) return empty;

  const sourceKey = normaliseKsbSourceId(sourceId);
  const settle = (detail: KsbCoverageSourceDetail): KsbCoverageSourceDetail => {
    const name = clean(detail.name) || clean(detail.reference) || sourceId;
    const reference = normalise(detail.reference) === normalise(name) ? '' : clean(detail.reference);
    return { ...detail, name, reference };
  };

  if (kind === 'standard') {
    const standard = standards.find(item => [item.id, item.code, item.standardRef, item.name, item.larsCode]
      .some(value => normaliseKsbSourceId(String(value || '')) === sourceKey));
    return settle({
      kindLabel: 'KSB standard',
      name: clean(standard?.name),
      reference: clean(standard?.standardRef || standard?.code || standard?.larsCode),
      level: formatProgrammeLevel(standard?.level || standard?.levelValue, ''),
      ksbCount: Number(standard?.total || 0)
        || Number(standard?.knowledge || 0) + Number(standard?.skills || 0) + Number(standard?.behaviours || 0),
    });
  }

  const framework = (data?.ksbFrameworks || []).find(item => [item.id, item.profileId, item.ksbProfileId]
    .some(value => normaliseKsbSourceId(String(value || '')) === sourceKey));
  if (framework) {
    return settle({
      kindLabel: 'KSB framework',
      name: clean(framework.name || framework.programmeName),
      reference: clean(framework.ifateRef || framework.standard),
      level: formatProgrammeLevel(framework.level, ''),
      ksbCount: Number(framework.totalKsbs || 0)
        || Number(framework.knowledgeCount || 0) + Number(framework.skillCount || 0) + Number(framework.behaviourCount || 0),
    });
  }

  const set = ksbSets.find(item => normaliseKsbSourceId(ksbSetSourceIdForProgrammeDetail(item)) === sourceKey);
  if (set) {
    return settle({
      kindLabel: 'KSB framework',
      name: clean(set.programmeName || set.standard),
      reference: clean(set.standard),
      level: '',
      ksbCount: set.ksbs.length,
    });
  }

  return settle({ ...empty, kindLabel: kind === 'standard' ? 'KSB standard' : 'KSB framework' });
}

type HeatmapModuleBinding = { label: string; backendIndex?: number };

function uniqueModuleLabel(baseLabel: string, labelCounts: Map<string, number>) {
  const baseName = clean(baseLabel, 'Module');
  const key = normalise(baseName);
  const seen = labelCounts.get(key) || 0;
  labelCounts.set(key, seen + 1);
  return seen ? `${baseName} (${seen + 1})` : baseName;
}

function buildHeatmapModuleBindings(
  coverageModules: CurriculumKsbCoverageResponse['heatmap']['modules'],
  programmeModules: Array<Pick<Module, 'id' | 'name'>> = [],
): HeatmapModuleBinding[] {
  const labelCounts = new Map<string, number>();
  const backendModules = coverageModules.map((module, index) => ({
    index,
    label: clean(module.module_name || module.moduleName, `Module ${index + 1}`),
    keys: uniqueCleanValues([
      module.module_id,
      module.moduleId,
      module.module_name,
      module.moduleName,
    ]).map(normalise).filter(Boolean),
  }));
  const usedBackendIndexes = new Set<number>();

  if (!programmeModules.length) {
    return backendModules.map(module => ({
      label: uniqueModuleLabel(module.label, labelCounts),
      backendIndex: module.index,
    }));
  }

  const bindings = programmeModules.map((programmeModule, index) => {
    const programmeKeys = uniqueCleanValues([programmeModule.id, programmeModule.name]).map(normalise).filter(Boolean);
    const backendModule = backendModules.find(module => (
      !usedBackendIndexes.has(module.index) &&
      module.keys.some(key => programmeKeys.includes(key))
    ));
    if (backendModule) usedBackendIndexes.add(backendModule.index);
    return {
      label: uniqueModuleLabel(programmeModule.name || backendModule?.label || `Module ${index + 1}`, labelCounts),
      backendIndex: backendModule?.index,
    };
  });

  backendModules.forEach(module => {
    if (usedBackendIndexes.has(module.index)) return;
    bindings.push({
      label: uniqueModuleLabel(module.label, labelCounts),
      backendIndex: module.index,
    });
  });
  return bindings;
}

function backendCoverageToProgrammeHeatmap(
  coverage: CurriculumKsbCoverageResponse | null,
  sourceLabels = new Map<string, string>(),
  programmeModules: Array<Pick<Module, 'id' | 'name'>> = [],
  ksbDescriptions = new Map<string, string>(),
): { moduleNames: string[]; rows: KsbHeatmapRow[] } | null {
  if (!coverage?.heatmap?.modules?.length) return null;
  const moduleBindings = buildHeatmapModuleBindings(coverage.heatmap.modules, programmeModules);
  const moduleNames = moduleBindings.map(module => module.label);
  const rows = coverage.heatmap.rows.map(row => {
    const rowCoverage: Record<string, number | null> = moduleNames.reduce((coverageByModule, moduleName) => ({ ...coverageByModule, [moduleName]: null }), {});
    const counts: Record<string, number> = moduleNames.reduce((countsByModule, moduleName) => ({ ...countsByModule, [moduleName]: 0 }), {});
    const evidence: Record<string, KsbEvidenceItem[]> = moduleNames.reduce((evidenceByModule, moduleName) => ({ ...evidenceByModule, [moduleName]: [] }), {});
    moduleBindings.forEach(binding => {
      if (binding.backendIndex === undefined) return;
      const module = row.modules[binding.backendIndex];
      if (!module) return;
      const moduleName = binding.label;
      const weight = Number(module.weight || 0);
      const mappings = Array.isArray(module.mappings) ? module.mappings : [];
      rowCoverage[moduleName] = weight > 0 ? weight : null;
      counts[moduleName] = mappings.length || 0;
      evidence[moduleName] = mappings.map(mapping => ({
        module: mapping.module_name || mapping.moduleName || moduleName,
        scope: (mapping.mapping_level || mapping.mappingLevel || 'component') as KsbEvidenceItem['scope'],
        week: mapping.week_name || mapping.weekName,
        component: mapping.component_name || mapping.componentName,
        componentType: mapping.component_type || mapping.componentType,
        classification: mapping.classification,
        groups: displayGroupValues([
          (mapping as CurriculumKsbCoverageResponse['items'][number]['mappings'][number] & { group_name?: string; groupName?: string; group?: string; groups?: string[] }).group_name,
          (mapping as CurriculumKsbCoverageResponse['items'][number]['mappings'][number] & { group_name?: string; groupName?: string; group?: string; groups?: string[] }).groupName,
          (mapping as CurriculumKsbCoverageResponse['items'][number]['mappings'][number] & { group_name?: string; groupName?: string; group?: string; groups?: string[] }).group,
          ...((mapping as CurriculumKsbCoverageResponse['items'][number]['mappings'][number] & { groups?: string[] }).groups || []),
        ]),
        weight: Number(mapping.weight || 0),
      }));
    });
    const totalOccurrences = Object.values(counts).reduce((total, count) => total + count, 0);
    const totalWeight = Number(row.total || 0);
    const sourceType = clean(row.source_type || row.sourceType);
    const sourceId = clean(row.source_id || row.sourceId);
    const sourceName = clean(row.source_name || row.sourceName);
    const sourceLabel = clean(row.source_label || row.sourceLabel)
      || sourceLabelKeys(sourceType, sourceId).map(key => sourceLabels.get(key)).find(Boolean)
      || sourceName;
    const id = clean(row.coverage_key || row.coverageKey) || [sourceType, sourceId, row.code].map(normalise).join('|');
    const fallbackDescription = lookupKsbDescription(ksbDescriptions, row.code, sourceType, sourceId);
    const rowTitle = clean(row.title);
    const rowDescription = clean((row as unknown as { description?: string }).description);
    const description = rowDescription || fallbackDescription;
    return {
      id,
      ksb: row.code,
      title: rowTitle && normalise(rowTitle) !== normalise(row.code) ? rowTitle : description || row.code,
      description,
      coverage: rowCoverage,
      counts,
      evidence,
      totalOccurrences,
      totalWeight,
      sourceType,
      sourceId,
      sourceName,
      sourceLabel,
      missing: totalWeight <= 0,
    };
  });
  return { moduleNames, rows };
}

function heatCellClass(value: number | null | undefined) {
  if (value === null || value === undefined) return 'border-background-200 bg-background-50 text-foreground-300';
  if (value >= 75) return 'border-primary-300 bg-primary-600 text-white shadow-sm';
  if (value >= 35) return 'border-primary-200 bg-primary-200 text-primary-900';
  return 'border-primary-100 bg-primary-50 text-primary-700';
}

// ============================================================
// KSB coverage, narrowed to a cohort or a group
//
// The matrix answers "which modules teach this KSB" across the whole programme,
// which is the right question only while the programme runs one class. A module
// belongs to exactly one group, so a programme with four groups draws four
// columns of which any given learner ever sees one — and a curriculum lead
// asking "is K7 taught in the September cohort" had to know which of the twenty
// columns belonged to it.
//
// So the module set is filtered first and every figure is recomputed from what
// survives: the weight, the number of placements, and whether the KSB is taught
// at all. A KSB mapped only in Group B's module is genuinely missing from Group
// A, and now says so.
// ============================================================

/** One placement of one KSB: the component, in the week, in the module. */
type KsbPlacement = KsbEvidenceItem & {
  moduleLabel: string;
  cohortName: string;
  groupName: string;
};

/** Where a module label sits in the delivery tree, for the coverage filter. */
type ModuleDeliveryScope = { cohortId: string; cohortName: string; groupId: string; groupName: string };

/**
 * The same row, measured against a subset of the modules. Everything derived —
 * weight, occurrences, whether it is mapped — is recomputed rather than carried
 * over, or a KSB taught only in another group would keep the other group's
 * weight and read as covered here.
 */
function scopeHeatmapRowToModules(row: KsbHeatmapRow, moduleNames: string[]): KsbHeatmapRow {
  const coverage: Record<string, number | null> = {};
  const counts: Record<string, number> = {};
  const evidence: Record<string, KsbEvidenceItem[]> = {};
  moduleNames.forEach(moduleName => {
    coverage[moduleName] = row.coverage?.[moduleName] ?? null;
    counts[moduleName] = row.counts?.[moduleName] || 0;
    evidence[moduleName] = row.evidence?.[moduleName] || [];
  });
  const totalWeight = Object.values(coverage).reduce((total, value) => total + Number(value || 0), 0);
  const totalOccurrences = Object.values(counts).reduce((total, value) => total + value, 0);
  return {
    ...row,
    coverage,
    counts,
    evidence,
    totalWeight,
    totalOccurrences,
    missing: totalWeight <= 0 && totalOccurrences === 0,
  };
}

function ksbPlacements(
  row: KsbHeatmapRow,
  moduleNames: string[],
  scopeByLabel: Map<string, ModuleDeliveryScope>,
): KsbPlacement[] {
  return moduleNames.flatMap(moduleLabel => (row.evidence?.[moduleLabel] || []).map(item => ({
    ...item,
    moduleLabel,
    cohortName: scopeByLabel.get(moduleLabel)?.cohortName || '',
    groupName: scopeByLabel.get(moduleLabel)?.groupName || '',
  })));
}

/** A placement's address, shortest form that still identifies it uniquely. */
// Four columns, not five. "Where it is applied" used to preview the placements
// here, but opening a row lists them in full underneath — so the column was a
// truncated second copy of the panel it sits above, and the outcome text was
// squeezed into a third of the row to make space for it.
const COVERAGE_GRID = 'grid grid-cols-[minmax(320px,4fr)_104px_120px_100px]';

const COVERAGE_COLUMNS: Array<{ label: string; hint: string; align?: 'center' }> = [
  { label: 'KSB', hint: 'The outcome as the standard words it, and which of Knowledge / Skills / Behaviours it belongs to.' },
  { label: 'Total weight', hint: 'Every weight placed on this KSB across the modules currently in view, added up. Open the row to see which placement contributes what.', align: 'center' },
  { label: 'Times applied', hint: 'How many components carry this KSB in the modules currently in view. Open the row to see exactly where — module, week and component, with each one’s weight, type and delivery group.', align: 'center' },
  { label: 'Status', hint: 'Taught means at least one component in view carries it. Missing means none does.', align: 'center' },
];

/**
 * The coverage register: every KSB, its total weight, how many components carry
 * it, and exactly where each of them sits.
 *
 * The matrix that preceded this said "M4: 30%" in a cell and left the reader to
 * hover for the component behind it — so the answer to "where is K1 actually
 * taught" was a tooltip, one module at a time, across a grid twenty columns
 * wide. Here each placement is a line of its own: module, week, component,
 * weight.
 */
/**
 * The authored component a placement points at, and the week holding it.
 *
 * Coverage rows carry labels rather than ids — module name, week label,
 * component title — so matching them is the only way back to the component
 * itself. The week label varies with how the module was authored ("Week 1",
 * "Lec1", the week's own title), hence the candidate list, and a component whose
 * week cannot be pinned down is still looked for across the module rather than
 * given up on. A genuine miss returns null and the preview says so, instead of
 * drawing an empty shell that looks like an unfinished component.
 */
/**
 * The authored content of a component, resolved from its settings.
 *
 * Every component type stores its content under its own keys — a video's
 * address, a deck's upload path, a reading's HTML, an assignment's brief — so
 * this reads all of them and returns what is actually there, in the order a
 * reader wants it: the thing itself first, the writing around it after.
 *
 * A component can hold more than one (a reading with both text and a file; a
 * video with a lesson write-up), so this returns a list rather than picking one
 * and quietly dropping the rest.
 */
type PlacementContentPart =
  | { id: string; label: string; kind: 'video'; url: string }
  | { id: string; label: string; kind: 'audio'; url: string }
  | { id: string; label: string; kind: 'document'; url: string; fileName: string }
  | { id: string; label: string; kind: 'link'; url: string }
  | { id: string; label: string; kind: 'text'; body: string };

/** A media length as a clock reading: 48:42, or 1:02:15 past the hour. */
function clockDuration(totalSeconds: number) {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
    : `${minutes}:${String(rest).padStart(2, '0')}`;
}

/** Authored HTML as readable text. Curriculum is a staff view of author-supplied
 *  markup and has no sanitiser of its own, so the tags come out rather than
 *  going into the DOM; the Module Builder is one click away for the real thing. */
function authoredTextPreview(value: unknown) {
  const html = clean(value);
  if (!html) return '';
  const withBreaks = html
    .replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6])\s*\/?>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '• ');
  const textarea = document.createElement('textarea');
  textarea.innerHTML = withBreaks.replace(/<[^>]+>/g, '');
  return textarea.value.replace(/\n{3,}/g, '\n\n').trim();
}

function placementContentParts(component: ProgrammeWeekComponent): PlacementContentPart[] {
  const settings = (component.settings || {}) as Record<string, unknown>;
  const value = (key: string) => clean(settings[key]);
  const parts: PlacementContentPart[] = [];
  const seen = new Set<string>();

  const addMedia = (kind: 'video' | 'audio' | 'document' | 'link', label: string, raw: unknown, fileName = '') => {
    // Embed snippets store an <iframe>, not an address; watchableUrl pulls the
    // src out and refuses anything that is not http(s).
    const url = clean(raw).startsWith('/') ? clean(raw) : watchableUrl(raw);
    if (!url || seen.has(url)) return;
    seen.add(url);
    parts.push(kind === 'document'
      ? { id: `${kind}:${label}`, label, kind, url, fileName: clean(fileName) || url.split('/').pop() || 'file' }
      : { id: `${kind}:${label}`, label, kind, url });
  };
  const addText = (label: string, raw: unknown) => {
    const body = authoredTextPreview(raw);
    if (body) parts.push({ id: `text:${label}`, label, kind: 'text', body });
  };

  addMedia('video', 'Video', settings.videoUrl || settings.embedCode);
  addMedia('video', 'Recording', settings.recordingUrl);
  addMedia('audio', 'Audio', settings.podcastUrl || settings.audioUrl);
  addMedia('document', 'Slides', settings.presentationUrl, value('fileName'));
  addMedia('document', 'Reading resource', settings.resourceUrl, value('uploadedFileName'));
  addMedia('document', 'Assignment file', settings.assignmentFileUrl, value('assignmentFileName'));
  addMedia('document', 'Uploaded file', settings.uploadedFileUrl, value('uploadedFileName'));
  addMedia('link', 'Live session link', settings.liveSessionUrl);

  addText('Reading content', settings.readingContent);
  addText('Assignment brief', settings.assignmentBrief);
  addText('Lesson content', settings.lessonContent);
  addText('Speaker notes', settings.speakerNotes);
  addText('Transcript', settings.transcript);
  addText('Learner guidance', settings.learnerGuidance || settings.learnerInstruction);
  return parts;
}

function PlacementContentSections({
  component,
  onMeasuredDuration,
}: {
  component: ProgrammeWeekComponent;
  /** The media's real length, once the player knows it. */
  onMeasuredDuration?: (seconds: number) => void;
}) {
  const parts = placementContentParts(component);
  const linkedQuizId = clean((component.settings as Record<string, unknown> | undefined)?.linkedQuizId);

  if (!parts.length && !linkedQuizId) {
    return (
      <p className="rounded-xl border border-dashed border-background-200 bg-background-100/50 px-3 py-4 text-center text-[11px] font-semibold text-foreground-400">
        No content has been authored on this component yet — it carries its KSB weight and its settings only.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {parts.map(part => (
        <PlacementContentPartView key={part.id} part={part} onMeasuredDuration={onMeasuredDuration} />
      ))}
      {linkedQuizId && (
        <p className="rounded-xl border border-background-200 bg-background-100/60 px-3 py-2 text-[11px] text-foreground-600">
          <span className="font-bold text-foreground-800">Linked quiz:</span> {linkedQuizId} · open it in the Quiz
          Workspace to see its questions.
        </p>
      )}
    </div>
  );
}

function PlacementContentPartView({
  part,
  onMeasuredDuration,
}: {
  part: PlacementContentPart;
  onMeasuredDuration?: (seconds: number) => void;
}) {
  const heading = (
    <p className="mb-1.5 flex items-center justify-between gap-2 text-[10px] font-bold uppercase tracking-wider text-foreground-400">
      <span>{part.label}</span>
      {part.kind !== 'text' && (
        <a
          href={part.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 font-bold normal-case tracking-normal text-primary-700 hover:underline"
        >
          <AppIcon className="ri-external-link-line"></AppIcon>
          Open in a new tab
        </a>
      )}
    </p>
  );

  if (part.kind === 'video') {
    const parsed = parseVideoUrl(part.url);
    return (
      <div>
        {heading}
        {/* The learner-side player, not a hand-rolled iframe: it already knows
            how to read a real length out of both a hosted file and the YouTube
            IFrame API, which is the only way the tile below can stop quoting the
            authored guess. */}
        <div className="relative aspect-video overflow-hidden rounded-xl border border-background-200 bg-black">
          <VideoPlayer
            parsed={parsed}
            title={part.label}
            onDuration={seconds => { if (seconds > 0) onMeasuredDuration?.(seconds); }}
          />
        </div>
      </div>
    );
  }

  if (part.kind === 'audio') {
    return (
      <div>
        {heading}
        <audio
          src={part.url}
          controls
          preload="metadata"
          className="w-full"
          onLoadedMetadata={event => {
            const seconds = (event.target as HTMLAudioElement).duration;
            if (Number.isFinite(seconds) && seconds > 0) onMeasuredDuration?.(seconds);
          }}
        />
      </div>
    );
  }

  if (part.kind === 'link') {
    return (
      <div>
        {heading}
        <p className="truncate rounded-xl border border-background-200 bg-background-100/60 px-3 py-2 text-[11px] text-foreground-600">
          {part.url}
        </p>
      </div>
    );
  }

  if (part.kind === 'text') {
    return (
      <details className="group rounded-xl border border-background-200 bg-background-100/60 px-3 py-2" open>
        <summary className="flex cursor-pointer list-none items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-foreground-400 [&::-webkit-details-marker]:hidden">
          <AppIcon className="ri-file-text-line text-[12px]"></AppIcon>
          {part.label}
        </summary>
        <div className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap border-t border-background-200 pt-2 text-[12px] leading-relaxed text-foreground-700">
          {part.body}
        </div>
      </details>
    );
  }

  // A document: our own decks and PDFs render in-house, a public Office file
  // goes to the Office viewer, and anything neither can show says why.
  const embed = resolveDocEmbed(part.url);
  return (
    <div>
      {heading}
      {embed.mode === 'deck' ? (
        <SlideDeckViewer
          src={embed.src}
          title={part.fileName}
          fallback={reason => (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-[11px] leading-relaxed text-amber-800">
              <p className="font-bold">{part.fileName}</p>
              <p className="mt-1">{reason}</p>
            </div>
          )}
        />
      ) : embed.mode === 'unavailable' ? (
        <div className="rounded-xl border border-background-200 bg-background-100/60 px-3 py-3 text-[11px] leading-relaxed text-foreground-600">
          <p className="font-bold text-foreground-800">{part.fileName}</p>
          <p className="mt-1">{embed.reason} Use the link above to open it.</p>
        </div>
      ) : (
        <iframe
          src={embed.src}
          title={part.fileName}
          className="h-[60vh] w-full rounded-xl border border-background-200 bg-background-50"
        />
      )}
    </div>
  );
}

/**
 * One placement, previewed.
 *
 * A coverage row can say a KSB is carried by "Recorded Session 1" at 50% and
 * still leave the reader with no idea what that component asks of a learner —
 * which was the only question left once the row named where it was applied. This
 * shows the component as curriculum authored it: what it expects, what it
 * demands back, and every KSB it carries, with the one the reader came from
 * marked.
 *
 * It reports the component's setup, not the learner-facing page — curriculum
 * holds a count of content sections, not their bodies — so it says as much and
 * hands off to the Module Builder rather than implying it is showing the lesson.
 */
function KsbPlacementPreviewModal({
  placement,
  ksb,
  component,
  week,
  builderHref,
  moduleKnownDeleted,
  onClose,
}: {
  placement: KsbPlacement;
  ksb: string;
  component?: ProgrammeWeekComponent;
  week?: Week;
  builderHref: string;
  /** The credit's own activity record already says the module is gone, rather
   *  than this preview merely failing to match it — so the honest-miss box
   *  below says so plainly instead of guessing "renamed or removed", and no
   *  "Open the module" link is offered to a module that cannot be opened. */
  moduleKnownDeleted?: boolean;
  onClose: () => void;
}) {
  // What the media itself reports, which is the figure a reader is asking for
  // when they look at "Duration". The authored minutes are a planning input and
  // are routinely a round default — 10 for a video — so the two are kept apart
  // rather than one standing in for the other.
  const [measuredSeconds, setMeasuredSeconds] = useState(0);
  useEffect(() => { setMeasuredSeconds(0); }, [placement, component]);

  const title = clean(component?.title, clean(placement.component, 'This placement'));
  const type = clean(component?.type, clean(placement.componentType));
  const status = clean(component?.status);
  const weekLabel = clean(week?.title, clean(placement.week));
  const mappings = component?.ksbMappings || [];
  const codes = mappings.length
    ? mappings.map(mapping => ({ code: clean(mapping.code), weight: Number(mapping.weight || 0) }))
    : (component?.ksbRefs || []).map(code => ({ code: clean(code), weight: 0 }));

  const authoredMinutes = Number(component?.duration || 0);
  const facts: Array<{ label: string; value: string; note?: string; hint?: string }> = [];
  if (component) {
    if (measuredSeconds > 0) {
      // A minute of slack: a 48:42 file authored as "49 min" is not a mismatch
      // worth reporting, a 48:42 file authored as "10 min" is.
      const drifted = authoredMinutes > 0 && Math.abs(authoredMinutes * 60 - measuredSeconds) > 60;
      facts.push({
        label: 'Duration',
        value: clockDuration(measuredSeconds),
        note: drifted ? `authored as ${authoredMinutes} min` : undefined,
        hint: drifted
          ? `Read from the media itself. Curriculum has it authored as ${authoredMinutes} minutes, which is what planning and OTJH use — worth correcting in the Module Builder.`
          : 'Read from the media itself.',
      });
    } else if (authoredMinutes > 0) {
      facts.push({ label: 'Duration', value: `${authoredMinutes} min`, hint: 'The authored length. The media’s real length replaces it here once the player has read its metadata.' });
    }
    if (Number(component.expectedOtjh || 0) > 0) facts.push({ label: 'Expected OTJH', value: `${formatHours(Number(component.expectedOtjh))}h`, hint: 'Off-the-job hours this component is planned to be worth.' });
    if (Number(component.points || 0) > 0) facts.push({ label: 'Points', value: String(component.points) });
    facts.push({ label: 'Content sections', value: String(component.contentSections ?? 0), hint: 'How many sections the component holds. Their content is edited in the Module Builder.' });
    if (component.quizQuestions != null) facts.push({ label: 'Quiz questions', value: String(component.quizQuestions) });
  }

  const demands: Array<{ label: string; on: boolean; hint: string }> = component ? [
    { label: 'Reflection required', on: !!component.reflectionRequired, hint: 'The learner must write a reflection for this component. Their declared hours come from it.' },
    { label: 'Workplace evidence', on: !!component.workplaceEvidenceRequired, hint: 'The learner must upload evidence from work.' },
    { label: 'Tutor validation', on: !!component.tutorValidationRequired, hint: 'A tutor must sign this off before it counts.' },
    { label: 'Resources attached', on: !!component.hasResources, hint: 'The component carries files or links for the learner.' },
  ] : [];

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-4xl overflow-hidden rounded-2xl bg-background-50 shadow-2xl"
        onClick={event => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 bg-primary-950 px-5 py-4 text-white">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/60">Placement preview</p>
            <h3 className="mt-1 truncate font-heading text-base font-bold text-white">{title}</h3>
            <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-white/70">
              {type && <span className="rounded-full bg-white/15 px-2 py-0.5 font-bold uppercase tracking-wider">{type}</span>}
              {status && <span className="rounded-full bg-white/15 px-2 py-0.5 font-bold uppercase tracking-wider">{status}</span>}
              <span className="rounded-full bg-white/15 px-2 py-0.5 font-bold">
                {formatKsbCode(ksb)} at {placement.weight > 0 ? `${formatHours(placement.weight)}%` : 'no weight'}
              </span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/10 hover:bg-white/20"
          >
            <AppIcon className="ri-close-line"></AppIcon>
          </button>
        </div>

        <div className="max-h-[72vh] space-y-4 overflow-y-auto p-5">
          {/* Same order and labels as the card that was clicked, so the reader
              can see they landed on the placement they meant. */}
          <p className="flex flex-wrap gap-x-3 gap-y-1 rounded-xl border border-background-200 bg-background-100/60 px-3 py-2 text-[11px] text-foreground-600">
            {[
              { label: 'Group', value: clean(placement.groupName) },
              { label: 'Module', value: clean(placement.moduleLabel) },
              { label: 'Week', value: weekLabel },
            ].filter(part => part.value).map(part => (
              <span key={part.label}>
                <span className="font-semibold text-foreground-400">{part.label}:</span>{' '}
                <span className="font-semibold text-foreground-800">{part.value}</span>
              </span>
            ))}
          </p>

          {!component ? (
            // Honest miss. The row's labels are all coverage carries, and inventing
            // a preview from them would read as a component with nothing in it.
            // A credit that already knows its module is gone says so outright,
            // rather than sending the reader to Module Builder to be told the same
            // thing there — a guess-and-bounce that reads as broken rather than
            // as a genuinely deleted record.
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-[11px] leading-relaxed text-amber-800">
              <p className="font-bold">
                {moduleKnownDeleted ? 'This module no longer exists.' : 'This component could not be opened from here.'}
              </p>
              <p className="mt-1">
                {moduleKnownDeleted
                  ? `${clean(placement.moduleLabel, 'The module')} was deleted from the catalogue after this was earned, so there is nothing left to open — the achievement itself still counts and stays on record here.`
                  : (
                    <>
                      Coverage records the placement by name, and no component called &quot;{clean(placement.component, 'this one')}&quot;
                      is in {clean(placement.moduleLabel, 'that module')}{weekLabel ? ` › ${weekLabel}` : ''} any more — it has most
                      likely been renamed or removed since the mapping was made. Open the module to check.
                    </>
                  )}
              </p>
            </div>
          ) : (
            <>
              {/* The content itself, before the metadata about it. Knowing a
                  component carries 50% of K1 is not the same as seeing what it
                  actually teaches, and the second question is the one nobody
                  could answer without leaving this page. */}
              <PlacementContentSections component={component} onMeasuredDuration={setMeasuredSeconds} />

              {clean(component.description) && (
                <p className="text-[12px] leading-relaxed text-foreground-700">{component.description}</p>
              )}

              {facts.length > 0 && (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {facts.map(fact => (
                    <div key={fact.label} title={fact.hint} className="cursor-help rounded-xl border border-background-200 bg-background-100/60 px-3 py-2">
                      <p className="text-[9px] font-bold uppercase tracking-wider text-foreground-400">{fact.label}</p>
                      <p className="mt-0.5 font-heading text-[15px] font-bold text-foreground-950">{fact.value}</p>
                      {fact.note && <p className="mt-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-600">{fact.note}</p>}
                    </div>
                  ))}
                </div>
              )}

              {demands.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-foreground-400">What it asks of the learner</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {demands.map(demand => (
                      <span
                        key={demand.label}
                        title={demand.hint}
                        className={`inline-flex cursor-help items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold ${
                          demand.on ? 'bg-emerald-50 text-emerald-700' : 'bg-background-100 text-foreground-300'
                        }`}
                      >
                        <AppIcon className={demand.on ? 'ri-check-line' : 'ri-close-line'}></AppIcon>
                        {demand.label}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {codes.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-foreground-400">
                    Every KSB this component carries
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {codes.filter(item => item.code).map(item => {
                      const isSubject = normalise(item.code) === normalise(ksb);
                      return (
                        <span
                          key={item.code}
                          title={isSubject ? 'The KSB you were reading about.' : undefined}
                          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold ${
                            isSubject ? 'bg-primary-600 text-white' : 'bg-background-100 text-foreground-600'
                          }`}
                        >
                          {formatKsbCode(item.code)}
                          {item.weight > 0 && (
                            <span className={`rounded-full px-1.5 text-[9px] ${isSubject ? 'bg-white/25' : 'bg-background-200'}`}>
                              {formatHours(item.weight)}%
                            </span>
                          )}
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}

              <p className="text-[10px] leading-relaxed text-foreground-400">
                Read-only — this is the component exactly as curriculum authored it. Change any of it in the Module
                Builder.
              </p>
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-background-200 bg-background-100/60 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-lg border border-background-200 bg-background-50 px-3 text-[11px] font-bold text-foreground-600 transition-smooth hover:bg-background-100"
          >
            Close
          </button>
          {builderHref && (
            <Link
              to={builderHref}
              title={component
                ? "Opens this exact component's editor in the Module Builder — not just the module, this component."
                : 'This component could not be resolved, so this opens the module itself.'}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary-600 px-3 text-[11px] font-bold text-white transition-smooth hover:bg-primary-700"
            >
              <AppIcon className="ri-tools-line"></AppIcon>
              {component ? 'Edit this component' : 'Open the module'}
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

function findPlacementComponent(module: Module | undefined, placement: KsbPlacement) {
  if (!module) return null;
  const componentKey = normalise(placement.component);
  if (!componentKey) return null;
  const weekKey = normalise(placement.week);
  const weeks = module.weeksData || [];
  const inWeek = weeks.filter(week => !weekKey || [week.title, `week ${week.number}`, String(week.number), week.id]
    .some(candidate => normalise(candidate) === weekKey));
  for (const week of (inWeek.length ? inWeek : weeks)) {
    const component = (week.components || []).find(item => normalise(item.title) === componentKey);
    if (component) return { component, week };
  }
  return null;
}

/**
 * Coverage read the other way round: one row per component, with the KSBs
 * placed inside it.
 *
 * The KSB list answers "where is K1 taught". It cannot answer "what does
 * Recorded Session 1 carry" without opening all 71 rows and reading every
 * placement for that one name, which is the question anyone editing a component
 * actually has. Same placements, same weights, inverted - and the row opens the
 * component itself, so its content is one click away rather than a trip to the
 * Module Builder.
 */
type ComponentPlacementGroup = {
  id: string;
  component: string;
  componentType: string;
  moduleLabel: string;
  week: string;
  groupName: string;
  totalWeight: number;
  ksbs: Array<{ ksb: string; title: string; weight: number }>;
  /** Any one of this component's placements, which is all the preview needs to
   *  resolve the component itself. */
  placement: KsbPlacement;
};

function componentPlacementGroups(
  rows: KsbHeatmapRow[],
  moduleNames: string[],
  scopeByLabel: Map<string, ModuleDeliveryScope>,
): ComponentPlacementGroup[] {
  const map = new Map<string, ComponentPlacementGroup>();
  rows.forEach(row => {
    ksbPlacements(row, moduleNames, scopeByLabel).forEach(placement => {
      const id = [placement.moduleLabel, placement.week, placement.component || placement.scope]
        .map(normalise).join('|');
      const group = map.get(id) || {
        id,
        component: clean(placement.component, clean(placement.week, 'Module level')),
        componentType: clean(placement.componentType),
        moduleLabel: clean(placement.moduleLabel),
        week: clean(placement.week),
        groupName: clean(placement.groupName),
        totalWeight: 0,
        ksbs: [],
        placement,
      };
      const weight = Number(placement.weight || 0);
      // The same KSB mapped twice on one component is one KSB carrying both
      // weights, not two rows in its list.
      const existing = group.ksbs.find(item => normalise(item.ksb) === normalise(row.ksb));
      if (existing) existing.weight += weight;
      else group.ksbs.push({ ksb: row.ksb, title: clean(row.title), weight });
      group.totalWeight += weight;
      map.set(id, group);
    });
  });
  return [...map.values()].sort((left, right) => (
    left.moduleLabel.localeCompare(right.moduleLabel)
    || left.week.localeCompare(right.week, undefined, { numeric: true })
    || left.component.localeCompare(right.component)
  ));
}

// Widths rather than a grid template: the row is a toggle button plus a preview
// button, and a button cannot be a grid cell of its parent without subgrid.
const COMPONENT_COLUMNS: Array<{ label: string; hint: string; width: string }> = [
  { label: 'Component', hint: 'The component as the Module Builder holds it, with the group, module and week it sits in.', width: 'min-w-0 flex-1' },
  { label: 'Total weight', hint: 'Every KSB weight this component carries, added up.', width: 'w-[104px] text-center' },
  { label: 'KSBs inside', hint: 'How many KSBs are placed on this component. Open the row to see which, and what each one weighs.', width: 'w-[120px] text-center' },
  { label: 'Preview', hint: 'Opens the component itself \u2014 its content, what it asks of the learner, and every KSB it carries.', width: 'w-[104px] text-center' },
];

/**
 * Pick a component or two, rather than reading the whole programme's list.
 *
 * Checkbox list rather than a live text filter: a search box narrows *the
 * table* to what matches, but the reader is not asking to filter \u2014 they
 * already know which two or three components they want side by side, and
 * everything else should simply not be there while they keep looking. Its own
 * search is a way to find a name in a long list, not a way to narrow the
 * table itself.
 */
function ComponentPickerPanel({
  components,
  pickedIds,
  onToggle,
  onClear,
  onClose,
}: {
  components: ComponentPlacementGroup[];
  pickedIds: string[];
  onToggle: (id: string) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const normalisedQuery = normalise(query);
    if (!normalisedQuery) return components;
    return components.filter(group => [group.component, group.moduleLabel, group.week, group.groupName]
      .some(value => normalise(value).includes(normalisedQuery)));
  }, [components, query]);

  return (
    <div className="mb-3 rounded-xl border border-primary-200 bg-primary-50/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-semibold text-foreground-700">
          Tick the components to show. Leave none ticked to see every component in view.
        </p>
        <div className="flex items-center gap-2">
          {pickedIds.length > 0 && (
            <button
              type="button"
              onClick={onClear}
              className="text-[10px] font-bold text-foreground-500 underline decoration-dotted hover:text-foreground-800"
            >
              Clear {pickedIds.length} picked
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-7 items-center gap-1 rounded-lg bg-primary-600 px-3 text-[11px] font-bold text-white transition-smooth hover:bg-primary-700"
          >
            Done
          </button>
        </div>
      </div>
      <label className="relative mt-2 block">
        <AppIcon className="ri-search-line pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[13px] text-foreground-400"></AppIcon>
        <input
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="Find a component to tick..."
          className="h-8 w-full rounded-lg border border-background-200 bg-background-50 pl-8 pr-2 text-[12px] text-foreground-900 outline-none transition-smooth focus:border-primary-300"
        />
      </label>
      <div className="mt-2 max-h-64 space-y-0.5 overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="px-1 py-2 text-[11px] text-foreground-400">No component matches this search.</p>
        ) : filtered.map(group => {
          const checked = pickedIds.includes(group.id);
          return (
            <label
              key={group.id}
              className={`flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 transition-smooth ${checked ? 'bg-primary-100/70' : 'hover:bg-background-50'}`}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onToggle(group.id)}
                className="h-3.5 w-3.5 shrink-0 rounded border-background-300 text-primary-600 focus:ring-primary-400"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[11px] font-semibold text-foreground-900">{group.component}</span>
                <span className="block truncate text-[10px] text-foreground-400">
                  {[group.groupName, group.moduleLabel, group.week].filter(Boolean).join(' \u00b7 ')}
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

function KsbComponentTable({
  groups,
  expandedId,
  onToggle,
  onPreview,
}: {
  groups: ComponentPlacementGroup[];
  expandedId: string;
  onToggle: (id: string) => void;
  onPreview: (group: ComponentPlacementGroup) => void;
}) {
  return (
    <div className="max-h-[70vh] overflow-auto rounded-2xl border border-background-200 bg-background-50">
      <div className="min-w-[760px]">
        <div className="sticky top-0 z-20 flex gap-2 border-b border-background-200 bg-background-100 px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-foreground-400">
          {COMPONENT_COLUMNS.map(column => (
            <span key={column.label} title={column.hint} className={`cursor-help decoration-dotted underline-offset-4 hover:underline ${column.width}`}>
              {column.label}
            </span>
          ))}
        </div>
        <div className="divide-y divide-background-200">
          {groups.map(group => {
            const expanded = group.id === expandedId;
            return (
              <div key={group.id} className={expanded ? 'bg-primary-50/40' : ''}>
                <div className="flex items-start gap-2 px-4 py-2.5">
                  <button
                    type="button"
                    onClick={() => onToggle(expanded ? '' : group.id)}
                    className="flex min-w-0 flex-1 items-start gap-2 rounded-lg text-left transition-smooth hover:bg-background-100"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <AppIcon className={`${expanded ? 'ri-subtract-line' : 'ri-add-line'} text-[12px] text-foreground-400`}></AppIcon>
                        <span className="truncate text-[12px] font-bold text-foreground-900">{group.component}</span>
                        {group.componentType && (
                          <span className="rounded-full bg-background-100 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-foreground-500">
                            {group.componentType}
                          </span>
                        )}
                      </span>
                      {/* The same labelled address the placement cards carry, so
                          a component reads the same wherever it appears. */}
                      <span className="mt-0.5 block truncate pl-4 text-[10px] text-foreground-400">
                        {[
                          { label: 'Group', value: group.groupName },
                          { label: 'Module', value: group.moduleLabel },
                          { label: 'Week', value: group.week },
                        ].filter(part => part.value).map((part, partIndex) => (
                          <span key={part.label}>
                            {partIndex > 0 && <span className="text-foreground-300"> · </span>}
                            <span className="font-semibold text-foreground-500">{part.label}:</span>{' '}
                            <span className="text-foreground-600">{part.value}</span>
                          </span>
                        ))}
                      </span>
                    </span>
                    <span className="w-[104px] pt-1 text-center">
                      <KsbWeightTotal weight={group.totalWeight} />
                    </span>
                    <span className="w-[120px] pt-1 text-center">
                      <span className="block text-[13px] font-bold tabular-nums text-foreground-900">
                        {group.ksbs.length}×
                      </span>
                      <span className="mt-0.5 block text-[9px] font-bold uppercase tracking-wider text-primary-600">
                        {expanded ? 'Hide which' : 'See which'}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onPreview(group)}
                    title={`Preview ${group.component} \u2014 its content, what it asks of the learner, and every KSB it carries`}
                    className="flex w-[104px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg border border-background-200 bg-background-50 py-1.5 text-[9px] font-bold uppercase tracking-wider text-foreground-500 transition-smooth hover:border-primary-300 hover:bg-primary-50 hover:text-primary-700"
                  >
                    <AppIcon className="ri-eye-line text-[13px]"></AppIcon>
                    Preview
                  </button>
                </div>

                {expanded && (
                  <div className="border-t border-background-200 bg-background-100/60 px-4 py-3">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-foreground-400">
                      Every KSB placed on {group.component}
                    </p>
                    <div className="mt-1.5 grid gap-1 lg:grid-cols-2">
                      {group.ksbs.map(item => (
                        <div
                          key={`${group.id}-${item.ksb}`}
                          className="flex items-center justify-between gap-2 rounded-lg border border-background-200 bg-background-50 px-2.5 py-1.5"
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <KsbBadge code={item.ksb} />
                            <span className="min-w-0 truncate text-[11px] text-foreground-600">{item.title}</span>
                          </span>
                          <span className="shrink-0 rounded bg-primary-100 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-primary-800">
                            {item.weight > 0 ? `${formatHours(item.weight)}%` : 'no weight'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function KsbCoverageTable({
  rows,
  moduleNames,
  scopeByLabel,
  expandedRowId,
  onToggleRow,
  onPreviewPlacement,
}: {
  rows: KsbHeatmapRow[];
  moduleNames: string[];
  scopeByLabel: Map<string, ModuleDeliveryScope>;
  expandedRowId: string;
  onToggleRow: (rowId: string) => void;
  onPreviewPlacement: (placement: KsbPlacement, ksb: string) => void;
}) {
  return (
    <div className="max-h-[70vh] overflow-auto rounded-2xl border border-background-200 bg-background-50">
      <div className="min-w-[860px]">
        <div className={`${COVERAGE_GRID} sticky top-0 z-20 gap-3 border-b border-background-200 bg-background-100 px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-foreground-400`}>
          {COVERAGE_COLUMNS.map(column => (
            <span
              key={column.label}
              title={column.hint}
              className={`cursor-help decoration-dotted underline-offset-4 hover:underline ${column.align === 'center' ? 'text-center' : ''}`}
            >
              {column.label}
            </span>
          ))}
        </div>
        <div className="divide-y divide-background-200">
          {rows.map(row => {
            const rowId = ksbRowId(row);
            const expanded = rowId === expandedRowId;
            const kind = ksbKind(row.ksb);
            const mapped = ksbRowIsMapped(row);
            const placements = ksbPlacements(row, moduleNames, scopeByLabel);
            return (
              <div key={rowId} className={expanded ? 'bg-primary-50/40' : ''}>
                <button
                  type="button"
                  onClick={() => onToggleRow(expanded ? '' : rowId)}
                  className={`${COVERAGE_GRID} w-full items-start gap-3 px-4 py-2.5 text-left transition-smooth hover:bg-background-100 ${mapped ? '' : 'bg-amber-50/70'}`}
                >
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <AppIcon className={`${expanded ? 'ri-subtract-line' : 'ri-add-line'} text-[12px] text-foreground-400`}></AppIcon>
                      <KsbBadge code={row.ksb} />
                      <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold ${ksbTone(kind)}`}>{ksbKindLabel(kind)}</span>
                    </span>
                    <span className="mt-1 block pl-4 text-[11px] font-medium leading-snug text-foreground-700 line-clamp-2">{row.title}</span>
                  </span>
                  <span className="pt-1 text-center">
                    <KsbWeightTotal weight={ksbRowWeight(row)} mapped={mapped} />
                  </span>
                  {/* The count is the way in to the placements now that they
                      have no column of their own, so it says so rather than
                      leaving the row's disclosure arrow to imply it. */}
                  <span className="pt-1 text-center">
                    <span className={`block text-[13px] font-bold tabular-nums ${placements.length ? 'text-foreground-900' : 'text-foreground-300'}`}>
                      {placements.length ? `${placements.length}×` : '—'}
                    </span>
                    {placements.length > 0 && (
                      <span className="mt-0.5 block text-[9px] font-bold uppercase tracking-wider text-primary-600">
                        {expanded ? 'Hide where' : 'See where'}
                      </span>
                    )}
                  </span>
                  <span
                    className={`self-start rounded-md px-2 py-1 text-center text-[10px] font-bold ${mapped ? 'bg-emerald-600 text-white' : 'bg-amber-100 text-amber-800'}`}
                    title={mapped
                      ? 'At least one component in view carries this KSB.'
                      : 'No component in view carries this KSB, so nobody here can evidence it.'}
                  >
                    {mapped ? 'Taught' : 'Missing'}
                  </span>
                </button>

                {expanded && (
                  <div className="border-t border-background-200 bg-background-100/60 px-4 py-3">
                    {placements.length === 0 ? (
                      <p className="text-[11px] text-foreground-500">
                        {formatKsbCode(row.ksb)} is required by the KSB source but is not mapped to any component in
                        the modules currently in view. Map it in the Module Builder, or widen the cohort/group filter
                        to see where else it is taught.
                      </p>
                    ) : (
                      <>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-foreground-400">
                          Every placement of {formatKsbCode(row.ksb)} in view
                        </p>
                        <div className="mt-1.5 grid gap-1 lg:grid-cols-2">
                          {placements.map((placement, index) => (
                            <button
                              key={`${rowId}-placement-${index}`}
                              type="button"
                              onClick={() => onPreviewPlacement(placement, row.ksb)}
                              title={`Preview ${clean(placement.component, 'this placement')} — what it asks of the learner, and every KSB it carries`}
                              className="group flex w-full items-center justify-between gap-2 rounded-lg border border-background-200 bg-background-50 px-2.5 py-1.5 text-left transition-smooth hover:border-primary-300 hover:bg-primary-50/50"
                            >
                              <span className="min-w-0">
                                <span className="block truncate text-[11px] font-semibold text-foreground-900">
                                  {clean(placement.component, clean(placement.week, 'Module level'))}
                                </span>
                                {/* Group first, and named: it is the fact that
                                    decides who ever sees this placement, and as
                                    a bare "G2 T" at the end of the line it read
                                    as another piece of the module path. */}
                                <span className="block truncate text-[10px] text-foreground-400">
                                  {[
                                    { label: 'Group', value: clean(placement.groupName) },
                                    { label: 'Module', value: clean(placement.moduleLabel) },
                                    { label: 'Week', value: clean(placement.week) },
                                  ].filter(part => part.value).map((part, partIndex) => (
                                    <span key={part.label}>
                                      {partIndex > 0 && <span className="text-foreground-300"> · </span>}
                                      <span className="font-semibold text-foreground-500">{part.label}:</span>{' '}
                                      <span className="text-foreground-600">{part.value}</span>
                                    </span>
                                  ))}
                                  {clean(placement.componentType) && (
                                    <span className="text-foreground-400"> · {clean(placement.componentType)}</span>
                                  )}
                                </span>
                              </span>
                              <span className="flex shrink-0 items-center gap-1.5">
                                <span className="rounded bg-primary-100 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-primary-800">
                                  {placement.weight > 0 ? `${formatHours(placement.weight)}%` : 'no weight'}
                                </span>
                                {/* The card is the only clickable thing in this
                                    panel, so it says what clicking does rather
                                    than relying on the hover tint. */}
                                <span className="flex items-center gap-0.5 text-[9px] font-bold uppercase tracking-wider text-foreground-300 transition-smooth group-hover:text-primary-600">
                                  <AppIcon className="ri-eye-line text-[11px]"></AppIcon>
                                  Preview
                                </span>
                              </span>
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/**
 * Cohort and group, as one bar, above whatever it narrows.
 *
 * Both the coverage matrix and the achievement panel are read one class at a
 * time, and both used to bury that choice: coverage had no filter at all, and
 * achievement hid a three-select row under a panel titled "Scope" with a
 * paragraph of explanation above it. The chips say what is being shown in the
 * words the reader would use — "Whole programme", or a cohort's name, or a
 * group's — and the level currently in force is the one that is lit.
 */
function DeliveryScopeFilter({
  cohorts,
  cohortId,
  groupId,
  onChange,
  summary,
}: {
  cohorts: Cohort[];
  cohortId: string;
  groupId: string;
  onChange: (next: { cohortId: string; groupId: string }) => void;
  summary?: string;
}) {
  const cohort = cohorts.find(item => item.id === cohortId);
  const group = cohort?.groups.find(item => item.id === groupId);
  const selectClass = 'h-9 min-w-[170px] rounded-lg border border-background-200 bg-background-50 px-2 text-[12px] font-semibold text-foreground-800 outline-none transition-smooth focus:border-primary-300 disabled:cursor-not-allowed disabled:bg-background-100 disabled:text-foreground-400';

  return (
    <div className="rounded-2xl border border-background-200 bg-background-100/70 p-3">
      <div className="flex flex-wrap items-end gap-3">
        <button
          type="button"
          onClick={() => onChange({ cohortId: '', groupId: '' })}
          className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-[12px] font-bold transition-smooth ${
            !cohortId
              ? 'border-primary-300 bg-primary-50 text-primary-700'
              : 'border-background-200 bg-background-50 text-foreground-600 hover:bg-background-100'
          }`}
        >
          <AppIcon className="ri-book-2-line"></AppIcon>
          Whole programme
        </button>

        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-bold uppercase tracking-wider text-foreground-400">Cohort</span>
          <select
            className={selectClass}
            value={cohortId}
            onChange={event => onChange({ cohortId: event.target.value, groupId: '' })}
          >
            <option value="">All cohorts</option>
            {cohorts.map(item => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-bold uppercase tracking-wider text-foreground-400">Group</span>
          <select
            className={selectClass}
            disabled={!cohort}
            value={groupId}
            onChange={event => onChange({ cohortId, groupId: event.target.value })}
          >
            <option value="">{cohort ? 'All groups in this cohort' : 'Pick a cohort first'}</option>
            {(cohort?.groups || []).map(item => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </select>
        </label>

        {/* Said back in words. Two selects reading "Sept 2026 / Group B" is a
            setting; "Showing Group B" is what the numbers below are about. */}
        <span className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-primary-200 bg-primary-50 px-3 text-[11px] font-bold text-primary-700">
          <AppIcon className="ri-filter-3-line"></AppIcon>
          Showing {group ? group.name : cohort ? cohort.name : 'every cohort and group'}
          {summary ? <span className="font-semibold text-primary-600">· {summary}</span> : null}
        </span>
      </div>
    </div>
  );
}

function KsbHeatmapLegend() {
  return (
    <div className="mb-3 flex flex-col gap-3 rounded-2xl border border-background-200 bg-background-50 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex flex-wrap items-center gap-2">
        {(['knowledge', 'skill', 'behaviour'] as KsbKind[]).map(kind => (
          <span key={kind} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold ${ksbTone(kind)}`}>
            {ksbKindLabel(kind)}
          </span>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[10px] font-semibold text-foreground-500">
        <span>Coverage intensity</span>
        <span className="h-5 w-9 rounded border border-primary-100 bg-primary-50"></span>
        <span className="h-5 w-9 rounded border border-primary-200 bg-primary-200"></span>
        <span className="h-5 w-9 rounded border border-primary-300 bg-primary-600"></span>
        <span className="ml-1 text-foreground-400">weighted cells come from Module Builder; No weight means linked with 0/not set weight</span>
      </div>
    </div>
  );
}

function KsbHeatmapMatrix({ rows, moduleNames }: { rows: KsbHeatmapRow[]; moduleNames: string[] }) {
  const gridTemplateColumns = `minmax(250px, 1.3fr) repeat(${Math.max(moduleNames.length, 1)}, minmax(220px, 0.9fr)) minmax(180px, 0.7fr) minmax(340px, 1.4fr)`;
  // The banner above the table names the source when there is only one of them.
  const showSourceLabels = ksbSourceLabelsOf(rows).length > 1;

  return (
    // The matrix scrolls in its own box on both axes rather than pushing the
    // page: one module per column means the grid outgrows the viewport
    // sideways, and with the page scrolling instead, the horizontal bar sat
    // below the last KSB - unreachable until you had scrolled past every row.
    // Bounding the height puts it back under the reader's eye and gives the
    // header something to stick to.
    <div className="max-h-[70vh] overflow-auto rounded-2xl border border-background-200 bg-background-50 shadow-sm">
      <div className="min-w-[980px]">
        <div className="sticky top-0 z-30 grid items-center gap-3 border-b border-background-200 bg-background-100 px-4 py-3" style={{ gridTemplateColumns }}>
          {/* Frozen in both directions: the column headings have to survive
              scrolling down, and "KSB outcome" has to survive scrolling right,
              or the module columns lose the row they belong to. The negative
              margin lets the cell cover the grid's own left padding as it
              parks, so nothing slides through the gap. */}
          <span className="sticky left-0 z-10 -ml-4 bg-background-100 pl-4 text-[10px] font-bold uppercase text-foreground-400 shadow-[6px_0_8px_-8px_rgba(15,23,42,0.35)]">KSB outcome</span>
          {moduleNames.map(moduleName => (
            <span key={moduleName} className="text-center text-[10px] font-bold uppercase text-foreground-400">{moduleName}</span>
          ))}
          <span className="text-center text-[10px] font-bold uppercase text-foreground-400">Total weight</span>
          <span className="text-[10px] font-bold uppercase text-foreground-400">Evidence trail</span>
        </div>
        <div className="divide-y divide-background-200">
          {rows.map(row => {
            const kind = ksbKind(row.ksb);
            const rowWeight = ksbRowWeight(row);
            const rowId = ksbRowId(row);
            return (
              // Opaque row tints, because the frozen column inherits this
              // background to hide the cells passing beneath it - and a
              // translucent one would let them show through.
              <div key={rowId} className={`grid items-stretch gap-3 px-4 py-3 transition-smooth ${ksbRowIsMapped(row) ? 'bg-background-50 hover:bg-background-100' : 'bg-amber-50 hover:bg-amber-100'}`} style={{ gridTemplateColumns }}>
                <div className="sticky left-0 z-10 -ml-4 min-w-0 bg-inherit pl-4 shadow-[6px_0_8px_-8px_rgba(15,23,42,0.35)]">
                  <div className="flex flex-wrap items-center gap-2">
                    <KsbBadge code={row.ksb} />
                    <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold ${ksbTone(kind)}`}>{ksbKindLabel(kind)}</span>
                    {showSourceLabels && ksbSourceLabel(row) && (
                      <span className="rounded-full bg-background-100 px-2 py-0.5 text-[9px] font-bold text-foreground-500">{ksbSourceLabel(row)}</span>
                    )}
                  </div>
                  <p className="mt-1 line-clamp-2 text-[11px] font-medium leading-relaxed text-foreground-700">{row.title}</p>
                </div>
                {moduleNames.map(moduleName => (
                  <KsbHeatCell
                    key={`${rowId}-${moduleName}`}
                    value={row.coverage[moduleName]}
                    count={row.counts?.[moduleName] || 0}
                    evidence={row.evidence?.[moduleName] || []}
                  />
                ))}
                <div className="flex flex-col items-center justify-center gap-1">
                  <KsbWeightTotal weight={rowWeight} />
                  <span className="text-[10px] font-semibold text-foreground-400">{row.totalOccurrences || 0} time{Number(row.totalOccurrences || 0) === 1 ? '' : 's'}</span>
                </div>
                <KsbEvidenceList evidence={row.evidence || {}} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function groupedKsbEvidenceByWeek(evidence: KsbEvidenceItem[]) {
  const weekMap = new Map<string, KsbEvidenceItem[]>();
  evidence.forEach(item => {
    const week = clean(item.week, item.scope === 'module' ? 'Module level' : 'Week not set');
    const current = weekMap.get(week) || [];
    weekMap.set(week, [...current, item]);
  });
  return [...weekMap.entries()].map(([week, items]) => ({ week, items }));
}

function KsbHeatCell({ value, count, evidence }: { value: number | null | undefined; count: number; evidence: KsbEvidenceItem[] }) {
  const hasValue = value !== null && value !== undefined;
  const groupedEvidence = groupedKsbEvidenceByWeek(evidence);
  return (
    <div className={`flex min-h-20 flex-col justify-between rounded-xl border px-3 py-2 ${heatCellClass(value)}`}>
      {hasValue || count > 0 ? (
        <>
          <div className="flex items-center justify-between gap-2 text-center">
            <span className="text-[15px] font-heading font-bold leading-none">{hasValue ? `${value}%` : 'No weight'}</span>
            <span className="rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-bold leading-none">x{count || 1}</span>
          </div>
          {hasValue && (
            <span className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/60">
              <span className="block h-full rounded-full bg-current" style={{ width: `${Math.min(Math.max(Number(value || 0), 4), 100)}%` }}></span>
            </span>
          )}
          {groupedEvidence.length > 0 && (
            <div className="mt-2 space-y-1 text-left">
              {groupedEvidence.map(({ week, items }) => (
                <div key={week} className="rounded-lg bg-white/70 px-2 py-1">
                  <div className="flex items-center gap-1 text-[9px] font-black uppercase text-foreground-500">
                    <AppIcon className="ri-calendar-check-line"></AppIcon>
                    <span className="truncate">{week}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {items.map((item, index) => (
                      <span key={`${week}-${item.component || item.scope}-${index}`} className="rounded-md border border-background-200 bg-background-50 px-1.5 py-0.5 text-[9px] font-semibold text-foreground-700">
                        {clean(item.component, item.scope)}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <span className="m-auto text-center text-[18px] font-semibold leading-none">-</span>
      )}
    </div>
  );
}

function KsbEvidenceList({ evidence }: { evidence: Record<string, KsbEvidenceItem[]> }) {
  const items = Object.entries(evidence)
    .flatMap(([moduleLabel, entries]) => entries.map(entry => ({ ...entry, moduleLabel })))
    .slice(0, 4);
  const total = Object.values(evidence).reduce((count, entries) => count + entries.length, 0);

  if (!total) return <span className="text-[10px] font-semibold text-foreground-300">No evidence mapped</span>;

  return (
    <div className="flex max-w-md flex-col gap-1">
      {items.map((item, index) => (
        <span key={`${item.moduleLabel}-${index}`} className="rounded-md border border-background-200 bg-background-50 px-2 py-1 text-[10px] leading-snug text-foreground-600">
          <span className="font-bold text-foreground-900">{item.moduleLabel}</span>
          <span className="mx-1 text-foreground-300">/</span>
          <span className="font-semibold capitalize">{item.scope}</span>
          {item.week && <span> - {item.week}</span>}
          {item.component && <span> - {item.component}</span>}
          <span className="ml-1 font-bold text-primary-700">{item.weight > 0 ? `${item.weight}%` : 'no weight'}</span>
        </span>
      ))}
      {total > items.length && <span className="text-[10px] font-semibold text-foreground-400">+{total - items.length} more evidence item{total - items.length === 1 ? '' : 's'}</span>}
    </div>
  );
}


function ksbRowId(row: Pick<KsbHeatmapRow, 'id' | 'ksb' | 'sourceType' | 'sourceId'>) {
  return clean(row.id) || [row.sourceType, row.sourceId, row.ksb].map(normalise).join('|') || row.ksb;
}

// Reports the weight a KSB carries, with no verdict attached. A KSB with no
// weight and no placement is called out as unmapped, because that is a fact
// about the design rather than a judgement about sufficiency.
function KsbWeightTotal({ weight, mapped = true, size = 'sm' }: { weight: number; mapped?: boolean; size?: 'sm' | 'md' }) {
  const sizeClass = size === 'md' ? 'px-2.5 py-1 text-[10px]' : 'px-2 py-0.5 text-[9px]';
  if (!mapped && weight <= 0) {
    return <span className={`rounded-full font-bold bg-amber-100 text-amber-700 ${sizeClass}`}>Not mapped</span>;
  }
  return (
    <span className={`rounded-full font-bold bg-background-200/70 text-foreground-700 ${sizeClass}`}>
      {formatHours(weight)}%
    </span>
  );
}

// Total weight placed on a KSB across the curriculum. This is the only coverage
// signal: there is no fully/partially-covered grading, because no target weight
// is defined anywhere for a KSB to be measured against.
function ksbRowWeight(row: KsbHeatmapRow): number {
  return Number(row.totalWeight || 0)
    || Object.values(row.coverage || {}).reduce((total, value) => total + Number(value || 0), 0);
}

function ksbRowOccurrences(row: KsbHeatmapRow): number {
  return Number(row.totalOccurrences || 0)
    || Object.values(row.evidence || {}).reduce((total, entries) => total + entries.length, 0);
}

// "Mapped" means the KSB is placed on at least one component, whether or not a
// weight was set on that placement.
function ksbRowIsMapped(row: KsbHeatmapRow): boolean {
  return ksbRowWeight(row) > 0 || ksbRowOccurrences(row) > 0;
}

/**
 * The distinct KSB sources behind a list of rows.
 *
 * One source is a fact about the whole list, so it belongs above it once. The
 * chip repeated it on every row: 71 copies of "Project controls professional
 * (ST0845 v1.1)" in the narrowest column on the page, directly under a banner
 * that had just said it, pushing the outcome text — the only part that differs
 * between rows — down a line each time.
 *
 * It earns its place only when the rows actually mix sources, where it is the
 * one thing separating two identically coded KSBs. So the callers ask this, and
 * print the chip only when the answer is more than one.
 */
function ksbSourceLabelsOf(rows: Array<Pick<KsbHeatmapRow, 'sourceType' | 'sourceId' | 'sourceName' | 'sourceLabel'>>) {
  const labels = new Map<string, string>();
  for (const row of rows) {
    const label = ksbSourceLabel(row);
    if (label) labels.set(normalise(label), label);
  }
  return [...labels.values()];
}

function ksbSourceLabel(row: Pick<KsbHeatmapRow, 'sourceType' | 'sourceId' | 'sourceName' | 'sourceLabel'>) {
  const explicitLabel = clean(row.sourceLabel || row.sourceName);
  const placeholderLabels = new Set(['ksbsource', 'ksbframework', 'skillsenglandstandard']);
  if (explicitLabel && !placeholderLabels.has(normalise(explicitLabel))) {
    const sourceId = clean(row.sourceId);
    const looksTechnical = explicitLabel.includes(':') && sourceId && normalise(explicitLabel).endsWith(normalise(sourceId));
    return looksTechnical ? '' : explicitLabel;
  }
  return '';
}
