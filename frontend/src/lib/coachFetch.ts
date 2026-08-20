const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const CSRF_ENDPOINT = '/coach_api/csrf';

let csrfTokenPromise: Promise<string> | null = null;

async function requestCoachCsrfToken(): Promise<string> {
  const response = await fetch(CSRF_ENDPOINT, { credentials: 'include' });
  const payload = await response.json().catch(() => ({})) as { csrfToken?: string };
  if (!response.ok || !payload.csrfToken) {
    throw new Error('Unable to initialise request verification.');
  }
  return payload.csrfToken;
}

function coachCsrfToken(): Promise<string> {
  if (!csrfTokenPromise) {
    csrfTokenPromise = requestCoachCsrfToken().catch(error => {
      csrfTokenPromise = null;
      throw error;
    });
  }
  return csrfTokenPromise;
}

/** Fetch Coach APIs with the session cookie and Django CSRF on unsafe methods. */
export async function coachFetch(
  input: globalThis.RequestInfo | URL,
  init: globalThis.RequestInit = {},
): Promise<Response> {
  const method = String(
    init.method || (input instanceof Request ? input.method : 'GET'),
  ).toUpperCase();
  const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));

  if (UNSAFE_METHODS.has(method)) {
    headers.set('X-CSRFToken', await coachCsrfToken());
  }

  return fetch(input, {
    ...init,
    credentials: 'include',
    headers,
  });
}
