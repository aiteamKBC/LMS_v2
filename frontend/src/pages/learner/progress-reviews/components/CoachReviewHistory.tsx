import { useState } from 'react';
import { PROGRESS_REVIEWS_DATA } from '@/mocks/progress-reviews';
import { statusBadge } from '../utils';

export default function CoachReviewHistory() {
  const d = PROGRESS_REVIEWS_DATA;
  const [activeHistory, setActiveHistory] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      {/* ── SECTION 12: COACH SUMMARY ── */}
      <section className="bg-background-50 rounded-xl border border-background-200/70 p-5">
        <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-4">Coach Summary</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-background-100 rounded-lg border border-background-200/50 p-4">
            <p className="text-xs font-semibold text-foreground-500 uppercase tracking-wider mb-2">Strengths</p>
            <ul className="space-y-1">
              {d.coachSummary.strengths.map((s, i) => (
                <li key={i} className="text-sm text-foreground-700 flex items-center gap-2">
                  <i className="ri-check-line text-emerald-500" /> {s}
                </li>
              ))}
            </ul>
          </div>
          <div className="bg-background-100 rounded-lg border border-background-200/50 p-4">
            <p className="text-xs font-semibold text-foreground-500 uppercase tracking-wider mb-2">Areas For Development</p>
            <ul className="space-y-1">
              {d.coachSummary.areasForDevelopment.map((s, i) => (
                <li key={i} className="text-sm text-foreground-700 flex items-center gap-2">
                  <i className="ri-arrow-up-line text-primary-500" /> {s}
                </li>
              ))}
            </ul>
          </div>
          <div className="bg-background-100 rounded-lg border border-background-200/50 p-4">
            <p className="text-xs font-semibold text-foreground-500 uppercase tracking-wider mb-2">Recommended Focus</p>
            <p className="text-sm text-foreground-700">{d.coachSummary.recommendedFocus}</p>
          </div>
          <div className="bg-background-100 rounded-lg border border-background-200/50 p-4">
            <p className="text-xs font-semibold text-foreground-500 uppercase tracking-wider mb-2">Evidence Quality</p>
            <p className="text-sm text-foreground-700">{d.coachSummary.evidenceQuality}</p>
          </div>
          <div className="bg-background-100 rounded-lg border border-background-200/50 p-4">
            <p className="text-xs font-semibold text-foreground-500 uppercase tracking-wider mb-2">KSB Gaps</p>
            <ul className="space-y-1">
              {d.coachSummary.ksbGaps.map((s, i) => (
                <li key={i} className="text-sm text-foreground-700 flex items-center gap-2">
                  <i className="ri-error-warning-line text-amber-500" /> {s}
                </li>
              ))}
            </ul>
          </div>
          <div className="bg-background-100 rounded-lg border border-background-200/50 p-4">
            <p className="text-xs font-semibold text-foreground-500 uppercase tracking-wider mb-2">OTJH Review</p>
            <p className="text-sm text-foreground-700">{d.coachSummary.otjhReview}</p>
          </div>
        </div>
      </section>

      {/* ── SECTION 13: REVIEW OUTCOME ── */}
      <section className="bg-background-50 rounded-xl border border-background-200/70 p-5">
        <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-4">Last Review Outcome</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div className="bg-background-100 rounded-lg border border-background-200/50 p-4">
            <p className="text-xs text-foreground-500 mb-1">Review Date</p>
            <p className="text-sm font-semibold text-foreground-900">{d.reviewOutcome.reviewDate}</p>
          </div>
          <div className="bg-background-100 rounded-lg border border-background-200/50 p-4">
            <p className="text-xs text-foreground-500 mb-1">RAG Rating</p>
            <span className={`text-xs font-bold px-3 py-1 rounded-full ${statusBadge(d.reviewOutcome.rag)}`}>{d.reviewOutcome.rag}</span>
          </div>
          <div className="bg-background-100 rounded-lg border border-background-200/50 p-4">
            <p className="text-xs text-foreground-500 mb-1">Actions Agreed</p>
            <p className="text-sm font-semibold text-foreground-900">{d.reviewOutcome.actionsAgreed}</p>
          </div>
          <div className="bg-background-100 rounded-lg border border-background-200/50 p-4">
            <p className="text-xs text-foreground-500 mb-1">Next Review</p>
            <p className="text-sm font-semibold text-foreground-900">{d.reviewOutcome.nextReviewDate}</p>
          </div>
        </div>
        <div className="bg-background-100 rounded-lg border border-background-200/50 p-4 mb-3">
          <p className="text-xs font-semibold text-foreground-500 uppercase tracking-wider mb-2">Summary</p>
          <p className="text-sm text-foreground-700 leading-relaxed">{d.reviewOutcome.summary}</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-background-100 rounded-lg border border-background-200/50 p-4">
            <p className="text-xs font-semibold text-foreground-500 uppercase tracking-wider mb-2">Coach Comments</p>
            <p className="text-sm text-foreground-700 leading-relaxed">{d.reviewOutcome.coachComments}</p>
          </div>
          <div className="bg-background-100 rounded-lg border border-background-200/50 p-4">
            <p className="text-xs font-semibold text-foreground-500 uppercase tracking-wider mb-2">Employer Feedback</p>
            <p className="text-sm text-foreground-700 leading-relaxed">{d.reviewOutcome.employerFeedback}</p>
          </div>
        </div>
      </section>

      {/* ── SECTION 14: REVIEW HISTORY ── */}
      <section className="bg-background-50 rounded-xl border border-background-200/70 overflow-hidden">
        <div className="p-5 border-b border-background-200/50">
          <h3 className="text-sm font-heading font-semibold text-foreground-900">Review History</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-background-200/50">
                <th className="text-xs font-semibold text-foreground-400 uppercase tracking-wider px-5 py-3">Review</th>
                <th className="text-xs font-semibold text-foreground-400 uppercase tracking-wider px-5 py-3">Date</th>
                <th className="text-xs font-semibold text-foreground-400 uppercase tracking-wider px-5 py-3">Coach</th>
                <th className="text-xs font-semibold text-foreground-400 uppercase tracking-wider px-5 py-3">Employer</th>
                <th className="text-xs font-semibold text-foreground-400 uppercase tracking-wider px-5 py-3">RAG</th>
                <th className="text-xs font-semibold text-foreground-400 uppercase tracking-wider px-5 py-3">Attendance</th>
                <th className="text-xs font-semibold text-foreground-400 uppercase tracking-wider px-5 py-3">OTJH</th>
                <th className="text-xs font-semibold text-foreground-400 uppercase tracking-wider px-5 py-3">Evidence</th>
                <th className="text-xs font-semibold text-foreground-400 uppercase tracking-wider px-5 py-3">Actions</th>
                <th className="text-xs font-semibold text-foreground-400 uppercase tracking-wider px-5 py-3">Outcome</th>
              </tr>
            </thead>
            <tbody>
              {d.reviewHistory.map((rev) => (
                <tr key={rev.id} className="border-b border-background-200/30 hover:bg-background-100/50 transition-smooth cursor-pointer" onClick={() => setActiveHistory(activeHistory === rev.id ? null : rev.id)}>
                  <td className="px-5 py-3 text-sm font-bold text-foreground-900">#{rev.number}</td>
                  <td className="px-5 py-3 text-sm text-foreground-600">{rev.date}</td>
                  <td className="px-5 py-3 text-sm text-foreground-600">{rev.coach}</td>
                  <td className="px-5 py-3 text-sm text-foreground-600">{rev.employer}</td>
                  <td className="px-5 py-3"><span className={`text-xs font-bold px-2 py-0.5 rounded-full ${statusBadge(rev.rag)}`}>{rev.rag}</span></td>
                  <td className="px-5 py-3 text-sm text-foreground-600">{rev.attendance}</td>
                  <td className="px-5 py-3 text-sm text-foreground-600">{rev.otjh}</td>
                  <td className="px-5 py-3 text-sm text-foreground-600">{rev.evidence}</td>
                  <td className="px-5 py-3 text-sm text-foreground-600">{rev.actions}</td>
                  <td className="px-5 py-3 text-sm text-foreground-600 max-w-[200px] truncate">{rev.outcome}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {activeHistory && (
          <div className="p-4 bg-background-100 border-t border-background-200/50">
            {d.reviewHistory.filter(r => r.id === activeHistory).map(r => (
              <div key={r.id} className="text-sm text-foreground-700">
                <strong className="text-foreground-900">Review #{r.number} — {r.date}:</strong> {r.outcome}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}