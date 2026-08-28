import { useState } from 'react';
import { NEXT_COACHING_MEETING } from '@/mocks/monthly-coaching';

export default function CoachingHeroSection() {
  const [hovered, setHovered] = useState(false);
  const m = NEXT_COACHING_MEETING;

  return (
    <section className="relative rounded-2xl overflow-hidden h-36 md:h-40" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
      {/* Subtle top/bottom lines */}
      <div className="absolute top-0 left-0 right-0 h-px bg-white/10"></div>
      <div className="absolute bottom-0 left-0 right-0 h-px bg-black/10"></div>

      <div className="relative h-full flex flex-col justify-end p-6 md:p-8">
        <div className="flex flex-col md:flex-row md:items-end gap-4 md:gap-6">
          <div className="flex-1 min-w-0 max-w-xl">
            <div className="flex items-center gap-2.5 mb-2">
              <span className="w-8 h-8 rounded-lg bg-white/15 backdrop-blur-sm flex items-center justify-center">
                <AppIcon className="ri-chat-smile-2-line text-white text-sm"></AppIcon>
              </span>
              <span className="text-[10px] font-semibold text-white/50 uppercase tracking-widest">Monthly Coaching</span>
              <span className="text-[10px] font-semibold text-accent-300/80 bg-accent-400/10 px-2 py-0.5 rounded-full border border-accent-400/15">{m.cycleLabel}</span>
            </div>
            <h1 className="text-2xl md:text-3xl font-heading font-bold text-white tracking-tight mb-1.5">Next Coaching — {m.date}</h1>
            <p className="text-[13px] text-white/50 max-w-lg">
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
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-white/10 text-white/80 text-sm font-medium border border-white/10 hover:bg-white/20 transition-smooth cursor-pointer whitespace-nowrap"
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
