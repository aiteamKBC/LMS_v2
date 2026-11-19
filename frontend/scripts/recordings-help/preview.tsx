import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/hooks/useAuth';
import { ThemeProvider } from '@/hooks/useTheme';
import Hub from '@/pages/curriculum/recordings/RecordingsHub';
import Tutor from '@/pages/curriculum/recordings/page';
import Coach from '@/pages/coaching-recordings/page';
import '@/index.css';
import '@/learner-theme.css';
import '@/coach-theme.css';

// These are the production pages. The recorder intercepts every API request and
// blocks external traffic; this entry point never connects to a real backend.
function Preview() {
  const { isInitialized } = useAuth();
  if (!isInitialized) return <p>Preparing demonstration...</p>;
  return <Routes>
    <Route path="/curriculum/recordings-hub" element={<Hub />} />
    <Route path="/curriculum/recordings" element={<Tutor />} />
    <Route path="/curriculum/coaching-recordings" element={<Coach />} />
  </Routes>;
}
createRoot(document.getElementById('root')!).render(
  <ThemeProvider><BrowserRouter><AuthProvider><Preview /></AuthProvider></BrowserRouter></ThemeProvider>,
);
