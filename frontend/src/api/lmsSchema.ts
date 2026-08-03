const BASE = '/learner_api/kbc-lms/all-students-schema';

export interface LmsSource {
  provider?: string | null;
  display_mode?: string | null;
  open_url?: string | null;
  embed_url?: string | null;
  file_url?: string | null;
  lms_url?: string | null;
  can_embed?: boolean;
  requires_lms_login?: boolean;
  attachments?: Array<{
    attachment_id?: number;
    file_title?: string | null;
    filename?: string | null;
    content_type?: string | null;
    open_url?: string | null;
    embed_url?: string | null;
    file_url?: string | null;
  }>;
}

export interface LmsMaterial {
  curriculum_material_record_id: number;
  material_id: number;
  material_order: number;
  material_title: string;
  component_type?: string | null;
  content_type?: string | null;
  material_format?: string | null;
  source?: LmsSource | null;
  content_duration?: {
    seconds?: number | null;
    minutes?: number | null;
    formatted?: string | null;
    raw?: string | null;
  } | null;
  student_activity?: {
    status?: string | null;
    completed_at_utc?: string | null;
    last_activity_at_utc?: string | null;
    duration_formatted?: string | null;
    highest_score?: number | null;
  } | null;
}

export interface LmsSection {
  section_id: number;
  section_order: number;
  section_title: string;
  section_status?: string | null;
  total_materials?: number;
  completed_materials?: number;
  materials?: LmsMaterial[];
}

export interface LmsCourse {
  course_id: number;
  course_name: string;
  progress_percent?: number | null;
  course_status?: string | null;
  sections?: LmsSection[];
}

export interface LmsStudent {
  lms_user_id: number;
  display_name: string;
  email: string;
  email_normalized?: string | null;
  courses?: LmsCourse[];
}

export interface LmsSchemaResponse {
  schema_version?: string;
  generated_at_utc?: string;
  students: LmsStudent[];
}

export async function fetchLmsSchema(options: { page?: number; perPage?: number; search?: string; email?: string } = {}): Promise<LmsSchemaResponse> {
  const params = new URLSearchParams();
  if (options.page) params.set('page', String(options.page));
  if (options.perPage) params.set('per_page', String(options.perPage));
  if (options.search) params.set('search', options.search);
  if (options.email) params.set('email', options.email);
  const qs = params.toString() ? `?${params.toString()}` : '';
  const res = await fetch(`${BASE}/${qs}`, { headers: { Accept: 'application/json' } });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`The LMS proxy returned an unexpected response (${res.status}).`);
  }
  if (!res.ok) {
    const message = typeof data === 'object' && data && 'error' in data
      ? String((data as { error?: string }).error)
      : `LMS schema request failed (${res.status}).`;
    throw new Error(message);
  }
  return data as LmsSchemaResponse;
}
