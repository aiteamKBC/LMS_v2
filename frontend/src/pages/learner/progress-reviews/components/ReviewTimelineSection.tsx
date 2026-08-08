import { PROGRESS_REVIEWS_DATA } from '@/mocks/progress-reviews';
import { statusBadge } from '../utils';

export default function ReviewTimelineSection() {
  const d = PROGRESS_REVIEWS_DATA;

  return (
    <section className="bg-background-50 rounded-xl border border-background-200/70 p-5">
      <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-4">Progress Review Timeline</h3>
      <div className="flex items-start gap-1 overflow-x-auto pb-2">
        {d.timeline.map((rev, idx) => {
          const isLast = idx === d.timeline.length - 1;
          const icon = rev.status === 'completed' ? 'ri-check-line' : rev.status === 'current' ? 'ri-arrow-right-s-line' : rev.status === 'gateway' ? 'ri-flag-line' : 'ri-circle-line';
          const bg = rev.status === 'completed' ? 'bg-emerald-500' : rev.status === 'current' ? 'bg-primary-500' : rev.status === 'gateway' ? 'bg-accent-500' : 'bg-foreground-200';
          const text = rev.status === 'completed' ? 'text-emerald-600' : rev.status === 'current' ? 'text-primary-600' : rev.status === 'gateway' ? 'text-accent-600' : 'text-foreground-400';
          return (
            <div key={rev.id} className="flex flex-col items-center min-w-[100px] flex-1">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-sm mb-2 ${bg}`}>
                <AppIcon className={icon} />
              </div>
              <p className="text-xs font-semibold text-foreground-900 text-center">{rev.status === 'gateway' ? 'Gateway' : `Review ${rev.number}`}</p>
              <p className={`text-xs font-medium text-center mt-0.5 ${text}`}>
                {rev.status === 'completed' ? 'Completed' : rev.status === 'current' ? 'Upcoming' : rev.status === 'gateway' ? 'Gateway Review' : 'Scheduled'}
              </p>
              <p className="text-xs text-foreground-400 text-center mt-0.5">{rev.date}</p>
              {rev.status === 'completed' && (
                <div className="text-xs text-foreground-400 text-center mt-1">
                  <span className={`inline-block px-1.5 py-0.5 rounded-full ${statusBadge(rev.rag || '')}`}>{rev.rag}</span>
                </div>
              )}
              {!isLast && <div className="w-full h-px bg-background-200 mt-3" />}
            </div>
          );
        })}
      </div>
    </section>
  );
}