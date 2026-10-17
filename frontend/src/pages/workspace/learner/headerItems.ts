import type { DashboardHeader } from '@/api/dashboardHeader';

const ukDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' });
const ukTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

/** Only expiry is client-side: selection and card fields come directly from V2. */
export function headerItems(header: DashboardHeader | null, now: number) {
  const instant = new Date(now);
  const today = ukDay.format(instant);
  const clock = ukTime.format(instant);
  const upcoming = (date?: string, time?: string) => !!date && Number.isFinite(Date.parse(date))
    && (/^\d{4}-\d{2}-\d{2}$/.test(date)
      ? date > today || date === today && (!time || time.slice(0, 5) >= clock)
      : Date.parse(date) >= now);
  const review = header?.nextReview;
  return {
    lecture: upcoming(header?.nextLiveSession?.date) ? header!.nextLiveSession!
      : { title: 'Next lecture', date: null, moduleId: undefined, href: '/learner/attendance' },
    assignment: upcoming(header?.nextDeadline?.date) ? header!.nextDeadline!
      : { title: 'Next assignment', date: null, href: '/learner/monthly-submission' },
    review: upcoming(review?.date, review?.scheduledDate ? review.scheduledTime : undefined) ? review! : null,
  };
}
