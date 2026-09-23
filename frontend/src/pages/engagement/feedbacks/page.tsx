import { useMemo, useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { AppIcon } from '@/components/feature/AppIcon';
import { roleNavMap } from '@/mocks/navigation';
import { LEARNER_RECENT_FEEDBACK } from '@/mocks/learner-profile';
import { EVENT_FEEDBACKS } from '@/pages/learner/clubs/data';
import { useOperatorIdentity } from '@/hooks/useOperatorIdentity';

type FeedbackSource = 'Event feedback' | 'Progress feedback';

interface FeedbackRecord {
  id: string;
  source: FeedbackSource;
  subject: string;
  context: string;
  submittedBy: string;
  role: string;
  date: string;
  rating: number | null;
  comment: string;
}

const FEEDBACK_RECORDS: FeedbackRecord[] = [
  ...EVENT_FEEDBACKS.map(feedback => ({
    id: feedback.id,
    source: 'Event feedback' as const,
    subject: feedback.eventTitle,
    context: feedback.clubName,
    submittedBy: feedback.submittedBy,
    role: 'Learner',
    date: feedback.submittedDate,
    rating: feedback.rating,
    comment: feedback.comment,
  })),
  ...LEARNER_RECENT_FEEDBACK.map((feedback, index) => ({
    id: `progress-feedback-${index + 1}`,
    source: 'Progress feedback' as const,
    subject: 'Learner progress update',
    context: 'Progress and workplace learning',
    submittedBy: feedback.from,
    role: feedback.role,
    date: feedback.date,
    rating: null,
    comment: feedback.text,
  })),
];

function downloadCsv(rows: FeedbackRecord[]) {
  const escape = (value: string | number | null) => {
    const text = value === null ? '' : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const headers = ['source', 'subject', 'context', 'submitted by', 'role', 'date', 'rating', 'feedback'];
  const csv = [
    headers.join(','),
    ...rows.map(row => [row.source, row.subject, row.context, row.submittedBy, row.role, row.date, row.rating, row.comment].map(escape).join(',')),
  ].join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'engagement-feedbacks.csv';
  link.click();
  URL.revokeObjectURL(url);
}

export default function EngagementFeedbacksPage() {
  const operator = useOperatorIdentity();
  const engagementNav = roleNavMap.engagement;
  const [sourceFilter, setSourceFilter] = useState<'all' | FeedbackSource>('all');
  const [ratingFilter, setRatingFilter] = useState<'all' | 'rated' | 'unrated'>('all');
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return FEEDBACK_RECORDS.filter(feedback => {
      if (sourceFilter !== 'all' && feedback.source !== sourceFilter) return false;
      if (ratingFilter === 'rated' && feedback.rating === null) return false;
      if (ratingFilter === 'unrated' && feedback.rating !== null) return false;
      if (!normalizedQuery) return true;
      return [feedback.subject, feedback.context, feedback.submittedBy, feedback.role, feedback.comment]
        .some(value => value.toLowerCase().includes(normalizedQuery));
    });
  }, [query, ratingFilter, sourceFilter]);

  const rated = FEEDBACK_RECORDS.filter(feedback => feedback.rating !== null);
  const averageRating = rated.length === 0
    ? '—'
    : (rated.reduce((total, feedback) => total + (feedback.rating ?? 0), 0) / rated.length).toFixed(1);
  const eventCount = FEEDBACK_RECORDS.filter(feedback => feedback.source === 'Event feedback').length;
  const progressCount = FEEDBACK_RECORDS.filter(feedback => feedback.source === 'Progress feedback').length;

  return (
    <WorkspaceShell
      role="engagement"
      roleLabel={engagementNav.label}
      navItems={engagementNav.items}
      workspaceLabel={engagementNav.workspaceLabel}
      pageTitle="Feedbacks"
      pageSubtitle="Review feedback from engagement events and learner progress"
      userName={operator.name}
      userRole={operator.role}
    >
      <div className="p-6 space-y-6">
        <WorkspaceHeroBanner
          title="Feedbacks"
          description="A combined, read-only view of the feedback currently available across engagement events and learner progress updates."
          icon="ri-chat-quote-line"
          imageUrl="https://readdy.ai/api/search-image?query=professional%20team%20reviewing%20learner%20feedback%20analytics%20on%20a%20clean%20modern%20workspace%20dashboard&width=400&height=160&seq=feedbacks-01&orientation=landscape"
          imageAlt="Feedbacks"
          stats={[
            { label: 'Feedbacks', value: String(FEEDBACK_RECORDS.length) },
            { label: 'Event feedback', value: String(eventCount) },
            { label: 'Average rating', value: averageRating },
          ]}
        />

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            { label: 'All feedbacks', value: FEEDBACK_RECORDS.length, icon: 'ri-chat-3-line', tone: 'bg-[#F3E8FF] text-[#7C3AED]' },
            { label: 'Event feedback', value: eventCount, icon: 'ri-calendar-event-line', tone: 'bg-[#FEF3C7] text-[#D97706]' },
            { label: 'Progress feedback', value: progressCount, icon: 'ri-line-chart-line', tone: 'bg-[#D1FAE5] text-[#059669]' },
          ].map(stat => (
            <div key={stat.label} className="bg-background-50 rounded-xl border border-foreground-200/60 p-4">
              <span className={`w-9 h-9 rounded-lg flex items-center justify-center mb-3 ${stat.tone}`}>
                <AppIcon className={`${stat.icon} text-sm`} />
              </span>
              <p className="text-[11px] text-foreground-400 mb-1">{stat.label}</p>
              <p className="text-2xl font-heading font-semibold text-foreground-900">{stat.value}</p>
            </div>
          ))}
        </div>

        <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 flex flex-col lg:flex-row gap-3 lg:items-center lg:justify-between">
          <div className="flex flex-col sm:flex-row gap-3 flex-1">
            <label className="flex items-center gap-2 text-[11px] font-medium text-foreground-500">
              Search
              <input
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder="Search feedback"
                className="w-full sm:w-56 px-3 py-2 rounded-lg border border-foreground-200/60 bg-background-50 text-[11px] text-foreground-700 placeholder:text-foreground-400 focus:outline-none focus:ring-1 focus:ring-primary-400/40"
              />
            </label>
            <label className="flex items-center gap-2 text-[11px] font-medium text-foreground-500">
              Source
              <select value={sourceFilter} onChange={event => setSourceFilter(event.target.value as typeof sourceFilter)} className="px-3 py-2 rounded-lg border border-foreground-200/60 bg-background-50 text-[11px] text-foreground-700 focus:outline-none focus:ring-1 focus:ring-primary-400/40">
                <option value="all">All sources</option>
                <option value="Event feedback">Event feedback</option>
                <option value="Progress feedback">Progress feedback</option>
              </select>
            </label>
            <label className="flex items-center gap-2 text-[11px] font-medium text-foreground-500">
              Rating
              <select value={ratingFilter} onChange={event => setRatingFilter(event.target.value as typeof ratingFilter)} className="px-3 py-2 rounded-lg border border-foreground-200/60 bg-background-50 text-[11px] text-foreground-700 focus:outline-none focus:ring-1 focus:ring-primary-400/40">
                <option value="all">All feedback</option>
                <option value="rated">Rated</option>
                <option value="unrated">Written only</option>
              </select>
            </label>
          </div>
          <button onClick={() => downloadCsv(filtered)} className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-[#A7F3D0] bg-[#ECFDF5] text-[#059669] text-[10px] font-semibold hover:bg-[#D1FAE5] transition-smooth cursor-pointer whitespace-nowrap">
            <AppIcon className="ri-download-line" /> Download CSV
          </button>
        </div>

        <section className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
          <div className="p-4 border-b border-foreground-200/60 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-heading font-semibold text-foreground-900">Feedback activity</h2>
              <p className="text-[11px] text-foreground-400 mt-1">{filtered.length} of {FEEDBACK_RECORDS.length} feedbacks shown</p>
            </div>
            <span className="text-[10px] text-foreground-400">Read-only report</span>
          </div>
          {filtered.length === 0 ? (
            <div className="p-10 text-center text-sm text-foreground-500">No feedbacks match the selected filters.</div>
          ) : (
            <div className="divide-y divide-background-200/40">
              {filtered.map(feedback => (
                <article key={feedback.id} className="p-4 hover:bg-background-100/30 transition-smooth">
                  <div className="flex flex-col md:flex-row md:items-start gap-3">
                    <div className="w-9 h-9 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center shrink-0">
                      <AppIcon className={feedback.source === 'Event feedback' ? 'ri-calendar-event-line text-sm' : 'ri-user-star-line text-sm'} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-[13px] font-semibold text-foreground-900">{feedback.subject}</h3>
                        <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-primary-50 text-primary-700">{feedback.source}</span>
                      </div>
                      <p className="text-[11px] text-foreground-400 mt-1">{feedback.context} · {feedback.submittedBy} ({feedback.role}) · {feedback.date}</p>
                      <p className="text-[12px] leading-5 text-foreground-700 mt-2">{feedback.comment}</p>
                    </div>
                    {feedback.rating !== null && (
                      <div className="flex items-center gap-1 text-amber-500 shrink-0" aria-label={`${feedback.rating} out of 5 stars`}>
                        <AppIcon className="ri-star-fill text-sm" />
                        <span className="text-[11px] font-semibold">{feedback.rating}/5</span>
                      </div>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </WorkspaceShell>
  );
}
