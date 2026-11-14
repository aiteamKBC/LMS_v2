/**
 * Module Overview (curriculum.modules.module_overview) for the Module Builder.
 *
 * Kept apart from moduleAuthoringData.ts and lib/curriculumApi.ts on purpose:
 * this editor writes one JSONB column through its own endpoint and never goes
 * through the module structure save, so it cannot touch components, weeks,
 * Teams settings, enrolments or progress.
 */
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/curriculum_api';

export const OVERVIEW_LIMITS = {
  summary: 300,
  description: 5000,
  instructorBio: 2000,
  url: 2048,
  listItems: 10,
  listItem: 200,
  sections: 12,
  sidebarSections: 6,
  sectionHeading: 120,
  sectionBody: 3000,
} as const;

/** The stored JSON version this editor writes. Version 1 records still load. */
export const OVERVIEW_SCHEMA_VERSION = 2;

/** One optional, reorderable Description-tab section. */
export type OverviewSection = { id: string; heading: string; body: string; bullets: string[] };

export type ModuleOverviewFields = {
  summary: string;
  description: string;
  descriptionSections: OverviewSection[];
  /** Custom cards shown in the learner sidebar, below the system-managed ones. */
  sidebarSections: OverviewSection[];
  highlights: string[];
  targetAudience: string[];
  prerequisites: string[];
  requirements: string[];
  instructorBio: string;
  instructorPhotoUrl: string;
  /** Optional Hero background: a public https:// image or an uploaded Hero background. */
  heroBackgroundUrl: string;
};

/** Both reorderable section lists share one item shape and rule set. */
export type OverviewSectionList = 'descriptionSections' | 'sidebarSections';
export const OVERVIEW_SECTION_LISTS: Record<OverviewSectionList, number> = {
  descriptionSections: OVERVIEW_LIMITS.sections, sidebarSections: OVERVIEW_LIMITS.sidebarSections,
};

export type OverviewListField = 'targetAudience' | 'prerequisites' | 'requirements' | 'highlights';
export const OVERVIEW_LIST_FIELDS: OverviewListField[] = ['targetAudience', 'prerequisites', 'requirements', 'highlights'];

export type ModuleOverviewRecord = {
  moduleCatalogueId: string;
  available: boolean;
  tutorName: string;
  defaultPhotoUrl: string;
  hasOverview: boolean;
  updatedAt: string | null;
  overview: ModuleOverviewFields;
  /** Instructor details saved for a previous tutor: kept, never shown to learners. */
  previousTutorDetails: string | null;
  saved?: boolean;
};

export type OverviewFieldError = { field: string; message: string };

export class ModuleOverviewError extends Error {
  status: number;
  fields: OverviewFieldError[];
  conflict: boolean;
  current: ModuleOverviewRecord | null;

  constructor(message: string, status: number, body: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ModuleOverviewError';
    this.status = status;
    this.fields = Array.isArray(body.fields) ? body.fields as OverviewFieldError[] : [];
    this.conflict = body.conflict === true;
    this.current = (body.current as ModuleOverviewRecord | undefined) || null;
  }
}

export const EMPTY_OVERVIEW: ModuleOverviewFields = {
  summary: '', description: '', descriptionSections: [], sidebarSections: [], highlights: [],
  targetAudience: [], prerequisites: [], requirements: [], instructorBio: '', instructorPhotoUrl: '', heroBackgroundUrl: '',
};

const SECTION_ID = /^[A-Za-z0-9_-]{1,40}$/;

/** A fresh client id for a new section; the server keeps safe, unique ids as sent. */
export function newSectionId(existing: OverviewSection[] = []) {
  const used = new Set(existing.map(section => section.id));
  let id = '';
  do id = `section-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`; while (used.has(id));
  return id;
}

const strings = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);

/**
 * Fill keys an older record (schemaVersion 1) or an older server does not send,
 * so the editor always works on a complete draft. Never written back on its own.
 */
function sectionsFrom(value: unknown, prefix: string): OverviewSection[] {
  const text = (item: unknown) => (typeof item === 'string' ? item : '');
  return (Array.isArray(value) ? value : [])
    .filter((section): section is Partial<OverviewSection> => Boolean(section) && typeof section === 'object')
    .map((section, index) => ({
      id: typeof section.id === 'string' && SECTION_ID.test(section.id) ? section.id : `${prefix}-${index + 1}`,
      heading: text(section.heading), body: text(section.body), bullets: strings(section.bullets),
    }));
}

export function withOverviewDefaults(value: Partial<ModuleOverviewFields> | null | undefined): ModuleOverviewFields {
  const source = value || {};
  const text = (item: unknown) => (typeof item === 'string' ? item : '');
  return {
    summary: text(source.summary),
    description: text(source.description),
    descriptionSections: sectionsFrom(source.descriptionSections, 'section'),
    sidebarSections: sectionsFrom(source.sidebarSections, 'sidebar'),
    highlights: strings(source.highlights),
    targetAudience: strings(source.targetAudience),
    prerequisites: strings(source.prerequisites),
    requirements: strings(source.requirements),
    instructorBio: text(source.instructorBio),
    instructorPhotoUrl: text(source.instructorPhotoUrl),
    heroBackgroundUrl: text(source.heroBackgroundUrl),
  };
}

function withRecordDefaults(record: ModuleOverviewRecord): ModuleOverviewRecord {
  return { ...record, overview: withOverviewDefaults(record.overview) };
}

const overviewUrl = (moduleCatalogueId: string) =>
  `${API_BASE_URL}/curriculum/modules/${encodeURIComponent(moduleCatalogueId)}/overview/`;

async function readJson<T>(response: Response, fallback: string): Promise<T> {
  let body: Record<string, unknown> = {};
  try {
    body = await response.json();
  } catch {
    // A proxy error page is not JSON; keep the status message.
  }
  if (!response.ok) {
    throw new ModuleOverviewError(typeof body.error === 'string' ? body.error : `${fallback} (${response.status}).`, response.status, body);
  }
  return body as T;
}

let csrfPromise: Promise<string> | null = null;

async function csrfToken() {
  if (!csrfPromise) {
    csrfPromise = fetch(`${API_BASE_URL}/curriculum/module-overviews/csrf/`, { credentials: 'same-origin' })
      .then(response => readJson<{ csrfToken: string }>(response, 'Could not prepare the request'))
      .then(body => body.csrfToken)
      .catch(error => { csrfPromise = null; throw error; });
  }
  return csrfPromise;
}

async function send<T>(url: string, method: 'PUT' | 'POST', body: unknown, fallback: string) {
  const token = await csrfToken();
  const response = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': token, 'X-Requested-With': 'XMLHttpRequest' },
    body: JSON.stringify(body),
  });
  if (response.status === 403) csrfPromise = null;
  return readJson<T>(response, fallback);
}

/** The overview's uploadable images; each has its own upload endpoint (and slot under the module). */
export type OverviewImageKind = 'instructor-photo' | 'hero-background';
const IMAGE_NOUN: Record<OverviewImageKind, string> = { 'instructor-photo': 'photo', 'hero-background': 'background image' };
const imageUploadUrl = (moduleCatalogueId: string, kind: OverviewImageKind) => `${overviewUrl(moduleCatalogueId)}${kind}/`;

/**
 * Store an overview image and return its URL. Writes no overview: the editor
 * calls this from Save overview and then saves the URL with the overview.
 */
export async function uploadOverviewImage(moduleCatalogueId: string, kind: OverviewImageKind, file: File) {
  const token = await csrfToken();
  const body = new FormData();
  body.append('file', file);
  // No Content-Type header: the browser sets the multipart boundary.
  const response = await fetch(imageUploadUrl(moduleCatalogueId, kind), {
    method: 'POST', credentials: 'same-origin', body,
    headers: { 'X-CSRFToken': token, 'X-Requested-With': 'XMLHttpRequest' },
  });
  if (response.status === 403) csrfPromise = null;
  return readJson<{ uploaded: boolean; url: string }>(response, `The ${IMAGE_NOUN[kind]} could not be uploaded`);
}

/**
 * Remove an image uploaded by this Save whose overview save then failed. The
 * server refuses (and keeps the file) once any overview references it.
 */
export async function discardOverviewImage(moduleCatalogueId: string, kind: OverviewImageKind, url: string) {
  const token = await csrfToken();
  const response = await fetch(imageUploadUrl(moduleCatalogueId, kind), {
    method: 'DELETE', credentials: 'same-origin', body: JSON.stringify({ url }),
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': token, 'X-Requested-With': 'XMLHttpRequest' },
  });
  if (response.status === 403) csrfPromise = null;
  return readJson<{ deleted: boolean }>(response, `The unsaved ${IMAGE_NOUN[kind]} could not be removed`);
}

export const uploadInstructorPhoto = (moduleCatalogueId: string, file: File) =>
  uploadOverviewImage(moduleCatalogueId, 'instructor-photo', file);
export const discardInstructorPhoto = (moduleCatalogueId: string, url: string) =>
  discardOverviewImage(moduleCatalogueId, 'instructor-photo', url);

/** Ids of modules that already have an overview. `available: false` before the migration runs. */
export async function fetchModuleOverviewStatus(signal?: AbortSignal) {
  const response = await fetch(`${API_BASE_URL}/curriculum/module-overviews/`, { signal, credentials: 'same-origin' });
  return readJson<{ available: boolean; moduleIds: string[] }>(response, 'Could not load module overview status');
}

export async function loadModuleOverview(moduleCatalogueId: string, signal?: AbortSignal) {
  const response = await fetch(overviewUrl(moduleCatalogueId), { signal, credentials: 'same-origin' });
  return withRecordDefaults(await readJson<ModuleOverviewRecord>(response, 'Could not load the module overview'));
}

export async function saveModuleOverview(moduleCatalogueId: string, overview: ModuleOverviewFields, expectedUpdatedAt: string | null) {
  const saved = await send<ModuleOverviewRecord>(overviewUrl(moduleCatalogueId), 'PUT',
    { overview: { schemaVersion: OVERVIEW_SCHEMA_VERSION, ...overview }, expectedUpdatedAt }, 'Could not save the module overview');
  return withRecordDefaults(saved);
}

/** After an explicit Duplicate: copy the source's reusable overview onto the new module. */
export function copyModuleOverview(targetModuleCatalogueId: string, sourceModuleCatalogueId: string) {
  return send<{ copied: boolean; reason?: string; instructorCopied?: boolean; instructorDropped?: boolean }>(
    `${overviewUrl(targetModuleCatalogueId)}copy/`, 'POST', { sourceModuleCatalogueId }, 'Could not copy the module overview');
}

/**
 * The Duplicate flow's overview step. Copies only when the module it explicitly
 * duplicated from has an overview; never matches by title. Returns the sentence
 * to append to the "Module duplicated" notice. A failure never fails the
 * duplicate: the module exists and the overview can be added from its card.
 */
export async function copyOverviewAfterDuplicate({ sourceId, duplicateId, sourceHasOverview }: {
  sourceId: string; duplicateId: string; sourceHasOverview: boolean;
}): Promise<{ copied: boolean; message: string }> {
  if (!sourceId || !duplicateId || !sourceHasOverview) return { copied: false, message: '' };
  try {
    const result = await copyModuleOverview(duplicateId, sourceId);
    if (!result.copied) return { copied: false, message: '' };
    return {
      copied: true,
      message: result.instructorDropped
        ? ' Its module overview was copied; the tutor biography and photo were not, because the new module has a different tutor.'
        : ' Its module overview was copied.',
    };
  } catch {
    return { copied: false, message: ' The module overview could not be copied. Add it from the new module card.' };
  }
}

const HTML_TAG =/<\s*\/?\s*[a-zA-Z!?]/;
const IMAGE_PATH = /\.(jpe?g|png|webp|gif|avif)$/i;
/** Mirror the server's ``_uploaded_url_pattern(slot)``: a file in a module's upload slot for one image kind. */
const UPLOADED_PHOTO_URL = /^\/curriculum_api\/curriculum\/uploads\/[A-Za-z0-9_-]{1,96}\/instructor-photo\/[A-Za-z0-9_-]{1,120}\.(jpg|jpeg|png|webp)$/;
const UPLOADED_HERO_URL = /^\/curriculum_api\/curriculum\/uploads\/[A-Za-z0-9_-]{1,96}\/hero-background\/[A-Za-z0-9_-]{1,120}\.(jpg|jpeg|png|webp)$/;

/** Whether a photo URL is an uploaded instructor photo (as opposed to a pasted https:// URL). */
export const isUploadedPhotoUrl = (value: string) => UPLOADED_PHOTO_URL.test(value.trim());
/** Whether a Hero background URL is an uploaded Hero background (as opposed to a pasted https:// URL). */
export const isUploadedHeroUrl = (value: string) => UPLOADED_HERO_URL.test(value.trim());

/** Mirrors the server's photo URL rule so the form can explain a problem before saving. */
export function photoUrlProblem(value: string): string {
  return imageUrlProblem(value, isUploadedPhotoUrl);
}

/** Mirrors the server's Hero background URL rule: public https://, or an uploaded Hero background only. */
export function heroBackgroundUrlProblem(value: string): string {
  return imageUrlProblem(value, isUploadedHeroUrl);
}

function imageUrlProblem(value: string, isUploaded: (value: string) => boolean): string {
  const url = value.trim();
  if (!url) return '';
  if (url.length > OVERVIEW_LIMITS.url) return `Must be ${OVERVIEW_LIMITS.url} characters or fewer.`;
  if (isUploaded(url)) return '';
  if (/[\s"'<>\\`]/.test(url)) return 'The URL contains characters that are not allowed.';
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'Enter a valid URL.';
  }
  if (parsed.protocol !== 'https:') return 'The image must use an https:// address.';
  if (parsed.username || parsed.password) return 'The URL must not contain credentials.';
  const host = parsed.hostname.toLowerCase();
  if (!host.includes('.') || host === 'localhost' || /\.(local|internal|localhost)$/.test(host)) return 'Use a public image address.';
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith('[')) return 'Use a public image address, not an IP address.';
  if (parsed.port && parsed.port !== '443') return 'Use the standard https port.';
  if (!IMAGE_PATH.test(parsed.pathname)) return 'The URL must point to an image file (.jpg, .jpeg, .png, .webp, .gif or .avif).';
  return '';
}

/** Client-side checks; the server repeats every one of them. */
export function validateOverview(fields: ModuleOverviewFields, tutorName: string): OverviewFieldError[] {
  const errors: OverviewFieldError[] = [];
  const text = (field: keyof ModuleOverviewFields, value: string, limit: number) => {
    if (HTML_TAG.test(value)) errors.push({ field, message: 'HTML is not allowed. Use plain text.' });
    else if (value.trim().length > limit) errors.push({ field, message: `Must be ${limit} characters or fewer.` });
  };
  text('summary', fields.summary, OVERVIEW_LIMITS.summary);
  text('description', fields.description, OVERVIEW_LIMITS.description);
  text('instructorBio', fields.instructorBio, OVERVIEW_LIMITS.instructorBio);
  const list = (field: string, values: string[]) => {
    const items = values.map(item => item.trim()).filter(Boolean);
    if (items.length > OVERVIEW_LIMITS.listItems) errors.push({ field, message: `Add at most ${OVERVIEW_LIMITS.listItems} items.` });
    items.forEach((item, index) => {
      if (HTML_TAG.test(item)) errors.push({ field: `${field}[${index}]`, message: 'HTML is not allowed. Use plain text.' });
      else if (item.length > OVERVIEW_LIMITS.listItem) errors.push({ field: `${field}[${index}]`, message: `Must be ${OVERVIEW_LIMITS.listItem} characters or fewer.` });
    });
  };
  OVERVIEW_LIST_FIELDS.forEach(field => list(field, fields[field]));
  // Indexes match what is sent: blank sections are dropped by normaliseOverview first.
  (Object.keys(OVERVIEW_SECTION_LISTS) as OverviewSectionList[]).forEach(key => {
    const limit = OVERVIEW_SECTION_LISTS[key];
    if (fields[key].length > limit) {
      errors.push({ field: key, message: `Add at most ${limit} sections.` });
    }
    fields[key].forEach((section, index) => {
      const field = `${key}[${index}]`;
      const heading = section.heading.trim();
      if (!heading && (section.body.trim() || section.bullets.some(item => item.trim()))) {
        errors.push({ field: `${field}.heading`, message: 'Add a heading for this section.' });
      } else if (HTML_TAG.test(heading)) errors.push({ field: `${field}.heading`, message: 'HTML is not allowed. Use plain text.' });
      else if (heading.length > OVERVIEW_LIMITS.sectionHeading) errors.push({ field: `${field}.heading`, message: `Must be ${OVERVIEW_LIMITS.sectionHeading} characters or fewer.` });
      if (HTML_TAG.test(section.body)) errors.push({ field: `${field}.body`, message: 'HTML is not allowed. Use plain text.' });
      else if (section.body.trim().length > OVERVIEW_LIMITS.sectionBody) errors.push({ field: `${field}.body`, message: `Must be ${OVERVIEW_LIMITS.sectionBody} characters or fewer.` });
      list(`${field}.bullets`, section.bullets);
    });
  });
  const photo = photoUrlProblem(fields.instructorPhotoUrl);
  if (photo) errors.push({ field: 'instructorPhotoUrl', message: photo });
  const hero = heroBackgroundUrlProblem(fields.heroBackgroundUrl);
  if (hero) errors.push({ field: 'heroBackgroundUrl', message: hero });
  if (!tutorName.trim() && (fields.instructorBio.trim() || fields.instructorPhotoUrl.trim())) {
    errors.push({ field: 'instructorBio', message: 'Assign a tutor to this module before adding instructor details.' });
  }
  return errors;
}

function cleanSections(sections: OverviewSection[]) {
  const list = (items: string[]) => items.map(item => item.trim()).filter(Boolean);
  return sections
    .map(section => ({ id: section.id, heading: section.heading.trim(), body: section.body.trim(), bullets: list(section.bullets) }))
    .filter(section => section.heading || section.body || section.bullets.length);
}

/** Trim and drop blank list rows and completely blank sections before sending. */
export function normaliseOverview(fields: ModuleOverviewFields): ModuleOverviewFields {
  const list = (items: string[]) => items.map(item => item.trim()).filter(Boolean);
  return {
    summary: fields.summary.trim(),
    description: fields.description.trim(),
    descriptionSections: cleanSections(fields.descriptionSections),
    sidebarSections: cleanSections(fields.sidebarSections),
    highlights: list(fields.highlights),
    targetAudience: list(fields.targetAudience),
    prerequisites: list(fields.prerequisites),
    requirements: list(fields.requirements),
    instructorBio: fields.instructorBio.trim(),
    instructorPhotoUrl: fields.instructorPhotoUrl.trim(),
    heroBackgroundUrl: fields.heroBackgroundUrl.trim(),
  };
}
