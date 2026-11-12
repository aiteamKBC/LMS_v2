import type { CompanyTraining } from './breatheIntegration';
import type { EmployerDashboardMetrics, EmployerLearnerCard, EmployerPortal } from '@/api/employerPortal';

export type B2BPortalRole = 'manager' | 'hr';

export interface B2BEmployee extends EmployerLearnerCard {
  demoTraining?: boolean;
  progress: number;
  hoursPercent: number;
  risk: 'on-track' | 'need-attention' | 'at-risk' | 'unavailable';
  lastActivityAt: string | null;
}

export interface B2BCompanySummary {
  id: string;
  name: string;
  employees: number;
  activeEmployees: number;
  averageProgress: number;
  employeesNeedingAttention: number;
  outstandingActions: number;
}

export interface B2BProgressSummary {
  averageProgress: number;
  employeeCount: number;
  startedCount: number;
  notStartedCount: number;
}

export interface B2BPortalData {
  portal: EmployerPortal;
  employees: B2BEmployee[];
  company: B2BCompanySummary;
  progress: B2BProgressSummary;
  asOf: string | null;
}

function percent(value: number | null | undefined): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(100, Number(value))) : 0;
}

/**
 * Build the company-scoped view from the existing employer portal contracts.
 * Missing learner progress is deliberately counted as 0%, matching the B2B
 * rule agreed for employees who have not started a subject.
 */
export function buildB2BPortalData(portal: EmployerPortal, metrics?: EmployerDashboardMetrics | null): B2BPortalData {
  const metricRows = metrics?.learners || {};
  const employees = portal.learners.map((learner) => {
    const row = metricRows[String(learner.id)] || metricRows[learner.id];
    return {
      ...learner,
      progress: percent(row?.programme?.percent),
      hoursPercent: percent(row?.otjh?.percent),
      risk: row?.risk || 'unavailable',
      lastActivityAt: null,
    };
  });

  const activeEmployees = employees.filter(employee => employee.isActive).length;
  const employeesNeedingAttention = employees.filter(employee => employee.risk === 'need-attention' || employee.risk === 'at-risk').length;
  const averageProgress = employees.length
    ? Math.round(employees.reduce((sum, employee) => sum + employee.progress, 0) / employees.length)
    : 0;
  const startedCount = employees.filter(employee => employee.progress > 0).length;

  return {
    portal,
    employees,
    company: {
      id: portal.employer.id,
      name: portal.employer.name,
      employees: employees.length,
      activeEmployees,
      averageProgress,
      employeesNeedingAttention,
      outstandingActions: portal.outstandingTotal,
    },
    progress: {
      averageProgress,
      employeeCount: employees.length,
      startedCount,
      notStartedCount: employees.length - startedCount,
    },
    asOf: metrics?.asOf || null,
  };
}

/** Synthetic records stay labelled and do not impersonate learner profiles. */
export function withCompanyDemoTraining(data: B2BPortalData, training: CompanyTraining): B2BPortalData {
  const demo = training.employees.filter(p => p.allocations.length).map(p => {
    const total = p.allocations.reduce((sum, a) => sum + (training.modules.find(m => m.id === a.moduleId)?.plannedHours ?? 0), 0);
    const progress = total ? Math.round(p.allocations.reduce((sum, a) => sum + (a.metrics.progress ?? 0) * (training.modules.find(m => m.id === a.moduleId)?.plannedHours ?? 0), 0) / total) : 0;
    return { id: p.id, kind: 'commercial' as const, name: p.name, email: '', programme: 'Associate Project Manager ? Demo', cohort: p.department, programmeStatus: 'Demo', onboardingStatus: 'Demo', isActive: true, outstandingCount: 0, documentsTotal: 0, otjhProgress: null, progress, hoursPercent: total ? Math.round(p.allocations.reduce((sum, a) => sum + (a.metrics.hours ?? 0), 0) / total * 100) : 0, risk: 'unavailable' as const, lastActivityAt: p.allocations.map(a => a.metrics.lastActivity).filter(Boolean).sort().at(-1) ?? null, demoTraining: true };
  });
  const employees = [...data.employees, ...demo];
  const average = employees.length ? Math.round(employees.reduce((sum, e) => sum + e.progress, 0) / employees.length) : 0;
  return { ...data, employees, company: { ...data.company, employees: employees.length, activeEmployees: employees.filter(e => e.isActive).length, averageProgress: average }, progress: { averageProgress: average, employeeCount: employees.length, startedCount: employees.filter(e => e.progress > 0).length, notStartedCount: employees.filter(e => e.progress === 0).length } };
}
