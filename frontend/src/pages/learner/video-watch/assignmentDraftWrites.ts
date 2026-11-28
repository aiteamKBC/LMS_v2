import { saveLearningReflectionSubmission, type LearningReflectionSubmissionInput } from '@/api/reflectionSubmission';

// Navigation can close and reopen the same form before its final save finishes.
// Keep those writes ordered across form instances, separately for each topic.
const pending = new Map<string, Promise<unknown>>();

export function saveAssignmentDraft(key: string, snapshot: LearningReflectionSubmissionInput) {
  const previous = pending.get(key) || Promise.resolve();
  const request = previous.catch(() => undefined).then(() => saveLearningReflectionSubmission(snapshot));
  pending.set(key, request);
  const release = () => { if (pending.get(key) === request) pending.delete(key); };
  void request.then(release, release);
  return request;
}

export async function waitForAssignmentDraft(key: string) {
  // A failed write leaves the local recovery copy available; still allow loading.
  await pending.get(key)?.catch(() => undefined);
}
