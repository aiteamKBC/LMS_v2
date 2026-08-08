const API_PREFIXES = [
  '/curriculum_api/',
  '/coach_api/',
  '/quiz_api/',
  '/learner_api/',
  '/audit_api/',
  '/engagement_api/',
  '/enrolment_api/',
  '/api/chat/',
  '/api/calendar/',
];
const BATCH_ENDPOINT = '/api/batch/';
const BATCH_WINDOW_MS = 12;
const NON_BATCHABLE_PATH = /\/(?:download|content)\/?$/i;

type FetchCaller = {
  resolve: (response: Response) => void;
  reject: (reason?: unknown) => void;
  signal?: AbortSignal;
  abort?: () => void;
};

type QueuedGet = {
  id: string;
  key: string;
  url: string;
  headers: Record<string, string>;
  callers: FetchCaller[];
};

type BatchResult = {
  id: string;
  status: number;
  body: string;
  headers?: Record<string, string>;
};

let nativeFetch: typeof globalThis.fetch | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let nextRequestId = 1;
const queuedByKey = new Map<string, QueuedGet>();

function abortError() {
  return new DOMException('The operation was aborted.', 'AbortError');
}

function requestHeaders(request: Request) {
  return Object.fromEntries(Array.from(request.headers.entries()));
}

function batchKey(url: URL, request: Request) {
  return JSON.stringify([url.pathname, url.search, Array.from(request.headers.entries()).sort()]);
}

function isBatchable(request: Request, url: URL) {
  return request.method === 'GET'
    && url.origin === globalThis.location.origin
    && API_PREFIXES.some(prefix => url.pathname.startsWith(prefix))
    && url.pathname !== BATCH_ENDPOINT
    && url.pathname !== '/api/chat/session/'
    && !NON_BATCHABLE_PATH.test(url.pathname)
    && !request.headers.has('range');
}

function decodeBody(value: string) {
  if (!value) return new Uint8Array();
  const decoded = atob(value);
  return Uint8Array.from(decoded, character => character.charCodeAt(0));
}

function responseFromResult(result: BatchResult) {
  return new Response(decodeBody(result.body), {
    status: result.status,
    headers: result.headers || {},
  });
}

function settleCallers(item: QueuedGet, result?: BatchResult, failure?: unknown) {
  item.callers.forEach(caller => {
    if (caller.abort && caller.signal) caller.signal.removeEventListener('abort', caller.abort);
    if (caller.signal?.aborted) return;
    if (failure) caller.reject(failure);
    else if (result) caller.resolve(responseFromResult(result));
    else caller.reject(new Error('The batched request did not return a response.'));
  });
}

async function flushQueue() {
  flushTimer = null;
  const items = Array.from(queuedByKey.values());
  queuedByKey.clear();
  if (!items.length || !nativeFetch) return;

  try {
    const response = await nativeFetch(BATCH_ENDPOINT, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: items.map(({ id, url, headers }) => ({ id, url, headers })),
      }),
    });
    if (!response.ok) throw new Error(`API batch failed with ${response.status}`);
    const payload = await response.json() as { responses?: BatchResult[] };
    const results = new Map((payload.responses || []).map(result => [result.id, result]));
    items.forEach(item => settleCallers(item, results.get(item.id)));
  } catch (error) {
    items.forEach(item => settleCallers(item, undefined, error));
  }
}

function enqueue(request: Request, url: URL): Promise<Response> {
  const key = batchKey(url, request);
  let item = queuedByKey.get(key);
  if (!item) {
    item = {
      id: String(nextRequestId++),
      key,
      url: `${url.pathname}${url.search}`,
      headers: requestHeaders(request),
      callers: [],
    };
    queuedByKey.set(key, item);
  }

  const queuedItem = item;
  const promise = new Promise<Response>((resolve, reject) => {
    const caller: FetchCaller = { resolve, reject, signal: request.signal };
    if (request.signal.aborted) {
      reject(abortError());
      return;
    }
    caller.abort = () => {
      queuedItem.callers = queuedItem.callers.filter(entry => entry !== caller);
      reject(abortError());
      if (!queuedItem.callers.length) queuedByKey.delete(queuedItem.key);
    };
    request.signal.addEventListener('abort', caller.abort, { once: true });
    queuedItem.callers.push(caller);
  });

  if (!flushTimer) flushTimer = setTimeout(() => void flushQueue(), BATCH_WINDOW_MS);
  return promise;
}

export function installApiGetBatching() {
  if (nativeFetch || typeof globalThis.fetch !== 'function' || typeof globalThis.location === 'undefined') return;
  nativeFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = ((
    input: Parameters<typeof globalThis.fetch>[0],
    init?: Parameters<typeof globalThis.fetch>[1],
  ) => {
    const request = new Request(input, init);
    const url = new URL(request.url, globalThis.location.href);
    return isBatchable(request, url) ? enqueue(request, url) : nativeFetch!(input, init);
  }) as typeof globalThis.fetch;
}

export function uninstallApiGetBatching() {
  if (nativeFetch) globalThis.fetch = nativeFetch;
  nativeFetch = null;
  queuedByKey.clear();
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
}
