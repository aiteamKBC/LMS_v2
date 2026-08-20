import { useEffect, useRef, useState } from 'react';
import {
  previewTutorAvailabilityRoster,
  type CurriculumTutorAvailabilityInput,
  type CurriculumTutorAvailabilityVerdict,
} from '@/lib/curriculumApi';

/**
 * Who is already teaching in the slot the user is filling in.
 *
 * A tutor cannot take two modules that run at the same time, and the save
 * refuses one that would. Finding that out *from* the refusal is the worst
 * moment to find it out — the form is already filled in and the choice was never
 * going to work. This asks the same question ahead of the write so a screen can
 * mark the busy names in the picker and explain the clash while it is still one
 * click to avoid.
 *
 * The whole roster comes back in one request rather than one call per tutor:
 * the answer changes with the *slot*, not with the name, so re-asking per name
 * would be the same query many times over.
 *
 * Verdicts are advisory. The backend is still the authority — a slot can be
 * taken between the preview and the save — so callers must keep handling the
 * 409 (see `tutorConflictMessage`) rather than trusting this to have caught it.
 */
export interface TutorAvailability {
  /** Verdict by tutor name, lower-cased for lookup. Empty until the first load. */
  byTutor: Map<string, CurriculumTutorAvailabilityVerdict>;
  /** The dates the slot occupies, for explaining a clash without a second call. */
  sessionDates: string[];
  /** False when the slot books nothing — no verdict here means anything yet. */
  bookable: boolean;
  loading: boolean;
  /** Look one tutor up. Returns null while loading, unknown, or not bookable. */
  verdictFor: (tutor: string) => CurriculumTutorAvailabilityVerdict | null;
}

const EMPTY: TutorAvailability = {
  byTutor: new Map(),
  sessionDates: [],
  bookable: false,
  loading: false,
  verdictFor: () => null,
};

export function useTutorAvailability(
  slot: CurriculumTutorAvailabilityInput | null,
  options: { enabled?: boolean } = {},
): TutorAvailability {
  const enabled = options.enabled !== false && Boolean(slot);
  const [state, setState] = useState<Omit<TutorAvailability, 'verdictFor'>>(EMPTY);

  // The slot is rebuilt on every render by most callers, so the effect keys off
  // its contents rather than its identity — otherwise every keystroke in an
  // unrelated field would refire the request.
  const key = enabled && slot
    ? JSON.stringify([slot.startDate, slot.sessionsNumber, slot.weekDays, slot.startTime, slot.endTime, slot.moduleCatalogueId])
    : '';
  const slotRef = useRef(slot);
  slotRef.current = slot;

  useEffect(() => {
    if (!key) {
      setState(EMPTY);
      return undefined;
    }
    let live = true;
    setState(previous => ({ ...previous, loading: true }));
    previewTutorAvailabilityRoster(slotRef.current || {})
      .then(response => {
        if (!live) return;
        setState({
          byTutor: new Map(response.results.map(item => [item.tutor.toLowerCase(), item])),
          sessionDates: response.sessionDates,
          bookable: response.bookable,
          loading: false,
        });
      })
      .catch(() => {
        // Advisory only: a failed preview must never block the form. The save
        // still enforces the rule, so silence here degrades to the old
        // find-out-on-save behaviour rather than to a broken screen.
        if (live) setState({ ...EMPTY, loading: false });
      });
    return () => { live = false; };
  }, [key]);

  return {
    ...state,
    verdictFor: (tutor: string) => {
      const name = (tutor || '').trim().toLowerCase();
      if (!name || !state.bookable) return null;
      return state.byTutor.get(name) || null;
    },
  };
}
