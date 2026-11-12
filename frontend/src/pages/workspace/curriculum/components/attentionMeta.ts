import type { AttentionKey, CurriculumHomeSummary } from '../useCurriculumHome';
import type { AttentionRecord, ProgrammeSectionKey } from '../useCurriculumAttention';

export interface AttentionMeta {
  title: string;
  detail: string;
  /** What each listed record is missing, said as a sentence. */
  requirement: string;
  /** Singular noun for one record of this issue. */
  noun: string;
  href: string;
  action: string;
  icon: string;
  /** The button on each record row, and where it opens. */
  edit?: { label: string; href: (record: AttentionRecord) => string };
}

export interface AttentionIssue { key: AttentionKey; count: number }

export function clean(value: unknown) { return String(value ?? '').trim(); }

const moduleBuilder = (record: AttentionRecord) => `/curriculum/module-builder?module=${encodeURIComponent(record.id)}`;

export const ATTENTION_META: Record<AttentionKey, AttentionMeta> = {
  'programme-ksb-source': {
    title: 'Programmes need a KSB source', detail: 'Choose the standard or KSB profile before mapping content.',
    requirement: 'No KSB standard or profile chosen', noun: 'programme',
    href: '/curriculum/programmes', action: 'Review programmes', icon: 'ri-node-tree',
    edit: { label: 'Choose source', href: record => `/curriculum/programmes/${encodeURIComponent(record.id)}` },
  },
  'module-mapping': {
    title: 'Modules have no KSB mappings', detail: 'Open coverage and map each gap to the right component.',
    requirement: 'No KSBs mapped to this module', noun: 'module',
    href: '/curriculum/ksb-mapping', action: 'Open coverage', icon: 'ri-link-unlink',
    edit: { label: 'Map KSBs', href: moduleBuilder },
  },
  'draft-content': {
    title: 'Modules are still in draft', detail: 'Continue authoring the content that is not yet published.',
    requirement: 'Still in draft', noun: 'module',
    href: '/curriculum/module-builder', action: 'Continue authoring', icon: 'ri-draft-line',
    edit: { label: 'Continue authoring', href: moduleBuilder },
  },
  'group-coach': {
    title: 'Groups have no coach', detail: 'Assign a coach before the delivery setup is complete.',
    requirement: 'No coach assigned', noun: 'group',
    href: '/curriculum/groups', action: 'Assign coaches', icon: 'ri-user-search-line',
    edit: { label: 'Assign coach', href: record => `/curriculum/groups/${encodeURIComponent(record.id)}` },
  },
  'module-tutor': {
    title: 'Modules have no tutor', detail: 'A scheduled module needs an owner for its live sessions.',
    requirement: 'No tutor assigned', noun: 'module',
    href: '/curriculum/delivery', action: 'Review delivery', icon: 'ri-user-settings-line',
    edit: { label: 'Assign tutor', href: moduleBuilder },
  },
};

/** Programme-review sections: the attention issues plus the two structural gaps. */
export function programmeSectionMeta(key: ProgrammeSectionKey, programmeId: string) {
  const programmeHref = `/curriculum/programmes/${encodeURIComponent(programmeId)}`;
  if (key === 'no-modules') {
    return { title: 'No modules yet', summary: 'This programme has no modules, so learners have nothing to follow.', icon: 'ri-layout-4-line', href: '/curriculum/module-builder', action: 'Create a module' };
  }
  if (key === 'no-delivery') {
    return { title: 'No delivery set up', summary: 'This programme has no cohort, so no group can be scheduled.', icon: 'ri-calendar-schedule-line', href: '/curriculum/cohorts', action: 'Add a cohort' };
  }
  const meta = ATTENTION_META[key];
  if (key === 'programme-ksb-source') {
    return { title: 'No KSB source', summary: meta.detail, icon: meta.icon, href: programmeHref, action: 'Choose source' };
  }
  const titles: Partial<Record<AttentionKey, string>> = { 'module-mapping': 'Modules without KSB mappings', 'module-tutor': 'Modules without a tutor', 'group-coach': 'Groups without a coach', 'draft-content': 'Draft modules' };
  return { title: titles[key] ?? meta.title, summary: meta.detail, icon: meta.icon, href: meta.href, action: meta.action };
}

/** Programme, cohort and group, without blanks or repeats of the record's own name. */
export function recordContext(record: AttentionRecord) {
  return [record.programme, record.cohort, record.group].map(value => String(value ?? '').trim()).filter((value, index, all) => value && value !== record.name && all.indexOf(value) === index);
}

export function recordLabel(record: AttentionRecord, noun: string) {
  const name = String(record.name ?? '').trim();
  return name || `Unnamed ${noun} (${record.id})`;
}

export function matchesQuery(record: AttentionRecord, query: string) {
  if (!query) return true;
  const needle = query.toLowerCase();
  return [record.name, record.programme, record.cohort, record.group].some(value => String(value ?? '').toLowerCase().includes(needle));
}

export function plural(count: number, noun: string) {
  return `${count} ${count === 1 ? noun : `${noun}s`}`;
}

/** The non-zero issues, largest first. */
export function attentionIssues(counts: CurriculumHomeSummary['attentionCounts'] | undefined): AttentionIssue[] {
  return (Object.keys(ATTENTION_META) as AttentionKey[])
    .map(key => ({ key, count: counts?.[key] ?? 0 }))
    .filter(issue => issue.count > 0)
    .sort((left, right) => right.count - left.count);
}
