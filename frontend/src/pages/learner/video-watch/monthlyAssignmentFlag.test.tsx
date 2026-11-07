import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import { fetchLearnerDetail, type LearnerDetail } from '@/api/learnerDetail';
import { startTimeTracking } from '@/api/timeTracking';
import { fetchEvidence } from '@/api/evidence';
import ComponentViewPage from './page';

vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: {}, getDocument: () => ({ promise: Promise.resolve({ numPages: 1 }) }) }));
(globalThis as Record<string, unknown>).AppIcon = ({ className }: { className?: string }) => <i className={className} />;

vi.mock('@/api/learnerDetail', () => ({ fetchLearnerDetail: vi.fn() }));
vi.mock('@/api/components', () => ({ submitComponentProgress: vi.fn() }));
vi.mock('@/api/timeTracking', () => ({ startTimeTracking: vi.fn() }));
vi.mock('@/api/videos', () => ({ submitVideoProgress: vi.fn() }));
vi.mock('@/api/reflectionSubmission', () => ({ loadLearningReflectionSubmission: vi.fn(), saveLearningReflectionSubmission: vi.fn() }));
vi.mock('@/api/evidence', () => ({ fetchEvidence: vi.fn(), uploadEvidence: vi.fn(), getEvidenceDownloadUrl: vi.fn(), deleteEvidence: vi.fn() }));
vi.mock('@/hooks/useMyLearner', () => ({ rememberLearner: vi.fn() }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ auth: { account: { role: 'learner', subjectType: 'learner', subjectId: 1 } }, isInitialized: true }) }));
vi.mock('@/hooks/useComponentAccessWindow', () => ({ useComponentAccessWindow: () => ({ open: true, outsideWorkingHours: false, holidays: [], holidayCalendarReady: true, currentTimeLabel: '' }) }));
vi.mock('@/components/feature/WorkspaceShell', () => ({ WorkspaceShell: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock('./AssignmentSubmissionWizard', () => ({ AssignmentSubmissionWizard: ({ title }: { title: string }) => <div data-testid="monthly-wizard">{title}</div> }));

const assignment = (id: string, title: string, monthlyAssignment?: boolean) => ({
  componentId: id, component: `Assignment · ${title}`, type: 'assignment', module: 'Marketing', moduleId: 'M1',
  week: 'Week 1', weekId: 'W1', expectedOtjh: 2, reflectionRequired: false, monthlyAssignment,
  assignmentBrief: `${title} question`,
  assignmentTopics: [{ id: '1', name: '', question: `${title} question`, instructions: `${title} instructions`, resources: [] }],
});
const plan = (...components: ReturnType<typeof assignment>[]) => ({
  modules: ['Marketing'], week: [{ module: 'Marketing', moduleId: 'M1', week: 'Week 1', weekId: 'W1' }],
  components, quizAttempts: [], videoProgress: [], componentProgress: [], ksbs: [],
}) as unknown as LearnerDetail;
const mount = (id: string) => render(<MemoryRouter initialEntries={[`/learner/component/apprenticeship/1/${id}`]}>
  <Routes><Route path="/learner/component/:kind/:id/:componentId" element={<ComponentViewPage />} /></Routes>
</MemoryRouter>);

beforeEach(() => {
  localStorage.clear();
  vi.mocked(startTimeTracking).mockResolvedValue({ sessionId: 'S1', trackingToken: 'token', startedAt: new Date().toISOString(), countingMode: 'visible_page' });
  vi.mocked(fetchEvidence).mockResolvedValue([]);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('opens the monthly submission for an unflagged assignment even when another is flagged', async () => {
  vi.mocked(fetchLearnerDetail).mockResolvedValue(plan(assignment('SLIDES', 'Lecture slide task'), assignment('MONTHLY', 'Month 1 assignment', true)));
  mount('SLIDES');
  expect(await screen.findByTestId('monthly-wizard')).toHaveTextContent('Lecture slide task');
  expect(screen.queryByRole('button', { name: 'Finish' })).toBeNull();
});

it('keeps the eight-step submission for the flagged monthly assignment', async () => {
  vi.mocked(fetchLearnerDetail).mockResolvedValue(plan(assignment('SLIDES', 'Lecture slide task'), assignment('MONTHLY', 'Month 1 assignment', true)));
  mount('MONTHLY');
  expect(await screen.findByTestId('monthly-wizard')).toHaveTextContent('Month 1 assignment');
  expect(screen.queryByRole('region', { name: 'Assignment brief' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Finish' })).toBeNull();
});

it('keeps the eight-step submission for every assignment while none is flagged', async () => {
  vi.mocked(fetchLearnerDetail).mockResolvedValue(plan(assignment('SLIDES', 'Lecture slide task'), assignment('OTHER', 'Another assignment', false)));
  mount('SLIDES');
  expect(await screen.findByTestId('monthly-wizard')).toHaveTextContent('Lecture slide task');
  expect(screen.queryByRole('region', { name: 'Assignment brief' })).toBeNull();
});
