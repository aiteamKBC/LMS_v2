import { lazy, Suspense, useEffect, useId, useState } from 'react';
import DOMPurify from 'dompurify';
import { VideoPlayer, parseVideoUrl } from '@/components/feature/VideoPlayer';
import { SlideDeckViewer } from '@/components/feature/SlideDeckViewer';
import { resolveDocEmbed } from '@/lib/docEmbed';
import { normalizeReadingHtml } from '@/lib/readingHtml';
import { subjectRequest, type SubjectMaterial, type SubjectAttemptResult } from '@/api/studentActivity';

const AttachmentPreview = lazy(() => import('../video-watch/page').then((module) => ({ default: module.InlineAttachmentPreview })));

function Html({ value }: { value: string }) {
  const normalized = normalizeReadingHtml(value);
  const clean = DOMPurify.sanitize(normalized, { FORBID_TAGS: ['form'], FORBID_ATTR: ['srcdoc'] });
  const document = new DOMParser().parseFromString(normalized, 'text/html');
  const embeds = [...document.querySelectorAll('iframe')].map((frame) => frame.getAttribute('src') || '').filter((url) => /^https?:\/\//i.test(url));
  return <div className="space-y-4"><div className="prose max-w-none break-words" dangerouslySetInnerHTML={{ __html: clean }} />
    {embeds.map((url, index) => <Media key={`${index}:${url}`} value={url} kind="embed" title={`Embedded content ${index + 1}`} />)}
  </div>;
}

export function Media({ value, kind, title, fileName, canEmbed = true, onEnded }: {
  value: string; kind: string; title: string; fileName?: string; canEmbed?: boolean; onEnded?: () => void;
}) {
  let url: URL;
  try { url = new URL(value, window.location.origin); } catch { return <p>Material link is unavailable.</p>; }
  if (!['https:', 'http:'].includes(url.protocol)) return <p>Material link is unavailable.</p>;
  const legacyId = url.pathname.match(/\/_legacy_files\/([0-9]{1,20})\//)?.[1];
  const fileUrl = legacyId ? `/learner_api/media/legacy-attachment/${legacyId}/` : url.href;
  const original = <a href={fileUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-primary-700 underline">Open material in a new tab</a>;
  if (!canEmbed) return <div className="rounded-xl border bg-background-100 p-4"><p className="mb-2 text-sm">Open this material in a new tab to view it.</p>{original}</div>;
  if (kind === 'pdf') return <section className="space-y-2"><Suspense fallback={<p role="status">Loading file preview…</p>}><AttachmentPreview url={fileUrl} title={title} fileName={fileName || 'document.pdf'} /></Suspense>{original}</section>;
  if (kind === 'video') return <section className="space-y-2"><div className="relative aspect-video overflow-hidden rounded-xl bg-black"><VideoPlayer parsed={legacyId ? { kind: 'file', src: fileUrl } : parseVideoUrl(url.href)} title={title} onEnded={onEnded} /></div>{original}</section>;
  if (kind === 'audio') {
    const drive = url.href.match(/drive\.google\.com\/(?:file\/d\/|(?:open|uc)\?[^#]*id=)([\w-]{10,})/);
    return <section className="space-y-2"><audio controls src={drive ? `/learner_api/media/google-drive/${drive[1]}/` : fileUrl} onEnded={onEnded} className="w-full" />{original}</section>;
  }
  if (legacyId || (url.origin === window.location.origin && /\.(docx|xlsx?|csv|txt|md|rtf|pdf|pptx|ppsx|pptm|ppsm)$/i.test(url.pathname))) return <section className="space-y-2"><Suspense fallback={<p role="status">Loading file preview…</p>}><AttachmentPreview url={url.href} title={title} /></Suspense>{original}</section>;
  let src = url.href;
  if (url.hostname === 'drive.google.com') src = src.replace(/\/view(?:\?.*)?$/, '/preview');
  else if (/\.(pdf|pptx|ppsx|pptm|docx?|xlsx?)$/i.test(url.pathname) || /docs\.google\.com/.test(url.hostname)) {
    const embed = resolveDocEmbed(url.href);
    if (embed.mode === 'deck') return <div className="space-y-2"><SlideDeckViewer src={embed.src} title={title} fallback={(reason) => <p>{reason}</p>} />{original}</div>;
    if (embed.mode === 'unavailable') return <div className="space-y-2"><p className="text-sm">{embed.reason}</p>{original}</div>;
    src = embed.src;
  }
  return <section className="space-y-2"><iframe title={title} src={src} className="h-[65vh] min-h-[320px] w-full rounded-xl border bg-white"
    sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads allow-presentation" allow="autoplay; fullscreen; picture-in-picture" allowFullScreen />{original}</section>;
}

export function StudentMaterial({ kind, learnerId, groupId, activityId, completed = false, onProgress }: {
  kind: string; learnerId: string; groupId: number; activityId: number; completed?: boolean;
  onProgress?: (result: SubjectAttemptResult) => void;
}) {
  const [data, setData] = useState<SubjectMaterial | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [confirmed, setConfirmed] = useState(false);
  const [result, setResult] = useState('');
  const [savedResult, setSavedResult] = useState<SubjectAttemptResult | null>(null);
  const completionHintId = useId();
  const base = `/learner_api/student-activity/${encodeURIComponent(kind)}/${encodeURIComponent(learnerId)}`;
  const attempts = `${base}/${groupId}/${activityId}/attempts/`;
  useEffect(() => {
    const controller = new AbortController();
    setData(null); setError(''); setAttemptId(null); setAnswers({}); setConfirmed(false); setResult(''); setSavedResult(null);
    void subjectRequest<SubjectMaterial>(`${base}/?group_id=${groupId}&activity_id=${activityId}`, { signal: controller.signal })
      .then((payload) => { if (!controller.signal.aborted) setData(payload); })
      .catch((failure: unknown) => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Could not load material.'); });
    return () => controller.abort();
  }, [base, groupId, activityId, retry]);
  const post = <T,>(url: string, body: unknown) => subjectRequest<T>(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': data?.csrf_token || '' }, body: JSON.stringify(body) });
  const start = async () => {
    if (!data || busy || !data.can_attempt || !data.persistence_ready || !data.available || !data.quiz?.ready) return;
    setBusy(true); setError(''); setResult('');
    try {
      const response = await post<{ attempt_id: string; definition: Partial<SubjectMaterial> }>(attempts, {});
      setData({ ...data, ...response.definition }); setAttemptId(response.attempt_id); setAnswers({});
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not start the attempt.'); }
    finally { setBusy(false); }
  };
  const submit = async () => {
    if (!data || busy || !data.can_attempt || !data.persistence_ready || !data.available) return;
    setBusy(true); setError('');
    try {
      let id = attemptId;
      if (!id && !data.quiz) {
        const response = await post<{ attempt_id: string }>(attempts, {});
        id = response.attempt_id; setAttemptId(id);
      }
      if (!id) throw new Error('Start the quiz before submitting.');
      const saved = await post<SubjectAttemptResult>(`${attempts}${id}/`, { answers, reading_confirmed: data.quiz ? confirmed : true });
      setResult(saved.score_percent == null ? 'Activity completed.' : `Attempt saved: ${Number(saved.score_percent).toFixed(0)}% · ${saved.passed ? 'Passed' : 'Not passed'}. Your highest score is kept.`);
      setSavedResult(saved);
      setAttemptId(null); setAnswers({});
      onProgress?.(saved);
      try {
        const latest = await subjectRequest<SubjectMaterial>(`${base}/?group_id=${groupId}&activity_id=${activityId}`);
        setData(latest);
      } catch {
        setError('Your attempt was saved, but its history could not be refreshed.');
      }
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not save your attempt.'); }
    finally { setBusy(false); }
  };
  if (!data && error) return <div role="alert" className="rounded-xl border border-red-200 p-4">{error} <button onClick={() => setRetry((v) => v + 1)} className="font-semibold underline">Try again</button></div>;
  if (!data) return <p role="status" className="p-5">Loading activity…</p>;
  const quiz = data.quiz;
  const isComplete = completed || data.completed || savedResult?.completed || data.history.some((attempt) => attempt.completed);
  const answered = quiz?.questions.every((question) => (answers[question.id]?.length || 0) > 0) ?? true;
  const needsConfirmation = !!quiz && data.has_reading;
  const blockedReason = !data.persistence_ready
    ? 'Saving progress is temporarily unavailable. Please contact your learning team.'
    : !data.available
      ? 'This activity has no available content to complete yet.'
      : quiz && !quiz.ready ? quiz.message : '';
  const actionsDisabled = busy || !data.can_attempt || !!blockedReason;
  const completionHint = blockedReason || (data.can_attempt
    ? quiz ? 'Complete the quiz and submit your answers. Passing records this activity as complete.' : isComplete ? 'This activity is complete and included in your progress.' : 'When you have finished, select Submit & complete to save your completion and update your progress.'
    : '');
  const actionClass = 'shrink-0 rounded-xl bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50';
  return <div className="space-y-6 rounded-2xl border border-foreground-200 bg-white p-4 sm:p-6">
    <section aria-label="Activity completion" className="sticky top-3 z-10 space-y-3 rounded-xl border border-primary-100 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h4 className="text-sm font-bold text-foreground-900">Activity progress</h4>
          <p aria-live="polite" className={`mt-1 text-sm font-semibold ${isComplete ? 'text-emerald-700' : 'text-foreground-500'}`}>{isComplete ? 'Complete' : 'Not complete'}</p>
        </div>
        {quiz && !attemptId ? <button type="button" onClick={start} disabled={actionsDisabled} aria-describedby={completionHint ? completionHintId : undefined} className={actionClass}>{busy ? 'Starting…' : isComplete || data.history.length || data.historical.attempt_number ? 'Try quiz again' : 'Start quiz'}</button>
          : (quiz || !isComplete) && <button type="button" onClick={submit} disabled={actionsDisabled || !answered || (needsConfirmation && !confirmed)} aria-describedby={completionHint ? completionHintId : undefined} className={actionClass}>{busy ? 'Saving…' : quiz ? 'Submit answers' : 'Submit & complete'}</button>}
      </div>
      {completionHint && <p id={completionHintId} className={`text-sm ${blockedReason ? 'text-amber-800' : 'text-foreground-500'}`}>{completionHint}</p>}
      {needsConfirmation && !!attemptId && <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} disabled={actionsDisabled} onChange={(event) => setConfirmed(event.target.checked)} className="mt-1 accent-primary-600" />I have completed the reading material.</label>}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {result && <p role="status" className={`rounded-xl p-3 text-sm font-semibold ${savedResult?.completed ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`}>{result}</p>}
    </section>
    {!data.available && <p>No material is available for this activity yet.</p>}
    {data.media.map((item, index) => <Media key={`${index}:${item.url}`} value={item.url} kind={item.kind} title={item.title} fileName={item.file_name} canEmbed={item.can_embed} onEnded={() => setConfirmed(true)} />)}
    {data.reading_html && <Html value={data.reading_html} />}
    {data.unavailable_attachments?.map((name, index) => <p key={index} className="text-sm text-amber-800">Attachment unavailable: {name}</p>)}
    {quiz && <section className="space-y-4" aria-label="Activity quiz">
      <div className="flex flex-wrap items-center justify-between gap-3"><h4 className="text-lg font-bold">Quiz · {quiz.questions.length} {quiz.questions.length === 1 ? 'question' : 'questions'}</h4>{quiz.passing_percent != null && <p className="text-sm text-foreground-500">Pass mark: {Number(quiz.passing_percent).toFixed(0)}%</p>}</div>
      {quiz.body && <Html value={quiz.body} />}
      {!quiz.ready && <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{quiz.message} Your previous results are kept.</p>}
      {quiz.questions.map((question, index) => <fieldset key={question.id} disabled={!attemptId || busy} className="space-y-3 rounded-xl border border-foreground-200 p-4">
        <legend className="px-2 text-sm font-bold">Question {index + 1}{question.type === 'multi_choice' ? ' · Select all that apply' : ''}</legend><Html value={question.text} />
        {question.options.map((option) => <label key={option.id} className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${answers[question.id]?.includes(option.id) ? 'border-primary-400 bg-primary-50' : 'border-foreground-200'}`}>
          <input type={question.type === 'multi_choice' ? 'checkbox' : 'radio'} name={`question-${question.id}`} value={option.id} checked={answers[question.id]?.includes(option.id) || false}
            onChange={(event) => setAnswers((previous) => ({ ...previous, [question.id]: question.type === 'multi_choice' ? event.target.checked ? [...(previous[question.id] || []), option.id] : (previous[question.id] || []).filter((value) => value !== option.id) : [option.id] }))} className="mt-1 shrink-0 accent-primary-600" /><Html value={option.text} />
        </label>)}
      </fieldset>)}
    </section>}
    {(data.historical.answers.length > 0 || data.historical.score != null || data.history.length > 0) && <section className="space-y-3 border-t pt-4" aria-label="Attempt history">
      <h4 className="font-bold">Your attempt history</h4>
      {(data.historical.answers.length > 0 || data.historical.score != null) && <details className="rounded-xl border p-3"><summary className="cursor-pointer text-sm font-semibold">Previous learning{data.historical.score != null ? ` · ${data.historical.score}${data.historical.maximum_score ? ` / ${data.historical.maximum_score}` : ''}` : ''}</summary>
        <div className="mt-3 space-y-4">{data.historical.answers.map((answer, index) => <div key={`${answer.question_id}:${index}`}><Html value={answer.question_body || `Question ${index + 1}`} /><p className="mt-1 text-sm text-foreground-600">Your answer: {Array.isArray(answer.learner_answer) ? answer.learner_answer.map(String).join(', ') : String(answer.learner_answer ?? 'Not recorded')}</p></div>)}</div>
      </details>}
      {data.history.map((attempt) => <details key={attempt.id} className="rounded-xl border p-3"><summary className="cursor-pointer text-sm">{new Date(attempt.submitted_at).toLocaleString('en-GB')} · {attempt.score_percent == null ? 'Activity completed' : `${Number(attempt.score_percent).toFixed(0)}% · ${attempt.passed ? 'Passed' : 'Not passed'}`}</summary>
        <div className="mt-3 space-y-3">{attempt.answer_review?.map((answer, index) => <div key={index}><Html value={answer.question} /><p className="text-sm">Your answer: {answer.selected.join(', ')} · {answer.correct ? 'Correct' : 'Incorrect'}</p></div>)}</div>
      </details>)}
    </section>}
  </div>;
}
