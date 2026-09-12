import type { LearnerKind } from './learnerDetail';
import { coachFetch } from '@/lib/coachFetch';
import { createCachedResource } from './cachedRequest';
import { LEARNER_READ_TIMEOUT_MS, withCallerSignal } from './learnerRead';

export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const path = (kind: LearnerKind, id: string) => `/learner_api/profile-photo/${kind}/${encodeURIComponent(id)}/`;

async function photoResponse(response: Response): Promise<Blob | null> {
  if (response.status === 204) return null;
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error || 'Your photo could not be saved or loaded. Please try again.');
  }
  if (!response.headers.get('Content-Type')?.startsWith('image/jpeg')) {
    throw new Error('The server returned an invalid photo. Please try again.');
  }
  return response.blob();
}

const photos = createCachedResource<Blob | null>('learner-photo', async url => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LEARNER_READ_TIMEOUT_MS);
  try {
    return await photoResponse(await fetch(url, { credentials: 'include', cache: 'no-store', signal: controller.signal }));
  } finally { clearTimeout(timer); }
});

export function readLearnerPhoto(kind: LearnerKind, id: string, signal: AbortSignal) {
  return withCallerSignal(photos.read(path(kind, id)), signal);
}

export async function uploadLearnerPhoto(kind: LearnerKind, id: string, file: File, signal: AbortSignal) {
  const form = new FormData();
  form.append('photo', file);
  // Reuse the session + Django CSRF transport; learner URLs are not rewritten.
  const photo = await photoResponse(await coachFetch(path(kind, id), { method: 'POST', body: form, signal }));
  if (!photo) throw new Error('The photo was not saved. Please try again.');
  photos.prime(path(kind, id), photo);
  return photo;
}
