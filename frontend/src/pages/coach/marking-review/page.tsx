import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { LearnerKind } from '@/api/learnerDetail';
import { fetchEvidence, getEvidenceDownloadUrl, type EvidenceRecord } from '@/api/evidence';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { useCoachIdentity } from '@/hooks/useCoachIdentity';
import { coachFetch } from '@/lib/coachFetch';
import { roleNavMap } from '@/mocks/navigation';
import styles from './markingReview.module.css';

const coachNav = roleNavMap.coach;
async function personalEvidence(submissionId: string, fileId?: string) {
  const response = await coachFetch(`/coach_api/coach/personal-marking/${submissionId}/evidence${fileId ? `/${fileId}` : ''}`);
  const data = await response.json();
  if (!response.ok) throw new Error(data.detail || 'Could not load personal coursework evidence.');
  return data as { results: EvidenceRecord[]; url: string };
}

interface Submission {
  version?: number;
  contentSections?: { label: string; text: string }[];
  reviewHistory?: { decision: string; feedback: string; reviewedAt: string; reviewedBy: string }[];
  id: string;
  learnerKind: LearnerKind;
  learnerId: string;
  learner: string;
  initials: string;
  programme: string;
  activityType: string;
  activityId: string;
  activityTitle: string;
  module: string;
  week: string;
  plannedOtjh: string;
  status: string;
  learningReflection: string;
  ksbCodes: string[];
  ksbWeights: Record<string, number>;
  ksbExplanations: Record<string, string>;
  applicationType: string;
  applicationText: string;
  evidenceConsentConfirmed: boolean;
  selectedBenefits: string[];
  benefitExplanation: string;
  actualTimeHours: string;
  completedDuringPaidHours: string;
  dateCompleted: string | null;
  otjhConfirmed: boolean;
  signedDeclaration: boolean;
  qualityScore: number;
  coachFeedback: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  submittedAt: string | null;
  submittedDisplay: string;
  elapsedDays: number;
  isOverdue: boolean;
}

interface QueueSummary {
  pendingItems: number;
  overdueItems: number;
  acceptedItems: number;
  referredItems: number;
}

type ReviewDecision = 'accepted' | 'rejected' | 'referred';
type WorkspaceTab = 'submission' | 'evidence' | 'history';
type QueueKind = 'all' | 'assignment' | 'reflection';

function statusLabel(status: string) {
  if (status === 'accepted') return 'Accepted';
  if (status === 'partial') return 'Partially awarded';
  if (status === 'referred' || status === 'rejected') return 'Referred back';
  if (status === 'escalated') return 'Escalated';
  return 'Pending review';
}

function formatDate(value: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fileSize(bytes: number) {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isAssignment(item: Submission) {
  return (item.activityType || '').toLowerCase() === 'assignment';
}

export default function CoachMarkingReviewPage() {
  const [searchParams] = useSearchParams();
  const personal = searchParams.get('scope') === 'personal';
  const apiEndpoint = personal ? '/coach_api/coach/personal-marking' : '/coach_api/coach/marking-queue';
  const scopeQuery = personal ? '?scope=personal' : '';
  const queuePath = `/coach/marking-queue${scopeQuery}`;
  const { submissionId } = useParams<{ submissionId: string }>();
  const navigate = useNavigate();
  const coach = useCoachIdentity();
  const [selected, setSelected] = useState<Submission | null>(null);
  const [queueItems, setQueueItems] = useState<Submission[]>([]);
  const [queueSummary, setQueueSummary] = useState<QueueSummary>({ pendingItems: 0, overdueItems: 0, acceptedItems: 0, referredItems: 0 });
  const [feedback, setFeedback] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [aiNotice, setAiNotice] = useState('');
  const [error, setError] = useState('');
  const [evidence, setEvidence] = useState<EvidenceRecord[]>([]);
  const [evidenceError, setEvidenceError] = useState('');
  const [downloading, setDownloading] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const [defaultPrompt, setDefaultPrompt] = useState('');
  const [promptFile, setPromptFile] = useState('');
  const [promptKind, setPromptKind] = useState('');
  const [promptAvailable, setPromptAvailable] = useState(true);
  const [promptError, setPromptError] = useState('');
  const [search, setSearch] = useState('');
  const [queueKind, setQueueKind] = useState<QueueKind>('all');
  const [tab, setTab] = useState<WorkspaceTab>('submission');

  const loadSequence = useRef(0);
  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    if (!coach.isInitialized) return;
    setLoading(true);
    setError('');
    if (!coach.email) {
      setSelected(null);
      setError('Coach access is required to load submissions.');
      setLoading(false);
      return;
    }

    try {
      const detailResponse = await coachFetch(`${apiEndpoint}/${submissionId}`);
      const detailText = await detailResponse.text();
      const detailData = detailText ? JSON.parse(detailText) : {};
      if (sequence !== loadSequence.current) return;
      if (!detailResponse.ok) throw new Error(detailData.detail || 'Unable to load this submission.');
      setSelected(detailData.item || null);

      try {
        const queueResponse = await coachFetch(`${apiEndpoint}?status=all&page=1&page_size=25`);
        const queueText = await queueResponse.text();
        const queueData = queueText ? JSON.parse(queueText) : {};
        if (queueResponse.ok) {
          setQueueItems(queueData.items || []);
          setQueueSummary(queueData.summary || { pendingItems: 0, overdueItems: 0, acceptedItems: 0, referredItems: 0 });
        }
      } catch {
        setQueueItems([]);
      }
    } catch (loadError) {
      if (sequence !== loadSequence.current) return;
      setSelected(null);
      setError(loadError instanceof Error ? loadError.message : 'Unable to load this submission.');
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, [apiEndpoint, coach.email, coach.isInitialized, submissionId]);

  useEffect(() => {
    void load();
    return () => { ++loadSequence.current; };
  }, [load]);

  useEffect(() => {
    if (selected) setFeedback(selected.coachFeedback ?? '');
  }, [selected]);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    setEvidence([]);
    setEvidenceError('');
    (personal ? personalEvidence(selected.id).then(data => data.results) : fetchEvidence(selected.learnerKind, selected.learnerId, { sectionRef: selected.activityId }))
      .then(records => { if (!cancelled) setEvidence(records); })
      .catch(loadError => {
        if (!cancelled) setEvidenceError(loadError instanceof Error ? loadError.message : 'The uploaded files could not be listed.');
      });
    return () => { cancelled = true; };
  }, [personal, selected]);

  useEffect(() => {
    if (!selected || personal) return;
    let cancelled = false;
    setPromptError('');
    coachFetch(`${apiEndpoint}/${selected.id}/ai-prompt`)
      .then(async response => {
        const body = await response.text();
        let data: { prompt?: string; file?: string; kind?: string; available?: boolean; detail?: string; error?: string } = {};
        try { data = body ? JSON.parse(body) : {}; } catch { throw new Error(`The marking prompt could not be loaded (server error ${response.status}).`); }
        if (!response.ok) throw new Error(data.error || data.detail || 'The marking prompt could not be loaded.');
        if (cancelled) return;
        setDefaultPrompt(data.prompt || '');
        setPrompt(data.prompt || '');
        setPromptFile(data.file || '');
        setPromptKind(data.kind || '');
        setPromptAvailable(data.available !== false);
      })
      .catch(loadError => {
        if (!cancelled) setPromptError(loadError instanceof Error ? loadError.message : 'The marking prompt could not be loaded.');
      });
    return () => { cancelled = true; };
  }, [apiEndpoint, personal, selected]);

  const promptEdited = Boolean(prompt.trim()) && prompt.trim() !== defaultPrompt.trim();
  const promptCleared = !prompt.trim() && Boolean(defaultPrompt.trim());

  const visibleQueue = useMemo(() => {
    const currentItems = selected && !queueItems.some(item => item.id === selected.id)
      ? [selected, ...queueItems]
      : queueItems;
    const term = search.trim().toLowerCase();
    return currentItems.filter(item => {
      const kindMatches = queueKind === 'all'
        || (queueKind === 'assignment' ? isAssignment(item) : !isAssignment(item));
      const searchMatches = !term || [item.learner, item.programme, item.activityTitle, item.module]
        .some(value => value?.toLowerCase().includes(term));
      return kindMatches && searchMatches;
    });
  }, [queueItems, queueKind, search, selected]);

  const markedToday = useMemo(() => {
    const today = new Date().toDateString();
    return queueItems.filter(item => item.reviewedAt && new Date(item.reviewedAt).toDateString() === today).length;
  }, [queueItems]);

  const openEvidence = async (record: EvidenceRecord) => {
    if (!selected || downloading) return;
    const tabWindow = window.open('', '_blank');
    if (tabWindow) tabWindow.opener = null;
    setDownloading(record.id);
    setEvidenceError('');
    try {
      const url = personal ? (await personalEvidence(selected.id, record.id)).url : await getEvidenceDownloadUrl(selected.learnerKind, selected.learnerId, record.id);
      if (tabWindow) tabWindow.location.href = url;
      else setEvidenceError('Allow pop-ups for this site to open the document.');
    } catch (downloadError) {
      tabWindow?.close();
      setEvidenceError(downloadError instanceof Error ? downloadError.message : 'The document could not be opened.');
    } finally {
      setDownloading(null);
    }
  };

  const generateAiFeedback = async () => {
    if (!selected || generating) return;
    setGenerating(true);
    setError('');
    setAiNotice('');
    try {
      const response = await coachFetch(`${apiEndpoint}/${selected.id}/ai-feedback`, {
        method: 'POST',
        ...(promptEdited ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: prompt.trim() }) } : {}),
      });
      const text = await response.text();
      let data: { feedback?: string; error?: string; detail?: string; meta?: { ksbCount?: number; epaFile?: string; promptSource?: string } } = {};
      try { data = text ? JSON.parse(text) : {}; } catch { throw new Error(`The draft could not be generated (server error ${response.status}).`); }
      if (!response.ok) throw new Error(data.error || data.detail || 'The draft could not be generated.');
      setFeedback(data.feedback || '');
      const ksbCount = data.meta?.ksbCount ?? 0;
      const promptNote = data.meta?.promptSource === 'custom' ? ' from your edited prompt' : '';
      setAiNotice(`AI-assisted draft generated${promptNote}${ksbCount ? ` against ${ksbCount} assigned KSB${ksbCount === 1 ? '' : 's'}` : ''}. Review and edit it before deciding.`);
    } catch (aiError) {
      setError(aiError instanceof Error ? aiError.message : 'The draft could not be generated.');
    } finally {
      setGenerating(false);
    }
  };

  const saveDecision = async (decision: ReviewDecision) => {
    if (!selected || saving) return;
    if (!feedback.trim()) {
      setError('Write feedback for the learner before sending this decision.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const response = await coachFetch(`${apiEndpoint}/${selected.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, feedback: feedback.trim(), reviewedBy: coach.name, ...(personal ? { version: selected.version } : {}) }),
      });
      const text = await response.text();
      let data: { detail?: string; error?: string; fields?: Record<string, string[] | string> } = {};
      try { data = text ? JSON.parse(text) : {}; } catch { throw new Error(`The review could not be saved (server error ${response.status}).`); }
      if (!response.ok) {
        const fieldMessages = Object.entries(data.fields ?? {}).map(([field, message]) => `${field}: ${Array.isArray(message) ? message.join(' ') : message}`).join('; ');
        throw new Error(fieldMessages || data.detail || data.error || 'The review could not be saved.');
      }
      navigate(queuePath);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'The review could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <WorkspaceShell role="coach" roleLabel={coachNav.label} navItems={coachNav.items} workspaceLabel={coachNav.workspaceLabel} pageTitle="Marking workspace" pageSubtitle="Review evidence and record your professional judgement" userName={coach.name} userRole="Progress Coach">
      <div className={styles.page}>
        <header className={styles.hero}>
          <button type="button" className={styles.back} onClick={() => navigate(queuePath)}>
            <i className="ri-arrow-left-line" aria-hidden="true" /> Marking queue
          </button>
          <p className={styles.eyebrow}>AI-assisted marking</p>
          <div className={styles.heroRow}>
            <div>
              <h1>Monthly marking workspace</h1>
              <p>AI drafts are clearly labelled and require your validation. Final professional judgement is yours.</p>
            </div>
            <span className={styles.judgement}><i className="ri-shield-check-line" aria-hidden="true" /> Coach judgement final</span>
          </div>
        </header>

        {loading ? (
          <div className={styles.loading}><span /><span /><span /></div>
        ) : !selected ? (
          <div className={styles.errorState} role="alert">
            <i className="ri-file-search-line" aria-hidden="true" />
            <h2>Unable to open this submission</h2>
            <p>{error || 'The submission was not found.'}</p>
            <button type="button" onClick={() => void load()}>Try again</button>
          </div>
        ) : (
          <div className={styles.workspace}>
            <aside className={styles.queuePanel} aria-label="Marking queue">
              <div className={styles.stats}>
                <div><i className="ri-time-line" aria-hidden="true" /><span>Due</span><strong>{queueSummary.pendingItems}</strong></div>
                <div><i className="ri-error-warning-line" aria-hidden="true" /><span>Overdue</span><strong>{queueSummary.overdueItems}</strong></div>
                <div><i className="ri-checkbox-circle-line" aria-hidden="true" /><span>Marked today</span><strong>{markedToday}</strong></div>
              </div>
              <label className={styles.search}>
                <i className="ri-search-line" aria-hidden="true" />
                <span className="sr-only">Search marking queue</span>
                <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search learner or activity" />
              </label>
              <div className={styles.queueFilters} role="group" aria-label="Filter marking queue by type">
                {(['all', 'assignment', 'reflection'] as QueueKind[]).map(value => (
                  <button type="button" key={value} aria-pressed={queueKind === value} onClick={() => setQueueKind(value)}>{value === 'all' ? 'All' : `${value[0].toUpperCase()}${value.slice(1)}s`}</button>
                ))}
              </div>
              <div className={styles.queueList}>
                {visibleQueue.map(item => (
                  <button type="button" key={item.id} className={styles.queueItem} aria-current={item.id === selected.id ? 'true' : undefined} onClick={() => navigate(`/coach/marking-queue/${item.id}`)}>
                    <span className={styles.queueItemTop}><strong>{item.learner}</strong><em>{isAssignment(item) ? 'Assignment' : 'Reflection'}</em></span>
                    <span className={styles.queueTitle}>{item.activityTitle}</span>
                    <span className={styles.queueMeta}>Submitted {item.submittedDisplay}</span>
                    <span className={styles.queueStatus} data-overdue={item.isOverdue || undefined}>{item.isOverdue ? `Overdue ${item.elapsedDays}d` : statusLabel(item.status)}</span>
                  </button>
                ))}
                {visibleQueue.length === 0 && <p className={styles.noQueueItems}>No submissions match this filter.</p>}
              </div>
            </aside>

            <main className={styles.reviewPanel}>
              <section className={styles.submissionHeader}>
                <div className={styles.personRow}>
                  <div><h2>{selected.learner}</h2><p>{selected.programme || 'Learner programme'}</p></div>
                  <span>{isAssignment(selected) ? 'Assignment' : 'Reflection'}</span>
                </div>
                <h3>{selected.activityTitle}</h3>
                <dl className={styles.metrics}>
                  <div><dt>Submitted</dt><dd>{selected.submittedDisplay}</dd></div>
                  <div><dt>Status</dt><dd>{statusLabel(selected.status)}</dd></div>
                  <div><dt>Hours</dt><dd>{selected.actualTimeHours || '—'} recorded / {selected.plannedOtjh || '—'} planned</dd></div>
                  <div><dt>Claimed KSBs</dt><dd>{selected.ksbCodes.join(', ') || 'None claimed'}</dd></div>
                </dl>
              </section>

              <div className={styles.tabs} role="tablist" aria-label="Submission detail">
                {([
                  ['submission', 'Submission'],
                  ['evidence', 'Evidence & KSBs'],
                  ['history', 'Progress history'],
                ] as Array<[WorkspaceTab, string]>).map(([value, label]) => (
                  <button type="button" role="tab" aria-selected={tab === value} key={value} onClick={() => setTab(value)}>{label}</button>
                ))}
              </div>

              {tab === 'submission' && (
                <section className={styles.tabPanel} role="tabpanel">
                  {personal && selected.contentSections?.map((section, index) => (
                    <div className={styles.responseBlock} key={`${section.label}-${index}`}>
                      <strong>{section.label}</strong><p>{section.text}</p>
                    </div>
                  ))}
                  <div className={styles.questionBlock}>
                    <span>Learner submission</span>
                    <p>{[selected.module, selected.week].filter(Boolean).join(' · ') || selected.activityTitle}</p>
                  </div>
                  <article className={styles.answerBlock}>
                    <header><strong>Learning reflection</strong><span>{(selected.learningReflection || '').trim().split(/\s+/).filter(Boolean).length} words</span></header>
                    <p>{selected.learningReflection || 'No learning reflection was supplied.'}</p>
                  </article>
                  <article className={styles.answerBlock}>
                    <header><strong>Workplace application</strong></header>
                    <p>{[selected.applicationType, selected.applicationText].filter(Boolean).join(' — ') || 'No workplace application was supplied.'}</p>
                  </article>
                  <article className={styles.answerBlock}>
                    <header><strong>Employer and business impact</strong></header>
                    <p>{[selected.selectedBenefits.join(', '), selected.benefitExplanation].filter(Boolean).join(' — ') || 'No employer benefit was supplied.'}</p>
                  </article>
                  <div className={styles.declarationGrid}>
                    <span>Completed: <strong>{formatDate(selected.dateCompleted)}</strong></span>
                    <span>Paid hours: <strong>{selected.completedDuringPaidHours || '—'}</strong></span>
                    <span>OTJH confirmed: <strong>{selected.otjhConfirmed ? 'Yes' : 'No'}</strong></span>
                    <span>Declaration signed: <strong>{selected.signedDeclaration ? 'Yes' : 'No'}</strong></span>
                  </div>
                </section>
              )}

              {tab === 'evidence' && (
                <section className={styles.tabPanel} role="tabpanel">
                  <div className={styles.sectionHeading}><div><h4>Uploaded evidence</h4><p>Documents attached to this activity.</p></div><span>{evidence.length} files</span></div>
                  {evidence.length ? (
                    <ul className={styles.evidenceList}>
                      {evidence.map(record => {
                        const approved = record.status === 'approved';
                        return (
                          <li key={record.id}>
                            <i className="ri-file-text-line" aria-hidden="true" />
                            <div><strong>{record.filename}</strong><span>{[record.contentType, fileSize(record.sizeBytes)].filter(Boolean).join(' · ')}</span></div>
                            {approved ? <button type="button" disabled={downloading === record.id} onClick={() => void openEvidence(record)}>{downloading === record.id ? 'Opening…' : 'Open file'}</button> : <em>{record.status === 'rejected' ? 'Failed scan' : 'Awaiting scan'}</em>}
                          </li>
                        );
                      })}
                    </ul>
                  ) : <p className={styles.emptyText}>{evidenceError || 'No document was uploaded with this submission.'}</p>}
                  {evidenceError && evidence.length > 0 && <p className={styles.inlineError}>{evidenceError}</p>}

                  <div className={styles.sectionHeading}><div><h4>Claimed KSBs</h4><p>Knowledge, skills and behaviours recorded for this activity.</p></div></div>
                  <div className={styles.ksbList}>
                    {selected.ksbCodes.length ? selected.ksbCodes.map(code => (
                      <article key={code}><span>{code}</span><div><strong>{selected.ksbExplanations[code] || 'No explanation supplied.'}</strong>{selected.ksbWeights[code] != null && <small>Weight {selected.ksbWeights[code]}</small>}</div></article>
                    )) : <p className={styles.emptyText}>No KSBs are assigned to this activity.</p>}
                  </div>
                </section>
              )}

              {tab === 'history' && (
                <section className={styles.tabPanel} role="tabpanel">
                  <div className={styles.historyCard}>
                    <i className={selected.reviewedAt ? 'ri-checkbox-circle-line' : 'ri-time-line'} aria-hidden="true" />
                    <div><h4>{selected.reviewedAt ? statusLabel(selected.status) : 'Awaiting coach review'}</h4><p>{selected.reviewedAt ? `${formatDate(selected.reviewedAt)} · ${selected.reviewedBy || 'Coach'}` : `Submitted ${selected.submittedDisplay}`}</p></div>
                  </div>
                  {selected.coachFeedback && <div className={styles.previousFeedback}><strong>Recorded coach feedback</strong><p>{selected.coachFeedback}</p></div>}
                  {personal && selected.reviewHistory?.map((entry, index) => (
                    <div className={styles.previousFeedback} key={`${entry.reviewedAt}-${index}`}>
                      <strong>{statusLabel(entry.decision)} · {entry.reviewedBy}</strong>
                      <p>{formatDate(entry.reviewedAt)} · {entry.feedback}</p>
                    </div>
                  ))}
                </section>
              )}

              <section className={styles.feedbackPanel}>
                <div className={styles.feedbackHeading}>
                  <div><p>Coach feedback</p><h4>Review the AI draft and make the final decision</h4></div>
                  {!personal && <button type="button" disabled={generating || saving} onClick={() => void generateAiFeedback()}>
                    <i className={generating ? 'ri-loader-4-line' : 'ri-sparkling-line'} aria-hidden="true" />
                    {generating ? 'Generating…' : 'Generate AI draft'}
                  </button>}
                </div>
                <textarea aria-label="Review feedback" value={feedback} onChange={event => setFeedback(event.target.value)} rows={7} placeholder="Write clear, actionable feedback for the learner…" />
                {aiNotice && <p className={styles.aiNotice}><i className="ri-sparkling-line" aria-hidden="true" /> {aiNotice}</p>}
                {error && <p className={styles.inlineError}>{error}</p>}

                {!personal && <details className={styles.promptEditor}>
                  <summary>AI marking instructions {promptEdited ? <span>Edited</span> : null}</summary>
                  <p>{promptAvailable ? `These ${promptKind === 'assignment' ? 'assignment marking' : 'reflection validation'} instructions apply to the next draft only.` : 'No saved prompt is available. You can supply instructions for this draft.'}</p>
                  <textarea value={prompt} onChange={event => setPrompt(event.target.value)} rows={8} spellCheck={false} placeholder="Write the instructions the AI should mark against…" />
                  <div className={styles.promptMeta}>
                    <span>{promptFile || 'No prompt file'} · {prompt.length.toLocaleString()} characters</span>
                    <button type="button" disabled={!defaultPrompt || prompt === defaultPrompt} onClick={() => setPrompt(defaultPrompt)}>Reset to default</button>
                  </div>
                  {promptCleared && <p>The saved prompt will be used because this field is empty.</p>}
                  {promptError && <p className={styles.inlineError}>{promptError}</p>}
                </details>}

                <div className={styles.decisionRow}>
                  <button type="button" className={styles.reject} disabled={saving} onClick={() => void saveDecision(personal ? 'referred' : 'rejected')}><i className="ri-arrow-go-back-line" aria-hidden="true" /> {personal ? 'Return for improvement' : 'Refer back with feedback'}</button>
                  <button type="button" className={styles.accept} disabled={saving} onClick={() => void saveDecision('accepted')}><i className={saving ? 'ri-loader-4-line' : 'ri-shield-check-line'} aria-hidden="true" /> Accept assignment and send feedback</button>
                </div>
              </section>
            </main>
          </div>
        )}
      </div>
    </WorkspaceShell>
  );
}
