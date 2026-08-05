import { PROGRESS_REVIEWS_DATA } from '@/mocks/progress-reviews';
import { LEARNER_PROFILE } from '@/mocks/learner-profile';
import { downloadICS } from '@/utils/ics-generator';
import { statusBadge } from '../utils';

interface Props {
  onPrepareReview: () => void;
}

export default function NextReviewCard({ onPrepareReview }: Props) {
  const d = PROGRESS_REVIEWS_DATA;
  const p = LEARNER_PROFILE;

  const handleAddToCalendar = () => {
    downloadICS({
      title: `${d.nextReview.title} — ${p.fullName}`,
      description: `Progress Review with ${d.nextReview.coach} and ${d.nextReview.lineManager}. Programme: ${p.programme}.`,
      date: d.nextReview.date,
      time: d.nextReview.time,
      location: d.nextReview.location,
    });
  };

  return (
    <section className="bg-background-50 rounded-xl border border-background-200/70 p-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-primary-500 flex items-center justify-center">
            <AppIcon className="ri-calendar-event-line text-white text-2xl" />
          </div>
          <div>
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${statusBadge(d.nextReview.status)}`}>{d.nextReview.status}</span>
            <p className="text-sm font-heading font-semibold text-foreground-900 mt-1">{d.nextReview.title}</p>
            <p className="text-sm text-foreground-600">{d.nextReview.date} · {d.nextReview.time}</p>
            <div className="flex items-center flex-wrap gap-3 text-xs text-foreground-400 mt-1">
              <span><AppIcon className="ri-user-star-line mr-1" />Coach: {d.nextReview.coach}</span>
              <span><AppIcon className="ri-building-line mr-1" />Manager: {d.nextReview.lineManager}</span>
              <span><AppIcon className="ri-map-pin-line mr-1" />{d.nextReview.location}</span>
              <span><AppIcon className="ri-time-line mr-1" />{d.nextReview.duration}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={onPrepareReview}
            className="inline-flex items-center gap-1.5 px-5 py-2.5 bg-primary-500 text-white rounded-lg text-sm font-semibold hover:bg-primary-600 transition-all cursor-pointer whitespace-nowrap"
          >
            <AppIcon className="ri-edit-line" /> Prepare Progress Review Meeting
          </button>
          <button onClick={handleAddToCalendar} className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-background-100 text-foreground-700 rounded-lg text-sm font-semibold border border-background-200/50 hover:bg-background-200 transition-all cursor-pointer whitespace-nowrap">
            <AppIcon className="ri-calendar-check-line" /> Add To Calendar
          </button>
        </div>
      </div>
    </section>
  );
}