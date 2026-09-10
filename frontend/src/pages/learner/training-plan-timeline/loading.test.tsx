import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import type { LearnerDetail } from '@/api/learnerDetail';
import type { TrainingPlanDashboard, TrainingPlanContract } from '@/api/trainingPlanDashboard';
import TrainingPlanTimelinePage from './page';
import { useTrainingPlanData } from './useTrainingPlanData';

const mocks = vi.hoisted(() => ({ plan: vi.fn(), contract: vi.fn(), activity: vi.fn(), detail: vi.fn(), metadata: vi.fn(), invalidate: vi.fn() }));
vi.mock('@/components/feature/WorkspaceShell', () => ({ WorkspaceShell: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/api/learnerDetail', () => ({ fetchLearnerDetail: mocks.detail, invalidateLearnerDetailCache: mocks.invalidate }));
vi.mock('@/api/trainingPlanDashboard', () => ({ fetchTrainingPlanDashboard: mocks.plan, fetchTrainingPlanContract: mocks.contract }));
vi.mock('@/api/studentActivity', async original => ({ ...await original<typeof import('@/api/studentActivity')>(), fetchStudentActivity: mocks.activity }));
vi.mock('../my-learning/SubjectWorkspace', async original => ({ ...await original<typeof import('../my-learning/SubjectWorkspace')>(), fetchSubjectMetadata: mocks.metadata }));

function data(): TrainingPlanDashboard { return { months: {}, actual: [], actualAvailable: false, modules: [], moduleLinks: {}, sessions: [], reviews: [], coach: { name: '', bookingUrl: null }, contractStatus: 'loading', generatedAt: '' }; }
function detail(id = '1') { return { name: `Learner ${id}`, programme: 'Programme', modules: [], components: [], studentActivityAvailable: true } as unknown as LearnerDetail; }
function renderPage() { return render(<MemoryRouter initialEntries={['/plan/commercial/1']}><Link to="/plan/commercial/2">Switch learner</Link><Routes><Route path="/plan/:kind/:id" element={<TrainingPlanTimelinePage />} /></Routes></MemoryRouter>); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
beforeEach(() => {
  Object.values(mocks).forEach(mock => mock.mockReset());
  mocks.plan.mockResolvedValue(data()); mocks.contract.mockResolvedValue({ months: {}, contractStatus: 'not-available' });
  mocks.detail.mockImplementation((_kind, id) => Promise.resolve(detail(id))); mocks.activity.mockResolvedValue(null);
  mocks.metadata.mockResolvedValue({ covers: {}, current_subjects: [{ id: 'M1', title: 'Assigned subject' }] });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('Training Plan loading and refresh', () => {
  it('starts overview and contract while learner data is pending', async () => {
    const learner = deferred<LearnerDetail>(); mocks.detail.mockReturnValue(learner.promise);
    renderPage();
    expect(mocks.plan).toHaveBeenCalledOnce(); expect(mocks.contract).toHaveBeenCalledOnce(); expect(mocks.activity).not.toHaveBeenCalled();
    await act(async () => learner.resolve(detail())); await screen.findByRole('heading', { name: 'My Training Plan' });
    expect(mocks.plan).toHaveBeenCalledOnce();
  });
  it('shows modules before a slow PDF and preserves the chosen month when hours arrive', async () => {
    const pdf = deferred<TrainingPlanContract>(); mocks.contract.mockReturnValue(pdf.promise);
    renderPage(); await screen.findByRole('heading', { name: 'My Training Plan' });
    expect(screen.getByRole('link', { name: 'Assigned subject' })).toBeInTheDocument();
    expect(screen.getByText(/Loading study hour targets/)).toBeInTheDocument();
    const selected = `${new Date().getFullYear()}-04`;
    fireEvent.change(screen.getByRole('combobox', { name: 'Jump to month' }), { target: { value: selected } });
    await act(async () => pdf.resolve({ months: { [selected]: { topics: ['Contract topic'], planned: 18, source: 'contract', label: '' } }, contractStatus: 'ready' }));
    expect(screen.getByRole('combobox', { name: 'Jump to month' })).toHaveValue(selected);
    expect(screen.getAllByText('Contract topic').length).toBeGreaterThan(0); expect(screen.queryByText(/Loading study hour targets/)).not.toBeInTheDocument();
  });
  it('loads subject metadata before the overview finishes', async () => {
    const plan = deferred<TrainingPlanDashboard>(); mocks.plan.mockReturnValue(plan.promise);
    renderPage(); await waitFor(() => expect(mocks.metadata).toHaveBeenCalledOnce());
    expect(screen.queryByRole('heading', { name: 'My Training Plan' })).not.toBeInTheDocument();
    await act(async () => plan.resolve(data())); await screen.findByRole('heading', { name: 'My Training Plan' });
  });
  it('refreshes every source once and keeps the plan visible', async () => {
    renderPage(); await screen.findByRole('heading', { name: 'My Training Plan' });
    const plan = deferred<TrainingPlanDashboard>(); mocks.plan.mockReturnValue(plan.promise);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh training plan' }));
    expect(screen.getByRole('heading', { name: 'My Training Plan' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh training plan' })).toBeDisabled(); fireEvent.focus(window);
    await act(async () => plan.resolve({ ...data(), coach: { name: 'Updated coach', bookingUrl: 'https://example.com/new' } }));
    await waitFor(() => expect(screen.getByRole('link', { name: 'Support session' })).toHaveAttribute('href', 'https://example.com/new'));
    for (const request of [mocks.plan, mocks.detail, mocks.activity, mocks.metadata, mocks.contract]) expect(request).toHaveBeenCalledTimes(2);
    expect(mocks.invalidate).toHaveBeenCalledExactlyOnceWith('commercial', '1');
  });
  it('aborts old learner requests and ignores their late overview and PDF', async () => {
    const first = deferred<TrainingPlanDashboard>(), pdf = deferred<TrainingPlanContract>();
    mocks.plan.mockImplementation((_kind, id) => id === '1' ? first.promise : Promise.resolve({ ...data(), coach: { name: 'Second coach', bookingUrl: 'https://example.com/second' } }));
    mocks.contract.mockImplementation((_kind, id) => id === '1' ? pdf.promise : Promise.resolve({ months: {}, contractStatus: 'ready' }));
    renderPage(); const signal = mocks.plan.mock.calls[0][2] as AbortSignal, contractSignal = mocks.contract.mock.calls[0][2] as AbortSignal;
    fireEvent.click(screen.getByRole('link', { name: 'Switch learner' })); await screen.findByRole('heading', { name: 'My Training Plan' });
    expect(signal.aborted).toBe(true); expect(contractSignal.aborted).toBe(true);
    await act(async () => { first.resolve(data()); pdf.resolve({ months: { '2026-01': { topics: ['Wrong learner topic'], planned: 99, source: 'contract', label: '' } }, contractStatus: 'ready' }); });
    expect(screen.getByRole('link', { name: 'Support session' })).toHaveAttribute('href', 'https://example.com/second'); expect(screen.queryByText('Wrong learner topic')).not.toBeInTheDocument();
  });
  it('retries PDF failure without reloading learner progress', async () => {
    mocks.contract.mockRejectedValueOnce(new Error('Storage unavailable'));
    renderPage(); await screen.findByRole('heading', { name: 'My Training Plan' });
    fireEvent.click(screen.getByRole('button', { name: 'Retry study hours' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Retry study hours' })).not.toBeInTheDocument());
    expect(mocks.contract).toHaveBeenCalledTimes(2); expect(mocks.plan).toHaveBeenCalledOnce(); expect(mocks.detail).toHaveBeenCalledOnce();
  });
  it('ends a stuck load with a working retry', async () => {
    vi.useFakeTimers(); mocks.plan.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useTrainingPlanData('commercial', '1'));
    await act(async () => vi.advanceTimersByTimeAsync(45_000));
    expect(result.current.loading).toBe(false); expect(result.current.error).toContain('longer than expected'); expect(mocks.plan.mock.calls[0][2].aborted).toBe(true);
    mocks.plan.mockResolvedValue(data()); await act(async () => result.current.refresh());
    expect(result.current.error).toBe(''); expect(result.current.snapshot).not.toBeNull();
  });
  it('skips historical activity requests for native learners', async () => {
    mocks.detail.mockResolvedValue({ ...detail(), studentActivityAvailable: false });
    renderPage(); await screen.findByRole('heading', { name: 'My Training Plan' }); expect(mocks.activity).not.toHaveBeenCalled(); expect(mocks.metadata).toHaveBeenCalledOnce();
  });
});
