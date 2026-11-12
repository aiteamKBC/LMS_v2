export interface BreatheConnectionStatus {
  id: string;
  tenantId: string;
  provider: string;
  externalAccountId: string;
  status: string;
  enabledFeatures: string[];
  lastVerifiedAt: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
}

export interface BreatheSyncRun {
  id: string;
  connectionId: string;
  status: string;
  resources: string[];
  dryRun: boolean;
  counts: Record<string, number>;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface BreathePendingMatch {
  id: string;
  externalEmployeeId: string;
  email: string;
  displayName: string;
  department: string;
  jobTitle: string;
  status: string;
}

export interface BreathePreview {
  connection: BreatheConnectionStatus;
  pendingMatches: BreathePendingMatch[];
}

export interface BreatheSchedulingConflict {
  id: string;
  externalPersonId: string;
  sessionRef: string;
  startsAt: string;
  endsAt: string;
  status: string;
  proposedSlots: string[];
}

const BASE = '/integrations_api/breathe/connections';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      credentials: 'include',
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        ...(init?.headers || {}),
      },
    });
  } catch {
    throw new Error('Could not reach the integration service.');
  }
  const text = await response.text();
  let payload: Record<string, unknown> = {};
  try {
    payload = text ? JSON.parse(text) as Record<string, unknown> : {};
  } catch {
    throw new Error(`Unexpected response (${response.status}).`);
  }
  if (!response.ok) throw new Error(typeof payload.error === 'string' ? payload.error : `Request failed (${response.status}).`);
  return payload as T;
}

export function getBreatheStatus(connectionId: string): Promise<BreatheConnectionStatus> {
  return request<BreatheConnectionStatus>(`${BASE}/${encodeURIComponent(connectionId)}/status`);
}

export function listBreatheConnections(): Promise<{ results: BreatheConnectionStatus[] }> {
  return request<{ results: BreatheConnectionStatus[] }>(BASE);
}

export function createBreatheConnection(input: { tenantId?: string; tenantKey?: string; displayName?: string; tenantKind?: string; employerId?: number; externalAccountId: string; secretRef: string; baseUrl?: string }): Promise<BreatheConnectionStatus> {
  return request<BreatheConnectionStatus>(`${BASE}/create`, {
    method: 'POST',
    body: JSON.stringify({
      tenant_id: input.tenantId,
      tenant_key: input.tenantKey,
      display_name: input.displayName,
      tenant_kind: input.tenantKind,
      employer_id: input.employerId,
      external_account_id: input.externalAccountId,
      secret_ref: input.secretRef,
      base_url: input.baseUrl,
    }),
  });
}

export function getBreathePreview(connectionId: string): Promise<BreathePreview> {
  return request<BreathePreview>(`${BASE}/${encodeURIComponent(connectionId)}/preview`);
}

export function getBreatheRuns(connectionId: string): Promise<{ results: BreatheSyncRun[] }> {
  return request<{ results: BreatheSyncRun[] }>(`${BASE}/${encodeURIComponent(connectionId)}/runs`);
}

export function getBreatheConflicts(connectionId: string): Promise<{ results: BreatheSchedulingConflict[] }> {
  return request<{ results: BreatheSchedulingConflict[] }>(`${BASE}/${encodeURIComponent(connectionId)}/conflicts`);
}

export function triggerBreatheSync(connectionId: string, resources: string[] = ['employees', 'departments', 'leave_requests', 'working_patterns', 'training_courses']): Promise<{ sync_run_id: string; connection_id: string; status: string; deduplicated?: boolean }> {
  return request(`${BASE}/${encodeURIComponent(connectionId)}/sync`, {
    method: 'POST',
    body: JSON.stringify({ resources, idempotency_key: crypto.randomUUID() }),
  });
}
