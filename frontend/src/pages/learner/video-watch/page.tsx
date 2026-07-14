import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { EmptyState } from '@/pages/users/components/ui';
import { fetchLearnerDetail, type LearnerDetail, type LearnerKind, type LearnerKsbItem } from '@/api/learnerDetail';
import { submitVideoProgress, type VideoProgressRecord } from '@/api/videos';
import { buildLearnerJourney, componentTypeMeta, type JourneyComponent } from '@/utils/learnerJourney';
import { ReflectionWindow, formatClock } from '@/components/feature/ReflectionWindow';
import { VideoPlayer, parseVideoUrl } from '@/components/feature/VideoPlayer';

const learnerNav = roleNavMap.learner;

type Phase = 'watch' | 'reflect' | 'results';

interface FoundContext {
  component: JourneyComponent;
  moduleTitle: string;
  weekTitle: string;
  weekComponents: JourneyComponent[];
  weeks: { week: string; count: number; active: boolean }[];
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

export default function VideoWatchPage() {
  const { kind, id, componentId } = useParams<{ kind: string; id: string; componentId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [detail, setDetail] = useState<LearnerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [phase, setPhase] = useState<Phase>('watch');
  const [startedAt, setStartedAt] = useState<string | null>(null);
  // Real playback state, driven by the player (YouTube API / <video> events).
  const [realDuration, setRealDuration] = useState<number | null>(null); // true video length (s)
  const [currentTime, setCurrentTime] = useState(0);                     // real playback position (s)
  const [unsupported, setUnsupported] = useState(false);                 // no progress events (Vimeo/unknown)
  const [wallElapsed, setWallElapsed] = useState(0);                     // fallback wall-clock counter
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [record, setRecord] = useState<VideoProgressRecord | null>(null);
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
      .catch((e) => { if (!cancelled) setLoadError(e instanceof Error ? e.message : 'Could not load video'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [kind, id]);

  const ctx = useMemo(() => (componentId ? locate(detail, componentId) : null), [detail, componentId]);
  const video = ctx?.component ?? null;
  const meta = video ? componentTypeMeta(video.title) : null;
  const learnerKsbs: LearnerKsbItem[] = detail?.ksbs ?? [];

  const moduleTitle = ctx?.moduleTitle ?? searchParams.get('module') ?? '';
  const weekTitle = ctx?.weekTitle ?? searchParams.get('week') ?? '';
  const backHref = kind && id ? `/learner/training-plan/${kind}/${id}` : '/learner/training-plan';
  const parsed = useMemo(() => (video?.videoUrl ? parseVideoUrl(video.videoUrl) : null), [video?.videoUrl]);

  // Timer display: real remaining time from the player when known; otherwise
  // (Vimeo / unsupported) fall back to a wall-clock count-up.
  const remaining = realDuration !== null ? Math.max(0, Math.round(realDuration - currentTime)) : null;
  // Time recorded on the attempt = real watched position, or wall-clock in fallback.
  const elapsedSeconds = unsupported ? wallElapsed : Math.round(currentTime);
  // "Planned" preset offered in the reflection window = the video's real length
  // if the player reported it, else the authored durationMinutes.
  const plannedTimeLabel = realDuration !== null
    ? formatClock(realDuration)
    : video?.durationMinutes ? `${video.durationMinutes} min` : '';

  // Stamp the start time once we're watching a playable video.
  useEffect(() => {
    if (phase === 'watch' && video?.videoUrl && startedAt === null) {
      setStartedAt(new Date().toISOString());
    }
  }, [phase, video?.videoUrl, startedAt]);

  // Fallback wall-clock: only runs when the player can't report progress.
  useEffect(() => {
    if (phase !== 'watch' || !unsupported) return;
    timerRef.current = setInterval(() => setWallElapsed((s) => s + 1), 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [phase, unsupported]);

  const finishWatching = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    setPhase('reflect');
  };

  const finalizeSubmit = async (reflection: { ksbs: string[]; feedback: string; reportedTime: string }) => {
    if (!video || !componentId || !kind || !id || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await submitVideoProgress(componentId, kind as 'commercial' | 'apprenticeship', id, {
        week: weekTitle || null,
        module: moduleTitle || null,
        startedAt: startedAt || new Date().toISOString(),
        timeTakenSeconds: elapsedSeconds,
        videoTitle: meta?.detail || meta?.label || 'Video',
        ksbs: reflection.ksbs,
        feedback: reflection.feedback,
        reportedTime: reflection.reportedTime,
      });
      setRecord(res.record);
      setPhase('results');
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Could not save progress');
    } finally {
      setSubmitting(false);
    }
  };

  const pageTitle = meta?.detail || meta?.label || 'Video';

  return (
    <WorkspaceShell
      role="learner"
      roleLabel={learnerNav.label}
      navItems={learnerNav.items}
      workspaceLabel={learnerNav.workspaceLabel}
      pageTitle={pageTitle}
      pageSubtitle={[moduleTitle, weekTitle].filter(Boolean).join(' · ')}
      userName="Learner"
      userRole="Learner"
    >
      <div className="p-3 md:p-6 max-w-6xl mx-auto">
        <button
          onClick={() => navigate(backHref)}
          className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-semibold text-foreground-500 hover:text-foreground-800 transition-colors cursor-pointer"
        >
          <i className="ri-arrow-left-line" /> Back to training plan
        </button>

        {loading ? (
          <div className="bg-background-50 rounded-2xl border border-foreground-200/60 p-6"><EmptyState text="Loading video…" /></div>
        ) : loadError ? (
          <div className="bg-background-50 rounded-2xl border border-foreground-200/60 p-6"><EmptyState text={loadError} /></div>
        ) : !video ? (
          <div className="bg-background-50 rounded-2xl border border-foreground-200/60 p-6"><EmptyState text="Video not found in this learner's plan." /></div>
        ) : !video.videoUrl || !parsed ? (
          <div className="bg-background-50 rounded-2xl border border-foreground-200/60 p-6"><EmptyState text="This video has no playable URL yet." /></div>
        ) : phase === 'reflect' ? (
          <div className="max-w-3xl mx-auto">
            <ReflectionWindow
              noun="video"
              plannedTimeLabel={plannedTimeLabel}
              learnerKsbs={learnerKsbs}
              elapsedSeconds={elapsedSeconds}
              submitting={submitting}
              submitError={submitError}
              onSubmit={finalizeSubmit}
            />
          </div>
        ) : phase === 'results' && record ? (
          <div className="max-w-3xl mx-auto">
            <ResultsScreen record={record} title={pageTitle} onBack={() => navigate(backHref)} />
          </div>
        ) : (
          /* ── watch phase: player + details + sidebar ── */
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6 items-start">
            <div className="min-w-0">
              <div className="rounded-2xl overflow-hidden bg-black shadow-sm ring-1 ring-background-300">
                <div className="relative w-full" style={{ aspectRatio: '16 / 9' }}>
                  <VideoPlayer
                    parsed={parsed}
                    title={pageTitle}
                    onDuration={(d) => setRealDuration((prev) => prev ?? d)}
                    onProgress={(t) => setCurrentTime(t)}
                    onEnded={finishWatching}
                    onUnsupported={() => setUnsupported(true)}
                  />
                </div>
              </div>

              {/* Title + timer + finish */}
              <div className="mt-4 flex items-start justify-between gap-4 flex-wrap">
                <div className="min-w-0">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-red-600 inline-flex items-center gap-1">
                    <i className="ri-play-circle-line" /> {meta?.label || 'Video'}
                  </span>
                  <h1 className="mt-1 text-xl md:text-2xl font-heading font-bold text-foreground-900 leading-tight">{pageTitle}</h1>
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-[13px] text-foreground-500">
                    {realDuration !== null ? (
                      <span className="inline-flex items-center gap-1"><i className="ri-time-line" />{formatClock(realDuration)}</span>
                    ) : video.durationMinutes != null && (
                      <span className="inline-flex items-center gap-1"><i className="ri-time-line" />{video.durationMinutes} min</span>
                    )}
                    {video.expectedOtjh != null && video.expectedOtjh > 0 && (
                      <span className="inline-flex items-center gap-1"><i className="ri-timer-line" />{video.expectedOtjh}h OTJ</span>
                    )}
                    {weekTitle && <span className="inline-flex items-center gap-1"><i className="ri-calendar-line" />{weekTitle}</span>}
                  </div>
                </div>

                {/* Timer + finish. Real remaining time when the player reports it;
                    otherwise an elapsed count-up (Vimeo/unsupported). */}
                <div className="flex items-center gap-3 shrink-0">
                  {remaining !== null ? (
                    <div className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl font-mono text-sm font-semibold tabular-nums ${
                      remaining <= 10 ? 'bg-red-100 text-red-700' : 'bg-background-100 text-foreground-700'
                    }`} title="Time remaining">
                      <i className="ri-timer-line" /> {formatClock(remaining)}
                    </div>
                  ) : (
                    <div className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl font-mono text-sm font-semibold tabular-nums bg-background-100 text-foreground-700" title="Time watched">
                      <i className="ri-timer-line" /> {formatClock(elapsedSeconds)}
                    </div>
                  )}
                  <button
                    onClick={finishWatching}
                    className="inline-flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 transition-colors cursor-pointer"
                  >
                    <i className="ri-check-line" /> {remaining === 0 ? 'Reflect' : 'Finish & Reflect'}
                  </button>
                </div>
              </div>

              {video.description && (
                <div className="mt-4 rounded-xl border border-background-300 bg-white p-4">
                  <h2 className="text-[11px] font-semibold uppercase tracking-wider text-foreground-400 mb-2">Description</h2>
                  <p className="text-sm text-foreground-700 leading-relaxed whitespace-pre-line">{video.description}</p>
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
                    const isCurrent = c.componentId === componentId;
                    const isPlayableVideo = c.type === 'video' && !!c.videoUrl && !!c.componentId;
                    const clickable = isPlayableVideo && !isCurrent;
                    return (
                      <li key={c.componentId || c.title}>
                        <button
                          disabled={!clickable}
                          onClick={() =>
                            clickable &&
                            navigate(
                              `/learner/video/${kind}/${id}/${c.componentId}?module=${encodeURIComponent(moduleTitle)}&week=${encodeURIComponent(weekTitle)}`,
                            )
                          }
                          className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-left transition-colors ${
                            isCurrent ? 'bg-red-50' : clickable ? 'hover:bg-background-50 cursor-pointer' : 'cursor-default'
                          }`}
                        >
                          <span className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${cm.bg}`}>
                            <i className={`${cm.icon} text-[12px] ${cm.color}`} />
                          </span>
                          <span className="flex-1 min-w-0">
                            <span className="block text-[9px] font-semibold uppercase tracking-wider text-foreground-400">{cm.label}</span>
                            <span className={`block text-[13px] font-semibold leading-snug truncate ${isCurrent ? 'text-red-700' : 'text-foreground-800'}`}>
                              {cm.detail || cm.label}
                            </span>
                          </span>
                          {isCurrent ? (
                            <i className="ri-volume-up-line text-red-600 text-sm shrink-0" />
                          ) : isPlayableVideo ? (
                            <i className="ri-play-fill text-foreground-400 text-sm shrink-0" />
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
                            <i className="ri-calendar-line text-[12px]" />
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

/* Results screen after a video watch + reflection is saved. */
function ResultsScreen({ record, title, onBack }: { record: VideoProgressRecord; title: string; onBack: () => void }) {
  return (
    <div className="bg-background-50 rounded-2xl border border-foreground-200/60 p-6 md:p-8 card-premium text-center">
      <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 bg-emerald-100">
        <i className="ri-checkbox-circle-line text-emerald-600 text-2xl" />
      </div>
      <h1 className="text-lg font-heading font-bold text-foreground-900 mb-1">Video complete!</h1>
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

      <button
        onClick={onBack}
        className="px-6 py-2.5 rounded-xl text-sm font-semibold bg-primary-600 text-white hover:bg-primary-700 transition-colors cursor-pointer"
      >
        Back to Training Plan
      </button>
    </div>
  );
}

function StatTile({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-background-300 bg-white px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-foreground-400 mb-0.5">
        <i className={`${icon} text-xs`} />
        <span className="text-[10px] font-semibold uppercase tracking-wider">{label}</span>
      </div>
      <p className="text-sm font-bold text-foreground-900 truncate">{value}</p>
    </div>
  );
}
