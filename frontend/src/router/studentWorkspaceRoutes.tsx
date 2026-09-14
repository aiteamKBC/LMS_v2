import type { RouteObject } from 'react-router-dom';
import { lazyRoute } from './lazyRoute';

const StudentHome = lazyRoute(() => import('../pages/learner/home/page'));
const LearnerDashboard = lazyRoute(() => import('../pages/workspace/learner/page'));

// The workspace entry is the landing page. The full console is an explicit
// destination reached through its Dashboard action, including staff previews.
export const studentWorkspaceRoutes: RouteObject[] = [
  { path: '/workspace/learner', element: <StudentHome /> },
  { path: '/learner/home', element: <StudentHome /> },
  { path: '/workspace/learner/:kind/:id', element: <StudentHome /> },
  { path: '/workspace/learner/dashboard', element: <LearnerDashboard /> },
  { path: '/workspace/learner/:kind/:id/dashboard', element: <LearnerDashboard /> },
];
