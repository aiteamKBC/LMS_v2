import { NEXT_TWO_MEETINGS } from '@/mocks/monthly-coaching';

export default function NextTwoMeetingsSection() {
  const n = NEXT_TWO_MEETINGS;

  return (
    <section className="rounded-2xl border border-background-200/50 bg-background-50 overflow-hidden">
      <div className="p-6 md:p-8">
        <div className="flex items-center gap-2 mb-6">
          <div className="w-8 h-8 rounded-lg bg-accent-100 flex items-center justify-center">
            <AppIcon className="ri-calendar-2-line text-accent-700" />
          </div>
          <h2 className="text-lg font-heading font-semibold text-foreground-900">Next Two Coaching Meetings</h2>
          <span className="ml-auto text-xs text-foreground-400">KBC Policy Required</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {n.map((meeting) => (
            <div key={meeting.id} className="rounded-xl border border-background-200/50 bg-background-100/30 p-5 hover:bg-background-100/60 transition-smooth">
              <div className="flex items-center gap-2 mb-4">
                <span className="text-xs font-semibold text-primary-700 bg-primary-100 px-2.5 py-1 rounded-full">
                  {meeting.label}
                </span>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                  meeting.status === 'Confirmed' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                }`}>
                  {meeting.status}
                </span>
              </div>

              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-primary-100 flex items-center justify-center shrink-0">
                    <AppIcon className="ri-calendar-line text-primary-700" />
                  </div>
                  <div>
                    <p className="text-xs text-foreground-400">Date</p>
                    <p className="text-sm font-semibold text-foreground-900">{meeting.date}</p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-primary-100 flex items-center justify-center shrink-0">
                    <AppIcon className="ri-time-line text-primary-700" />
                  </div>
                  <div>
                    <p className="text-xs text-foreground-400">Time</p>
                    <p className="text-sm font-semibold text-foreground-900">{meeting.time} — {meeting.endTime}</p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-primary-100 flex items-center justify-center shrink-0">
                    <AppIcon className="ri-map-pin-line text-primary-700" />
                  </div>
                  <div>
                    <p className="text-xs text-foreground-400">Location</p>
                    <p className="text-sm font-semibold text-foreground-900">{meeting.location}</p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-primary-100 flex items-center justify-center shrink-0">
                    <AppIcon className="ri-loop-left-line text-primary-700" />
                  </div>
                  <div>
                    <p className="text-xs text-foreground-400">Coaching Cycle</p>
                    <p className="text-sm font-semibold text-foreground-900">{meeting.cycle}</p>
                  </div>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-background-200/30 flex items-center gap-2 text-xs text-foreground-500">
                {meeting.calendarInvitationSent && (
                  <span className="flex items-center gap-1">
                    <AppIcon className="ri-check-line text-green-500" /> Calendar invitation sent
                  </span>
                )}
                {meeting.meetingConfirmed && (
                  <span className="flex items-center gap-1">
                    <AppIcon className="ri-check-line text-green-500" /> Meeting confirmed
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}