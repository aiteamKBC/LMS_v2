import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { LearnerKind } from '@/api/learnerDetail';
import { readMyLearningUpcoming, useMyLearningSearch, useMyLearningModule, type MyLearningCatalogue } from '@/api/myLearning';
import { fetchLearnerCertificateTemplate, type CertificateTemplateSummary } from '@/api/learnerCertificates';
import { SubjectCard, StudentActivityPanel, SubjectCardsSkeleton } from './SubjectWorkspace';
import { LearningCatalogue, type UpcomingLearningLink } from './LearningCatalogue';
import type { Subject, UnifiedLearningSummary } from './learningSummary';
import { recommendedLearningSubject } from './subjectLearning';
import { formatHoursMinutes } from '@/utils/learnerJourney';
import styles from './SubjectWorkspace.module.css';

const tones = ['purple', 'navy', 'green', 'gold', 'blue', 'rose'] as const;

export function CompactModules({ kind, id, catalogue: incomingCatalogue, loading, error, refresh, showReadOnlyNotice, view = 'catalogue' }: {
  kind?: LearnerKind; id?: string; catalogue: MyLearningCatalogue | null; loading: boolean; error: string;
  refresh: () => void; showReadOnlyNotice?: boolean; view?: 'catalogue' | 'map';
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const params = new URLSearchParams(location.search);
  const requested = params.get('subject') || params.get('module');
  const requestedActivity = params.get('activity');
  const requestedWeek = params.get('week');
  const selected = requested || (requestedActivity ? `activity:${requestedActivity}` : null);
  const module = useMyLearningModule(kind, id, selected);
  const [search, setSearch] = useState('');
  const activitySearch = useMyLearningSearch(kind,id,search,!selected && view === 'catalogue');
  const [upcomingState, setUpcomingState] = useState<{ catalogue: MyLearningCatalogue; links: UpcomingLearningLink[] } | null>(null);
  const [upcomingError, setUpcomingError] = useState('');
  const [upcomingLoading, setUpcomingLoading] = useState(false);
  const upcomingOwner = useRef(incomingCatalogue);
  useEffect(() => {
    upcomingOwner.current = incomingCatalogue;
    setUpcomingState(null); setUpcomingError(''); setUpcomingLoading(false);
  }, [incomingCatalogue]);
  const [progressOverrides, setProgressOverrides] = useState<Record<string, { total: number; completed: number }>>({});
  useEffect(() => { setProgressOverrides({}); }, [incomingCatalogue]);
  const catalogue = useMemo(() => {
    if (!incomingCatalogue || !Object.keys(progressOverrides).length) return incomingCatalogue;
    const modules = incomingCatalogue.modules.map(card => {
      const known = progressOverrides[card.id];
      if (!known || known.total !== card.activityCount) return card;
      const completed = Math.max(card.completedActivityCount, known.completed);
      return { ...card, completedActivityCount: completed, progress: known.total ? Math.round(completed / known.total * 10000) / 100 : 0,
        status: completed === known.total && known.total > 0 ? 'Completed' as const : completed > 0 ? 'In progress' as const : card.status };
    });
    const count = (source: Subject['source']) => {
      const rows = modules.filter(card => card.source === source);
      const total = rows.reduce((sum, card) => sum + card.activityCount, 0);
      const completed = rows.reduce((sum, card) => sum + card.completedActivityCount, 0);
      return { subjects: rows.length, total, completed, percent: total ? Math.round(completed / total * 10000) / 100 : 0 };
    };
    return { ...incomingCatalogue, modules, summary: { ...incomingCatalogue.summary, current: count('current'), previous: count('legacy') } };
  }, [incomingCatalogue, progressOverrides]);
  const [certificate, setCertificate] = useState<{ template: CertificateTemplateSummary | null; csrfToken: string }>({ template: null, csrfToken: '' });
  useEffect(() => {
    setCertificate({ template: null, csrfToken: '' });
    if (!kind || !id || selected || view !== 'catalogue') return;
    let disposed = false;
    void fetchLearnerCertificateTemplate(kind, id).then(value => {
      if (!disposed) setCertificate({ template: value.template, csrfToken: value.csrfToken || '' });
    }).catch(() => { /* Certificate configuration does not gate learning. */ });
    return () => { disposed = true; };
  }, [kind, id, selected, view]);
  const subjects = useMemo(() => catalogue?.modules.map(card => ({ ...card, moduleId: card.moduleId || (card.id.startsWith('current:') ? card.id.slice(8) : undefined), acceptedHours: card.actualHours ?? undefined, activities: [], card })) || [], [catalogue]);
  const summary: UnifiedLearningSummary = {
    subjects, subjectCount: catalogue?.summary.subjectCount || 0,
    activityCount: catalogue?.summary.current.total || 0,
    completedActivityCount: catalogue?.summary.current.completed || 0,
    percent: catalogue?.summary.current.percent || 0,
    previousLearning: catalogue ? { activityCount: catalogue.summary.previous.total,
      completedActivityCount: catalogue.summary.previous.completed, percent: catalogue.summary.previous.percent } : undefined,
  };
  const schedule = useMemo(() => ({ modules: catalogue?.modules.flatMap(card => card.planModule ? [{ ...card.planModule, id: card.moduleId || card.id.slice(8), title: card.title, description: '', coach_name: '' }] : []) || [],
    moduleLinks: {}, generatedAt: '' }), [catalogue]);
  const current = recommendedLearningSubject(subjects, catalogue?.learner ?? null, undefined, schedule);
  const open = (subject: Subject, continuing = false) => {
    const next = new URLSearchParams(location.search);
    next.delete('activity'); next.delete('module'); next.delete('week'); next.set('subject', subject.id);
    if (continuing) next.set('week', 'current');
    navigate({ pathname: location.pathname, search: next.toString() });
  };
  useEffect(() => {
    if ((view !== 'map' && requestedWeek !== 'current') || selected || !current) return;
    const next = new URLSearchParams(location.search);
    next.set('subject', current.id);
    navigate({ pathname: location.pathname, search: next.toString() }, { replace: true });
  }, [view, requestedWeek, selected, current, location.pathname, location.search, navigate]);
  const subjectTones = new Map([...subjects].sort((a,b) => a.id.localeCompare(b.id, undefined, { numeric: true }))
    .map((subject,index) => [subject.id, tones[index % tones.length]]));
  if (selected) {
    if (!module.data && !module.error) return <SubjectCardsSkeleton />;
    if (!module.data) return <div role={module.error ? 'alert' : 'status'} className="rounded-2xl border bg-white p-6">
      {module.error || 'Loading subjects'}{module.error && <button onClick={module.refresh}>Try again</button>}</div>;
    return <StudentActivityPanel kind={kind} learnerId={id} real={module.data.detail} data={module.data.activity}
      resolvedMetadata={module.data.metadata} catalogueSubjects={subjects} loading={module.loading} error={module.error || null}
      onRetry={module.refresh} onProgress={changes => {
        if (changes) setProgressOverrides(previous => ({ ...previous, ...Object.fromEntries(changes.map(change => [change.id, change])) }));
        module.refresh(); refresh();
      }} view={view}
      schedule={{ ...module.data.schedule, modules: [...schedule.modules.filter(card => !module.data!.schedule.modules.some(item => item.id === card.id)), ...module.data.schedule.modules] }} upcomingSessions={module.data.sessions} />;
  }
  if (!catalogue && !error) return <SubjectCardsSkeleton />;
  if (!catalogue) return <div role={error ? 'alert' : 'status'} className="rounded-2xl border bg-white p-6">
    {error || 'Loading subjects'}{error && <button onClick={refresh}>Try again</button>}</div>;
  return <section aria-label="Your subjects" aria-busy={loading} className={`${styles.workspace} space-y-5`}>
    {showReadOnlyNotice && <div className="flex items-start gap-2.5 rounded-xl border border-primary-200/70 bg-primary-50/60 px-3.5 py-2.5">
      <AppIcon className="ri-eye-line mt-0.5 shrink-0 text-[15px] text-primary-600" />
      <p className="text-[12px] leading-snug text-foreground-600"><span className="font-semibold text-foreground-800">Viewing read-only.</span>{' '}
        The learner or an administrator can complete activities, upload evidence or submit reflections.</p>
    </div>}
    {error && <p role="alert">{error} <button onClick={refresh}>Try again</button></p>}
    {activitySearch.error && <p role="alert">{activitySearch.error} <button onClick={activitySearch.retry}>Try again</button></p>}
    {activitySearch.loading && search.trim() && <p role="status">Searching activities…</p>}
    {upcomingError && <p role="alert">{upcomingError}</p>}
    {upcomingLoading && <p role="status">Loading upcoming learning…</p>}
    <p className="text-sm text-foreground-500">{catalogue.learner.name}</p>
    <LearningCatalogue summary={summary} search={search} onSearch={setSearch} current={current}
      total={summary.activityCount} done={summary.completedActivityCount} percent={summary.percent}
      kind={kind} learnerId={id} activityMatches={activitySearch.ids}
      upcomingLinks={upcomingState?.catalogue === incomingCatalogue ? upcomingState.links : catalogue.upcoming}
      hasMoreUpcoming={catalogue.hasMoreUpcoming} onLoadUpcoming={() => {
        if (!kind || !id || !incomingCatalogue || upcomingLoading) return;
        setUpcomingLoading(true); setUpcomingError('');
        void readMyLearningUpcoming(kind,id).then(result => {
          if (upcomingOwner.current === incomingCatalogue) setUpcomingState({ catalogue: incomingCatalogue, links: result.upcoming });
        }).catch(() => {
          if (upcomingOwner.current === incomingCatalogue) setUpcomingError('Could not load upcoming learning. Close and reopen View all to try again.');
        }).finally(() => {
          if (upcomingOwner.current === incomingCatalogue) setUpcomingLoading(false);
        });
      }}
      covers={Object.fromEntries(catalogue.modules.flatMap(card => card.cover ? [[card.id, card.cover]] : []))}
      moduleStartDate={subject => catalogue.modules.find(card => card.id === subject.id)?.planModule?.start_date}
      onContinue={subject => open(subject, true)} renderCard={subject => {
        const card = catalogue.modules.find(item => item.id === subject.id)!;
        return <SubjectCard key={subject.id} subject={subject} cover={card.cover || undefined}
          tone={subjectTones.get(subject.id)} onOpen={() => open(subject)} template={certificate.template}
          csrfToken={certificate.csrfToken} kind={kind} learnerId={id} planModule={schedule.modules.find(item => item.id === subject.moduleId)}
          moduleProgress={card.actualHours == null ? undefined : { hours: { actual: card.actualHours } }} />;
      }} />
    <div className="flex flex-wrap gap-6 rounded-xl bg-background-100 px-4 py-3 text-xs">
      <div><span className="block text-foreground-500">Recorded OTJH</span><strong>{catalogue.otjh.actual == null ? 'Unavailable' : formatHoursMinutes(catalogue.otjh.actual)}</strong></div>
      <div><span className="block text-foreground-500">Planned OTJH</span><strong>{catalogue.otjh.planned == null ? 'Unavailable' : formatHoursMinutes(catalogue.otjh.planned)}</strong></div>
    </div>
    <p className="text-[12px] text-foreground-500">Programme totals include accepted historical hours and new recorded learning. Planned hours come from your training plan.</p>
  </section>;
}
