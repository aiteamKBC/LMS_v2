import { useEffect, useMemo, useState } from 'react';
import DOMPurify from 'dompurify';
import type { SubjectMaterial } from '@/api/studentActivity';
import {
  advancedAdminComponentQuizReview, advancedAdminLegacyQuizReview, advancedAdminMaterial,
  type AdvancedAdminQuizReview,
} from '@/api/advancedAdmin';
import { normalizeReadingHtml } from '@/lib/readingHtml';
import { SkeletonBlock } from '@/components/feature/Skeletons';
import { Media } from '@/pages/learner/my-learning/StudentMaterial';

function ActivityContentSkeleton() {
  return <section role="status" aria-busy="true" aria-label="Loading activity content"
    className="space-y-4 rounded-xl border border-foreground-200 bg-background-50 p-4">
    <span className="sr-only">Preparing activity content...</span>
    <div className="flex items-center justify-between gap-4">
      <div className="w-full max-w-md space-y-2">
        <SkeletonBlock className="h-4 w-2/5 min-w-32" />
        <SkeletonBlock className="h-3 w-3/5 min-w-48" />
      </div>
      <SkeletonBlock className="h-9 w-24 shrink-0 rounded-xl" />
    </div>
    <SkeletonBlock className="h-[65vh] min-h-[320px] w-full rounded-xl" />
    <div className="space-y-2">
      <SkeletonBlock className="h-3 w-1/3" />
      <SkeletonBlock className="h-3 w-2/3" />
    </div>
  </section>;
}

function AdminPdfPreview({ url, title }: { url: string; title: string }) {
  const [preview, setPreview] = useState<{ src?: string; error?: string }>({});
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl = '';
    setPreview({});
    void fetch(url, { credentials: 'same-origin', signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error(`File request failed (${response.status}).`);
        if (response.headers.get('Content-Type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/pdf') {
          throw new Error('The file response is not a PDF.');
        }
        const file = await response.blob();
        if (!file.size) throw new Error('The PDF file is empty.');
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(file);
        setPreview({ src: objectUrl });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setPreview({ error: error instanceof Error ? error.message : 'Could not load the PDF.' });
        }
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);
  if (preview.error) return <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
    Could not show this PDF inline. {preview.error}
  </p>;
  if (!preview.src) return <div role="status" className="flex h-[65vh] min-h-[320px] items-center justify-center rounded-xl border bg-white text-sm">
    Loading PDF preview…
  </div>;
  return <iframe title={title} src={preview.src} className="h-[65vh] min-h-[320px] w-full rounded-xl border bg-white" />;
}

function inferredMediaKind(item: SubjectMaterial['media'][number], url: URL): string {
  const path = `${url.pathname} ${item.file_name || ''}`.toLowerCase();
  if (/\.(mp4|webm|mov|m4v|ogv)(?:\s|$)/.test(path)) return 'video';
  if (/\.(mp3|wav|m4a|aac|ogg|oga|flac)(?:\s|$)/.test(path)) return 'audio';
  if (/\.pdf(?:\s|$)/.test(path)) return 'pdf';
  return item.kind;
}

function AdminMedia({ item }: { item: SubjectMaterial['media'][number] }) {
  let url: URL;
  try { url = new URL(item.url, window.location.origin); } catch {
    return <Media value={item.url} kind={item.kind} title={item.title} fileName={item.file_name} canEmbed={item.can_embed} />;
  }
  const kind = inferredMediaKind(item, url);
  if (kind === 'pdf' && item.can_embed !== false && url.origin === window.location.origin
      && /^\/login_api\/advanced-admin\/learners\/\d+\/learning\/material\/\d+\/\d+\/(?:files\/\d+|source-file|media\/\d+)\/$/.test(url.pathname)) {
    return <section className="space-y-2">
      <AdminPdfPreview url={url.href} title={item.title} />
      <a href={url.href} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-primary-700 underline">Open material in a new tab</a>
    </section>;
  }
  const scopedMedia = url.origin === window.location.origin
    && /^\/login_api\/advanced-admin\/learners\/\d+\/learning\/material\/\d+\/\d+\/media\/\d+\/$/.test(url.pathname);
  if (kind === 'video' && item.can_embed !== false && scopedMedia) {
    return <section className="space-y-2">
      <video src={url.href} controls preload="metadata" className="aspect-video w-full rounded-xl bg-black" aria-label={item.title} />
      <a href={url.href} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-primary-700 underline">Open material in a new tab</a>
    </section>;
  }
  if (kind === 'audio' && item.can_embed !== false && scopedMedia) {
    return <section className="space-y-2">
      <audio src={url.href} controls preload="metadata" className="w-full" aria-label={item.title} />
      <a href={url.href} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-primary-700 underline">Open material in a new tab</a>
    </section>;
  }
  if (kind === 'audio' && item.can_embed !== false && url.protocol === 'https:'
      && (url.hostname === 'kentbusinesscollege.org' || url.hostname.endsWith('.kentbusinesscollege.org'))
      && /^\/wp-json\/kbc-lms\/v1\/material\/\d+\/view\/?$/.test(url.pathname)) {
    return <section className="space-y-2">
      <iframe title={item.title} src={url.href} className="h-32 w-full rounded-xl border bg-white"
        sandbox="allow-scripts allow-same-origin" allow="autoplay" referrerPolicy="no-referrer" />
      <a href={url.href} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-primary-700 underline">Open material in a new tab</a>
    </section>;
  }
  if (item.can_embed !== false && (kind === 'video' || kind === 'embed')
      && (url.origin === 'https://www.youtube.com' || url.origin === 'https://youtube.com')
      && url.pathname === '/playlist') {
    const playlistId = url.searchParams.get('list') || '';
    if (/^[A-Za-z0-9_-]{6,}$/.test(playlistId)) {
      const embed = new URL('https://www.youtube.com/embed');
      embed.searchParams.set('listType', 'playlist');
      embed.searchParams.set('list', playlistId);
      return <section className="space-y-2">
        <iframe title={item.title} src={embed.href} className="h-[65vh] min-h-[320px] w-full rounded-xl border bg-white"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-presentation"
          allow="autoplay; fullscreen; picture-in-picture" allowFullScreen referrerPolicy="no-referrer" />
        <a href={url.href} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-primary-700 underline">Open material in a new tab</a>
      </section>;
    }
  }
  if (item.can_embed !== false && kind === 'document' && url.protocol === 'https:'
      && url.hostname === 'view.officeapps.live.com' && url.pathname === '/op/embed.aspx'
      && url.searchParams.has('src')) {
    return <section className="space-y-2">
      <iframe title={item.title} src={url.href} className="h-[65vh] min-h-[320px] w-full rounded-xl border bg-white"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads allow-presentation"
        allow="autoplay; fullscreen; picture-in-picture" allowFullScreen referrerPolicy="no-referrer" />
      <a href={url.href} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-primary-700 underline">Open material in a new tab</a>
    </section>;
  }
  return <Media value={item.url} kind={kind} title={item.title} fileName={item.file_name} canEmbed={item.can_embed} />;
}

export function RichContent({ value }: { value: string }) {
  const { html, frames } = useMemo(() => {
    const normalized = normalizeReadingHtml(value);
    const document = new DOMParser().parseFromString(normalized, 'text/html');
    const frames = [...document.querySelectorAll('iframe')]
      .map(frame => frame.getAttribute('src') || '').filter(url => /^https?:\/\//i.test(url));
    const html = DOMPurify.sanitize(normalized, { FORBID_TAGS: ['form', 'iframe'], FORBID_ATTR: ['srcdoc'] });
    return { html, frames };
  }, [value]);
  return <div className="space-y-4">
    {html && <div className="prose max-w-none break-words" dangerouslySetInnerHTML={{ __html: html }} />}
    {frames.map((url, index) => <AdminMedia key={`${index}:${url}`} item={{ url, kind: 'document', title: `Embedded content ${index + 1}` }} />)}
  </div>;
}

function savedAnswer(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  return value == null ? [] : [String(value)];
}

function answerText(value: string): string {
  return new DOMParser().parseFromString(value, 'text/html').body.textContent?.replace(/\s+/g, ' ').trim() || '';
}

function publicQuiz(material: SubjectMaterial | null): AdvancedAdminQuizReview | null {
  if (!material?.quiz) return null;
  const selected = new Map(material.historical.answers.map(answer => [String(answer.question_id), savedAnswer(answer.learner_answer)]));
  const latest = material.history[0];
  return {
    body: material.quiz.body,
    questions: material.quiz.questions.map(question => ({
      id: question.id, text: question.text, options: question.options.map(option => option.text),
      correctAnswers: [], learnerAnswers: latest?.answer_review?.find(answer => answerText(answer.question) === answerText(question.text))?.selected
        || selected.get(question.id) || [],
    })),
  };
}

function QuizReview({ quiz }: { quiz: AdvancedAdminQuizReview }) {
  return <section aria-label="Quiz review" className="space-y-4 rounded-xl border border-primary-200 bg-primary-50/40 p-4">
    <h4 className="font-semibold text-foreground-900">Quiz questions and answers</h4>
    {quiz.body && <RichContent value={quiz.body} />}
    {quiz.questions.map((question, index) => <div key={`${question.id}:${index}`} className="rounded-lg border border-foreground-200 bg-white p-4">
      <h5 className="font-semibold">Question {index + 1}</h5>
      <RichContent value={question.text} />
      {question.options.length > 0 && <ul className="mt-3 space-y-2">{question.options.map((option, position) => <li key={`${position}:${option}`}
        className={`rounded-lg border p-2 text-sm ${question.correctAnswers.some(answer => answerText(answer) === answerText(option)) ? 'border-emerald-300 bg-emerald-50' : 'border-foreground-200'}`}>
        <RichContent value={option} />
        <div className="mt-1 flex gap-2 text-xs font-semibold">
          {question.correctAnswers.some(answer => answerText(answer) === answerText(option)) && <span className="text-emerald-800">Correct answer</span>}
          {question.learnerAnswers.some(answer => answerText(answer) === answerText(option)) && <span className="text-primary-700">Learner selected</span>}
        </div>
      </li>)}</ul>}
      {question.learnerAnswers.length > 0 && <div className="mt-3 text-sm"><strong>Learner's recorded answer:</strong>
        <ul className="mt-1 list-inside list-disc">{question.learnerAnswers.map((answer, position) =>
          <li key={`${position}:${answer}`}><RichContent value={answer} /></li>)}</ul></div>}
      {question.correctAnswers.length === 0 && <p className="mt-2 text-xs text-amber-800">Correct answer is unavailable in the saved source.</p>}
      {question.learnerAnswers.length === 0 && <p className="mt-1 text-xs text-foreground-500">No learner answer recorded.</p>}
    </div>)}
    {quiz.questions.length === 0 && <p className="text-sm text-foreground-500">No saved questions are available for this quiz.</p>}
  </section>;
}

export function AdminLegacyActivityContent({ learnerId, groupId, activityId, kind, completed }: {
  learnerId: number; groupId: number; activityId: number; kind: 'material' | 'quiz'; completed: boolean;
}) {
  const [material, setMaterial] = useState<SubjectMaterial | null>(null);
  const [quiz, setQuiz] = useState<AdvancedAdminQuizReview | null>(null);
  const [materialLoading, setMaterialLoading] = useState(kind === 'material');
  const [quizLoading, setQuizLoading] = useState(kind === 'quiz');
  const [materialError, setMaterialError] = useState('');
  const [quizError, setQuizError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setMaterial(null); setQuiz(null); setMaterialError(''); setQuizError('');
    setMaterialLoading(kind === 'material'); setQuizLoading(kind === 'quiz');
    const loadQuiz = () => {
      setQuizLoading(true);
      advancedAdminLegacyQuizReview(learnerId, kind, groupId, activityId, controller.signal)
        .then(value => { if (!controller.signal.aborted) setQuiz(value.quiz); })
        .catch(error => { if (!controller.signal.aborted) setQuizError(error instanceof Error ? error.message : 'Quiz review is unavailable.'); })
        .finally(() => { if (!controller.signal.aborted) setQuizLoading(false); });
    };
    if (kind === 'material') {
      advancedAdminMaterial(learnerId, groupId, activityId, controller.signal)
        .then(value => {
          if (controller.signal.aborted) return;
          setMaterial(value);
          if (value.has_quiz_review !== false) loadQuiz();
        })
        .catch(error => {
          if (controller.signal.aborted) return;
          setMaterialError(error instanceof Error ? error.message : 'Activity material is unavailable.');
          loadQuiz();
        })
        .finally(() => { if (!controller.signal.aborted) setMaterialLoading(false); });
    } else loadQuiz();
    return () => controller.abort();
  }, [learnerId, groupId, activityId, kind]);

  const visibleQuiz = quiz || publicQuiz(material);
  const hasMaterial = Boolean(material?.media.length || material?.reading_html || material?.unavailable_attachments?.length);
  return <div className="space-y-5 rounded-2xl border border-foreground-200 bg-white p-5">
    <div className="rounded-xl border border-primary-100 bg-primary-50 p-4"><h4 className="font-semibold">Activity progress</h4>
      <p className={`mt-1 text-sm font-semibold ${completed ? 'text-emerald-700' : 'text-foreground-600'}`}>{completed ? 'Complete' : 'Not complete'}</p></div>
    {(materialLoading || quizLoading) && <ActivityContentSkeleton />}
    {materialError && <p role="alert" className="text-sm text-amber-800">{materialError}</p>}
    {quizError && <p role="alert" className="text-sm text-amber-800">{quizError}</p>}
    {material?.media.map((item, index) => <AdminMedia key={`${index}:${item.url}`} item={item} />)}
    {material?.reading_html && <RichContent value={material.reading_html} />}
    {material?.unavailable_attachments?.map((name, index) => <p key={`${index}:${name}`} className="text-sm text-amber-800">Attachment unavailable: {name}</p>)}
    {visibleQuiz && <QuizReview quiz={visibleQuiz} />}
    {!materialLoading && !quizLoading && !hasMaterial && !visibleQuiz && !materialError && !quizError &&
      <p className="text-sm text-foreground-500">No viewable content is saved for this activity.</p>}
  </div>;
}

export function AdminNativeQuizReview({ learnerId, componentId }: { learnerId: number; componentId: string }) {
  const [quiz, setQuiz] = useState<AdvancedAdminQuizReview | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setQuiz(null); setError('');
    advancedAdminComponentQuizReview(learnerId, componentId, controller.signal)
      .then(value => { if (!controller.signal.aborted) setQuiz(value.quiz); })
      .catch(failure => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Quiz review is unavailable.'); });
    return () => controller.abort();
  }, [learnerId, componentId]);
  if (error) return <p role="alert" className="text-sm text-amber-800">{error}</p>;
  if (!quiz) return <p role="status" className="text-sm">Preparing quiz review...</p>;
  return <QuizReview quiz={quiz} />;
}
