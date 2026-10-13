import { useEffect, useRef, useState } from 'react';
import { coachSessionKey, readCoachSessionCache, writeCoachSessionCache } from '@/features/coach/shared/coachSessionCache';
import { fetchAttendanceOptions, type AttendanceOptions } from '../api/attendanceApi';
const EMPTY_PROGRAMMES: AttendanceOptions['programmes'] = [];

export function useAttendanceOptions(email: string, enabled: boolean) {
  const key = coachSessionKey('attendance-options-v1', email);
  const [refresh, setRefresh] = useState(0);
  const inFlight = useRef<{ key: string; controller: AbortController; promise: Promise<AttendanceOptions>; users: number } | null>(null);
  const [state, setState] = useState<{ key: string; data?: AttendanceOptions; loading: boolean; error: string | null }>({ key, loading: true, error: null });
  useEffect(() => {
    if (!enabled) return;
    const cached = readCoachSessionCache<AttendanceOptions>(key);
    if (cached && !refresh) {
      setState({ key, data: cached, loading: false, error: null });
      return;
    }
    setState({ key, data: cached, loading: true, error: null });
    const requestKey = JSON.stringify([key, refresh]);
    if (!inFlight.current || inFlight.current.key !== requestKey || inFlight.current.controller.signal.aborted) {
      const controller = new AbortController();
      inFlight.current = { key: requestKey, controller, promise: fetchAttendanceOptions(controller.signal), users: 0 };
    }
    const request = inFlight.current;
    request.users++;
    let active = true;
    request.promise.then(data => {
      if (active && !request.controller.signal.aborted) {
        writeCoachSessionCache(key, data);
        setState({ key, data, loading: false, error: null });
      }
    }).catch(reason => {
      if (active && !request.controller.signal.aborted) setState({ key, loading: false, error: reason instanceof Error ? reason.message : 'Unable to load attendance options.' });
    }).finally(() => {
      if (inFlight.current === request) inFlight.current = null;
    });
    return () => {
      active = false;
      request.users--;
      // Strict Mode immediately subscribes again. Delay abort until that
      // subscription can reuse the same request; real unmounts still cancel.
      queueMicrotask(() => { if (!request.users) request.controller.abort(); });
    };
  }, [enabled, key, refresh]);
  return { programmes: state.key === key ? state.data?.programmes || EMPTY_PROGRAMMES : EMPTY_PROGRAMMES,
    loading: state.key !== key || state.loading, error: state.key === key ? state.error : null,
    reload: () => setRefresh(value => value + 1) };
}
