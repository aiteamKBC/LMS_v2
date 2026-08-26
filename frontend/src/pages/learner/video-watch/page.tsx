import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { EmptyState } from '@/pages/users/components/ui';
import { fetchLearnerDetail, type LearnerDetail, type LearnerKind, type LearnerKsbItem } from '@/api/learnerDetail';
import { submitVideoProgress } from '@/api/videos';
import { submitComponentProgress } from '@/api/components';
import { AssignmentEvidence } from '@/components/feature/AssignmentEvidence';
import {
  buildLearnerJourney, componentTypeMeta, componentContentKind, componentNoun, isOpenableComponent, gradePercent, formatHoursMinutes,
  componentCriteria, componentRequiresEvidence,
  type JourneyComponent,
} from '@/utils/learnerJourney';
import { fetchEvidence } from '@/api/evidence';
import { ReflectionWindow, formatClock } from '@/components/feature/ReflectionWindow';
import { VideoPlayer, parseVideoUrl } from '@/components/feature/VideoPlayer';
import { rememberLearner } from '@/hooks/useMyLearner';
import { useLearnerWorkspaceAccess } from '@/hooks/useLearnerWorkspaceAccess';
import { ReadOnlyLearnerNotice } from '@/components/feature/ReadOnlyLearnerNotice';
import { RowsSkeleton } from '@/components/feature/Skeletons';
import { resolveDocEmbed } from '@/lib/docEmbed';
import { SlideDeckViewer } from '@/components/feature/SlideDeckViewer';
import {
  loadTeamsMeetingArtifacts,
  syncTeamsMeetingArtifacts,
  teamsMeetingArtifactContentUrl,
  type TeamsMeetingArtifactsResult,
} from '@/pages/curriculum/module-builder/moduleAuthoringData';

const learnerNav = roleNavMap.learner;

type Phase = 'consume' | 'reflect' | 'results';

/** Normalised completion record for the results screen (video + component share these). */
interface DoneRecord { timeTaken: string | null; ksbs: string[]; reportedTime: string; feedback: string }

interface FoundContext {
  component: JourneyComponent;
  moduleTitle: string;
  weekTitle: string;
  weekComponents: JourneyComponent[];
  weeks: { week: string; count: number; active: boolean }[];
}

/** Route a component to the right learner page (video and quiz keep their own routes). */
function componentRoute(kind: string | undefined, id: string | undefined, c: JourneyComponent, module: string, week: string): string {
  if (c.isQuiz && c.quizMeta?.quizId != null) {
    return `/learner/quiz/${kind}/${id}/${c.quizMeta.quizId}?module=${encodeURIComponent(module)}&week=${encodeURIComponent(week)}`;
  }
  const base = (c.type || '').toLowerCase() === 'video' ? 'video' : 'component';
  return `/learner/${base}/${kind}/${id}/${c.componentId}?module=${encodeURIComponent(module)}&week=${encodeURIComponent(week)}`;
}

/** Can this sidebar row be clicked (a quiz, or any other openable component)? */
function isNavigableComponent(c: JourneyComponent): boolean {
  return (c.isQuiz && c.quizMeta?.quizId != null) || isOpenableComponent(c);
}

/** Find the target component + its week/module context inside the built journey. */
function locate(detail: LearnerDetail | null, componentId: string): FoundContext | null {
  if (!detail) return null;
  const journey = buildLearnerJourney(detail);
  for (const mod of journey) {
    for (const wk of mod.weeks) {
      const target = wk.components.find((c) => c.componentId === componentId);
      if (target) {
        return {
          component: target,
          moduleTitle: mod.module,
          weekTitle: wk.week,
          weekComponents: wk.components,
          weeks: mod.weeks.map((w) => ({ week: w.week, count: w.components.length, active: w.week === wk.week })),
        };
      }
    }
  }
  return null;
}

export default function ComponentViewPage() {
  const { kind, id, componentId } = useParams<{ kind: string; id: string; componentId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  useEffect(() => { rememberLearner(kind, id); }, [kind, id]);
  // Reachable by URL even now the plan rows are inert for a staff viewer.
  // Completing the component here would be recorded as the learner's own work.
  const { canProgress } = useLearnerWorkspaceAccess(id);

  const [detail, setDetail] = useState<LearnerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [phase, setPhase] = useState<Phase>('consume');
  const [startedAt, setStartedAt] = useState<string | null>(null);
  // Real playback state (video only), driven by the player.
  const [realDuration, setRealDuration] = useState<number | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [unsupported, setUnsupported] = useState(false); // no player progress events → wall-clock
  const [wallElapsed, setWallElapsed] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [record, setRecord] = useState<DoneRecord | null>(null);
  // Bumped by the uploader so the criteria panel re-checks after an upload.
  const [evidenceVersion, setEvidenceVersion] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if ((kind !== 'commercial' && kind !== 'apprenticeship') || !id) {
      setLoadError('Unknown learner.');
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    fetchLearnerDetail(kind as LearnerKind, id)
      .then((d) => { if (!cancelled) setDetail(d); })
      .catch((e) => { if (!cancelled) setLoadError(e instanceof Error ? e.message : 'Could not load component'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [kind, id]);

  const ctx = useMemo(() => (componentId ? locate(detail, componentId) : null), [detail, componentId]);
  const component = ctx?.component ?? null;
  const meta = component ? componentTypeMeta(component.title) : null;
  const learnerKsbs: LearnerKsbItem[] = detail?.ksbs ?? [];

  const contentKind = componentContentKind(component?.type);
  const isVideo = contentKind === 'video';
  const noun = componentNoun(component?.type);
  const openable = component ? isOpenableComponent(component) : false;

  // Approved evidence uploaded for this component. Owned here (not inside the
  // uploader) because the completion gate depends on it.
  const [evidenceCount, setEvidenceCount] = useState(0);
  const needsEvidence = componentRequiresEvidence(component?.type);
  useEffect(() => {
    // Only assignments collect evidence — nothing to look up elsewhere.
    if (!needsEvidence || !kind || !id || !componentId) return;
    let cancelled = false;
    fetchEvidence(kind as LearnerKind, id, { sectionRef: componentId })
      .then((rows) => {
        if (!cancelled) setEvidenceCount(rows.filter((r) => r.status === 'approved').length);
      })
      .catch(() => { /* the criteria panel just shows 0; the server re-checks on submit */ });
    return () => { cancelled = true; };
  }, [needsEvidence, kind, id, componentId, evidenceVersion]);

  const criteria = component ? componentCriteria(component, evidenceCount) : null;

  const moduleTitle = ctx?.moduleTitle ?? searchParams.get('module') ?? '';
  const weekTitle = ctx?.weekTitle ?? searchParams.get('week') ?? '';
  const backHref = kind && id ? `/learner/training-plan/${kind}/${id}` : '/learner/training-plan';

  // A quiz component has nowhere to show its questions — the quiz page owns
  // that. Reaching this page for one (a direct link, a bookmark, the sidebar
  // before its quiz was linked) would otherwise show the generic "complete this
  // activity" card instead of the quiz.
  const linkedQuizId = component?.isQuiz ? component.quizMeta?.quizId ?? null : null;
  useEffect(() => {
    if (linkedQuizId == null || !kind || !id) return;
    navigate(
      `/learner/quiz/${kind}/${id}/${linkedQuizId}`
      + `?module=${encodeURIComponent(moduleTitle)}&week=${encodeURIComponent(weekTitle)}`,
      { replace: true },
    );
  }, [linkedQuizId, kind, id, moduleTitle, weekTitle, navigate]);

  const parsed = useMemo(() => (isVideo && component?.videoUrl ? parseVideoUrl(component.videoUrl) : null), [isVideo, component?.videoUrl]);
  const pageTitle = meta?.detail || meta?.label || 'Activity';

  // Non-video content has no player progress → run the wall-clock.
  useEffect(() => { if (component && !isVideo) setUnsupported(true); }, [component, isVideo]);

  const remaining = realDuration !== null ? Math.max(0, Math.round(realDuration - currentTime)) : null;
  const elapsedSeconds = isVideo && !unsupported ? Math.round(currentTime) : wallElapsed;
  // Planned time preset in the reflection window: always the component's
  // authored expected_otjh (its OTJ hours) when set, so "the planned time"
  // means the same thing for every component type in the training plan.
  // Falls back to the real video length / authored duration only when no
  // expected_otjh was set for this component.
  // The planned time as a number of hours, from whichever source is authoritative
  // for this component. Every branch converts to hours here so the reflection
  // window is never handed a value whose unit depends on where it came from:
  // expected_otjh is already hours, a real video length is seconds, and an
  // authored duration is minutes.
  const plannedHours =
    component?.expectedOtjh != null && component.expectedOtjh > 0
      ? component.expectedOtjh
      : isVideo && realDuration !== null
        ? realDuration / 3600
        : component?.durationMinutes
          ? component.durationMinutes / 60
          : null;

  // Shown to the learner. Rendered from the hours above rather than from each
  // source's own units, so "Planned time" reads as hours-and-minutes ("1h 42m")
  // everywhere instead of switching to a MM:SS clock for videos — which is what
  // made a 1h42m video look like 102 hours.
  const plannedTimeLabel = plannedHours != null ? formatHoursMinutes(plannedHours) : '';

  // Stamp the start time once we're on an openable component.
  useEffect(() => {
    if (phase === 'consume' && openable && startedAt === null) setStartedAt(new Date().toISOString());
  }, [phase, openable, startedAt]);

  // Wall-clock counter (non-video, or an unsupported player).
  useEffect(() => {
    if (phase !== 'consume' || !unsupported) return;
    timerRef.current = setInterval(() => setWallElapsed((s) => s + 1), 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [phase, unsupported]);

  const finishConsuming = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    setPhase('reflect');
  };

  const finalizeSubmit = async (reflection: { ksbs: string[]; feedback: string; reportedTime: string }) => {
    if (!component || !componentId || !kind || !id || submitting || !canProgress) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      if (isVideo) {
        const res = await submitVideoProgress(componentId, kind as 'commercial' | 'apprenticeship', id, {
          week: weekTitle || null, module: moduleTitle || null,
          startedAt: startedAt || new Date().toISOString(), timeTakenSeconds: elapsedSeconds,
          videoTitle: meta?.detail || meta?.label || 'Video',
          ksbs: reflection.ksbs, feedback: reflection.feedback, reportedTime: reflection.reportedTime,
        });
        setRecord({ timeTaken: res.record.timeTaken, ksbs: res.record.ksbs, reportedTime: res.record.reportedTime, feedback: res.record.feedback });
      } else {
        const res = await submitComponentProgress(componentId, kind as 'commercial' | 'apprenticeship', id, {
          week: weekTitle || null, module: moduleTitle || null,
          startedAt: startedAt || new Date().toISOString(), timeTakenSeconds: elapsedSeconds,
          componentTitle: pageTitle, componentType: component.type || undefined,
          ksbs: reflection.ksbs, feedback: reflection.feedback, reportedTime: reflection.reportedTime,
        });
        setRecord({ timeTaken: res.record.timeTaken, ksbs: res.record.ksbs, reportedTime: res.record.reportedTime, feedback: res.record.feedback });
      }
      setPhase('results');
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Could not save progress');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <WorkspaceShell
      role="learner" roleLabel={learnerNav.label} navItems={learnerNav.items} workspaceLabel={learnerNav.workspaceLabel}
      pageTitle={pageTitle}
      pageSubtitle={[moduleTitle, weekTitle].filter(Boolean).join(' · ')}
      userName="Learner" userRole="Learner"
    >
      <div className="p-3 md:p-6 max-w-6xl mx-auto">
        <button
          onClick={() => navigate(-1)}
          className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-semibold text-foreground-500 hover:text-foreground-800 transition-colors cursor-pointer"
        >
          <AppIcon className="ri-arrow-left-line" /> Back to training plan
        </button>

        {loading ? (
          <div className="bg-background-50 rounded-2xl border border-foreground-200/60 p-5"><RowsSkeleton rows={4} avatar={false} /></div>
        ) : loadError ? (
          <div className="bg-background-50 rounded-2xl border border-foreground-200/60 p-6"><EmptyState text={loadError} /></div>
        ) : !component ? (
          <div className="bg-background-50 rounded-2xl border border-foreground-200/60 p-6"><EmptyState text="Component not found in this learner's plan." /></div>
        ) : !canProgress ? (
          <ReadOnlyLearnerNotice what="complete their own training-plan activities" onBack={() => navigate(-1)} />
        ) : !openable ? (
          <div className="bg-background-50 rounded-2xl border border-foreground-200/60 p-6"><EmptyState text="This component can't be completed here yet." /></div>
        ) : isVideo && !parsed ? (
          <div className="bg-background-50 rounded-2xl border border-foreground-200/60 p-6"><EmptyState text="This video has no playable URL yet." /></div>
        ) : phase === 'reflect' ? (
          <div className="w-full max-w-5xl mx-auto">
            <ReflectionWindow
              noun={noun}
              plannedTimeLabel={plannedTimeLabel}
              plannedHours={plannedHours ?? undefined}
              learnerKsbs={learnerKsbs}
              // Components carry their own authored KSB mappings, so the learner
              // is shown what will be credited instead of picking by hand.
              autoKsbs={component.ksbMappings ?? []}
              elapsedSeconds={elapsedSeconds}
              submitting={submitting}
              submitError={submitError}
              onSubmit={finalizeSubmit}
              activityTitle={pageTitle}
              weekLabel={weekTitle}
              moduleLabel={moduleTitle}
              learnerName={detail?.name || 'Learner'}
              programmeName={detail?.programme || 'Programme not set'}
              learnerKind={kind as LearnerKind}
              learnerId={id}
              evidenceSectionRef={componentId}
              onClose={() => navigate(-1)}
            />
          </div>
        ) : phase === 'results' && record ? (
          <div className="w-full max-w-5xl mx-auto">
            <ResultsScreen record={record} title={pageTitle} noun={noun} onBack={() => navigate(-1)} />
          </div>
        ) : (
          /* ── consume phase: content + details + sidebar ── */
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6 items-start">
            <div className="min-w-0">
              <ComponentContent component={component} contentKind={contentKind} parsed={parsed} title={pageTitle}
                onDuration={(d) => setRealDuration((prev) => prev ?? d)}
                onProgress={(t) => setCurrentTime(t)}
                onEnded={finishConsuming}
                onUnsupported={() => setUnsupported(true)}
                evidenceContext={
                  // Evidence is collected on assignments only.
                  componentRequiresEvidence(component.type) && kind && id && componentId
                    ? {
                        kind: kind as LearnerKind, learnerId: id, componentId,
                        onUploaded: () => setEvidenceVersion((v) => v + 1),
                        trainingPlanDetails: {
                          moduleId: component.moduleId ?? null, moduleTitle: moduleTitle || null,
                          weekId: component.weekId ?? null, weekTitle: weekTitle || null,
                          componentId,
                          componentTitle: pageTitle, componentType: component.type || null,
                        },
                      }
                    : null
                }
              />
              {(component.type || '').trim().toLowerCase().replace(/-/g, '_') === 'live_session' && component.teamsLiveSessionId && (
                <LiveSessionResultsCard
                  liveSessionId={component.teamsLiveSessionId}
                  sessionNumber={(ctx?.weeks.findIndex((week) => week.active) ?? -1) + 1 || 1}
                  learnerEmail={detail?.email || ''}
                />
              )}

              {/* Title + timer + finish */}
              <div className="mt-4 flex items-start justify-between gap-4 flex-wrap">
                <div className="min-w-0">
                  <span className={`text-[10px] font-semibold uppercase tracking-wider inline-flex items-center gap-1 ${meta?.color || 'text-foreground-500'}`}>
                    <AppIcon className={meta?.icon || 'ri-checkbox-circle-line'} /> {meta?.label || 'Activity'}
                  </span>
                  <h1 className="mt-1 text-xl md:text-2xl font-heading font-bold text-foreground-900 leading-tight">{pageTitle}</h1>
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-[13px] text-foreground-500">
                    {isVideo && realDuration !== null ? (
                      <span className="inline-flex items-center gap-1"><AppIcon className="ri-time-line" />{formatClock(realDuration)}</span>
                    ) : component.durationMinutes != null && (
                      <span className="inline-flex items-center gap-1"><AppIcon className="ri-time-line" />{component.durationMinutes} min</span>
                    )}
                    {component.expectedOtjh != null && component.expectedOtjh > 0 && (
                      <span className="inline-flex items-center gap-1"><AppIcon className="ri-timer-line" />{component.expectedOtjh}h OTJ</span>
                    )}
                    {weekTitle && <span className="inline-flex items-center gap-1"><AppIcon className="ri-calendar-line" />{weekTitle}</span>}
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  {remaining !== null ? (
                    <div className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl font-mono text-sm font-semibold tabular-nums ${
                      remaining <= 10 ? 'bg-red-100 text-red-700' : 'bg-background-100 text-foreground-700'
                    }`} title="Time remaining">
                      <AppIcon className="ri-timer-line" /> {formatClock(remaining)}
                    </div>
                  ) : (
                    <div className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl font-mono text-sm font-semibold tabular-nums bg-background-100 text-foreground-700" title="Time on this activity">
                      <AppIcon className="ri-timer-line" /> {formatClock(elapsedSeconds)}
                    </div>
                  )}
                  <button
                    onClick={finishConsuming}
                    disabled={!!criteria && !criteria.met}
                    title={criteria && !criteria.met ? 'Complete the criteria below before finishing.' : undefined}
                    className={`inline-flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-xl transition-colors ${
                      criteria && !criteria.met
                        ? 'bg-background-200 text-foreground-400 cursor-not-allowed'
                        : 'bg-emerald-600 text-white hover:bg-emerald-700 cursor-pointer'
                    }`}
                  >
                    <AppIcon className={criteria && !criteria.met ? 'ri-lock-line' : 'ri-check-line'} />
                    {remaining === 0 ? 'Reflect' : 'Finish & Reflect'}
                  </button>
                </div>
              </div>

              {component.description && (
                <div className="mt-4 rounded-xl border border-background-300 bg-white p-4">
                  <h2 className="text-[11px] font-semibold uppercase tracking-wider text-foreground-400 mb-2">Description</h2>
                  <p className="text-sm text-foreground-700 leading-relaxed whitespace-pre-line">{component.description}</p>
                </div>
              )}

              {criteria?.gated && (
                <div className={`mt-4 rounded-xl border p-4 ${
                  criteria.met ? 'border-emerald-200 bg-emerald-50/60' : 'border-amber-200 bg-amber-50/60'
                }`}>
                  <h2 className="text-[11px] font-semibold uppercase tracking-wider text-foreground-500 mb-2 flex items-center gap-1.5">
                    <AppIcon className={criteria.met ? 'ri-checkbox-circle-line text-emerald-600' : 'ri-information-line text-amber-600'} />
                    {criteria.met ? 'Ready to complete' : 'Before you can complete this'}
                  </h2>
                  <ul className="space-y-1.5">
                    {criteria.evidenceRequired && (
                      <CriterionRow
                        met={criteria.evidenceMet}
                        label={
                          criteria.evidenceMet
                            ? `${evidenceCount} evidence file${evidenceCount === 1 ? '' : 's'} uploaded`
                            : 'Upload at least one evidence file'
                        }
                      />
                    )}
                  </ul>
                </div>
              )}
            </div>

            {/* Sidebar: week components + other weeks */}
            <aside className="space-y-4 lg:sticky lg:top-4">
              <div className="rounded-xl border border-background-300 bg-white overflow-hidden">
                <div className="px-4 py-3 border-b border-background-300">
                  <h2 className="text-sm font-heading font-bold text-foreground-800">{weekTitle || 'This week'}</h2>
                  <p className="text-[11px] text-foreground-400 mt-0.5">{ctx?.weekComponents.length ?? 0} components</p>
                </div>
                <ul className="divide-y divide-background-300">
                  {(ctx?.weekComponents ?? []).map((c) => {
                    const cm = componentTypeMeta(c.title);
                    const isCurrent = !c.isQuiz && c.componentId === componentId;
                    const clickable = isNavigableComponent(c) && !isCurrent;
                    const attempts = c.isQuiz ? (c.quizAttempts || []) : [];
                    const lastAttempt = attempts.length > 0 ? attempts[attempts.length - 1] : null;
                    return (
                      <li key={c.componentId || c.title}>
                        <button
                          disabled={!clickable}
                          onClick={() => clickable && navigate(componentRoute(kind, id, c, moduleTitle, weekTitle))}
                          className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-left transition-colors ${
                            isCurrent ? 'bg-primary-50' : clickable ? 'hover:bg-background-50 cursor-pointer' : 'cursor-default'
                          }`}
                        >
                          <span className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${cm.bg}`}>
                            <AppIcon className={`${cm.icon} text-[12px] ${cm.color}`} />
                          </span>
                          <span className="flex-1 min-w-0">
                            <span className="block text-[9px] font-semibold uppercase tracking-wider text-foreground-400">{cm.label}</span>
                            <span className={`block text-[13px] font-semibold leading-snug truncate ${isCurrent ? 'text-primary-700' : 'text-foreground-800'}`}>
                              {cm.detail || cm.label}
                            </span>
                          </span>
                          {c.isQuiz && lastAttempt && (
                            <span className={`shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                              lastAttempt.passed ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
                            }`}>
                              {gradePercent(lastAttempt.grade)}%
                            </span>
                          )}
                          {isCurrent ? (
                            <AppIcon className="ri-focus-3-line text-primary-600 text-sm shrink-0" />
                          ) : clickable ? (
                            <AppIcon className="ri-arrow-right-s-line text-foreground-400 text-sm shrink-0" />
                          ) : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>

              {(ctx?.weeks?.length ?? 0) > 1 && (
                <div className="rounded-xl border border-background-300 bg-white overflow-hidden">
                  <div className="px-4 py-3 border-b border-background-300">
                    <h2 className="text-sm font-heading font-bold text-foreground-800">{moduleTitle || 'Module'}</h2>
                    <p className="text-[11px] text-foreground-400 mt-0.5">{ctx?.weeks.length} weeks</p>
                  </div>
                  <ul className="divide-y divide-background-300">
                    {(ctx?.weeks ?? []).map((w) => (
                      <li key={w.week}>
                        <button
                          onClick={() => navigate(backHref)}
                          className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-left transition-colors ${
                            w.active ? 'bg-background-100' : 'hover:bg-background-50 cursor-pointer'
                          }`}
                        >
                          <span className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 bg-background-100 text-foreground-500">
                            <AppIcon className="ri-calendar-line text-[12px]" />
                          </span>
                          <span className="flex-1 min-w-0">
                            <span className={`block text-[13px] font-semibold leading-snug truncate ${w.active ? 'text-foreground-900' : 'text-foreground-700'}`}>
                              {w.week}
                            </span>
                            <span className="block text-[10px] text-foreground-400">{w.count} components</span>
                          </span>
                          {w.active && <span className="text-[10px] font-semibold text-primary-600 shrink-0">Current</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </aside>
          </div>
        )}
      </div>
    </WorkspaceShell>
  );
}

/* ═══════════════════════════════════════════════════════
   LINK CLASSIFICATION — authored URLs are free text (an
   external listening page, a direct file, a Google Slides
   link, …). Detect what we can actually embed/play inline
   vs. what only supports a "open in new tab" fallback.
   ═══════════════════════════════════════════════════════ */
const AUDIO_FILE_RE = /\.(mp3|wav|ogg|m4a|aac|flac)(\?.*)?$/i;

/** True when a URL points straight at a playable audio file (not a listening page). */
function isDirectAudioUrl(url: string): boolean {
  return AUDIO_FILE_RE.test(url);
}

/** A slide deck / document shown inline where that is possible, and an honest
 * "open it instead" card where it is not — an uploaded .pptx can only be
 * previewed by Microsoft's Office viewer, which cannot reach a file that isn't
 * published on the public internet. See @/lib/docEmbed. */
function DocumentEmbed({ url, title, noun }: { url: string; title: string; noun: string }) {
  const embed = resolveDocEmbed(url);
  const unavailable = (reason: string) => (
    <div className="rounded-xl border border-background-300 bg-background-50 p-5 text-center">
      <AppIcon className="ri-file-download-line text-2xl text-foreground-400" />
      <p className="mt-2 text-sm font-semibold text-foreground-800">This {noun} can&apos;t be shown here</p>
      <p className="mx-auto mt-1 max-w-md text-xs text-foreground-500">{reason} Open or download it below, then come back to record your reflection.</p>
    </div>
  );
  if (embed.mode === 'unavailable') return unavailable(embed.reason);
  if (embed.mode === 'deck') return <SlideDeckViewer src={embed.src} title={title} fallback={unavailable} />;
  return (
    <div className="rounded-xl overflow-hidden border border-background-300" style={{ aspectRatio: '4 / 3' }}>
      <iframe title={title} src={embed.src} className="w-full h-full" />
    </div>
  );
}

/** Reading content authored through a plain textarea sometimes lands
 * double-escaped: each authored line is a real `<div>…</div>` (the browser's
 * contentEditable-style line wrapper), but its CONTENTS are HTML-escaped text
 * ("&lt;h2&gt;Overview&lt;/h2&gt;") instead of real tags. Detect that shape,
 * turn the real `<div>`/`<br>` line breaks into newlines, then decode the
 * escaped entities — turning it into genuine HTML that renders formatted
 * instead of showing literal "&lt;h2&gt;" tag text. */
function normalizeReadingHtml(html: string): string {
  const looksEscaped = /&lt;\/?[a-z][a-z0-9]*(&gt;|\s)/i.test(html);
  if (!looksEscaped) return html;
  const withBreaks = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/div>\s*<div>/gi, '\n')
    .replace(/<\/?div>/gi, '');
  const textarea = document.createElement('textarea');
  textarea.innerHTML = withBreaks;
  return textarea.value;
}

/* ═══════════════════════════════════════════════════════
   CONTENT RENDERER — one presentation per content kind.
   ═══════════════════════════════════════════════════════ */
interface EvidenceContext {
  kind: LearnerKind;
  learnerId: string;
  componentId: string;
  onUploaded: () => void;
  trainingPlanDetails: {
    moduleId: string | null; moduleTitle: string | null;
    weekId: string | null; weekTitle: string | null;
    componentId: string; componentTitle: string; componentType: string | null;
  };
}

/** Content for the component, plus the evidence uploader when one is required.
 * The uploader is appended outside the per-kind renderers so a gated video or
 * reading gets it too — not just the activity/assignment fallback. */
function ComponentContent({ evidenceContext, ...props }: Parameters<typeof ComponentBody>[0] & {
  evidenceContext: EvidenceContext | null;
}) {
  return (
    <>
      <ComponentBody {...props} />
      {evidenceContext && (
        <div className="mt-4 rounded-2xl border border-background-300 bg-white p-6">
          <AssignmentEvidence
            kind={evidenceContext.kind}
            learnerId={evidenceContext.learnerId}
            componentId={evidenceContext.componentId}
            trainingPlanDetails={evidenceContext.trainingPlanDetails}
            onUploaded={evidenceContext.onUploaded}
          />
        </div>
      )}
    </>
  );
}

function LiveSessionResultsCard({
  liveSessionId,
  sessionNumber,
  learnerEmail,
}: {
  liveSessionId: string;
  sessionNumber: number;
  learnerEmail: string;
}) {
  const [data, setData] = useState<TeamsMeetingArtifactsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadResults = useCallback(async () => {
    const result = await loadTeamsMeetingArtifacts(liveSessionId);
    setData(result);
    return result;
  }, [liveSessionId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    loadTeamsMeetingArtifacts(liveSessionId)
      .then((result) => { if (!cancelled) setData(result); })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'Unable to load Teams results.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [liveSessionId]);

  const handleSync = async () => {
    if (syncing) return;
    setSyncing(true);
    setError(null);
    setNotice(null);
    try {
      const result = await syncTeamsMeetingArtifacts(liveSessionId);
      await loadResults();
      setNotice(
        `Synced ${result.synced.attendanceRecords} attendance record${result.synced.attendanceRecords === 1 ? '' : 's'}`
        + ` and ${result.synced.recordings} recording${result.synced.recordings === 1 ? '' : 's'}.`,
      );
      if (result.errors.length) setError(result.errors.join(' · '));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to sync Teams results.');
    } finally {
      setSyncing(false);
    }
  };

  const occurrence = data?.occurrences.find((item) => Number(item.session_number) === sessionNumber)
    || data?.occurrences[sessionNumber - 1]
    || null;
  const normalizedEmail = learnerEmail.trim().toLowerCase();
  const learnerAttendance = occurrence?.attendance.find(
    (person) => person.email?.trim().toLowerCase() === normalizedEmail,
  );
  const reportReady = Boolean(occurrence?.attendance_report_id);
  const recordings = occurrence?.artifacts.filter((artifact) => artifact.artifact_type === 'recording') || [];
  const attendanceMinutes = Math.max(0, Math.round(Number(learnerAttendance?.total_attendance_seconds || 0) / 60));
  const attendanceState = learnerAttendance ? 'attended' : reportReady ? 'absent' : 'awaiting';
  const attendanceMeta = {
    attended: {
      label: 'Attended',
      detail: attendanceMinutes ? `${attendanceMinutes} min verified by Teams` : 'Joined the Teams meeting',
      icon: 'ri-user-follow-line',
      tone: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    },
    absent: {
      label: 'Absent',
      detail: 'Not found in the verified attendance report',
      icon: 'ri-user-unfollow-line',
      tone: 'border-red-200 bg-red-50 text-red-800',
    },
    awaiting: {
      label: 'Awaiting report',
      detail: 'Sync after the Teams meeting has ended',
      icon: 'ri-time-line',
      tone: 'border-amber-200 bg-amber-50 text-amber-800',
    },
  }[attendanceState];

  return (
    <section className="mt-4 overflow-hidden rounded-2xl border border-primary-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-primary-100 bg-primary-50/70 px-5 py-4">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.14em] text-primary-600">Microsoft Teams results</p>
          <h2 className="mt-1 text-sm font-heading font-black text-foreground-900">Attendance, absence and recording</h2>
        </div>
        <button
          type="button"
          onClick={handleSync}
          disabled={syncing}
          className="inline-flex h-9 items-center gap-2 rounded-xl bg-primary-600 px-4 text-[11px] font-black text-white shadow-sm transition-colors hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <AppIcon className={`${syncing ? 'ri-loader-4-line animate-spin' : 'ri-refresh-line'} text-sm`} />
          {syncing ? 'Syncing…' : 'Sync Teams results'}
        </button>
      </div>

      <div className="p-5">
        {loading ? (
          <p className="inline-flex items-center gap-2 text-xs font-semibold text-foreground-500">
            <AppIcon className="ri-loader-4-line animate-spin" /> Loading Teams results…
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className={`rounded-xl border p-4 ${attendanceMeta.tone}`}>
              <div className="flex items-center gap-3">
                <span className="grid h-9 w-9 place-items-center rounded-lg bg-white/70"><AppIcon className={`${attendanceMeta.icon} text-lg`} /></span>
                <div>
                  <p className="text-[9px] font-black uppercase tracking-wide opacity-70">Attendance status</p>
                  <p className="mt-0.5 text-sm font-black">{attendanceMeta.label}</p>
                  <p className="mt-0.5 text-[10px] font-semibold opacity-80">{attendanceMeta.detail}</p>
                </div>
              </div>
            </div>

            <div className={`rounded-xl border p-4 ${recordings.length ? 'border-sky-200 bg-sky-50 text-sky-800' : 'border-background-200 bg-background-100 text-foreground-600'}`}>
              <div className="flex items-center gap-3">
                <span className="grid h-9 w-9 place-items-center rounded-lg bg-white/70"><AppIcon className="ri-record-circle-line text-lg" /></span>
                <div className="min-w-0">
                  <p className="text-[9px] font-black uppercase tracking-wide opacity-70">Session recording</p>
                  <p className="mt-0.5 text-sm font-black">{recordings.length ? 'Recording ready' : 'Not available yet'}</p>
                  {recordings.map((recording, index) => (
                    <a
                      key={recording.id}
                      href={teamsMeetingArtifactContentUrl(liveSessionId, recording.id)}
                      className="mt-1 inline-flex items-center gap-1 text-[10px] font-black underline"
                    >
                      <AppIcon className="ri-download-cloud-2-line" /> Download recording{recordings.length > 1 ? ` ${index + 1}` : ''}
                    </a>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {notice && <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-[10px] font-bold text-emerald-700">{notice}</p>}
        {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-[10px] font-bold text-red-700">{error}</p>}
      </div>
    </section>
  );
}

function ComponentBody({ component, contentKind, parsed, title, onDuration, onProgress, onEnded, onUnsupported }: {
  component: JourneyComponent;
  contentKind: ReturnType<typeof componentContentKind>;
  parsed: ReturnType<typeof parseVideoUrl> | null;
  title: string;
  onDuration: (d: number) => void;
  onProgress: (t: number) => void;
  onEnded: () => void;
  onUnsupported: () => void;
}) {
  if (contentKind === 'video' && parsed) {
    return (
      <div className="rounded-2xl overflow-hidden bg-black shadow-sm ring-1 ring-background-300">
        <div className="relative w-full" style={{ aspectRatio: '16 / 9' }}>
          <VideoPlayer parsed={parsed} title={title} onDuration={onDuration} onProgress={onProgress} onEnded={onEnded} onUnsupported={onUnsupported} />
        </div>
      </div>
    );
  }

  if (contentKind === 'audio') {
    const directAudio = component.audioUrl && isDirectAudioUrl(component.audioUrl);
    return (
      <div className="rounded-2xl border border-background-300 bg-gradient-to-br from-violet-50 to-background-50 p-6">
        <div className="flex items-center gap-3 mb-4">
          <span className="w-11 h-11 rounded-xl bg-violet-100 text-violet-600 flex items-center justify-center"><AppIcon className="ri-headphone-line text-xl" /></span>
          <div><p className="text-sm font-semibold text-foreground-900">{title}</p><p className="text-xs text-foreground-400">Listen, then finish and reflect below.</p></div>
        </div>
        {directAudio ? (
          <audio controls preload="metadata" className="w-full" src={component.audioUrl!}>Your browser does not support audio playback.</audio>
        ) : component.audioUrl ? (
          <>
            {/* Not a direct media file (e.g. a podcast listening page) — fetch
                and display the page itself in the LMS rather than only linking
                out. Some sites block embedding (X-Frame-Options), so the "open
                in a new tab" link below is always shown, not just a fallback. */}
            <div className="rounded-xl overflow-hidden border border-background-300 bg-white" style={{ aspectRatio: '16 / 9' }}>
              <iframe title={title} src={component.audioUrl} className="w-full h-full" sandbox="allow-scripts allow-same-origin allow-popups allow-forms" />
            </div>
            <p className="text-[11px] text-foreground-400 mt-2">If the player above stays blank, this site doesn&apos;t allow embedding — use the link below instead.</p>
          </>
        ) : (
          <p className="text-sm text-foreground-500">No audio was set for this podcast. You can still record your reflection below.</p>
        )}
        {component.audioUrl && (
          <a href={component.audioUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-violet-600 hover:text-violet-700"><AppIcon className="ri-external-link-line" />Open in a new tab</a>
        )}
      </div>
    );
  }

  if (contentKind === 'reading') {
    return (
      <div className="rounded-2xl border border-background-300 bg-white p-6">
        <div className="flex items-center gap-3 mb-4">
          <span className="w-11 h-11 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center"><AppIcon className="ri-book-open-line text-xl" /></span>
          <div><p className="text-sm font-semibold text-foreground-900">{title}</p><p className="text-xs text-foreground-400">Read the material, then finish and reflect below.</p></div>
        </div>
        {/* A reading can have written content, an attached document, or both —
            imported material routinely has a sentence of framing plus the PDF —
            so neither one hides the other. */}
        {component.contentHtml && (
          // Reading content is coach-authored curriculum (trusted staff authors).
          <div
            className="max-w-none text-sm text-foreground-700 leading-relaxed [&_h2]:font-heading [&_h2]:font-bold [&_h2]:text-lg [&_h2]:text-foreground-900 [&_h2]:mt-4 [&_h2]:mb-2 [&_h3]:font-heading [&_h3]:font-semibold [&_h3]:text-base [&_h3]:text-foreground-900 [&_h3]:mt-3 [&_h3]:mb-1.5 [&_p]:mb-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:mb-3 [&_li]:mb-1 [&_strong]:font-semibold [&_strong]:text-foreground-900 [&_em]:italic [&_a]:text-blue-600 [&_a]:underline"
            dangerouslySetInnerHTML={{ __html: normalizeReadingHtml(component.contentHtml) }}
          />
        )}
        {component.resourceUrl ? (
          <div className={component.contentHtml ? 'mt-4 pt-4 border-t border-background-200' : ''}>
            {/* Reading material stored as an external link/file — shown inline
                through the same document embed PowerPoint uses. */}
            <DocumentEmbed url={component.resourceUrl} title={title} noun="document" />
            <a href={component.resourceUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:text-blue-700"><AppIcon className="ri-external-link-line" />Open in a new tab</a>
          </div>
        ) : !component.contentHtml && (
          <p className="text-sm text-foreground-500">No reading content was set. You can still record your reflection below.</p>
        )}
        {component.audioUrl && (
          <div className="mt-4 pt-4 border-t border-background-200">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-foreground-400 mb-2">Audio version</p>
            <audio controls preload="metadata" className="w-full" src={component.audioUrl} />
          </div>
        )}
      </div>
    );
  }

  if (contentKind === 'slides') {
    return (
      <div className="rounded-2xl border border-background-300 bg-white p-6">
        <div className="flex items-center gap-3 mb-4">
          <span className="w-11 h-11 rounded-xl bg-orange-100 text-orange-600 flex items-center justify-center"><AppIcon className="ri-slideshow-line text-xl" /></span>
          <div><p className="text-sm font-semibold text-foreground-900">{title}</p><p className="text-xs text-foreground-400">Review the slide deck, then finish and reflect below.</p></div>
        </div>
        {component.resourceUrl ? (
          <DocumentEmbed url={component.resourceUrl} title={title} noun="slide deck" />
        ) : (
          <p className="text-sm text-foreground-500">{component.fileName ? <>Slide deck: <span className="font-semibold text-foreground-700">{component.fileName}</span>. </> : ''}Review your slide deck for this week, then record your reflection below.</p>
        )}
        {component.resourceUrl && (
          <div className="mt-3 flex items-center gap-4">
            <a href={component.resourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs font-semibold text-orange-600 hover:text-orange-700"><AppIcon className="ri-external-link-line" />Open in a new tab</a>
            {component.downloadAllowed && (
              <a href={component.resourceUrl} download className="inline-flex items-center gap-1.5 text-xs font-semibold text-orange-600 hover:text-orange-700"><AppIcon className="ri-download-line" />Download slides</a>
            )}
          </div>
        )}
      </div>
    );
  }

  if ((component.type || '').trim().toLowerCase().replace(/-/g, '_') === 'live_session') {
    const parsedStart = component.sessionDateTimeUtc ? new Date(component.sessionDateTimeUtc) : null;
    const validStart = parsedStart && !Number.isNaN(parsedStart.getTime()) ? parsedStart : null;
    const dateLabel = component.sessionDate
      ? new Date(`${component.sessionDate}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
      : validStart?.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) || 'Date to be confirmed';
    const timeLabel = component.sessionTime
      || (validStart ? `${validStart.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' })} UTC` : 'Time to be confirmed');

    return (
      <div className="overflow-hidden rounded-2xl border border-primary-200 bg-white shadow-sm">
        <div className="bg-[linear-gradient(135deg,#5b21b6_0%,#6d28d9_55%,#2563eb_100%)] p-6 text-white">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-4">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-white/15 ring-1 ring-white/20">
                <AppIcon className="ri-microsoft-teams-line text-2xl" />
              </span>
              <div className="min-w-0">
                <p className="text-[10px] font-black uppercase tracking-[0.16em] text-white/70">Microsoft Teams live session</p>
                <p className="mt-1 truncate text-base font-heading font-black">{title}</p>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-semibold text-white/80">
                  <span><AppIcon className="ri-calendar-line mr-1" />{dateLabel}</span>
                  <span><AppIcon className="ri-time-line mr-1" />{timeLabel}</span>
                  {component.durationMinutes ? <span><AppIcon className="ri-timer-line mr-1" />{component.durationMinutes} min</span> : null}
                </div>
              </div>
            </div>

            {component.liveSessionUrl ? (
              <a href={component.liveSessionUrl} target="_blank" rel="noreferrer" className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-white px-5 text-[12px] font-black text-primary-700 shadow-lg transition-transform hover:-translate-y-0.5 hover:bg-primary-50">
                <AppIcon className="ri-microsoft-teams-line text-base" />
                Join live session
                <AppIcon className="ri-external-link-line text-xs" />
              </a>
            ) : (
              <span className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-4 text-[11px] font-bold text-white/80">
                <AppIcon className="ri-calendar-todo-line text-base" />
                Meeting link not scheduled
              </span>
            )}
          </div>
        </div>

        <div className="grid gap-4 p-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <div>
            <p className="text-[10px] font-black uppercase tracking-wider text-foreground-400">Before the session</p>
            <p className="mt-1 text-[12px] leading-5 text-foreground-600">
              {component.reflectionPrompt || 'Join on time and complete your reflection after the live session.'}
            </p>
          </div>
          {!component.liveSessionUrl && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[10px] font-semibold text-amber-800">
              Contact your tutor if you expect a meeting link here.
            </p>
          )}
        </div>
      </div>
    );
  }

  if (contentKind === 'reflection') {
    return (
      <div className="rounded-2xl border border-background-300 bg-gradient-to-br from-purple-50 to-background-50 p-6">
        <div className="flex items-center gap-3 mb-3">
          <span className="w-11 h-11 rounded-xl bg-purple-100 text-purple-600 flex items-center justify-center"><AppIcon className="ri-brain-line text-xl" /></span>
          <div><p className="text-sm font-semibold text-foreground-900">{title}</p><p className="text-xs text-foreground-400">Read the prompt, then capture your reflection below.</p></div>
        </div>
        {component.reflectionPrompt && (
          <div className="rounded-xl bg-white border border-purple-100 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-purple-500 mb-1">Reflection prompt</p>
            <p className="text-sm text-foreground-700 leading-relaxed whitespace-pre-line">{component.reflectionPrompt}</p>
          </div>
        )}
      </div>
    );
  }

  /* resource / activity / evidence / live session / recording */
  return (
    <div className="rounded-2xl border border-background-300 bg-white p-6">
      <div className="flex items-center gap-3 mb-3">
        <span className="w-11 h-11 rounded-xl bg-emerald-100 text-emerald-600 flex items-center justify-center"><AppIcon className="ri-task-line text-xl" /></span>
        <div><p className="text-sm font-semibold text-foreground-900">{title}</p><p className="text-xs text-foreground-400">Complete this activity, then finish and reflect below.</p></div>
      </div>
      {component.reflectionPrompt && (
        <div className="rounded-xl bg-background-50 border border-background-200 p-4 mb-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-foreground-400 mb-1">What to do</p>
          <p className="text-sm text-foreground-700 leading-relaxed whitespace-pre-line">{component.reflectionPrompt}</p>
        </div>
      )}
      {component.resourceUrl && (
        <a href={component.resourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-600 hover:text-emerald-700"><AppIcon className="ri-external-link-line" />Open resource</a>
      )}
    </div>
  );
}

/* Results screen after a completion + reflection is saved. */
function ResultsScreen({ record, title, noun, onBack }: { record: DoneRecord; title: string; noun: string; onBack: () => void }) {
  return (
    <div className="bg-background-50 rounded-2xl border border-foreground-200/60 p-6 md:p-8 card-premium text-center">
      <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 bg-emerald-100">
        <AppIcon className="ri-checkbox-circle-line text-emerald-600 text-2xl" />
      </div>
      <h1 className="text-lg font-heading font-bold text-foreground-900 mb-1">{noun.charAt(0).toUpperCase() + noun.slice(1)} complete!</h1>
      <p className="text-sm text-foreground-400 mb-6">{title}</p>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6 text-left max-w-md mx-auto">
        <StatTile icon="ri-timer-line" label="Time taken" value={record.timeTaken || '—'} />
        <StatTile icon="ri-links-line" label="KSBs" value={String(record.ksbs?.length ?? 0)} />
        <StatTile icon="ri-time-line" label="Reported" value={record.reportedTime || '—'} />
      </div>

      {record.feedback && (
        <div className="text-left max-w-md mx-auto mb-6 rounded-xl border border-background-300 bg-white p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-foreground-400 mb-1">Your reflection</p>
          <p className="text-sm text-foreground-700">{record.feedback}</p>
        </div>
      )}

      <button onClick={onBack} className="px-6 py-2.5 rounded-xl text-sm font-semibold bg-primary-600 text-white hover:bg-primary-700 transition-colors cursor-pointer">
        Back to Training Plan
      </button>
    </div>
  );
}

/* One line of the completion-criteria checklist. */
function CriterionRow({ met, label, hint, showHint }: { met: boolean; label: string; hint?: string; showHint?: boolean }) {
  return (
    <li className="flex items-start gap-2">
      <AppIcon className={`mt-0.5 text-sm shrink-0 ${met ? 'ri-checkbox-circle-fill text-emerald-600' : 'ri-close-circle-line text-amber-600'}`} />
      <span className="min-w-0">
        <span className={`block text-[13px] font-medium ${met ? 'text-foreground-600' : 'text-foreground-800'}`}>{label}</span>
        {hint && showHint && <span className="block text-[11px] text-foreground-400 mt-0.5">{hint}</span>}
      </span>
    </li>
  );
}

function StatTile({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-background-300 bg-white px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-foreground-400 mb-0.5">
        <AppIcon className={`${icon} text-xs`} />
        <span className="text-[10px] font-semibold uppercase tracking-wider">{label}</span>
      </div>
      <p className="text-sm font-bold text-foreground-900 truncate">{value}</p>
    </div>
  );
}
