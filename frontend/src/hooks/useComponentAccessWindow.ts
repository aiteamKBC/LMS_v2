import { useEffect, useRef, useState } from 'react';
import { readLearnerJson } from '@/api/learnerRead';
import { componentAccessWindow, type ComponentAccessWindow, type WorkingHoursHoliday } from '@/lib/componentAccessWindow';

/** Re-check at least once a minute so 07:00/19:00 takes effect without refresh. */
export function useComponentAccessWindow(): ComponentAccessWindow {
  const [access, setAccess] = useState(() => componentAccessWindow());
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const holidays = useRef<WorkingHoursHoliday[]>([]);

  useEffect(() => {
    let active = true;
    let pending = false;
    const update = () => {
      setAccess(componentAccessWindow(new Date(), holidays.current));
      if (pending) return;
      pending = true;
      readLearnerJson<{ holidays: WorkingHoursHoliday[] }>('/learner_api/working-hours/holidays/', { ttlMs: 30_000 })
        .then(data => {
          if (!Array.isArray(data.holidays) || data.holidays.some(row => !row || !/^\d{4}-\d{2}-\d{2}$/.test(row.start) || !/^\d{4}-\d{2}-\d{2}$/.test(row.end) || row.end < row.start)) {
            throw new Error('Invalid holiday calendar response.');
          }
          if (!active) return;
          holidays.current = data.holidays;
          setAccess(componentAccessWindow(new Date(), holidays.current));
          setReady(true);
          setError('');
        })
        .catch(() => {
          if (!active) return;
          setReady(false);
          setError('Could not load the holiday calendar. Retry before submitting your activity.');
        })
        .finally(() => { pending = false; });
    };
    update();
    const timer = window.setInterval(update, 30_000);
    window.addEventListener('focus', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, [reload]);

  return { ...access, holidayCalendarReady: ready, holidayError: error, refreshHolidays: () => setReload(value => value + 1) };
}
