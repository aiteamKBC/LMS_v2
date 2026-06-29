import { ClubEvent } from '../data';

interface EventRowProps {
  event: ClubEvent;
  compact?: boolean;
}

export function EventRow({ event, compact = false }: EventRowProps) {
  const statusConfig = {
    attending: { label: 'Attending', cls: 'bg-emerald-100 text-emerald-700' },
    'not-attending': { label: 'Not Attending', cls: 'bg-background-100 text-foreground-400' },
    available: { label: 'Available', cls: 'bg-amber-100 text-amber-700' },
  };
  const status = statusConfig[event.attendanceStatus];
  const isFull = event.rsvpCount >= event.capacity;
  const spotsLeft = event.capacity - event.rsvpCount;
  const fillPercent = Math.min(100, (event.rsvpCount / event.capacity) * 100);

  if (compact) {
    return (
      <div className={`p-3 flex items-center gap-3 rounded-lg transition-smooth ${event.joined ? 'hover:bg-primary-50/30' : 'hover:bg-background-100/50'}`}>
        <div className={`rounded-lg px-3 py-2 text-center shrink-0 min-w-[56px] ${event.joined ? 'bg-primary-100 text-primary-700' : 'bg-background-100 text-foreground-500'}`}>
          <p className="text-xs font-bold leading-tight">{event.date.split(' ')[0]}</p>
          <p className="text-[9px] font-medium uppercase mt-0.5">{event.dayName}</p>
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-semibold text-foreground-900 truncate">{event.title}</h4>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
            <span className="text-xs text-foreground-400">{event.club}</span>
            <span className="text-xs font-medium px-1.5 py-0.5 rounded-full bg-background-100 text-foreground-500">{event.type}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs font-bold text-accent-600 bg-accent-50 px-2 py-0.5 rounded-full">+{event.points} pts</span>
          <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${status.cls}`}>{status.label}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`p-4 flex flex-col sm:flex-row sm:items-center gap-4 transition-smooth ${event.joined ? 'hover:bg-primary-50/30' : 'hover:bg-background-100/50'}`}>
      <div className={`rounded-xl px-4 py-3 text-center shrink-0 min-w-[72px] ${event.joined ? 'bg-primary-100 text-primary-700' : 'bg-background-100 text-foreground-500'}`}>
        <p className="text-sm font-bold leading-tight">{event.date.split(' ')[0]}</p>
        <p className="text-[9px] font-medium uppercase tracking-wide mt-0.5">{event.date.split(' ')[1] || event.dayName}</p>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-0.5">
          <h4 className="text-sm font-semibold text-foreground-900">{event.title}</h4>
          {event.hasQrCode && (
            <span className="text-[9px] font-semibold bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full flex items-center gap-1">
              <i className="ri-qr-code-line text-[9px]"></i> Check-in
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1">
          <span className="text-xs text-foreground-400">{event.club}</span>
          <span className="text-[8px] text-foreground-300">&middot;</span>
          <span className="text-xs text-foreground-400"><i className="ri-time-line mr-0.5 text-xs"></i>{event.time}</span>
          <span className="text-[8px] text-foreground-300">&middot;</span>
          <span className="text-xs font-medium px-1.5 py-0.5 rounded-full bg-background-100 text-foreground-500">{event.type}</span>
          <span className="text-[8px] text-foreground-300">&middot;</span>
          <span className="text-xs font-medium px-1.5 py-0.5 rounded-full bg-background-100 text-foreground-500">{event.format}</span>
        </div>
        <div className="flex items-center gap-3 mt-1 flex-wrap">
          <span className="text-xs text-foreground-400"><i className="ri-user-line mr-0.5"></i>{event.host} — {event.hostRole}</span>
          <span className="text-xs text-foreground-400"><i className="ri-map-pin-line mr-0.5"></i>{event.location}</span>
          <span className="text-xs font-bold text-accent-600 bg-accent-50 px-2 py-0.5 rounded-full">+{event.points} pts</span>
        </div>
        {/* Capacity bar */}
        <div className="mt-2 flex items-center gap-2">
          <div className="flex-1 max-w-[200px] h-1.5 bg-background-200 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${isFull ? 'bg-rose-400' : spotsLeft <= 3 ? 'bg-amber-400' : 'bg-emerald-400'}`}
              style={{ width: `${fillPercent}%` }}
            ></div>
          </div>
          <span className={`text-[10px] font-semibold ${isFull ? 'text-rose-600' : spotsLeft <= 3 ? 'text-amber-600' : 'text-emerald-600'}`}>
            {isFull ? 'Full' : `${event.rsvpCount}/${event.capacity} spots`}
          </span>
          {event.waitlist.length > 0 && (
            <span className="text-[10px] text-amber-600 font-medium">
              <i className="ri-hourglass-line mr-0.5"></i>{event.waitlist.length} waiting
            </span>
          )}
        </div>
        {!compact && (
          <p className="text-xs text-foreground-400 mt-1.5 leading-relaxed">{event.description}</p>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {event.joined ? (
          <>
            <span className={`text-xs font-semibold px-2 py-1 rounded-full ${status.cls}`}>{status.label}</span>
            <button className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-xs font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
              <i className="ri-calendar-2-line mr-1"></i> Add to Calendar
            </button>
          </>
        ) : (
          <button className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-xs font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
            <i className="ri-add-line mr-1"></i> Join to Attend
          </button>
        )}
      </div>
    </div>
  );
}