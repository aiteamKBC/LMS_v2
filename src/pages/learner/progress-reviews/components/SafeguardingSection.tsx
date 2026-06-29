import { PROGRESS_REVIEWS_DATA } from '@/mocks/progress-reviews';
import { statusBadge } from '../utils';

interface Props {
  wellbeingRequest: boolean;
  onToggleWellbeing: () => void;
}

export default function SafeguardingSection({ wellbeingRequest, onToggleWellbeing }: Props) {
  const d = PROGRESS_REVIEWS_DATA;

  return (
    <section className="bg-background-50 rounded-xl border border-background-200/70 p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-heading font-semibold text-foreground-900">Safeguarding &amp; Wellbeing</h3>
        <span className={`text-xs font-bold px-3 py-1 rounded-full ${statusBadge(d.safeguarding.status)}`}>{d.safeguarding.status}</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
        <div className="bg-background-100 rounded-lg border border-background-200/50 p-3">
          <p className="text-xs text-foreground-500 mb-1">Current Status</p>
          <p className="text-sm font-semibold text-foreground-900">{d.safeguarding.status}</p>
        </div>
        <div className="bg-background-100 rounded-lg border border-background-200/50 p-3">
          <p className="text-xs text-foreground-500 mb-1">Support Requested</p>
          <p className="text-sm font-semibold text-foreground-900">{d.safeguarding.supportRequested ? 'Yes' : 'No'}</p>
        </div>
        <div className="bg-background-100 rounded-lg border border-background-200/50 p-3">
          <p className="text-xs text-foreground-500 mb-1">Wellbeing Check</p>
          <p className="text-sm font-semibold text-foreground-900">{d.safeguarding.wellbeingCheck}</p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={onToggleWellbeing}
          className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold cursor-pointer transition-all whitespace-nowrap ${wellbeingRequest ? 'bg-amber-500 text-white' : 'bg-background-100 text-foreground-700 border border-background-200/50 hover:bg-background-200'}`}
        >
          <i className="ri-heart-pulse-line" /> {wellbeingRequest ? 'Support Requested' : 'Request Confidential Support'}
        </button>
        <p className="text-xs text-foreground-400">
          <i className="ri-shield-check-line mr-1" /> Your wellbeing is our priority. All requests are confidential.
        </p>
      </div>
    </section>
  );
}