import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import type { DashboardTabsProps } from '../DashboardTabs';
import { dashboardTraining, timelineModuleForDisplay, peekTrainingModule, readTrainingModule, type TrainingModule } from '@/api/dashboardTraining';
import type { TrainingPlanDashboard } from '@/api/trainingPlanDashboard';
import { subscribeLearnerReadInvalidation } from '@/api/learnerRead';
import { useLiveLearnerRead } from '@/hooks/useLiveLearnerRead';
import { ModuleTimeline } from '@/pages/learner/training-plan-timeline/ModuleTimeline';
import { ModuleOverview } from '@/pages/learner/training-plan-timeline/ModuleOverview';
import { dateKey } from '@/pages/learner/training-plan-timeline/model';
import styles from '@/pages/learner/training-plan-timeline/trainingPlan.module.css';
import layout from '@/pages/learner/training-plan-timeline/TrainingPlanDetails.module.css';

function TrainingPlanContent({ kind, learnerId, programmeStartDate, programmeEndDate }: DashboardTabsProps) {
  const [params] = useSearchParams();
  const { hash } = useLocation();
  const subject = params.get('subject') || '';
  const monthParam = params.get('month') || '';
  const requestedMonth = /^\d{4}-(0[1-9]|1[0-2])$/.test(monthParam) ? monthParam : '';
  const displayStart = dateKey(programmeStartDate);
  const displayEnd = dateKey(programmeEndDate);
  const initialReader = useMemo(() => (requestedKind: typeof kind, id: string, signal?: AbortSignal, fresh = false) => dashboardTraining.read(requestedKind, id, signal, fresh, subject, requestedMonth, displayStart, displayEnd), [subject, requestedMonth, displayStart, displayEnd]);
  const read = useLiveLearnerRead(kind, learnerId, true, initialReader, dashboardTraining.peek);
  const payload = read.data;
  const identity = `${kind}:${learnerId}:${subject}:${requestedMonth}`;
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(timer); }, []);
  const today = new Date(now).toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  const minMonth = displayStart.slice(0, 7) || payload?.timeline.start || '';
  const maxMonth = [payload?.timeline.end || '', displayEnd.slice(0, 7)].sort().at(-1) || '';
  const clamp = (month: string) => minMonth && month < minMonth ? minMonth : maxMonth && month > maxMonth ? maxMonth : month;
  const [selection, setSelection] = useState({ identity, id: subject, month: requestedMonth });
  const currentSelection = selection.identity === identity ? selection : { identity, id: subject, month: requestedMonth };
  const selectedMonth = currentSelection.month || clamp(today.slice(0, 7));
  const validRequestedId = payload?.timeline.modules.some(module => module.id === currentSelection.id) ? currentSelection.id : '';
  const selectedId = validRequestedId || (currentSelection.month || currentSelection.id
    ? payload?.timeline.modules.find(module => module.start && module.start.slice(0, 7) <= selectedMonth && module.end.slice(0, 7) >= selectedMonth)?.id
    : payload?.selectedModuleId) || '';
  const [revision, setRevision] = useState(0);
  const [detailState, setDetailState] = useState<{ identity: string; id: string; module?: TrainingModule; error?: string }>();
  const handledRevision = useRef(0);
  const retryDetail = () => setRevision(value => value + 1);
  useEffect(() => subscribeLearnerReadInvalidation(() => setRevision(value => value + 1)), []);
  useEffect(() => {
    if (!payload || !selectedId) return;
    const controller = new AbortController();
    setDetailState({ identity, id: selectedId });
    const fresh = handledRevision.current !== revision;
    handledRevision.current = revision;
    void readTrainingModule(kind, learnerId, selectedId, controller.signal, fresh).then(module => {
      if (!controller.signal.aborted) setDetailState({ identity, id: selectedId, module });
    }, reason => {
      if (!controller.signal.aborted) setDetailState({ identity, id: selectedId, error: reason instanceof Error ? reason.message : 'Could not load module details.' });
    });
    return () => controller.abort();
  }, [payload, selectedId, identity, kind, learnerId, revision]);
  const state = detailState?.identity === identity && detailState.id === selectedId ? detailState : undefined;
  const detail = state?.module || (selectedId ? peekTrainingModule(kind, learnerId, selectedId) : undefined);
  const detailError = state?.error;
  const detailLoading = !!selectedId && !detail && !detailError;
  const modules = useMemo(() => (payload?.timeline.modules || []).map(module => module.id === detail?.id ? detail : timelineModuleForDisplay(module)), [payload, detail]);
  const timelineData: TrainingPlanDashboard = {
    months: Object.fromEntries(Object.entries<{ topics: string[] }>(payload?.timeline.months || {}).map(([key, month]) => [key, { label: '', topics: month.topics, planned: null, source: 'training' }])),
    actual: [], actualAvailable: false, modules: [], moduleLinks: {}, sessions: [], reviews: payload?.timeline.reviews || [],
    coach: { name: payload?.timeline.coachName || '', bookingUrl: null }, contractStatus: 'ready', generatedAt: '',
  };
  // Range months replace the legacy all-month ledgers used only to choose year controls.
  for (const month of [minMonth, maxMonth]) if (month && !timelineData.months[month]) timelineData.months[month] = { label: '', topics: [], planned: null, source: 'training' };
  const root = useRef<HTMLDivElement>(null);
  const scrolled = useRef('');
  useEffect(() => {
    const destination = `${identity}:${subject}:${requestedMonth}:${hash}`;
    if (!payload || (!subject && hash !== '#module-timeline') || scrolled.current === destination) return;
    scrolled.current = destination;
    (hash === '#module-timeline' ? root.current?.querySelector('#module-timeline') : root.current)?.scrollIntoView({ block: 'start' });
  }, [payload, identity, subject, requestedMonth, hash]);
  const changeMonth = (month: string) => setSelection({ identity, id: '', month: clamp(month) });
  return <div ref={root} className={`${styles.root} ${layout.root}`}>
    {read.error && <div role="alert" className={layout.error}>{read.error} <button type="button" onClick={read.refresh}>Retry training plan</button></div>}
    {!payload && read.loading && <div role="status" aria-label="Loading monthly learning and coaching" className={layout.loading}><div aria-hidden="true"><span /><span /><span /></div></div>}
    {payload && <section id="training-plan-details" aria-label="Monthly learning and coaching">
      <div className={layout.toolbar}><div className={layout.title}><h2>Your training plan</h2></div></div>
      <div className={`${layout.cards} ${layout.trainingCards}`}>
        <div className={layout.learningVisuals}><ModuleTimeline key={identity} data={timelineData} modules={modules} kind={kind} learnerId={learnerId} today={today}
          programmeStartDate={programmeStartDate || payload.timeline.programmeStartDate} detailsMode="overview" selectedMonth={selectedMonth} selectedId={selectedId}
          onMonthChange={changeMonth} onModuleSelect={module => setSelection({ identity, id: module.id, month: selectedMonth })}
          detailLoading={detailLoading} detailError={detailError} onRetryDetail={retryDetail} /></div>
        {detailLoading ? <section className={`${styles.panel} ${layout.overview}`} aria-label="Module overview"><p role="status">Loading module details?</p></section>
          : detailError ? <section className={`${styles.panel} ${layout.overview}`} aria-label="Module overview"><p role="alert">{detailError} <button type="button" onClick={retryDetail}>Retry module details</button></p></section>
          : <ModuleOverview module={detail} hasModules={modules.length > 0} coachName={timelineData.coach.name} href={detail ? `/learner/modules/${kind}/${learnerId}?subject=${encodeURIComponent(detail.id)}` : ''} canOpenActivities showSchedule={false} />}
      </div>
    </section>}
  </div>;
}

export default function DashboardTrainingTab(props: DashboardTabsProps) {
  const [params] = useSearchParams();
  return <TrainingPlanContent key={`${props.kind}:${props.learnerId}:${params.get('subject') || ''}:${params.get('month') || ''}`} {...props} />;
}
