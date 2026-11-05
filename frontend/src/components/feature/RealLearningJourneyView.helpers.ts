import type { LearnerDetail } from '@/api/learnerDetail';
import { completedComponentIds, isComponentComplete, hasComponentContent, isOpenableComponent, type JourneyModule } from '@/utils/learnerJourney';


/* ═══════════════════════════════════════════════════════
   REAL-DATA DERIVATION
   A component is "trackable" when the platform can observe
   completion: quizzes (attempts) and videos (watch records).
   ═══════════════════════════════════════════════════════ */
export type StationStatus = 'completed' | 'current' | 'upcoming';


export interface WeekDot { week: string; total: number; done: number }


export interface ModuleStation {
  module: JourneyModule;
  index: number;
  trackableTotal: number;
  trackableDone: number;
  pct: number | null; // null when nothing trackable
  quizTotal: number;
  quizTaken: number;
  quizPassed: number;
  videoTotal: number;
  videoDone: number;
  componentCount: number;
  otjhPlanned: number;
  weekDots: WeekDot[];
  status: StationStatus;
}


export function isVideoComponent(c: JourneyModule['weeks'][number]['components'][number]): boolean {
  return Boolean(c.videoUrl) || (c.type || '').toLowerCase() === 'video';
}


export function buildStations(journey: JourneyModule[], real: LearnerDetail | null): { stations: ModuleStation[]; overallPct: number; currentIndex: number; currentWeek: string | null } {
  // Imported history and activity completed in this platform are deliberately
  // one stream.  The shared helper de-duplicates them by component id and
  // excludes explicit failures, so a new attempt appends to the history
  // without either erasing or double-counting the imported baseline.
  const completedIds = completedComponentIds(real);

  const raw = journey.map((mod, index) => {
    let trackableTotal = 0, trackableDone = 0, quizTotal = 0, quizTaken = 0, quizPassed = 0, videoTotal = 0, videoDone = 0, componentCount = 0, otjhPlanned = 0;
    const weekDots: WeekDot[] = [];
    for (const w of mod.weeks) {
      let wTotal = 0, wDone = 0;
      for (const c of w.components) {
        componentCount += 1;
        otjhPlanned += c.expectedOtjh || 0;
        if (c.isQuiz && hasComponentContent(c)) {
          quizTotal += 1; trackableTotal += 1; wTotal += 1;
          const attempts = c.quizAttempts || [];
          if (attempts.length > 0) quizTaken += 1;
          if (isComponentComplete(c, completedIds)) {
            quizPassed += 1; trackableDone += 1; wDone += 1;
          }
        } else if (isVideoComponent(c)) {
          videoTotal += 1; trackableTotal += 1; wTotal += 1;
          if (isComponentComplete(c, completedIds)) { videoDone += 1; trackableDone += 1; wDone += 1; }
        } else if (isOpenableComponent(c)) {
          // Generic completable content (podcast/reading/slides/reflection/…).
          trackableTotal += 1; wTotal += 1;
          if (isComponentComplete(c, completedIds)) { trackableDone += 1; wDone += 1; }
        }
      }
      weekDots.push({ week: w.week, total: wTotal, done: wDone });
    }
    const pct = trackableTotal > 0 ? Math.round((trackableDone / trackableTotal) * 100) : null;
    return { module: mod, index, trackableTotal, trackableDone, pct, quizTotal, quizTaken, quizPassed, videoTotal, videoDone, componentCount, otjhPlanned, weekDots };
  });

  const anyTrackable = raw.some((m) => m.trackableTotal > 0);
  let currentIndex = raw.findIndex((m) => m.trackableTotal > 0 && m.trackableDone < m.trackableTotal);
  if (currentIndex === -1) currentIndex = anyTrackable ? -1 : 0; // -1 → everything done

  const stations: ModuleStation[] = raw.map((m) => ({
    ...m,
    status: m.trackableTotal > 0 && m.trackableDone >= m.trackableTotal
      ? 'completed'
      : m.index === currentIndex ? 'current' : 'upcoming',
  }));

  const totalTrackable = raw.reduce((n, m) => n + m.trackableTotal, 0);
  const totalDone = raw.reduce((n, m) => n + m.trackableDone, 0);
  const overallPct = totalTrackable > 0 ? Math.round((totalDone / totalTrackable) * 100) : 0;

  let currentWeek: string | null = null;
  if (currentIndex >= 0 && stations[currentIndex]) {
    const dot = stations[currentIndex].weekDots.find((w) => w.total > 0 && w.done < w.total) || stations[currentIndex].weekDots[0];
    currentWeek = dot?.week ?? null;
  }
  return { stations, overallPct, currentIndex, currentWeek };
}
