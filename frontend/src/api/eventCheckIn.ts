const BASE = '/engagement_api/event-check-in';
let csrfPromise: Promise<string> | null = null;

async function csrfToken() {
  if (!csrfPromise) {
    csrfPromise = fetch(`${BASE}/csrf/`, { credentials: 'include' })
      .then(async response => {
        const body = await response.json().catch(() => ({})) as { csrfToken?: string; error?: string };
        if (!response.ok || !body.csrfToken) throw new Error(body.error || 'Unable to initialise check-in.');
        return body.csrfToken;
      })
      .catch(error => { csrfPromise = null; throw error; });
  }
  return csrfPromise;
}

async function read<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body as T;
}

export interface CheckInEvent {
  title: string;
  date: string;
  time: string;
  location: string;
  state: 'open' | 'not_open' | 'closed' | 'unavailable';
  opensAt: string | null;
  closesAt: string | null;
}

export const eventCheckInApi = {
  event: async (token: string) => read<{ event: CheckInEvent }>(await fetch(`${BASE}/`, {
    method: 'POST', credentials: 'include',
    headers: {
      'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest',
      'X-CSRFToken': await csrfToken(),
    },
    body: JSON.stringify({ action: 'read', token }),
  })),
  submit: async (token: string, name: string, email: string) => read<{ recorded: true; message: string }>(await fetch(`${BASE}/`, {
    method: 'POST', credentials: 'include',
    headers: {
      'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest',
      'X-CSRFToken': await csrfToken(),
    },
    body: JSON.stringify({ token, name, email }),
  })),
};
