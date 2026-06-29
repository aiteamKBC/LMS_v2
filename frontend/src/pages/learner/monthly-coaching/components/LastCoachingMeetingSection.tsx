import { useState } from 'react';
import { LAST_MEETING } from '@/mocks/monthly-coaching';

export default function LastCoachingMeetingSection() {
  const [tab, setTab] = useState<'summary' | 'notes' | 'feedback' | 'employer'>('summary');
  const l = LAST_MEETING;

  const ragStyle = {
    green: { text: 'text-green-700', bg: 'bg-green-100', border: 'border-green-200' },
    amber: { text: 'text-amber-700', bg: 'bg-amber-100', border: 'border-amber-200' },
    red: { text: 'text-red-700', bg: 'bg-red-100', border: 'border-red-200' },
  };
  const r = ragStyle[l.ragColor];

  const tabs = [
    { key: 'summary' as const, label: 'Summary' },
    { key: 'notes' as const, label: 'Meeting Notes' },
    { key: 'feedback' as const, label: 'Coach Feedback' },
    { key: 'employer' as const, label: 'Employer Comments' },
  ];

  return (
    <section className="rounded-2xl border border-background-200/50 bg-background-50 overflow-hidden">
      <div className="p-6 md:p-8">
        <div className="flex items-center gap-2 mb-6">
          <div className="w-8 h-8 rounded-lg bg-secondary-100 flex items-center justify-center">
            <i className="ri-history-line text-secondary-700" />
          </div>
          <h2 className="text-lg font-heading font-semibold text-foreground-900">Last Coaching Meeting</h2>
        </div>

        {/* Header Row */}
        <div className="flex flex-wrap items-center gap-4 mb-6 p-4 rounded-xl bg-background-100/50 border border-background-200/50">
          <div className="flex items-center gap-2">
            <i className="ri-calendar-line text-foreground-400" />
            <span className="text-sm font-medium text-foreground-700">{l.date}</span>
          </div>
          <div className="flex items-center gap-2">
            <i className="ri-user-voice-line text-foreground-400" />
            <span className="text-sm font-medium text-foreground-700">{l.coach}</span>
          </div>
          <div className="flex items-center gap-2">
            <i className="ri-time-line text-foreground-400" />
            <span className="text-sm font-medium text-foreground-700">{l.duration}</span>
          </div>
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${r.bg} ${r.text} ${r.border} border ml-auto`}>
            {l.ragStatus}
          </span>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 mb-4 p-1 bg-background-100 rounded-lg w-fit">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-smooth cursor-pointer whitespace-nowrap ${
                tab === t.key ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {tab === 'summary' && (
          <div className="space-y-4">
            <p className="text-sm text-foreground-600 leading-relaxed">{l.summary}</p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-xl border border-background-200/50 bg-background-100/30 p-4">
                <h3 className="text-xs font-semibold text-foreground-400 uppercase tracking-wide mb-3">Actions Agreed</h3>
                <ul className="space-y-2">
                  {l.actionsAgreed.map((a, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-foreground-700">
                      <i className="ri-arrow-right-s-line text-primary-600 mt-0.5 shrink-0" />
                      <span>{a}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded-xl border border-background-200/50 bg-background-100/30 p-4">
                <h3 className="text-xs font-semibold text-foreground-400 uppercase tracking-wide mb-3">Strengths</h3>
                <ul className="space-y-2">
                  {l.strengths.map((s, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-green-700">
                      <i className="ri-check-line text-green-500 mt-0.5 shrink-0" />
                      <span>{s}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="rounded-xl border border-amber-200/50 bg-amber-50/30 p-4">
              <h3 className="text-xs font-semibold text-amber-600 uppercase tracking-wide mb-3">Areas For Improvement</h3>
              <ul className="space-y-2">
                {l.areasForImprovement.map((a, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-amber-800">
                    <i className="ri-arrow-up-line text-amber-500 mt-0.5 shrink-0" />
                    <span>{a}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {tab === 'notes' && (
          <div className="rounded-xl border border-background-200/50 bg-background-100/30 p-4">
            <h3 className="text-xs font-semibold text-foreground-400 uppercase tracking-wide mb-3">Previous Meeting Notes</h3>
            <p className="text-sm text-foreground-600 leading-relaxed">{l.previousMeetingNotes}</p>
          </div>
        )}

        {tab === 'feedback' && (
          <div className="rounded-xl border border-primary-200/50 bg-primary-50/20 p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center text-sm font-bold text-primary-700">
                {l.coach.charAt(0)}
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground-900">{l.coach}</p>
                <p className="text-xs text-foreground-400">{l.coachRole}</p>
              </div>
            </div>
            <p className="text-sm text-foreground-600 leading-relaxed italic">{l.coachFeedback}</p>
          </div>
        )}

        {tab === 'employer' && (
          <div className="rounded-xl border border-accent-200/50 bg-accent-50/20 p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-full bg-accent-100 flex items-center justify-center text-sm font-bold text-accent-700">
                L
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground-900">Lauren Mitchell</p>
                <p className="text-xs text-foreground-400">Line Manager</p>
              </div>
            </div>
            <p className="text-sm text-foreground-600 leading-relaxed italic">{l.employerComments}</p>
          </div>
        )}
      </div>
    </section>
  );
}