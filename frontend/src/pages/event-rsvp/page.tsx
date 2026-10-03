import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { PublicEventRsvp } from '@/features/feedback/PublicEventRsvp';

const PUBLIC_PATH = '/event-rsvp';

export default function EventRsvpPage() {
  const location = useLocation();
  const [token] = useState(() => {
    const fragment = new URLSearchParams(location.hash.replace(/^#/, ''));
    const query = new URLSearchParams(location.search);
    const stored = window.history.state?.eventRsvpToken;
    return fragment.get('token') || query.get('token') || (typeof stored === 'string' ? stored : '');
  });
  useEffect(() => {
    window.history.replaceState({ ...(window.history.state || {}), eventRsvpToken: token }, '', PUBLIC_PATH);
  }, [token]);
  return <PublicEventRsvp token={token} />;
}
