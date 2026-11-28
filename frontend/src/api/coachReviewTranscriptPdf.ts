import { coachFetch } from '@/lib/coachFetch';

export async function loadCoachReviewTranscriptPdf(eventKey: string, artifactId: string, signal: AbortSignal): Promise<Blob> {
  const response = await coachFetch(
    `/coach_api/coach/timetable/events/${encodeURIComponent(eventKey)}/transcript-pdf/${encodeURIComponent(artifactId)}`,
    { signal },
  );
  if (!response.ok) {
    const error = await response.json().catch(() => ({})) as { detail?: string };
    throw new Error(error.detail || `Transcript PDF could not be loaded (${response.status}).`);
  }
  if (!response.headers.get('content-type')?.toLowerCase().startsWith('application/pdf')) {
    throw new Error('The server did not return a transcript PDF.');
  }
  return response.blob();
}

export async function loadPreviousReviewTranscriptPdf(instanceId: string, signal: AbortSignal): Promise<Blob> {
  const response = await coachFetch(
    `/coach_api/coach/reviews/${encodeURIComponent(instanceId)}/previous/transcript-pdf`,
    { signal },
  );
  if (!response.ok) {
    const error = await response.json().catch(() => ({})) as { detail?: string };
    throw new Error(error.detail || `Previous session PDF could not be loaded (${response.status}).`);
  }
  if (!response.headers.get('content-type')?.toLowerCase().startsWith('application/pdf')) {
    throw new Error('The server did not return a transcript PDF.');
  }
  return response.blob();
}
