import type { CoachLearnerCaseFileData } from '../types';

export type EvidencePreviewTarget = {
  code?: string;
  title: string;
  category?: string;
  linked?: boolean;
  activities: Array<{
    title: string;
    type: string;
    /**
     * Set only when the evidence resolves to a component in the learner's
     * current learning plan, i.e. when the existing activity viewer can open it.
     */
    componentId?: string;
    /** Why the evidence cannot be opened, when `componentId` is absent. */
    unavailableReason?: string;
    source?: string;
    activityId?: string;
    completedAt?: string;
    status?: string;
    module?: string;
  }>;
};

export const EVIDENCE_UNAVAILABLE_HISTORICAL = 'Historical Aptem record. There is no LMS copy of this activity to open.';
export const EVIDENCE_UNAVAILABLE_NOT_IN_PLAN = "This activity is no longer in the learner's current learning plan, so it cannot be opened here.";
export const EVIDENCE_UNAVAILABLE_NO_LINK = 'No LMS activity is linked to this evidence record.';

export type CaseFileKsbBrowserRow = {
  code: string;
  description: string;
  type: string;
  number: string;
  category: string;
  evidenceActivities: EvidencePreviewTarget['activities'];
  evidenceCount: number;
  linked: boolean;
};

/** Match the backend canonical KSB identity: child codes resolve to parent codes. */
export function normalizeKsbCode(value: string | null | undefined): string {
  const code = String(value || '').trim().toUpperCase();
  const match = code.match(/^([KSB])(\d+)(?:\.\d+)?$/);
  return match ? `${match[1]}${match[2]}` : code;
}

export function selectCaseFileKsbRows(
  data: CoachLearnerCaseFileData,
  fallbackKsbs: Array<{ code: string; description: string; type: string; number: string }> = [],
): CaseFileKsbBrowserRow[] {
  const touched = new Set(data.touchedKsbCodes.map((code) => normalizeKsbCode(code)));
  const mapped = new Set(data.mappedKsbCodes.map((code) => normalizeKsbCode(code)));
  const parentRows = new Map<string, ReturnType<typeof buildDisplayKsbs>[number]>();
  for (const item of buildDisplayKsbs(data, fallbackKsbs)) {
    const rawCode = String(item.code || '').trim().toUpperCase();
    const parentCode = normalizeKsbCode(rawCode);
    if (!parentCode || (mapped.size > 0 && !mapped.has(parentCode))) continue;
    const current = parentRows.get(parentCode);
    if (!current || rawCode === parentCode) {
      parentRows.set(parentCode, { ...item, code: parentCode });
    }
  }

  return Array.from(parentRows.entries())
    .map(([code, item]) => {
      const evidenceActivities = ksbLearningActivities(data, code);
      return {
        ...item,
        code,
        category: ksbCategoryFromCode(code),
        evidenceActivities,
        evidenceCount: evidenceActivities.length,
        // "Evidence linked" must be backed by evidence the coach can see in
        // the View popup. A touched code can come from progress rows that are
        // not evidence (e.g. an unsubmitted reading) or from a completed-KSB
        // entry with no sources; showing it as linked with an Evidence count
        // of 0 contradicted the popup.
        linked: touched.has(code) && evidenceActivities.length > 0,
      };
    })
    .sort((left, right) => left.code.localeCompare(right.code, undefined, { numeric: true, sensitivity: 'base' }));
}

export function selectCaseFileKsbSummary(rows: CaseFileKsbBrowserRow[]) {
  const total = rows.length;
  const achieved = rows.filter((row) => row.linked).length;
  const byCategory = (category: string) => {
    const categoryRows = rows.filter((row) => row.category === category);
    const categoryTotal = categoryRows.length;
    const categoryAchieved = categoryRows.filter((row) => row.linked).length;
    return {
      total: categoryTotal,
      achieved: categoryAchieved,
      percent: categoryTotal ? Math.round((categoryAchieved / categoryTotal) * 100) : null,
    };
  };
  return {
    total,
    achieved,
    remaining: Math.max(0, total - achieved),
    percent: total ? Math.round((achieved / total) * 100) : null,
    knowledge: byCategory('Knowledge'),
    skills: byCategory('Skills'),
    behaviours: byCategory('Behaviours'),
  };
}

function ksbLearningActivities(data: CoachLearnerCaseFileData, code: string): EvidencePreviewTarget['activities'] {
  const normalizedCode = normalizeKsbCode(code);
  const activities: EvidencePreviewTarget['activities'] = [];
  const seen = new Set<string>();
  // The activity viewer resolves a component inside the learner's current plan
  // (`detail.components`), so only those ids can be opened from the popup.
  const planComponentIds = new Set(
    (data.detail?.components || []).map((component) => String(component.componentId || '').trim()).filter(Boolean),
  );
  const add = (title: string | null | undefined, type: string | null | undefined, key: string, candidateComponentId?: string | null, metadata?: Partial<EvidencePreviewTarget['activities'][number]>) => {
    if (!title || seen.has(key)) return;
    seen.add(key);
    const normalizedType = String(type || '').trim().toLowerCase().replace(/[_-]+/g, ' ');
    const candidate = String(candidateComponentId || '').trim();
    const componentId = candidate && planComponentIds.has(candidate) ? candidate : undefined;
    const historical = String(metadata?.source || '').trim().toLowerCase() === 'aptem'
      || normalizedType === 'historical activity';
    activities.push({
      ...metadata,
      title,
      type: normalizedType === 'live session' ? 'Live session'
        : normalizedType ? normalizedType.charAt(0).toUpperCase() + normalizedType.slice(1)
          : 'Activity type unavailable',
      componentId,
      unavailableReason: componentId ? undefined
        : historical ? EVIDENCE_UNAVAILABLE_HISTORICAL
          : candidate ? EVIDENCE_UNAVAILABLE_NOT_IN_PLAN
            : EVIDENCE_UNAVAILABLE_NO_LINK,
    });
  };

  const completedDetail = data.snapshot?.ksbCompletedDetails?.find(
    (item) => normalizeKsbCode(item.code) === normalizedCode,
  );
  for (const [index, source] of (completedDetail?.sources || []).entries()) {
    const sourceTitle = String(source.title || '').trim();
    const genericTitle = sourceTitle && sourceTitle.toLowerCase() === String(source.typeLabel || source.kind || '').trim().toLowerCase();
    const componentTitle = genericTitle && source.componentId
      ? detailComponentTitle(data, source.componentId)
      : '';
    add(componentTitle || sourceTitle || source.id || 'Aptem evidence', source.typeLabel || source.kind,
      source.id || `completed-source:${normalizedCode}:${index}`, source.componentId, source);
  }
  if (activities.length > 0) return activities;

  const detail = data.detail;
  if (!detail) return activities;
  for (const component of detail.components) {
    if (!(component.ksbMappings || []).some((mapping) => normalizeKsbCode(mapping.code) === normalizedCode)) continue;
    add(component.component, component.isQuiz ? 'quiz' : component.type, component.componentId || `${component.module}:${component.week}:${component.component}`, component.componentId);
  }
  for (const attempt of detail.quizAttempts) {
    if (!(attempt.ksbs || []).some((ksb) => normalizeKsbCode(ksb) === normalizedCode)) continue;
    const component = detail.components.find((item) => item.componentId === attempt.componentId || item.quizMeta?.quizId === attempt.quizId);
    add(attempt.componentTitle || component?.component || `Quiz ${attempt.quizId}`, 'quiz', attempt.componentId || component?.componentId || `quiz:${attempt.quizId}`, attempt.componentId || component?.componentId);
  }
  for (const progress of detail.videoProgress || []) {
    if (!(progress.ksbs || []).some((ksb) => normalizeKsbCode(ksb) === normalizedCode)) continue;
    const component = detail.components.find((item) => item.componentId === progress.componentId);
    add(progress.componentTitle || component?.component || 'Video', 'video', progress.componentId, progress.componentId);
  }
  for (const progress of detail.componentProgress || []) {
    if (!(progress.ksbs || []).some((ksb) => normalizeKsbCode(ksb) === normalizedCode)) continue;
    const component = detail.components.find((item) => item.componentId === progress.componentId);
    add(progress.componentTitle || component?.component || progress.componentType, progress.componentType || component?.type, progress.componentId, progress.componentId);
  }
  return activities;
}

function detailComponentTitle(data: CoachLearnerCaseFileData, componentId: string): string {
  const component = data.detail?.components.find((item) => item.componentId === componentId);
  const videoProgress = data.detail?.videoProgress?.find((item) => item.componentId === componentId);
  const componentProgress = data.detail?.componentProgress?.find((item) => item.componentId === componentId);
  const title = videoProgress?.componentTitle?.trim()
    || componentProgress?.componentTitle?.trim()
    || component?.component?.trim()
    || '';
  const type = videoProgress?.kind || componentProgress?.componentType || component?.type || '';
  return title.toLowerCase() === type.toLowerCase() ? '' : title;
}

function buildDisplayKsbs(
  data: CoachLearnerCaseFileData,
  fallbackKsbs: Array<{ code: string; description: string; type: string; number: string }> = [],
) {
  return data.detail?.ksbs?.length ? data.detail.ksbs : fallbackKsbs;
}

function ksbCategoryFromCode(code: string) {
  if (code.startsWith('K')) return 'Knowledge';
  if (code.startsWith('S')) return 'Skills';
  if (code.startsWith('B')) return 'Behaviours';
  return 'Other';
}
