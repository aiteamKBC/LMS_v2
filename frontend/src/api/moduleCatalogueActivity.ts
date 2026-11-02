export interface ModuleCatalogueActivity {
  source: 'old_lms' | 'new_lms' | 'unknown';
  startDate: string;
  lastLiveDate: string;
}

export type ModuleCatalogueActivities = Record<string, ModuleCatalogueActivity>;

export async function fetchModuleCatalogueActivity(signal?: AbortSignal): Promise<ModuleCatalogueActivities> {
  const base = import.meta.env.VITE_API_BASE_URL || '/curriculum_api';
  const response = await fetch(`${base}/curriculum/modules/catalogue-activity/`, {
    credentials: 'include', cache: 'no-store', signal,
  });
  if (!response.ok) throw new Error('Module activity could not be verified. Try again or view all modules.');
  const payload = await response.json() as { modules: ModuleCatalogueActivities };
  if (!payload.modules || typeof payload.modules !== 'object' || Array.isArray(payload.modules)) {
    throw new Error('Module activity could not be verified. Try again or view all modules.');
  }
  return payload.modules;
}
