import { useState } from 'react';
import { OTJH_SIGN_OFF } from '@/mocks/monthly-coaching';

export default function OTJHSignOffSection() {
  const [signedName, setSignedName] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [signed, setSigned] = useState(false);
  const o = OTJH_SIGN_OFF;

  const isReady = o.status === 'Ready For Sign-Off';
  const canSign = signedName && confirmed;

  return (
    <section className="rounded-2xl border border-background-200/50 bg-background-50 overflow-hidden">
      <div className="p-6 md:p-8">
        <div className="flex items-center gap-2 mb-6">
          <div className="w-8 h-8 rounded-lg bg-primary-100 flex items-center justify-center">
            <AppIcon className="ri-shield-check-line text-primary-700" />
          </div>
          <h2 className="text-lg font-heading font-semibold text-foreground-900">Monthly OTJH Sign-Off</h2>
          <span className={`ml-auto text-xs font-semibold px-2.5 py-1 rounded-full ${isReady ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
            {o.status}
          </span>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          <div className="rounded-xl border border-background-200/50 bg-background-100/30 p-4">
            <p className="text-xs text-foreground-400 mb-1">Target Hours</p>
            <p className="text-xl font-bold font-heading text-foreground-900">{o.targetHours}h</p>
          </div>
          <div className="rounded-xl border border-background-200/50 bg-background-100/30 p-4">
            <p className="text-xs text-foreground-400 mb-1">Actual Hours</p>
            <p className={`text-xl font-bold font-heading ${o.actualHours < o.targetHours ? 'text-amber-600' : 'text-green-600'}`}>
              {o.actualHours}h
            </p>
          </div>
          <div className="rounded-xl border border-background-200/50 bg-background-100/30 p-4">
            <p className="text-xs text-foreground-400 mb-1">Variance</p>
            <p className={`text-xl font-bold font-heading ${o.variance < 0 ? 'text-red-600' : 'text-green-600'}`}>
              {o.variance > 0 ? '+' : ''}{o.variance}h
            </p>
          </div>
        </div>

        {/* Weekly Breakdown */}
        <div className="rounded-xl border border-background-200/50 bg-background-100/30 p-4 mb-6">
          <h3 className="text-xs font-semibold text-foreground-400 uppercase tracking-wide mb-3">Weekly Breakdown</h3>
          <div className="space-y-2">
            {o.monthlyBreakdown.map((week, i) => (
              <div key={i} className="flex items-center gap-3">
                <span className="text-xs text-foreground-500 w-32 shrink-0">{week.week}</span>
                <div className="flex-1 h-2 bg-background-200 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${week.status === 'On Track' ? 'bg-primary-500' : 'bg-amber-400'}`}
                    style={{ width: `${Math.min((week.hours / week.target) * 100, 100)}%` }}
                  />
                </div>
                <span className="text-xs font-medium text-foreground-700 w-16 text-right">
                  {week.hours} / {week.target}h
                </span>
                <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full shrink-0 ${
                  week.status === 'On Track' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                }`}>
                  {week.status}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Warning */}
        {!isReady && (
          <div className="rounded-xl border border-amber-200/50 bg-amber-50/30 p-4 mb-6 flex items-start gap-3">
            <AppIcon className="ri-alert-line text-amber-600 mt-0.5 shrink-0" />
            <p className="text-sm text-amber-800">{o.warning}</p>
          </div>
        )}

        {/* Declaration */}
        <div className="rounded-xl border border-background-200/50 bg-background-100/30 p-4 mb-6">
          <p className="text-sm text-foreground-600 leading-relaxed">{o.declaration}</p>
        </div>

        {/* Signature */}
        <div className="mb-4">
          <label className="block text-sm font-semibold text-foreground-700 mb-1.5">Electronic Signature (type your full name)</label>
          <input
            type="text"
            value={signedName}
            onChange={(e) => setSignedName(e.target.value)}
            placeholder="Sophie Williams"
            className="w-full bg-background-50 border border-background-200/50 rounded-lg px-3 py-2.5 text-sm text-foreground-900 outline-none focus:border-primary-300"
          />
        </div>

        <div className="flex items-center gap-3 mb-6">
          <input
            type="checkbox"
            id="otjhConfirm"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            className="w-4 h-4 rounded border-background-300 cursor-pointer"
          />
          <label htmlFor="otjhConfirm" className="text-sm text-foreground-700 cursor-pointer">
            I confirm and electronically sign this OTJH report for the meeting on {o.meetingDate}.
          </label>
        </div>

        <button
          onClick={() => { if (canSign) setSigned(true); }}
          disabled={!canSign}
          className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition-smooth cursor-pointer whitespace-nowrap ${
            signed
              ? 'bg-green-100 text-green-700 border border-green-200'
              : canSign
              ? 'bg-foreground-900 text-white hover:bg-foreground-700'
              : 'bg-background-200 text-foreground-400 cursor-not-allowed'
          }`}
        >
          <AppIcon className={signed ? 'ri-check-double-line' : 'ri-pen-nib-line'} />
          {signed ? 'OTJH Report Signed' : 'Sign OTJH Report'}
        </button>
      </div>
    </section>
  );
}