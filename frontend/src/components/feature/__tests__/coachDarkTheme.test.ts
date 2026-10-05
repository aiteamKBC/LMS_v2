import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

describe('coach dark theme contract', () => {
  it('uses the learner navy palette and remains scoped to the coach workspace', () => {
    const css = read('../../../coach-theme.css');

    expect(css).toContain(':root[data-theme="dark"]:has(.dashboard-theme[data-workspace-role="coach"])');
    expect(css).toContain('--coach-dark-page: #101e30;');
    expect(css).toContain('--coach-dark-surface: #182d48;');
    expect(css).toContain('--coach-dark-soft: #1e344d;');
    expect(css).toContain('--coach-dark-hover: #24405d;');
    expect(css).toContain('--coach-dark-active: #304766;');
    expect(css).toContain('--coach-dark-border: #3b526c;');
    expect(css).not.toContain('data-workspace-role="learner"');
  });

  it('loads the coach override after the shared and learner theme styles', () => {
    const entrypoint = read('../../../main.tsx');
    const sharedTheme = entrypoint.indexOf("import './index.css'");
    const learnerTheme = entrypoint.indexOf("import './learner-theme.css'");
    const coachTheme = entrypoint.indexOf("import './coach-theme.css'");

    expect(sharedTheme).toBeGreaterThanOrEqual(0);
    expect(learnerTheme).toBeGreaterThan(sharedTheme);
    expect(coachTheme).toBeGreaterThan(learnerTheme);
  });

  it('keeps lazy-loaded coach pages on dark surfaces with readable tables', () => {
    const modules = [
      read('../../../pages/coach/caseload/caseload.module.css'),
      read('../../../pages/coach/monthly-coaching/monthlyCoaching.module.css'),
      read('../../../pages/coach/attendance/attendanceOverview.module.css'),
      read('../../../pages/coach/attendance-profile/attendanceProfile.module.css'),
      read('../../../pages/coach/marking-queue/markingQueue.module.css'),
      read('../../../pages/coach/marking-review/markingReview.module.css'),
      read('../../../pages/coach/learner-case-file/learnerCaseFile.module.css'),
    ];

    for (const css of modules) {
      expect(css).toContain(':global(html[data-theme="dark"])');
      expect(css).toContain('var(--coach-dark-surface)');
      expect(css).toContain('var(--coach-dark-text)');
    }

    expect(modules[0]).toContain('.table tbody tr:nth-child(even) td');
    expect(modules[0]).toContain('.learner strong');
    expect(modules[1]).toContain('.controlsCard');
    expect(modules[1]).toContain('.page.page .table.table td');
    expect(modules[1]).toContain('.page.page.page .learnerEmail { color: #cbd7e5 !important; }');
    expect(modules[1]).toContain('background: var(--status-bg) !important;');
    expect(modules[1]).toContain('background: var(--status-count) !important;');
  });

  it('keeps coach monthly stats and monthly-log loading surfaces visible in dark mode', () => {
    const theme = read('../../../coach-theme.css');
    const monthlyLogs = read('../../../features/monthly-logs/monthlyLogs.module.css');
    const stats = read('../../../pages/coach/monthly-coaching/components/MonthlyStatsCard.tsx');

    expect(stats).toContain('data-coach-monthly-stats');
    expect(stats).toContain('data-status={key}');
    expect(stats).toContain('data-stat-track');
    expect(theme).toContain('[data-status="scheduled"] [data-stat-track]');
    expect(theme).toContain('[data-status="in-progress"] [data-stat-track]');
    expect(theme).toContain('[data-status="completed"] [data-stat-track]');
    expect(monthlyLogs).toContain('.coachSelectedLearner :is(.indexHeader, .yearGroup)');
    expect(monthlyLogs).toContain('background: var(--coach-dark-surface);');
    expect(monthlyLogs).toContain('.coachLoadingHero');
    expect(monthlyLogs).toContain('.coachProfileFact strong small { color: #d9e3ef; }');
  });
});
