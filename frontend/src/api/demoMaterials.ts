const BASE = '/curriculum_api/curriculum/programme-audit/materials';

export interface DemoMaterialAsset {
  id: string;
  module_catalogue_id: string;
  module_title: string;
  week_id: string;
  week_number: number | null;
  week_title: string;
  component_id: string;
  component_type: string;
  content_kind: string;
  title: string;
  description: string;
  source_url: string;
  embed_url: string;
  render_mode: string;
  duration_minutes: number | null;
  expected_otjh: number | null;
  points: number | null;
  status: string;
}

export interface DemoMaterialTable {
  key: string;
  table: string;
  name: string;
  programme: string;
  ready: boolean;
  count: number;
  expectedMinutes: number;
  firstWeekTitle: string;
  results: DemoMaterialAsset[];
}

async function read<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Could not load material (${response.status}).`);
  return payload as T;
}

export async function fetchDemoMaterialSummaries(programme: string): Promise<DemoMaterialTable[]> {
  const query = new URLSearchParams({ programme }).toString();
  const response = await fetch(`${BASE}/?${query}`, { credentials: 'include', cache: 'no-store' });
  return (await read<{ results: DemoMaterialTable[] }>(response)).results;
}

export async function fetchDemoMaterial(key: string): Promise<DemoMaterialTable> {
  const response = await fetch(`${BASE}/${encodeURIComponent(key)}/`, { credentials: 'include', cache: 'no-store' });
  return read<DemoMaterialTable>(response);
}
