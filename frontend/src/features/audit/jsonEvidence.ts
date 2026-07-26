import { auditBlobUrl, type AuditJsonValue, type AuditRow } from './api';

export interface AuditEvidenceItem {
  id: string;
  title: string;
  kind: string;
  status: string;
  date: string;
  submittedDate: string;
  completedDate: string;
  createdDate: string;
  learnerId: string;
  fullName: string;
  programName: string;
  programId: string;
  subProgramId: string;
  componentId: string;
  submittedById: string;
  hoursType: string;
  spentTime: string;
  spentTimeType: string;
  content: string;
  feedbacks: AuditFeedback[];
  reportUrl: string;
  fileUrl: string;
  azureContainer: string;
  submissionStatus: string;
  submissionType: string;
  submissionReason: string;
  submissionFileName: string;
  reportStatus: string;
  reportFileName: string;
  fileBlob: string;
  noteBlob: string;
  noteContent: string;
  reportBlob: string;
  auditScore: string;
  auditStatus: string;
  auditVerdict: string;
  convincing: string;
  auditRisk: string;
  evidenceType: string;
  authenticityConfidence: string;
  feedbackAlignment: string;
  auditSummary: string;
  auditReasons: string[];
  recommendedAction: string;
  strengths: string[];
  weaknesses: string[];
  missingRequirements: string[];
  redFlags: string[];
  overallQualityLabel: string;
  timePlausibilityLabel: string;
  feedbackQualityLabel: string;
  needsManualReview: string;
  reviewStatus: string;
  reviewNote: string;
  reviewedAt: string;
  reviewedBy: string;
  sourceSyncedAt: string;
  sourceFetchedAt: string;
  sourceHash: string;
  auditedAt: string;
  auditStartedAt: string;
  lastError: string;
  modelName: string;
  modelResponseId: string;
  attemptCount: string;
  auditPromptVersion: string;
  contentFormatLabel: string;
  extractionMethod: string;
  contentCharCount: string;
  feedbackWordCount: string;
  raw: AuditRow;
}

export interface AuditFeedback {
  id: string;
  date: string;
  author: string;
  message: string;
  count: string;
  reportUrl: string;
  reportBlob: string;
  reportFileName: string;
  assessedStatus: string;
  wordCount: string;
}

const TITLE_KEYS = ['EvidenceName', 'name', 'title', 'component', 'ComponentTitle'];

export function normalizeEvidence(rows: AuditRow[], relatedRows: AuditRow[] = []): AuditEvidenceItem[] {
  const relatedById = new Map<string, AuditRow>(
    relatedRows.map((row) => [cleanText(valueFrom(row, ['evidence_id', 'id', 'Id'])), row]).filter(([id]) => id) as Array<[string, AuditRow]>,
  );

  return rows.map((entry, index) => {
    const raw = asRow(entry.raw) || entry;
    const id = cleanText(valueFrom(entry, ['evidence_id', 'id']) || valueFrom(raw, ['EvidenceId', 'Id', 'id']) || index + 1);
    const related = relatedById.get(id) || {};
    const relatedRaw = asRow(valueFrom(related, ['evidence_raw'])) || {};
    const auditResult = asRow(valueFrom(related, ['audit_result'])) || {};
    const submission = asRow(valueFrom(entry, ['submission'])) || {};
    const report = asRow(valueFrom(entry, ['report'])) || {};
    const azureContainer = cleanText(valueFrom(entry, ['_azure_container', 'container']));
    const submissionBlob = cleanText(valueFrom(submission, ['blob']) || valueFrom(entry, ['file_blob']));
    const submissionFileName = cleanText(valueFrom(submission, ['filename']) || fileNameFromPath(submissionBlob));
    const reportBlob = cleanText(valueFrom(report, ['blob']) || valueFrom(entry, ['report_blob']) || valueFrom(related, ['report_blob']));
    const reportFileName = cleanText(valueFrom(report, ['filename']) || fileNameFromPath(reportBlob));
    const submissionUrl = azureContainer && submissionBlob ? auditBlobUrl(azureContainer, submissionBlob, submissionFileName) : '';
    const reportUrl = azureContainer && reportBlob ? auditBlobUrl(azureContainer, reportBlob, reportFileName) : '';
    const feedbacks = normalizeFeedbacks(valueFrom(entry as AuditRow, ['feedback', 'feedbacks']) || valueFrom(related as AuditRow, ['feedbacks']), azureContainer);
    return {
      id,
      title: cleanText(valueFrom(entry, TITLE_KEYS) || valueFrom(related, ['evidence_name']) || valueFrom(raw, TITLE_KEYS) || valueFrom(relatedRaw, TITLE_KEYS) || `Evidence ${index + 1}`),
      kind: cleanText(valueFrom(entry, ['kind']) || valueFrom(related, ['evidence_kind', 'hours_type']) || valueFrom(raw, ['EvidenceKind', 'HourType', 'HoursType']) || ''),
      status: cleanText(valueFrom(entry, ['evidence_status', 'status', 'LatestStatus', 'ConfirmedStatus']) || valueFrom(related, ['evidence_status']) || valueFrom(raw, ['LatestStatus', 'ConfirmedStatus']) || ''),
      date: cleanText(valueFrom(entry, ['submission_date', 'completed_date', 'SubmissionDate', 'SubmittedDate', 'CompletedDate', 'UpdatedDate', 'created_date', 'date']) || valueFrom(related, ['submission_date', 'completed_date', 'created_date']) || valueFrom(raw, ['SubmissionDate', 'SubmittedDate', 'CompletedDate', 'UpdatedDate']) || ''),
      submittedDate: cleanText(valueFrom(entry, ['submission_date', 'SubmissionDate', 'SubmittedDate']) || valueFrom(related, ['submission_date']) || valueFrom(raw, ['SubmissionDate', 'SubmittedDate']) || ''),
      completedDate: cleanText(valueFrom(entry, ['completed_date', 'CompletedDate']) || valueFrom(related, ['completed_date']) || valueFrom(raw, ['CompletedDate']) || ''),
      createdDate: cleanText(valueFrom(entry, ['created_date']) || valueFrom(related, ['created_date']) || ''),
      learnerId: cleanText(valueFrom(entry, ['LearnerId', 'learner_id']) || valueFrom(related, ['learner_id']) || valueFrom(raw, ['LearnerId']) || ''),
      fullName: cleanText(valueFrom(related, ['full_name']) || ''),
      programName: cleanText(valueFrom(related, ['program_name']) || ''),
      programId: cleanText(valueFrom(entry, ['ProgramId', 'program_id']) || valueFrom(related, ['program_id']) || valueFrom(raw, ['ProgramId']) || ''),
      subProgramId: cleanText(valueFrom(entry, ['SubProgramId', 'sub_program_id']) || valueFrom(related, ['sub_program_id']) || valueFrom(raw, ['SubProgramId']) || ''),
      componentId: cleanText(valueFrom(entry, ['component_id']) || valueFrom(related, ['component_id']) || valueFrom(raw, ['ComponentId']) || ''),
      submittedById: cleanText(valueFrom(entry, ['SubmittedById', 'submitted_by_id']) || valueFrom(related, ['submitted_by_id']) || valueFrom(raw, ['SubmittedById']) || ''),
      hoursType: cleanText(valueFrom(entry, ['HoursType', 'hours_type']) || valueFrom(related, ['hours_type']) || valueFrom(raw, ['HoursType']) || ''),
      spentTime: cleanText(valueFrom(entry, ['otjh_minutes', 'SpentTime', 'spent_time']) || valueFrom(related, ['spent_time']) || valueFrom(raw, ['SpentTime']) || ''),
      spentTimeType: cleanText(valueFrom(entry, ['SpentTimeType', 'spent_time_type']) || valueFrom(related, ['spent_time_type']) || valueFrom(raw, ['SpentTimeType']) || ''),
      content: cleanText(valueFrom(submission, ['note_text']) || valueFrom(entry, ['content', 'note_content', 'EvidenceName']) || valueFrom(related, ['note_content', 'evidence_name']) || valueFrom(raw, ['EvidenceName']) || ''),
      feedbacks,
      reportUrl: reportUrl || cleanText(valueFrom(entry, ['assessment_report_url', 'report_url']) || valueFrom(related, ['assessment_report_url']) || valueFrom(raw, ['report_url']) || ''),
      fileUrl: submissionUrl || cleanText(valueFrom(entry, ['file', 'source_file_url']) || valueFrom(related, ['source_file_url']) || valueFrom(raw, ['file']) || ''),
      azureContainer,
      submissionStatus: cleanText(valueFrom(submission, ['status']) || ''),
      submissionType: cleanText(valueFrom(submission, ['type']) || ''),
      submissionReason: cleanText(valueFrom(submission, ['reason']) || ''),
      submissionFileName,
      reportStatus: cleanText(valueFrom(report, ['status']) || ''),
      reportFileName,
      fileBlob: submissionBlob || cleanText(valueFrom(entry, ['file_blob']) || valueFrom(related, ['file_blob']) || ''),
      noteBlob: cleanText(valueFrom(entry, ['note_blob']) || valueFrom(related, ['note_blob']) || ''),
      noteContent: cleanText(valueFrom(submission, ['note_text']) || valueFrom(entry, ['note_content']) || valueFrom(related, ['note_content']) || ''),
      reportBlob,
      auditScore: cleanText(valueFrom(related, ['audit_score']) || valueFrom(auditResult, ['score']) || ''),
      auditStatus: cleanText(valueFrom(related, ['audit_status']) || ''),
      auditVerdict: cleanText(valueFrom(related, ['audit_verdict']) || ''),
      convincing: cleanText(valueFrom(related, ['convincing']) || ''),
      auditRisk: cleanText(valueFrom(related, ['audit_risk']) || valueFrom(auditResult, ['audit_risk']) || ''),
      evidenceType: cleanText(valueFrom(related, ['evidence_type']) || valueFrom(auditResult, ['evidence_type']) || ''),
      authenticityConfidence: cleanText(valueFrom(related, ['authenticity_confidence']) || valueFrom(auditResult, ['authenticity_confidence']) || ''),
      feedbackAlignment: cleanText(valueFrom(related, ['feedback_alignment']) || ''),
      auditSummary: cleanText(valueFrom(related, ['audit_summary']) || valueFrom(auditResult, ['summary']) || ''),
      auditReasons: cleanList(valueFrom(related, ['audit_reasons']) || valueFrom(auditResult, ['reasons'])),
      recommendedAction: cleanText(valueFrom(related, ['recommended_action']) || valueFrom(auditResult, ['recommended_action']) || ''),
      strengths: cleanList(valueFrom(related, ['audit_strengths']) || valueFrom(auditResult, ['strengths'])),
      weaknesses: cleanList(valueFrom(related, ['audit_weaknesses']) || valueFrom(auditResult, ['weaknesses'])),
      missingRequirements: cleanList(valueFrom(related, ['missing_requirements']) || valueFrom(auditResult, ['missing_requirements'])),
      redFlags: cleanList(valueFrom(related, ['red_flags']) || valueFrom(auditResult, ['red_flags'])),
      overallQualityLabel: cleanText(valueFrom(related, ['overall_quality_label']) || valueFrom(auditResult, ['overall_quality_label']) || ''),
      timePlausibilityLabel: cleanText(valueFrom(related, ['time_plausibility_label']) || valueFrom(auditResult, ['time_plausibility_label']) || ''),
      feedbackQualityLabel: cleanText(valueFrom(related, ['feedback_quality_label']) || valueFrom(auditResult, ['feedback_quality_label']) || ''),
      needsManualReview: cleanText(valueFrom(related, ['needs_manual_review']) || ''),
      reviewStatus: cleanText(valueFrom(related, ['review_status']) || ''),
      reviewNote: cleanText(valueFrom(related, ['review_note']) || ''),
      reviewedAt: cleanText(valueFrom(related, ['reviewed_at']) || ''),
      reviewedBy: cleanText(valueFrom(related, ['reviewed_by']) || ''),
      sourceSyncedAt: cleanText(valueFrom(related, ['source_synced_at']) || ''),
      sourceFetchedAt: cleanText(valueFrom(related, ['source_fetched_at']) || ''),
      sourceHash: cleanText(valueFrom(related, ['source_hash']) || ''),
      auditedAt: cleanText(valueFrom(related, ['audited_at']) || ''),
      auditStartedAt: cleanText(valueFrom(related, ['audit_started_at']) || ''),
      lastError: cleanText(valueFrom(related, ['last_error']) || ''),
      modelName: cleanText(valueFrom(related, ['model_name']) || ''),
      modelResponseId: cleanText(valueFrom(related, ['model_response_id']) || ''),
      attemptCount: cleanText(valueFrom(related, ['attempt_count']) || ''),
      auditPromptVersion: cleanText(valueFrom(related, ['audit_prompt_version']) || ''),
      contentFormatLabel: cleanText(valueFrom(related, ['content_format_label']) || ''),
      extractionMethod: cleanText(valueFrom(related, ['extraction_method']) || ''),
      contentCharCount: cleanText(valueFrom(related, ['content_char_count']) || ''),
      feedbackWordCount: cleanText(valueFrom(entry, ['word_count']) || valueFrom(asRow(valueFrom(entry, ['feedback'])) || {}, ['word_count']) || valueFrom(related, ['feedback_word_count']) || ''),
      raw,
    };
  }).sort((left, right) => sortableDate(right.date) - sortableDate(left.date));
}

function fileNameFromPath(value: string) {
  const normalized = String(value || '').trim();
  if (!normalized) return '';
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || '';
}

export function valueFrom(row: Record<string, any>, keys: string[]) {
  const lookup = new Map(Object.keys(row || {}).map((key) => [key.toLowerCase(), key]));
  for (const key of keys) {
    const actual = lookup.get(key.toLowerCase());
    if (actual && row[actual] !== null && row[actual] !== undefined && row[actual] !== '') return row[actual];
  }
  return '';
}

export function asRow(value: AuditJsonValue | undefined): AuditRow | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, AuditJsonValue>) as AuditRow : null;
}

export function cleanText(value: AuditJsonValue | undefined): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

export function cleanList(value: AuditJsonValue | undefined): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => cleanText(item)).filter(Boolean);
}

export function shorten(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max - 1)}...` : value;
}

export function sortableDate(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function normalizeFeedbacks(value: AuditJsonValue | undefined, azureContainer = ''): AuditFeedback[] {
  const source = asRow(value);
  if (source) {
    const directMessage = cleanText(valueFrom(source, ['message']));
    const nestedMessages = Array.isArray(source.messages) ? source.messages : [];
    const items = nestedMessages.length ? nestedMessages : directMessage ? [source] : [];
    return normalizeFeedbacks(items as AuditJsonValue[], azureContainer).map((feedback) => ({
      ...feedback,
      count: feedback.count || cleanText(valueFrom(source, ['count'])),
      reportBlob: feedback.reportBlob || cleanText(valueFrom(source, ['report_blob'])),
      reportFileName: feedback.reportFileName || cleanText(valueFrom(source, ['report_filename'])),
      wordCount: feedback.wordCount || cleanText(valueFrom(source, ['word_count'])),
      reportUrl: feedback.reportUrl || buildBlobUrl(azureContainer, cleanText(valueFrom(source, ['report_blob'])), cleanText(valueFrom(source, ['report_filename']))),
    }));
  }

  if (!Array.isArray(value)) return [];
  return value.map((item, index) => {
    const row = asRow(item) || {};
    const reportBlob = cleanText(valueFrom(row, ['report_blob']));
    const reportFileName = cleanText(valueFrom(row, ['report_filename']) || fileNameFromPath(reportBlob));
    return {
      id: cleanText(valueFrom(row, ['id']) || index + 1),
      date: cleanText(valueFrom(row, ['date'])),
      author: cleanText(valueFrom(row, ['author'])),
      message: cleanText(valueFrom(row, ['message'])),
      count: cleanText(valueFrom(row, ['count'])),
      reportUrl: cleanText(valueFrom(row, ['report_url'])) || buildBlobUrl(azureContainer, reportBlob, reportFileName),
      reportBlob,
      reportFileName,
      assessedStatus: cleanText(valueFrom(row, ['assessed_status'])),
      wordCount: cleanText(valueFrom(row, ['word_count'])),
    };
  });
}

function buildBlobUrl(container: string, blob: string, filename: string) {
  return container && blob ? auditBlobUrl(container, blob, filename || fileNameFromPath(blob)) : '';
}
