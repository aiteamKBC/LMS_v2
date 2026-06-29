import { MEETING_AGENDA } from '@/mocks/monthly-coaching';

export default function MeetingAgendaSection() {
  return (
    <section className="rounded-2xl border border-background-200/50 bg-background-50 overflow-hidden">
      <div className="p-6 md:p-8">
        <div className="flex items-center gap-2 mb-6">
          <div className="w-8 h-8 rounded-lg bg-secondary-100 flex items-center justify-center">
            <i className="ri-calendar-schedule-line text-secondary-700" />
          </div>
          <h2 className="text-lg font-heading font-semibold text-foreground-900">Meeting Agenda</h2>
        </div>

        {/* Timeline */}
        <div className="relative">
          {/* Vertical line */}
          <div className="absolute left-5 md:left-6 top-0 bottom-0 w-0.5 bg-background-200/60" />

          <div className="space-y-6">
            {MEETING_AGENDA.map((item, index) => (
              <div key={item.id} className="relative flex gap-4 md:gap-6">
                {/* Step indicator */}
                <div className="relative z-10 flex flex-col items-center shrink-0">
                  <div className="w-10 h-10 md:w-12 md:h-12 rounded-full bg-primary-500 text-white flex items-center justify-center font-bold text-sm md:text-base">
                    {item.step}
                  </div>
                  {/* Duration pill */}
                  <div className="mt-2 px-2 py-1 rounded-md bg-background-100 border border-background-200/50 text-xs font-medium text-foreground-500 whitespace-nowrap">
                    {item.duration}
                  </div>
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0 pb-2">
                  <div className="flex items-center gap-2 mb-1">
                    <i className={`${item.icon} text-primary-600`} />
                    <h3 className="text-sm font-semibold text-foreground-900">{item.title}</h3>
                  </div>
                  <p className="text-sm text-foreground-500 leading-relaxed">{item.purpose}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}