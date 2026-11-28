import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import '../src/index.css';
import '../src/learner-theme.css';
import { LearnerCalendarContent } from '../src/pages/learner/calendar/page';

// Only loaded by check-review-calendar.mjs, never by the application router.
createRoot(document.getElementById('root')!).render(
  <MemoryRouter initialEntries={['/learner/calendar?date=2026-09-14']}>
    <LearnerCalendarContent />
  </MemoryRouter>,
);
