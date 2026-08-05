import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { AddCurriculumStructureWizard } from '@/components/feature/AddCurriculumStructureWizard';
import { showCurriculumAlert } from '@/components/feature/CurriculumSweetAlert';
import { curriculumNavItems } from '@/mocks/navigation';
import type {
  CurriculumComponent,
  CurriculumGroup,
  CurriculumKsbEntry,
  CurriculumModule,
  CurriculumOverview,
  CurriculumProgramme,
  CurriculumProgrammeDetail,
  CurriculumProgrammeInput,
  CurriculumSession,
  CurriculumStaffProfile,
  CurriculumHoliday,
  CurriculumKsbCoverageResponse,
  CurriculumKsbCoverageStatus,
  CurriculumKsbSet,
  CurriculumStandard,
} from '@/lib/curriculumApi';
import {
  fetchCurriculumComponents,
  fetchCurriculumProgrammes,
  fetchCurriculumProgrammeDetail,
  fetchCurriculumProgrammeKsbCoverage,
  fetchCurriculumKsbSets,
  fetchCurriculumKsbFrameworks,
  fetchCurriculumCoaches,
  fetchCurriculumHolidays,
  fetchCurriculumStandards,
  fetchCurriculumTutors,
  updateCurriculumProgramme,
} from '@/lib/curriculumApi';
import {
  type KsbMapping,
  type ModuleCatalogueItem as AuthoringModule,
  type TeamsMeetingArtifactsResult,
  loadTeamsMeetingArtifacts,
  syncTeamsMeetingArtifacts,
  teamsMeetingArtifactContentUrl,
} from '../module-builder/moduleAuthoringData';

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
// Types Ã¢â‚¬â€ Full Programme Hierarchy
// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

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
  status?: CurriculumKsbCoverageStatus | string;
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
  endDate: string;
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
  staffing: { coach: string; tutor: string; groups: string; cohorts: string; status: string; role: string }[];
}

type ProgrammeFormState = Required<Pick<CurriculumProgrammeInput, 'name' | 'standard' | 'level' | 'owner' | 'color' | 'description'>>;
// A delivery session shown on the Sessions tab, derived from real week-builder
// components: `live-session` components are Live, `video` components are Recorded.
type DeliverySessionKind = 'live' | 'recorded';
interface DeliverySession {
  id: string;
  kind: DeliverySessionKind;
  title: string;
  module: string;
  week: number;
  weekTitle: string;
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

// Classify a component as a Live session or a Recorded video. NOTE: the
// `/curriculum/components/` list endpoint returns a *display* type Ã¢â‚¬â€ live-session
// becomes "Live Session" but video/podcast/reading/powerpoint all collapse to
// "Self-study" Ã¢â‚¬â€ so `type` alone can't isolate video. We match on the tolerant
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

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
// Type badge colours
// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

const componentStatusColors: Record<string, string> = {
  published: 'bg-emerald-50 text-emerald-700 border-emerald-200/60',
  scheduled: 'bg-sky-50 text-sky-700 border-sky-200/60',
  review: 'bg-amber-50 text-amber-700 border-amber-200/60',
  draft: 'bg-foreground-100 text-foreground-500 border-foreground-200/60',
};

const moduleStatusColors: Record<string, string> = {
  published: 'bg-emerald-50 text-emerald-700 border-emerald-200/50',
  approved: 'bg-sky-50 text-sky-700 border-sky-200/50',
  'in-review': 'bg-amber-50 text-amber-700 border-amber-200/50',
  draft: 'bg-foreground-100 text-foreground-500 border-foreground-200/50',
};

const EMPTY_MODULE: Module = {
  id: 'no-modules',
  name: 'No modules found',
  description: 'No live modules are currently linked to this programme.',
  weeks: 0,
  otjh: 0,
  status: 'draft',
  ksbTags: [],
  ksbMapping: [],
  weeksData: [],
};

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
  staffing: [],
};

function clean(value: unknown, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function normalise(value: unknown) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function slugify(value: unknown) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'item';
}

function staffProfileName(profile: CurriculumStaffProfile) {
  return clean(profile.name || profile.Tutor_name || profile.Coach_name || profile.email);
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

function ksbParentCode(code: string) {
  const formatted = formatKsbCode(code);
  const match = formatted.match(/^([KSB])(\d+)(?:\.\d+)?$/);
  return match ? `${match[1]}${match[2]}` : formatted;
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

function authoringGroupLabels(module: AuthoringModule, component?: { settings?: Record<string, unknown> }) {
  const settings = component?.settings || {};
  const names = Array.isArray(settings.selectedGroupNames) ? settings.selectedGroupNames : [];
  const keys = Array.isArray(settings.selectedGroupKeys) ? settings.selectedGroupKeys : [];
  const fallback = [module.group, module.groupId];
  return displayGroupValues([...names, ...(names.length ? [] : keys), ...(names.length || keys.length ? [] : fallback)]);
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

function collectAuthoringKsbRollup(module: AuthoringModule | null): KsbRollupItem[] {
  if (!module) return [];
  const rollup = new Map<string, KsbRollupItem>();
  const moduleName = clean(module.title, module.catalogueId);
  module.moduleKsbMappings.forEach(mapping => addKsbRollupMapping(rollup, mapping, {
    module: moduleName,
    scope: 'module',
    classification: mapping.classification || mapping.type,
    groups: authoringGroupLabels(module),
    weight: clampCoverageWeight(mapping.weight),
  }));
  module.weekStructure.forEach(week => {
    const weekLabel = `Week ${week.weekNumber}${week.title ? ` - ${week.title}` : ''}`;
    week.ksbMappings.forEach(mapping => addKsbRollupMapping(rollup, mapping, {
      module: moduleName,
      scope: 'week',
      week: weekLabel,
      classification: mapping.classification || mapping.type,
      groups: authoringGroupLabels(module),
      weight: clampCoverageWeight(mapping.weight),
    }));
    week.components.forEach(component => {
      component.ksbMappings.forEach(mapping => addKsbRollupMapping(rollup, mapping, {
        module: moduleName,
        scope: 'component',
        week: weekLabel,
        component: clean(component.title, component.type),
        componentType: component.type,
        classification: mapping.classification || mapping.type,
        groups: authoringGroupLabels(module, component),
        weight: clampCoverageWeight(mapping.weight),
      }));
    });
  });
  return [...rollup.values()]
    .map(item => ({ ...item, weight: clampCoverageWeight(item.weight) }))
    .sort((left, right) => sortKsbCodes(left.ksb, right.ksb));
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
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    if (!programmeId) {
      setData(null);
      setLoading(false);
      return null;
    }
    setLoading(true);
    try {
      const detail = await fetchCurriculumProgrammeDetail(programmeId, signal);
      if (signal?.aborted) return null;
      const overview = programmeDetailToOverview(detail);
      setData(overview);
      setError(null);
      setLoading(false);

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
      setData(null);
      return null;
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [programmeId]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  return { data, loading, error, reload: () => load() };
}

function programmeCoverageIdCandidates(programme: Programme, routeId: string) {
  const withoutRoutePrefix = clean(routeId).replace(/^program-/i, '');
  const candidates = [
    programme.sourceId,
    programme.id,
    withoutRoutePrefix,
    routeId,
    programme.name,
  ].map(value => clean(value)).filter(Boolean);
  const seen = new Set<string>();
  return candidates.filter(candidate => {
    const key = normalise(candidate);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function findLinkedSkillsStandard(programme: Programme, standards: CurriculumStandard[]) {
  const candidateValues = [
    programme.standard,
    programme.sourceId,
    programme.id,
    programme.name,
  ].map(value => clean(value)).filter(Boolean);
  const candidateKeys = new Set(candidateValues.map(normalise).filter(Boolean));
  if (!candidateKeys.size) return null;
  return standards.find(standard => {
    const standardValues = [
      standard.id,
      standard.code,
      standard.standardRef,
      standard.name,
      standard.larsCode,
      `${standard.code} v${standard.version}`,
      `${standard.standardRef} v${standard.version}`,
    ];
    return standardValues.some(value => candidateKeys.has(normalise(value)));
  }) ?? null;
}

function rawSkillsStandardIdentifier(programme: Programme) {
  const value = clean(programme.standard);
  if (!value || /^standard not set$/i.test(value)) return '';
  if (/^standard:/i.test(value)) return value.replace(/^standard:/i, '').trim();
  if (/^ST\d+/i.test(value)) return value;
  return '';
}

function coverageResponseScore(coverage: CurriculumKsbCoverageResponse | null) {
  if (!coverage) return -1;
  const rowCount = coverage.heatmap?.rows?.length || coverage.items?.length || 0;
  const moduleCount = coverage.heatmap?.modules?.length || 0;
  const mappingCount = (coverage.items || []).reduce((total, item) => total + Number(item.mappingCount ?? item.mapping_count ?? item.mappings?.length ?? 0), 0);
  const totalWeight = (coverage.items || []).reduce((total, item) => total + Number(item.rawTotalWeight ?? item.raw_total_weight ?? item.coveragePercentage ?? item.coverage_percentage ?? 0), 0);
  return rowCount * 10000 + moduleCount * 1000 + mappingCount * 100 + totalWeight;
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
      title: clean(authoredWeek?.title) || weekTitle || first?.title || `Week ${weekNumber}`,
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
      description: [liveModule.cohort, liveModule.group].filter(Boolean).join(' - ') || liveModule.notes || `${liveModule.name} linked to ${source.name}.`,
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

  const existingCohortKeys = new Set(cohorts.flatMap(cohort => [normalise(cohort.id), normalise(cohort.name)]));
  const supplementalCohortGroups = new Map<string, { id: string; name: string; modules: Module[] }>();
  modules.forEach(module => {
    if (!module.cohort || existingCohortKeys.has(normalise(module.cohortId || module.cohort))) return;
    const cohortId = module.cohortId || `${source.id}-${slugify(module.cohort)}`;
    const groupId = module.groupId || `${cohortId}-${slugify(module.group || 'group')}`;
    const key = `${cohortId}|${module.group || 'Group'}`;
    const entry = supplementalCohortGroups.get(key) ?? { id: groupId, name: module.group || 'Group', modules: [] };
    entry.modules.push(module);
    supplementalCohortGroups.set(key, entry);
  });
  const supplementalCohortsById = new Map<string, Cohort>();
  supplementalCohortGroups.forEach(group => {
    const firstModule = group.modules[0];
    const cohortId = firstModule.cohortId || `${source.id}-${slugify(firstModule.cohort || 'cohort')}`;
    const cohortEntry = supplementalCohortsById.get(cohortId) ?? {
      id: cohortId,
      name: firstModule.cohort || 'Cohort',
      startDate: formatDateLabel(firstModule.weeksData[0]?.startDate || ''),
      endDate: formatDateLabel(firstModule.weeksData.at(-1)?.endDate || ''),
      status: 'active' as const,
      learners: 0,
      holidayIds: [],
      holidays: [],
      groups: [],
    };
    cohortEntry.groups.push({
        id: group.id,
        name: group.name,
        learners: 0,
        coach: firstModule.coach || 'Unassigned',
        tutor: firstModule.tutor || 'Unassigned',
        startDate: formatDateLabel(firstModule.weeksData[0]?.startDate || ''),
        endDate: formatDateLabel(firstModule.weeksData.at(-1)?.endDate || ''),
        status: 'active' as const,
        schedule: 'TBD',
        mode: 'Live',
        modules: group.modules,
      });
    supplementalCohortsById.set(cohortId, cohortEntry);
  });
  const supplementalCohorts = [...supplementalCohortsById.values()];
  const allCohorts = [...cohorts, ...supplementalCohorts];
  const deliveryStart = programmeCohorts.map(cohort => clean(cohort.startDate)).filter(Boolean).sort()[0] || '';
  const deliveryEnd = programmeCohorts.map(cohort => clean(cohort.endDate)).filter(Boolean).sort().at(-1) || '';
  const deliveryWindow = [
    deliveryStart ? formatDateLabel(deliveryStart) : '',
    deliveryEnd ? formatDateLabel(deliveryEnd) : '',
  ].filter(Boolean).join(' â€“ ');

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
  const staffMap = new Map<string, { coach: string; tutor: string; groups: Set<string>; cohorts: Set<string> }>();
  allCohorts.flatMap(cohort => cohort.groups.map(group => ({ cohort, group }))).forEach(({ cohort, group }) => {
    const key = `${group.coach}|${group.tutor}`;
    const entry = staffMap.get(key) ?? { coach: group.coach, tutor: group.tutor, groups: new Set<string>(), cohorts: new Set<string>() };
    entry.groups.add(group.name);
    entry.cohorts.add(cohort.name);
    staffMap.set(key, entry);
  });

  return {
    found: true,
    programme: {
      id: source.id,
      sourceId: String(source.sourceId || ''),
      ksbProfileSourceId: clean(source.ksbProfileSourceId),
      name: source.name,
      standard: source.standard,
      level: source.level || 'Level not set',
      owner: source.owner || '',
      color: source.color || '#6941c6',
      description: source.description || `${deliveryWindow || source.standard} curriculum plan.`,
      duration: deliveryWindow || 'Live curriculum',
      cohorts: allCohorts,
      modules,
      ksbHeatmap,
      moduleNames,
      staffing: [...staffMap.values()].map(entry => ({
        coach: entry.coach,
        tutor: entry.tutor,
        groups: [...entry.groups].join(', '),
        cohorts: [...entry.cohorts].join(', '),
        status: entry.coach === 'Unassigned' || entry.tutor === 'Unassigned' ? 'unassigned' : 'active',
        role: 'Coach / Tutor',
      })),
    },
  };
}

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
// Component
// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

export default function ProgrammeDetailPage() {
  const { id } = useParams();
  const { data, loading, error, reload } = useProgrammeDetailData(id || '');
  const [detailComponents, setDetailComponents] = useState<CurriculumComponent[]>([]);
  const hydratedData = useMemo(() => data ? { ...data, components: detailComponents } : data, [data, detailComponents]);
  const { programme: liveProgramme, found } = useMemo(() => buildLiveProgramme(hydratedData, id || ''), [hydratedData, id]);
  const [backendCoverage, setBackendCoverage] = useState<CurriculumKsbCoverageResponse | null>(null);
  const [backendCoverageLoading, setBackendCoverageLoading] = useState(false);
  const [backendCoverageError, setBackendCoverageError] = useState<string | null>(null);
  const [programmeKsbSets, setProgrammeKsbSets] = useState<CurriculumKsbSet[]>([]);
  const [skillsStandards, setSkillsStandards] = useState<CurriculumStandard[]>([]);
  const [skillsStandardsLoading, setSkillsStandardsLoading] = useState(false);
  const coverageRequestKeyRef = useRef('');
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
  const [tab, setTab] = useState<'cohorts' | 'groups' | 'modules' | 'weeks' | 'sessions' | 'ksb' | 'review'>('cohorts');
  const [selectedCohort, setSelectedCohort] = useState<string>(PROGRAMME.cohorts[0]?.id || '');
  const [selectedGroup, setSelectedGroup] = useState<string>('');
  const [selectedModule, setSelectedModule] = useState<string>(PROGRAMME.modules[0]?.id || '');
  const [selectedWeek, setSelectedWeek] = useState<string>(PROGRAMME.modules[0]?.weeksData[0]?.id || '');
  const [sessionKind, setSessionKind] = useState<'live' | 'recorded'>('live');
  const [cohortSearch, setCohortSearch] = useState<string>('');
  const [cohortStatusFilter, setCohortStatusFilter] = useState<string>('all');
  const [groupSearch, setGroupSearch] = useState<string>('');
  const [groupCohortFilter, setGroupCohortFilter] = useState<string>('all');
  const [groupStatusFilter, setGroupStatusFilter] = useState<string>('all');
  const [moduleSearch, setModuleSearch] = useState<string>('');
  const [moduleCohortFilter, setModuleCohortFilter] = useState<string>('all');
  const [moduleGroupFilter, setModuleGroupFilter] = useState<string>('all');
  const [sessionSearch, setSessionSearch] = useState<string>('');
  const [sessionModuleFilter, setSessionModuleFilter] = useState<string>('all');
  const [sessionPage, setSessionPage] = useState<number>(1);
  const [sessionPageSize, setSessionPageSize] = useState<number>(25);
  const [ksbSearch, setKsbSearch] = useState<string>('');
  const [ksbTraceOpen, setKsbTraceOpen] = useState(false);
  const [ksbTraceInitialTab, setKsbTraceInitialTab] = useState<'map' | 'coverage' | 'trace'>('coverage');
  const [expandedCohort, setExpandedCohort] = useState<string | null>(null);
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [expandedModuleWeek, setExpandedModuleWeek] = useState<string | null>(null);
  const [programmeFormOpen, setProgrammeFormOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardContext, setWizardContext] = useState<{ cohortId?: string; groupId?: string; startStep?: 'programme' | 'cohort' | 'group' | 'modules' | 'review' }>({});
  const [programmeForm, setProgrammeForm] = useState<ProgrammeFormState>({ name: '', standard: '', level: '', owner: '', color: '#6941c6', description: '' });
  const [savingAction, setSavingAction] = useState<string | null>(null);
  const [teamsSyncingId, setTeamsSyncingId] = useState('');
  const [teamsSyncMessages, setTeamsSyncMessages] = useState<Record<string, string>>({});
  const [teamsResults, setTeamsResults] = useState<Record<string, TeamsMeetingArtifactsResult>>({});
  const [teamsResultsOpen, setTeamsResultsOpen] = useState<Record<string, boolean>>({});
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
    [liveProgramme.id, liveProgramme.ksbProfileSourceId, liveProgramme.name, liveProgramme.sourceId, liveProgramme.standard, programmeKsbSets, skillsStandards],
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

  useEffect(() => {
    if (tab !== 'ksb' && !ksbTraceOpen) return;
    const coverageKey = [coverageProgrammeIds.join('|'), coverageKsbSource.sourceType || '', coverageKsbSource.sourceId || ''].join('::');
    if (!coverageKey || coverageRequestKeyRef.current === coverageKey) return;
    coverageRequestKeyRef.current = coverageKey;
    const controller = new AbortController();
    void loadBackendCoverage(controller.signal);
    return () => {
      controller.abort();
      if (coverageRequestKeyRef.current === coverageKey) coverageRequestKeyRef.current = '';
    };
  }, [coverageKsbSource.sourceId, coverageKsbSource.sourceType, coverageProgrammeIds, ksbTraceOpen, loadBackendCoverage, tab]);

  useEffect(() => {
    setDetailComponents([]);
    componentsRequestKeyRef.current = '';
    coverageRequestKeyRef.current = '';
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
    if (tab !== 'ksb' && !ksbTraceOpen) return undefined;
    if (programmeKsbSets.length) return undefined;
    const controller = new AbortController();
    fetchCurriculumKsbSets(controller.signal)
      .then(setProgrammeKsbSets)
      .catch(error => {
        if (!controller.signal.aborted) console.warn('Unable to load KSB profiles for programme descriptions.', error);
      });
    return () => controller.abort();
  }, [ksbTraceOpen, programmeKsbSets.length, tab]);

  useEffect(() => {
    if (tab !== 'ksb' && !ksbTraceOpen) return undefined;
    if (skillsStandards.length) return undefined;
    const controller = new AbortController();
    setSkillsStandardsLoading(true);
    fetchCurriculumStandards(controller.signal)
      .then(setSkillsStandards)
      .catch(error => {
        if (!controller.signal.aborted) console.warn('Unable to load Skills England standards for programme link.', error);
      })
      .finally(() => {
        if (!controller.signal.aborted) setSkillsStandardsLoading(false);
      });
    return () => controller.abort();
  }, [ksbTraceOpen, skillsStandards.length, tab]);

  useEffect(() => {
    if (PROGRAMME.cohorts.length > 0 && !PROGRAMME.cohorts.some(c => c.id === selectedCohort)) {
      setSelectedCohort(PROGRAMME.cohorts[0].id);
    }
  }, [PROGRAMME.cohorts, selectedCohort]);

  useEffect(() => {
    if (PROGRAMME.modules.length > 0 && !PROGRAMME.modules.some(m => m.id === selectedModule)) {
      setSelectedModule(PROGRAMME.modules[0].id);
      setSelectedWeek(PROGRAMME.modules[0].weeksData[0]?.id || '');
    }
  }, [PROGRAMME.modules, selectedModule]);

  useEffect(() => {
    setSessionPage(1);
  }, [sessionSearch, sessionModuleFilter, sessionKind, sessionPageSize]);

  const cohort = PROGRAMME.cohorts.find(c => c.id === selectedCohort) || PROGRAMME.cohorts[0];
  const module = PROGRAMME.modules.find(m => m.id === selectedModule) || PROGRAMME.modules[0] || EMPTY_MODULE;
  const week = module?.weeksData.find(w => w.id === selectedWeek) || module?.weeksData[0];
  const allGroups = useMemo(() => PROGRAMME.cohorts.flatMap(cohortItem => (
    cohortItem.groups.map(group => ({ cohort: cohortItem, group }))
  )), [PROGRAMME.cohorts]);
  const filteredCohorts = useMemo(() => {
    const query = normalise(cohortSearch);
    return PROGRAMME.cohorts.filter(cohortItem => {
      const matchesSearch = !query || [cohortItem.name, cohortItem.status, cohortItem.startDate, cohortItem.endDate].some(value => normalise(value).includes(query));
      const matchesStatus = cohortStatusFilter === 'all' || cohortItem.status === cohortStatusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [PROGRAMME.cohorts, cohortSearch, cohortStatusFilter]);
  const filteredGroups = useMemo(() => {
    const query = normalise(groupSearch);
    return allGroups.filter(({ cohort: cohortItem, group }) => {
      const matchesSearch = !query || [group.name, cohortItem.name, group.coach, group.tutor, group.schedule, group.mode, group.status].some(value => normalise(value).includes(query));
      const matchesCohort = groupCohortFilter === 'all' || cohortItem.id === groupCohortFilter;
      const matchesStatus = groupStatusFilter === 'all' || group.status === groupStatusFilter;
      return matchesSearch && matchesCohort && matchesStatus;
    });
  }, [allGroups, groupSearch, groupCohortFilter, groupStatusFilter]);
  const moduleCohorts = useMemo(() => [...new Set(PROGRAMME.modules.map(m => clean(m.cohort)).filter(Boolean))].sort(), [PROGRAMME.modules]);
  const moduleGroups = useMemo(() => [...new Set(PROGRAMME.modules.map(m => clean(m.group)).filter(Boolean))].sort(), [PROGRAMME.modules]);
  const filteredModules = useMemo(() => {
    const query = normalise(moduleSearch);
    return PROGRAMME.modules.filter(mod => {
      const matchesSearch = !query || [mod.name, mod.description, mod.cohort, mod.group, ...mod.ksbTags].some(value => normalise(value).includes(query));
      const matchesCohort = moduleCohortFilter === 'all' || clean(mod.cohort) === moduleCohortFilter;
      const matchesGroup = moduleGroupFilter === 'all' || clean(mod.group) === moduleGroupFilter;
      return matchesSearch && matchesCohort && matchesGroup;
    });
  }, [PROGRAMME.modules, moduleSearch, moduleCohortFilter, moduleGroupFilter]);
  const filteredWeeks = module.weeksData;
  const weekModuleOptions = PROGRAMME.modules;

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
          const sessionUrl = clean(settings.liveSessionUrl || settings.videoUrl || settings.embedCode);
          const groupNames = Array.isArray(settings.selectedGroupNames)
            ? (settings.selectedGroupNames as unknown[]).map(value => clean(value)).filter(Boolean)
            : [];
          rows.push({
            id: component.id,
            kind,
            title: clean(component.title, kind === 'live' ? 'Live session' : 'Recorded video'),
            module: mod.name,
            week: wk.number,
            weekTitle: clean(wk.title, `Week ${wk.number}`),
            date: clean(settings.sessionDate) || clean(wk.startDate),
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
  const sessionModules = useMemo(() => [...new Set(activeSessions.map(session => session.module).filter(Boolean))].sort(), [activeSessions]);
  const filteredSessions = useMemo(() => {
    const query = normalise(sessionSearch);
    return activeSessions.filter(session => {
      const matchesModule = sessionModuleFilter === 'all' || session.module === sessionModuleFilter;
      const matchesSearch = !query || [session.title, session.module, session.weekTitle, session.provider, session.date, session.time, ...session.groups, ...session.ksbRefs].some(value => normalise(value).includes(query));
      return matchesModule && matchesSearch;
    });
  }, [activeSessions, sessionModuleFilter, sessionSearch]);
  const sessionPageCount = Math.max(1, Math.ceil(filteredSessions.length / sessionPageSize));
  const currentSessionPage = Math.min(sessionPage, sessionPageCount);
  const sessionStartIndex = (currentSessionPage - 1) * sessionPageSize;
  const pagedSessions = filteredSessions.slice(sessionStartIndex, sessionStartIndex + sessionPageSize);
  const filteredKsbHeatmap = useMemo(() => {
    const query = normalise(ksbSearch);
    return PROGRAMME.ksbHeatmap.filter(row => !query || [row.ksb, formatKsbCode(row.ksb), row.title, ksbSourceLabel(row)].some(value => normalise(value).includes(query)));
  }, [PROGRAMME.ksbHeatmap, ksbSearch]);
  const totalSessions = deliverySessions.length;
  const allComponents = PROGRAMME.modules.flatMap(m => m.weeksData.flatMap(w => w.components || []));
  const publishedComponents = allComponents.filter(c => c.status === 'published').length;
  const contentReadiness = allComponents.length ? Math.round((publishedComponents / allComponents.length) * 100) : 0;
  const totalOtjh = PROGRAMME.modules.reduce((a, m) => a + m.otjh, 0);
  const totalLearners = PROGRAMME.cohorts.reduce((a, c) => a + c.learners, 0);
  const totalGroups = PROGRAMME.cohorts.reduce((a, c) => a + c.groups.length, 0);
  const totalWeeks = PROGRAMME.modules.reduce((a, m) => a + m.weeksData.length, 0);
  const fullyCoveredKsbCount = PROGRAMME.ksbHeatmap.filter(row => ksbCoverageState(row) === 'fully_covered').length;
  const partialKsbCount = PROGRAMME.ksbHeatmap.filter(row => ['partial', 'over_allocated'].includes(ksbCoverageState(row))).length;
  const mappedNoWeightKsbCount = PROGRAMME.ksbHeatmap.filter(row => ksbCoverageState(row) === 'mapped').length;
  const ksbCoverage = PROGRAMME.ksbHeatmap.length
    ? Math.round(((fullyCoveredKsbCount + partialKsbCount + mappedNoWeightKsbCount) / PROGRAMME.ksbHeatmap.length) * 100)
    : 0;
  const missingKsbCount = PROGRAMME.ksbHeatmap.filter(row => ksbCoverageState(row) === 'missing').length;
  const totalKsbOccurrences = PROGRAMME.ksbHeatmap.reduce((total, row) => total + Number(row.totalOccurrences || 0), 0);
  const programmeHealth = Math.round((ksbCoverage + contentReadiness) / 2);
  const openKsbTrace = (initialTab: 'map' | 'coverage' | 'trace') => {
    setKsbTraceInitialTab(initialTab);
    setKsbTraceOpen(true);
  };
  const linkedSkillsStandard = useMemo(() => findLinkedSkillsStandard(PROGRAMME, skillsStandards), [PROGRAMME, skillsStandards]);
  const skillsStandardTarget = linkedSkillsStandard?.id || rawSkillsStandardIdentifier(PROGRAMME);
  const openSkillsStandard = () => {
    window.REACT_APP_NAVIGATE(skillsStandardTarget ? `/curriculum/standards/${encodeURIComponent(skillsStandardTarget)}` : '/curriculum/standards');
  };
  const wizardProgramme = useMemo<CurriculumProgramme>(() => ({
    id: PROGRAMME.id,
    sourceId: PROGRAMME.sourceId || PROGRAMME.id,
    name: PROGRAMME.name,
    standard: PROGRAMME.standard,
    level: PROGRAMME.level,
    modules: PROGRAMME.modules.length,
    weeks: totalWeeks,
    ksbMapped: fullyCoveredKsbCount + partialKsbCount + mappedNoWeightKsbCount,
    ksbTotal: PROGRAMME.ksbHeatmap.length,
    learners: totalLearners,
    cohorts: PROGRAMME.cohorts.length,
    groups: totalGroups,
    lastUpdated: '',
    owner: PROGRAMME.owner,
    color: PROGRAMME.color,
    description: PROGRAMME.description,
    ksbProfileSourceId: PROGRAMME.ksbProfileSourceId,
  }), [PROGRAMME, fullyCoveredKsbCount, mappedNoWeightKsbCount, partialKsbCount, totalGroups, totalLearners, totalWeeks]);

  const openProgrammeForm = () => {
    setProgrammeForm({
      name: PROGRAMME.name,
      standard: PROGRAMME.standard,
      level: PROGRAMME.level,
      owner: PROGRAMME.owner,
      color: PROGRAMME.color,
      description: PROGRAMME.description,
    });
    setProgrammeFormOpen(true);
  };

  const openStructureWizard = (context: { cohortId?: string; groupId?: string; startStep?: 'programme' | 'cohort' | 'group' | 'modules' | 'review' } = {}) => {
    setWizardContext(context);
    setWizardOpen(true);
  };

  const saveProgramme = async (event: FormEvent) => {
    event.preventDefault();
    if (!programmeForm.name.trim()) {
      await showCurriculumAlert({
        title: 'Programme name required',
        text: 'Enter a programme name before saving.',
        icon: 'warning',
      });
      return;
    }
    setSavingAction('programme');
    try {
      await updateCurriculumProgramme(id || PROGRAMME.id, programmeForm);
      await showCurriculumAlert({
        title: 'Programme updated',
        text: 'The programme header has been refreshed from the database.',
        icon: 'success',
        timer: 1600,
      });
      setProgrammeFormOpen(false);
      reload();
    } catch (err) {
      await showCurriculumAlert({
        title: 'Unable to update programme',
        text: err instanceof Error ? err.message : 'The programme could not be saved.',
        icon: 'error',
      });
    } finally {
      setSavingAction(null);
    }
  };

  const tabs = [
    { key: 'cohorts' as const, label: 'Cohorts', icon: 'ri-group-line' },
    { key: 'groups' as const, label: 'Groups', icon: 'ri-team-line' },
    { key: 'modules' as const, label: 'Modules', icon: 'ri-stack-line' },
    { key: 'weeks' as const, label: 'Weeks', icon: 'ri-calendar-line' },
    { key: 'sessions' as const, label: 'Sessions', icon: 'ri-time-line' },
    { key: 'ksb' as const, label: 'KSB Heatmap', icon: 'ri-bar-chart-line' },
    { key: 'review' as const, label: 'Review', icon: 'ri-checkbox-circle-line' },
  ];

  if (loading) {
    return (
      <WorkspaceShell role="curriculum" roleLabel="Curriculum Designer" navItems={curriculumNavItems} workspaceLabel="Curriculum Studio" pageTitle="Programme loading" pageSubtitle="Preparing live curriculum data from the database" userName="Rachel Myers" userRole="Curriculum Designer">
        <div className="p-6 space-y-6">
          <div className="bg-background-50 rounded-2xl border border-primary-200/70 p-5 sm:p-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-start gap-4">
                <span className="w-11 h-11 rounded-xl bg-primary-100 text-primary-700 flex items-center justify-center shrink-0">
                  <AppIcon className="ri-database-2-line text-lg"></AppIcon>
                </span>
                <div>
                  <p className="text-[11px] font-semibold text-primary-600 uppercase tracking-wider mb-1">Live database sync</p>
                  <h1 className="text-xl font-heading font-bold text-foreground-900">Loading programme structure</h1>
                  <p className="text-[13px] text-foreground-500 mt-1">Cohorts, groups, modules, weeks and sessions are being prepared.</p>
                </div>
              </div>
              <button disabled className="px-4 py-2.5 bg-primary-500 text-white rounded-xl text-[12px] font-semibold cursor-wait whitespace-nowrap flex items-center gap-2">
                <AppIcon className="ri-loader-4-line animate-spin text-sm"></AppIcon>
                Process in progress
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-5 pt-4 border-t border-foreground-200/60">
              {['Cohorts', 'Groups', 'Learners', 'Modules', 'Total OTJH'].map(label => (
                <LoadingStatPill key={label} label={label} />
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2 rounded-xl bg-background-100 p-2 overflow-hidden">
            {['Cohorts', 'Groups', 'Modules', 'Weeks', 'Sessions'].map(label => (
              <div key={label} className="h-8 w-24 rounded-lg bg-background-50 border border-foreground-200/50 animate-pulse" />
            ))}
          </div>

          <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5 space-y-4">
            <div className="h-4 w-40 rounded bg-background-200 animate-pulse" />
            <div className="h-3 w-full max-w-3xl rounded bg-background-200 animate-pulse" />
            <div className="h-3 w-full max-w-2xl rounded bg-background-200 animate-pulse" />
            <div className="h-3 w-full max-w-xl rounded bg-background-200 animate-pulse" />
          </div>
        </div>
      </WorkspaceShell>
    );
  }

  if (error || !found) {
    return (
      <WorkspaceShell role="curriculum" roleLabel="Curriculum Designer" navItems={curriculumNavItems} workspaceLabel="Curriculum Studio" pageTitle="Programme unavailable" pageSubtitle="The requested curriculum programme could not be opened" userName="Rachel Myers" userRole="Curriculum Designer">
        <div className="flex min-h-[65vh] items-center justify-center bg-[linear-gradient(180deg,#fbfcff_0%,#f4f6fa_100%)] p-6">
          <div className="w-full max-w-lg rounded-2xl border border-foreground-200/70 bg-background-50 p-7 text-center shadow-sm">
            <span className={`mx-auto flex h-12 w-12 items-center justify-center rounded-2xl ${error ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-600'}`}>
              <AppIcon className={`${error ? 'ri-wifi-off-line' : 'ri-folder-warning-line'} text-xl`}></AppIcon>
            </span>
            <h1 className="mt-4 text-lg font-heading font-black text-foreground-950">{error ? 'Unable to load programme data' : 'Programme not found'}</h1>
            <p className="mt-2 text-[13px] leading-6 text-foreground-500">
              {error || `There is no live curriculum programme matching "${id || 'this route'}". It may have been renamed or removed.`}
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <button onClick={() => window.REACT_APP_NAVIGATE('/curriculum/programmes')} className="inline-flex h-10 items-center gap-2 rounded-xl border border-foreground-200 bg-background-50 px-4 text-[12px] font-bold text-foreground-700 hover:bg-background-100">
                <AppIcon className="ri-arrow-left-line"></AppIcon> All programmes
              </button>
              {error && (
                <button onClick={() => void reload()} className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary-600 px-4 text-[12px] font-bold text-white hover:bg-primary-700">
                  <AppIcon className="ri-refresh-line"></AppIcon> Try again
                </button>
              )}
            </div>
          </div>
        </div>
      </WorkspaceShell>
    );
  }

  return (
    <WorkspaceShell role="curriculum" roleLabel="Curriculum Designer" navItems={curriculumNavItems} workspaceLabel="Curriculum Studio" pageTitle={PROGRAMME.name} pageSubtitle={`${PROGRAMME.duration} Â· ${PROGRAMME.cohorts.length} cohorts Â· ${PROGRAMME.modules.length} modules`} userName="Rachel Myers" userRole="Curriculum Designer">
      <div className="min-h-screen space-y-5 bg-[linear-gradient(180deg,#fbfcff_0%,#f7f8fb_46%,#f3f5f8_100%)] p-5 sm:p-6">
        <section className="relative overflow-hidden rounded-2xl border border-foreground-200/70 bg-background-50 shadow-sm">
          {/* Signature: an accent bar tinted with this programme's own colour identity */}
          <div className="absolute inset-y-0 left-0 w-1.5" style={{ backgroundColor: PROGRAMME.color || 'oklch(var(--primary-500))' }} aria-hidden="true" />
          <div className="p-5 pl-6 sm:p-6 sm:pl-7">
            <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
              <div className="min-w-0">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-2 rounded-full border border-primary-100 bg-primary-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-primary-700">
                    <AppIcon className="ri-database-2-line text-xs"></AppIcon>
                    Live programme
                  </span>
                  <span className="rounded-full border border-foreground-200 bg-background-100 px-2.5 py-1 text-[10px] font-bold uppercase text-foreground-600">{PROGRAMME.level || 'Level not set'}</span>
                </div>
                <h1 className="text-2xl font-heading font-black leading-tight tracking-tight text-foreground-950">{PROGRAMME.name}</h1>
                <p className="mt-1 max-w-4xl text-[13px] leading-6 text-foreground-500">{PROGRAMME.description}</p>
              </div>

              <div className="flex flex-col items-start gap-4 xl:items-end">
                <div className="flex items-center gap-3">
                  <HealthRing value={programmeHealth} color={PROGRAMME.color} />
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-foreground-400">Programme health</p>
                    <p className="text-[12px] text-foreground-500">KSB {ksbCoverage}% Â· Content {contentReadiness}%</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 xl:justify-end">
                  <button onClick={() => openStructureWizard({ startStep: 'cohort' })} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-primary-200 bg-primary-50 px-4 text-[12px] font-bold text-primary-700 transition-smooth hover:bg-primary-100">
                    <AppIcon className="ri-add-line text-sm"></AppIcon>
                    Add structure
                  </button>
                  <button onClick={() => openStructureWizard({ startStep: 'programme' })} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-primary-600 px-4 text-[12px] font-bold text-white transition-smooth hover:bg-primary-700">
                    <AppIcon className="ri-edit-line text-sm"></AppIcon>
                    Edit programme
                  </button>
                  <button onClick={openSkillsStandard} disabled={skillsStandardsLoading && !skillsStandardTarget} title={skillsStandardTarget ? 'Open the linked Skills England standard' : 'No linked Skills England standard found for this programme'} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-foreground-200 bg-background-50 px-4 text-[12px] font-bold text-foreground-700 transition-smooth hover:bg-background-100 disabled:cursor-wait disabled:opacity-60">
                    <AppIcon className="ri-file-list-3-line text-sm"></AppIcon>
                    {skillsStandardTarget ? 'View Standard' : skillsStandardsLoading ? 'Checking Standard' : 'Browse Standards'}
                  </button>
                </div>
              </div>
            </div>

            {/* Live KPI rail Ã¢â‚¬â€ every value computed from the fetched programme data */}
            <div className="mt-5 grid grid-cols-2 gap-3 border-t border-foreground-200/60 pt-4 sm:grid-cols-3 xl:grid-cols-6">
              <StatPill icon="ri-group-line" value={PROGRAMME.cohorts.length} label="Cohorts" />
              <StatPill icon="ri-team-line" value={totalGroups} label="Groups" />
              <StatPill icon="ri-graduation-cap-line" value={totalLearners} label="Learners" />
              <StatPill icon="ri-stack-line" value={PROGRAMME.modules.length} label="Modules" />
              <StatPill icon="ri-time-line" value={`${totalOtjh}h`} label="Total OTJH" />
              <StatPill icon="ri-broadcast-line" value={totalSessions} label="Sessions" />
            </div>
          </div>
        </section>

        {/* Programme Navigation */}
        <div className="sticky top-0 z-20 flex items-center gap-2 overflow-x-auto rounded-2xl border border-foreground-200/70 bg-background-50/95 p-1.5 shadow-sm backdrop-blur">
          <div className="flex items-center gap-1.5">
            {tabs.map(t => (
              <button key={t.key} onClick={() => setTab(t.key)} className={`group inline-flex min-h-10 items-center gap-2 rounded-xl px-3 py-1.5 text-[12px] font-bold transition-smooth whitespace-nowrap cursor-pointer ${tab === t.key ? 'bg-primary-600 text-white shadow-sm' : 'text-foreground-600 hover:bg-background-100 hover:text-foreground-900'}`}>
                <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${tab === t.key ? 'bg-white/[0.16] text-white' : 'bg-background-100 text-foreground-500 group-hover:bg-background-50'}`}>
                  <AppIcon className={`${t.icon} text-[14px]`}></AppIcon>
                </span>
                <span>{t.label}</span>
                {t.key === 'modules' && <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${tab === t.key ? 'bg-white/[0.15] text-white' : 'bg-foreground-100 text-foreground-500'}`}>{PROGRAMME.modules.length}</span>}
                {t.key === 'cohorts' && <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${tab === t.key ? 'bg-white/[0.15] text-white' : 'bg-foreground-100 text-foreground-500'}`}>{PROGRAMME.cohorts.length}</span>}
                {t.key === 'groups' && <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${tab === t.key ? 'bg-white/[0.15] text-white' : 'bg-foreground-100 text-foreground-500'}`}>{totalGroups}</span>}
                {t.key === 'weeks' && <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${tab === t.key ? 'bg-white/[0.15] text-white' : 'bg-foreground-100 text-foreground-500'}`}>{totalWeeks}</span>}
                {t.key === 'sessions' && <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${tab === t.key ? 'bg-white/[0.15] text-white' : 'bg-foreground-100 text-foreground-500'}`}>{totalSessions}</span>}
                {t.key === 'review' && <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${tab === t.key ? 'bg-white/[0.15] text-white' : 'bg-foreground-100 text-foreground-500'}`}>{PROGRAMME.modules.length}</span>}
              </button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2 border-l border-background-200 pl-2">
            <button onClick={() => openKsbTrace('coverage')} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-primary-600 px-3 text-[12px] font-bold text-white transition-smooth hover:bg-primary-700">
              <AppIcon className="ri-bar-chart-box-line text-sm"></AppIcon>
              View KSB coverage details
            </button>
          </div>
        </div>

        {/* Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
            TAB: Cohorts
        Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â */}
        {tab === 'cohorts' && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-foreground-200/70 bg-background-50 p-4 shadow-sm">
              <div className="grid grid-cols-1 md:grid-cols-[1fr_180px_auto] gap-3 items-center">
                <div className="relative">
                  <AppIcon className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></AppIcon>
                  <input value={cohortSearch} onChange={event => setCohortSearch(event.target.value)} placeholder="Search cohorts, dates, status..." className="w-full h-10 pl-9 pr-3 rounded-lg border border-background-200 bg-background-50 text-[13px] text-foreground-900 outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary-100" />
                </div>
                <select value={cohortStatusFilter} onChange={event => setCohortStatusFilter(event.target.value)} className="h-10 px-3 rounded-lg border border-background-200 bg-background-50 text-[13px] text-foreground-900 outline-none cursor-pointer">
                  <option value="all">All statuses</option>
                  <option value="planned">Planned</option>
                  <option value="active">Active</option>
                  <option value="completed">Completed</option>
                </select>
                <button onClick={() => { setCohortSearch(''); setCohortStatusFilter('all'); }} disabled={!cohortSearch && cohortStatusFilter === 'all'} className="h-10 px-3 rounded-lg border border-background-200 bg-background-50 text-[12px] font-semibold text-foreground-600 hover:bg-background-100 disabled:opacity-40 disabled:cursor-not-allowed transition-smooth whitespace-nowrap">Reset</button>
              </div>
              <p className="text-[11px] text-foreground-400 mt-3">{filteredCohorts.length} of {PROGRAMME.cohorts.length} cohorts</p>
            </div>

            {filteredCohorts.length === 0 && (
              <div className="rounded-2xl border border-foreground-200/70 bg-background-50 p-8 text-center shadow-sm">
                <AppIcon className="ri-filter-off-line text-2xl text-foreground-300"></AppIcon>
                <p className="text-sm font-semibold text-foreground-700 mt-2">No cohorts match these filters</p>
              </div>
            )}

            {filteredCohorts.map(c => (
              <div key={c.id} className="overflow-hidden rounded-2xl border border-foreground-200/70 bg-background-50 shadow-sm">
                {/* Cohort Header Ã¢â‚¬â€ Clickable */}
                <button onClick={() => setExpandedCohort(expandedCohort === c.id ? null : c.id)} className="w-full flex items-center gap-4 p-4 text-left cursor-pointer hover:bg-background-100/30 transition-smooth">
                  <span className="w-10 h-10 rounded-xl bg-secondary-100 flex items-center justify-center shrink-0">
                    <AppIcon className={`ri-arrow-down-s-line text-secondary-700 transition-smooth ${expandedCohort === c.id ? 'rotate-180' : ''}`}></AppIcon>
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-foreground-900">{c.name}</p>
                      <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full border ${c.status === 'active' ? 'bg-emerald-50 text-emerald-700 border-emerald-200/50' : c.status === 'planned' ? 'bg-accent-50 text-accent-700 border-accent-200/50' : 'bg-foreground-100 text-foreground-500 border-foreground-200/50'}`}>{c.status}</span>
                    </div>
                    <p className="text-[11px] text-foreground-400 mt-0.5">{c.startDate} â€” {c.endDate} Â· {c.learners} learners Â· {c.groups.length} groups</p>
                  </div>
                  <div className="hidden items-center gap-4 text-[12px] text-foreground-500 shrink-0 sm:flex">
                    {c.groups.length > 0 && (() => {
                      const staffed = c.groups.filter(g => g.coach !== 'Unassigned' && g.tutor !== 'Unassigned').length;
                      const pct = Math.round((staffed / c.groups.length) * 100);
                      return (
                        <div className="flex items-center gap-2" title="Groups with both a coach and a tutor assigned">
                          <div className="w-20 h-1.5 bg-background-200 rounded-full overflow-hidden">
                            <div className="h-full bg-primary-500 rounded-full" style={{ width: `${pct}%` }}></div>
                          </div>
                          <span className="text-[10px] font-semibold">{staffed}/{c.groups.length} staffed</span>
                        </div>
                      );
                    })()}
                    <span className="text-[12px]"><AppIcon className="ri-graduation-cap-line mr-1"></AppIcon>{c.learners}</span>
                  </div>
                </button>

                {/* Expanded Groups */}
                {expandedCohort === c.id && (
                  <div className="px-4 pb-4 border-t border-background-200/30">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                      {c.groups.map(g => (
                        <div key={g.id} className="rounded-2xl border border-background-200/80 bg-background-100 p-4 shadow-sm">
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-[13px] font-semibold text-foreground-900">{g.name}</p>
                            <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${g.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{g.status}</span>
                          </div>
                          <div className="grid grid-cols-2 gap-2 mb-3">
                            <div className="text-[11px] text-foreground-500"><AppIcon className="ri-graduation-cap-line mr-1 text-[10px]"></AppIcon>{g.learners} learners</div>
                            <div className="text-[11px] text-foreground-500"><AppIcon className="ri-heart-line mr-1 text-[10px]"></AppIcon>Coach: {g.coach}</div>
                            <div className="text-[11px] text-foreground-500"><AppIcon className="ri-user-settings-line mr-1 text-[10px]"></AppIcon>Tutor: {g.tutor}</div>
                            <div className="text-[11px] text-foreground-500"><AppIcon className="ri-calendar-line mr-1 text-[10px]"></AppIcon>{g.schedule}</div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-foreground-400 bg-background-200/50 px-2 py-0.5 rounded">{g.mode}</span>
                            <span className="text-[10px] text-foreground-400">{g.startDate} â€” {g.endDate}</span>
                          </div>
                          <div className="flex items-center gap-2 mt-3">
                            <button onClick={() => setExpandedGroup(expandedGroup === g.id ? null : g.id)} className="px-2.5 py-1 bg-primary-500 text-white rounded-md text-[10px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
                              {expandedGroup === g.id ? 'Hide Details' : 'View Full Details'}
                            </button>
                          </div>

                          {expandedGroup === g.id && (
                            <div className="mt-4 rounded-xl border border-primary-200/50 bg-background-50 p-4 shadow-sm">
                              <div className="flex items-start justify-between gap-3 mb-3">
                                <div>
                                  <p className="text-[12px] font-semibold text-foreground-900">{g.name} full details</p>
                                  <p className="text-[11px] text-foreground-500 mt-0.5">{c.name} Â· {g.startDate} â€” {g.endDate}</p>
                                </div>
                                <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${g.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{g.status}</span>
                              </div>

                              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-3">
                                <div className="rounded-lg border border-background-200 bg-background-100 p-2">
                                  <p className="text-[9px] font-semibold uppercase text-foreground-400">Coach</p>
                                  <p className="text-[11px] font-semibold text-foreground-800 truncate">{g.coach}</p>
                                </div>
                                <div className="rounded-lg border border-background-200 bg-background-100 p-2">
                                  <p className="text-[9px] font-semibold uppercase text-foreground-400">Tutor</p>
                                  <p className="text-[11px] font-semibold text-foreground-800 truncate">{g.tutor}</p>
                                </div>
                                <div className="rounded-lg border border-background-200 bg-background-100 p-2">
                                  <p className="text-[9px] font-semibold uppercase text-foreground-400">Schedule</p>
                                  <p className="text-[11px] font-semibold text-foreground-800 truncate">{g.schedule}</p>
                                </div>
                                <div className="rounded-lg border border-background-200 bg-background-100 p-2">
                                  <p className="text-[9px] font-semibold uppercase text-foreground-400">Modules</p>
                                  <p className="text-[11px] font-semibold text-foreground-800">{g.modules.length}</p>
                                </div>
                              </div>

                              {g.modules.length > 0 ? (
                                <div className="space-y-2">
                                  {g.modules.map(moduleItem => (
                                    <div key={moduleItem.id} className="flex items-center justify-between gap-3 rounded-lg border border-background-200 bg-background-50 px-3 py-2">
                                      <div className="min-w-0">
                                        <p className="text-[11px] font-semibold text-foreground-900 truncate">{moduleItem.name}</p>
                                        <p className="text-[10px] text-foreground-500">{moduleItem.weeks} weeks Â· {moduleItem.otjh}h OTJH Â· {moduleItem.weeksData.reduce((sum, weekItem) => sum + (weekItem.components?.length || 0), 0)} components</p>
                                      </div>
                                      <button onClick={() => { setTab('weeks'); setSelectedModule(moduleItem.id); setSelectedWeek(moduleItem.weeksData[0]?.id || ''); }} className="px-2.5 py-1 rounded-md border border-background-200 bg-background-100 text-[10px] font-semibold text-foreground-700 hover:bg-background-200 transition-smooth whitespace-nowrap">
                                        Open Weeks
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <p className="rounded-lg border border-background-200 bg-background-100 px-3 py-2 text-[11px] text-foreground-500">No modules are linked to this group yet.</p>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                    <div className="flex items-center gap-2 mt-3">
                      <button onClick={() => showCurriculumAlert({ title: 'Learner allocation is resource-scoped', text: `${c.name} is live in this programme view. Learner allocation should use the live MIS workflow instead of the legacy mock page.`, icon: 'info' })} className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
                        <AppIcon className="ri-user-add-line mr-1"></AppIcon> Allocate Learners
                      </button>
                      <button onClick={() => openStructureWizard({ cohortId: c.id, startStep: 'group' })} className="px-3 py-1.5 bg-background-50 border border-background-200 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">
                        <AppIcon className="ri-add-line mr-1"></AppIcon> New Group
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
            TAB: Groups
        Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â */}
        {tab === 'groups' && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-foreground-200/70 bg-background-50 p-4 shadow-sm">
              <div className="grid grid-cols-1 lg:grid-cols-[1fr_220px_180px_auto] gap-3 items-center">
                <div className="relative">
                  <AppIcon className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></AppIcon>
                  <input value={groupSearch} onChange={event => setGroupSearch(event.target.value)} placeholder="Search groups, coach, tutor, schedule..." className="w-full h-10 pl-9 pr-3 rounded-lg border border-background-200 bg-background-50 text-[13px] text-foreground-900 outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary-100" />
                </div>
                <select value={groupCohortFilter} onChange={event => setGroupCohortFilter(event.target.value)} className="h-10 px-3 rounded-lg border border-background-200 bg-background-50 text-[13px] text-foreground-900 outline-none cursor-pointer">
                  <option value="all">All cohorts</option>
                  {PROGRAMME.cohorts.map(cohortItem => <option key={cohortItem.id} value={cohortItem.id}>{cohortItem.name}</option>)}
                </select>
                <select value={groupStatusFilter} onChange={event => setGroupStatusFilter(event.target.value)} className="h-10 px-3 rounded-lg border border-background-200 bg-background-50 text-[13px] text-foreground-900 outline-none cursor-pointer">
                  <option value="all">All statuses</option>
                  <option value="planned">Planned</option>
                  <option value="active">Active</option>
                  <option value="completed">Completed</option>
                </select>
                <button onClick={() => { setGroupSearch(''); setGroupCohortFilter('all'); setGroupStatusFilter('all'); }} disabled={!groupSearch && groupCohortFilter === 'all' && groupStatusFilter === 'all'} className="h-10 px-3 rounded-lg border border-background-200 bg-background-50 text-[12px] font-semibold text-foreground-600 hover:bg-background-100 disabled:opacity-40 disabled:cursor-not-allowed transition-smooth whitespace-nowrap">Reset</button>
              </div>
              <p className="text-[11px] text-foreground-400 mt-3">{filteredGroups.length} of {totalGroups} groups</p>
            </div>

            {filteredGroups.length === 0 && (
              <div className="rounded-2xl border border-foreground-200/70 bg-background-50 p-8 text-center shadow-sm">
                <AppIcon className="ri-filter-off-line text-2xl text-foreground-300"></AppIcon>
                <p className="text-sm font-semibold text-foreground-700 mt-2">No groups match these filters</p>
              </div>
            )}

            {PROGRAMME.cohorts.filter(c => c.groups.some(g => filteredGroups.some(item => item.group.id === g.id))).map(c => (
              <div key={c.id} className="space-y-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[12px] font-semibold text-foreground-700">{c.name}</span>
                  <span className="text-[10px] text-foreground-400">{c.groups.length} groups Â· {c.learners} learners</span>
                </div>
                {c.groups.filter(g => filteredGroups.some(item => item.group.id === g.id)).map(g => (
                  <div key={g.id} className="rounded-2xl border border-foreground-200/70 bg-background-50 p-4 shadow-sm">
                    <div className="flex flex-col lg:flex-row items-start lg:items-center gap-4">
                      <div className="w-12 h-12 rounded-xl bg-secondary-100 flex items-center justify-center shrink-0">
                        <AppIcon className="ri-team-line text-secondary-700 text-lg"></AppIcon>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-semibold text-foreground-900">{g.name}</p>
                          <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-secondary-100 text-secondary-700">{c.name}</span>
                          <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${g.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{g.status}</span>
                        </div>
                        <div className="flex items-center gap-4 text-[11px] text-foreground-500 mt-1 flex-wrap">
                          <span><AppIcon className="ri-graduation-cap-line mr-1 text-[10px]"></AppIcon>{g.learners} learners</span>
                          <span><AppIcon className="ri-heart-line mr-1 text-[10px]"></AppIcon>Coach: <strong className="text-foreground-700">{g.coach}</strong></span>
                          <span><AppIcon className="ri-user-settings-line mr-1 text-[10px]"></AppIcon>Tutor: <strong className="text-foreground-700">{g.tutor}</strong></span>
                          <span><AppIcon className="ri-calendar-line mr-1 text-[10px]"></AppIcon>{g.schedule}</span>
                          <span><AppIcon className="ri-map-pin-line mr-1 text-[10px]"></AppIcon>{g.mode}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {/* Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
            TAB: Modules
        Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â */}
        {tab === 'modules' && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-foreground-200/70 bg-background-50 p-4 shadow-sm">
              <div className="grid grid-cols-1 md:grid-cols-[1fr_220px_180px_auto] gap-3 items-center">
                <div className="relative">
                  <AppIcon className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></AppIcon>
                  <input
                    value={moduleSearch}
                    onChange={event => setModuleSearch(event.target.value)}
                    placeholder="Search modules, cohort, group, KSB..."
                    className="w-full h-10 pl-9 pr-3 rounded-lg border border-background-200 bg-background-50 text-[13px] text-foreground-900 outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary-100"
                  />
                </div>
                <select
                  value={moduleCohortFilter}
                  onChange={event => setModuleCohortFilter(event.target.value)}
                  className="h-10 px-3 rounded-lg border border-background-200 bg-background-50 text-[13px] text-foreground-900 outline-none cursor-pointer"
                >
                  <option value="all">All cohorts</option>
                  {moduleCohorts.map(cohortName => (
                    <option key={cohortName} value={cohortName}>{cohortName}</option>
                  ))}
                </select>
                <select
                  value={moduleGroupFilter}
                  onChange={event => setModuleGroupFilter(event.target.value)}
                  className="h-10 px-3 rounded-lg border border-background-200 bg-background-50 text-[13px] text-foreground-900 outline-none cursor-pointer"
                >
                  <option value="all">All groups</option>
                  {moduleGroups.map(groupName => (
                    <option key={groupName} value={groupName}>{groupName}</option>
                  ))}
                </select>
                <button
                  onClick={() => { setModuleSearch(''); setModuleCohortFilter('all'); setModuleGroupFilter('all'); }}
                  disabled={!moduleSearch && moduleCohortFilter === 'all' && moduleGroupFilter === 'all'}
                  className="h-10 px-3 rounded-lg border border-background-200 bg-background-50 text-[12px] font-semibold text-foreground-600 hover:bg-background-100 disabled:opacity-40 disabled:cursor-not-allowed transition-smooth whitespace-nowrap"
                >
                  Reset
                </button>
              </div>
              <p className="text-[11px] text-foreground-400 mt-3">{filteredModules.length} of {PROGRAMME.modules.length} modules</p>
            </div>

            {filteredModules.length === 0 && (
              <div className="rounded-2xl border border-foreground-200/70 bg-background-50 p-8 text-center shadow-sm">
                <AppIcon className="ri-filter-off-line text-2xl text-foreground-300"></AppIcon>
                <p className="text-sm font-semibold text-foreground-700 mt-2">No modules match these filters</p>
                <button onClick={() => { setModuleSearch(''); setModuleCohortFilter('all'); setModuleGroupFilter('all'); }} className="mt-3 px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-primary-600 transition-smooth">
                  Clear filters
                </button>
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {filteredModules.map(mod => {
              const weekCount = mod.weeksData.length || mod.weeks || 0;
              const componentCount = mod.weeksData.reduce((total, week) => total + (week.components?.length || 0), 0);
              const mappedKsbCodes = uniqueCleanValues([...mod.ksbTags, ...mod.ksbMapping.map(item => item.ksb)]).sort(sortKsbCodes);
              const weightedKsbCount = mod.ksbMapping.filter(item => item.source !== 'fallback' && Number(item.weight || 0) > 0).length;
              const mappingOccurrenceCount = mod.ksbMapping.reduce((total, item) => total + Number(item.count || 0), 0);
              const deliveryStart = clean(mod.weeksData[0]?.startDate);
              const deliveryEnd = clean(mod.weeksData.at(-1)?.endDate || mod.weeksData.at(-1)?.startDate);
              const teamsComponent = mod.weeksData
                .flatMap(week => week.components || [])
                .find(component => {
                  const settings = (component.settings || {}) as Record<string, unknown>;
                  return Boolean(clean(settings.teamsLiveSessionId));
                });
              const teamsSettings = (teamsComponent?.settings || {}) as Record<string, unknown>;
              const teamsLiveSessionId = clean(teamsSettings.teamsLiveSessionId);
              const teamsJoinUrl = clean(teamsSettings.liveSessionUrl);
              const builderUrl = moduleBuilderUrl(mod, PROGRAMME);
              return (
              <div key={mod.id} className="overflow-hidden rounded-2xl border border-foreground-200/70 bg-background-50 shadow-[0_16px_42px_rgba(15,23,42,0.08)] transition-smooth hover:-translate-y-0.5 hover:shadow-[0_22px_55px_rgba(15,23,42,0.12)]">
                <div className="border-b border-primary-100 bg-[linear-gradient(135deg,#f8f5ff_0%,#ffffff_54%,#effdf7_100%)] px-5 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="w-11 h-11 rounded-xl bg-primary-600 text-white flex items-center justify-center shrink-0 shadow-sm">
                      <AppIcon className="ri-stack-line text-sm"></AppIcon>
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-base font-heading font-black text-foreground-950">{mod.name}</p>
                      </div>
                      <p className="text-[11px] font-semibold text-foreground-500 mt-0.5">{[mod.cohort || 'No cohort', mod.group || 'No group'].join(' - ')}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => window.REACT_APP_NAVIGATE(builderUrl)}
                    className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-primary-600 px-3 text-[10px] font-bold text-white shadow-sm transition-smooth hover:bg-primary-700"
                    title="Open this module in Module Builder"
                  >
                    <AppIcon className="ri-tools-line text-sm"></AppIcon>
                    Module Builder
                  </button>
                </div>
                {mod.description && <p className="mt-3 text-[12px] leading-5 text-foreground-500">{mod.description}</p>}
                </div>

                <div className="p-5">

                <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <ModuleCardMetric tone="purple" icon="ri-calendar-line" label="Weeks" value={weekCount} />
                  <ModuleCardMetric tone="blue" icon="ri-layout-grid-line" label="Components" value={componentCount} />
                  <ModuleCardMetric tone="emerald" icon="ri-time-line" label="OTJH" value={`${formatHours(mod.otjh)}h`} />
                  <ModuleCardMetric tone="amber" icon="ri-node-tree" label="KSBs" value={mappedKsbCodes.length} />
                </div>

                <div className="mb-4 rounded-xl border border-background-200 bg-background-100/70 p-3">
                <p className="mb-2 text-[10px] font-black uppercase tracking-wide text-foreground-400">Delivery details</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <ModuleDetailLine icon="ri-calendar-event-line" label="Delivery window" value={[deliveryStart, deliveryEnd].filter(Boolean).join(' - ') || 'Not scheduled'} />
                  <ModuleDetailLine icon="ri-group-line" label="Cohort / Group" value={[mod.cohort || 'No cohort', mod.group || 'No group'].join(' / ')} />
                  <ModuleDetailLine icon="ri-user-settings-line" label="Tutor" value={mod.tutor || 'Unassigned'} />
                </div>
                </div>

                {teamsLiveSessionId && (
                  <div className="mb-4 rounded-xl border border-primary-200 bg-primary-50/60 p-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex min-w-0 items-start gap-2.5">
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary-600 text-white">
                          <AppIcon className="ri-microsoft-teams-line text-base"></AppIcon>
                        </span>
                        <div className="min-w-0">
                          <p className="text-[11px] font-black text-foreground-900">Microsoft Teams results</p>
                          <p className="mt-0.5 text-[10px] font-semibold text-foreground-500">Attendance, transcript and recording for this module's sessions.</p>
                          {teamsJoinUrl && <a href={teamsJoinUrl} target="_blank" rel="noreferrer" className="mt-1 block truncate text-[10px] font-bold text-primary-700 hover:text-primary-800">Open meeting link</a>}
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center gap-2">
                        <button
                          type="button"
                          disabled={teamsSyncingId === teamsLiveSessionId}
                          onClick={async () => {
                            setTeamsSyncingId(teamsLiveSessionId);
                            setTeamsSyncMessages(previous => ({ ...previous, [teamsLiveSessionId]: '' }));
                            try {
                              const result = await syncTeamsMeetingArtifacts(teamsLiveSessionId);
                              const details = await loadTeamsMeetingArtifacts(teamsLiveSessionId);
                              setTeamsResults(previous => ({ ...previous, [teamsLiveSessionId]: details }));
                              setTeamsResultsOpen(previous => ({ ...previous, [teamsLiveSessionId]: true }));
                              setTeamsSyncMessages(previous => ({
                                ...previous,
                                [teamsLiveSessionId]: `Synced ${result.synced.attendanceRecords} attendance rows, ${result.synced.transcripts} transcripts and ${result.synced.recordings} recordings.`,
                              }));
                            } catch (error) {
                              setTeamsSyncMessages(previous => ({
                                ...previous,
                                [teamsLiveSessionId]: error instanceof Error ? error.message : 'Unable to sync Teams results.',
                              }));
                            } finally {
                              setTeamsSyncingId('');
                            }
                          }}
                          className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-primary-600 px-3 text-[10px] font-bold text-white hover:bg-primary-700 disabled:cursor-wait disabled:opacity-50"
                        >
                          <AppIcon className={`${teamsSyncingId === teamsLiveSessionId ? 'ri-loader-4-line animate-spin' : 'ri-refresh-line'}`}></AppIcon>
                          {teamsSyncingId === teamsLiveSessionId ? 'Syncing...' : 'Sync results'}
                        </button>
                        <button
                          type="button"
                          disabled={teamsSyncingId === teamsLiveSessionId}
                          onClick={async () => {
                            if (teamsResults[teamsLiveSessionId]) {
                              setTeamsResultsOpen(previous => ({ ...previous, [teamsLiveSessionId]: !previous[teamsLiveSessionId] }));
                              return;
                            }
                            setTeamsSyncingId(teamsLiveSessionId);
                            try {
                              const details = await loadTeamsMeetingArtifacts(teamsLiveSessionId);
                              setTeamsResults(previous => ({ ...previous, [teamsLiveSessionId]: details }));
                              setTeamsResultsOpen(previous => ({ ...previous, [teamsLiveSessionId]: true }));
                            } catch (error) {
                              setTeamsSyncMessages(previous => ({
                                ...previous,
                                [teamsLiveSessionId]: error instanceof Error ? error.message : 'Unable to load Teams results.',
                              }));
                            } finally {
                              setTeamsSyncingId('');
                            }
                          }}
                          className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-primary-200 bg-white px-3 text-[10px] font-bold text-primary-700 hover:bg-primary-50 disabled:cursor-wait disabled:opacity-50"
                        >
                          <AppIcon className={teamsResultsOpen[teamsLiveSessionId] ? 'ri-arrow-up-s-line' : 'ri-eye-line'}></AppIcon>
                          {teamsResultsOpen[teamsLiveSessionId] ? 'Hide details' : 'View details'}
                        </button>
                      </div>
                    </div>
                    {teamsSyncMessages[teamsLiveSessionId] && <p className="mt-2 rounded-lg bg-white/80 px-2.5 py-2 text-[10px] font-semibold text-foreground-600">{teamsSyncMessages[teamsLiveSessionId]}</p>}
                    {teamsResultsOpen[teamsLiveSessionId] && teamsResults[teamsLiveSessionId] && (
                      <TeamsResultsDetails liveSessionId={teamsLiveSessionId} data={teamsResults[teamsLiveSessionId]} />
                    )}
                  </div>
                )}

                <div className="mb-4 rounded-xl border border-primary-100 bg-primary-50/50 px-3 py-2">
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <MiniDarkMetric label="Weighted KSBs" value={weightedKsbCount} />
                    <MiniDarkMetric label="Mappings" value={mappingOccurrenceCount} />
                    <MiniDarkMetric label="KSB tags" value={mappedKsbCodes.length} />
                  </div>
                </div>

                <div className="mb-4">
                  <p className="text-[11px] font-semibold text-foreground-400 uppercase mb-2">KSBs in this module</p>
                  <KsbGroupedTags codes={mappedKsbCodes} />
                </div>

                <div className="mb-4">
                  <p className="text-[11px] font-semibold text-foreground-400 uppercase mb-2">KSB Coverage</p>
                  <p className="mb-2 text-[10px] font-medium text-foreground-400">Percentages are saved Module Builder weights. No weight means the KSB is linked, but its weight is 0 or not set yet.</p>
                  <KsbCoverageGroups mapping={mod.ksbMapping} />
                </div>

                <div>
                  <p className="text-[11px] font-semibold text-foreground-400 uppercase mb-2">Week breakdown</p>
                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                    {mod.weeksData.map(week => {
                      const weekComponents = week.components || [];
                      const weekKsbCount = uniqueCleanValues(weekComponents.flatMap(component => component.ksbRefs || [])).length;
                      const weekTeamsUrl = clean(
                        ((weekComponents.find(component => {
                          const settings = (component.settings || {}) as Record<string, unknown>;
                          return deliveryKindForComponent(component) === 'live' && clean(settings.liveSessionUrl);
                        })?.settings || {}) as Record<string, unknown>).liveSessionUrl,
                      );
                      const weekKey = `${mod.id}:${week.id}`;
                      const isWeekOpen = expandedModuleWeek === weekKey;
                      return (
                        <div key={week.id} className={`overflow-hidden rounded-lg border bg-background-50 transition-smooth ${isWeekOpen ? 'border-primary-300 shadow-sm sm:col-span-2' : 'border-background-200 hover:border-primary-200'}`}>
                          <button type="button" onClick={() => setExpandedModuleWeek(isWeekOpen ? null : weekKey)} className="flex w-full items-center justify-between gap-2 px-2.5 py-2 text-left">
                            <div className="min-w-0">
                              <p className="truncate text-[11px] font-bold text-foreground-800">{week.title || `Week ${week.number}`}</p>
                              <p className="truncate text-[10px] text-foreground-400">{clean(week.startDate) || 'No date'}</p>
                            {weekTeamsUrl && (
                              <a href={weekTeamsUrl} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-[10px] font-bold text-primary-700 hover:text-primary-800 hover:underline">
                                <AppIcon className="ri-microsoft-teams-line"></AppIcon>
                                Join Teams session
                              </a>
                            )}
                            </div>
                            <div className="flex shrink-0 items-center gap-1.5">
                              <span className="rounded-full bg-primary-50 px-2 py-0.5 text-[9px] font-bold text-primary-700">{formatHours(week.otjh)}h</span>
                              <span className="rounded-full bg-background-100 px-2 py-0.5 text-[9px] font-bold text-foreground-600">{weekComponents.length} comp</span>
                              <span className="rounded-full bg-secondary-50 px-2 py-0.5 text-[9px] font-bold text-secondary-700">{weekKsbCount} KSB</span>
                              <AppIcon className={`ri-arrow-down-s-line text-sm text-foreground-400 transition-smooth ${isWeekOpen ? 'rotate-180 text-primary-600' : ''}`}></AppIcon>
                            </div>
                          </button>
                          {isWeekOpen && (
                            <div className="border-t border-background-200 bg-background-100/60 p-3">
                              <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                                <MiniDarkMetric label="Start" value={clean(week.startDate) || 'TBD'} />
                                <MiniDarkMetric label="End" value={clean(week.endDate) || 'TBD'} />
                                <MiniDarkMetric label="Components" value={weekComponents.length} />
                                <MiniDarkMetric label="KSBs" value={weekKsbCount} />
                              </div>
                              <div className="space-y-2">
                                {weekComponents.length ? weekComponents.map((component, index) => (
                                  <div key={component.id} className="flex items-center gap-3 rounded-lg border border-background-200 bg-background-50 p-2.5">
                                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-[11px] font-black text-primary-700">{index + 1}</span>
                                    <div className="min-w-0 flex-1">
                                      <p className="truncate text-[12px] font-black text-foreground-900">{component.title || 'Untitled component'}</p>
                                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                        <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${componentTypeTone(component.type)}`}>{componentTypeLabel(component.type)}</span>
                                        <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700">{formatHours(Number(component.expectedOtjh ?? 0))}h OTJH</span>
                                        {component.duration ? <span className="rounded-full bg-background-100 px-1.5 py-0.5 text-[9px] font-bold text-foreground-500">{component.duration} min</span> : null}
                                        {component.ksbRefs?.length ? <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[9px] font-bold text-amber-700">{component.ksbRefs.length} KSBs</span> : null}
                                      </div>
                                    </div>
                                  </div>
                                )) : (
                                  <div className="rounded-lg border border-dashed border-background-300 bg-background-50 px-3 py-5 text-center">
                                    <AppIcon className="ri-inbox-line text-lg text-foreground-300"></AppIcon>
                                    <p className="mt-1 text-[11px] font-bold text-foreground-500">No components attached to this week yet.</p>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
                </div>

              </div>
              );
            })}
            </div>
          </div>
        )}

        {/* Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
            TAB: Weeks
        Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â */}
{tab === 'weeks' && (
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
            <aside className="space-y-4">
              <div className="rounded-2xl border border-foreground-200/70 bg-background-50 p-4 shadow-sm">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-primary-600">Module workspace</p>
                    <h3 className="text-base font-heading font-black text-foreground-950">Choose module</h3>
                  </div>
                  <span className="rounded-full bg-primary-50 px-2.5 py-1 text-[10px] font-bold text-primary-700">{weekModuleOptions.length} modules</span>
                </div>
                <select
                  value={selectedModule}
                  onChange={event => {
                    const nextModule = PROGRAMME.modules.find(m => m.id === event.target.value);
                    setSelectedModule(event.target.value);
                    setSelectedWeek(nextModule?.weeksData[0]?.id || '');
                  }}
                  className="mb-3 w-full h-11 rounded-xl border border-primary-200 bg-background-50 px-3 text-[13px] font-bold text-foreground-900 outline-none ring-primary-100 transition-smooth focus:ring-4"
                >
                  {weekModuleOptions.map(option => (
                    <option key={option.id} value={option.id}>
                      {option.name} - {[option.cohort, option.group].filter(Boolean).join(' / ') || 'No cohort/group'}
                    </option>
                  ))}
                </select>
                <div className="space-y-2">
                  {weekModuleOptions.map(option => {
                    const optionComponents = option.weeksData.reduce((sum, item) => sum + (item.components?.length ?? 0), 0);
                    const active = option.id === module.id;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => {
                          setSelectedModule(option.id);
                          setSelectedWeek(option.weeksData[0]?.id || '');
                        }}
                        className={`w-full rounded-xl border p-3 text-left transition-smooth ${active ? 'border-primary-300 bg-primary-50 shadow-sm' : 'border-background-200 bg-background-100 hover:border-primary-200 hover:bg-primary-50/40'}`}
                      >
                        <div className="flex items-start gap-3">
                          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${active ? 'bg-primary-600 text-white' : 'bg-background-50 text-primary-600'}`}>
                            <AppIcon className="ri-stack-line text-sm"></AppIcon>
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[13px] font-black text-foreground-950">{option.name}</p>
                            <p className="mt-0.5 text-[10px] font-semibold text-foreground-500">{option.cohort || 'No cohort'} / {option.group || 'No group'}</p>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              <span className="rounded-full bg-background-50 px-2 py-0.5 text-[9px] font-bold text-primary-700">{option.weeksData.length || option.weeks} weeks</span>
                              <span className="rounded-full bg-background-50 px-2 py-0.5 text-[9px] font-bold text-sky-700">{optionComponents} comp</span>
                              <span className="rounded-full bg-background-50 px-2 py-0.5 text-[9px] font-bold text-emerald-700">{formatHours(option.otjh)}h</span>
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </aside>

            <section className="overflow-hidden rounded-2xl border border-foreground-200/70 bg-background-50 shadow-sm">
              <div className="border-b border-primary-100 bg-[linear-gradient(135deg,#f8f5ff_0%,#ffffff_50%,#ecfdf5_100%)] p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-primary-600 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-white">Selected module</span>
                      <span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold ${moduleStatusColors[module.status] || moduleStatusColors.draft}`}>{module.status || 'draft'}</span>
                    </div>
                    <h2 className="text-xl font-heading font-black text-foreground-950">{module.name}</h2>
                    <p className="mt-1 text-[12px] font-semibold text-foreground-500">{module.description || 'No module description configured.'}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => window.REACT_APP_NAVIGATE(moduleBuilderUrl(module, PROGRAMME))}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-primary-600 px-4 text-[12px] font-bold text-white shadow-sm transition-smooth hover:bg-primary-700"
                  >
                    <AppIcon className="ri-tools-line text-sm"></AppIcon>
                    Open Module Builder
                  </button>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
                  <ModuleCardMetric icon="ri-calendar-line" label="Weeks" value={module.weeksData.length || module.weeks} />
                  <ModuleCardMetric tone="blue" icon="ri-layout-grid-line" label="Components" value={module.weeksData.reduce((sum, item) => sum + (item.components?.length ?? 0), 0)} />
                  <ModuleCardMetric tone="emerald" icon="ri-time-line" label="OTJH" value={`${formatHours(module.otjh)}h`} />
                  <ModuleCardMetric tone="amber" icon="ri-node-tree" label="KSBs" value={uniqueCleanValues(module.weeksData.flatMap(item => (item.components || []).flatMap(component => component.ksbRefs || []))).length} />
                </div>
              </div>

              <div className="border-b border-background-200 bg-background-50 p-5">
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  <ModuleDetailLine icon="ri-group-line" label="Cohort / Group" value={[module.cohort || 'No cohort', module.group || 'No group'].join(' / ')} />
                  <ModuleDetailLine icon="ri-user-settings-line" label="Tutor" value={module.tutor || 'Unassigned'} />
                </div>
              </div>

              <div className="p-5">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-foreground-400">Week timeline</p>
                    <h3 className="text-base font-heading font-black text-foreground-950">{module.weeksData.length} scheduled weeks</h3>
                  </div>
                  <span className="rounded-full bg-emerald-50 px-3 py-1 text-[11px] font-black text-emerald-700">{formatHours(module.otjh)}h total OTJH</span>
                </div>

                <div className="relative space-y-3">
                  <div className="absolute bottom-6 left-[22px] top-6 w-px bg-primary-100" aria-hidden="true" />
                  {filteredWeeks.map(w => {
                    const weekComponents = w.components ?? [];
                    const weekKsbCount = uniqueCleanValues(weekComponents.flatMap(component => component.ksbRefs || [])).length;
                    const isOpen = selectedWeek === w.id;
                    return (
                      <div key={w.id} className={`relative overflow-hidden rounded-2xl border bg-background-50 transition-smooth ${isOpen ? 'border-primary-300 shadow-[0_14px_40px_rgba(105,65,198,0.12)]' : 'border-foreground-200/70 hover:border-primary-200 hover:shadow-sm'}`}>
                        <button
                          type="button"
                          onClick={() => setSelectedWeek(isOpen ? '' : w.id)}
                          className="flex w-full items-center gap-4 p-4 text-left"
                        >
                          <span className={`relative z-10 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-[12px] font-black ${isOpen ? 'bg-primary-600 text-white' : 'bg-primary-50 text-primary-700'}`}>
                            W{w.number}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-sm font-heading font-black text-foreground-950">{w.title || `Week ${w.number}`}</p>
                              <span className="rounded-full bg-background-100 px-2 py-0.5 text-[10px] font-bold text-foreground-500">{w.startDate} - {w.endDate}</span>
                            </div>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">{formatHours(w.otjh)}h OTJH</span>
                              <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-bold text-sky-700">{weekComponents.length} components</span>
                              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">{weekKsbCount} KSBs</span>
                            </div>
                          </div>
                          <AppIcon className={`ri-arrow-down-s-line text-lg text-foreground-400 transition-smooth ${isOpen ? 'rotate-180 text-primary-600' : ''}`}></AppIcon>
                        </button>
                        {isOpen && (
                          <div className="border-t border-background-200 bg-background-100/60 px-4 pb-4 pt-3">
                            <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
                              {weekComponents.length > 0 ? weekComponents.map((component, i) => {
                                const componentSettings = (component.settings || {}) as Record<string, unknown>;
                                const componentTeamsUrl = deliveryKindForComponent(component) === 'live'
                                  ? clean(componentSettings.liveSessionUrl)
                                  : '';
                                return (
                                  <div key={component.id} className="flex items-center gap-3 rounded-xl border border-background-200 bg-background-50 p-3 shadow-sm">
                                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-[11px] font-black text-primary-700">{i + 1}</span>
                                    <div className="min-w-0 flex-1">
                                      <p className="truncate text-[12px] font-black text-foreground-900">{component.title || 'Untitled component'}</p>
                                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                        <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${componentTypeTone(component.type)}`}>{componentTypeLabel(component.type)}</span>
                                        <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700">{formatHours(Number(component.expectedOtjh ?? 0))}h OTJH</span>
                                        {component.duration ? <span className="rounded-full bg-background-100 px-1.5 py-0.5 text-[9px] font-bold text-foreground-500">{component.duration} min</span> : null}
                                        {component.ksbRefs?.length ? <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[9px] font-bold text-amber-700">{component.ksbRefs.length} KSBs</span> : null}
                                      </div>
                                      {componentTeamsUrl && (
                                        <a href={componentTeamsUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex h-7 items-center gap-1.5 rounded-lg bg-primary-600 px-2.5 text-[10px] font-bold text-white hover:bg-primary-700">
                                          <AppIcon className="ri-microsoft-teams-line"></AppIcon>
                                          Join Teams session
                                        </a>
                                      )}
                                    </div>
                                    <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${moduleStatusColors[component.status] || moduleStatusColors.draft}`}>{component.status}</span>
                                  </div>
                                );
                              }) : (
                                <div className="lg:col-span-2 rounded-xl border border-dashed border-background-300 bg-background-50 px-4 py-8 text-center">
                                  <AppIcon className="ri-inbox-line text-xl text-foreground-300"></AppIcon>
                                  <p className="mt-2 text-[12px] font-bold text-foreground-500">No components attached to this week yet.</p>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>
          </div>
        )}

        {/* Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
            TAB: Sessions
        Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â */}
        {tab === 'sessions' && (
          <div className="space-y-4">
            {/* Live / Recorded toggle */}
            <div className="flex flex-col gap-3 rounded-2xl border border-foreground-200/70 bg-background-50 p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
              <div className="inline-flex rounded-xl border border-foreground-200/70 bg-background-100 p-1">
                <button onClick={() => setSessionKind('live')} className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-[12px] font-bold transition-smooth cursor-pointer ${sessionKind === 'live' ? 'bg-primary-600 text-white shadow-sm' : 'text-foreground-600 hover:text-foreground-900'}`}>
                  <AppIcon className="ri-broadcast-line text-sm"></AppIcon>
                  Live
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${sessionKind === 'live' ? 'bg-white/20 text-white' : 'bg-foreground-100 text-foreground-500'}`}>{liveSessions.length}</span>
                </button>
                <button onClick={() => setSessionKind('recorded')} className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-[12px] font-bold transition-smooth cursor-pointer ${sessionKind === 'recorded' ? 'bg-primary-600 text-white shadow-sm' : 'text-foreground-600 hover:text-foreground-900'}`}>
                  <AppIcon className="ri-film-line text-sm"></AppIcon>
                  Recorded
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${sessionKind === 'recorded' ? 'bg-white/20 text-white' : 'bg-foreground-100 text-foreground-500'}`}>{recordedSessions.length}</span>
                </button>
              </div>
              <p className="text-[12px] leading-5 text-foreground-500 sm:max-w-md sm:text-right">
                {sessionKind === 'live'
                  ? 'Microsoft Teams sessions with scheduling, attendance and recording information.'
                  : 'Recorded learning with provider, KSB coverage and watch-time information.'}
              </p>
            </div>

            {/* Search + module filter */}
            <div className="rounded-2xl border border-foreground-200/70 bg-background-50 p-4 shadow-sm">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_220px_auto_auto] md:items-center">
                <div className="relative">
                  <AppIcon className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></AppIcon>
                  <input value={sessionSearch} onChange={event => setSessionSearch(event.target.value)} placeholder={sessionKind === 'live' ? 'Search sessions, dates, groups or KSBs...' : 'Search videos, providers, modules or KSBs...'} className="w-full h-10 pl-9 pr-3 rounded-lg border border-background-200 bg-background-50 text-[13px] text-foreground-900 outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary-100" />
                </div>
                <select value={sessionModuleFilter} onChange={event => setSessionModuleFilter(event.target.value)} className="h-10 px-3 rounded-lg border border-background-200 bg-background-50 text-[13px] text-foreground-900 outline-none cursor-pointer">
                  <option value="all">All modules</option>
                  {sessionModules.map(name => <option key={name} value={name}>{name}</option>)}
                </select>
                <button onClick={() => { setSessionSearch(''); setSessionModuleFilter('all'); }} disabled={!sessionSearch && sessionModuleFilter === 'all'} className="h-10 px-3 rounded-lg border border-background-200 bg-background-50 text-[12px] font-semibold text-foreground-600 hover:bg-background-100 disabled:opacity-40 disabled:cursor-not-allowed transition-smooth whitespace-nowrap">Reset</button>
                <div className="flex items-center gap-2 md:justify-end">
                  <span className="text-[11px] font-semibold text-foreground-400 uppercase">Show</span>
                  <select value={sessionPageSize} onChange={event => setSessionPageSize(Number(event.target.value))} className="h-10 px-2 rounded-lg border border-background-200 bg-background-50 text-[12px] text-foreground-900 outline-none cursor-pointer">
                    {[25, 50, 100].map(size => <option key={size} value={size}>{size}</option>)}
                  </select>
                </div>
              </div>
              <p className="mt-3 text-[11px] text-foreground-400">{filteredSessions.length} of {activeSessions.length} {sessionKind === 'live' ? 'live sessions' : 'recorded videos'}</p>
            </div>

            {activeSessions.length === 0 ? (
              <EmptyPanel
                title={sessionKind === 'live' ? 'No live sessions yet' : 'No recorded videos yet'}
                message={sessionKind === 'live'
                  ? 'Add a Live Teams Session component to a week in the module builder and it will appear here.'
                  : 'Add a Video component to a week in the module builder and it will appear here.'}
              />
            ) : (
              <div className="overflow-hidden rounded-2xl border border-foreground-200/70 bg-background-50 shadow-sm">
                <div className="flex flex-col gap-3 border-b border-foreground-200/60 bg-[linear-gradient(135deg,#faf8ff_0%,#ffffff_60%,#f0fdf8_100%)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.14em] text-primary-600">{sessionKind === 'live' ? 'Teams delivery schedule' : 'Recorded learning library'}</p>
                    <p className="mt-1 text-[12px] font-semibold text-foreground-600">
                      Showing {filteredSessions.length === 0 ? 0 : sessionStartIndex + 1} - {Math.min(sessionStartIndex + sessionPageSize, filteredSessions.length)} of {filteredSessions.length}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-primary-100 bg-white px-3 py-1.5 text-[10px] font-bold text-primary-700">
                      <AppIcon className={sessionKind === 'live' ? 'ri-microsoft-teams-line' : 'ri-film-line'}></AppIcon>
                      {activeSessions.length} {sessionKind === 'live' ? 'scheduled sessions' : 'recordings'}
                    </span>
                    {sessionKind === 'live' && (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-100 bg-white px-3 py-1.5 text-[10px] font-bold text-emerald-700">
                        <AppIcon className="ri-links-line"></AppIcon>
                        {liveSessions.filter(session => session.url).length} join links ready
                      </span>
                    )}
                  </div>
                </div>
                <div className="divide-y divide-background-200/60">
                  {pagedSessions.map(session => (
                    <article key={session.id} className="grid gap-4 px-5 py-4 transition-smooth hover:bg-primary-50/30 lg:grid-cols-[minmax(260px,1.5fr)_minmax(180px,1fr)_170px_120px_150px] lg:items-center">
                      <div className="flex min-w-0 items-start gap-3">
                        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${session.kind === 'live' ? 'bg-primary-600 text-white' : 'bg-sky-100 text-sky-700'}`}>
                          <AppIcon className={session.kind === 'live' ? 'ri-microsoft-teams-line' : 'ri-film-line'}></AppIcon>
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-[13px] font-black text-foreground-950">{session.title}</p>
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            {session.kind === 'live' && session.attendanceRequired && <span className="rounded-full bg-primary-50 px-2 py-0.5 text-[9px] font-bold text-primary-700"><AppIcon className="ri-user-follow-line mr-1"></AppIcon>Attendance tracked</span>}
                            {session.kind === 'live' && session.recordingExpected && <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[9px] font-bold text-rose-700"><AppIcon className="ri-record-circle-line mr-1"></AppIcon>Recording enabled</span>}
                            {session.kind === 'recorded' && session.ksbRefs.slice(0, 3).map(code => <KsbBadge key={code} code={code} compact />)}
                          </div>
                        </div>
                      </div>

                      <div className="min-w-0">
                        <p className="truncate text-[11px] font-bold text-foreground-800">{session.module}</p>
                        <p className="mt-1 text-[10px] font-semibold text-foreground-400">Week {session.week} Â· {session.weekTitle || `Week ${session.week}`}</p>
                        <p className="mt-1 truncate text-[10px] text-foreground-500">
                          <AppIcon className="ri-group-line mr-1 text-primary-500"></AppIcon>
                          {session.groups.length ? session.groups.join(', ') : 'All assigned groups'}
                        </p>
                      </div>

                      <div className="rounded-xl border border-background-200 bg-background-100/70 px-3 py-2">
                        {session.kind === 'live' ? (
                          <>
                            <p className="text-[11px] font-black text-foreground-800">{formatDateLabel(session.date)}</p>
                            <p className="mt-0.5 text-[10px] font-semibold text-foreground-500">{session.time || 'Time to be confirmed'}</p>
                          </>
                        ) : (
                          <>
                            <p className="truncate text-[11px] font-black text-foreground-800">{session.provider || 'Provider not set'}</p>
                            <p className="mt-0.5 text-[10px] font-semibold text-foreground-500">Recorded content</p>
                          </>
                        )}
                      </div>

                      <div className="flex items-center gap-2 lg:flex-col lg:items-start">
                        <span className="text-[11px] font-bold text-foreground-700"><AppIcon className="ri-time-line mr-1 text-foreground-400"></AppIcon>{session.durationMinutes ? `${session.durationMinutes} min` : 'Duration TBC'}</span>
                        <span className={`rounded-full border px-2.5 py-1 text-[9px] font-bold capitalize ${componentStatusColors[session.status] || componentStatusColors.draft}`}>{session.status}</span>
                      </div>

                      <div className="flex lg:justify-end">
                        {session.url ? (
                          <a href={session.url} target="_blank" rel="noreferrer" className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-primary-600 px-4 text-[11px] font-black text-white shadow-sm transition-smooth hover:bg-primary-700 lg:w-auto">
                            <AppIcon className={session.kind === 'live' ? 'ri-microsoft-teams-line' : 'ri-play-circle-line'}></AppIcon>
                            {session.kind === 'live' ? 'Join meeting' : 'Open recording'}
                            <AppIcon className="ri-external-link-line text-[10px] opacity-80"></AppIcon>
                          </a>
                        ) : (
                          <span className="inline-flex h-10 items-center rounded-xl border border-dashed border-background-300 px-3 text-[10px] font-semibold text-foreground-400">Link not available</span>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
                <div className="flex items-center justify-center gap-3 px-4 py-3 border-t border-foreground-200/60">
                  <div className="flex items-center gap-1">
                    <button onClick={() => setSessionPage(1)} disabled={currentSessionPage === 1} className="w-8 h-8 rounded-lg border border-background-200 bg-background-50 text-foreground-600 hover:bg-background-100 disabled:opacity-40 disabled:cursor-not-allowed">
                      <AppIcon className="ri-skip-left-line text-xs"></AppIcon>
                    </button>
                    <button onClick={() => setSessionPage(page => Math.max(1, page - 1))} disabled={currentSessionPage === 1} className="w-8 h-8 rounded-lg border border-background-200 bg-background-50 text-foreground-600 hover:bg-background-100 disabled:opacity-40 disabled:cursor-not-allowed">
                      <AppIcon className="ri-arrow-left-s-line text-sm"></AppIcon>
                    </button>
                    <span className="px-4 text-[12px] font-semibold text-foreground-800">Page {currentSessionPage} of {sessionPageCount}</span>
                    <button onClick={() => setSessionPage(page => Math.min(sessionPageCount, page + 1))} disabled={currentSessionPage === sessionPageCount} className="w-8 h-8 rounded-lg border border-background-200 bg-background-50 text-foreground-600 hover:bg-background-100 disabled:opacity-40 disabled:cursor-not-allowed">
                      <AppIcon className="ri-arrow-right-s-line text-sm"></AppIcon>
                    </button>
                    <button onClick={() => setSessionPage(sessionPageCount)} disabled={currentSessionPage === sessionPageCount} className="w-8 h-8 rounded-lg border border-background-200 bg-background-50 text-foreground-600 hover:bg-background-100 disabled:opacity-40 disabled:cursor-not-allowed">
                      <AppIcon className="ri-skip-right-line text-xs"></AppIcon>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
            TAB: KSB Heatmap
        Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â */}
        {tab === 'ksb' && (
          <div className="rounded-2xl border border-foreground-200/70 bg-background-50 p-5 shadow-sm">
            <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h3 className="text-sm font-heading font-semibold text-foreground-900">KSB Coverage Heatmap</h3>
                <p className="text-[12px] text-foreground-400 mt-1">Rolled up from component KSB mappings into weeks, modules and programme coverage. Empty cells indicate the KSB is not addressed in that module.</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-2 rounded-lg border border-primary-200 bg-primary-50 px-3 py-1.5 text-[11px] font-bold text-primary-700">
                    <AppIcon className="ri-bookmark-3-line text-sm"></AppIcon>
                    {coverageKsbSource.sourceId
                      ? `Showing KSBs from: ${coverageKsbSourceLabel || coverageKsbSource.sourceId}`
                      : 'No KSB source applied to this programme'}
                  </span>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => window.REACT_APP_NAVIGATE(`/curriculum/module-builder?programme=${encodeURIComponent(PROGRAMME.name)}`)} className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-primary-600 px-3 text-[11px] font-bold text-white transition-smooth hover:bg-primary-700">
                  <AppIcon className="ri-tools-line text-sm"></AppIcon>
                  Edit component weights
                </button>
                <button onClick={() => window.REACT_APP_NAVIGATE('/curriculum/ksb-mapping')} className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-foreground-200 bg-background-50 px-3 text-[11px] font-bold text-foreground-700 transition-smooth hover:bg-background-100">
                  <AppIcon className="ri-list-check-3 text-sm"></AppIcon>
                  Global worklist
                </button>
              </div>
            </div>
            {backendCoverageLoading ? (
              <div className="rounded-xl border border-background-200 bg-background-100 px-4 py-8 text-center text-[12px] font-semibold text-foreground-600">
                <AppIcon className="ri-loader-4-line mr-2 animate-spin text-primary-600"></AppIcon>
                Loading backend KSB coverage...
              </div>
            ) : backendCoverageError ? (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-4 text-[12px] font-semibold text-red-700">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <span>Unable to load actual backend KSB coverage. No fallback or sample KSB data is being shown. {backendCoverageError}</span>
                  <button type="button" onClick={() => { void loadBackendCoverage(); }} className="h-9 rounded-lg bg-white px-3 text-[11px] font-bold text-red-700 shadow-sm">Retry</button>
                </div>
              </div>
            ) : PROGRAMME.ksbHeatmap.length === 0 ? (
              <div className="rounded-xl border border-dashed border-background-300 bg-background-100 px-4 py-10 text-center">
                <p className="text-[13px] font-semibold text-foreground-700">No actual KSB coverage data returned.</p>
                <p className="mt-1 text-[12px] text-foreground-400">The backend did not return any heatmap rows for this programme, so no fallback or sample KSB data is being shown.</p>
                <button type="button" onClick={() => { void loadBackendCoverage(); }} className="mt-4 h-9 rounded-lg border border-background-200 bg-background-50 px-3 text-[11px] font-bold text-foreground-700 shadow-sm hover:bg-background-100">Retry</button>
              </div>
            ) : (
              <>
            <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-5">
              <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3">
                <p className="text-[10px] font-bold uppercase text-emerald-700">Fully covered</p>
                <p className="mt-1 text-lg font-heading font-bold text-emerald-900">{fullyCoveredKsbCount}</p>
              </div>
              <div className="rounded-xl border border-sky-100 bg-sky-50 px-4 py-3">
                <p className="text-[10px] font-bold uppercase text-sky-700">Partial KSBs</p>
                <p className="mt-1 text-lg font-heading font-bold text-sky-900">{partialKsbCount}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-[10px] font-bold uppercase text-slate-700">No weight</p>
                <p className="mt-1 text-lg font-heading font-bold text-slate-900">{mappedNoWeightKsbCount}</p>
              </div>
              <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3">
                <p className="text-[10px] font-bold uppercase text-amber-700">Missing KSBs</p>
                <p className="mt-1 text-lg font-heading font-bold text-amber-900">{missingKsbCount}</p>
              </div>
              <div className="rounded-xl border border-primary-100 bg-primary-50 px-4 py-3">
                <p className="text-[10px] font-bold uppercase text-primary-700">Total occurrences</p>
                <p className="mt-1 text-lg font-heading font-bold text-primary-900">{totalKsbOccurrences}</p>
              </div>
            </div>
            <div className="mb-4 rounded-2xl border border-background-200/80 bg-background-100 p-4">
              <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 items-center">
                <div className="relative">
                  <AppIcon className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></AppIcon>
                  <input value={ksbSearch} onChange={event => setKsbSearch(event.target.value)} placeholder="Search KSB code or title..." className="w-full h-10 pl-9 pr-3 rounded-lg border border-background-200 bg-background-50 text-[13px] text-foreground-900 outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary-100" />
                </div>
                <button onClick={() => setKsbSearch('')} disabled={!ksbSearch} className="h-10 px-3 rounded-lg border border-background-200 bg-background-50 text-[12px] font-semibold text-foreground-600 hover:bg-background-100 disabled:opacity-40 disabled:cursor-not-allowed transition-smooth whitespace-nowrap">Reset</button>
              </div>
              <p className="text-[11px] text-foreground-400 mt-3">{filteredKsbHeatmap.length} of {PROGRAMME.ksbHeatmap.length} KSBs</p>
            </div>
            <KsbHeatmapLegend />
            <KsbHeatmapMatrix rows={filteredKsbHeatmap} moduleNames={PROGRAMME.moduleNames} />
            <div className="hidden overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="border-b border-foreground-400/50">
                    <th className="text-left py-2 px-3 font-semibold text-foreground-400">KSB</th>
                    {PROGRAMME.moduleNames.map(mn => (
                      <th key={mn} className="text-center py-2 px-3 font-semibold text-foreground-400">{mn}</th>
                    ))}
                    <th className="text-center py-2 px-3 font-semibold text-foreground-400">Times</th>
                    <th className="text-center py-2 px-3 font-semibold text-foreground-400">Status</th>
                    <th className="text-left py-2 px-3 font-semibold text-foreground-400">Evidence</th>
                    <th className="text-left py-2 px-3 font-semibold text-foreground-400">Title</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-background-200/30">
                  {filteredKsbHeatmap.map((row, i) => {
                    const state = ksbCoverageState(row);
                    return (
                    <tr key={ksbRowId(row) || i} className={`transition-smooth ${state === 'missing' ? 'bg-amber-50/30 hover:bg-amber-50/50' : 'hover:bg-background-100/30'}`}>
                      <td className="py-2.5 px-3 font-semibold text-foreground-700">
                        <KsbBadge code={row.ksb} />
                      </td>
                      {PROGRAMME.moduleNames.map(mn => {
                        const val = row.coverage[mn];
                        const count = row.counts?.[mn] || 0;
                        return (
                          <td key={mn} className="py-2.5 px-3 text-center">
                            {val !== null && val !== undefined ? (
                              <span className="inline-flex flex-col items-center rounded bg-primary-100 px-2 py-1 text-primary-700">
                                <span className="text-[10px] font-bold leading-none">{val}%</span>
                                <span className="mt-0.5 text-[9px] font-semibold leading-none">x{count || 1}</span>
                              </span>
                            ) : (
                              <span className="text-foreground-300">â€”</span>
                            )}
                          </td>
                        );
                      })}
                      <td className="py-2.5 px-3 text-center text-[11px] font-bold text-foreground-700">{row.totalOccurrences || 0}</td>
                      <td className="py-2.5 px-3 text-center">
                        <CoverageStateBadge state={state} />
                      </td>
                      <td className="py-2.5 px-3">
                        <KsbEvidenceList evidence={row.evidence || {}} />
                      </td>
                      <td className="py-2.5 px-3 text-foreground-500">{row.title}</td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
              </>
            )}
          </div>
        )}

        {/* Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
            TAB: Staffing
        Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â */}
        {tab === 'review' && (
          <div className="space-y-4">
            <section className="overflow-hidden rounded-2xl border border-foreground-200/70 bg-background-50 shadow-sm">
              <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px]">
                <div className="border-b border-foreground-200/60 p-5 xl:border-b-0 xl:border-r">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary-600 text-white">
                      <AppIcon className="ri-checkbox-circle-line text-lg"></AppIcon>
                    </span>
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-[0.16em] text-primary-600">Review</p>
                      <h2 className="text-xl font-heading font-black text-foreground-950">{PROGRAMME.name}</h2>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <span className="rounded-full border border-background-200 bg-background-100 px-3 py-1 text-[11px] font-bold text-foreground-700">{PROGRAMME.duration}</span>
                    <span className="rounded-full border border-background-200 bg-background-100 px-3 py-1 text-[11px] font-bold text-foreground-700">{PROGRAMME.level || 'Level not set'}</span>
                    <span className="rounded-full border border-primary-200 bg-primary-50 px-3 py-1 text-[11px] font-bold text-primary-700">KSB source: {coverageKsbSourceLabel || 'No source applied'}</span>
                  </div>
                  <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
                    <ReviewMetric icon="ri-group-line" label="Cohorts" value={PROGRAMME.cohorts.length} tone="purple" />
                    <ReviewMetric icon="ri-team-line" label="Groups" value={totalGroups} tone="blue" />
                    <ReviewMetric icon="ri-stack-line" label="Modules" value={PROGRAMME.modules.length} tone="slate" />
                    <ReviewMetric icon="ri-time-line" label="OTJH" value={`${formatHours(totalOtjh)}h`} tone="emerald" />
                  </div>
                </div>
                <div className="bg-[linear-gradient(180deg,#fbfffd_0%,#fffaf2_100%)] p-5">
                  <p className="text-[10px] font-black uppercase tracking-[0.16em] text-foreground-400">Readiness</p>
                  <div className="mt-4 space-y-3">
                    <ReviewProgress label="KSB coverage" value={ksbCoverage} color="bg-primary-600" />
                    <ReviewProgress label="Content readiness" value={contentReadiness} color="bg-emerald-500" />
                  </div>
                  <div className="mt-5 grid grid-cols-2 gap-2">
                    <ReviewTinyStat label="Missing KSBs" value={missingKsbCount} />
                    <ReviewTinyStat label="Components" value={allComponents.length} />
                  </div>
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-foreground-200/70 bg-background-50 p-5 shadow-sm">
              <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.16em] text-foreground-400">Delivery map</p>
                  <h3 className="text-base font-heading font-black text-foreground-950">Programme structure at a glance</h3>
                </div>
                <div className="flex flex-wrap gap-2">
                  <span className="rounded-full bg-primary-50 px-3 py-1 text-[11px] font-bold text-primary-700">{totalWeeks} weeks</span>
                  <span className="rounded-full bg-sky-50 px-3 py-1 text-[11px] font-bold text-sky-700">{allComponents.length} components</span>
                  <span className="rounded-full bg-emerald-50 px-3 py-1 text-[11px] font-bold text-emerald-700">{formatHours(totalOtjh)}h OTJH</span>
                </div>
              </div>
              <div className="space-y-3">
                {PROGRAMME.cohorts.map(cohortItem => (
                  <div key={cohortItem.id} className="rounded-xl border border-primary-100 bg-primary-50/30 p-4">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-primary-600 text-white"><AppIcon className="ri-calendar-check-line"></AppIcon></span>
                      <div>
                        <p className="text-[10px] font-black uppercase text-primary-700">Cohort</p>
                        <p className="text-sm font-heading font-black text-foreground-950">{cohortItem.name}</p>
                      </div>
                      <span className="rounded-full bg-background-50 px-2.5 py-1 text-[10px] font-bold text-foreground-600">{cohortItem.startDate} - {cohortItem.endDate}</span>
                      <span className="rounded-full bg-background-50 px-2.5 py-1 text-[10px] font-bold text-foreground-600">{cohortItem.groups.length} groups</span>
                    </div>
                    <div className="mt-3 rounded-xl border border-amber-100 bg-amber-50/70 px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wide text-amber-800">
                          <AppIcon className="ri-calendar-event-line text-sm"></AppIcon>
                          Applied holidays
                        </span>
                        {cohortItem.holidays?.length ? cohortItem.holidays.map(holiday => (
                          <span key={String(holiday.id)} className="rounded-full border border-amber-200 bg-background-50 px-2.5 py-1 text-[10px] font-bold text-amber-800">
                            {holiday.label || 'Holiday'}{holiday.startDate ? ` Â· ${formatDateLabel(holiday.startDate)}` : ''}
                          </span>
                        )) : (
                          <span className="rounded-full border border-background-200 bg-background-50 px-2.5 py-1 text-[10px] font-bold text-foreground-500">No holidays applied</span>
                        )}
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
                      {cohortItem.groups.map(groupItem => {
                        const groupModules = groupItem.modules.length
                          ? groupItem.modules
                          : PROGRAMME.modules.filter(mod => clean(mod.cohort) === cohortItem.name && clean(mod.group) === groupItem.name);
                        const groupOtjh = groupModules.reduce((sum, mod) => sum + Number(mod.otjh || 0), 0);
                        const groupComponents = groupModules.reduce((sum, mod) => sum + mod.weeksData.reduce((weekSum, wk) => weekSum + (wk.components?.length || 0), 0), 0);
                        return (
                          <div key={groupItem.id} className="rounded-xl border border-background-200 bg-background-50 p-4">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <p className="text-[10px] font-black uppercase text-slate-500">Group</p>
                                <h4 className="text-sm font-heading font-black text-foreground-950">{groupItem.name}</h4>
                                <p className="mt-1 text-[11px] font-semibold text-foreground-500">{groupItem.schedule} - {groupItem.mode}</p>
                              </div>
                              <div className="flex flex-wrap justify-end gap-1.5">
                                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-black text-emerald-700">{formatHours(groupOtjh)}h</span>
                                <span className="rounded-full bg-primary-50 px-2 py-0.5 text-[10px] font-black text-primary-700">{groupModules.length} modules</span>
                                <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-black text-sky-700">{groupComponents} comp</span>
                              </div>
                            </div>
                            <div className="mt-3 grid grid-cols-1 gap-2">
                              <ReviewInfo label="Coach" value={groupItem.coach} icon="ri-heart-line" />
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2">
                              {groupModules.map(mod => (
                                <span key={mod.id} className="inline-flex items-center gap-1.5 rounded-lg border border-background-200 bg-background-100 px-2.5 py-1 text-[11px] font-bold text-foreground-700">
                                  <AppIcon className="ri-stack-line text-primary-600"></AppIcon>
                                  {mod.name}
                                  <span className="text-emerald-700">{formatHours(mod.otjh)}h</span>
                                </span>
                              ))}
                              {groupModules.length === 0 && (
                                <span className="rounded-lg border border-dashed border-background-300 px-2.5 py-1 text-[11px] font-semibold text-foreground-500">No modules linked</span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              {PROGRAMME.modules.map(mod => {
                const componentCount = mod.weeksData.reduce((sum, wk) => sum + (wk.components?.length || 0), 0);
const mappedKsbCodes = [...new Set([
                  ...mod.ksbTags.map(value => clean(value)).filter(Boolean),
                  ...mod.ksbMapping.map(item => item.ksb),
                ])];
                return (
                  <article key={mod.id} className="overflow-hidden rounded-2xl border border-foreground-200/70 bg-background-50 shadow-sm">
                    <div className="border-b border-foreground-200/60 bg-background-100/60 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-[0.14em] text-primary-600">Module</p>
                          <h3 className="text-base font-heading font-black text-foreground-950">{mod.name}</h3>
                          <p className="mt-1 text-[11px] font-bold text-foreground-500">{mod.cohort || 'No cohort'} / {mod.group || 'No group'}</p>
                        </div>
                        <span className="rounded-xl bg-emerald-50 px-3 py-2 text-[13px] font-black text-emerald-700">{formatHours(mod.otjh)}h OTJH</span>
                      </div>
                    </div>
                    <div className="space-y-3 p-4">
                      <div className="grid grid-cols-3 gap-2">
                        <ReviewTinyStat label="Weeks" value={mod.weeksData.length} />
                        <ReviewTinyStat label="Components" value={componentCount} />
                        <ReviewTinyStat label="KSBs" value={mappedKsbCodes.length} />
                      </div>
                      <div className="grid grid-cols-1 gap-2">
                        <ReviewInfo icon="ri-user-settings-line" label="Tutor" value={mod.tutor || 'Unassigned'} />
                      </div>
                      <div>
                        <p className="mb-2 text-[10px] font-black uppercase tracking-wide text-foreground-400">Weeks</p>
                        <div className="max-h-[300px] space-y-2 overflow-y-auto pr-1">
                          {mod.weeksData.map(wk => (
                            <div key={wk.id} className="grid grid-cols-[52px_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-background-200 bg-background-100 px-3 py-2">
                              <span className="text-[10px] font-black uppercase text-foreground-400">W{wk.number}</span>
                              <div className="min-w-0">
                                <p className="truncate text-[11px] font-black text-foreground-900">{wk.title || `Week ${wk.number}`}</p>
                                <p className="text-[10px] text-foreground-500">{wk.startDate}</p>
                              </div>
                              <div className="flex shrink-0 gap-1.5">
                                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[9px] font-bold text-emerald-700">{formatHours(wk.otjh)}h</span>
                                <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[9px] font-bold text-sky-700">{wk.components?.length || 0} comp</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </section>
          </div>
        )}

        {programmeFormOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setProgrammeFormOpen(false)}>
            <form onSubmit={saveProgramme} className="bg-background-50 rounded-2xl w-full max-w-xl shadow-2xl" onClick={event => event.stopPropagation()}>
              <div className="px-6 py-4 border-b border-foreground-400/50 flex items-center justify-between">
                <h3 className="text-sm font-heading font-semibold text-foreground-900">Edit Programme</h3>
                <button type="button" onClick={() => setProgrammeFormOpen(false)} className="w-8 h-8 rounded-lg bg-background-100 flex items-center justify-center hover:bg-background-200 transition-smooth cursor-pointer"><AppIcon className="ri-close-line text-foreground-500"></AppIcon></button>
              </div>
              <div className="p-6 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <label className="block">
                    <span className="text-[10px] font-semibold text-foreground-400 uppercase">Programme name *</span>
                    <input value={programmeForm.name} onChange={event => setProgrammeForm(prev => ({ ...prev, name: event.target.value }))} required className="mt-1 w-full px-3 py-2 bg-background-50 border border-foreground-200/60 rounded-lg text-[13px] text-foreground-900 focus:outline-none focus:border-primary-300" />
                  </label>
                  <label className="block">
                    <span className="text-[10px] font-semibold text-foreground-400 uppercase">Level</span>
                    <input value={programmeForm.level} onChange={event => setProgrammeForm(prev => ({ ...prev, level: event.target.value }))} placeholder="Example: L4" className="mt-1 w-full px-3 py-2 bg-background-50 border border-foreground-200/60 rounded-lg text-[13px] text-foreground-900 placeholder:text-foreground-300 focus:outline-none focus:border-primary-300" />
                  </label>
                  <label className="block">
                    <span className="text-[10px] font-semibold text-foreground-400 uppercase">Owner</span>
                    <input value={programmeForm.owner} onChange={event => setProgrammeForm(prev => ({ ...prev, owner: event.target.value }))} className="mt-1 w-full px-3 py-2 bg-background-50 border border-foreground-200/60 rounded-lg text-[13px] text-foreground-900 focus:outline-none focus:border-primary-300" />
                  </label>
                  <label className="block">
                    <span className="text-[10px] font-semibold text-foreground-400 uppercase">Colour</span>
                    <input type="color" value={programmeForm.color} onChange={event => setProgrammeForm(prev => ({ ...prev, color: event.target.value }))} className="mt-1 w-full h-9 px-2 py-1 bg-background-50 border border-foreground-200/60 rounded-lg focus:outline-none focus:border-primary-300" />
                  </label>
                </div>
                <label className="block">
                  <span className="text-[10px] font-semibold text-foreground-400 uppercase">Description</span>
                  <textarea value={programmeForm.description} onChange={event => setProgrammeForm(prev => ({ ...prev, description: event.target.value }))} rows={3} className="mt-1 w-full px-3 py-2 bg-background-50 border border-foreground-200/60 rounded-lg text-[13px] text-foreground-900 focus:outline-none focus:border-primary-300" />
                </label>
              </div>
              <div className="px-6 py-4 border-t border-background-200/60 flex justify-end gap-2">
                <button type="button" onClick={() => setProgrammeFormOpen(false)} disabled={savingAction === 'programme'} className="px-4 py-2 rounded-lg border border-background-200 text-[12px] font-semibold text-foreground-600 hover:bg-background-100 disabled:opacity-50">Cancel</button>
                <button type="submit" disabled={savingAction === 'programme'} className="px-4 py-2 rounded-lg bg-primary-500 text-white text-[12px] font-semibold hover:bg-primary-600 disabled:opacity-50">{savingAction === 'programme' ? 'Saving...' : 'Save Programme'}</button>
              </div>
            </form>
          </div>
        )}

        {wizardOpen && (
          <AddCurriculumStructureWizard
            isOpen={wizardOpen}
            onClose={() => setWizardOpen(false)}
onSaved={async () => {
              await reload();
            }}
            initialProgrammeId={id || PROGRAMME.id}
            initialProgramme={wizardProgramme}
            initialCohortId={wizardContext.cohortId}
            initialGroupId={wizardContext.groupId}
            startStep={wizardContext.startStep || 'cohort'}
          />
        )}
        {ksbTraceOpen && (
          <KsbTraceModal
            programme={PROGRAMME}
            initialTab={ksbTraceInitialTab}
            onClose={() => setKsbTraceOpen(false)}
          />
        )}
      </div>
    </WorkspaceShell>
  );
}

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
// Helper Components
// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

function StatPill({ icon, value, label }: { icon: string; value: number | string; label: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-foreground-200/70 bg-background-50 p-3 shadow-sm">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
        <AppIcon className={`${icon} text-sm`}></AppIcon>
      </span>
      <div>
        <p className="text-base font-black leading-tight text-foreground-950">{value}</p>
        <p className="mt-0.5 text-[9px] font-bold uppercase tracking-wide text-foreground-400">{label}</p>
      </div>
    </div>
  );
}

function formatHours(value: number | string) {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed)) return '0';
  return Number.isInteger(parsed) ? String(parsed) : parsed.toFixed(1).replace(/\.0$/, '');
}

function ReviewMetric({ icon, label, value, tone }: { icon: string; label: string; value: number | string; tone: 'purple' | 'blue' | 'slate' | 'emerald' }) {
  const tones = {
    purple: 'border-primary-100 bg-primary-50 text-primary-700',
    blue: 'border-sky-100 bg-sky-50 text-sky-700',
    slate: 'border-slate-200 bg-slate-50 text-slate-700',
    emerald: 'border-emerald-100 bg-emerald-50 text-emerald-700',
  };
  return (
    <div className={`rounded-xl border p-3 ${tones[tone]}`}>
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/70">
          <AppIcon className={`${icon} text-sm`}></AppIcon>
        </span>
        <p className="text-xl font-black leading-none">{value}</p>
      </div>
      <p className="mt-2 text-[9px] font-black uppercase tracking-wide opacity-80">{label}</p>
    </div>
  );
}

function ReviewProgress({ label, value, color }: { label: string; value: number; color: string }) {
  const safe = Math.max(0, Math.min(100, Math.round(value || 0)));
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[11px] font-bold text-foreground-700">{label}</span>
        <span className="text-[11px] font-black text-foreground-900">{safe}%</span>
      </div>
      <div className="h-2 rounded-full bg-background-200">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${safe}%` }} />
      </div>
    </div>
  );
}

function ReviewTinyStat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border border-background-200 bg-background-50 px-3 py-2">
      <p className="text-base font-black leading-tight text-foreground-950">{value}</p>
      <p className="mt-1 text-[9px] font-black uppercase tracking-wide text-foreground-400">{label}</p>
    </div>
  );
}

function ReviewInfo({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="grid grid-cols-[24px_82px_minmax(0,1fr)] items-center gap-2 rounded-lg border border-background-200 bg-background-100 px-3 py-2">
      <span className="flex h-6 w-6 items-center justify-center rounded-md bg-background-50 text-primary-600">
        <AppIcon className={`${icon} text-xs`}></AppIcon>
      </span>
      <span className="text-[9px] font-black uppercase tracking-wide text-foreground-400">{label}</span>
      <span className="min-w-0 truncate text-[11px] font-black text-foreground-900">{value || 'Not set'}</span>
    </div>
  );
}

function TeamsResultsDetails({ liveSessionId, data }: { liveSessionId: string; data: TeamsMeetingArtifactsResult }) {
  const [transcripts, setTranscripts] = useState<Record<string, Array<{ start: string; speaker: string; text: string }>>>({});
  const [transcriptErrors, setTranscriptErrors] = useState<Record<string, string>>({});
  const completed = data.occurrences.filter(occurrence => (
    occurrence.attendance.length > 0
    || occurrence.artifacts.length > 0
    || Number(occurrence.participant_count) > 0
  ));
  const transcriptArtifacts = useMemo(() => data.occurrences.flatMap(occurrence => (
    occurrence.artifacts.filter(artifact => artifact.artifact_type === 'transcript')
  )), [data.occurrences]);

  useEffect(() => {
    let cancelled = false;
    const parseVtt = (value: string) => {
      const lines = value.replace(/\r/g, '').split('\n');
      const cues: Array<{ start: string; speaker: string; text: string }> = [];
      for (let index = 0; index < lines.length; index += 1) {
        const timing = lines[index].match(/^(\d{2}:\d{2}:\d{2}\.\d{3})\s+-->/);
        if (!timing) continue;
        const textLines: string[] = [];
        index += 1;
        while (index < lines.length && lines[index].trim()) {
          textLines.push(lines[index].trim());
          index += 1;
        }
        const rawText = textLines.join(' ');
        const speakerMatch = rawText.match(/<v\s+([^>]+)>([\s\S]*?)<\/v>/i);
        const speaker = speakerMatch?.[1]?.trim() || 'Speaker';
        const text = (speakerMatch?.[2] || rawText)
          .replace(/<[^>]+>/g, '')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .trim();
        if (text) cues.push({ start: timing[1].replace(/^00:/, ''), speaker, text });
      }
      return cues;
    };

    transcriptArtifacts.forEach(artifact => {
      fetch(teamsMeetingArtifactContentUrl(liveSessionId, artifact.id))
        .then(async response => {
          if (!response.ok) throw new Error(`Transcript returned ${response.status}`);
          return response.text();
        })
        .then(value => {
          if (!cancelled) {
            setTranscripts(previous => ({ ...previous, [artifact.id]: parseVtt(value) }));
          }
        })
        .catch(error => {
          if (!cancelled) {
            setTranscriptErrors(previous => ({
              ...previous,
              [artifact.id]: error instanceof Error ? error.message : 'Unable to load transcript.',
            }));
          }
        });
    });
    return () => {
      cancelled = true;
    };
  }, [liveSessionId, transcriptArtifacts]);

  const formatDateTime = (value?: string) => {
    if (!value) return 'Date unavailable';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
  };
  const formatDuration = (seconds: number) => {
    const totalSeconds = Math.max(0, Math.round(Number(seconds || 0)));
    if (totalSeconds < 60) return `${totalSeconds}s`;
    const minutes = Math.floor(totalSeconds / 60);
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return hours ? `${hours}h ${remainder}m` : `${remainder}m`;
  };
  const attendanceWindow = (intervals?: Array<{ joinDateTime?: string; leaveDateTime?: string }> | string) => {
    let parsedIntervals: Array<{ joinDateTime?: string; leaveDateTime?: string }> = [];
    if (Array.isArray(intervals)) {
      parsedIntervals = intervals;
    } else if (typeof intervals === 'string' && intervals.trim()) {
      try {
        const parsed = JSON.parse(intervals);
        parsedIntervals = Array.isArray(parsed) ? parsed : [];
      } catch {
        parsedIntervals = [];
      }
    }
    const valid = parsedIntervals.filter(interval => interval && (interval.joinDateTime || interval.leaveDateTime));
    if (!valid.length) return '';
    const firstJoin = valid[0]?.joinDateTime;
    const lastLeave = valid.at(-1)?.leaveDateTime;
    const time = (value?: string) => {
      if (!value) return '';
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    };
    return [firstJoin ? `Joined ${time(firstJoin)}` : '', lastLeave ? `Left ${time(lastLeave)}` : ''].filter(Boolean).join(' Â· ');
  };

  return (
    <div className="mt-3 space-y-3 border-t border-primary-200 pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[10px] font-black uppercase tracking-wide text-primary-700">Verified Teams attendance</p>
          <p className="mt-0.5 text-[9px] font-semibold text-foreground-500">Only people recorded in Microsoft Teams attendance reports are shownâ€”not the invitation list.</p>
        </div>
        <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-bold text-foreground-600">
          {completed.length} session{completed.length === 1 ? '' : 's'} with results
        </span>
      </div>
      {completed.length ? completed.map(occurrence => (
        <div key={occurrence.id} className="overflow-hidden rounded-xl border border-primary-100 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2 bg-primary-50/70 px-3 py-2">
            <div>
              <p className="text-[11px] font-black text-foreground-900">Session {occurrence.session_number}</p>
              <p className="text-[10px] font-semibold text-foreground-500">
                {formatDateTime(occurrence.actual_start || occurrence.scheduled_start)}
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <span className="rounded-full bg-sky-100 px-2 py-1 text-[9px] font-bold text-sky-800">
                {occurrence.attendance.length} attendance
              </span>
              <span className="rounded-full bg-violet-100 px-2 py-1 text-[9px] font-bold text-violet-800">
                {occurrence.artifacts.filter(item => item.artifact_type === 'transcript').length} transcript
              </span>
              <span className="rounded-full bg-emerald-100 px-2 py-1 text-[9px] font-bold text-emerald-800">
                {occurrence.artifacts.filter(item => item.artifact_type === 'recording').length} recording
              </span>
            </div>
          </div>

          {occurrence.attendance.length > 0 && (
            <div className="border-t border-background-200">
              <div className="grid grid-cols-[minmax(0,1fr)_90px] bg-background-100/70 px-3 py-1.5 text-[9px] font-black uppercase text-foreground-400">
                <span>Participant</span>
                <span className="text-right">Attended</span>
              </div>
              {occurrence.attendance.map(person => (
                <div key={person.id} className="grid grid-cols-[minmax(0,1fr)_90px] items-center border-t border-background-100 px-3 py-2">
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500"></span>
                      <p className="truncate text-[10px] font-bold text-foreground-800">{person.display_name || person.email || 'Unknown participant'}</p>
                    </div>
                    {person.email && <p className="truncate text-[9px] font-medium text-foreground-400">{person.email}</p>}
                    {attendanceWindow(person.intervals) && <p className="mt-0.5 truncate text-[9px] font-semibold text-foreground-500">{attendanceWindow(person.intervals)}</p>}
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] font-black text-emerald-700">{formatDuration(person.total_attendance_seconds)}</p>
                    <p className="text-[8px] font-bold uppercase text-emerald-600">{person.total_attendance_seconds > 0 ? 'Attended' : 'Joined'}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {occurrence.artifacts.length > 0 && (
            <div className="flex flex-wrap gap-2 border-t border-background-200 px-3 py-2.5">
              {occurrence.artifacts.map(artifact => (
                <a
                  key={artifact.id}
                  href={teamsMeetingArtifactContentUrl(liveSessionId, artifact.id)}
                  target={artifact.artifact_type === 'transcript' ? '_blank' : undefined}
                  rel="noreferrer"
                  download
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-primary-200 bg-primary-50 px-3 text-[10px] font-bold text-primary-700 hover:bg-primary-100"
                >
                  <AppIcon className={artifact.artifact_type === 'recording' ? 'ri-download-cloud-2-line' : 'ri-file-text-line'}></AppIcon>
                  {artifact.artifact_type === 'recording' ? 'Download recording' : 'Download transcript'}
                </a>
              ))}
            </div>
          )}

          {occurrence.artifacts.filter(artifact => artifact.artifact_type === 'transcript').map(artifact => (
            <div key={`${artifact.id}-inline`} className="border-t border-background-200 bg-background-50/60 px-3 py-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div>
                  <p className="text-[10px] font-black uppercase text-foreground-700">Meeting transcript</p>
                  <p className="text-[9px] font-semibold text-foreground-400">Speaker-attributed text from Microsoft Teams</p>
                </div>
                <AppIcon className="ri-file-text-line text-base text-primary-500"></AppIcon>
              </div>
              {transcriptErrors[artifact.id] ? (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-[10px] font-semibold text-red-700">{transcriptErrors[artifact.id]}</p>
              ) : transcripts[artifact.id] ? (
                transcripts[artifact.id].length ? (
                  <div className="max-h-72 space-y-2 overflow-y-auto rounded-lg border border-background-200 bg-white p-2.5">
                    {transcripts[artifact.id].map((cue, index) => (
                      <div key={`${artifact.id}-${cue.start}-${index}`} className="grid grid-cols-[48px_minmax(0,1fr)] gap-2 rounded-lg bg-background-100/70 px-2.5 py-2">
                        <span className="text-[9px] font-bold text-primary-600">{cue.start}</span>
                        <div className="min-w-0">
                          <p className="text-[9px] font-black text-foreground-700">{cue.speaker}</p>
                          <p className="mt-0.5 whitespace-pre-wrap text-[11px] leading-5 text-foreground-800">{cue.text}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="rounded-lg bg-white px-3 py-2 text-[10px] font-semibold text-foreground-500">The transcript is empty.</p>
                )
              ) : (
                <p className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-2 text-[10px] font-semibold text-foreground-500">
                  <AppIcon className="ri-loader-4-line animate-spin"></AppIcon>Loading transcript text...
                </p>
              )}
            </div>
          ))}
        </div>
      )) : (
        <p className="rounded-lg bg-white px-3 py-3 text-[10px] font-semibold text-foreground-500">
          No completed session results are stored yet. Run Sync results after the Teams meeting ends.
        </p>
      )}
    </div>
  );
}

function ModuleCardMetric({ icon, label, value, tone = 'purple' }: { icon: string; label: string; value: number | string; tone?: 'purple' | 'blue' | 'emerald' | 'amber' }) {
  const tones = {
    purple: 'border-primary-100 bg-primary-50 text-primary-700',
    blue: 'border-sky-100 bg-sky-50 text-sky-700',
    emerald: 'border-emerald-100 bg-emerald-50 text-emerald-700',
    amber: 'border-amber-100 bg-amber-50 text-amber-700',
  };
  return (
    <div className={`flex items-center gap-2 rounded-xl border px-2.5 py-2 ${tones[tone]}`}>
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/70">
        <AppIcon className={`${icon} text-sm`}></AppIcon>
      </span>
      <div className="min-w-0">
        <p className="truncate text-sm font-black leading-tight text-current">{value}</p>
        <p className="mt-0.5 text-[9px] font-bold uppercase leading-tight text-foreground-500">{label}</p>
      </div>
    </div>
  );
}

function ModuleDetailLine({ icon, label, value }: { icon: string; label: string; value: number | string }) {
  return (
    <div className="grid min-w-0 grid-cols-[24px_112px_minmax(0,1fr)] items-center gap-2 rounded-lg bg-background-50 px-2 py-1.5 text-[11px]">
      <span className="grid h-6 w-6 place-items-center rounded-md bg-background-100 text-primary-600">
        <AppIcon className={`${icon} text-xs`}></AppIcon>
      </span>
      <span className="font-black uppercase tracking-wide text-foreground-400">{label}</span>
      <span className="w-fit max-w-full min-w-0 truncate rounded-md border border-background-200 bg-white px-2 py-1 text-left font-black text-foreground-950 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.65)]">{value}</span>
    </div>
  );
}

function HealthRing({ value, color }: { value: number; color?: string }) {
  const safe = Math.max(0, Math.min(100, Math.round(value || 0)));
  const ring = color || 'oklch(var(--primary-500))';
  return (
    <div className="relative h-14 w-14 shrink-0" role="img" aria-label={`Programme health ${safe} percent`}>
      <div className="h-14 w-14 rounded-full" style={{ background: `conic-gradient(${ring} ${safe * 3.6}deg, oklch(var(--background-200)) ${safe * 3.6}deg)` }} />
      <div className="absolute inset-[4px] flex items-center justify-center rounded-full bg-background-50">
        <span className="text-[13px] font-black text-foreground-900">{safe}%</span>
      </div>
    </div>
  );
}

function ProgressRow({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <span className="text-[10px] font-bold uppercase tracking-wide text-foreground-500">{label}</span>
        <span className="text-[11px] font-black text-foreground-900">{value}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-background-200">
        <div className="h-full rounded-full bg-emerald-400" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
    </div>
  );
}

function MiniDarkMetric({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <p className="text-[15px] font-black leading-tight text-foreground-950">{value}</p>
      <p className="mt-0.5 text-[9px] font-bold uppercase leading-tight text-foreground-400">{label}</p>
    </div>
  );
}

function LoadingStatPill({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 bg-background-100 rounded-lg p-3">
      <span className="w-4 h-4 rounded bg-background-200 animate-pulse" />
      <div className="min-w-0 flex-1">
        <div className="h-4 w-10 rounded bg-background-200 animate-pulse mb-1" />
        <p className="text-[9px] text-foreground-400 uppercase">{label}</p>
      </div>
    </div>
  );
}

function ModuleTooltipMetric({ icon, label, value }: { icon: string; label: string; value: number | string }) {
  return (
    <span className="flex items-center gap-2 rounded-lg bg-background-100 border border-foreground-200/60 px-2.5 py-2">
      <AppIcon className={`${icon} text-primary-500 text-xs`}></AppIcon>
      <span className="min-w-0">
        <span className="block text-[9px] font-bold text-foreground-400 uppercase leading-tight">{label}</span>
        <span className="block text-[11px] font-semibold text-foreground-800 truncate leading-tight mt-0.5">{value}</span>
      </span>
    </span>
  );
}

function componentTypeLabel(type: string) {
  return clean(type, 'Component')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, letter => letter.toUpperCase());
}

function ksbClassificationLabel(value?: string) {
  const classification = clean(value).toLowerCase();
  if (classification === 'main') return 'Hard';
  if (classification === 'secondary') return 'Soft';
  if (classification === 'possible') return 'Possible';
  return clean(value, 'Soft');
}

function componentTypeTone(type: string) {
  const key = normalise(type);
  if (key.includes('live')) return 'bg-primary-100 text-primary-700';
  if (key.includes('quiz')) return 'bg-amber-100 text-amber-700';
  if (key.includes('assignment') || key.includes('evidence')) return 'bg-sky-100 text-sky-700';
  if (key.includes('reading') || key.includes('selfstudy')) return 'bg-emerald-100 text-emerald-700';
  if (key.includes('video') || key.includes('podcast')) return 'bg-secondary-100 text-secondary-700';
  return 'bg-foreground-100 text-foreground-600';
}

function KsbBadge({ code, compact = false }: { code: string; compact?: boolean }) {
  return (
    <span className={`${compact ? 'text-[9px] px-1.5 py-0.5' : 'text-[10px] px-2 py-0.5'} inline-flex items-center rounded-md border font-semibold ${ksbTone(ksbKind(code))}`}>
      {formatKsbCode(code)}
    </span>
  );
}

function KsbGroupedTags({ codes, limit }: { codes: string[]; limit?: number }) {
  const sorted = [...new Set(codes.map(code => clean(code)).filter(Boolean))].sort(sortKsbCodes);
  const visible = typeof limit === 'number' ? sorted.slice(0, limit) : sorted;
  const groups = visible.reduce<Record<string, string[]>>((acc, code) => {
    const parent = ksbParentCode(code);
    acc[parent] = [...(acc[parent] ?? []), code];
    return acc;
  }, {});

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {Object.entries(groups).map(([parent, children]) => {
        const childCodes = children.filter(code => formatKsbCode(code) !== parent);
        return (
          <div key={parent} className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-1 ${ksbTone(ksbKind(parent))}`}>
            <div className="text-[9px] font-bold leading-tight">{parent}</div>
            {childCodes.length > 0 && (
              <div className="flex items-center gap-0.5 flex-wrap">
                {childCodes.map(code => <KsbBadge key={code} code={code} compact />)}
              </div>
            )}
          </div>
        );
      })}
      {typeof limit === 'number' && sorted.length > limit && (
        <span className="text-[10px] font-semibold text-foreground-400 px-2 py-1">+{sorted.length - limit}</span>
      )}
    </div>
  );
}

function KsbCoverageGroups({ mapping }: { mapping: ModuleKsbMappingSummary[] }) {
  const sorted = [...mapping].sort((a, b) => sortKsbCodes(a.ksb, b.ksb));
  if (!sorted.length) {
    return (
      <div className="rounded-lg border border-dashed border-background-300 bg-background-100 px-3 py-3 text-[11px] font-semibold text-foreground-400">
        No KSBs mapped to this module yet.
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {sorted.map(item => {
        const hasRealWeight = item.source !== 'fallback' && Number(item.weight || 0) > 0;
        return (
          <div key={item.ksb} className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 ${ksbTone(ksbKind(item.ksb))}`} title={hasRealWeight ? 'Weighted in Module Builder' : 'Linked KSB. Weight is 0 or not set yet.'}>
            <span className="text-[10px] font-bold">{formatKsbCode(item.ksb)}</span>
            {hasRealWeight ? (
              <>
                <span className="w-10 h-1.5 bg-white/70 rounded-full overflow-hidden">
                  <span className="block h-full bg-current rounded-full" style={{ width: `${item.weight}%` }}></span>
                </span>
                <span className="text-[9px] font-semibold">{item.weight}%</span>
              </>
            ) : (
              <span className="text-[9px] font-bold uppercase">No weight</span>
            )}
          </div>
        );
      })}
    </div>
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
      status: row.status,
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
    <div className="overflow-x-auto rounded-2xl border border-background-200 bg-background-50 shadow-sm">
      <div className="min-w-[980px]">
        <div className="grid items-center gap-3 border-b border-background-200 bg-background-100/80 px-4 py-3" style={{ gridTemplateColumns }}>
          <span className="text-[10px] font-bold uppercase text-foreground-400">KSB outcome</span>
          {moduleNames.map(moduleName => (
            <span key={moduleName} className="text-center text-[10px] font-bold uppercase text-foreground-400">{moduleName}</span>
          ))}
          <span className="text-center text-[10px] font-bold uppercase text-foreground-400">Status</span>
          <span className="text-[10px] font-bold uppercase text-foreground-400">Evidence trail</span>
        </div>
        <div className="divide-y divide-background-200">
          {rows.map(row => {
            const kind = ksbKind(row.ksb);
            const state = ksbCoverageState(row);
            const rowId = ksbRowId(row);
            return (
              <div key={rowId} className={`grid items-stretch gap-3 px-4 py-3 transition-smooth ${state === 'missing' ? 'bg-amber-50/30 hover:bg-amber-50/60' : 'hover:bg-background-100/60'}`} style={{ gridTemplateColumns }}>
                <div className="min-w-0">
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
                  <CoverageStateBadge state={state} size="md" />
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

type KsbTraceTab = 'map' | 'coverage' | 'trace';
type KsbCoverageState = 'fully_covered' | 'partial' | 'over_allocated' | 'mapped' | 'missing';
type KsbTraceEvidence = KsbEvidenceItem & { moduleLabel: string; groups: string[] };

function ksbRowId(row: Pick<KsbHeatmapRow, 'id' | 'ksb' | 'sourceType' | 'sourceId'>) {
  return clean(row.id) || [row.sourceType, row.sourceId, row.ksb].map(normalise).join('|') || row.ksb;
}

function KsbTraceModal({ programme, onClose }: { programme: Programme; initialTab: KsbTraceTab; onClose: () => void }) {
  const [search, setSearch] = useState('');
  const [kindFilter, setKindFilter] = useState<'all' | KsbKind>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | KsbCoverageState>('all');
  const [moduleFilter, setModuleFilter] = useState('all');
  const [weekFilter, setWeekFilter] = useState('all');
  const [componentFilter, setComponentFilter] = useState('all');
  const [groupFilter, setGroupFilter] = useState('all');

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
      const state = ksbCoverageState(row);
      const matchesSearch = !query || [
        row.ksb,
        formatKsbCode(row.ksb),
        row.title,
        ksbSourceLabel(row),
        ...evidence.flatMap(item => [item.module, item.week, item.component, item.componentType, ...item.groups]),
      ].some(value => normalise(value).includes(query));
      const matchesKind = kindFilter === 'all' || ksbKind(row.ksb) === kindFilter;
      const matchesStatus = statusFilter === 'all' || state === statusFilter;
      const matchesModule = moduleFilter === 'all' || evidence.some(item => normalise(item.module) === normalise(moduleFilter)) || Number(row.coverage[moduleFilter] || 0) > 0;
      const matchesWeek = weekFilter === 'all' || evidence.some(item => normalise(item.week) === normalise(weekFilter));
      const matchesComponent = componentFilter === 'all' || evidence.some(item => normalise(item.component) === normalise(componentFilter));
      const matchesGroup = groupFilter === 'all' || evidence.some(item => item.groups.some(group => normalise(group) === normalise(groupFilter)));
      return matchesSearch && matchesKind && matchesStatus && matchesModule && matchesWeek && matchesComponent && matchesGroup;
    });
  }, [programme.ksbHeatmap, evidenceByCode, search, kindFilter, statusFilter, moduleFilter, weekFilter, componentFilter, groupFilter]);

  const summary = ksbTraceSummary(programme.ksbHeatmap);

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl bg-background-50 shadow-2xl" onClick={event => event.stopPropagation()}>
        <div className="bg-primary-950 px-5 py-4 text-white">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wide text-white/60">Curriculum KSB Coverage</p>
              <h3 className="mt-0.5 text-base font-heading font-bold text-white">{programme.name}</h3>
              <p className="mt-1 text-[12px] font-semibold text-white/70">{programme.standard || 'Selected KSB profile'}</p>
            </div>
            <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 text-white transition-smooth hover:bg-white/20 lg:self-start">
              <AppIcon className="ri-close-line"></AppIcon>
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
            <KsbTraceStat label="Profile KSBs" value={summary.total} tone="primary" />
            <KsbTraceStat label="Fully covered" value={summary.fullyCovered} tone="emerald" />
            <KsbTraceStat label="Partial" value={summary.partial} tone="primary" />
            <KsbTraceStat label="Missing" value={summary.missing} tone="amber" />
            <KsbTraceStat label="No weight" value={summary.mappedNoWeight} tone="slate" />
          </div>

          <div className="mb-4 rounded-2xl border border-background-200 bg-background-100/60 p-4">
            <div className="grid grid-cols-1 gap-2 lg:grid-cols-[1.2fr_repeat(6,minmax(120px,0.6fr))]">
              <div className="relative">
                <AppIcon className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></AppIcon>
                <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search KSB, module, week, component, group..." className="h-10 w-full rounded-lg border border-background-200 bg-background-50 pl-9 pr-3 text-[12px] text-foreground-900 outline-none focus:border-primary-300" />
              </div>
              <KsbTraceSelect value={kindFilter} onChange={value => setKindFilter(value as 'all' | KsbKind)} options={['all', 'knowledge', 'skill', 'behaviour']} labels={{ all: 'All types', knowledge: 'Knowledge', skill: 'Skills', behaviour: 'Behaviours' }} />
              <KsbTraceSelect value={statusFilter} onChange={value => setStatusFilter(value as 'all' | KsbCoverageState)} options={['all', 'fully_covered', 'partial', 'over_allocated', 'mapped', 'missing']} labels={{ all: 'All status', fully_covered: 'Fully covered', partial: 'Partial', over_allocated: 'Over allocated', mapped: 'No weight', missing: 'Missing' }} />
              <KsbTraceSelect value={moduleFilter} onChange={setModuleFilter} options={['all', ...moduleOptions]} labels={{ all: 'All modules' }} />
              <KsbTraceSelect value={weekFilter} onChange={setWeekFilter} options={['all', ...weekOptions]} labels={{ all: 'All weeks' }} />
              <KsbTraceSelect value={componentFilter} onChange={setComponentFilter} options={['all', ...componentOptions]} labels={{ all: 'All components' }} />
              <KsbTraceSelect value={groupFilter} onChange={setGroupFilter} options={['all', ...groupOptions]} labels={{ all: 'All groups' }} />
            </div>
            <p className="mt-3 text-[11px] font-semibold text-foreground-400">{filteredRows.length} of {programme.ksbHeatmap.length} KSBs shown</p>
          </div>

          <KsbCoverageSummaryView rows={filteredRows} evidenceByCode={evidenceByCode} />
        </div>
      </div>
    </div>
  );
}

function KsbTraceStat({ label, value, tone }: { label: string; value: number | string; tone: 'primary' | 'emerald' | 'amber' | 'slate' }) {
  const tones = {
    primary: 'border-primary-100 bg-primary-50 text-primary-900',
    emerald: 'border-emerald-100 bg-emerald-50 text-emerald-900',
    amber: 'border-amber-100 bg-amber-50 text-amber-900',
    slate: 'border-background-200 bg-background-100 text-foreground-900',
  };
  return (
    <div className={`rounded-xl border px-4 py-3 ${tones[tone]}`}>
      <p className="text-[10px] font-bold uppercase opacity-70">{label}</p>
      <p className="mt-1 text-xl font-heading font-black">{value}</p>
    </div>
  );
}

function KsbTraceSelect({ value, onChange, options, labels = {} }: { value: string; onChange: (value: string) => void; options: string[]; labels?: Record<string, string> }) {
  return (
    <select value={value} onChange={event => onChange(event.target.value)} className="h-10 min-w-0 rounded-lg border border-background-200 bg-background-50 px-3 text-[12px] font-semibold text-foreground-700 outline-none focus:border-primary-300">
      {options.map(option => <option key={option} value={option}>{labels[option] || option}</option>)}
    </select>
  );
}

function KsbCoverageSummaryView({ rows, evidenceByCode }: { rows: KsbHeatmapRow[]; evidenceByCode: Map<string, KsbTraceEvidence[]> }) {
  if (!rows.length) return <EmptyPanel title="No KSB coverage" message="No KSBs match the current filters." />;
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
      {(['knowledge', 'skill', 'behaviour'] as KsbKind[]).map(kind => {
        const kindRows = rows.filter(row => ksbKind(row.ksb) === kind);
        return (
          <section key={kind} className="rounded-2xl border border-background-200 bg-background-50 p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h4 className="text-[12px] font-heading font-bold text-foreground-900">{ksbKindLabel(kind)} Points</h4>
              <span className="rounded-full bg-background-100 px-2 py-0.5 text-[10px] font-bold text-foreground-500">{kindRows.filter(row => ksbCoverageState(row) !== 'missing').length}/{kindRows.length} addressed</span>
            </div>
            <div className="space-y-2">
              {kindRows.map(row => {
                const rowId = ksbRowId(row);
                const evidence = evidenceByCode.get(rowId) || [];
                const state = ksbCoverageState(row);
                const description = ksbDescriptionText(row);
                return (
                  <article key={rowId} className={`w-full rounded-xl border p-3 text-left ${state === 'missing' ? 'border-red-100 bg-red-50/35' : state === 'mapped' ? 'border-slate-200 bg-slate-50/60' : 'border-emerald-100 bg-emerald-50/35'}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <KsbBadge code={row.ksb} />
                          <CoverageStateBadge state={state} />
                          {ksbSourceLabel(row) && <span className="rounded-full bg-background-100 px-2 py-0.5 text-[9px] font-bold text-foreground-500">{ksbSourceLabel(row)}</span>}
                        </div>
                        <p className="mt-2 line-clamp-4 text-[11px] leading-relaxed text-foreground-700">{description}</p>
                      </div>
                      <span className="rounded-lg bg-background-50 px-2 py-1 text-center text-[10px] font-bold text-foreground-600">
                        <span className="block text-[9px] uppercase text-foreground-400">Times</span>
                        {evidence.length}
                      </span>
                    </div>
                    <KsbTraceMiniMeta evidence={evidence} />
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

function KsbTraceDetailView({ rows, selectedRow, evidence, onSelectCode }: { rows: KsbHeatmapRow[]; selectedRow: KsbHeatmapRow | null; evidence: KsbTraceEvidence[]; onSelectCode: (code: string) => void }) {
  if (!selectedRow) return <EmptyPanel title="No KSB selected" message="Choose a KSB to inspect its trace." />;
  const byModule = groupTraceEvidence(evidence);
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="rounded-2xl border border-background-200 bg-background-50 p-3">
        <p className="mb-2 text-[10px] font-bold uppercase text-foreground-400">Select KSB</p>
        <div className="max-h-[55vh] space-y-1 overflow-y-auto pr-1">
          {rows.map(row => {
            const rowId = ksbRowId(row);
            return (
            <button key={rowId} type="button" onClick={() => onSelectCode(rowId)} className={`flex w-full items-center justify-between gap-2 rounded-lg px-2 py-2 text-left transition-smooth ${rowId === ksbRowId(selectedRow) ? 'bg-primary-50 text-primary-800' : 'hover:bg-background-100 text-foreground-700'}`}>
              <span className="min-w-0">
                <span className="block truncate text-[11px] font-bold">{formatKsbCode(row.ksb)}</span>
                {ksbSourceLabel(row) && <span className="block truncate text-[9px] font-semibold text-foreground-400">{ksbSourceLabel(row)}</span>}
              </span>
              <CoverageStateBadge state={ksbCoverageState(row)} />
            </button>
            );
          })}
          {!rows.length && <EmptyPanel title="No KSBs" message="No KSBs match the current filters." compact />}
        </div>
      </aside>
      <section className="rounded-2xl border border-background-200 bg-background-50 p-4">
        <div className="mb-4">
          <div className="flex flex-wrap items-center gap-2">
            <KsbBadge code={selectedRow.ksb} />
            <CoverageStateBadge state={ksbCoverageState(selectedRow)} />
            <span className="rounded-full bg-background-100 px-2 py-0.5 text-[10px] font-bold text-foreground-500">{evidence.length} occurrence{evidence.length === 1 ? '' : 's'}</span>
            {ksbSourceLabel(selectedRow) && <span className="rounded-full bg-background-100 px-2 py-0.5 text-[10px] font-bold text-foreground-500">{ksbSourceLabel(selectedRow)}</span>}
          </div>
          <h4 className="mt-2 text-sm font-heading font-bold text-foreground-950">{selectedRow.title}</h4>
        </div>
        {evidence.length ? (
          <div className="space-y-3">
            {byModule.map(moduleGroup => (
              <div key={moduleGroup.module} className="rounded-xl border border-background-200 bg-background-100/45 p-3">
                <p className="text-[12px] font-bold text-foreground-950">Programme ? {moduleGroup.module}</p>
                <div className="mt-2 space-y-2">
                  {moduleGroup.weeks.map(weekGroup => (
                    <div key={`${moduleGroup.module}-${weekGroup.week}`} className="rounded-lg border border-background-200 bg-background-50 p-3">
                      <p className="text-[11px] font-bold text-foreground-700">? {weekGroup.week || 'Module-level mapping'}</p>
                      <div className="mt-2 grid grid-cols-1 gap-2 lg:grid-cols-2">
                        {weekGroup.items.map((item, index) => (
                          <div key={`${item.module}-${item.week}-${item.component}-${index}`} className="rounded-lg border border-background-200 bg-background-100 px-3 py-2">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="rounded-full bg-primary-50 px-2 py-0.5 text-[9px] font-bold uppercase text-primary-700">{item.scope}</span>
                              {item.classification && <span className="rounded-full bg-background-50 px-2 py-0.5 text-[9px] font-bold text-foreground-600">{ksbClassificationLabel(item.classification)}</span>}
                              <span className="rounded-full bg-background-50 px-2 py-0.5 text-[9px] font-bold text-foreground-600">{item.weight > 0 ? `${item.weight}%` : 'No weight'}</span>
                            </div>
                            <p className="mt-2 text-[11px] font-semibold text-foreground-900">? {item.component || item.componentType || 'Component not set'}</p>
                            {item.componentType && <p className="text-[10px] font-semibold text-foreground-400">{componentTypeLabel(item.componentType)}</p>}
                            <div className="mt-2 flex flex-wrap gap-1">
                              {item.groups.map(group => <span key={group} className="rounded-full bg-emerald-50 px-2 py-0.5 text-[9px] font-bold text-emerald-700">Group: {group}</span>)}
                              {!item.groups.length && <span className="text-[10px] font-semibold text-foreground-300">No group attached</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyPanel title="Missing from mapping" message="This KSB has no mapped module, week, or component in the current programme." />
        )}
      </section>
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

function KsbTraceMiniMeta({ evidence }: { evidence: KsbTraceEvidence[] }) {
  if (!evidence.length) return <p className="mt-2 text-[10px] font-semibold text-foreground-400">No mapped modules, weeks, components, or groups.</p>;
  return (
    <div className="mt-3 space-y-1 text-[10px] font-semibold text-foreground-500">
      <p>Modules: {uniqueCleanValues(evidence.map(item => item.module)).slice(0, 3).join(', ') || 'None'}</p>
      <p>Weeks: {uniqueCleanValues(evidence.map(item => item.week)).slice(0, 3).join(', ') || 'None'}</p>
      <p>Components: {uniqueCleanValues(evidence.map(item => item.component)).slice(0, 3).join(', ') || 'None'}</p>
      <p>Groups: {uniqueCleanValues(evidence.flatMap(item => item.groups)).slice(0, 3).join(', ') || 'None'}</p>
    </div>
  );
}

function CoverageStateBadge({ state, size = 'sm' }: { state: KsbCoverageState; size?: 'sm' | 'md' }) {
  const sizeClass = size === 'md' ? 'px-2.5 py-1 text-[10px]' : 'px-2 py-0.5 text-[9px]';
  const labels: Record<KsbCoverageState, string> = {
    fully_covered: 'Fully covered',
    partial: 'Partial',
    over_allocated: 'Over allocated',
    mapped: 'No weight',
    missing: 'Missing',
  };
  const classes: Record<KsbCoverageState, string> = {
    fully_covered: 'bg-emerald-100 text-emerald-700',
    partial: 'bg-sky-100 text-sky-700',
    over_allocated: 'bg-violet-100 text-violet-700',
    mapped: 'bg-slate-100 text-slate-600',
    missing: 'bg-red-100 text-red-700',
  };
  return <span className={`rounded-full font-bold ${sizeClass} ${classes[state]}`}>{labels[state]}</span>;
}

function EmptyPanel({ title, message, compact = false }: { title: string; message: string; compact?: boolean }) {
  return (
    <div className={`rounded-xl border border-dashed border-background-300 bg-background-100 text-center ${compact ? 'p-3' : 'p-8'}`}>
      <p className="text-[12px] font-bold text-foreground-700">{title}</p>
      <p className="mt-1 text-[11px] text-foreground-400">{message}</p>
    </div>
  );
}

function ksbCoverageState(row: KsbHeatmapRow): KsbCoverageState {
  const occurrences = Number(row.totalOccurrences || 0) || Object.values(row.evidence || {}).reduce((total, entries) => total + entries.length, 0);
  const backendStatus = clean(row.status).toLowerCase();
  if (backendStatus === 'fully_covered') return 'fully_covered';
  if (backendStatus === 'partial') return 'partial';
  if (backendStatus === 'over_allocated') return 'over_allocated';
  if (backendStatus === 'missing' && occurrences > 0) return 'mapped';
  if (backendStatus === 'missing') return 'missing';
  const totalWeight = Number(row.totalWeight || 0) || Object.values(row.coverage || {}).reduce((total, value) => total + Number(value || 0), 0);
  if (totalWeight > 100 && occurrences > 0) return 'over_allocated';
  if (totalWeight >= 100 && occurrences > 0) return 'fully_covered';
  if (totalWeight > 0 && occurrences > 0) return 'partial';
  if (occurrences > 0) return 'mapped';
  return 'missing';
}

function ksbTraceSummary(rows: KsbHeatmapRow[]) {
  const fullyCovered = rows.filter(row => ksbCoverageState(row) === 'fully_covered').length;
  const partial = rows.filter(row => ['partial', 'over_allocated'].includes(ksbCoverageState(row))).length;
  const missing = rows.filter(row => ksbCoverageState(row) === 'missing').length;
  const mappedNoWeight = rows.filter(row => ksbCoverageState(row) === 'mapped').length;
  const addressed = fullyCovered + partial + mappedNoWeight;
  return {
    total: rows.length,
    fullyCovered,
    partial,
    missing,
    mappedNoWeight,
    coveragePercent: rows.length ? Math.round((addressed / rows.length) * 100) : 0,
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

function groupTraceEvidence(evidence: KsbTraceEvidence[]) {
  const moduleMap = new Map<string, Map<string, KsbTraceEvidence[]>>();
  evidence.forEach(item => {
    const moduleName = clean(item.module, 'Module');
    const weekName = clean(item.week, item.scope === 'module' ? 'Module-level mapping' : 'Week not set');
    const weekMap = moduleMap.get(moduleName) || new Map<string, KsbTraceEvidence[]>();
    weekMap.set(weekName, [...(weekMap.get(weekName) || []), item]);
    moduleMap.set(moduleName, weekMap);
  });
  return [...moduleMap.entries()].map(([module, weekMap]) => ({
    module,
    weeks: [...weekMap.entries()].map(([week, items]) => ({ week, items })),
  }));
}
