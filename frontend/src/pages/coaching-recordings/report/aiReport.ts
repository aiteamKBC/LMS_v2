// Saved-report normalisation from Coaching-Sessions; no new assessment.
import type {
  AIReport,
  AIReportAction,
  AIReportChecklistItem,
  AIReportEvidence,
  AIReportQAMetric,
} from './types';

export type AIReportChecklistStatus = 'met' | 'partial' | 'not_met' | 'unknown';

function wordIncludes(text: string, pattern: RegExp) {
  return pattern.test(text);
}

function toPercentScore(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value <= 5) return Math.round(value * 20);
  return Math.round(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function textValue(value: unknown, preferredKeys: string[] = []): string | undefined {
  if (typeof value === 'string') {
    const text = value.trim();
    return text || undefined;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (!isRecord(value)) return undefined;

  for (const key of preferredKeys) {
    const text = textValue(value[key]);
    if (text) return text;
  }
  return undefined;
}

function numberValue(value: unknown): number | null | undefined {
  if (value === null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function textList(value: unknown, preferredKeys: string[]): string[] | undefined {
  const values = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  const normalized = values
    .map((item) => textValue(item, preferredKeys))
    .filter((item): item is string => Boolean(item));
  return normalized.length ? normalized : undefined;
}

function normalizeEvidence(value: unknown): AIReportEvidence[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const evidence = value.flatMap((item) => {
    if (typeof item === 'string') return [{ quote: item }];
    if (!isRecord(item)) return [];

    const normalized: AIReportEvidence = {
      quote: textValue(item.quote, ['text', 'value']),
      speaker: textValue(item.speaker, ['name']) ?? null,
      timecode: textValue(item.timecode, ['timestamp', 'time']),
      why_it_matters: textValue(item.why_it_matters, ['reason', 'notes']),
    };
    return Object.values(normalized).some((field) => field) ? [normalized] : [];
  });

  return evidence.length ? evidence : undefined;
}

function normalizeQAMetrics(value: unknown): AIReportQAMetric[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const metrics = value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const normalized: AIReportQAMetric = {
      metric: textValue(item.metric, ['name', 'label', 'item']),
      result: textValue(item.result, ['value', 'outcome']),
      rag: textValue(item.rag, ['rating', 'status']) ?? null,
      notes: textValue(item.notes, ['note', 'description']),
      rating_1_to_5: numberValue(item.rating_1_to_5 ?? item.rating),
      evidence: normalizeEvidence(item.evidence),
    };
    return Object.values(normalized).some((field) => field !== undefined && field !== null) ? [normalized] : [];
  });

  return metrics.length ? metrics : undefined;
}

function normalizePriorityActions(value: unknown): AIReportAction[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const actions = value.flatMap((item) => {
    if (typeof item === 'string') return [{ action: item }];
    if (!isRecord(item)) return [];

    const normalized: AIReportAction = {
      owner: textValue(item.owner, ['name']),
      action: textValue(item.action, ['item', 'text', 'description']),
      due: textValue(item.due, ['date', 'deadline']),
    };
    return normalized.owner || normalized.action || normalized.due ? [normalized] : [];
  });

  return actions.length ? actions : undefined;
}

function normalizeChecklist(value: unknown): AIReportChecklistItem[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const checklist = value.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const item = textValue(entry.item, ['label', 'name', 'text']);
    if (!item) return [];
    const rawCompleted = entry.completed;
    const completed = rawCompleted === true || ['true', 'yes', 'met', 'complete', 'completed'].includes(String(rawCompleted ?? '').toLowerCase());
    return [{ item, completed }];
  });

  return checklist.length ? checklist : undefined;
}

export function getQAMetricAssessmentStatus(metric: AIReportQAMetric): AIReportChecklistStatus {
  const rag = typeof metric.rag === 'string' ? metric.rag.trim().toLowerCase() : '';
  if (rag === 'red') return 'not_met';
  if (rag === 'amber') return 'partial';
  if (rag === 'green') return 'met';

  if (typeof metric.rating_1_to_5 === 'number' && Number.isFinite(metric.rating_1_to_5)) {
    if (metric.rating_1_to_5 <= 1.5) return 'not_met';
    if (metric.rating_1_to_5 < 4) return 'partial';
    return 'met';
  }

  const text = [metric.result, metric.notes]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (
    wordIncludes(text, /\bnot\s+met\b/) ||
    wordIncludes(text, /\bnot\b.{0,40}\bevidenced\b/) ||
    wordIncludes(text, /\bno\s+evidence\b/) ||
    wordIncludes(text, /\bmissing\b/) ||
    wordIncludes(text, /\bunmet\b/) ||
    wordIncludes(text, /\bfail(?:ed)?\b/)
  ) {
    return 'not_met';
  }

  if (
    wordIncludes(text, /\bpartially\b/) ||
    wordIncludes(text, /\bpartial\b/) ||
    wordIncludes(text, /\bsome\s+evidence\b/) ||
    wordIncludes(text, /\bdeveloping\b/)
  ) {
    return 'partial';
  }

  if (
    wordIncludes(text, /\bmet\b/) ||
    wordIncludes(text, /\bachieved\b/) ||
    wordIncludes(text, /\bevidenced\b/)
  ) {
    return 'met';
  }

  return 'unknown';
}

function normalizeActions(actions: string[] | undefined, priorityActions: AIReportAction[] | undefined): string[] | undefined {
  if (actions?.length) return actions;
  if (!priorityActions?.length) return undefined;

  return priorityActions
    .map((item) => {
      const parts = [item.owner, item.action, item.due ? `Due: ${item.due}` : null].filter(Boolean);
      return parts.join(' - ');
    })
    .filter(Boolean);
}

function safeguardingScore(report: AIReport): number | null {
  if (typeof report.safeguarding_score === 'number') return report.safeguarding_score;
  const metric = report.qa?.find((item) => item.metric?.toLowerCase().includes('safeguarding'));
  return toPercentScore(metric?.rating_1_to_5);
}

function normalizeAIReport(report: AIReport): AIReport {
  const source = report as AIReport & Record<string, unknown>;
  const rawOverallRating = isRecord(source.overall_rating) ? source.overall_rating : undefined;
  const overallRating = rawOverallRating
    ? {
        rag: textValue(rawOverallRating.rag, ['rating', 'status']) ?? null,
        qualitative: textValue(rawOverallRating.qualitative, ['summary', 'text']) ?? null,
        average_rating: numberValue(rawOverallRating.average_rating),
        professional_judgement: textValue(rawOverallRating.professional_judgement, ['judgement', 'text']) ?? null,
      }
    : undefined;
  const qa = normalizeQAMetrics(source.qa);
  const priorityActions = normalizePriorityActions(source.priority_actions);
  const actions = textList(source.actions, ['action', 'item', 'text', 'description']);
  const averageScore = toPercentScore(overallRating?.average_rating);
  const normalized = {
    ...report,
    rag_rating: textValue(source.rag_rating, ['rating', 'status']) ?? overallRating?.rag ?? null,
    qa_score: numberValue(source.qa_score) ?? averageScore,
    safeguarding_score: numberValue(source.safeguarding_score),
    satisfaction: numberValue(source.satisfaction),
    strengths: textList(source.strengths, ['item', 'strength', 'text', 'description']),
    concerns: textList(source.concerns, ['item', 'concern', 'text', 'description']),
    actions,
    recommendations: textList(source.recommendations, ['item', 'recommendation', 'text', 'description']),
    checklist: normalizeChecklist(source.checklist),
    ksb_evidence: textList(source.ksb_evidence, ['item', 'evidence', 'ksb', 'code', 'text']),
    learner_feedback: textValue(source.learner_feedback, ['feedback', 'text']) ?? null,
    manager_involvement: textValue(source.manager_involvement, ['involvement', 'text']) ?? null,
    summary: textValue(source.summary, ['text']) ?? textValue(source.executive_summary, ['text']) ?? overallRating?.qualitative ?? null,
    executive_summary: textValue(source.executive_summary, ['text']) ?? null,
    overall_rating: overallRating,
    qa,
    priority_actions: priorityActions,
    duration: textValue(source.duration, ['text']) ?? null,
    learner: textValue(source.learner, ['name']) ?? null,
    coach: textValue(source.coach, ['name']) ?? null,
    employer: textValue(source.employer, ['name']) ?? null,
    programme: textValue(source.programme, ['name']) ?? null,
    meeting_type: textValue(source.meeting_type, ['name']) ?? null,
  } satisfies AIReport;

  return {
    ...normalized,
    safeguarding_score: safeguardingScore(normalized),
    actions: normalizeActions(actions, priorityActions),
    manager_involvement:
      normalized.manager_involvement ??
      qa?.find((item) => item.metric?.toLowerCase().includes('employer provides'))?.notes ??
      null,
  };
}

export function parseAIReport(raw: unknown): AIReport | null {
  if (!raw) return null;
  if (typeof raw === 'string') {
    try {
      return parseAIReport(JSON.parse(raw));
    } catch {
      return null;
    }
  }
  if (typeof raw !== 'object') return null;

  const report = normalizeAIReport(raw as AIReport);
  const hasListContent =
    (report.strengths?.length ?? 0) > 0 ||
    (report.concerns?.length ?? 0) > 0 ||
    (report.actions?.length ?? 0) > 0 ||
    (report.recommendations?.length ?? 0) > 0 ||
    (report.checklist?.length ?? 0) > 0 ||
    (report.ksb_evidence?.length ?? 0) > 0;

  const hasScalarContent = [
    report.rag_rating,
    report.qa_score,
    report.safeguarding_score,
    report.satisfaction,
    report.learner_feedback,
    report.manager_involvement,
    report.summary,
    report.executive_summary,
    report.overall_rating?.rag,
    report.overall_rating?.qualitative,
  ].some((value) => value !== undefined && value !== null && value !== '');

  const hasStructuredContent = (report.qa?.length ?? 0) > 0 || (report.priority_actions?.length ?? 0) > 0;

  return hasListContent || hasScalarContent || hasStructuredContent ? report : null;
}

export function hasAIReport(raw: unknown) {
  return parseAIReport(raw) !== null;
}
