import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { PublicEventFeedback } from '@/features/feedback/PublicEventFeedback';
import { EVENT_FEEDBACK_PUBLIC_PATH, eventFeedbackToken } from './token';

export default function EventFeedbackPage() {
  const location = useLocation();
  const [token] = useState(() => eventFeedbackToken(
    location.search, location.hash, window.history.state,
  ));

  useEffect(() => {
    // The component has captured the bearer value. Keep it out of browser
    // URLs and referrer headers, while retaining it in this history entry so
    // a browser reload or React remount does not invalidate the open form.
    window.history.replaceState(
      { ...(window.history.state || {}), eventFeedbackToken: token },
      '', EVENT_FEEDBACK_PUBLIC_PATH,
    );
  }, [token]);

  return <PublicEventFeedback token={token} />;
}
