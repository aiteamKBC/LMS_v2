// Local design-review harness only. No AuthProvider, backend or live curriculum data.
import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { AuthContext, type RbacContextValue } from '../src/hooks/useAuth.helpers';
import { ThemeProvider } from '../src/hooks/useTheme';
import { WorkspaceShell } from '../src/components/feature/WorkspaceShell';
import { curriculumNavItems } from '../src/mocks/navigation';
import DeliveryWorkspace from '../src/pages/curriculum/hubs/DeliveryWorkspace';
import '../src/index.css';
import '../src/learner-theme.css';

const destinations = [
  { title: 'Cohorts', description: 'Set delivery windows and the groups running inside them.', href: '/curriculum/cohorts', icon: 'ri-group-line', count: 29, unit: 'cohorts' },
  { title: 'Groups', description: 'Assign coaches, delivery days and group schedules.', href: '/curriculum/groups', icon: 'ri-team-line', count: 118, unit: 'groups' },
  { title: 'Module Builder', description: 'Build reusable module content with weeks and components.', href: '/curriculum/module-builder', icon: 'ri-layout-4-line', count: 107, unit: 'modules' },
  { title: 'Teams Meetings', description: 'Review and restore the meetings attached to live sessions.', href: '/curriculum/teams-meetings', icon: 'ri-vidicon-line' },
  { title: 'Bank Holidays', description: 'One non-delivery calendar: GOV.UK bank holidays stay synced here, and workshops or closures can be added with start and end dates.', href: '/curriculum/england-holidays', icon: 'ri-flag-line' },
  { title: 'Session Calendar', description: 'See every curriculum session in one chronological view.', href: '/curriculum/session-calendar', icon: 'ri-calendar-schedule-line', count: 0, unit: 'sessions' },
];
const description = 'Set up cohorts and groups, assign staff and keep every scheduled session visible from one place.';
type DisplayState = 'Normal' | 'Loading' | 'Empty' | 'Error';

function PreviewDestination() {
  const location = useLocation();
  const destination = destinations.find(item => item.href === location.pathname);
  return <section style={{ padding: 32, background: '#fff' }}>
    <h1>{destination?.title ?? 'Workspace navigation preview'}</h1>
    <p>This local preview confirms the navigation target. No destination workflow or backend is running.</p>
    <p><code>{location.pathname}</code></p>
    <Link to="/curriculum/delivery">Return to Delivery</Link>
  </section>;
}

function Fixture() {
  const [display, setDisplay] = useState<DisplayState>('Normal');
  const [hero, setHero] = useState<'glass' | 'classic'>(() => new URLSearchParams(window.location.search).get('hero') === 'classic' ? 'classic' : 'glass');
  const [notice, setNotice] = useState('');
  const empty = display === 'Empty';
  const sessions = empty ? [] : [
    '2026-11-09', '2026-11-10', '2026-11-10', '2026-11-12', '2026-11-13', '2026-11-13', '2026-11-13',
    '2026-11-16', '2026-11-18', '2026-11-18', '2026-11-19', '2026-11-20',
  ].map((date, index) => ({ id: `demo-session-${index}`, type: 'Live Session', date, startTime: '11:00', title: 'Example live teaching', status: 'scheduled' }));
  const auth = useMemo<RbacContextValue>(() => ({
    auth: {
      user: null, tenant: null, roles: [], isAuthenticated: true,
      account: { id: -1, email: 'preview@example.invalid', displayName: 'Design preview', role: 'staff', subjectType: 'staff', subjectId: -1,
        hasPassword: true, lastLoginAt: null, permissions: [], position: 'Curriculum team', access: 'curriculum',
        accesses: ['curriculum', 'tutor'], accessHome: '/workspace/curriculum', accessNavRole: 'curriculum',
        accessWorkspaces: [{ access: 'curriculum', home: '/workspace/curriculum' }, { access: 'tutor', home: '/workspace/tutor' }] },
    },
    isAdmin: false, isInitialized: true, initializationError: null,
    login: async () => { throw new Error('Sign-in is disabled in this isolated design preview.'); },
    logout: () => setNotice('Sign out is disabled in this local design preview.'),
    retryInitialization: () => {}, previewAs: () => {}, switchTenant: () => {}, switchRole: () => {},
    hasPermission: () => true, canAccessRoute: () => true, canSeeNavItem: () => true,
    getPermissionLevel: () => 'full_admin', getPermissionScope: () => 'global',
  }), []);
  return <AuthContext.Provider value={auth}><ThemeProvider><MemoryRouter initialEntries={['/curriculum/delivery']}>
    <WorkspaceShell role="curriculum" roleLabel="Curriculum Designer" navItems={curriculumNavItems}
      workspaceLabel="Curriculum Studio" pageTitle="Delivery" pageSubtitle={description} userName="Design preview" userRole="Curriculum Designer">
      <Routes>
        <Route path="/curriculum/delivery" element={<DeliveryWorkspace description={description}
          heroVariant={hero} now={new Date('2026-11-13T10:00:00Z')}
          staffing={{ needsTutor: display === 'Error' ? null : empty ? 0 : 3, needsCoach: display === 'Error' ? null : empty ? 0 : 12, loading: display === 'Loading' }}
          cohorts={empty ? [] : Array.from({ length: 29 }, (_, index) => ({ status: index < 13 ? 'active' : index < 24 ? 'planned' : 'completed' }))}
          activeCohortGroups={empty ? 0 : 56} activeGroups={empty ? 0 : 82} totalGroups={empty ? 0 : 118}
          activeModules={empty ? 0 : 30} totalModules={empty ? 0 : 107} modulesLoading={display === 'Loading'} modulesError={null}
          sessions={display === 'Error' ? [] : sessions} sessionsLoading={display === 'Loading'} sessionsError={display === 'Error' ? 'Example temporary read failure' : null}
          cards={destinations.map(item => ({ ...item, meta: item.count === undefined ? undefined : `${empty ? 0 : item.unit === 'sessions' ? sessions.length : item.count} ${item.unit}` }))}
          attentionItems={[
            { label: 'Groups without a coach', value: empty ? 0 : 79, href: '/curriculum/groups', icon: 'ri-user-search-line' },
            { label: 'Modules without a tutor', value: empty ? 0 : 3, href: '/curriculum/module-builder', icon: 'ri-user-settings-line' },
            { label: 'Planned or inactive cohorts', value: empty ? 0 : 16, href: '/curriculum/cohorts', icon: 'ri-calendar-todo-line' },
          ]}
          loading={display === 'Loading'} unavailable={display === 'Error'} error={display === 'Error' ? 'Example temporary read failure' : null}
        />} />
        <Route path="*" element={<PreviewDestination />} />
      </Routes>
    </WorkspaceShell>
    {!new URLSearchParams(window.location.search).has('clean') && <aside aria-label="Local preview controls" style={{ position: 'fixed', zIndex: 300, right: 12, bottom: 12, maxWidth: 'calc(100vw - 24px)', padding: '9px 12px', border: '1px solid #d6c5e7', borderRadius: 10, background: '#fff', boxShadow: '0 4px 16px #21103820', fontFamily: 'sans-serif', fontSize: 11 }}>
      <p style={{ margin: '0 0 6px' }}>Local design preview · synthetic data · no backend</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
        {(['Normal', 'Loading', 'Empty', 'Error'] as DisplayState[]).map(value => <button type="button" key={value}
          aria-pressed={display === value} onClick={() => setDisplay(value)} style={{ padding: '5px 8px', borderRadius: 5, border: '1px solid #cdb9e1', background: display === value ? '#643597' : '#fff', color: display === value ? '#fff' : '#4d2a70' }}>{value}</button>)}
      </div>
      <div style={{ display: 'flex', gap: 5, marginTop: 6 }}>{(['glass', 'classic'] as const).map(value => <button key={value} type="button" onClick={() => setHero(value)} aria-pressed={hero === value} style={{ border: '1px solid #d6c5e7', borderRadius: 5, padding: '4px 6px', background: hero === value ? '#f0e7fa' : '#fff' }}>{value === 'glass' ? 'Light banner' : 'Previous title'}</button>)}</div>
      {notice && <p role="status">{notice}</p>}
    </aside>}
  </MemoryRouter></ThemeProvider></AuthContext.Provider>;
}

createRoot(document.getElementById('root')!).render(<Fixture />);
