import { learningFetch } from '@/lib/personalLearning';
import type { TeachingLectureScope } from './teachingQuality';

export async function loadLectureTranscriptPdf(scope: TeachingLectureScope, signal: AbortSignal): Promise<Blob> {
  signal.throwIfAborted();
  const response = await learningFetch(`/curriculum_api/curriculum/session-recordings/transcript.pdf?${new URLSearchParams({ ...scope })}`,
    { credentials: 'include', cache: 'no-store', signal: AbortSignal.any([signal, AbortSignal.timeout(60000)]) });
  if (!response.ok || !response.headers.get('Content-Type')?.toLowerCase().startsWith('application/pdf')) {
    let message = 'The lecture transcript could not be loaded. Please retry.';
    if (response.headers.get('Content-Type')?.includes('application/json')) {
      const value: unknown = await response.json();
      if (value && typeof value === 'object' && 'error' in value && typeof value.error === 'string') message = value.error;
    }
    throw new Error(message);
  }
  const blob = await response.blob();
  if (blob.size > 20 * 1024 * 1024 || await blob.slice(0, 5).text() !== '%PDF-') {
    throw new Error('The service did not return a valid transcript PDF. Please retry.');
  }
  return blob;
}
