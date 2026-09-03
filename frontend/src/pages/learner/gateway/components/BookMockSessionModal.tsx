import { useState } from 'react';

interface BookMockSessionModalProps {
  isOpen: boolean;
  onClose: () => void;
  coachName: string;
  coachEmail: string;
}

const SESSION_TYPES = [
  { value: 'professional-discussion', label: 'Professional Discussion', icon: 'ri-chat-smile-2-line', desc: '60-min structured discussion practice with your coach' },
  { value: 'project-showcase', label: 'Project Showcase', icon: 'ri-presentation-line', desc: '15-min presentation + 30-min Q&A practice session' },
];

const TIME_SLOTS = [
  '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
  '13:00', '13:30', '14:00', '14:30', '15:00', '15:30',
  '16:00', '16:30',
];

export function BookMockSessionModal({ isOpen, onClose, coachName, coachEmail }: BookMockSessionModalProps) {
  const [sessionType, setSessionType] = useState('professional-discussion');
  const [preferredDate, setPreferredDate] = useState('');
  const [preferredTime, setPreferredTime] = useState('');
  const [notes, setNotes] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = () => {
    if (!preferredDate || !preferredTime) return;
    setSubmitting(true);
    setTimeout(() => {
      setSubmitting(false);
      setSubmitted(true);
    }, 1200);
  };

  const handleClose = () => {
    setSubmitted(false);
    setSessionType('professional-discussion');
    setPreferredDate('');
    setPreferredTime('');
    setNotes('');
    onClose();
  };

  const today = new Date().toISOString().split('T')[0];
  const maxDate = new Date();
  maxDate.setMonth(maxDate.getMonth() + 3);
  const maxDateStr = maxDate.toISOString().split('T')[0];

  const selectedType = SESSION_TYPES.find(t => t.value === sessionType);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={handleClose}></div>
      <div className="relative bg-background-50 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-xl animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="sticky top-0 bg-background-50 rounded-t-2xl border-b border-background-200/50 px-5 py-4 flex items-center justify-between z-10">
          <div className="flex items-center gap-3">
            <span className="w-9 h-9 rounded-lg bg-primary-100 flex items-center justify-center">
              <AppIcon className="ri-calendar-check-line text-primary-600"></AppIcon>
            </span>
            <div>
              <h3 className="text-sm font-heading font-semibold text-foreground-900">Book Mock Session</h3>
              <p className="text-xs text-foreground-400">Practice your EPA assessment with your coach</p>
            </div>
          </div>
          <button onClick={handleClose} className="w-8 h-8 rounded-lg hover:bg-background-100 flex items-center justify-center transition-smooth cursor-pointer">
            <AppIcon className="ri-close-line text-foreground-400"></AppIcon>
          </button>
        </div>

        {submitted ? (
          /* Success State */
          <div className="p-8 text-center">
            <div className="w-16 h-16 rounded-2xl bg-emerald-100 flex items-center justify-center mx-auto mb-4 animate-in zoom-in duration-300">
              <AppIcon className="ri-check-line text-emerald-600 text-2xl"></AppIcon>
            </div>
            <h4 className="text-base font-heading font-semibold text-foreground-900 mb-2">Session Requested!</h4>
            <p className="text-sm text-foreground-500 leading-relaxed mb-1">
              Your mock {selectedType?.label} session request has been sent to <strong>{coachName}</strong>.
            </p>
            <p className="text-xs text-foreground-400 mb-6">
              They will confirm the date and time. You'll receive a notification once it's scheduled.
            </p>
            <div className="bg-background-100 rounded-xl p-4 text-left mb-6">
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-foreground-400">Session Type</span>
                  <span className="font-semibold text-foreground-900">{selectedType?.label}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-foreground-400">Preferred Date</span>
                  <span className="font-semibold text-foreground-900">{preferredDate}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-foreground-400">Preferred Time</span>
                  <span className="font-semibold text-foreground-900">{preferredTime}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-foreground-400">Coach</span>
                  <span className="font-semibold text-foreground-900">{coachName}</span>
                </div>
              </div>
            </div>
            <button
              onClick={handleClose}
              className="px-6 py-2.5 bg-primary-500 text-white rounded-lg text-sm font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap"
            >
              Done
            </button>
          </div>
        ) : (
          /* Form */
          <div className="p-5 space-y-5">
            {/* Coach Info */}
            <div className="bg-background-100/70 rounded-xl p-3.5 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center ring-2 ring-primary-200 shrink-0">
                <span className="text-sm font-bold text-primary-700">{coachName.charAt(0)}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground-900">{coachName}</p>
                <p className="text-xs text-foreground-400">{coachEmail}</p>
              </div>
              <span className="w-2 h-2 rounded-full bg-emerald-500 ring-2 ring-emerald-100 shrink-0" title="Online"></span>
            </div>

            {/* Session Type */}
            <div>
              <label className="text-xs font-semibold text-foreground-700 mb-2 block">Session Type</label>
              <div className="space-y-2">
                {SESSION_TYPES.map(type => (
                  <button
                    key={type.value}
                    onClick={() => setSessionType(type.value)}
                    className={`w-full flex items-start gap-3 p-3.5 rounded-xl border transition-smooth cursor-pointer text-left ${
                      sessionType === type.value
                        ? 'border-primary-300 bg-primary-50 ring-1 ring-primary-200/50'
                        : 'border-background-200/50 bg-background-50 hover:bg-background-100/50'
                    }`}
                  >
                    <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
                      sessionType === type.value ? 'bg-primary-200/50 text-primary-700' : 'bg-background-100 text-foreground-400'
                    }`}>
                      <AppIcon className={`${type.icon} text-sm`}></AppIcon>
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-semibold ${sessionType === type.value ? 'text-primary-900' : 'text-foreground-900'}`}>
                        {type.label}
                      </p>
                      <p className="text-xs text-foreground-400 mt-0.5">{type.desc}</p>
                    </div>
                    {sessionType === type.value && (
                      <AppIcon className="ri-checkbox-circle-fill text-primary-500 shrink-0 mt-1"></AppIcon>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Date */}
            <div>
              <label className="text-xs font-semibold text-foreground-700 mb-2 block">Preferred Date</label>
              <input
                type="date"
                value={preferredDate}
                onChange={e => setPreferredDate(e.target.value)}
                min={today}
                max={maxDateStr}
                className="w-full px-4 py-2.5 rounded-xl border border-background-200/50 bg-background-50 text-sm text-foreground-900 focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-300 transition-smooth"
              />
              <p className="text-[10px] text-foreground-400 mt-1">Select a date within the next 3 months</p>
            </div>

            {/* Time */}
            <div>
              <label className="text-xs font-semibold text-foreground-700 mb-2 block">Preferred Time</label>
              <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
                {TIME_SLOTS.map(slot => (
                  <button
                    key={slot}
                    onClick={() => setPreferredTime(slot)}
                    aria-pressed={preferredTime === slot}
                    className={`py-2 rounded-lg text-xs font-semibold transition-smooth cursor-pointer whitespace-nowrap ${
                      preferredTime === slot
                        ? 'bg-primary-500 text-white'
                        : 'bg-background-100 text-foreground-600 hover:bg-background-200'
                    }`}
                  >
                    {slot}
                  </button>
                ))}
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="text-xs font-semibold text-foreground-700 mb-2 block">
                Notes for Coach <span className="font-normal text-foreground-400">(optional)</span>
              </label>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="E.g. I'd like to focus on the Professional Discussion. I'm particularly nervous about answering questions on marketing metrics..."
                maxLength={500}
                rows={3}
                className="w-full px-4 py-2.5 rounded-xl border border-background-200/50 bg-background-50 text-sm text-foreground-900 placeholder:text-foreground-300 focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-300 transition-smooth resize-none"
              ></textarea>
              <p className="text-[10px] text-foreground-400 mt-1">{notes.length}/500</p>
            </div>

            {/* Submit */}
            <button
              onClick={handleSubmit}
              disabled={!preferredDate || !preferredTime || submitting}
              className={`w-full py-3 rounded-xl text-sm font-semibold transition-smooth cursor-pointer whitespace-nowrap flex items-center justify-center gap-2 ${
                !preferredDate || !preferredTime || submitting
                  ? 'bg-background-200 text-foreground-400 cursor-not-allowed'
                  : 'bg-primary-500 text-white hover:bg-primary-600'
              }`}
            >
              {submitting ? (
                <>
                  <AppIcon className="ri-loader-4-line animate-spin"></AppIcon>
                  Sending Request...
                </>
              ) : (
                <>
                  <AppIcon className="ri-send-plane-line"></AppIcon>
                  Request Mock Session
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
