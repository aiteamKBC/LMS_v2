import { useState } from 'react';
import { NEXT_COACHING_MEETING } from '@/mocks/monthly-coaching';

export default function CoachingHeroSection() {
  const [hovered, setHovered] = useState(false);
  const m = NEXT_COACHING_MEETING;

  return (
    <section className="learner-super-admin-hero relative rounded-2xl overflow-hidden workspace-page-hero" >
      {/* Subtle top/bottom lines */}
      <div className="absolute top-0 left-0 right-0 h-px bg-primary-100/60"></div>
      <div className="absolute bottom-0 left-0 right-0 h-px bg-black/10"></div>

      <div className="relative h-full flex flex-col justify-end p-6 md:p-6">
        <div className="flex flex-col md:flex-row md:items-end gap-4 md:gap-6">
          <div className="flex-1 min-w-0 max-w-xl">
            <div className="flex items-center gap-2.5 mb-2">
              <span className="w-8 h-8 rounded-lg bg-primary-100/60 backdrop-blur-sm flex items-center justify-center">
                <AppIcon className="ri-chat-smile-2-line text-primary-800 text-sm"></AppIcon>
              </span>
              <span className="text-[10px] font-semibold text-foreground-500 uppercase tracking-widest">Monthly Coaching</span>
              <span className="text-[10px] font-semibold text-accent-300/80 bg-accent-400/10 px-2 py-0.5 rounded-full border border-accent-400/15">{m.cycleLabel}</span>
            </div>
            <h1 className="text-2xl md:text-3xl font-heading font-bold text-primary-800 tracking-tight mb-1.5">Next Coaching — {m.date}</h1>
            <p className="text-[13px] text-foreground-500 max-w-lg">
              {m.time} — {m.endTime} &middot; {m.location} &middot; Coach: {m.coach} &middot; {m.countdownDays} days until your next session
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <a
              href={m.meetingUrl}
              className="meeting-join-action inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition-smooth cursor-pointer whitespace-nowrap"
              onMouseEnter={() => setHovered(true)}
              onMouseLeave={() => setHovered(false)}
            >
              <AppIcon className={hovered ? 'ri-video-on-line' : 'ri-video-line'} />
              Join Meeting
            </a>
            <a
              href={m.calendarLink}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary-100/60 text-foreground-500 text-sm font-medium border border-primary-200/60 hover:bg-primary-100 transition-smooth cursor-pointer whitespace-nowrap"
            >
              <AppIcon className="ri-calendar-event-line" />
              Add To Calendar
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
