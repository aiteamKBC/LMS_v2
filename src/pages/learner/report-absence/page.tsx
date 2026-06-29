import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { LEARNER_PROFILE } from '@/mocks/learner-profile';

const learnerNav = roleNavMap.learner;

const UPCOMING_SESSIONS = [
  { id: 's1', date: '11 Jun 2026', title: 'Live Session: Campaign Targeting', time: '10:00–12:00' },
  { id: 's2', date: '18 Jun 2026', title: 'Live Session: Consumer Behaviour', time: '10:00–12:00' },
  { id: 's3', date: '18 Jun 2026', title: 'Monthly Coaching', time: '14:00–15:00' },
  { id: 's4', date: '25 Jun 2026', title: 'Live Session: Data for Marketing', time: '10:00–12:00' },
];

const ABSENCE_CATEGORIES = ['Work commitment', 'Annual leave', 'Illness', 'Emergency', 'Caring responsibility', 'Technical issue', 'Other'];

const RECENT_ABSENCES = [
  { id: 'a1', date: '23 May 2026', title: 'Marketing Framework Overview', reason: 'Work commitment — product launch meeting', status: 'Approved', catchUp: 'Completed' },
  { id: 'a2', date: '20 May 2026', title: 'Competitor Analysis Activity', reason: 'Illness', status: 'Approved', catchUp: 'Completed' },
];

export default function ReportAbsencePage() {
  const p = LEARNER_PROFILE;
  const [submitted, setSubmitted] = useState(false);
  const [formData, setFormData] = useState({
    sessionDate: '',
    sessionTitle: '',
    reason: '',
    category: '',
    details: '',
    workRelated: false,
    healthRelated: false,
    informedEmployer: false,
    requestCatchUp: true,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <WorkspaceShell
        role="learner" roleLabel={learnerNav.label} navItems={learnerNav.items} workspaceLabel={learnerNav.workspaceLabel}
        pageTitle="Report My Absence" pageSubtitle="Absence report submitted"
        userName={p.fullName} userRole={`${p.programme} Apprentice`}
      >
        <div className="p-6 max-w-2xl mx-auto space-y-6">
          <div className="bg-emerald-50 rounded-xl border border-emerald-200/50 p-6 text-center">
            <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4">
              <i className="ri-check-line text-emerald-600 text-2xl"></i>
            </div>
            <h2 className="text-lg font-heading font-semibold text-emerald-900 mb-2">Absence Submitted</h2>
            <p className="text-sm text-emerald-700 mb-6">Your absence has been recorded and the relevant people have been notified.</p>
            <div className="space-y-3 text-left bg-white/60 rounded-lg p-4">
              <div className="flex items-center gap-2 text-sm">
                <i className="ri-checkbox-circle-line text-emerald-500"></i>
                <span className="text-foreground-700">Coach Med Maher has been notified</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <i className="ri-checkbox-circle-line text-emerald-500"></i>
                <span className="text-foreground-700">Tutor Crispin Jones has been notified</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <i className="ri-checkbox-circle-line text-emerald-500"></i>
                <span className="text-foreground-700">Catch-up has been requested — you will need to complete this</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <i className="ri-checkbox-circle-line text-emerald-500"></i>
                <span className="text-foreground-700">Session recording will appear when available</span>
              </div>
              {formData.informedEmployer && (
                <div className="flex items-center gap-2 text-sm">
                  <i className="ri-checkbox-circle-line text-emerald-500"></i>
                  <span className="text-foreground-700">Employer informed — recorded in your attendance log</span>
                </div>
              )}
            </div>
            <div className="flex gap-3 justify-center mt-6">
              <button onClick={() => setSubmitted(false)} className="px-4 py-2 bg-background-50 border border-background-200/50 rounded-lg text-sm font-medium text-foreground-600 cursor-pointer whitespace-nowrap">Report Another</button>
              <a href="/learner/attendance" className="px-4 py-2 bg-primary-500 text-white rounded-lg text-sm font-semibold cursor-pointer whitespace-nowrap">View Attendance</a>
            </div>
          </div>
        </div>
      </WorkspaceShell>
    );
  }

  return (
    <WorkspaceShell
      role="learner" roleLabel={learnerNav.label} navItems={learnerNav.items} workspaceLabel={learnerNav.workspaceLabel}
      pageTitle="Report My Absence" pageSubtitle="Let your team know if you cannot attend a session"
      userName={p.fullName} userRole={`${p.programme} Apprentice`}
    >
      <div className="p-6 max-w-2xl mx-auto space-y-6">
        {/* Support message */}
        <div className="bg-secondary-50/60 rounded-xl border border-secondary-200/50 p-4 flex items-start gap-3">
          <i className="ri-heart-line text-secondary-600 text-lg mt-0.5"></i>
          <div>
            <p className="text-sm font-semibold text-foreground-900 mb-1">We understand things come up</p>
            <p className="text-sm text-foreground-600">Reporting your absence helps us support you. Your coach Med Maher can help arrange catch-up sessions. If you are struggling with attendance, please reach out — we are here to help, not to judge.</p>
          </div>
        </div>

        {/* Absence Form */}
        <form onSubmit={handleSubmit} className="bg-background-50 rounded-xl border border-background-200/50 p-6 space-y-5">
          <h3 className="text-sm font-heading font-semibold text-foreground-900">Absence Details</h3>

          {/* Session Selection */}
          <div>
            <label className="block text-sm font-semibold text-foreground-700 mb-1.5">Which session will you miss?</label>
            <select name="session" value={formData.sessionTitle} onChange={e => setFormData(f => ({ ...f, sessionTitle: e.target.value }))} className="w-full bg-background-50 border border-background-200/50 rounded-lg px-3 py-2.5 text-sm text-foreground-900 cursor-pointer focus:border-primary-300 focus:ring-1 focus:ring-primary-200 outline-none">
              <option value="">Select a session&hellip;</option>
              {UPCOMING_SESSIONS.map(s => (
                <option key={s.id} value={s.title}>{s.date} &mdash; {s.title}</option>
              ))}
            </select>
          </div>

          {/* Date */}
          <div>
            <label className="block text-sm font-semibold text-foreground-700 mb-1.5">Session Date</label>
            <input type="date" name="date" value={formData.sessionDate} onChange={e => setFormData(f => ({ ...f, sessionDate: e.target.value }))} className="w-full bg-background-50 border border-background-200/50 rounded-lg px-3 py-2.5 text-sm text-foreground-900 focus:border-primary-300 focus:ring-1 focus:ring-primary-200 outline-none" />
          </div>

          {/* Category */}
          <div>
            <label className="block text-sm font-semibold text-foreground-700 mb-1.5">Absence Category</label>
            <select name="category" value={formData.category} onChange={e => setFormData(f => ({ ...f, category: e.target.value }))} className="w-full bg-background-50 border border-background-200/50 rounded-lg px-3 py-2.5 text-sm text-foreground-900 cursor-pointer focus:border-primary-300 focus:ring-1 focus:ring-primary-200 outline-none">
              <option value="">Select category&hellip;</option>
              {ABSENCE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          {/* Reason */}
          <div>
            <label className="block text-sm font-semibold text-foreground-700 mb-1.5">Reason for Absence</label>
            <textarea name="reason" value={formData.reason} onChange={e => setFormData(f => ({ ...f, reason: e.target.value }))} maxLength={500} rows={3} className="w-full bg-background-50 border border-background-200/50 rounded-lg px-3 py-2.5 text-sm text-foreground-900 resize-none focus:border-primary-300 focus:ring-1 focus:ring-primary-200 outline-none" placeholder="Please explain why you cannot attend..."></textarea>
            <p className="text-xs text-foreground-400 mt-1">{formData.reason.length}/500</p>
          </div>

          {/* Additional Details */}
          <div>
            <label className="block text-sm font-semibold text-foreground-700 mb-1.5">Additional Details (Optional)</label>
            <textarea name="details" value={formData.details} onChange={e => setFormData(f => ({ ...f, details: e.target.value }))} maxLength={500} rows={2} className="w-full bg-background-50 border border-background-200/50 rounded-lg px-3 py-2.5 text-sm text-foreground-900 resize-none focus:border-primary-300 focus:ring-1 focus:ring-primary-200 outline-none" placeholder="Any extra information your coach should know..."></textarea>
          </div>

          {/* Checkboxes */}
          <div className="space-y-3">
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" checked={formData.workRelated} onChange={e => setFormData(f => ({ ...f, workRelated: e.target.checked }))} className="w-4 h-4 rounded border-background-300 text-primary-500 focus:ring-primary-300 cursor-pointer" />
              <span className="text-sm text-foreground-600">Is this related to work commitments?</span>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" checked={formData.healthRelated} onChange={e => setFormData(f => ({ ...f, healthRelated: e.target.checked }))} className="w-4 h-4 rounded border-background-300 text-primary-500 focus:ring-primary-300 cursor-pointer" />
              <span className="text-sm text-foreground-600">Is this related to health or wellbeing?</span>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" checked={formData.informedEmployer} onChange={e => setFormData(f => ({ ...f, informedEmployer: e.target.checked }))} className="w-4 h-4 rounded border-background-300 text-primary-500 focus:ring-primary-300 cursor-pointer" />
              <span className="text-sm text-foreground-600">Have you informed your employer?</span>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" checked={formData.requestCatchUp} onChange={e => setFormData(f => ({ ...f, requestCatchUp: e.target.checked }))} className="w-4 h-4 rounded border-background-300 text-primary-500 focus:ring-primary-300 cursor-pointer" />
              <span className="text-sm text-foreground-600">Request catch-up support</span>
            </label>
          </div>

          {/* Submit */}
          <div className="flex gap-3 pt-2">
            <button type="submit" className="px-5 py-2.5 bg-primary-500 text-white rounded-lg text-sm font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
              <i className="ri-send-plane-line mr-1.5"></i> Submit Absence Report
            </button>
            <button type="button" className="px-4 py-2.5 bg-background-50 border border-background-200/50 rounded-lg text-sm font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">Save Draft</button>
          </div>
        </form>

        {/* Attendance Policy */}
        <div className="bg-background-50 rounded-xl border border-background-200/50 p-5">
          <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-2">Attendance Policy Reminder</h3>
          <ul className="space-y-1.5 text-sm text-foreground-600">
            <li className="flex items-start gap-2"><i className="ri-check-line text-emerald-500 mt-0.5"></i> You are expected to attend at least 90% of all scheduled sessions.</li>
            <li className="flex items-start gap-2"><i className="ri-check-line text-emerald-500 mt-0.5"></i> Report absences as soon as possible — ideally at least 24 hours before.</li>
            <li className="flex items-start gap-2"><i className="ri-check-line text-emerald-500 mt-0.5"></i> Catch-up work must be completed within 5 working days of the missed session.</li>
            <li className="flex items-start gap-2"><i className="ri-check-line text-emerald-500 mt-0.5"></i> Repeated unexplained absences will be escalated to your line manager.</li>
          </ul>
        </div>

        {/* Recent Absence History */}
        <section className="bg-background-50 rounded-xl border border-background-200/50 p-5">
          <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-3">Your Recent Absence History</h3>
          {RECENT_ABSENCES.map(ab => (
            <div key={ab.id} className="flex items-center justify-between py-2 border-b border-foreground-300/50 last:border-b-0">
              <div>
                <p className="text-sm font-medium text-foreground-900">{ab.title}</p>
                <p className="text-xs text-foreground-400">{ab.date} &middot; {ab.reason}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${ab.status === 'Approved' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{ab.status}</span>
                <span className="text-xs font-semibold bg-primary-100 text-primary-700 px-2 py-0.5 rounded-full">{ab.catchUp}</span>
              </div>
            </div>
          ))}
        </section>
      </div>
    </WorkspaceShell>
  );
}