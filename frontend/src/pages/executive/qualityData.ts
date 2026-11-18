import { qualityDefinition, qualityForms, qualityReviews, type QualityFormCard, type QualitySummary, type QualityTemplateState } from '@/api/coachingQualityReviews';
import { feedbackApi, type FeedbackForm, type FeedbackResponse, type FeedbackScoreClass } from '@/api/feedback';
import { addDays, TIME_ZONE_LABEL, todayIso } from '@/pages/curriculum/recordings/utils';
import type { ConcernTheme, FeedbackClassification, FormDefinition, QualityAction, QualityRecord, RagCounts, RagStatus } from '@/types/qms';

const PAGE_SIZE_LIMIT = 10000;

export interface LiveQmsData {
  forms: FormDefinition[];
  records: QualityRecord[];
  actions: QualityAction[];
  concerns: ConcernTheme[];
  feedbackTypes: { id: string; name: string }[];
  periodLabel: string;
  lastRefresh: string;
  notice: string;
  availability: { actions: boolean; criticalIssues: boolean; concerns: boolean; feedback: boolean; feedbackScores: boolean };
}

function emptyRag(): RagCounts {
  return { green: 0, amber: 0, red: 0, unrated: 0, na: 0, total: 0 };
}

function answerTypeLabel(type: string | undefined) {
  switch (type) {
    case 'rating': return 'Criteria rating';
    case 'boolean': return 'Yes / No';
    case 'single_choice': return 'Single choice';
    case 'checklist': return 'Checklist';
    case 'textarea': return 'Narrative';
    case 'text': return 'Short text';
    case 'date': return 'Date';
    case 'number': return 'Number';
    case 'image': return 'Screenshot';
    case 'file': return 'Evidence file';
    default: return 'Question';
  }
}

function questionCount(state: QualityTemplateState | null) {
  return state?.published.sections.reduce((total, section) => total + section.criteria.length, 0) ?? 0;
}

function answerTypes(state: QualityTemplateState | null) {
  const types = state?.published.sections.flatMap(section => section.criteria.map(item => answerTypeLabel(item.type))) ?? [];
  return [...new Set(types)];
}

function feedbackTypeLabel(type: string) {
  const labels: Record<string, string> = {
    post_lecture: 'Live Sessions Feedback',
    mid_module: 'Wellbeing',
    end_module: 'End-module Feedback',
    post_mcm_review: 'MCM Feedback',
    post_progress_review: 'Progress Review Feedback',
    post_progress_review_employer: 'Progress Review – Employer Feedback',
    post_epa_review: 'EPA Feedback',
    post_event: 'Event Feedback',
    event_rsvp: 'Event RSVP',
    general: 'General Feedback',
  };
  return labels[type] ?? type;
}

function feedbackCategory(type: string) {
  return type === 'post_progress_review_employer' ? 'Employer Feedback' as const : 'Learner Feedback' as const;
}

function feedbackQuestionCount(form: FeedbackForm) {
  return form.sections?.reduce((total, section) => total + section.questions.length, 0) ?? 0;
}

function feedbackAnswerTypes(form: FeedbackForm) {
  const types = form.sections?.flatMap(section => section.questions.map(question => question.type)) ?? [];
  return [...new Set(types.map(type => answerTypeLabel(type)))];
}

function feedbackRecords(form: FeedbackForm, rows: FeedbackResponse[], classifications = new Map<number, FeedbackScoreClass>()): QualityRecord[] {
  const totalQuestions = feedbackQuestionCount(form);
  const category = feedbackCategory(form.formType);
  return rows.map(row => {
    const subjectName = row.activity?.coachName?.trim() || row.activity?.tutorName?.trim() || 'Not available';
    const date = row.submittedAt || row.updatedAt || row.startedAt;
    return {
      id: `feedback-response-${row.id}`,
      formId: `feedback-${form.id}`,
      formName: row.formTitle || form.title,
      feedbackType: form.formType,
      category,
      subjectType: row.activity?.coachName ? 'Coach' : row.activity?.tutorName ? 'Tutor' : 'College',
      subjectName,
      coachName: row.activity?.coachName?.trim() || null,
      tutorName: row.activity?.tutorName?.trim() || null,
      department: 'Not available',
      programme: row.programme || 'Not available',
      respondentType: category === 'Employer Feedback' ? 'Employer' : 'Learner',
      respondentName: row.learnerName || 'Anonymous respondent',
      auditor: 'Feedback response',
      assessedOn: date.slice(0, 10),
      rag: 'unrated',
      policyVersion: null,
      critical: false,
      summary: `${row.status === 'completed' ? 'Completed' : 'In progress'} ${feedbackTypeLabel(form.formType)} response`,
      learnerRef: row.learnerId,
      answeredQuestions: row.status === 'completed' ? totalQuestions : 0,
      totalQuestions,
      reviewStatus: row.status === 'completed' ? 'completed' : 'draft',
      feedbackClassification: (classifications.get(row.id) as FeedbackClassification | undefined) ?? null,
    };
  });
}

function feedbackFormDefinition(form: FeedbackForm, rows: FeedbackResponse[], classifications: Map<number, FeedbackScoreClass>): FormDefinition {
  const records = feedbackRecords(form, rows, classifications);
  const rag = emptyRag();
  rag.unrated = records.length;
  rag.total = records.length;
  const latest = records.map(record => record.assessedOn).sort().at(-1) ?? null;
  const questionTotal = feedbackQuestionCount(form);
  return {
    id: `feedback-${form.id}`,
    name: form.title,
    shortName: form.title,
    category: feedbackCategory(form.formType),
    feedbackType: form.formType,
    version: String(form.version),
    sourceTable: 'engagement_api.feedback.forms / feedback.responses',
    owner: 'Learner Experience',
    respondentType: feedbackCategory(form.formType) === 'Employer Feedback' ? 'Employer' : 'Learner',
    subjectType: rows.some(row => row.activity?.tutorName && !row.activity.coachName) ? 'Tutor' : 'Coach',
    questionCount: questionTotal,
    answerTypes: feedbackAnswerTypes(form),
    scoringMethod: 'Feedback analytics classification; no QMS RAG policy configured',
    policyId: null,
    policyVersion: null,
    policySummary: 'Feedback scores are available in the Feedback Insights workspace. No approved QMS RAG policy is returned for this form, so this view keeps the status Not assessed.',
    requiresAction: false,
    access: 'Feedback analytics access',
    scheduled: form.assignedCount,
    submissions: rows.length,
    latest,
    rag,
    completionRate: form.assignedCount ? rows.filter(row => row.status === 'completed').length / form.assignedCount : null,
    ragSupported: false,
  };
}

async function loadFeedbackData(start: string, end: string) {
  try {
    const [{ forms }, { responses }, insights] = await Promise.all([
      feedbackApi.listForms(),
      feedbackApi.responses({ status: 'completed', submittedFrom: start, submittedTo: end }),
      feedbackApi.insightsDashboard({ submittedFrom: start, submittedTo: end }).catch(() => null),
    ]);
    const classifications = new Map<number, FeedbackScoreClass>();
    insights?.analytics.insights?.classification?.responses.forEach(row => classifications.set(row.responseId, row.classification));
    const inPeriod = responses.filter(row => {
      const date = (row.submittedAt || row.updatedAt || row.startedAt).slice(0, 10);
      return row.status === 'completed' && date >= start && date <= end;
    });
    // The forms index lists current versions only; completed responses may belong to older versions.
    const currentIds = new Set(forms.map(form => form.id));
    const historicalIds = [...new Set(inPeriod.map(row => row.formId).filter(id => !currentIds.has(id)))];
    const historicalForms = await Promise.all(historicalIds.map(async id => (await feedbackApi.getForm(id)).form));
    const allForms = [...forms, ...historicalForms];
    const rowsByForm = new Map<number, FeedbackResponse[]>();
    inPeriod.forEach(row => rowsByForm.set(row.formId, [...(rowsByForm.get(row.formId) ?? []), row]));
    return {
      forms: allForms.map(form => feedbackFormDefinition(form, rowsByForm.get(form.id) ?? [], classifications)),
      records: allForms.flatMap(form => feedbackRecords(form, rowsByForm.get(form.id) ?? [], classifications)),
      feedbackTypes: [...new Map(
        [...allForms.map(form => form.formType), ...inPeriod.map(row => row.formType)]
          .map(type => [type, feedbackTypeLabel(type)] as const),
      )].map(([id, name]) => ({ id, name })),
      scoresAvailable: Boolean(insights?.analytics.insights?.classification),
    };
  } catch {
    return null;
  }
}

function formRecords(card: QualityFormCard, rows: QualitySummary[], state: QualityTemplateState | null): QualityRecord[] {
  return rows.map(row => ({
    id: row.id,
    formId: row.reviewType || card.reviewType,
    formName: row.formTitle || card.title,
    category: 'Quality Audit',
    subjectType: 'Coach',
    subjectName: row.coachName || 'Coach not recorded',
    coachName: row.coachName || null,
    tutorName: null,
    department: 'Not available',
    programme: 'Not available',
    respondentType: 'Coach',
    respondentName: row.coachName || 'Coach not recorded',
    auditor: row.reviewerName || 'Reviewer not recorded',
    assessedOn: row.startsAt.slice(0, 10),
    rag: 'unrated' as RagStatus,
    policyVersion: null,
    critical: false,
    summary: `${row.status === 'completed' ? 'Completed' : 'Draft'} review · ${row.actionCount} recorded follow-up action${row.actionCount === 1 ? '' : 's'}`,
    learnerRef: row.learnerId || null,
    answeredQuestions: row.status === 'completed' ? questionCount(state) : 0,
    totalQuestions: questionCount(state),
    reviewStatus: row.status,
    ratingCounts: row.status === 'completed' ? row.ratingCounts ?? null : null,
  }));
}

function formDefinition(card: QualityFormCard, state: QualityTemplateState | null, rows: QualitySummary[]): FormDefinition {
  const records = formRecords(card, rows, state);
  const rag = emptyRag();
  rag.unrated = records.length;
  rag.total = records.length;
  const latest = records.map(row => row.assessedOn).sort().at(-1) ?? null;
  const completed = rows.filter(row => row.status === 'completed').length;
  const questionTotal = questionCount(state);
  return {
    id: card.reviewType,
    name: card.title,
    shortName: card.title.replace(' Feedback Form', '').replace(' Feedback', ''),
    category: 'Quality Audit',
    version: state ? String(state.published.version) : '—',
    sourceTable: 'lms_quality.review / lms_quality.form_template',
    owner: 'Quality Assurance',
    respondentType: 'Coach',
    subjectType: 'Coach',
    questionCount: questionTotal,
    answerTypes: answerTypes(state),
    scoringMethod: questionTotal ? 'Criteria captured; RAG policy not configured' : 'Definition unavailable',
    policyId: null,
    policyVersion: null,
    policySummary: 'No approved RAG policy is returned for this form. Records remain Not assessed until a policy is configured and published.',
    requiresAction: rows.some(row => row.actionCount > 0),
    access: 'Curriculum quality access',
    scheduled: 0,
    submissions: rows.length,
    latest,
    rag,
    completionRate: rows.length ? completed / rows.length : null,
    ragSupported: false,
  };
}

async function reviewsWindow(start: string, end: string, signal: AbortSignal) {
  const filters = { start, end, coachEmail: '', status: '', timeZone: TIME_ZONE_LABEL, search: '', reviewType: '', pdf: '' };
  const rows: QualitySummary[] = [];
  let offset = 0;
  while (offset <= PAGE_SIZE_LIMIT) {
    const page = await qualityReviews(filters, offset, signal);
    rows.push(...page.reviews);
    if (page.nextOffset === null || page.nextOffset === undefined) return rows;
    offset = page.nextOffset;
  }
  return rows;
}

async function allReviews(start: string, end: string, signal: AbortSignal) {
  const windows: { start: string; end: string }[] = [];
  let windowEnd = end;
  while (windowEnd >= start) {
    const candidateStart = addDays(windowEnd, -365);
    const windowStart = candidateStart < start ? start : candidateStart;
    windows.push({ start: windowStart, end: windowEnd });
    if (windowStart === start) break;
    windowEnd = addDays(windowStart, -1);
  }
  const pages = await Promise.all(windows.map(window => reviewsWindow(window.start, window.end, signal)));
  return pages.flat();
}

export async function loadLiveQmsData(signal: AbortSignal): Promise<LiveQmsData> {
  const end = todayIso(TIME_ZONE_LABEL);
  const start = addDays(end, -365);
  const [catalog, rows, feedback] = await Promise.all([
    qualityForms(signal, false, true),
    allReviews(start, end, signal),
    loadFeedbackData(start, end),
  ]);
  const definitions = await Promise.all(catalog.forms.map(async card => {
    const bundled = catalog.templates?.[card.reviewType];
    if (bundled) return [card.reviewType, bundled] as const;
    try {
      const result = await qualityDefinition(signal, card.reviewType);
      return [card.reviewType, result.template] as const;
    } catch {
      return [card.reviewType, null] as const;
    }
  }));
  const definitionByType = new Map(definitions);
  const rowsByType = new Map<string, QualitySummary[]>();
  rows.forEach(row => {
    const key = row.reviewType || 'UNKNOWN';
    rowsByType.set(key, [...(rowsByType.get(key) ?? []), row]);
  });
  const forms = [
    ...catalog.forms.map(card => formDefinition(card, definitionByType.get(card.reviewType) ?? null, rowsByType.get(card.reviewType) ?? [])),
    ...(feedback?.forms ?? []),
  ];
  const records = [
    ...catalog.forms.flatMap(card => formRecords(card, rowsByType.get(card.reviewType) ?? [], definitionByType.get(card.reviewType) ?? null)),
    ...(feedback?.records ?? []),
  ];
  const sourceLabel = feedback ? 'Quality Forms, saved Reviews, and Feedback Forms/Responses' : 'Quality Forms and saved Reviews (Feedback API unavailable)';
  return {
    forms,
    records,
    actions: [],
    concerns: [],
    feedbackTypes: feedback?.feedbackTypes ?? [],
    availability: { actions: false, criticalIssues: false, concerns: false, feedback: feedback !== null, feedbackScores: feedback?.scoresAvailable ?? false },
    periodLabel: `${start} – ${end}`,
    lastRefresh: new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: TIME_ZONE_LABEL }).format(new Date()),
    notice: `Live source: ${sourceLabel}. The RAG chart uses stored criterion ratings. No blended review-level RAG is inferred because the current APIs do not expose an approved aggregation policy.`,
  };
}
