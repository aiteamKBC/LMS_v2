import { COACH_PROFILE } from '@/mocks/monthly-coaching';

export default function CoachSupportSection() {
  const c = COACH_PROFILE;

  return (
    <section className="rounded-2xl border border-background-200/50 bg-background-50 overflow-hidden">
      <div className="p-6 md:p-8">
        <div className="flex items-center gap-2 mb-6">
          <div className="w-8 h-8 rounded-lg bg-secondary-100 flex items-center justify-center">
            <AppIcon className="ri-user-voice-line text-secondary-700" />
          </div>
          <h2 className="text-lg font-heading font-semibold text-foreground-900">Coach Support</h2>
        </div>

        <div className="flex flex-col md:flex-row gap-6">
          {/* Profile Card */}
          <div className="rounded-xl border border-background-200/50 bg-background-100/30 p-5 md:w-72 shrink-0">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-14 h-14 rounded-full bg-primary-100 flex items-center justify-center text-xl font-bold text-primary-700">
                {c.initials}
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground-900">{c.name}</p>
                <p className="text-xs text-foreground-400">{c.role}</p>
              </div>
            </div>
            <p className="text-xs text-foreground-500 leading-relaxed mb-4">{c.bio}</p>

            <div className="space-y-2 mb-4">
              <div className="flex items-center gap-2 text-xs text-foreground-500">
                <AppIcon className="ri-time-line text-foreground-400" />
                <span>{c.responseTime}</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-foreground-500">
                <AppIcon className="ri-calendar-check-line text-foreground-400" />
                <span>{c.availability}</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-foreground-500">
                <AppIcon className="ri-calendar-event-line text-foreground-400" />
                <span>Next available: {c.nextAvailable}</span>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <button className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-primary-500 text-white rounded-lg text-sm font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
                <AppIcon className="ri-mail-line" />
                Message Coach
              </button>
              <button className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-background-100 text-foreground-700 rounded-lg text-sm font-semibold border border-background-200/50 hover:bg-background-200 transition-smooth cursor-pointer whitespace-nowrap">
                <AppIcon className="ri-calendar-schedule-line" />
                Book Additional Support
              </button>
            </div>
          </div>

          {/* Recent Support */}
          <div className="flex-1 min-w-0">
            <h3 className="text-xs font-semibold text-foreground-400 uppercase tracking-wide mb-3">Recent Support</h3>
            <div className="space-y-3">
              {c.recentSupport.map((support, i) => (
                <div key={i} className="flex items-start gap-3 p-3 rounded-lg border border-background-200/50 bg-background-100/30">
                  <div className="w-8 h-8 rounded-full bg-secondary-100 flex items-center justify-center shrink-0">
                    <AppIcon className={`${support.type === 'Message' ? 'ri-mail-line' : 'ri-phone-line'} text-secondary-700 text-sm`} />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground-800">{support.type} — {support.topic}</p>
                    <p className="text-xs text-foreground-400 mt-0.5">{support.date}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}