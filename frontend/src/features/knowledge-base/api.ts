// Knowledge Base API client. Same-origin calls through the existing
// /curriculum_api proxy; the backend requires Curriculum access.
const BASE = '/curriculum_api/knowledge-base';

export type ScopeCode = 'ME' | 'MM' | 'PCP' | 'APM' | string;

export interface KbScope {
  code: ScopeCode;
  name: string;
}

export type KbProcessingStatus =
  | 'queued' | 'extracting' | 'chunking' | 'embedding' | 'verifying' | 'processing'
  | 'retrying' | 'ready' | 'needs_review' | 'failed' | string;

export interface KbBook {
  id: string;
  title: string;
  scopes: ScopeCode[];
  archived: boolean;
  createdAt: string;
  live: boolean;
  version: { id: string | null; fileName: string | null; sizeBytes: number | null; pageCount: number | null; edition: string };
  build: { id: string | null; status: string; completeness: Record<string, unknown> };
  processing: {
    status: KbProcessingStatus;
    stage: string;
    progress: Record<string, number | string>;
    attempts: number;
    lastError: string;
  };
}

export interface KbOutlineSection {
  id: number;
  parent_id: number | null;
  level: number;
  number: string;
  title: string;
  pdf_page_start: number | null;
  pdf_page_end: number | null;
  chunks: number;
  assets: number;
}

export interface KbIssue {
  id: number;
  pdf_page: number | null;
  stage: string;
  reason: string;
  retriable: boolean;
}

export interface KbBookDetail extends KbBook {
  outline: KbOutlineSection[];
  issues: KbIssue[];
}

export interface KbUploadResult {
  duplicate: boolean;
  book_id: string;
}

async function readJson<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((data as { error?: string }).error || `Request failed (${response.status})`);
  return data as T;
}

export async function fetchScopes(): Promise<KbScope[]> {
  const data = await readJson<{ scopes: KbScope[] }>(await fetch(`${BASE}/scopes/`, { credentials: 'same-origin' }));
  return data.scopes;
}

export async function fetchBooks(scope?: string): Promise<KbBook[]> {
  const query = scope ? `?scope=${encodeURIComponent(scope)}` : '';
  const data = await readJson<{ books: KbBook[] }>(await fetch(`${BASE}/books/${query}`, { credentials: 'same-origin' }));
  return data.books;
}

export async function fetchBook(bookId: string): Promise<KbBookDetail> {
  return readJson<KbBookDetail>(await fetch(`${BASE}/books/${bookId}/`, { credentials: 'same-origin' }));
}

export async function retryBuild(buildId: string) {
  return readJson<{ queued: boolean }>(await fetch(`${BASE}/builds/${buildId}/retry/`, { method: 'POST', credentials: 'same-origin' }));
}

export async function acceptBuild(buildId: string) {
  return readJson<{ active: boolean }>(await fetch(`${BASE}/builds/${buildId}/accept/`, { method: 'POST', credentials: 'same-origin' }));
}

export async function fetchWorkerStatus(): Promise<{ online: boolean; lastSeenAt: string | null }> {
  return readJson(await fetch(`${BASE}/worker/status/`, { credentials: 'same-origin' }));
}

/** Upload with real progress (XHR), so a large book shows how far it got. */
export function uploadBook(
  input: { file: File; title: string; scopes: ScopeCode[]; edition?: string },
  onProgress?: (percent: number) => void,
): Promise<KbUploadResult> {
  const form = new FormData();
  form.set('file', input.file);
  form.set('title', input.title);
  form.set('edition', input.edition || '');
  input.scopes.forEach(scope => form.append('scopes', scope));
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${BASE}/books/`);
    xhr.withCredentials = true;
    xhr.upload.onprogress = event => {
      if (event.lengthComputable && onProgress) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      let data: Record<string, unknown> = {};
      try { data = JSON.parse(xhr.responseText || '{}'); } catch { /* non-JSON error page */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as unknown as KbUploadResult);
      else reject(new Error((data.error as string) || `Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error('The upload was interrupted. Check your connection and try again.'));
    xhr.send(form);
  });
}

export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

export function isProcessing(book: KbBook) {
  return !['ready', 'needs_review', 'failed'].includes(book.processing.status);
}
