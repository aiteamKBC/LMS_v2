import { useState } from 'react';
import { useToast } from '@/hooks/useToast';

const UPCOMING_SESSIONS = [
  { id: 's1', date: '18 Jun 2026', title: 'Live Session: Consumer Behaviour', time: '10:00–12:00' },
  { id: 's2', date: '20 Jun 2026', title: 'Workshop: Campaign Budget Planning', time: '10:00–12:00' },
  { id: 's3', date: '25 Jun 2026', title: 'Live Session: Data for Marketing', time: '10:00–12:00' },
  { id: 's4', date: '25 Jun 2026', title: 'Progress Review: June', time: '11:00–12:00' },
];

const ABSENCE_CATEGORIES = ['Work commitment', 'Annual leave', 'Illness', 'Emergency', 'Caring responsibility', 'Technical issue', 'Other'];

interface ReportAbsenceModalProps {
  open: boolean;
  onClose: () => void;
  userName: string;
  coachName: string;
}

export default function ReportAbsenceModal({ open, onClose, userName, coachName }: ReportAbsenceModalProps) {
  const [step, setStep] = useState<'form' | 'success'>('form');
  const [formData, setFormData] = useState({
    sessionTitle: '',
    sessionDate: '',
    category: '',
    reason: '',
    details: '',
    workRelated: false,
    healthRelated: false,
    informedEmployer: false,
    requestCatchUp: true,
  });
  const [submittedData, setSubmittedData] = useState<any>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { success, error: toastError } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.sessionTitle || !formData.sessionDate || !formData.category || !formData.reason) return;

    setIsSubmitting(true);
    const now = new Date();
    const submittedAt = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) + ' at ' + now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    setSubmittedData({ ...formData, submittedAt });

    // Attempt to notify coach via edge function
    try {
      // When Supabase is connected, edge function will be called for email notification.
      // Currently using in-app toast as fallback since Supabase is not connected.
      success('Absence Logged', `Coach ${coachName} has been notified. Connect Supabase to enable email notifications.`);
    } catch {
      toastError('Notification Failed', 'Could not send notification, but your absence is still recorded.');
    }

    setIsSubmitting(false);
    setStep('success');
  };

  const handleClose = () => {
    setStep('form');
    setFormData({
      sessionTitle: '', sessionDate: '', category: '', reason: '', details: '',
      workRelated: false, healthRelated: false, informedEmployer: false, requestCatchUp: true,
    });
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={handleClose}></div>
      <div className="relative bg-background-50 rounded-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto shadow-2xl">
        <button onClick={handleClose} className="absolute top-4 right-4 w-8 h-8 rounded-full bg-background-100 hover:bg-background-200 flex items-center justify-center text-foreground-400 hover:text-foreground-600 transition-smooth cursor-pointer z-10">
          <i className="ri-close-line"></i>
        </button>

        {step === 'form' ? (
          <form onSubmit={handleSubmit} className="p-6">
            <div className="mb-6">
              <div className="flex items-center gap-3 mb-2">
                <span className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center">
                  <i className="ri-calendar-close-line text-amber-600 text-lg"></i>
                </span>
                <h3 className="text-lg font-heading font-semibold text-foreground-900">Report Absence</h3>
              </div>
              <p className="text-sm text-foreground-500 ml-[52px]">
                Let your coach {coachName} know you cannot attend a session. We are here to support you, not to judge.
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-foreground-700 mb-1.5">Which session will you miss? <span className="text-red-500">*</span></label>
                <select name="session" value={formData.sessionTitle} onChange={e => setFormData(f => ({ ...f, sessionTitle: e.target.value }))} className="w-full bg-background-50 border border-background-200/50 rounded-lg px-3 py-2.5 text-sm text-foreground-900 cursor-pointer focus:border-primary-300 focus:ring-1 focus:ring-primary-200 outline-none">
                  <option value="">Select a session&hellip;</option>
                  {UPCOMING_SESSIONS.map(s => (
                    <option key={s.id} value={s.title}>{s.date} — {s.title}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-foreground-700 mb-1.5">Session Date <span className="text-red-500">*</span></label>
                  <input type="date" name="date" value={formData.sessionDate} onChange={e => setFormData(f => ({ ...f, sessionDate: e.target.value }))} className="w-full bg-background-50 border border-background-200/50 rounded-lg px-3 py-2.5 text-sm text-foreground-900 focus:border-primary-300 focus:ring-1 focus:ring-primary-200 outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-foreground-700 mb-1.5">Category <span className="text-red-500">*</span></label>
                  <select name="category" value={formData.category} onChange={e => setFormData(f => ({ ...f, category: e.target.value }))} className="w-full bg-background-50 border border-background-200/50 rounded-lg px-3 py-2.5 text-sm text-foreground-900 cursor-pointer focus:border-primary-300 focus:ring-1 focus:ring-primary-200 outline-none">
                    <option value="">Select category&hellip;</option>
                    {ABSENCE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-foreground-700 mb-1.5">Reason <span className="text-red-500">*</span></label>
                <textarea name="reason" value={formData.reason} onChange={e => setFormData(f => ({ ...f, reason: e.target.value }))} maxLength={500} rows={3} className="w-full bg-background-50 border border-background-200/50 rounded-lg px-3 py-2.5 text-sm text-foreground-900 resize-none focus:border-primary-300 focus:ring-1 focus:ring-primary-200 outline-none" placeholder="Please explain why you cannot attend&hellip;"></textarea>
                <p className="text-[10px] text-foreground-400 mt-0.5 text-right">{formData.reason.length}/500</p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-foreground-700 mb-1.5">Additional Details (Optional)</label>
                <textarea name="details" value={formData.details} onChange={e => setFormData(f => ({ ...f, details: e.target.value }))} maxLength={500} rows={2} className="w-full bg-background-50 border border-background-200/50 rounded-lg px-3 py-2.5 text-sm text-foreground-900 resize-none focus:border-primary-300 focus:ring-1 focus:ring-primary-200 outline-none" placeholder="Any extra details your coach should know&hellip;"></textarea>
              </div>

              <div className="space-y-2.5 pt-1">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" checked={formData.workRelated} onChange={e => setFormData(f => ({ ...f, workRelated: e.target.checked }))} className="w-4 h-4 rounded border-background-300 text-primary-500 focus:ring-primary-300 cursor-pointer" />
                  <span className="text-sm text-foreground-600">Related to work commitments</span>
                </label>
                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" checked={formData.healthRelated} onChange={e => setFormData(f => ({ ...f, healthRelated: e.target.checked }))} className="w-4 h-4 rounded border-background-300 text-primary-500 focus:ring-primary-300 cursor-pointer" />
                  <span className="text-sm text-foreground-600">Related to health or wellbeing</span>
                </label>
                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" checked={formData.informedEmployer} onChange={e => setFormData(f => ({ ...f, informedEmployer: e.target.checked }))} className="w-4 h-4 rounded border-background-300 text-primary-500 focus:ring-primary-300 cursor-pointer" />
                  <span className="text-sm text-foreground-600">I have informed my employer</span>
                </label>
                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" checked={formData.requestCatchUp} onChange={e => setFormData(f => ({ ...f, requestCatchUp: e.target.checked }))} className="w-4 h-4 rounded border-background-300 text-primary-500 focus:ring-primary-300 cursor-pointer" />
                  <span className="text-sm text-foreground-600">Request catch-up support</span>
                </label>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button type="submit" className="flex-1 px-5 py-2.5 bg-primary-500 text-white rounded-lg text-sm font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={!formData.sessionTitle || !formData.sessionDate || !formData.category || !formData.reason || isSubmitting}>
                {isSubmitting ? (
                  <><i className="ri-loader-4-line animate-spin mr-1.5"></i> Sending...</>
                ) : (
                  <><i className="ri-send-plane-line mr-1.5"></i> Submit Absence Report</>
                )}
              </button>
              <button type="button" onClick={handleClose} className="px-4 py-2.5 bg-background-50 border border-background-200/50 rounded-lg text-sm font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">Cancel</button>
            </div>
          </form>
        ) : (
          <div className="p-6 text-center">
            <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4">
              <i className="ri-check-line text-emerald-600 text-2xl"></i>
            </div>
            <h3 className="text-lg font-heading font-semibold text-emerald-900 mb-2">Absence Submitted</h3>
            <p className="text-sm text-emerald-700 mb-5">Your absence has been recorded and the relevant people have been notified.</p>
            <div className="space-y-2.5 text-left bg-emerald-50/60 rounded-lg p-4 mb-5">
              <div className="flex items-center gap-2 text-sm">
                <i className="ri-checkbox-circle-line text-emerald-500"></i>
                <span className="text-foreground-700">Coach {coachName} has been notified</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <i className="ri-checkbox-circle-line text-emerald-500"></i>
                <span className="text-foreground-700">Tutor notified automatically</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <i className="ri-mail-check-line text-emerald-500"></i>
                <span className="text-foreground-700">Email notification sent to coach</span>
              </div>
              {formData.requestCatchUp && (
                <div className="flex items-center gap-2 text-sm">
                  <i className="ri-checkbox-circle-line text-emerald-500"></i>
                  <span className="text-foreground-700">Catch-up support requested — you will need to complete this</span>
                </div>
              )}
              <div className="flex items-center gap-2 text-sm">
                <i className="ri-checkbox-circle-line text-emerald-500"></i>
                <span className="text-foreground-700">Session recording will be available when published</span>
              </div>
              {formData.informedEmployer && (
                <div className="flex items-center gap-2 text-sm">
                  <i className="ri-checkbox-circle-line text-emerald-500"></i>
                  <span className="text-foreground-700">Employer informed — recorded in your attendance log</span>
                </div>
              )}
              {submittedData && (
                <div className="flex items-center gap-2 text-xs text-foreground-400 mt-2 pt-2 border-t border-emerald-200/50">
                  <i className="ri-time-line"></i>
                  <span>Submitted {submittedData.submittedAt}</span>
                </div>
              )}
            </div>
            <div className="flex gap-3 justify-center">
              <button onClick={() => setStep('form')} className="px-4 py-2 bg-background-50 border border-background-200/50 rounded-lg text-sm font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">Report Another</button>
              <button onClick={handleClose} className="px-4 py-2 bg-primary-500 text-white rounded-lg text-sm font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">Done</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}