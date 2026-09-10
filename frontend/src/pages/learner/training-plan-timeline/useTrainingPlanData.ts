import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchLearnerDetail, invalidateLearnerDetailCache, type LearnerDetail, type LearnerKind } from '@/api/learnerDetail';
import { fetchStudentActivity, type StudentActivityResponse } from '@/api/studentActivity';
import { fetchTrainingPlanDashboard, fetchTrainingPlanContract, type TrainingPlanDashboard, type TrainingPlanContract } from '@/api/trainingPlanDashboard';
import { fetchSubjectMetadata, type CoverMetadata } from '../my-learning/SubjectWorkspace';

type Snapshot = { real: LearnerDetail; activity: StudentActivityResponse | null; metadata: CoverMetadata; data: TrainingPlanDashboard };
type State = { identity: string; snapshot: Snapshot | null; loading: boolean; error: string };

export function useTrainingPlanData(kind?: LearnerKind, id?: string) {
  const identity = `${kind}:${id}`;
  const [attempt, setAttempt] = useState(0);
  const [contractAttempt, setContractAttempt] = useState(0);
  const [state, setState] = useState<State | null>(null);
  const [contract, setContract] = useState<{ identity: string; data: TrainingPlanContract } | null>(null);
  const pending = useRef(false);
  const refresh = useCallback(() => setAttempt(value => value + 1), []);
  const retryContract = useCallback(() => setContractAttempt(value => value + 1), []);

  useEffect(() => {
    if (!kind || !id) return;
    const controller = new AbortController();
    pending.current = true;
    setState(previous => ({ identity, snapshot: previous?.identity === identity ? previous.snapshot : null, loading: true, error: '' }));
    if (attempt > 0) invalidateLearnerDetailCache(kind, id);
    // Start independent sources together. Subject metadata needs activity IDs,
    // but it never needs to wait for the calendar or the contract PDF.
    const learning = fetchLearnerDetail(kind, id).then(async real => {
      if (controller.signal.aborted) throw new Error('Cancelled');
      const activity = real.studentActivityAvailable ? await fetchStudentActivity(kind, id, controller.signal) : null;
      if (controller.signal.aborted) throw new Error('Cancelled');
      const metadata = await fetchSubjectMetadata(activity, real, id, controller.signal);
      return { real, activity, metadata };
    });
    const timer = window.setTimeout(() => {
      controller.abort(); pending.current = false;
      setState(previous => ({ identity, snapshot: previous?.identity === identity ? previous.snapshot : null, loading: false, error: 'Loading is taking longer than expected. Please try again.' }));
    }, 45_000);
    void Promise.all([fetchTrainingPlanDashboard(kind, id, controller.signal), learning])
      .then(([data, learningData]) => {
        if (!controller.signal.aborted) setState({ identity, snapshot: { ...learningData, data }, loading: false, error: '' });
      })
      .catch(error => {
        if (!controller.signal.aborted) setState(previous => ({ identity, snapshot: previous?.identity === identity ? previous.snapshot : null, loading: false, error: error instanceof Error ? error.message : 'Could not load your training plan.' }));
      })
      .finally(() => { window.clearTimeout(timer); if (!controller.signal.aborted) pending.current = false; });
    return () => { controller.abort(); window.clearTimeout(timer); pending.current = false; };
  }, [kind, id, identity, attempt]);

  useEffect(() => {
    if (!kind || !id) return;
    const controller = new AbortController();
    setContract(null);
    const timer = window.setTimeout(() => {
      controller.abort();
      setContract({ identity, data: { months: {}, contractStatus: 'unavailable' } });
    }, 30_000);
    void fetchTrainingPlanContract(kind, id, controller.signal)
      .then(data => { if (!controller.signal.aborted) setContract({ identity, data }); })
      .catch(() => { if (!controller.signal.aborted) setContract({ identity, data: { months: {}, contractStatus: 'unavailable' } }); })
      .finally(() => window.clearTimeout(timer));
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [kind, id, identity, attempt, contractAttempt]);

  useEffect(() => {
    let lastRefresh = 0;
    const onReturn = () => {
      if (document.visibilityState !== 'visible' || pending.current || Date.now() - lastRefresh < 1000) return;
      lastRefresh = Date.now(); refresh();
    };
    window.addEventListener('focus', onReturn);
    document.addEventListener('visibilitychange', onReturn);
    return () => { window.removeEventListener('focus', onReturn); document.removeEventListener('visibilitychange', onReturn); };
  }, [identity, refresh]);

  const current = state?.identity === identity ? state : null;
  const snapshot = current?.snapshot;
  const contractData = contract?.identity === identity ? contract.data : { months: {}, contractStatus: 'loading' };
  return { snapshot: snapshot ? { ...snapshot, data: { ...snapshot.data, ...contractData } } : null,
    loading: current?.loading ?? true, error: current?.error || '', refresh, retryContract };
}
