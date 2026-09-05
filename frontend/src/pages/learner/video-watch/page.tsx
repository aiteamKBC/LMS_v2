import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import DOMPurify from 'dompurify';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { EmptyState } from '@/pages/users/components/ui';
import { fetchLearnerDetail, type LearnerDetail, type LearnerKind, type LearnerKsbItem } from '@/api/learnerDetail';
import { submitVideoProgress } from '@/api/videos';
import { submitComponentProgress } from '@/api/components';
import { startTimeTracking, type TimeTrackingSession, type TrackingCountingMode } from '@/api/timeTracking';
import { AssignmentEvidence } from '@/components/feature/AssignmentEvidence';
import { EvidenceFilesButton, EvidencePreviewModal, type EvidencePreview } from '@/components/feature/EvidenceFilesButton';
import {
  buildLearnerJourney, componentTypeMeta, componentContentKind, componentNoun, hasComponentContent, isOpenableComponent, gradePercent, formatHoursMinutes,
  componentCriteria, componentRequiresEvidence, completedComponentIds, isComponentComplete,
  type JourneyComponent,
} from '@/utils/learnerJourney';
import { fetchEvidence, getEvidenceDownloadUrl, type EvidenceRecord } from '@/api/evidence';
import { ReflectionWindow, formatClock, formatRecordedClock, parseClockSeconds } from '@/components/feature/ReflectionWindow';
import { VideoPlayer, parseVideoUrl } from '@/components/feature/VideoPlayer';
import { rememberLearner } from '@/hooks/useMyLearner';
import { useLearnerWorkspaceAccess } from '@/hooks/useLearnerWorkspaceAccess';
import { useAuth } from '@/hooks/useAuth';
import { isInspectionDemoAccount } from '@/lib/learnerFlowAccess';
import { demoTimeKey, expectedMinutesFor, setDemoTimeOverride, useDemoTimeOverrides } from '@/lib/demoTime';
import {
  activityTimerStorageKey,
  canResumeActivityTimer,
  clearActivityTimer,
  readActivityTimer,
  saveActivityTimerElapsed,
  saveActivityTimerSession,
} from '@/lib/activityTimer';
import { DemoTimeChip } from '@/components/feature/DemoTimePanel';
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

type Phase = 'consume' | 'reflect' | 'confirm';
type TimeSource = 'timer' | 'input';

/** Normalised completion record for the results screen (video + component share these). */
interface DoneRecord { timeTaken: string | null; ksbs: string[]; reportedTime: string; feedback: string }

interface FoundContext {
  component: JourneyComponent;
  moduleTitle: string;
  weekTitle: string;
  weekComponents: JourneyComponent[];
  weeks: { week: string; count: number; completed: number; active: boolean; components: JourneyComponent[] }[];
}

interface TimedCompletion {
  submittedAt?: string | null;
  timeTaken?: string | null;
  passed?: boolean | null;
}

/** The latest successful completion time for one sidebar activity. */
function completionTimeFor(component: JourneyComponent, detail: LearnerDetail | null): string | null {
  let records: TimedCompletion[] = [];
  if (component.isQuiz) {
    records = (component.quizAttempts || []).filter((attempt) => attempt.passed);
  } else if (component.componentId && componentContentKind(component.type) === 'video') {
    records = (detail?.videoProgress || []).filter(
      (entry) => entry.componentId === component.componentId && entry.passed !== false,
    );
  } else if (component.componentId) {
    records = (detail?.componentProgress || []).filter(
      (entry) => entry.componentId === component.componentId && entry.passed !== false,
    );
  }

  const latest = records.reduce<TimedCompletion | null>((current, record) => {
    if (!current) return record;
    return String(record.submittedAt || '') >= String(current.submittedAt || '') ? record : current;
  }, null);
  return formatRecordedClock(latest?.timeTaken);
}

function CompletionTimeInput({
  value,
  label = 'Time taken',
  rightAddon,
  onSave,
}: {
  value: string;
  label?: string;
  rightAddon?: ReactNode;
  onSave: (seconds: number | null) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    setDraft(value);
    setInvalid(false);
  }, [value]);

  const save = () => {
    if (!draft.trim()) {
      onSave(null);
      return;
    }
    const seconds = parseClockSeconds(draft);
    if (seconds == null) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    const formatted = formatClock(seconds);
    setDraft(formatted);
    onSave(seconds);
  };

  const updateDraft = (nextValue: string) => {
    setDraft(nextValue);
    setInvalid(false);

    // Persist as soon as the learner has entered a complete valid clock. This
    // means a refresh or route change cannot lose the latest value just because
    // the input did not get a chance to blur first.
    if (!nextValue.trim()) {
      onSave(null);
      return;
    }
    const seconds = parseClockSeconds(nextValue);
    if (seconds != null) onSave(seconds);
  };

  return (
    <div className="flex items-center gap-2 border-t border-emerald-100 bg-emerald-50/70 px-4 py-2 text-[10px] font-semibold text-emerald-800">
      <AppIcon className="ri-timer-line shrink-0 text-[11px]" />
      <span className="shrink-0">{label}</span>
      <input
        type="text"
        inputMode="numeric"
        value={draft}
        onChange={(event) => updateDraft(event.target.value)}
        onBlur={save}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') { event.preventDefault(); setDraft(value); setInvalid(false); }
        }}
        placeholder="00:00:00"
        aria-label="Completion time in hours, minutes and seconds"
        aria-invalid={invalid}
        className={`ml-auto w-24 rounded-md border bg-white px-2 py-1 text-center font-mono text-[11px] font-bold tabular-nums outline-none focus:ring-2 ${
          invalid
            ? 'border-red-400 text-red-700 focus:ring-red-200'
            : 'border-emerald-200 text-emerald-800 focus:border-emerald-400 focus:ring-emerald-100'
        }`}
      />
      {rightAddon}
    </div>
  );
}

function ActivityTimeSpentInput({ onChange }: { onChange: (seconds: number | null) => void }) {
  const [parts, setParts] = useState({ hours: '', minutes: '', seconds: '' });

  const totalSeconds = (next: typeof parts): number | null => {
    if (!next.hours && !next.minutes && !next.seconds) return null;
    return (Number(next.hours) || 0) * 3600 + (Number(next.minutes) || 0) * 60 + (Number(next.seconds) || 0);
  };

  const updatePart = (part: keyof typeof parts, rawValue: string) => {
    const value = rawValue.replace(/\D/g, '').slice(0, part === 'hours' ? 3 : 2);
    const next = { ...parts, [part]: value };
    setParts(next);
    onChange(totalSeconds(next));
  };

  const normalise = () => {
    const total = totalSeconds(parts);
    if (total == null) return;
    const [hours, minutes, seconds] = formatClock(total).split(':');
    setParts({ hours, minutes, seconds });
    onChange(total);
  };

  const fields: { key: keyof typeof parts; label: string; ariaLabel: string }[] = [
    { key: 'hours', label: 'hr', ariaLabel: 'Hours spent' },
    { key: 'minutes', label: 'min', ariaLabel: 'Minutes spent' },
    { key: 'seconds', label: 'sec', ariaLabel: 'Seconds spent' },
  ];

  return (
    <div
      className="inline-flex items-center gap-2 rounded-xl border border-background-300 bg-white px-3 py-1.5 text-foreground-700 shadow-sm transition-colors focus-within:border-primary-300 focus-within:ring-2 focus-within:ring-primary-100"
      title="Enter time spent in hours, minutes and seconds"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) normalise();
      }}
    >
      <AppIcon className="ri-timer-line text-sm text-foreground-500" />
      <span className="text-[12px] font-semibold text-foreground-600">Time spent</span>
      <span className="flex items-center gap-1">
        {fields.map((field, index) => (
          <span key={field.key} className="flex items-center gap-1">
            {index > 0 && <span className="font-mono text-foreground-300">:</span>}
            <label className="grid justify-items-center gap-0.5">
              <input
                type="text"
                inputMode="numeric"
                value={parts[field.key]}
                onChange={(event) => updatePart(field.key, event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur();
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    const empty = { hours: '', minutes: '', seconds: '' };
                    setParts(empty);
                    onChange(null);
                  }
                }}
                placeholder="00"
                aria-label={field.ariaLabel}
                className="w-7 bg-transparent text-center font-mono text-sm font-bold tabular-nums outline-none placeholder:text-foreground-300"
              />
              <span className="text-[8px] font-bold uppercase tracking-wide text-foreground-400">{field.label}</span>
            </label>
          </span>
        ))}
      </span>
    </div>
  );
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
  return (c.isQuiz && hasComponentContent(c)) || isOpenableComponent(c);
}

/** Find the target component + its week/module context inside the built journey. */
function locate(detail: LearnerDetail | null, componentId: string, completedIds: Set<string>): FoundContext | null {
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
          weeks: mod.weeks.map((w) => ({
            week: w.week,
            count: w.components.length,
            completed: w.components.filter((component) => isComponentComplete(component, completedIds)).length,
            active: w.week === wk.week,
            components: w.components,
          })),
        };
      }
    }
  }
  return null;
}

function nextActivityRoute(detail: LearnerDetail | null, currentComponentId: string | undefined, kind: string | undefined, id: string | undefined): string | null {
  if (!detail || !currentComponentId || !kind || !id) return null;
  const journey = buildLearnerJourney(detail);
  const ordered = journey.flatMap((module) => (
    module.weeks.flatMap((week) => (
      week.components.map((component) => ({ module: module.module, week: week.week, component }))
    ))
  ));
  const currentIndex = ordered.findIndex((item) => item.component.componentId === currentComponentId);
  if (currentIndex < 0) return null;
  const next = ordered
    .slice(currentIndex + 1)
    .find((item) => hasComponentContent(item.component) && isNavigableComponent(item.component));
  return next ? componentRoute(kind, id, next.component, next.module, next.week) : null;
}

export default function ComponentViewPage() {
  const { kind, id, componentId } = useParams<{ kind: string; id: string; componentId: string }>();
  const timerStorageKey = activityTimerStorageKey(kind, id, componentId);
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
  // Real playback state (video only), driven by the player.
  const [realDuration, setRealDuration] = useState<number | null>(null);
  const [playerPlaying, setPlayerPlaying] = useState(false);
  const [unsupported, setUnsupported] = useState(false); // no player progress events → wall-clock
  const [wallElapsed, setWallElapsed] = useState(
    () => readActivityTimer(timerStorageKey)?.elapsedSeconds ?? 0,
  );
  const [manualTimeSeconds, setManualTimeSeconds] = useState<number | null>(null);
  const [timeSource, setTimeSource] = useState<TimeSource>('timer');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [record, setRecord] = useState<DoneRecord | null>(null);
  // Bumped by the uploader so the criteria panel re-checks after an upload.
  const [evidenceVersion, setEvidenceVersion] = useState(0);
  const [evidenceFiles, setEvidenceFiles] = useState<EvidenceRecord[]>([]);
  const [pendingEvidenceFileName, setPendingEvidenceFileName] = useState<string | null>(null);
  const [evidencePreview, setEvidencePreview] = useState<EvidencePreview | null>(null);
  const evidenceInputId = useId();
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const trackingSessionRef = useRef<TimeTrackingSession | null>(null);
  const trackingPromiseRef = useRef<Promise<TimeTrackingSession> | null>(null);

  // React Router can reuse this page while only the component id changes.
  // Restore the independently saved counter for the newly selected activity.
  useEffect(() => {
    setWallElapsed(readActivityTimer(timerStorageKey)?.elapsedSeconds ?? 0);
    setManualTimeSeconds(null);
    setTimeSource('timer');
    setPendingEvidenceFileName(null);
    setEvidenceFiles([]);
    setEvidencePreview(null);
  }, [timerStorageKey]);

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

  // Keep completion state derived from the same progress records used by the
  // learner journey. This is also needed by the sidebar's done counts.
  const completedIds = useMemo(() => completedComponentIds(detail), [detail]);
  const ctx = useMemo(
    () => (componentId ? locate(detail, componentId, completedIds) : null),
    [detail, componentId, completedIds],
  );
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
        if (!cancelled) {
          setEvidenceFiles(rows);
          setEvidenceCount(rows.filter((r) => r.status === 'approved').length);
        }
      })
      .catch(() => { /* the criteria panel just shows 0; the server re-checks on submit */ });
    return () => { cancelled = true; };
  }, [needsEvidence, kind, id, componentId, evidenceVersion]);

  const criteria = component ? componentCriteria(component, evidenceCount) : null;

  const moduleTitle = ctx?.moduleTitle ?? searchParams.get('module') ?? '';
  const weekTitle = ctx?.weekTitle ?? searchParams.get('week') ?? '';
  const backHref = kind && id ? `/workspace/learner/${kind}/${id}` : '/workspace/learner';
  const weekDoneCount = ctx?.weeks.find((w) => w.active)?.completed ?? 0;

  // Inspection-demo accounts only — see isInspectionDemoAccount. The results
  // screen shows an editable "demo time" beside the expected time; everyone
  // else sees the page exactly as before.
  const { auth } = useAuth();
  const isDemoAccount = isInspectionDemoAccount(auth.account?.email);
  const demoScopeKey = kind && id ? `${kind}:${id}` : '';
  const demoTimeOverrides = useDemoTimeOverrides(demoScopeKey);
  const demoKey = componentId ? demoTimeKey({ isQuiz: false, componentId }) : '';
  const demoExpectedMinutes = component ? expectedMinutesFor(component) : null;

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
  const pageTitle = decodeInlineText(meta?.detail || meta?.label || 'Activity');
  const activityEvidenceContext: EvidenceContext | null = component
    && componentId
    && id
    && (kind === 'commercial' || kind === 'apprenticeship')
    ? {
        kind,
        learnerId: id,
        componentId,
        onUploaded: (files) => {
          setEvidenceFiles(files);
          setEvidenceVersion((version) => version + 1);
        },
        trainingPlanDetails: {
          moduleId: component.moduleId ?? null,
          moduleTitle: moduleTitle || null,
          weekId: component.weekId ?? null,
          weekTitle: weekTitle || null,
          componentId,
          componentTitle: pageTitle,
          componentType: component.type || null,
        },
      }
    : null;
  const visibleEvidenceFile = evidenceFiles[0] ?? null;
  const evidenceFileLabel = pendingEvidenceFileName || visibleEvidenceFile?.filename || null;
  const evidenceFileStatus = visibleEvidenceFile?.status || (pendingEvidenceFileName ? 'pending' : null);
  const openEvidenceFile = async (file: EvidenceRecord) => {
    try {
      const url = await getEvidenceDownloadUrl(kind as LearnerKind, id || '', file.id);
      setEvidencePreview({ file, url });
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Could not open the evidence file.');
    }
  };

  // Non-video content has no player progress → run the wall-clock.
  useEffect(() => { if (component && !isVideo) setUnsupported(true); }, [component, isVideo]);

  // Seeking changes the playhead/duration metadata, but cannot add watched time.
  const elapsedSeconds = wallElapsed;
  const submittedTimeSeconds = timeSource === 'input' && manualTimeSeconds != null ? manualTimeSeconds : elapsedSeconds;
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
  // everywhere instead of switching to an HH:MM:SS clock for videos — which is what
  // made a 1h42m video look like 102 hours.
  const plannedTimeLabel = plannedHours != null ? formatHoursMinutes(plannedHours) : '';

  const trackingMode: TrackingCountingMode = isVideo && parsed?.kind !== 'vimeo'
    ? 'active_playback'
    : 'visible_page';

  // The server stamps and signs the start, preventing claims for time before
  // this learner opened this specific activity.
  useEffect(() => {
    if (phase !== 'consume' || !openable || !componentId || !kind || !id || !canProgress) return;
    const learnerKind = kind as LearnerKind;
    const activityKind = isVideo ? 'video' : 'component';
    let cancelled = false;
    trackingSessionRef.current = null;

    const savedTimer = readActivityTimer(timerStorageKey);
    if (canResumeActivityTimer(savedTimer, trackingMode)) {
      const savedSession = savedTimer!.session!;
      trackingSessionRef.current = savedSession;
      trackingPromiseRef.current = Promise.resolve(savedSession);
      setWallElapsed(savedTimer!.elapsedSeconds);
      return () => { cancelled = true; };
    }

    // An expired or incompatible signed session cannot verify its old seconds.
    // Start clean rather than showing a value the server would later reject.
    if (savedTimer) {
      clearActivityTimer(timerStorageKey);
      setWallElapsed(0);
    }

    const pending = startTimeTracking(activityKind, componentId, learnerKind, id, trackingMode);
    trackingPromiseRef.current = pending;
    pending
      .then((session) => {
        if (!cancelled) {
          trackingSessionRef.current = session;
          saveActivityTimerSession(timerStorageKey, session);
        }
      })
      .catch((error) => {
        if (!cancelled) setSubmitError(error instanceof Error ? error.message : 'Could not start activity timing');
      });
    return () => { cancelled = true; };
  }, [phase, openable, componentId, kind, id, canProgress, isVideo, trackingMode, timerStorageKey]);

  // Only visible time counts. Supported videos must also actually be playing;
  // iframe-only players use the explicit visible-page fallback.
  useEffect(() => {
    if (phase !== 'consume' || (!unsupported && !playerPlaying)) return;
    timerRef.current = setInterval(() => {
      if (document.visibilityState === 'visible') {
        setWallElapsed((seconds) => {
          const next = seconds + 1;
          saveActivityTimerElapsed(timerStorageKey, next);
          return next;
        });
      }
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [phase, unsupported, playerPlaying, timerStorageKey]);

  const finishConsuming = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (component?.reflectionRequired === false) {
      setPhase('confirm');
      return;
    }
    setPhase('reflect');
  };

  const confirmCompletion = () => {
    if (!component) return;
    void finalizeSubmit({
      ksbs: (component.ksbMappings || []).map(mapping => mapping.code),
      feedback: '',
      reportedTime: plannedTimeLabel,
    });
  };

  const finalizeSubmit = async (reflection: { ksbs: string[]; feedback: string; reportedTime: string }) => {
    if (!component || !componentId || !kind || !id || submitting || !canProgress) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const tracking = trackingSessionRef.current || await trackingPromiseRef.current;
      if (!tracking) throw new Error('Activity timing did not start. Reopen the activity and try again.');
      if (isVideo) {
        const res = await submitVideoProgress(componentId, kind as 'commercial' | 'apprenticeship', id, {
          week: weekTitle || null, module: moduleTitle || null,
          startedAt: tracking.startedAt, timeTakenSeconds: submittedTimeSeconds, trackingToken: tracking.trackingToken,
          videoTitle: meta?.detail || meta?.label || 'Video',
          ksbs: reflection.ksbs, feedback: reflection.feedback, reportedTime: reflection.reportedTime,
        });
        setRecord({ timeTaken: res.record.timeTaken, ksbs: res.record.ksbs, reportedTime: res.record.reportedTime, feedback: res.record.feedback });
      } else {
        const res = await submitComponentProgress(componentId, kind as 'commercial' | 'apprenticeship', id, {
          week: weekTitle || null, module: moduleTitle || null,
          startedAt: tracking.startedAt, timeTakenSeconds: submittedTimeSeconds, trackingToken: tracking.trackingToken,
          componentTitle: pageTitle, componentType: component.type || undefined,
          ksbs: reflection.ksbs, feedback: reflection.feedback, reportedTime: reflection.reportedTime,
        });
        setRecord({ timeTaken: res.record.timeTaken, ksbs: res.record.ksbs, reportedTime: res.record.reportedTime, feedback: res.record.feedback });
      }
      clearActivityTimer(timerStorageKey);
      if (isDemoAccount && demoKey) {
        setDemoTimeOverride(
          demoScopeKey,
          demoKey,
          timeSource === 'input' && manualTimeSeconds != null ? manualTimeSeconds / 60 : null,
        );
      }
      setWallElapsed(0);
      setManualTimeSeconds(null);
      setTimeSource('timer');
      const refreshed = await fetchLearnerDetail(kind as LearnerKind, id);
      setDetail(refreshed);
      setPhase('consume');
      const nextHref = nextActivityRoute(refreshed, componentId, kind, id);
      if (nextHref) navigate(nextHref, { replace: true });
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
      hideBreadcrumbs
    >
      <div className="p-3 md:p-6 max-w-6xl mx-auto">
        <button
          onClick={() => navigate(backHref)}
          className="mb-5 inline-flex items-center gap-2 rounded-xl border border-background-300 bg-white px-4 py-2.5 text-[13px] font-semibold text-foreground-700 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary-200 hover:text-primary-700 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300 cursor-pointer"
        >
          <span className="grid h-6 w-6 place-items-center rounded-lg bg-primary-50 text-primary-700">
            <AppIcon className="ri-arrow-left-line text-sm" />
          </span>
          Back to training plan
        </button>

        {loading ? (
          <div className="bg-background-50 rounded-2xl border border-foreground-200/60 p-5"><RowsSkeleton rows={4} avatar={false} /></div>
        ) : loadError ? (
          <div className="bg-background-50 rounded-2xl border border-foreground-200/60 p-6"><EmptyState text={loadError} /></div>
        ) : !component ? (
          <div className="bg-background-50 rounded-2xl border border-foreground-200/60 p-6"><EmptyState text="Component not found in this learner's plan." /></div>
        ) : !canProgress ? (
          <ReadOnlyLearnerNotice what="complete their own training-plan activities" onBack={() => navigate(backHref)} />
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
              reflectionQuestion={component.reflectionQuestion}
              onClose={() => navigate(backHref)}
            />
          </div>
        ) : (
          /* ── consume phase: content + details + sidebar ── */
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6 items-start">
            <div className="min-w-0">
              <ComponentContent component={component} contentKind={contentKind} parsed={parsed} title={pageTitle}
                onDuration={(d) => setRealDuration((prev) => prev ?? d)}
                onProgress={() => undefined}
                onPlayingChange={setPlayerPlaying}
                onEnded={finishConsuming}
                onUnsupported={() => setUnsupported(true)}
                evidenceContext={null}
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
                  <div className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl font-mono text-sm font-semibold tabular-nums bg-background-100 text-foreground-700" title="Time on this activity">
                    <AppIcon className="ri-timer-line" /> {formatClock(elapsedSeconds)}
                  </div>
                  <ActivityTimeSpentInput
                    onChange={(seconds) => {
                      setManualTimeSeconds(seconds);
                      setTimeSource(seconds == null ? 'timer' : 'input');
                    }}
                  />
                  {activityEvidenceContext && canProgress && (
                    evidenceFileLabel ? (
                      <button
                        type="button"
                        onClick={() => {
                          if (visibleEvidenceFile?.status === 'approved') void openEvidenceFile(visibleEvidenceFile);
                        }}
                        disabled={visibleEvidenceFile?.status !== 'approved'}
                        className="inline-flex max-w-[220px] items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800 transition-colors enabled:cursor-pointer enabled:hover:border-emerald-300 enabled:hover:bg-emerald-100 disabled:cursor-default"
                        title={evidenceFileLabel}
                      >
                        <AppIcon className={evidenceFileStatus === 'approved' ? 'ri-file-check-line' : 'ri-file-line'} />
                        <span className="truncate">{evidenceFileLabel}</span>
                        {evidenceFileStatus === 'pending' && (
                          <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">Scanning</span>
                        )}
                      </button>
                    ) : (
                      <label
                        htmlFor={evidenceInputId}
                        className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-primary-200 bg-white px-4 py-2 text-sm font-semibold text-primary-700 transition-colors hover:border-primary-300 hover:bg-primary-50"
                      >
                        <AppIcon className="ri-upload-2-line" />
                        Upload evidence
                      </label>
                    )
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
                    Finish
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

              {activityEvidenceContext && canProgress && (
                <AssignmentEvidence
                  kind={activityEvidenceContext.kind}
                  learnerId={activityEvidenceContext.learnerId}
                  componentId={activityEvidenceContext.componentId}
                  trainingPlanDetails={activityEvidenceContext.trainingPlanDetails}
                  onUploaded={activityEvidenceContext.onUploaded}
                  onFileSelected={setPendingEvidenceFileName}
                  inputId={evidenceInputId}
                  showPanel={false}
                />
              )}
            </div>

            {/* Sidebar: week components + other weeks */}
            <aside className="space-y-4 lg:sticky lg:top-4">
              <div className="rounded-xl border border-background-300 bg-white overflow-hidden">
                <div className="px-4 py-3 border-b border-background-300">
                  <h2 className="text-sm font-heading font-bold text-foreground-800">{weekTitle || 'This week'}</h2>
                  <p className="text-[11px] text-foreground-400 mt-0.5">
                    {ctx?.weekComponents.length ?? 0} components{' '}
                    {weekDoneCount > 0 && <span className="text-emerald-600 font-semibold"> · {weekDoneCount} done</span>}
                  </p>
                </div>
                <ul className="divide-y divide-background-300">
                  {(ctx?.weekComponents ?? []).map((c) => {
                    const cm = componentTypeMeta(c.title);
                    const isCurrent = !c.isQuiz && c.componentId === componentId;
                    const contentAvailable = hasComponentContent(c);
                    const clickable = contentAvailable && isNavigableComponent(c) && !isCurrent;
                    const attempts = c.isQuiz ? (c.quizAttempts || []) : [];
                    const lastAttempt = attempts.length > 0 ? attempts[attempts.length - 1] : null;
                    const completed = isComponentComplete(c, completedIds);
                    const timeKey = c.componentId
                      ? demoTimeKey({ isQuiz: c.isQuiz, quizId: c.quizMeta?.quizId, componentId: c.componentId })
                      : '';
                    const overrideMinutes = timeKey ? demoTimeOverrides[timeKey] : null;
                    const completionTime = completed
                      ? overrideMinutes != null
                        ? formatClock(Math.round(overrideMinutes * 60))
                        : completionTimeFor(c, detail)
                      : null;
                    return (
                      <li key={c.componentId || c.title}>
                        <button
                          disabled={!clickable}
                          onClick={() => clickable && navigate(componentRoute(kind, id, c, moduleTitle, weekTitle))}
                          className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-left transition-colors ${
                            !contentAvailable
                              ? 'cursor-not-allowed bg-background-100/70 opacity-55 grayscale'
                              : isCurrent
                                ? 'bg-primary-50'
                                : completed
                                  ? `bg-emerald-50/70 ${clickable ? 'hover:bg-emerald-50 cursor-pointer' : 'cursor-default'}`
                                  : clickable ? 'hover:bg-background-50 cursor-pointer' : 'cursor-default'
                          }`}
                        >
                          <span className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${completed ? 'bg-emerald-100' : cm.bg}`}>
                            <AppIcon className={completed ? 'ri-check-line text-[12px] text-emerald-700' : `${cm.icon} text-[12px] ${cm.color}`} />
                          </span>
                          <span className="flex-1 min-w-0">
                            <span className="block text-[9px] font-semibold uppercase tracking-wider text-foreground-400">{cm.label}</span>
                            <span className={`block text-[13px] font-semibold leading-snug truncate ${
                              isCurrent ? 'text-primary-700' : completed ? 'text-emerald-900' : 'text-foreground-800'
                            }`}>
                              {cm.detail || cm.label}
                            </span>
                            {completionTime && !isDemoAccount && (
                              <span className="mt-0.5 flex items-center gap-1 font-mono text-[10px] font-semibold tabular-nums text-emerald-700" title="Time taken">
                                <AppIcon className="ri-timer-line text-[10px]" />
                                {completionTime}
                              </span>
                            )}
                          </span>
                          {c.isQuiz && lastAttempt && (
                            <span className={`shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                              lastAttempt.passed ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
                            }`}>
                              {gradePercent(lastAttempt.grade)}%
                            </span>
                          )}
                          {!contentAvailable ? (
                            <AppIcon className="ri-lock-line shrink-0 text-sm text-foreground-400" />
                          ) : completed ? (
                            <AppIcon className="ri-checkbox-circle-fill text-emerald-600 text-sm shrink-0" />
                          ) : isCurrent ? (
                            <AppIcon className="ri-focus-3-line text-primary-600 text-sm shrink-0" />
                          ) : clickable ? (
                            <AppIcon className="ri-arrow-right-s-line text-foreground-400 text-sm shrink-0" />
                          ) : null}
                        </button>
                        {completed && isDemoAccount && timeKey && (
                          <CompletionTimeInput
                            value={completionTime || '00:00:00'}
                            label={overrideMinutes != null ? 'Input' : 'Time taken'}
                            rightAddon={
                              !c.isQuiz && c.componentId && kind && id ? (
                                <EvidenceFilesButton kind={kind as LearnerKind} learnerId={id} componentId={c.componentId} />
                              ) : null
                            }
                            onSave={(seconds) => setDemoTimeOverride(
                              demoScopeKey,
                              timeKey,
                              seconds == null ? null : seconds / 60,
                            )}
                          />
                        )}
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
                    {(ctx?.weeks ?? []).map((w) => {
                      const weekComplete = w.count > 0 && w.completed >= w.count;
                      const navigable = w.components.filter((item) => hasComponentContent(item) && isNavigableComponent(item));
                      const target = navigable.find((item) => !isComponentComplete(item, completedIds)) || navigable[0] || null;
                      return (
                        <li key={w.week}>
                          <button
                            disabled={!target}
                            onClick={() => target && navigate(componentRoute(kind, id, target, moduleTitle, w.week))}
                            className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-left transition-colors ${
                              !target
                                ? 'cursor-not-allowed bg-background-100/70 opacity-55'
                                : weekComplete
                                ? 'bg-emerald-50 text-emerald-900 hover:bg-emerald-100'
                                : w.active ? 'bg-background-100' : 'hover:bg-background-50 cursor-pointer'
                            }`}
                          >
                            <span className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                              weekComplete ? 'bg-emerald-100 text-emerald-700' : 'bg-background-100 text-foreground-500'
                            }`}>
                              <AppIcon className={`${weekComplete ? 'ri-check-line' : 'ri-calendar-line'} text-[12px]`} />
                            </span>
                            <span className="flex-1 min-w-0">
                              <span className={`block text-[13px] font-semibold leading-snug truncate ${
                                weekComplete ? 'text-emerald-900' : w.active ? 'text-foreground-900' : 'text-foreground-700'
                              }`}>
                                {w.week}
                              </span>
                              <span className={`block text-[10px] ${weekComplete ? 'text-emerald-700' : 'text-foreground-400'}`}>
                                {w.count} components{weekComplete ? ' complete' : ''}
                              </span>
                            </span>
                            {!target ? (
                              <AppIcon className="ri-lock-line shrink-0 text-sm text-foreground-400" />
                            ) : weekComplete ? (
                              <span className="text-[10px] font-semibold text-emerald-700 shrink-0">Done</span>
                            ) : w.active && (
                              <span className="text-[10px] font-semibold text-primary-600 shrink-0">Current</span>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </aside>
          </div>
        )}
        {phase === 'confirm' && (
          <CompletionConfirmPopup
            title={pageTitle}
            noun={noun}
            timerLabel={formatClock(elapsedSeconds)}
            inputLabel={manualTimeSeconds == null ? null : formatClock(manualTimeSeconds)}
            selectedSource={timeSource}
            evidenceFileName={evidenceFileLabel}
            submitting={submitting}
            error={submitError}
            onSelectSource={setTimeSource}
            onCancel={() => setPhase('consume')}
            onConfirm={confirmCompletion}
          />
        )}
        {evidencePreview && (
          <EvidencePreviewModal preview={evidencePreview} onClose={() => setEvidencePreview(null)} />
        )}
      </div>
    </WorkspaceShell>
  );
}

function CompletionConfirmPopup({
  title,
  noun,
  timerLabel,
  inputLabel,
  selectedSource,
  evidenceFileName,
  submitting,
  error,
  onSelectSource,
  onCancel,
  onConfirm,
}: {
  title: string; noun: string; timerLabel: string; inputLabel: string | null; selectedSource: TimeSource; evidenceFileName?: string | null;
  submitting: boolean; error: string | null;
  onSelectSource: (source: TimeSource) => void; onCancel: () => void; onConfirm: () => void;
}) {
  const selectedTimeLabel = selectedSource === 'input' && inputLabel ? inputLabel : timerLabel;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-foreground-950/35 px-4 py-6 backdrop-blur-[2px]">
      <div className="w-full max-w-md rounded-2xl border border-background-300 bg-white p-6 text-center shadow-2xl">
        <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-primary-100">
          <AppIcon className="ri-question-line text-2xl text-primary-700" />
        </div>
        <h1 className="text-lg font-heading font-bold text-foreground-900">
          Confirm {noun} completion?
        </h1>
        <p className="mt-1 text-sm text-foreground-500">{title}</p>

        <div className="mt-5 space-y-3 rounded-xl border border-background-300 bg-background-50 p-4 text-left">
          <div className="flex items-center justify-between gap-3 border-b border-background-300 pb-3">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground-500">Save time</span>
            <span className="font-mono text-base font-bold tabular-nums text-foreground-900">{selectedTimeLabel}</span>
          </div>
          {evidenceFileName && (
            <div className="flex items-center justify-between gap-3 border-b border-background-300 pb-3">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground-500">Evidence</span>
              <span className="min-w-0 truncate text-right text-sm font-semibold text-emerald-700" title={evidenceFileName}>
                <AppIcon className="ri-attachment-2 mr-1" />
                {evidenceFileName}
              </span>
            </div>
          )}
          <button
            type="button"
            onClick={() => onSelectSource('timer')}
            disabled={submitting}
            className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition-colors ${
              selectedSource === 'timer'
                ? 'border-primary-300 bg-primary-50 text-primary-800'
                : 'border-background-300 bg-white text-foreground-700 hover:bg-background-50'
            } disabled:cursor-not-allowed disabled:opacity-60`}
          >
            <span className="inline-flex items-center gap-2 text-sm font-semibold">
              <AppIcon className="ri-timer-line" />
              Timer
            </span>
            <span className="font-mono text-sm font-bold tabular-nums">{timerLabel}</span>
          </button>
          <button
            type="button"
            onClick={() => inputLabel && onSelectSource('input')}
            disabled={!inputLabel || submitting}
            className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition-colors ${
              selectedSource === 'input' && inputLabel
                ? 'border-primary-300 bg-primary-50 text-primary-800'
                : 'border-background-300 bg-white text-foreground-700 hover:bg-background-50'
            } disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-white`}
          >
            <span className="inline-flex items-center gap-2 text-sm font-semibold">
              <AppIcon className="ri-edit-2-line" />
              Input
            </span>
            <span className="font-mono text-sm font-bold tabular-nums">{inputLabel || '--:--:--'}</span>
          </button>
        </div>

        {error && (
          <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-left text-xs font-semibold text-red-700">
            {error}
          </p>
        )}

        <div className="mt-5 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="inline-flex items-center justify-center rounded-xl border border-background-300 bg-white px-4 py-3 text-sm font-semibold text-foreground-700 shadow-sm transition-colors hover:bg-background-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={submitting}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <AppIcon className={submitting ? 'ri-loader-4-line animate-spin' : 'ri-check-line'} />
            {submitting ? 'Saving...' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   LINK CLASSIFICATION — authored URLs are free text (an
   external listening page, a direct file, a Google Slides
   link, …). Detect what we can actually embed/play inline
   vs. what only supports a "open in new tab" fallback.
   ═══════════════════════════════════════════════════════ */
const AUDIO_FILE_RE = /\.(mp3|wav|ogg|m4a|aac|flac)(\?.*)?$/i;
const IMAGE_FILE_RE = /\.(png|jpe?g|gif|webp|bmp|svg)(\?.*)?$/i;
const VIDEO_FILE_RE = /\.(mp4|webm|ogg|mov|m4v)(\?.*)?$/i;
const PDF_FILE_RE = /\.pdf(\?.*)?$/i;
const WORD_FILE_RE = /\.docx(\?.*)?$/i;
const EXCEL_FILE_RE = /\.(xlsx|xls|csv)(\?.*)?$/i;
const TEXT_FILE_RE = /\.(txt|md|rtf)(\?.*)?$/i;

function googleDriveFileId(url: string): string | null {
  const match =
    url.match(/drive\.google\.com\/file\/d\/([\w-]{10,})/) ||
    url.match(/drive\.google\.com\/open\?id=([\w-]{10,})/) ||
    url.match(/drive\.google\.com\/uc\?[^#]*id=([\w-]{10,})/);
  return match?.[1] ?? null;
}

function legacyAttachmentId(url: string): string | null {
  const match = url.match(/\/_legacy_files\/([0-9]{1,20})\//);
  return match?.[1] ?? null;
}

function legacyAttachmentProxyUrl(url: string): string | null {
  const id = legacyAttachmentId(url);
  return id ? `/learner_api/media/legacy-attachment/${id}/` : null;
}

function proxiedMaterialUrl(url: string): string {
  const driveId = googleDriveFileId(url);
  return driveId ? `/learner_api/media/google-drive/${driveId}/` : (legacyAttachmentProxyUrl(url) || url);
}

function displayableMediaSource(url: string, fileName?: string | null): { kind: 'image' | 'video'; src: string } | null {
  const probe = `${fileName || ''} ${url}`;
  const src = proxiedMaterialUrl(url);
  if (IMAGE_FILE_RE.test(probe)) return { kind: 'image', src };
  if (VIDEO_FILE_RE.test(probe)) return { kind: 'video', src };
  return null;
}

function directAudioSource(url: string, fileName?: string | null): string | null {
  const probe = `${fileName || ''} ${url}`;
  if (AUDIO_FILE_RE.test(probe) || googleDriveFileId(url)) return proxiedMaterialUrl(url);
  return null;
}

function fileProbe(url: string, fileName?: string | null): string {
  return `${fileName || ''} ${url}`.split(/[?#]/)[0];
}

function fileLabelFrom(url: string, fileName?: string | null): string {
  if (fileName) return decodeInlineText(fileName);
  try {
    const parsed = new URL(url, window.location.origin);
    return decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() || 'Attached file');
  } catch {
    return 'Attached file';
  }
}

type AttachmentPreviewState =
  | { status: 'loading' }
  | { status: 'ready'; kind: 'html'; html: string }
  | { status: 'ready'; kind: 'text'; text: string }
  | { status: 'error'; message: string };

function InlineMediaPreview({ url, title, fileName }: { url: string; title: string; fileName?: string | null }) {
  const media = displayableMediaSource(url, fileName);
  if (!media) return null;
  if (media.kind === 'image') {
    return (
      <div className="overflow-hidden rounded-xl border border-background-300 bg-background-950/95 p-3">
        <img src={media.src} alt={title} className="mx-auto max-h-[70vh] max-w-full rounded-lg object-contain" />
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-xl border border-background-300 bg-black">
      <video src={media.src} controls preload="metadata" className="mx-auto max-h-[70vh] w-full bg-black" />
    </div>
  );
}

function decodeInlineText(value: string): string {
  return value
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function AttachedFileCard({ url, fileName }: { url: string; fileName?: string | null }) {
  const href = proxiedMaterialUrl(url);
  return (
    <div className="rounded-xl border border-background-300 bg-background-50 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-blue-100 text-blue-700">
            <AppIcon className="ri-file-excel-2-line text-lg" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-foreground-900">{fileLabelFrom(url, fileName)}</p>
            <p className="text-xs text-foreground-500">Preview is not available for this file type.</p>
          </div>
        </div>
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl bg-primary-600 px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-primary-700"
        >
          <AppIcon className="ri-external-link-line" />
          Open file
        </a>
      </div>
    </div>
  );
}

function InlineAttachmentPreview({ url, title, fileName }: { url: string; title: string; fileName?: string | null }) {
  const media = displayableMediaSource(url, fileName);
  const previewUrl = proxiedMaterialUrl(url);
  const legacyId = legacyAttachmentId(url);
  const probe = fileProbe(url, fileName);
  const isPdf = PDF_FILE_RE.test(probe);
  const isWord = WORD_FILE_RE.test(probe);
  const isExcel = EXCEL_FILE_RE.test(probe);
  const isText = TEXT_FILE_RE.test(probe);
  const canParseInline = isWord || isExcel || isText;
  const [preview, setPreview] = useState<AttachmentPreviewState | null>(canParseInline ? { status: 'loading' } : null);

  useEffect(() => {
    if (!canParseInline) {
      setPreview(null);
      return;
    }

    let cancelled = false;
    setPreview({ status: 'loading' });

    async function loadPreview() {
      try {
        const response = await fetch(previewUrl, { credentials: 'same-origin' });
        if (!response.ok) throw new Error(`File request failed (${response.status})`);

        if (isWord) {
          const arrayBuffer = await response.arrayBuffer();
          const mammoth = await import('mammoth');
          const result = await mammoth.convertToHtml({ arrayBuffer });
          if (!cancelled) {
            setPreview({ status: 'ready', kind: 'html', html: DOMPurify.sanitize(result.value || '<p>No preview content found.</p>') });
          }
          return;
        }

        if (isExcel) {
          const arrayBuffer = await response.arrayBuffer();
          const XLSX = await import('xlsx');
          const workbook = XLSX.read(arrayBuffer, { type: 'array' });
          const sheetName = workbook.SheetNames[0];
          const sheet = sheetName ? workbook.Sheets[sheetName] : null;
          const html = sheet
            ? XLSX.utils.sheet_to_html(sheet, { id: 'learner-inline-sheet-preview' })
            : '<p>No worksheet found.</p>';
          if (!cancelled) setPreview({ status: 'ready', kind: 'html', html: DOMPurify.sanitize(html) });
          return;
        }

        const text = await response.text();
        if (!cancelled) setPreview({ status: 'ready', kind: 'text', text });
      } catch (error) {
        if (!cancelled) {
          setPreview({
            status: 'error',
            message: error instanceof Error ? error.message : 'Could not preview this file.',
          });
        }
      }
    }

    void loadPreview();

    return () => {
      cancelled = true;
    };
  }, [canParseInline, isExcel, isText, isWord, previewUrl]);

  if (media) return <InlineMediaPreview url={url} title={title} fileName={fileName} />;

  if (isPdf) {
    if (legacyId) return <LegacyPdfImagePreview attachmentId={legacyId} title={title} fileName={fileName} />;
    const hostedPdfEmbed = resolveDocEmbed(previewUrl);
    if (hostedPdfEmbed.mode === 'deck') return <DocumentEmbed url={previewUrl} title={title} />;
    return <PdfCanvasPreview url={previewUrl} title={title} fileName={fileName} />;
  }

  if (preview?.status === 'loading') {
    return (
      <div className="grid min-h-[280px] place-items-center rounded-xl border border-background-300 bg-white text-sm font-semibold text-foreground-500 shadow-sm">
        <span className="inline-flex items-center gap-2"><AppIcon className="ri-loader-4-line animate-spin" />Loading file preview...</span>
      </div>
    );
  }

  if (preview?.status === 'ready' && preview.kind === 'html') {
    return (
      <div className="max-h-[72vh] overflow-auto rounded-xl border border-background-300 bg-white p-6 shadow-sm">
        <div
          className="learner-file-preview max-w-none text-sm leading-relaxed text-foreground-800 [&_h1]:mb-3 [&_h1]:text-2xl [&_h1]:font-bold [&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:text-xl [&_h2]:font-bold [&_h3]:mb-2 [&_h3]:mt-3 [&_h3]:text-lg [&_h3]:font-semibold [&_p]:mb-3 [&_ul]:mb-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:mb-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-background-300 [&_td]:px-3 [&_td]:py-2 [&_th]:border [&_th]:border-background-300 [&_th]:bg-background-100 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left"
          dangerouslySetInnerHTML={{ __html: preview.html }}
        />
      </div>
    );
  }

  if (preview?.status === 'ready' && preview.kind === 'text') {
    return (
      <pre className="max-h-[72vh] overflow-auto whitespace-pre-wrap rounded-xl border border-background-300 bg-white p-6 text-sm leading-relaxed text-foreground-800 shadow-sm">
        {preview.text}
      </pre>
    );
  }

  if (preview?.status === 'error') {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="font-bold">Could not show this file inline.</p>
        <p className="mt-1 text-xs">{preview.message}</p>
      </div>
    );
  }

  return (
    <>
      <DocumentEmbed url={url} title={title} />
      <div className="mt-3">
        <AttachedFileCard url={url} fileName={fileName} />
      </div>
    </>
  );
}

function LegacyPdfImagePreview({ attachmentId, title, fileName }: { attachmentId: string; title: string; fileName?: string | null }) {
  const [pageNumber, setPageNumber] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const infoUrl = `/learner_api/media/legacy-attachment/${attachmentId}/pdf-info/`;
  const pageUrl = `/learner_api/media/legacy-attachment/${attachmentId}/pdf-page/${pageNumber}/`;

  useEffect(() => {
    let cancelled = false;
    async function loadInfo() {
      try {
        setStatus('loading');
        setError(null);
        const response = await fetch(infoUrl, { credentials: 'same-origin' });
        if (!response.ok) throw new Error(`File request failed (${response.status})`);
        const data = await response.json() as { pages?: number };
        if (!cancelled) {
          setPageCount(Math.max(1, Number(data.pages) || 1));
          setStatus('ready');
        }
      } catch (loadError) {
        if (!cancelled) {
          setStatus('error');
          setError(loadError instanceof Error ? loadError.message : 'Could not load PDF preview.');
        }
      }
    }
    void loadInfo();
    return () => {
      cancelled = true;
    };
  }, [infoUrl]);

  if (status === 'loading') {
    return (
      <div className="grid min-h-[420px] place-items-center rounded-xl border border-background-300 bg-white text-sm font-semibold text-foreground-500 shadow-sm">
        <span className="inline-flex items-center gap-2"><AppIcon className="ri-loader-4-line animate-spin" />Loading PDF preview...</span>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="font-bold">Could not show this PDF inline.</p>
        <p className="mt-1 text-xs">{error || 'Could not load PDF pages.'}</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-background-300 bg-background-100 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-background-300 bg-white px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-foreground-900">{fileLabelFrom('', fileName) || title}</p>
          <p className="text-xs text-foreground-500">Page {pageNumber} of {pageCount}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPageNumber((value) => Math.max(1, value - 1))}
            disabled={pageNumber <= 1}
            className="grid h-9 w-9 place-items-center rounded-lg border border-background-300 bg-white text-foreground-700 hover:bg-background-50 disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Previous page"
          >
            <AppIcon className="ri-arrow-left-s-line" />
          </button>
          <button
            type="button"
            onClick={() => setPageNumber((value) => Math.min(pageCount, value + 1))}
            disabled={pageNumber >= pageCount}
            className="grid h-9 w-9 place-items-center rounded-lg border border-background-300 bg-white text-foreground-700 hover:bg-background-50 disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Next page"
          >
            <AppIcon className="ri-arrow-right-s-line" />
          </button>
        </div>
      </div>
      <div className="max-h-[72vh] overflow-auto p-4">
        <img
          key={pageUrl}
          src={pageUrl}
          alt={`${title} page ${pageNumber}`}
          className="mx-auto block max-w-full rounded-lg bg-white shadow-sm"
        />
      </div>
    </div>
  );
}

function PdfCanvasPreview({ url, title, fileName }: { url: string; title: string; fileName?: string | null }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [scale, setScale] = useState(1.25);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let loadedPdf: PDFDocumentProxy | null = null;

    async function loadPdf() {
      try {
        setStatus('loading');
        setError(null);
        const { GlobalWorkerOptions, getDocument } = await import('pdfjs-dist');
        GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
        const response = await fetch(url, {
          credentials: 'same-origin',
          headers: { Accept: 'application/pdf,*/*' },
        });
        if (!response.ok) throw new Error(`File request failed (${response.status})`);
        const buffer = await response.arrayBuffer();
        const document = await getDocument({ data: new Uint8Array(buffer) }).promise;
        loadedPdf = document;
        if (!cancelled) {
          setPdf(document);
          setPageCount(document.numPages);
          setPageNumber(1);
          setStatus('ready');
        }
      } catch (loadError) {
        if (!cancelled) {
          setStatus('error');
          setError(loadError instanceof Error ? loadError.message : 'Could not load PDF preview.');
        }
      }
    }

    void loadPdf();

    return () => {
      cancelled = true;
      void loadedPdf?.cleanup();
    };
  }, [url]);

  useEffect(() => {
    if (!pdf || !canvasRef.current) return;

    let cancelled = false;
    let renderTask: { cancel: () => void; promise: Promise<void> } | null = null;

    async function renderPage() {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const page = await pdf.getPage(pageNumber);
      if (cancelled) return;
      const viewport = page.getViewport({ scale });
      const context = canvas.getContext('2d');
      if (!context) return;

      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = '100%';
      canvas.style.height = 'auto';
      context.clearRect(0, 0, canvas.width, canvas.height);

      renderTask = page.render({ canvas, canvasContext: context, viewport });
      await renderTask.promise.catch((renderError: unknown) => {
        if (!cancelled && !(renderError instanceof Error && renderError.name === 'RenderingCancelledException')) {
          throw renderError;
        }
      });
    }

    void renderPage().catch((renderError: unknown) => {
      if (!cancelled) {
        setStatus('error');
        setError(renderError instanceof Error ? renderError.message : 'Could not render PDF page.');
      }
    });

    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [pageNumber, pdf, scale]);

  if (status === 'loading') {
    return (
      <div className="grid min-h-[420px] place-items-center rounded-xl border border-background-300 bg-white text-sm font-semibold text-foreground-500 shadow-sm">
        <span className="inline-flex items-center gap-2"><AppIcon className="ri-loader-4-line animate-spin" />Loading PDF preview...</span>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="font-bold">Could not show this PDF inline.</p>
        <p className="mt-1 text-xs">{error || fileLabelFrom(url, fileName)}</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-background-300 bg-background-100 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-background-300 bg-white px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-foreground-900">{fileLabelFrom(url, fileName) || title}</p>
          <p className="text-xs text-foreground-500">Page {pageNumber} of {pageCount || 1}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setScale((value) => Math.max(0.75, value - 0.25))}
            className="grid h-9 w-9 place-items-center rounded-lg border border-background-300 bg-white text-foreground-700 hover:bg-background-50"
            aria-label="Zoom out"
          >
            <AppIcon className="ri-subtract-line" />
          </button>
          <button
            type="button"
            onClick={() => setScale((value) => Math.min(2.5, value + 0.25))}
            className="grid h-9 w-9 place-items-center rounded-lg border border-background-300 bg-white text-foreground-700 hover:bg-background-50"
            aria-label="Zoom in"
          >
            <AppIcon className="ri-add-line" />
          </button>
          <button
            type="button"
            onClick={() => setPageNumber((value) => Math.max(1, value - 1))}
            disabled={pageNumber <= 1}
            className="grid h-9 w-9 place-items-center rounded-lg border border-background-300 bg-white text-foreground-700 hover:bg-background-50 disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Previous page"
          >
            <AppIcon className="ri-arrow-left-s-line" />
          </button>
          <button
            type="button"
            onClick={() => setPageNumber((value) => Math.min(pageCount || 1, value + 1))}
            disabled={pageNumber >= (pageCount || 1)}
            className="grid h-9 w-9 place-items-center rounded-lg border border-background-300 bg-white text-foreground-700 hover:bg-background-50 disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Next page"
          >
            <AppIcon className="ri-arrow-right-s-line" />
          </button>
        </div>
      </div>
      <div className="max-h-[72vh] overflow-auto p-4">
        <canvas ref={canvasRef} className="mx-auto block max-w-full rounded-lg bg-white shadow-sm" />
      </div>
    </div>
  );
}

/** A slide deck / document shown inline where that is possible, and an honest
 * "open it instead" card where it is not — an uploaded .pptx can only be
 * previewed by Microsoft's Office viewer, which cannot reach a file that isn't
 * published on the public internet. See @/lib/docEmbed. */
function DocumentEmbed({ url, title }: { url: string; title: string }) {
  const embed = resolveDocEmbed(url);
  const unavailable = () => null;
  if (embed.mode === 'unavailable') return null;
  if (embed.mode === 'deck') return <SlideDeckViewer src={embed.src} title={title} fallback={unavailable} />;
  return (
    // A 4:3 box on a wide card is taller than the screen, which puts the top of
    // the document above the fold and the controls far below it. The ratio still
    // drives the shape; the window caps how big it gets.
    <div
      className="rounded-xl overflow-hidden border border-background-300"
      style={{ aspectRatio: '4 / 3', maxHeight: 'calc(100vh - 14rem)' }}
    >
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
  onUploaded: (files: EvidenceRecord[]) => void;
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

function ComponentBody({ component, contentKind, parsed, title, onDuration, onProgress, onPlayingChange, onEnded, onUnsupported }: {
  component: JourneyComponent;
  contentKind: ReturnType<typeof componentContentKind>;
  parsed: ReturnType<typeof parseVideoUrl> | null;
  title: string;
  onDuration: (d: number) => void;
  onProgress: (t: number) => void;
  onPlayingChange: (playing: boolean) => void;
  onEnded: () => void;
  onUnsupported: () => void;
}) {
  if (contentKind === 'video' && parsed) {
    return (
      <div className="rounded-2xl overflow-hidden bg-black shadow-sm ring-1 ring-background-300">
        <div className="relative w-full mx-auto" style={{ aspectRatio: '16 / 9', maxHeight: 'calc(100vh - 14rem)' }}>
          <VideoPlayer parsed={parsed} title={title} onDuration={onDuration} onProgress={onProgress} onPlayingChange={onPlayingChange} onEnded={onEnded} onUnsupported={onUnsupported} />
        </div>
      </div>
    );
  }

  if (contentKind === 'audio') {
    const audioSource = component.audioUrl ? directAudioSource(component.audioUrl, component.fileName) : null;
    return (
      <div className="rounded-2xl border border-background-300 bg-gradient-to-br from-violet-50 to-background-50 p-6">
        <div className="flex items-center gap-3 mb-4">
          <span className="w-11 h-11 rounded-xl bg-violet-100 text-violet-600 flex items-center justify-center"><AppIcon className="ri-headphone-line text-xl" /></span>
          <div><p className="text-sm font-semibold text-foreground-900">{title}</p><p className="text-xs text-foreground-400">Listen, then finish and reflect below.</p></div>
        </div>
        {audioSource ? (
          <audio controls preload="metadata" className="w-full" src={audioSource}>Your browser does not support audio playback.</audio>
        ) : component.audioUrl ? (
          <>
            {/* Not a direct media file (e.g. a podcast listening page) — fetch
                and display the page itself in the LMS rather than only linking
                out. Some sites block embedding (X-Frame-Options), so the "open
                in a new tab" link below is always shown, not just a fallback. */}
            <div
              className="rounded-xl overflow-hidden border border-background-300 bg-white"
              style={{ aspectRatio: '16 / 9', maxHeight: 'calc(100vh - 16rem)' }}
            >
              <iframe title={title} src={component.audioUrl} className="w-full h-full" sandbox="allow-scripts allow-same-origin allow-popups allow-forms" />
            </div>
            <p className="text-[11px] text-foreground-400 mt-2">If the player above stays blank, this site doesn&apos;t allow embedding — use the link below instead.</p>
          </>
        ) : (
          <p className="text-sm text-foreground-500">No audio was set for this podcast. You can still record your reflection below.</p>
        )}
        {component.audioUrl && (
          <a href={proxiedMaterialUrl(component.audioUrl)} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-violet-600 hover:text-violet-700"><AppIcon className="ri-external-link-line" />Open in a new tab</a>
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
            <InlineAttachmentPreview url={component.resourceUrl} title={title} fileName={component.fileName} />
          </div>
        ) : !component.contentHtml && (
          <p className="text-sm text-foreground-500">No reading content was set. You can still record your reflection below.</p>
        )}
        {component.audioUrl && (
          <div className="mt-4 pt-4 border-t border-background-200">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-foreground-400 mb-2">Audio version</p>
            <audio controls preload="metadata" className="w-full" src={proxiedMaterialUrl(component.audioUrl)} />
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
          <InlineAttachmentPreview url={component.resourceUrl} title={title} fileName={component.fileName} />
        ) : (
          <p className="text-sm text-foreground-500">{component.fileName ? <>Slide deck: <span className="font-semibold text-foreground-700">{component.fileName}</span>. </> : ''}Review your slide deck for this week, then record your reflection below.</p>
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
              <a href={component.liveSessionUrl} target="_blank" rel="noreferrer" className="meeting-join-action inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl px-5 text-[12px] font-black shadow-lg transition-transform hover:-translate-y-0.5">
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
        <div className="space-y-3">
          <InlineAttachmentPreview url={component.resourceUrl} title={title} fileName={component.fileName} />
        </div>
      )}
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
