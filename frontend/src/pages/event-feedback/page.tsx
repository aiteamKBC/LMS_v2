import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { PublicEventFeedback } from '@/features/feedback/PublicEventFeedback';
import { EVENT_FEEDBACK_PUBLIC_PATH, eventFeedbackToken } from './token';

export default function EventFeedbackPage() {
  const location = useLocation();
  const [token] = useState(() => eventFeedbackToken(location.search, location.hash));

  useEffect(() => {
    // The component has captured the bearer value. Keep it out of browser
    // history before the attendee follows any other link.
    window.history.replaceState(window.history.state, '', EVENT_FEEDBACK_PUBLIC_PATH);
  }, []);

  return <PublicEventFeedback token={token} />;
}
