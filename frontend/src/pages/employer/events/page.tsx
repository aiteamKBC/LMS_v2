import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const employerNav = roleNavMap.employer;

interface Event {
  id: string;
  title: string;
  date: string;
  time: string;
  type: 'employer-networking' | 'learner-club' | 'guest-speaker' | 'enrichment' | 'epa-preparation' | 'recognition';
  description: string;
  attendees: number;
  attending: boolean;
  location: string;
  relevantApprentices: string[];
}

const EVENTS: Event[] = [
  { id: 'ev-01', title: 'Employer Networking Breakfast — Q3 2026', date: '22 Jun 2026', time: '08:30 – 10:00', type: 'employer-networking', description: 'Quarterly networking breakfast for apprenticeship employers. Share experiences, discuss funding updates and hear from KBC leadership on programme developments.', attendees: 28, attending: false, location: 'KBC Campus, Canterbury', relevantApprentices: [] },
  { id: 'ev-02', title: 'Marketing Club: Campaign Planning Workshop', date: '14 Jun 2026', time: '16:00 – 17:30', type: 'learner-club', description: 'Sophie Williams and Tom Richards will be presenting their workplace campaign projects. Employers welcome to observe and provide industry feedback.', attendees: 18, attending: true, location: 'Online — Teams', relevantApprentices: ['Sophie Williams', 'Tom Richards'] },
  { id: 'ev-03', title: 'Guest Speaker: Future of Digital Marketing in QSR', date: '28 Jun 2026', time: '15:00 – 16:00', type: 'guest-speaker', description: 'Senior Brand Manager from Pret a Manger shares insights on digital marketing trends in the quick-service restaurant sector.', attendees: 45, attending: false, location: 'Online — Teams', relevantApprentices: ['Sophie Williams', 'Tom Richards', 'Mark Jensen'] },
  { id: 'ev-04', title: 'Apprentice Recognition Ceremony — Q2 2026', date: '30 Jun 2026', time: '14:00 – 16:00', type: 'recognition', description: 'Celebrating apprentice achievements from the past quarter. Daniel Clarke nominated for outstanding progress award. Employers invited to celebrate their apprentices.', attendees: 62, attending: true, location: 'KBC Main Hall, Canterbury', relevantApprentices: ['Daniel Clarke', 'Sophie Williams', 'Rachel Thompson'] },
  { id: 'ev-05', title: 'EPA Preparation Workshop for Employers', date: '8 Jul 2026', time: '10:00 – 12:00', type: 'epa-preparation', description: 'Learn about the End Point Assessment process, what employers need to know about gateway readiness, and how to support apprentices through EPA.', attendees: 19, attending: false, location: 'Online — Teams', relevantApprentices: ['Mark Jensen', 'Daniel Clarke'] },
  { id: 'ev-06', title: 'Digital Skills Lab: AI Tools for the Workplace', date: '21 Jun 2026', time: '16:00 – 17:30', type: 'learner-club', description: 'Workshop session exploring practical AI tools for marketing and business administration. Mark Jensen leading a hands-on demo.', attendees: 22, attending: false, location: 'Online — Teams', relevantApprentices: ['Mark Jensen'] },
  { id: 'ev-07', title: 'South East Apprenticeship Employer Forum', date: '5 Jul 2026', time: '09:30 – 13:00', type: 'employer-networking', description: 'Regional employer forum covering policy changes, funding reform updates and apprenticeship quality improvements across Kent, Sussex and Surrey.', attendees: 87, attending: false, location: 'Maidstone Conference Centre', relevantApprentices: [] },
  { id: 'ev-08', title: 'Line Manager Development: Coaching Apprentices', date: '12 Jul 2026', time: '10:00 – 11:30', type: 'enrichment', description: 'CPD session for line managers on effective coaching techniques, supporting apprentice development and workplace learning integration.', attendees: 35, attending: false, location: 'Online — Teams', relevantApprentices: [] },
  { id: 'ev-09', title: 'Business Admin Club: Exam Revision Session', date: '19 Jun 2026', time: '16:00 – 17:00', type: 'learner-club', description: 'Peer-led revision session for Business Administrator apprentices preparing for knowledge assessments. Daniel Clarke facilitating.', attendees: 14, attending: true, location: 'Online — Teams', relevantApprentices: ['Daniel Clarke'] },
  { id: 'ev-10', title: 'Data Analytics Showcase', date: '25 Jun 2026', time: '15:00 – 16:30', type: 'enrichment', description: 'Rachel Thompson presenting her data analysis project on customer footfall patterns — employers can see real workplace learning in action.', attendees: 16, attending: false, location: 'Online — Teams', relevantApprentices: ['Rachel Thompson'] },
];

export default function EmployerEvents() {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);

  const filtered = EVENTS.filter(e => {
    if (search && !e.title.toLowerCase().includes(search.toLowerCase())) return false;
    if (typeFilter !== 'all' && e.type !== typeFilter) return false;
    return true;
  });

  const attending = EVENTS.filter(e => e.attending).length;
  const myApprenticeEvents = EVENTS.filter(e => e.relevantApprentices.length > 0).length;

  const typeLabels: Record<string, string> = {
    'employer-networking': 'Networking',
    'learner-club': 'Learner Club',
    'guest-speaker': 'Guest Speaker',
    'enrichment': 'Enrichment',
    'epa-preparation': 'EPA Prep',
    'recognition': 'Recognition',
  };

  const typeIcons: Record<string, string> = {
    'employer-networking': 'ri-building-2-line',
    'learner-club': 'ri-team-line',
    'guest-speaker': 'ri-mic-line',
    'enrichment': 'ri-lightbulb-line',
    'epa-preparation': 'ri-flag-line',
    'recognition': 'ri-trophy-line',
  };

  const typeColors: Record<string, string> = {
    'employer-networking': 'bg-primary-100 text-primary-700',
    'learner-club': 'bg-accent-50 text-accent-700',
    'guest-speaker': 'bg-secondary-100 text-secondary-700',
    'enrichment': 'bg-emerald-100 text-emerald-700',
    'epa-preparation': 'bg-amber-100 text-amber-700',
    'recognition': 'bg-rose-100 text-rose-700',
  };

  return (
    <WorkspaceShell role="employer" roleLabel={employerNav.label} navItems={employerNav.items} workspaceLabel={employerNav.workspaceLabel} pageTitle="Events" pageSubtitle="Employer-relevant events, learner club sessions, networking and recognition" userName="Lauren Mitchell" userRole="Line Manager — Tim Hortons UK">
      <div className="p-6 space-y-6">
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/5" />
          <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0">
              <AppIcon className="ri-calendar-event-line text-white text-2xl"></AppIcon>
            </span>
            <div className="flex-1">
              <h2 className="text-lg font-heading font-bold text-white mb-1">Events</h2>
              <p className="text-[13px] text-white/80 leading-relaxed">
                <strong>{EVENTS.length} upcoming events</strong> · {attending} you're attending · {myApprenticeEvents} involve your apprentices
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-emerald-300">{attending}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Attending</p>
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="relative flex-1 sm:max-w-sm">
            <AppIcon className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></AppIcon>
            <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search events..." className="w-full pl-9 pr-3 py-2 bg-background-50 border border-foreground-200/60 rounded-lg text-[13px] text-foreground-900 placeholder:text-foreground-400 focus:outline-none focus:border-primary-300" />
          </div>
          <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1 flex-wrap">
            {[{ key: 'all', label: 'All' },{ key: 'employer-networking', label: 'Networking' },{ key: 'learner-club', label: 'Club Sessions' },{ key: 'guest-speaker', label: 'Speakers' },{ key: 'recognition', label: 'Recognition' },{ key: 'epa-preparation', label: 'EPA Prep' }].map(f => (
              <button key={f.key} onClick={() => setTypeFilter(f.key)} className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${typeFilter === f.key ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>{f.label}</button>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          {filtered.map(event => (
            <div key={event.id} className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 flex flex-col sm:flex-row sm:items-center gap-4 hover:border-primary-200/50 transition-smooth cursor-pointer" onClick={() => setSelectedEvent(event)}>
              <div className="rounded-xl px-3 py-3 text-center shrink-0 min-w-[72px] bg-accent-50">
                <p className="text-lg font-heading font-bold text-accent-700">{event.date.split(' ')[0]}</p>
                <p className="text-[10px] font-semibold text-accent-500">{event.date.split(' ')[1]} {event.date.split(' ')[2]}</p>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <h3 className="text-sm font-semibold text-foreground-900">{event.title}</h3>
                  <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${typeColors[event.type]}`}>{typeLabels[event.type]}</span>
                  {event.attending && (
                    <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                      <AppIcon className="ri-check-line text-[8px]"></AppIcon> Attending
                    </span>
                  )}
                </div>
                <p className="text-[12px] text-foreground-500 mb-2 line-clamp-2">{event.description}</p>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-foreground-400">
                  <span><AppIcon className="ri-time-line mr-1"></AppIcon> {event.time}</span>
                  <span><AppIcon className="ri-map-pin-line mr-1"></AppIcon> {event.location}</span>
                  <span><AppIcon className="ri-group-line mr-1"></AppIcon> {event.attendees} attending</span>
                </div>
                {event.relevantApprentices.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1 mt-2">
                    <span className="text-[10px] text-foreground-400">Apprentices:</span>
                    {event.relevantApprentices.map(a => (
                      <span key={a} className="text-[9px] font-medium px-2 py-0.5 rounded-full bg-accent-50 text-accent-700">{a}</span>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {event.attending ? (
                  <span className="px-3 py-1.5 bg-emerald-100 text-emerald-700 rounded-lg text-[11px] font-semibold whitespace-nowrap">
                    <AppIcon className="ri-calendar-check-line mr-1"></AppIcon> Registered
                  </span>
                ) : (
                  <button onClick={e => { e.stopPropagation(); }} className="px-4 py-2 bg-primary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
                    <AppIcon className="ri-add-circle-line mr-1"></AppIcon> Register
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        {selectedEvent && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setSelectedEvent(null)}>
            <div className="bg-background-50 rounded-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
              <div className="sticky top-0 bg-background-50 border-b border-foreground-400/50 px-6 py-4 flex items-center justify-between z-10">
                <h3 className="text-sm font-heading font-semibold text-foreground-900">{selectedEvent.title}</h3>
                <button onClick={() => setSelectedEvent(null)} className="w-8 h-8 rounded-lg bg-background-100 flex items-center justify-center hover:bg-background-200 transition-smooth cursor-pointer">
                  <AppIcon className="ri-close-line text-foreground-500"></AppIcon>
                </button>
              </div>
              <div className="p-6 space-y-4">
                <span className={`text-[10px] font-semibold px-2.5 py-1 rounded-full ${typeColors[selectedEvent.type]}`}>{typeLabels[selectedEvent.type]}</span>
                <p className="text-[13px] text-foreground-600 leading-relaxed">{selectedEvent.description}</p>
                <div className="bg-background-100 rounded-xl p-4 space-y-3">
                  <div className="flex items-center gap-2 text-[12px]"><AppIcon className="ri-calendar-line text-foreground-400"></AppIcon><span className="text-foreground-500">Date:</span><span className="font-medium text-foreground-900">{selectedEvent.date}</span></div>
                  <div className="flex items-center gap-2 text-[12px]"><AppIcon className="ri-time-line text-foreground-400"></AppIcon><span className="text-foreground-500">Time:</span><span className="font-medium text-foreground-900">{selectedEvent.time}</span></div>
                  <div className="flex items-center gap-2 text-[12px]"><AppIcon className="ri-map-pin-line text-foreground-400"></AppIcon><span className="text-foreground-500">Location:</span><span className="font-medium text-foreground-900">{selectedEvent.location}</span></div>
                  <div className="flex items-center gap-2 text-[12px]"><AppIcon className="ri-group-line text-foreground-400"></AppIcon><span className="text-foreground-500">Attendees:</span><span className="font-medium text-foreground-900">{selectedEvent.attendees} registered</span></div>
                  {selectedEvent.relevantApprentices.length > 0 && (
                    <div className="flex items-start gap-2 text-[12px]"><AppIcon className="ri-user-line text-foreground-400 mt-0.5"></AppIcon><span className="text-foreground-500">Relevant Apprentices:</span><span className="font-medium text-foreground-900">{selectedEvent.relevantApprentices.join(', ')}</span></div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {selectedEvent.attending ? (
                    <button className="flex-1 px-4 py-2 bg-background-100 text-foreground-500 rounded-lg text-[12px] font-medium cursor-not-allowed whitespace-nowrap" disabled>
                      <AppIcon className="ri-check-line mr-1"></AppIcon> Already Registered
                    </button>
                  ) : (
                    <button className="flex-1 px-4 py-2 bg-primary-500 text-white rounded-lg text-[12px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
                      <AppIcon className="ri-add-circle-line mr-1"></AppIcon> Register for Event
                    </button>
                  )}
                  <button className="px-4 py-2 bg-background-50 border border-background-200 rounded-lg text-[12px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">
                    <AppIcon className="ri-calendar-2-line mr-1"></AppIcon> Add to Calendar
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </WorkspaceShell>
  );
}