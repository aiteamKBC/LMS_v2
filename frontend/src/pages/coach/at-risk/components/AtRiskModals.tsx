import { useState } from 'react';

/* ──────────────────────────────────────────────────────────────
   At-Risk Modals — Intervention, Escalation, Contact Employer
   ────────────────────────────────────────────────────────────── */

export type AtRiskLearner = {
  id: string;
  name: string;
  initials: string;
  programme: string;
  employer: string;
  cohortId: string;
  cohortName: string;
  group: string;
  riskLevel: 'high' | 'medium' | 'low';
  enrollmentStatus: 'active' | 'break' | 'withdrawn';
  riskFlags: string[];
  overallProgress: number;
  attendanceRate: number;
  otjhCompleted: number;
  otjhTarget: number;
  ksbProgress: number;
  lastIntervention: string;
  interventionCount: number;
  assignedCoach: string;
  daysSinceFlag: number;
  escalationStatus: 'none' | 'pending' | 'escalated';
};

// ─── Intervention Modal ───────────────────────────────────────────
interface InterventionModalProps {
  learner: AtRiskLearner;
  onClose: () => void;
  onSubmit: (data: { type: string; notes: string; followUp: string }) => void;
}

export function InterventionModal({ learner, onClose, onSubmit }: InterventionModalProps) {
  const [type, setType] = useState('Phone Call');
  const [notes, setNotes] = useState('');
  const [followUp, setFollowUp] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!notes.trim()) return;
    onSubmit({ type, notes, followUp });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose}></div>
      <div className="relative w-full max-w-md bg-background-50 rounded-2xl border border-foreground-200 shadow-2xl shadow-foreground-950/15 overflow-hidden">
        <div className="flex items-center justify-between p-5 border-b border-foreground-400/50">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary-100 flex items-center justify-center">
              <i className="ri-chat-smile-2-line text-primary-600 text-base"></i>
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground-900">Log Intervention</p>
              <p className="text-[11px] text-foreground-400">{learner.name}</p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-foreground-400 hover:text-foreground-700 hover:bg-background-100 transition-smooth cursor-pointer">
            <i className="ri-close-line"></i>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-[11px] font-semibold text-foreground-600 uppercase tracking-wide mb-1.5">Intervention Type</label>
            <div className="grid grid-cols-3 gap-2">
              {['Phone Call', 'Email', 'Meeting', 'Safeguarding Note', 'Employer Contact', 'Home Visit'].map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  className={`px-2 py-2 rounded-lg text-[11px] font-medium border transition-smooth cursor-pointer whitespace-nowrap ${type === t ? 'bg-primary-500 text-white border-primary-500' : 'bg-background-50 text-foreground-600 border-background-200 hover:border-primary-300'}`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-foreground-600 uppercase tracking-wide mb-1.5">Notes <span className="text-red-500">*</span></label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value.slice(0, 500))}
              rows={4}
              placeholder="Describe the intervention, what was discussed, learner response..."
              className="w-full px-3 py-2.5 bg-background-50 border border-background-200 rounded-lg text-[13px] text-foreground-800 placeholder:text-foreground-400 focus:outline-none focus:border-primary-300 resize-none"
            />
            <p className="text-[10px] text-foreground-400 mt-1 text-right">{notes.length}/500</p>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-foreground-600 uppercase tracking-wide mb-1.5">Follow-up Date (optional)</label>
            <input
              type="date"
              value={followUp}
              onChange={e => setFollowUp(e.target.value)}
              className="w-full px-3 py-2.5 bg-background-50 border border-background-200 rounded-lg text-[13px] text-foreground-800 focus:outline-none focus:border-primary-300"
            />
          </div>
          <div className="flex items-center gap-2 pt-2">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2.5 border border-background-200 rounded-lg text-[13px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">Cancel</button>
            <button type="submit" disabled={!notes.trim()} className="flex-1 px-4 py-2.5 bg-primary-500 text-white rounded-lg text-[13px] font-semibold hover:bg-primary-600 disabled:opacity-40 disabled:cursor-not-allowed transition-smooth cursor-pointer whitespace-nowrap"><i className="ri-check-line mr-1"></i> Log Intervention</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Escalation Modal ─────────────────────────────────────────────────
interface EscalateModalProps {
  learner: AtRiskLearner;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}

export function EscalateModal({ learner, onClose, onConfirm }: EscalateModalProps) {
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose}></div>
      <div className="relative w-full max-w-sm bg-background-50 rounded-2xl border border-foreground-200 shadow-2xl shadow-foreground-950/15 overflow-hidden">
        <div className="p-5">
          <div className="w-12 h-12 rounded-xl bg-amber-100 flex items-center justify-center mx-auto mb-4"><i className="ri-alarm-warning-line text-amber-600 text-xl"></i></div>
          <h3 className="text-sm font-bold text-foreground-900 text-center mb-1">Escalate {learner.name}?</h3>
          <p className="text-[12px] text-foreground-500 text-center mb-5">This will notify Safeguarding / Senior Leadership immediately.</p>
          <div className="space-y-3">
            <div>
              <label className="block text-[11px] font-semibold text-foreground-600 uppercase tracking-wide mb-1.5">Escalation Reason</label>
              <select value={reason} onChange={e => setReason(e.target.value)} className="w-full px-3 py-2.5 bg-background-50 border border-background-200 rounded-lg text-[13px] text-foreground-800 focus:outline-none focus:border-amber-400 cursor-pointer">
                <option value="">Select reason...</option>
                <option>Attendance below 70%</option>
                <option>Safeguarding concern</option>
                <option>Programme at risk of withdrawal</option>
                <option>Employer not cooperating</option>
                <option>Mental health / wellbeing concern</option>
                <option>Non-responsive to interventions</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-foreground-600 uppercase tracking-wide mb-1.5">Additional Notes</label>
              <textarea value={notes} onChange={e => setNotes(e.target.value.slice(0, 500))} rows={3} placeholder="Any additional context for the review team..." className="w-full px-3 py-2.5 bg-background-50 border border-background-200 rounded-lg text-[13px] text-foreground-800 placeholder:text-foreground-400 focus:outline-none focus:border-amber-400 resize-none" />
            </div>
          </div>
          <div className="flex items-center gap-2 mt-4">
            <button onClick={onClose} className="flex-1 px-4 py-2.5 border border-background-200 rounded-lg text-[13px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">Cancel</button>
            <button onClick={() => reason && onConfirm(reason)} disabled={!reason} className="flex-1 px-4 py-2.5 bg-amber-600 text-white rounded-lg text-[13px] font-semibold hover:bg-amber-700 disabled:opacity-40 disabled:cursor-not-allowed transition-smooth cursor-pointer whitespace-nowrap"><i className="ri-arrow-up-circle-line mr-1"></i> Escalate</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Contact Employer Modal ───────────────────────────────────────────
interface ContactEmployerModalProps {
  learner: AtRiskLearner;
  onClose: () => void;
  onSend: () => void;
}

export function ContactEmployerModal({ learner, onClose, onSend }: ContactEmployerModalProps) {
  const [subject, setSubject] = useState(`Learner Support: ${learner.name} — ${learner.programme}`);
  const [message, setMessage] = useState(`Dear ${learner.employer} Team,\n\nI am writing regarding ${learner.name}'s apprenticeship progress. We have identified some concerns that require your awareness and support.\n\nPlease contact me at your earliest convenience to discuss how we can best support ${learner.name.split(' ')[0]}.\n\nKind regards,\nMed Maher\nProgress Coach, KBC LearningOS`);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose}></div>
      <div className="relative w-full max-w-lg bg-background-50 rounded-2xl border border-foreground-200 shadow-2xl shadow-foreground-950/15 overflow-hidden">
        <div className="flex items-center justify-between p-5 border-b border-foreground-400/50">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-foreground-100 flex items-center justify-center"><i className="ri-building-2-line text-foreground-600 text-base"></i></div>
            <div><p className="text-sm font-semibold text-foreground-900">Contact Employer</p><p className="text-[11px] text-foreground-400">{learner.employer}</p></div>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-foreground-400 hover:text-foreground-700 hover:bg-background-100 transition-smooth cursor-pointer"><i className="ri-close-line"></i></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-[11px] font-semibold text-foreground-600 uppercase tracking-wide mb-1.5">Subject</label>
            <input type="text" value={subject} onChange={e => setSubject(e.target.value)} className="w-full px-3 py-2.5 bg-background-50 border border-background-200 rounded-lg text-[13px] text-foreground-800 focus:outline-none focus:border-primary-300" />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-foreground-600 uppercase tracking-wide mb-1.5">Message</label>
            <textarea value={message} onChange={e => setMessage(e.target.value.slice(0, 500))} rows={7} className="w-full px-3 py-2.5 bg-background-50 border border-background-200 rounded-lg text-[13px] text-foreground-800 focus:outline-none focus:border-primary-300 resize-none" />
            <p className="text-[10px] text-foreground-400 mt-1 text-right">{message.length}/500</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="flex-1 px-4 py-2.5 border border-background-200 rounded-lg text-[13px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">Cancel</button>
            <button onClick={onSend} className="flex-1 px-4 py-2.5 bg-foreground-900 text-white rounded-lg text-[13px] font-semibold hover:bg-foreground-800 transition-smooth cursor-pointer whitespace-nowrap"><i className="ri-send-plane-line mr-1"></i> Send Message</button>
          </div>
        </div>
      </div>
    </div>
  );
}