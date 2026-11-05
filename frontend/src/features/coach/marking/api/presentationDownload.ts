import { coachFetch } from '@/lib/coachFetch';
import { markingEndpoint } from './markingApi';
import type { MarkingScope } from '../types/marking.types';

const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const PPT = 'application/vnd.ms-powerpoint';

function downloadName(disposition: string | null, extension: string) {
  const encoded = disposition?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const plain = disposition?.match(/filename="((?:[^"\\]|\\.)*)"/i)?.[1]?.replace(/\\(["\\])/g, '$1');
  let name = plain || `presentation.${extension}`;
  if (encoded) {
    try { name = decodeURIComponent(encoded); } catch { throw new Error('The presentation download returned an invalid filename. Please retry.'); }
  }
  name = Array.from(name.replace(/[\\/<>:"|?*]/g, '_'))
    .filter(character => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127).slice(0, 200).join('');
  return name.toLowerCase().endsWith(`.${extension}`) ? name : `presentation.${extension}`;
}

export async function downloadSavedPresentation({ scope, submissionId, submittedAt, version, signal }: {
  scope: MarkingScope; submissionId: string; submittedAt?: string | null; version?: number; signal?: AbortSignal;
}) {
  const query = new URLSearchParams();
  if (submittedAt) query.set('submittedAt', submittedAt);
  if (scope === 'personal' && version !== undefined) query.set('version', String(version));
  const response = await coachFetch(`${markingEndpoint(scope)}/${encodeURIComponent(submissionId)}/presentation${query.size ? `?${query}` : ''}`, {
    signal, headers: { Accept: `${PPTX}, ${PPT}, application/json` },
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({})) as { detail?: string; error?: string };
    throw new Error(data.detail || data.error || 'The saved presentation could not be downloaded. Please retry.');
  }
  const type = response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase();
  if (type !== PPTX && type !== PPT) throw new Error('The server did not return a PowerPoint file. Please reload and retry.');
  const blob = await response.blob();
  if (!blob.size) throw new Error('The saved presentation file is empty. Please retry or contact support.');
  return { blob, filename: downloadName(response.headers.get('Content-Disposition'), type === PPT ? 'ppt' : 'pptx') };
}
