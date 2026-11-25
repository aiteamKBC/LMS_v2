/* global document, location */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import '../src/components/feature/WorkspaceColourTheme.css';
import '../src/index.css';
import '../src/learner-theme.css';
import '../src/coach-theme.css';
import '../src/components/feature/WorkspaceSidebarTheme.css';
import '../src/components/feature/WorkspaceChromeTheme.css';
import '../src/components/feature/WorkspaceEnrolmentTheme.css';
import '../src/pages/employer/employer-palette.css';
import { WorkspaceHeroBanner } from '../src/components/feature/WorkspaceHeroBanner';
import { MetricCard } from '../src/components/ui/MetricCard';

// Real shared components/CSS with synthetic values and no API hooks.
const role = new URLSearchParams(location.search).get('role') || 'admin';
createRoot(document.getElementById('root')!).render(<MemoryRouter>
  <div className="workspace-shell dashboard-theme" data-workspace-role={role}>
    <div className="workspace-content" style={{ margin: 0, width: '100%' }}>
      <header className="kbc-workspace-topbar">
        <div><strong className="kbc-topbar-title">Learning workspace</strong><small className="kbc-topbar-subtitle"> · Example {role}</small></div>
      </header>
      <main className="workspace-main" style={{ padding: 20, display: 'grid', gap: 20 }}>
        <WorkspaceHeroBanner title="A little progress, every day" description="Your learning, people and next steps in one place."
          icon="ri-book-open-line" eyebrow="Your workspace"
          stats={[{ label: 'Learners', value: 24 }, { label: 'Programmes', value: 6 }]} />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-neutral-metrics>
          {['Learners', 'Programmes', 'Learning hours', 'Resources'].map((label, i) => <MetricCard key={label} label={label} value={24 + i} icon="ri-book-open-line" />)}
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <MetricCard label="On track" value={18} tone="positive" icon="ri-check-line" />
          <MetricCard label="Due soon" value={4} tone="caution" icon="ri-time-line" />
          <MetricCard label="Needs attention" value={2} tone="critical" icon="ri-error-warning-line" />
        </div>
        <section className="ui-panel p-5">
          <h2 className="text-lg text-foreground-900">Your next step</h2>
          <p className="text-sm text-foreground-500 my-3">Choose a programme to continue your learning.</p>
          <label className="text-sm text-foreground-700">Programme <input className="border p-2 mx-2" defaultValue="Professional development" /></label>
          <button className="primary-action rounded-xl px-4 py-2">Continue learning</button>
        </section>
      </main>
    </div>
  </div>
</MemoryRouter>);
