import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AppIcon } from '@/components/feature/AppIcon';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { showCurriculumAlert } from '@/components/feature/CurriculumSweetAlert';
import { programmeIdentity, visibleNotes } from '@/pages/curriculum/shared/entities/model';
// Editing the programme, or adding a cohort, a group or a module from this page,
// opens the same drawer that record's own page opens. One form per record type in
// the whole studio, so nothing behaves differently depending on the door taken.
import { CohortFormDrawer, GroupFormDrawer, ProgrammeFormDrawer } from '@/pages/curriculum/shared/entities/forms';
import { ModuleFormDrawer } from '@/pages/curriculum/shared/entities/moduleForm';
import { ScopeAchievementPanel } from '@/pages/curriculum/shared/entities/scopeAchievement';
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
  StackedCell,
  StatusBadge,
  WorkspaceHeader,
  WorkspacePanel,
  WorkspaceTabs,
} from '@/pages/curriculum/shared/entities/ui';
import { curriculumNavItems } from '@/mocks/navigation';
import type {
  CurriculumComponent,
  CurriculumGroup,
  CurriculumKsbEntry,
  CurriculumModule,
  CurriculumOverview,
  CurriculumProgramme,
  CurriculumProgrammeDetail,
  CurriculumProgrammeLearnerKsbImpactResponse,
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
  fetchCurriculumProgrammes,
  fetchCurriculumProgrammeDetail,
  fetchCurriculumProgrammeKsbCoverage,
  fetchCurriculumProgrammeLearnerKsbImpact,
  fetchCurriculumProgrammeLearnerRoster,
  fetchCurriculumKsbSets,
  fetchCurriculumKsbFrameworks,
  fetchCurriculumCoaches,
  fetchCurriculumHolidays,
  fetchCurriculumStandards,
  fetchCurriculumTutors,
  tutorConflictMessage,
  updateCurriculumGroup,
} from '@/lib/curriculumApi';
import { type KsbMapping } from '../module-builder/moduleAuthoringData';

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

function moduleBuilderUrl(module: Pick<Module, 'id' | 'sourceId' | 'moduleId' | 'moduleCatalogueId' | 'catalogueId' | 'structureId'>, programme?: Pick<Programme, 'id' | 'sourceId' | 'name'>) {
  const params = new URLSearchParams();
  const moduleId = moduleBuilderIdentifier(module);
  if (moduleId) params.set('module', moduleId);
  const programmeId = clean(programme?.sourceId || programme?.id || programme?.name);
  if (programmeId) params.set('programme', programmeId);
  const query = params.toString();
  return `/curriculum/module-builder${query ? `?${query}` : ''}`;
}

/**
 * The module's own workspace — its schedule, components, KSB weights, Teams
 * series and sessions. The identity precedence matches `moduleIdentity` in the
 * shared model, which is what that page resolves the route param with.
 */
function moduleWorkspaceUrl(module: Pick<Module, 'id' | 'moduleId' | 'moduleCatalogueId' | 'catalogueId'>) {
  const identity = clean(module.moduleCatalogueId)
    || clean(module.catalogueId)
    || clean(module.moduleId)
    || clean(module.id);
  return identity ? `/curriculum/modules/${encodeURIComponent(identity)}` : '';
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
  cohorts: Cohort[];
  modules: Module[];
  ksbHeatmap: KsbHeatmapRow[];
  moduleNames: string[];
}

// A delivery session shown on the Sessions tab, derived from real week-builder
// components: `live-session` components are Live, `video` components are Recorded.
type DeliverySessionKind = 'live' | 'recorded';
interface DeliverySession {
  id: string;
  kind: DeliverySessionKind;
  title: string;
  module: string;
  week: number;
  /** The week's own title, empty when the author never gave it one. */
  weekTitle: string;
  /** The week's first teaching date. Context for the row, never its schedule. */
  weekStartDate: string;
  /** The meeting's own scheduled date and time. Empty means unscheduled. */
  date: string;
  time: string;
  groups: string[];
  url: string;
  provider: string;
  durationMinutes: number;
  attendanceRequired: boolean;
  recordingExpected: boolean;
  ksbRefs: string[];
  status: CurriculumComponent['status'] | string;
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
  if (key.includes('video') || 'videoUrl' in settings || 'requiredProgressPercentage' in settings) {
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
  cohorts: [],
  modules: [],
  ksbHeatmap: [],
  moduleNames: [],
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

function formatDateLabel(value: string) {
  if (!value) return 'TBD';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
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
    const componentOtjh = weekComponents.reduce((sum, component) => (
      sum + (Number(component.expectedOtjh) || ((Number(component.duration) || 0) / 60))
    ), 0);
    const sessionOtjh = sorted.reduce((sum, session) => sum + durationMinutes(session.startTime, session.endTime), 0) / 60;
    const weekTitle = clean(weekComponents.find(component => clean(component.weekTitle))?.weekTitle);

    return {
      id: clean(authoredWeek?.id) || `${moduleId}-week-${weekNumber}`,
      number: weekNumber,
      // Deliberately no `first?.title` fallback: naming an untitled week after
      // its first live session made a week wear a session's name.
      title: clean(authoredWeek?.title) || weekTitle || `Week ${weekNumber}`,
      startDate: formatDateLabel(first?.date || ''),
      endDate: formatDateLabel(last?.date || first?.date || ''),
      otjh: Math.round((weekComponents.length ? componentOtjh : sessionOtjh) * 10) / 10,
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
  const programmeModules = data.modules.filter(module => belongsToProgramme(source, module));
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

  const moduleMatchesGroup = (module: Module, cohortName: string, group: CurriculumGroup | { id: string; name: string; modules?: string[] }) => {
    const groupModuleNames = group.modules ?? [];
    const sameGroupId = Boolean(module.groupId && normalise(module.groupId) === normalise(group.id));
    const sameGroupName = Boolean(module.group && normalise(module.group) === normalise(group.name));
    const sameCohort = !module.cohort || normalise(module.cohort) === normalise(cohortName);
    const listedByName = groupModuleNames.some(name => normalise(name) === normalise(module.name));
    return sameGroupId || (sameGroupName && sameCohort) || listedByName;
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
      schedule: group.schedule || 'TBD',
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
  const deliveryWindow = [
    deliveryStart ? formatDateLabel(deliveryStart) : '',
    deliveryEnd ? formatDateLabel(deliveryEnd) : '',
  ].filter(Boolean).join(' – ');

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
      cohorts,
      modules,
      ksbHeatmap,
      moduleNames,
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
      <div className="flex min-w-0 items-center gap-1.5 self-center">
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
    <span className="group/staff flex min-w-0 items-center gap-2 self-center">
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

// Read-only view of the learners the enrolment team placed into a cohort (and
// optionally a single group). Curriculum owns the delivery structure, not the
// placements, so this panel deliberately offers no allocation controls.
function EnrolledLearnersPanel({
  roster,
  loading,
  error,
  cohortName,
  groupName,
  emptyHint,
}: {
  roster: CurriculumProgrammeLearnerRosterResponse | null;
  loading: boolean;
  error: string | null;
  cohortName: string;
  groupName?: string;
  emptyHint?: string;
}) {
  const learners = useMemo(() => {
    const cohortKey = normalise(cohortName);
    const groupKey = normalise(groupName);
    return (roster?.assignedLearners || []).filter(learner => {
      if (cohortKey && normalise(learner.cohort) !== cohortKey) return false;
      if (groupKey && normalise(learner.group) !== groupKey) return false;
      return true;
    });
  }, [cohortName, groupName, roster]);

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
        <div className="grid gap-2 sm:grid-cols-2">
          {learners.map(learner => (
            <div key={String(learner.id)} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-background-200 bg-background-100 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-[12px] font-semibold text-foreground-900">{learner.name || learner.email || `Learner ${learner.id}`}</p>
                <p className="truncate text-[11px] text-foreground-500">
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
            </div>
          ))}
        </div>
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

type Tab = 'overview' | 'delivery' | 'modules' | 'sessions' | 'ksb' | 'achievement';

const COHORT_GRID = 'grid grid-cols-[minmax(170px,1.4fr)_minmax(150px,1.1fr)_minmax(130px,.9fr)_80px_80px_minmax(100px,.8fr)_120px]';
const GROUP_GRID = 'grid grid-cols-[minmax(160px,1.3fr)_minmax(170px,1.1fr)_minmax(150px,1fr)_80px_80px_130px]';
const MODULE_GRID = 'grid grid-cols-[minmax(190px,1.5fr)_minmax(150px,1.1fr)_minmax(130px,.9fr)_70px_100px_80px_70px_120px]';
const SESSION_GRID = 'grid grid-cols-[minmax(200px,1.6fr)_minmax(150px,1.1fr)_minmax(130px,.9fr)_90px_minmax(130px,1fr)_170px]';

const TAB_LABELS: Record<Tab, string> = {
  overview: 'Overview',
  delivery: 'Delivery',
  modules: 'Modules',
  sessions: 'Sessions',
  ksb: 'KSB coverage',
  achievement: 'Achievement KSBs',
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
  const [programmeKsbSets, setProgrammeKsbSets] = useState<CurriculumKsbSet[]>([]);
  const [skillsStandards, setSkillsStandards] = useState<CurriculumStandard[]>([]);
  const coverageRequestKeyRef = useRef('');
  const rosterRequestKeyRef = useRef('');
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
  const tab: Tab = isProgrammeDetailTab(requestedTab) ? requestedTab : 'overview';
  const setTab = useCallback((next: Tab) => {
    // Replace rather than push: switching tabs is not a navigation the reader
    // should have to unwind one step at a time to get back to the card grid.
    setSearchParams(previous => {
      const params = new URLSearchParams(previous);
      if (next === 'overview') params.delete('tab');
      else params.set('tab', next);
      return params;
    }, { replace: true });
  }, [setSearchParams]);
  // Delivery tab: which cohort's groups are shown, and which group's learners.
  const [selectedCohort, setSelectedCohort] = useState('');
  const [selectedGroup, setSelectedGroup] = useState('');
  const [cohortSearch, setCohortSearch] = useState('');
  const [cohortStatusFilter, setCohortStatusFilter] = useState('');
  const [moduleSearch, setModuleSearch] = useState('');
  const [moduleCohortFilter, setModuleCohortFilter] = useState('');
  const [moduleGroupFilter, setModuleGroupFilter] = useState('');
  const [sessionKind, setSessionKind] = useState<'live' | 'recorded'>('live');
  const [sessionSearch, setSessionSearch] = useState('');
  const [sessionModuleFilter, setSessionModuleFilter] = useState('');
  const [sessionPage, setSessionPage] = useState(1);
  const [sessionPageSize, setSessionPageSize] = useState(25);
  const [ksbSearch, setKsbSearch] = useState('');
  const [ksbTraceOpen, setKsbTraceOpen] = useState(false);
  const [programmeDrawerOpen, setProgrammeDrawerOpen] = useState(false);
  const [cohortDrawerOpen, setCohortDrawerOpen] = useState(false);
  // The cohort the new group belongs to; '' when the user has not narrowed it.
  const [groupDrawerCohortId, setGroupDrawerCohortId] = useState<string | null>(null);
  const [moduleDrawerOpen, setModuleDrawerOpen] = useState(false);
  const [savingAction, setSavingAction] = useState<string | null>(null);

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

  // Overview reads the same coverage the KSB tab draws — its readiness figure and
  // the header's coverage stat are that heatmap counted, not a second calculation
  // — so landing on the page loads it once and both agree.
  const needsCoverage = tab === 'overview' || tab === 'ksb' || ksbTraceOpen;

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

  // The roster is only needed by the Delivery tab, so it loads lazily and walks
  // the same programme-id candidates the coverage call uses.
  const loadLearnerRoster = useCallback((signal?: AbortSignal) => {
    if (!coverageProgrammeIds.length) return Promise.resolve();
    setLearnerRosterLoading(true);
    setLearnerRosterError(null);
    return (async () => {
      let lastError: unknown = null;
      for (const programmeId of coverageProgrammeIds) {
        try {
          return await fetchCurriculumProgrammeLearnerRoster(programmeId, {}, signal);
        } catch (error) {
          if (signal?.aborted) throw error;
          lastError = error;
        }
      }
      throw lastError || new Error('Unable to load the enrolment learner roster.');
    })()
      .then(result => {
        setLearnerRoster(result || null);
        setLearnerRosterError(null);
      })
      .catch(error => {
        if (signal?.aborted) return;
        console.warn('Unable to load the enrolment learner roster.', error);
        setLearnerRoster(null);
        setLearnerRosterError(error instanceof Error ? error.message : 'Unable to load learners assigned by enrolment.');
      })
      .finally(() => {
        if (!signal?.aborted) setLearnerRosterLoading(false);
      });
  }, [coverageProgrammeIds]);

  useEffect(() => {
    if (tab !== 'delivery') return;
    const rosterKey = coverageProgrammeIds.join('|');
    if (!rosterKey || rosterRequestKeyRef.current === rosterKey) return;
    rosterRequestKeyRef.current = rosterKey;
    const controller = new AbortController();
    void loadLearnerRoster(controller.signal);
    return () => {
      controller.abort();
      if (rosterRequestKeyRef.current === rosterKey) rosterRequestKeyRef.current = '';
    };
  }, [coverageProgrammeIds, loadLearnerRoster, tab]);

  useEffect(() => {
    setDetailComponents([]);
    componentsRequestKeyRef.current = '';
    coverageRequestKeyRef.current = '';
    rosterRequestKeyRef.current = '';
    setLearnerRoster(null);
    setLearnerRosterError(null);
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

  useEffect(() => {
    setSessionPage(1);
  }, [sessionSearch, sessionModuleFilter, sessionKind, sessionPageSize]);

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
      const isArchived = normalise(cohortItem.status) === 'archived';
      if (cohortStatusFilter === 'archived' ? !isArchived : isArchived) return false;
      const matchesQuery = !query || [cohortItem.name, cohortItem.status, cohortItem.startDate, cohortItem.endDate]
        .some(value => normalise(value).includes(query));
      const matchesStatus = !cohortStatusFilter || cohortStatusFilter === 'archived' || cohortItem.status === cohortStatusFilter;
      return matchesQuery && matchesStatus;
    });
  }, [PROGRAMME.cohorts, cohortSearch, cohortStatusFilter]);

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

  const activeCohort = useMemo(
    () => filteredCohorts.find(cohortItem => cohortItem.id === selectedCohort) || null,
    [filteredCohorts, selectedCohort],
  );
  const activeGroup = useMemo(
    () => activeCohort?.groups.find(group => group.id === selectedGroup) || null,
    [activeCohort, selectedGroup],
  );

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
      return matchesQuery && matchesCohort && matchesGroup;
    });
  }, [PROGRAMME.modules, moduleSearch, moduleCohortFilter, moduleGroupFilter]);

  // ---------------------------------------------------------------- sessions

  const deliverySessions = useMemo<DeliverySession[]>(() => {
    const rows: DeliverySession[] = [];
    PROGRAMME.modules.forEach(mod => {
      mod.weeksData.forEach(wk => {
        (wk.components || []).forEach(component => {
          const kind = deliveryKindForComponent(component);
          if (!kind) return;
          const settings = (component.settings || {}) as Record<string, unknown>;
          const sessionDateTimeUtc = clean(settings.sessionDateTimeUtc);
          const parsedSessionDate = sessionDateTimeUtc ? new Date(sessionDateTimeUtc) : null;
          const sessionTimeUtc = parsedSessionDate && !Number.isNaN(parsedSessionDate.getTime())
            ? `${parsedSessionDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC', hour12: false })} UTC`
            : '';
          const sessionUrl = watchableUrl(settings.liveSessionUrl || settings.videoUrl || settings.embedCode);
          const groupNames = Array.isArray(settings.selectedGroupNames)
            ? (settings.selectedGroupNames as unknown[]).map(value => clean(value)).filter(Boolean)
            : [];
          // A generic "Week 3" is the absence of a title, not a title, so the
          // row is not made to print it twice.
          const authoredWeekTitle = clean(wk.title);
          rows.push({
            id: component.id,
            kind,
            title: clean(component.title, kind === 'live' ? 'Live session' : 'Recorded video'),
            module: mod.name,
            week: wk.number,
            weekTitle: normalise(authoredWeekTitle) === `week ${wk.number}` ? '' : authoredWeekTitle,
            weekStartDate: clean(wk.startDate),
            date: clean(settings.sessionDate),
            time: clean(settings.sessionTime) || sessionTimeUtc,
            groups: groupNames,
            url: sessionUrl,
            provider: clean(settings.provider || settings.sourceType),
            durationMinutes: Number(settings.durationMinutes) || Number(component.duration) || 0,
            attendanceRequired: kind === 'live' && settings.attendanceRequired !== false,
            recordingExpected: Boolean(settings.recordingExpected),
            ksbRefs: component.ksbRefs || [],
            status: kind === 'live' && sessionUrl ? 'scheduled' : component.status || 'draft',
          });
        });
      });
    });
    return rows;
  }, [PROGRAMME.modules]);
  const liveSessions = useMemo(() => deliverySessions.filter(session => session.kind === 'live'), [deliverySessions]);
  const recordedSessions = useMemo(() => deliverySessions.filter(session => session.kind === 'recorded'), [deliverySessions]);
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
  const sessionPageCount = Math.max(1, Math.ceil(filteredSessions.length / sessionPageSize));
  const currentSessionPage = Math.min(sessionPage, sessionPageCount);
  const sessionStartIndex = (currentSessionPage - 1) * sessionPageSize;
  const pagedSessions = filteredSessions.slice(sessionStartIndex, sessionStartIndex + sessionPageSize);
  const totalSessions = deliverySessions.length;

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

  const filteredKsbHeatmap = useMemo(() => {
    const query = normalise(ksbSearch);
    return PROGRAMME.ksbHeatmap.filter(row => !query || [row.ksb, formatKsbCode(row.ksb), row.title, ksbSourceLabel(row)]
      .some(value => normalise(value).includes(query)));
  }, [PROGRAMME.ksbHeatmap, ksbSearch]);
  const mappedKsbCount = PROGRAMME.ksbHeatmap.filter(ksbRowIsMapped).length;
  const missingKsbCount = PROGRAMME.ksbHeatmap.length - mappedKsbCount;
  const totalKsbWeight = PROGRAMME.ksbHeatmap.reduce((total, row) => total + ksbRowWeight(row), 0);
  const totalKsbOccurrences = PROGRAMME.ksbHeatmap.reduce((total, row) => total + Number(row.totalOccurrences || 0), 0);
  // Percentage of required KSBs that are placed somewhere — not a judgement on
  // how much weight each one carries.
  const ksbCoverage = PROGRAMME.ksbHeatmap.length
    ? Math.round((mappedKsbCount / PROGRAMME.ksbHeatmap.length) * 100)
    : 0;

  // ---------------------------------------------------------------- readiness

  const allComponents = useMemo(
    () => PROGRAMME.modules.flatMap(mod => mod.weeksData.flatMap(wk => wk.components || [])),
    [PROGRAMME.modules],
  );
  const publishedComponents = allComponents.filter(component => component.status === 'published').length;
  const contentReadiness = allComponents.length ? Math.round((publishedComponents / allComponents.length) * 100) : 0;
  const totalOtjh = PROGRAMME.modules.reduce((total, mod) => total + mod.otjh, 0);
  const totalLearners = PROGRAMME.cohorts.reduce((total, cohortItem) => total + cohortItem.learners, 0);
  const totalWeeks = PROGRAMME.modules.reduce((total, mod) => total + mod.weeksData.length, 0);
  const emptyWeekCount = PROGRAMME.modules
    .flatMap(mod => mod.weeksData)
    .filter(wk => !(wk.components || []).length).length;
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
  const moduleDrawerDefaults = useMemo(() => {
    const cohortRecord = (data?.cohorts || []).find(item => normalise(item.name) === normalise(moduleCohortFilter));
    const groupRecord = (data?.groups || []).find(item => normalise(item.name) === normalise(moduleGroupFilter));
    return {
      programmeId: drawerProgrammeId,
      cohortId: cohortRecord?.id || groupRecord?.cohortId || undefined,
      groupId: groupRecord?.id || undefined,
    };
  }, [data, drawerProgrammeId, moduleCohortFilter, moduleGroupFilter]);
  const drawerCoachNames = useMemo(() => staffNameOptions(data?.coaches, (data?.groups || []).map(group => group.coach)), [data]);
  const drawerTutorNames = useMemo(() => staffNameOptions(data?.tutors, (data?.modules || []).map(module => module.tutor)), [data]);

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

  const goToTab = (next: Tab) => {
    setTab(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const moduleBuilderProgrammeUrl = `/curriculum/module-builder?programme=${encodeURIComponent(clean(PROGRAMME.sourceId) || PROGRAMME.name)}`;

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
    { key: 'delivery', label: TAB_LABELS.delivery, icon: 'ri-group-line', count: liveCohortCount },
    { key: 'modules', label: TAB_LABELS.modules, icon: 'ri-stack-line', count: PROGRAMME.modules.length },
    { key: 'sessions', label: TAB_LABELS.sessions, icon: 'ri-time-line', count: totalSessions },
    { key: 'ksb', label: TAB_LABELS.ksb, icon: 'ri-bar-chart-line', count: PROGRAMME.ksbHeatmap.length || undefined },
    { key: 'achievement', label: TAB_LABELS.achievement, icon: 'ri-medal-line', count: totalLearners || undefined },
  ];

  return (
    <WorkspaceShell
      role="curriculum"
      roleLabel="Curriculum Designer"
      navItems={curriculumNavItems}
      workspaceLabel="Curriculum Studio"
      pageTitle={PROGRAMME.name}
      pageSubtitle={`${PROGRAMME.duration} · ${liveCohortCount} cohorts · ${PROGRAMME.modules.length} modules`}
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
          subtitle={[PROGRAMME.level, PROGRAMME.standard, PROGRAMME.duration].map(value => clean(value)).filter(Boolean).join(' · ')}
          accentColor={PROGRAMME.color}
          stats={[
            { icon: 'ri-group-line', label: 'Cohorts', value: liveCohortCount, detail: archivedCohortCount ? `${archivedCohortCount} archived` : undefined },
            { icon: 'ri-team-line', label: 'Groups', value: totalGroups, detail: unstaffedGroupCount ? `${unstaffedGroupCount} need a coach` : 'All coached' },
            { icon: 'ri-stack-line', label: 'Modules', value: PROGRAMME.modules.length, detail: untutoredModules.length ? `${untutoredModules.length} need a tutor` : 'All tutored' },
            { icon: 'ri-calendar-line', label: 'Weeks', value: totalWeeks, detail: `${allComponents.length} components` },
            { icon: 'ri-time-line', label: 'OTJH', value: `${formatHours(totalOtjh)}h` },
            {
              icon: 'ri-node-tree',
              label: 'KSB coverage',
              value: PROGRAMME.ksbHeatmap.length ? `${ksbCoverage}%` : '—',
              detail: PROGRAMME.ksbHeatmap.length ? `${mappedKsbCount}/${PROGRAMME.ksbHeatmap.length} mapped` : 'No KSB source',
            },
          ]}
          actions={(
            <>
              <button
                type="button"
                onClick={() => setProgrammeDrawerOpen(true)}
                className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary-600 px-4 text-[12px] font-bold text-white transition-smooth hover:bg-primary-700"
              >
                <AppIcon className="ri-edit-line text-sm"></AppIcon>
                Edit programme
              </button>
              <button
                type="button"
                onClick={() => setCohortDrawerOpen(true)}
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-foreground-200 bg-background-50 px-4 text-[12px] font-bold text-foreground-700 transition-smooth hover:bg-background-100"
              >
                <AppIcon className="ri-add-line text-sm"></AppIcon>
                Add cohort
              </button>
            </>
          )}
        />

        <WorkspaceTabs tabs={tabs} active={tab} onChange={key => setTab(key as Tab)} />

        {/* ═══════════════════════════════════════════════════════════════════
            Overview — the only view that spans the whole programme
        ═══════════════════════════════════════════════════════════════════ */}
        {tab === 'overview' && (
          <div className="space-y-5">
            <div className="grid gap-5 xl:grid-cols-2">
              <WorkspacePanel title="Programme" description="The details the programme itself owns. Everything else belongs to a record beneath it.">
                <DetailRow label="Level" value={clean(PROGRAMME.level, 'Not set')} />
                <DetailRow label="Standard" value={clean(PROGRAMME.standard, 'Not set')} />
                <DetailRow label="Owner" value={clean(PROGRAMME.owner, 'Not set')} />
                <DetailRow
                  label="KSB source"
                  value={coverageKsbSource.sourceId
                    ? clean(coverageKsbSourceLabel) || coverageKsbSource.sourceId
                    : <span className="text-amber-700">No source applied</span>}
                />
                <DetailRow label="Delivery window" value={clean(PROGRAMME.duration, 'Not scheduled')} />
                <DetailRow label="Learners" value={totalLearners} />
                <DetailRow label="Programme ID" value={<code className="text-[11px]">{clean(PROGRAMME.sourceId) || PROGRAMME.id || '—'}</code>} />
              </WorkspacePanel>

              <WorkspacePanel
                title="Readiness"
                description="Both figures are counts of real records, so they can be checked rather than trusted."
                actions={(
                  <button
                    type="button"
                    onClick={() => goToTab('ksb')}
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-background-200 bg-background-50 px-3 text-[12px] font-bold text-foreground-600 transition-smooth hover:bg-background-100"
                  >
                    <AppIcon className="ri-bar-chart-line text-sm"></AppIcon>
                    Coverage detail
                  </button>
                )}
              >
                <div className="space-y-4">
                  <ReadinessBar
                    label="KSB coverage"
                    value={ksbCoverage}
                    color="bg-primary-600"
                    detail={PROGRAMME.ksbHeatmap.length
                      ? `${mappedKsbCount} of ${PROGRAMME.ksbHeatmap.length} KSBs are taught somewhere on this programme.`
                      : backendCoverageLoading ? 'Loading coverage…' : 'No KSB source is applied, so there is nothing to cover yet.'}
                  />
                  <ReadinessBar
                    label="Content published"
                    value={contentReadiness}
                    color="bg-emerald-500"
                    detail={allComponents.length
                      ? `${publishedComponents} of ${allComponents.length} authored components are published.`
                      : 'No components have been authored into these modules yet.'}
                  />
                  <div className="grid grid-cols-2 gap-2 border-t border-background-200 pt-4 sm:grid-cols-4">
                    {[
                      { label: 'Weeks', value: totalWeeks },
                      { label: 'Components', value: allComponents.length },
                      { label: 'KSBs unmapped', value: missingKsbCount },
                      { label: 'Total OTJH', value: `${formatHours(totalOtjh)}h` },
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
                      action={{ label: 'Open Delivery', onClick: () => goToTab('delivery') }}
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
                      action={{ label: 'Open KSB coverage', onClick: () => goToTab('ksb') }}
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
        {tab === 'delivery' && (
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
              summary={cohortStatusFilter === 'archived'
                ? `Showing ${filteredCohorts.length} of ${archivedCohortCount} archived cohorts`
                : `Showing ${filteredCohorts.length} of ${liveCohortCount} cohorts${archivedCohortCount > 0 ? ` · ${archivedCohortCount} archived` : ''}`}
              trailing={(
                <button
                  type="button"
                  onClick={() => setCohortDrawerOpen(true)}
                  className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-primary-600 px-3 text-[12px] font-bold text-white transition-smooth hover:bg-primary-700"
                >
                  <AppIcon className="ri-add-line text-sm"></AppIcon>
                  Add cohort
                </button>
              )}
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
                    <NamedActions
                      actions={[{
                        icon: selected ? 'ri-eye-line' : 'ri-team-line',
                        label: 'Groups',
                        title: selected
                          ? `${cohortItem.name}'s groups are shown below`
                          : `Show ${cohortItem.name}'s groups below`,
                        primary: selected,
                        disabled: selected,
                        onClick: () => { setSelectedCohort(cohortItem.id); setSelectedGroup(''); },
                      }]}
                    />
                  </>
                );
              }}
            />

            {activeCohort && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-[13px] font-heading font-bold text-foreground-950">Groups in {activeCohort.name}</h3>
                    <p className="mt-0.5 text-[12px] text-foreground-500">
                      A group is the timetabled class learners attend. Its tutor comes from the modules it delivers, so only the coach is set here.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setGroupDrawerCohortId(activeCohort.id)}
                    className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-foreground-200 bg-background-50 px-3 text-[12px] font-bold text-foreground-700 transition-smooth hover:bg-background-100"
                  >
                    <AppIcon className="ri-add-line text-sm"></AppIcon>
                    Add group
                  </button>
                </div>

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
                  rows={activeCohort.groups}
                  rowKey={group => group.id}
                  refreshing={refreshing}
                  empty={(
                    <EntityEmptyState
                      icon="ri-team-line"
                      title="This cohort has no groups"
                      message="Groups carry the weekly timetable and the coach who supports it. Add one to start scheduling."
                      action={{ label: 'Add group', onClick: () => setGroupDrawerCohortId(activeCohort.id) }}
                    />
                  )}
                  renderRow={group => (
                    <>
                      <StackedCell
                        href={`/curriculum/groups/${encodeURIComponent(group.id)}`}
                        primary={group.name}
                        secondary={[group.startDate, group.endDate].filter(Boolean).join(' – ') || undefined}
                      />
                      <StaffSlot
                        role="Coach"
                        icon="ri-heart-line"
                        name={group.coach}
                        options={data?.coaches || []}
                        saving={savingAction === `coach:${group.id}`}
                        onAssign={value => assignGroupCoach(group.id, value)}
                      />
                      <PlainCell>{[group.schedule, group.mode].map(value => clean(value)).filter(Boolean).join(' · ') || '—'}</PlainCell>
                      <PlainCell align="center">{group.learners}</PlainCell>
                      <PlainCell align="center">{group.modules.length}</PlainCell>
                      <NamedActions
                        actions={[{
                          icon: group.id === selectedGroup ? 'ri-eye-line' : 'ri-graduation-cap-line',
                          label: 'Learners',
                          title: group.id === selectedGroup
                            ? `${group.name}'s learners are shown below`
                            : `Show the learners enrolment has assigned to ${group.name}`,
                          primary: group.id === selectedGroup,
                          disabled: group.id === selectedGroup,
                          onClick: () => setSelectedGroup(group.id),
                        }]}
                      />
                    </>
                  )}
                />

                {activeGroup && (
                  <WorkspacePanel
                    title={`Learners in ${activeGroup.name}`}
                    description="Placed by the enrolment team. Curriculum owns the delivery structure, not the placements, so this is read-only."
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
                      cohortName={activeCohort.name}
                      groupName={activeGroup.name}
                      emptyHint={`No learners have been assigned to ${activeGroup.name} by the enrolment team yet.`}
                    />
                  </WorkspacePanel>
                )}
              </div>
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
              summary={`Showing ${filteredModules.length} of ${PROGRAMME.modules.length} modules · content, Teams meetings and KSB weights open in the module`}
              trailing={(
                <button
                  type="button"
                  onClick={() => setModuleDrawerOpen(true)}
                  className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-primary-600 px-3 text-[12px] font-bold text-white transition-smooth hover:bg-primary-700"
                >
                  <AppIcon className="ri-add-line text-sm"></AppIcon>
                  Add module
                </button>
              )}
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
              loading={loading && !PROGRAMME.modules.length}
              refreshing={refreshing}
              empty={(
                <EntityEmptyState
                  icon={PROGRAMME.modules.length ? 'ri-filter-off-line' : 'ri-stack-line'}
                  title={PROGRAMME.modules.length ? 'No modules match these filters' : 'No modules yet'}
                  message={PROGRAMME.modules.length
                    ? 'Clear a filter, or search for a different module.'
                    : 'Modules carry the weekly content, sessions and OTJH for this programme. Add the first one to start building the curriculum.'}
                  action={PROGRAMME.modules.length ? undefined : { label: 'Add module', onClick: () => setModuleDrawerOpen(true) }}
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
                      secondary={[
                        mod.weeksData[0]?.startDate,
                        mod.weeksData.at(-1)?.endDate || mod.weeksData.at(-1)?.startDate,
                      ].filter(Boolean).join(' – ') || 'Not scheduled'}
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
                    <NamedActions
                      actions={[{
                        icon: 'ri-tools-line',
                        label: 'Builder',
                        title: `Author ${mod.name}'s weeks and components in the Module Builder`,
                        onClick: () => navigate(moduleBuilderUrl(mod, PROGRAMME)),
                      }]}
                    />
                  </>
                );
              }}
            />
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
              summary={`Showing ${filteredSessions.length === 0 ? 0 : sessionStartIndex + 1}–${Math.min(sessionStartIndex + sessionPageSize, filteredSessions.length)} of ${filteredSessions.length} ${sessionKind === 'live' ? 'live sessions' : 'recordings'}`}
              trailing={(
                <label className="flex items-center gap-2">
                  <span className="text-[11px] font-semibold uppercase text-foreground-400">Rows</span>
                  <select
                    value={sessionPageSize}
                    onChange={event => setSessionPageSize(Number(event.target.value))}
                    aria-label="Rows per page"
                    className="h-10 cursor-pointer rounded-lg border border-background-200 bg-background-50 px-2 text-[12px] text-foreground-900 outline-none focus:border-primary-300"
                  >
                    {[25, 50, 100].map(size => <option key={size} value={size}>{size}</option>)}
                  </select>
                </label>
              )}
            />

            <EntityTable
              columns={[
                { label: sessionKind === 'live' ? 'Session' : 'Recording' },
                { label: 'Module / Week' },
                { label: sessionKind === 'live' ? 'Scheduled' : 'Provider' },
                { label: 'Length', align: 'center' },
                { label: 'Groups' },
                { label: 'Actions', align: 'right' },
              ]}
              gridClass={SESSION_GRID}
              rows={pagedSessions}
              rowKey={session => session.id}
              loading={loading && !deliverySessions.length}
              refreshing={refreshing}
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
              renderRow={session => (
                <>
                  <StackedCell
                    primary={(
                      <span className="flex min-w-0 items-center gap-2">
                        <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ${session.kind === 'live' ? 'bg-primary-50 text-primary-600' : 'bg-sky-50 text-sky-700'}`}>
                          <AppIcon className={`${session.kind === 'live' ? 'ri-microsoft-teams-line' : 'ri-film-line'} text-[11px]`}></AppIcon>
                        </span>
                        <span className="min-w-0 truncate">{session.title}</span>
                      </span>
                    )}
                    secondary={session.kind === 'live'
                      ? [session.attendanceRequired ? 'Attendance tracked' : '', session.recordingExpected ? 'Recording enabled' : ''].filter(Boolean).join(' · ') || undefined
                      : session.ksbRefs.slice(0, 4).join(', ') || undefined}
                  />
                  <StackedCell primary={session.module} secondary={sessionWeekLabel(session)} />
                  <StackedCell
                    primary={session.kind === 'live'
                      ? formatDateLabel(session.date) || 'Date not set'
                      : clean(session.provider, 'Provider not set')}
                    secondary={session.kind === 'live'
                      ? session.date
                        ? (session.time || 'Time to be confirmed')
                        : (session.weekStartDate ? `Its week starts ${session.weekStartDate}` : 'Not in the Teams calendar yet')
                      : 'Recorded content'}
                  />
                  <PlainCell align="center">{session.durationMinutes ? `${session.durationMinutes}m` : '—'}</PlainCell>
                  <PlainCell>{session.groups.length ? session.groups.join(', ') : 'All assigned groups'}</PlainCell>
                  <span className="flex items-center justify-end gap-2 self-center">
                    <StatusBadge status={session.status} />
                    {session.url && (
                      <a
                        href={session.url}
                        target="_blank"
                        rel="noreferrer"
                        title={session.kind === 'live' ? 'Join this meeting in Microsoft Teams' : 'Open this recording'}
                        className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-primary-600 px-2.5 text-[11px] font-bold text-white transition-smooth hover:bg-primary-700"
                      >
                        <AppIcon className={`${session.kind === 'live' ? 'ri-microsoft-teams-line' : 'ri-play-circle-line'} text-sm`}></AppIcon>
                        {session.kind === 'live' ? 'Join' : 'Watch'}
                      </a>
                    )}
                  </span>
                </>
              )}
            />

            {sessionPageCount > 1 && (
              <div className="flex items-center justify-center gap-1 rounded-2xl border border-foreground-200/60 bg-background-50 px-4 py-3">
                <button
                  type="button"
                  onClick={() => setSessionPage(1)}
                  disabled={currentSessionPage === 1}
                  aria-label="First page"
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-background-200 bg-background-50 text-foreground-600 transition-smooth hover:bg-background-100 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <AppIcon className="ri-skip-left-line text-xs"></AppIcon>
                </button>
                <button
                  type="button"
                  onClick={() => setSessionPage(page => Math.max(1, page - 1))}
                  disabled={currentSessionPage === 1}
                  aria-label="Previous page"
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-background-200 bg-background-50 text-foreground-600 transition-smooth hover:bg-background-100 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <AppIcon className="ri-arrow-left-s-line text-sm"></AppIcon>
                </button>
                <span className="px-4 text-[12px] font-semibold text-foreground-800">Page {currentSessionPage} of {sessionPageCount}</span>
                <button
                  type="button"
                  onClick={() => setSessionPage(page => Math.min(sessionPageCount, page + 1))}
                  disabled={currentSessionPage === sessionPageCount}
                  aria-label="Next page"
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-background-200 bg-background-50 text-foreground-600 transition-smooth hover:bg-background-100 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <AppIcon className="ri-arrow-right-s-line text-sm"></AppIcon>
                </button>
                <button
                  type="button"
                  onClick={() => setSessionPage(sessionPageCount)}
                  disabled={currentSessionPage === sessionPageCount}
                  aria-label="Last page"
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-background-200 bg-background-50 text-foreground-600 transition-smooth hover:bg-background-100 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <AppIcon className="ri-skip-right-line text-xs"></AppIcon>
                </button>
              </div>
            )}
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════
            KSB coverage — the programme-wide roll-up, which exists nowhere else
        ═══════════════════════════════════════════════════════════════════ */}
        {tab === 'ksb' && (
          <WorkspacePanel
            title="KSB coverage heatmap"
            description="Component KSB mappings rolled up into weeks, modules and programme coverage. An empty cell means the KSB is not addressed in that module."
            actions={(
              <>
                <button
                  type="button"
                  onClick={() => setKsbTraceOpen(true)}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary-600 px-3 text-[12px] font-bold text-white transition-smooth hover:bg-primary-700"
                >
                  <AppIcon className="ri-bar-chart-box-line text-sm"></AppIcon>
                  Coverage details
                </button>
                <button
                  type="button"
                  onClick={() => navigate(moduleBuilderProgrammeUrl)}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-foreground-200 bg-background-50 px-3 text-[12px] font-bold text-foreground-700 transition-smooth hover:bg-background-100"
                >
                  <AppIcon className="ri-tools-line text-sm"></AppIcon>
                  Edit weights
                </button>
                <Link
                  to="/curriculum/ksb-mapping"
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-foreground-200 bg-background-50 px-3 text-[12px] font-bold text-foreground-700 transition-smooth hover:bg-background-100"
                >
                  <AppIcon className="ri-list-check-3 text-sm"></AppIcon>
                  Global worklist
                </Link>
              </>
            )}
          >
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-2 rounded-lg border border-primary-200 bg-primary-50 px-3 py-1.5 text-[11px] font-bold text-primary-700">
                <AppIcon className="ri-bookmark-3-line text-sm"></AppIcon>
                {coverageKsbSource.sourceId
                  ? `Showing KSBs from: ${coverageKsbSourceLabel || coverageKsbSource.sourceId}`
                  : 'No KSB source applied to this programme'}
              </span>
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
                    { label: 'Mapped KSBs', value: mappedKsbCount, tone: 'border-emerald-100 bg-emerald-50 text-emerald-700' },
                    { label: 'Not mapped', value: missingKsbCount, tone: 'border-amber-100 bg-amber-50 text-amber-700' },
                    { label: 'Total weight', value: `${formatHours(totalKsbWeight)}%`, tone: 'border-sky-100 bg-sky-50 text-sky-700' },
                    { label: 'Total occurrences', value: totalKsbOccurrences, tone: 'border-primary-100 bg-primary-50 text-primary-700' },
                  ].map(stat => (
                    <div key={stat.label} className={`rounded-xl border px-4 py-3 ${stat.tone}`}>
                      <p className="text-[10px] font-bold uppercase tracking-wider">{stat.label}</p>
                      <p className="mt-1 text-lg font-heading font-bold">{stat.value}</p>
                    </div>
                  ))}
                </div>

                <div className="mb-4 rounded-2xl border border-background-200/80 bg-background-100 p-4">
                  <div className="grid items-center gap-3 md:grid-cols-[1fr_auto]">
                    <span className="relative block">
                      <AppIcon className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-sm text-foreground-400"></AppIcon>
                      <input
                        value={ksbSearch}
                        onChange={event => setKsbSearch(event.target.value)}
                        placeholder="Search KSB code or title..."
                        className="h-10 w-full rounded-lg border border-background-200 bg-background-50 pl-9 pr-3 text-[13px] text-foreground-900 outline-none transition-smooth focus:border-primary-300"
                      />
                    </span>
                    <button
                      type="button"
                      onClick={() => setKsbSearch('')}
                      disabled={!ksbSearch}
                      className="h-10 whitespace-nowrap rounded-lg border border-background-200 bg-background-50 px-3 text-[12px] font-semibold text-foreground-600 transition-smooth hover:bg-background-100 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Reset
                    </button>
                  </div>
                  <p className="mt-3 text-[11px] text-foreground-400">{filteredKsbHeatmap.length} of {PROGRAMME.ksbHeatmap.length} KSBs</p>
                </div>

                <KsbHeatmapLegend />
                <KsbHeatmapMatrix rows={filteredKsbHeatmap} moduleNames={PROGRAMME.moduleNames} />
              </>
            )}
          </WorkspacePanel>
        )}

        {/* ═══════════════════════════════════════════════════════════════════
            Achievement — what the learners actually earned, at any level
        ═══════════════════════════════════════════════════════════════════ */}
        {tab === 'achievement' && (
          <div className="space-y-4">
            <WorkspacePanel
              title="Scope"
              description="Achievement is asked at every level of Programme → Cohort → Group → Module, and every level answers it from its own components. Pick the level; the panel below reports only what belongs to it."
            >
              <ScopePicker
                programme={PROGRAMME}
                value={achievementScope}
                onChange={setAchievementScope}
              />
            </WorkspacePanel>

            <ScopeAchievementPanel
              key={`${achievementScope.scope}:${achievementScope.identifier}`}
              scope={achievementScope.scope}
              identifier={achievementScope.identifier}
              title={`${achievementScope.label} — learner achievement`}
              description={achievementScope.description}
              learnerStatus="all"
              active
            />
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
        defaults={{ programmeId: drawerProgrammeId }}
        programmes={drawerProgrammes}
        holidays={data?.holidays || []}
        onClose={() => setCohortDrawerOpen(false)}
        onSaved={() => reload({ silent: true })}
      />
      <GroupFormDrawer
        open={groupDrawerCohortId !== null}
        defaults={{ programmeId: drawerProgrammeId, cohortId: groupDrawerCohortId || undefined }}
        programmes={drawerProgrammes}
        cohorts={data?.cohorts || []}
        coachNames={drawerCoachNames}
        onClose={() => setGroupDrawerCohortId(null)}
        onSaved={() => reload({ silent: true })}
      />
      <ModuleFormDrawer
        open={moduleDrawerOpen}
        defaults={moduleDrawerDefaults}
        programmes={drawerProgrammes}
        cohorts={data?.cohorts || []}
        groups={data?.groups || []}
        holidays={data?.holidays || []}
        tutorNames={drawerTutorNames}
        onClose={() => setModuleDrawerOpen(false)}
        onSaved={() => reload({ silent: true })}
      />
      {ksbTraceOpen && (
        <KsbTraceModal
          programme={PROGRAMME}
          programmeId={coverageProgrammeIds[0] || PROGRAMME.sourceId || PROGRAMME.id}
          onClose={() => setKsbTraceOpen(false)}
        />
      )}
    </WorkspaceShell>
  );
}

// ============================================================
// Helper Components
// ============================================================

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

      <p className="ml-auto max-w-sm text-[11px] leading-relaxed text-foreground-400">
        Reporting on <span className="font-bold text-foreground-700">{value.label || 'this programme'}</span>.
        Each level below the programme has its own workspace for editing; this only reads.
      </p>
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
          <span className="text-center text-[10px] font-bold uppercase text-foreground-400">Weight</span>
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
                    {ksbSourceLabel(row) && <span className="rounded-full bg-background-100 px-2 py-0.5 text-[9px] font-bold text-foreground-500">{ksbSourceLabel(row)}</span>}
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

// Coverage is reported by weight, so the only filter left is whether a KSB is
// placed in the curriculum at all.
type KsbMappedFilter = 'all' | 'mapped' | 'unmapped';
type KsbTraceEvidence = KsbEvidenceItem & { moduleLabel: string; groups: string[] };

// Learner-side achievement for one KSB, aggregated across the programme's
// assigned learners. This is a different question from the curriculum mapping
// above: mapping says "the design places this KSB in these components", whereas
// this says "this many learners have actually evidenced it".
type KsbLearnerAchievement = {
  learnersAchieved: number;
  occurrences: number;
  achievedWeight: number;
};

// Build a per-KSB learner rollup from the learner-ksb-impact payload. Achieved
// weight comes from `consumptionSources.progress` only — a reflection's KSB
// declaration is supplementary evidence about the same activity, so counting it
// here would double-count one piece of work (see ksbAchievementPolicy).
function buildKsbLearnerAchievement(impact: CurriculumProgrammeLearnerKsbImpactResponse | null) {
  const byCode = new Map<string, KsbLearnerAchievement>();
  if (!impact) return byCode;
  const learnersByCode = new Map<string, Set<string>>();

  (impact.consumptionSources?.progress || []).forEach(source => {
    const meta = source as Record<string, unknown>;
    const code = normalise(meta.code);
    if (!code) return;
    const learnerKey = String(meta.learnerId ?? '').trim();
    const weight = Number(meta.weight || 0);
    const row = byCode.get(code) || { learnersAchieved: 0, occurrences: 0, achievedWeight: 0 };
    row.occurrences += 1;
    row.achievedWeight += Number.isFinite(weight) ? weight : 0;
    byCode.set(code, row);
    if (learnerKey) {
      const seen = learnersByCode.get(code) || new Set<string>();
      seen.add(learnerKey);
      learnersByCode.set(code, seen);
    }
  });

  learnersByCode.forEach((learners, code) => {
    const row = byCode.get(code);
    if (row) row.learnersAchieved = learners.size;
  });
  return byCode;
}

function ksbLearnerAchievementFor(row: KsbHeatmapRow, achievement: Map<string, KsbLearnerAchievement>) {
  return achievement.get(normalise(row.ksb)) || null;
}


function ksbRowId(row: Pick<KsbHeatmapRow, 'id' | 'ksb' | 'sourceType' | 'sourceId'>) {
  return clean(row.id) || [row.sourceType, row.sourceId, row.ksb].map(normalise).join('|') || row.ksb;
}

function KsbTraceModal({ programme, programmeId, onClose }: { programme: Programme; programmeId: string; onClose: () => void }) {
  const [search, setSearch] = useState('');
  // Learner achievement is a separate read from the curriculum mapping: the
  // coverage payload has no learner join at all.
  const [learnerImpact, setLearnerImpact] = useState<CurriculumProgrammeLearnerKsbImpactResponse | null>(null);
  const [learnerImpactLoading, setLearnerImpactLoading] = useState(false);
  const [learnerImpactError, setLearnerImpactError] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState<'all' | KsbKind>('all');
  const [statusFilter, setStatusFilter] = useState<KsbMappedFilter>('all');
  const [moduleFilter, setModuleFilter] = useState('all');
  const [weekFilter, setWeekFilter] = useState('all');
  const [componentFilter, setComponentFilter] = useState('all');
  const [groupFilter, setGroupFilter] = useState('all');
  const [filtersOpen, setFiltersOpen] = useState(false);

  useEffect(() => {
    const identifier = clean(programmeId);
    if (!identifier) return;
    let cancelled = false;
    setLearnerImpactLoading(true);
    setLearnerImpactError(null);
    fetchCurriculumProgrammeLearnerKsbImpact(identifier, { learnerStatus: 'all' })
      .then(response => { if (!cancelled) setLearnerImpact(response); })
      .catch(fetchError => {
        if (!cancelled) setLearnerImpactError(fetchError instanceof Error ? fetchError.message : 'Unable to load learner KSB achievement.');
      })
      .finally(() => { if (!cancelled) setLearnerImpactLoading(false); });
    return () => { cancelled = true; };
  }, [programmeId]);

  const learnerAchievement = useMemo(() => buildKsbLearnerAchievement(learnerImpact), [learnerImpact]);
  const assignedLearnerCount = learnerImpact?.assignedLearnerCount ?? 0;
  const achievedKsbCount = useMemo(
    () => programme.ksbHeatmap.filter(row => (ksbLearnerAchievementFor(row, learnerAchievement)?.learnersAchieved || 0) > 0).length,
    [programme.ksbHeatmap, learnerAchievement],
  );

  const evidenceByCode = useMemo(() => {
    const map = new Map<string, KsbTraceEvidence[]>();
    programme.ksbHeatmap.forEach(row => map.set(ksbRowId(row), traceEvidenceForRow(row, programme)));
    return map;
  }, [programme]);
  const allEvidence = useMemo(() => [...evidenceByCode.values()].flat(), [evidenceByCode]);
  const moduleOptions = useMemo(() => uniqueCleanValues(programme.modules.map(module => module.name)), [programme.modules]);
  const weekOptions = useMemo(() => uniqueCleanValues(allEvidence.map(item => item.week)), [allEvidence]);
  const componentOptions = useMemo(() => uniqueCleanValues(allEvidence.map(item => item.component)), [allEvidence]);
  const groupOptions = useMemo(() => uniqueCleanValues(allEvidence.flatMap(item => item.groups)), [allEvidence]);

  const filteredRows = useMemo(() => {
    const query = normalise(search);
    return programme.ksbHeatmap.filter(row => {
      const evidence = evidenceByCode.get(ksbRowId(row)) || [];
      const isMapped = ksbRowIsMapped(row);
      const matchesSearch = !query || [
        row.ksb,
        formatKsbCode(row.ksb),
        row.title,
        ksbSourceLabel(row),
        ...evidence.flatMap(item => [item.module, item.week, item.component, item.componentType, ...item.groups]),
      ].some(value => normalise(value).includes(query));
      const matchesKind = kindFilter === 'all' || ksbKind(row.ksb) === kindFilter;
      const matchesStatus = statusFilter === 'all' || (statusFilter === 'mapped' ? isMapped : !isMapped);
      const matchesModule = moduleFilter === 'all' || evidence.some(item => normalise(item.module) === normalise(moduleFilter)) || Number(row.coverage[moduleFilter] || 0) > 0;
      const matchesWeek = weekFilter === 'all' || evidence.some(item => normalise(item.week) === normalise(weekFilter));
      const matchesComponent = componentFilter === 'all' || evidence.some(item => normalise(item.component) === normalise(componentFilter));
      const matchesGroup = groupFilter === 'all' || evidence.some(item => item.groups.some(group => normalise(group) === normalise(groupFilter)));
      return matchesSearch && matchesKind && matchesStatus && matchesModule && matchesWeek && matchesComponent && matchesGroup;
    });
  }, [programme.ksbHeatmap, evidenceByCode, search, kindFilter, statusFilter, moduleFilter, weekFilter, componentFilter, groupFilter]);

  const summary = ksbTraceSummary(programme.ksbHeatmap);
  const mappedCount = Math.max(0, summary.total - summary.missing);
  const mappedPct = summary.total ? Math.round((mappedCount / summary.total) * 100) : 0;
  const activeFilterCount = [
    kindFilter !== 'all',
    statusFilter !== 'all',
    moduleFilter !== 'all',
    weekFilter !== 'all',
    componentFilter !== 'all',
    groupFilter !== 'all',
  ].filter(Boolean).length;
  const resetFilters = () => {
    setKindFilter('all');
    setStatusFilter('all');
    setModuleFilter('all');
    setWeekFilter('all');
    setComponentFilter('all');
    setGroupFilter('all');
    setSearch('');
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl bg-background-50 shadow-2xl" onClick={event => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-background-200 bg-background-50 px-5 py-4">
          <div className="min-w-0">
            <h3 className="truncate text-base font-heading font-bold text-foreground-950">KSB coverage</h3>
            <p className="mt-0.5 truncate text-[12px] font-semibold text-foreground-500">
              {programme.name}
              {programme.standard ? ` · ${programme.standard}` : ''}
            </p>
          </div>
          <button onClick={onClose} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-background-100 text-foreground-600 transition-smooth hover:bg-background-200">
            <AppIcon className="ri-close-line"></AppIcon>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {/* One headline answer instead of nine competing tiles: how much of the
              profile the curriculum actually places. The breakdown behind it stays
              available as chips that double as status filters. */}
          <section className="mb-4 rounded-2xl border border-background-200 bg-background-100/50 p-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-center gap-4">
                <CoverageDial percent={mappedPct} />
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wide text-foreground-500">Mapped in the curriculum</p>
                  <p className="mt-0.5 text-2xl font-heading font-black leading-none text-foreground-950">
                    {mappedCount}<span className="text-base font-bold text-foreground-400">/{summary.total}</span>
                  </p>
                  {/* Scoped to the KSB profile resolved for this programme, which
                      may be narrower than the full standard. The wording says
                      "in scope" rather than claiming whole-profile coverage. */}
                  <p className="mt-1 text-[11px] font-semibold text-foreground-500">
                    {summary.missing
                      ? `${summary.missing} KSB${summary.missing === 1 ? '' : 's'} still have nowhere to be taught`
                      : `Every KSB in scope is placed (${summary.total} in this profile)`}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5">
                <CoverageChip label="Mapped" value={summary.mapped} tone="emerald" active={statusFilter === 'mapped'} onClick={() => setStatusFilter(statusFilter === 'mapped' ? 'all' : 'mapped')} />
                <CoverageChip label="Not mapped" value={summary.missing} tone="amber" active={statusFilter === 'unmapped'} onClick={() => setStatusFilter(statusFilter === 'unmapped' ? 'all' : 'unmapped')} />
              </div>
            </div>

            {/* Learner achievement is a different question, so it stays one quiet
                line here rather than a second wall of tiles competing with the
                design figures above. */}
            <div className="mt-4 border-t border-background-200 pt-3">
              {learnerImpactLoading ? (
                <p className="text-[11px] font-semibold text-foreground-500">
                  <AppIcon className="ri-loader-4-line mr-1.5 animate-spin"></AppIcon>
                  Loading learner achievement...
                </p>
              ) : learnerImpactError ? (
                <p className="text-[11px] font-semibold text-red-700">{learnerImpactError}</p>
              ) : assignedLearnerCount === 0 ? (
                <p className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground-500">
                  <AppIcon className="ri-graduation-cap-line text-foreground-400"></AppIcon>
                  No learners assigned yet — everything below is curriculum design only.
                </p>
              ) : (
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-semibold text-foreground-600">
                  <AppIcon className="ri-graduation-cap-line text-emerald-600"></AppIcon>
                  <span><span className="font-black text-foreground-900">{assignedLearnerCount}</span> learner{assignedLearnerCount === 1 ? '' : 's'} assigned</span>
                  <span className="text-foreground-300">·</span>
                  <span><span className="font-black text-emerald-700">{achievedKsbCount}</span> of {summary.total} KSBs evidenced</span>
                  <span className="text-foreground-300">·</span>
                  <span><span className="font-black text-foreground-900">{learnerImpact?.learnerActivityCount ?? 0}</span> recorded activities</span>
                </p>
              )}
            </div>
          </section>

          {/* Search stays visible; the five structural dropdowns are collapsed
              behind a toggle because most visits never need them. */}
          <div className="mb-4">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <AppIcon className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></AppIcon>
                <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search KSB, module, week, component, group..." className="h-10 w-full rounded-lg border border-background-200 bg-background-50 pl-9 pr-3 text-[12px] text-foreground-900 outline-none focus:border-primary-300" />
              </div>
              <div className="flex items-center gap-1 rounded-lg border border-background-200 bg-background-50 p-0.5">
                {(['all', 'knowledge', 'skill', 'behaviour'] as const).map(kind => (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => setKindFilter(kind)}
                    className={`rounded-md px-2.5 py-1.5 text-[11px] font-bold transition-smooth ${kindFilter === kind ? 'bg-primary-100 text-primary-700' : 'text-foreground-500 hover:bg-background-100'}`}
                  >
                    {kind === 'all' ? 'All' : ksbKindLabel(kind)}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setFiltersOpen(open => !open)}
                className={`flex h-10 items-center gap-1.5 rounded-lg border px-3 text-[11px] font-bold transition-smooth ${activeFilterCount ? 'border-primary-200 bg-primary-50 text-primary-700' : 'border-background-200 bg-background-50 text-foreground-600 hover:bg-background-100'}`}
              >
                <AppIcon className="ri-equalizer-line"></AppIcon>
                Filters
                {activeFilterCount > 0 && <span className="rounded-full bg-primary-600 px-1.5 text-[9px] font-black text-white">{activeFilterCount}</span>}
              </button>
              {(activeFilterCount > 0 || search) && (
                <button type="button" onClick={resetFilters} className="h-10 rounded-lg border border-background-200 bg-background-50 px-3 text-[11px] font-bold text-foreground-500 transition-smooth hover:bg-background-100">
                  Reset
                </button>
              )}
            </div>

            {filtersOpen && (
              <div className="mt-2 grid grid-cols-1 gap-2 rounded-xl border border-background-200 bg-background-100/60 p-3 sm:grid-cols-2 lg:grid-cols-5">
                <KsbTraceSelect value={statusFilter} onChange={value => setStatusFilter(value as KsbMappedFilter)} options={['all', 'mapped', 'unmapped']} labels={{ all: 'All KSBs', mapped: 'Mapped', unmapped: 'Not mapped' }} />
                <KsbTraceSelect value={moduleFilter} onChange={setModuleFilter} options={['all', ...moduleOptions]} labels={{ all: 'All modules' }} />
                <KsbTraceSelect value={weekFilter} onChange={setWeekFilter} options={['all', ...weekOptions]} labels={{ all: 'All weeks' }} />
                <KsbTraceSelect value={componentFilter} onChange={setComponentFilter} options={['all', ...componentOptions]} labels={{ all: 'All components' }} />
                <KsbTraceSelect value={groupFilter} onChange={setGroupFilter} options={['all', ...groupOptions]} labels={{ all: 'All groups' }} />
              </div>
            )}

            <p className="mt-2 text-[11px] font-semibold text-foreground-400">
              Showing {filteredRows.length} of {programme.ksbHeatmap.length} KSBs
            </p>
          </div>

          <KsbCoverageSummaryView rows={filteredRows} evidenceByCode={evidenceByCode} learnerAchievement={learnerAchievement} hasLearners={assignedLearnerCount > 0} />
        </div>
      </div>
    </div>
  );
}

// A compact ring: the coverage number is the one thing worth seeing instantly.
function CoverageDial({ percent }: { percent: number }) {
  const safe = Math.max(0, Math.min(100, percent));
  const tone = safe >= 80 ? 'var(--color-emerald-500, #10b981)' : safe >= 40 ? 'var(--color-primary-500, #6941c6)' : 'var(--color-amber-500, #f59e0b)';
  return (
    <div
      className="relative flex h-16 w-16 shrink-0 items-center justify-center rounded-full"
      style={{ background: `conic-gradient(${tone} ${safe * 3.6}deg, var(--color-background-200, #e5e5e5) 0deg)` }}
      role="img"
      aria-label={`${safe}% of KSBs mapped`}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-background-50">
        <span className="text-[13px] font-heading font-black text-foreground-950">{safe}%</span>
      </div>
    </div>
  );
}

// The breakdown doubles as a filter, so reading a number and acting on it are
// the same gesture rather than two separate controls.
function CoverageChip({ label, value, tone, active, onClick }: { label: string; value: number; tone: 'emerald' | 'primary' | 'amber' | 'slate'; active: boolean; onClick: () => void }) {
  const tones = {
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    primary: 'border-primary-200 bg-primary-50 text-primary-800',
    amber: 'border-amber-200 bg-amber-50 text-amber-800',
    slate: 'border-background-300 bg-background-100 text-foreground-700',
  };
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-xl border px-3 py-2 text-left transition-smooth hover:brightness-95 ${tones[tone]} ${active ? 'ring-2 ring-primary-400 ring-offset-1' : ''}`}
    >
      <span className="block text-lg font-heading font-black leading-none">{value}</span>
      <span className="mt-1 block text-[9px] font-bold uppercase tracking-wide opacity-75">{label}</span>
    </button>
  );
}

function KsbTraceSelect({ value, onChange, options, labels = {} }: { value: string; onChange: (value: string) => void; options: string[]; labels?: Record<string, string> }) {
  return (
    <select value={value} onChange={event => onChange(event.target.value)} className="h-10 min-w-0 rounded-lg border border-background-200 bg-background-50 px-3 text-[12px] font-semibold text-foreground-700 outline-none focus:border-primary-300">
      {options.map(option => <option key={option} value={option}>{labels[option] || option}</option>)}
    </select>
  );
}

function KsbCoverageSummaryView({ rows, evidenceByCode, learnerAchievement, hasLearners }: { rows: KsbHeatmapRow[]; evidenceByCode: Map<string, KsbTraceEvidence[]>; learnerAchievement: Map<string, KsbLearnerAchievement>; hasLearners: boolean }) {
  if (!rows.length) return <EmptyPanel title="No KSB coverage" message="No KSBs match the current filters." />;
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
      {(['knowledge', 'skill', 'behaviour'] as KsbKind[]).map(kind => {
        const kindRows = rows.filter(row => ksbKind(row.ksb) === kind);
        return (
          <section key={kind} className="rounded-2xl border border-background-200 bg-background-50 p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h4 className="text-[12px] font-heading font-bold text-foreground-900">{ksbKindLabel(kind)} Points</h4>
              <span className="rounded-full bg-background-100 px-2 py-0.5 text-[10px] font-bold text-foreground-500" title="KSBs mapped somewhere in the curriculum design">{kindRows.filter(ksbRowIsMapped).length}/{kindRows.length} mapped</span>
            </div>
            <div className="space-y-2">
              {kindRows.map(row => {
                const rowId = ksbRowId(row);
                const evidence = evidenceByCode.get(rowId) || [];
                const rowWeight = ksbRowWeight(row);
                const rowMapped = ksbRowIsMapped(row);
                const description = ksbDescriptionText(row);
                const learnerRow = ksbLearnerAchievementFor(row, learnerAchievement);
                return (
                  <article key={rowId} className={`w-full rounded-xl border p-3 text-left ${rowMapped ? 'border-emerald-100 bg-emerald-50/35' : 'border-amber-100 bg-amber-50/35'}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <KsbBadge code={row.ksb} />
                          <KsbWeightTotal weight={rowWeight} mapped={rowMapped} />
                          {ksbSourceLabel(row) && <span className="rounded-full bg-background-100 px-2 py-0.5 text-[9px] font-bold text-foreground-500">{ksbSourceLabel(row)}</span>}
                        </div>
                        <p className="mt-2 line-clamp-4 text-[11px] leading-relaxed text-foreground-700">{description}</p>
                      </div>
                      {/* Two separate facts, never merged into one number: how
                          many places the design maps this KSB, and how many
                          learners have evidenced it. */}
                      <div className="flex shrink-0 flex-col gap-1">
                        <span className="rounded-lg border border-background-200 bg-background-50 px-2 py-1 text-center text-[10px] font-bold text-foreground-700" title="Times this KSB is mapped across modules, weeks and components">
                          <span className="block text-[9px] font-black uppercase leading-tight text-foreground-400">Mapped</span>
                          {evidence.length}&times;
                        </span>
                        <span
                          className={`rounded-lg border px-2 py-1 text-center text-[10px] font-bold ${learnerRow && learnerRow.learnersAchieved > 0 ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-background-200 bg-background-100 text-foreground-400'}`}
                          title={hasLearners ? 'Learners who have evidenced this KSB through completed activity' : 'No learners are assigned to this programme yet'}
                        >
                          <span className="block text-[9px] font-black uppercase leading-tight opacity-70">Learners</span>
                          {hasLearners ? (learnerRow?.learnersAchieved || 0) : '\u2014'}
                        </span>
                      </div>
                    </div>
                    <KsbTraceMiniMeta evidence={evidence} learnerRow={learnerRow} hasLearners={hasLearners} />
                  </article>
                );
              })}
              {!kindRows.length && <p className="rounded-lg border border-dashed border-background-200 px-3 py-4 text-center text-[11px] font-semibold text-foreground-300">No {ksbKindLabel(kind).toLowerCase()} KSBs.</p>}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function ksbDescriptionText(row: KsbHeatmapRow) {
  const code = normalise(row.ksb);
  const title = clean(row.title);
  const description = clean(row.description);
  if (description && normalise(description) !== code) return description;
  if (title && normalise(title) !== code) return title;
  return 'No KSB description supplied.';
}

function KsbTraceMiniMeta({ evidence, learnerRow, hasLearners }: { evidence: KsbTraceEvidence[]; learnerRow: KsbLearnerAchievement | null; hasLearners: boolean }) {
  // Learner achievement is reported on its own line so it is never read as part
  // of the curriculum placement list above it.
  const learnerLine = !hasLearners
    ? 'No learners assigned yet'
    : learnerRow && learnerRow.learnersAchieved > 0
      ? `${learnerRow.learnersAchieved} ${learnerRow.learnersAchieved === 1 ? 'learner has' : 'learners have'} evidenced this (${learnerRow.occurrences} ${learnerRow.occurrences === 1 ? 'activity' : 'activities'})`
      : 'Not yet evidenced by any learner';

  return (
    <div className="mt-3 space-y-2">
      {evidence.length === 0 ? (
        <p className="text-[10px] font-semibold text-foreground-400">Not mapped to any module, week or component in the curriculum design.</p>
      ) : (
        <div className="space-y-1 text-[10px] font-semibold text-foreground-500">
          <p className="text-[9px] font-black uppercase tracking-wide text-foreground-400">Mapped in design</p>
          <p>Modules: {uniqueCleanValues(evidence.map(item => item.module)).slice(0, 3).join(', ') || 'None'}</p>
          <p>Weeks: {uniqueCleanValues(evidence.map(item => item.week)).slice(0, 3).join(', ') || 'None'}</p>
          <p>Components: {uniqueCleanValues(evidence.map(item => item.component)).slice(0, 3).join(', ') || 'None'}</p>
          <p>Groups: {uniqueCleanValues(evidence.flatMap(item => item.groups)).slice(0, 3).join(', ') || 'None'}</p>
        </div>
      )}
      <p className={`flex items-center gap-1.5 border-t border-background-200/70 pt-2 text-[10px] font-bold ${learnerRow && learnerRow.learnersAchieved > 0 ? 'text-emerald-700' : 'text-foreground-400'}`}>
        <AppIcon className="ri-graduation-cap-line text-[11px]"></AppIcon>
        {learnerLine}
      </p>
    </div>
  );
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

function EmptyPanel({ title, message, compact = false }: { title: string; message: string; compact?: boolean }) {
  return (
    <div className={`rounded-xl border border-dashed border-background-300 bg-background-100 text-center ${compact ? 'p-3' : 'p-8'}`}>
      <p className="text-[12px] font-bold text-foreground-700">{title}</p>
      <p className="mt-1 text-[11px] text-foreground-400">{message}</p>
    </div>
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

function ksbTraceSummary(rows: KsbHeatmapRow[]) {
  const mapped = rows.filter(ksbRowIsMapped).length;
  const missing = rows.length - mapped;
  const totalWeight = rows.reduce((total, row) => total + ksbRowWeight(row), 0);
  return {
    total: rows.length,
    mapped,
    missing,
    totalWeight,
    // Share of required KSBs placed somewhere, not a grading of their weights.
    coveragePercent: rows.length ? Math.round((mapped / rows.length) * 100) : 0,
  };
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

function traceEvidenceForRow(row: KsbHeatmapRow, programme: Programme): KsbTraceEvidence[] {
  const modulesByName = new Map(programme.modules.flatMap(module => [
    [normalise(module.name), module],
    [normalise(module.id), module],
  ]));
  return Object.entries(row.evidence || {}).flatMap(([moduleLabel, entries]) => entries.map(entry => {
    const module = modulesByName.get(normalise(entry.module)) || modulesByName.get(normalise(moduleLabel));
    const fallbackGroups = module ? [module.group, module.groupId] : [];
    return {
      ...entry,
      moduleLabel,
      module: clean(entry.module || module?.name || moduleLabel, moduleLabel),
      groups: displayGroupValues([...(entry.groups || []), ...fallbackGroups]),
    };
  }));
}
