import { useState } from 'react';
import type { EngagementEvent } from '@/api/engagement';
import type { EventEmailPurpose } from '@/api/eventFeedback';
import { AppIcon } from '@/components/feature/AppIcon';
import { EventEmailEditor } from './EventEmailEditor';

const emailPurposes: Array<{
  purpose: EventEmailPurpose;
  label: string;
  description: string;
}> = [
  {
    purpose: 'event_rsvp',
    label: 'RSVP invitation',
    description: 'The invitation asking recipients whether they plan to attend.',
  },
  {
    purpose: 'post_event',
    label: 'Post-event feedback',
    description: 'The message sent to attendees when their feedback is published.',
  },
];

export function EventEmailManager({ event, onClose }: { event: EngagementEvent; onClose: () => void }) {
  const [activePurpose, setActivePurpose] = useState<EventEmailPurpose>('event_rsvp');

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
    <section className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl" onClick={click => click.stopPropagation()} aria-labelledby="event-email-heading">
      <header className="flex items-start justify-between gap-3 border-b border-foreground-200 pb-4">
        <div>
          <h2 id="event-email-heading" className="text-lg font-bold text-foreground-900">Event email settings</h2>
          <p className="text-xs text-foreground-500">{event.title} · choose reusable templates or customise this event's copy.</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-2 text-foreground-500 hover:bg-background-100"><AppIcon className="ri-close-line" /></button>
      </header>

      <div className="mt-5 rounded-xl border border-foreground-200 bg-background-50 p-1" role="tablist" aria-label="Event email type">
        <div className="grid gap-1 sm:grid-cols-2">
          {emailPurposes.map(item => <button
            key={item.purpose}
            type="button"
            role="tab"
            aria-selected={activePurpose === item.purpose}
            aria-controls={`event-email-${item.purpose}`}
            onClick={() => setActivePurpose(item.purpose)}
            className={`rounded-lg px-4 py-3 text-left transition-colors ${activePurpose === item.purpose ? 'bg-white text-primary-700 shadow-sm' : 'text-foreground-500 hover:bg-white/60 hover:text-foreground-700'}`}
          >
            <strong className="block text-xs">{item.label}</strong>
            <span className="mt-1 block text-[10px] font-normal">{item.description}</span>
          </button>)}
        </div>
      </div>

      {emailPurposes.map(item => <div
        key={item.purpose}
        id={`event-email-${item.purpose}`}
        role="tabpanel"
        hidden={activePurpose !== item.purpose}
        className="mt-5"
      >
        <EventEmailEditor eventId={event.id} purpose={item.purpose} />
      </div>)}

      <p className="mt-4 text-[11px] text-foreground-500">Saving here changes only this event. Reusable templates remain available to other events without changing their saved copy.</p>
    </section>
  </div>;
}
