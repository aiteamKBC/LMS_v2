export type ModuleStatus = 'draft' | 'review' | 'published' | string;
export type KsbMappingType = 'main' | 'secondary' | 'possible';
export type ModuleComponentType =
  | 'live-session'
  | 'recording-placeholder'
  | 'video'
  | 'podcast'
  | 'reading'
  | 'powerpoint'
  | 'quiz'
  | 'monthly-ksb-quiz'
  | 'reflection'
  | 'assignment'
  | 'checkpoint'
  | 'coaching-preparation';

export type ComponentSettingValue = string | number | boolean | string[];
export type ComponentSettings = Record<string, ComponentSettingValue>;

export type ComponentCapability =
  | 'preview'
  | 'media'
  | 'rich-text'
  | 'ksb-mapping'
  | 'reflection'
  | 'evidence'
  | 'tutor-validation';

export interface ComponentAuthoringDefinition {
  type: ModuleComponentType;
  label: string;
  icon: string;
  group: 'Live & recorded' | 'Learning materials' | 'Assessment' | 'Monthly cycle';
  tone: string;
  defaultOtjh: number;
  defaultPoints: number;
  reflectionDefault: boolean;
  workplaceEvidenceDefault: boolean;
  tutorValidationDefault: boolean;
  supportedSources: readonly string[];
  requiredSettings: readonly string[];
  capabilities: readonly ComponentCapability[];
  defaultSettings: ComponentSettings;
}

export const MEDIA_SOURCE_TYPES = ['HTML (MP4)', 'YouTube', 'Vimeo', 'External Link', 'Embed'] as const;
export const PODCAST_SOURCE_TYPES = ['External URL', 'LMS resource', 'Device upload'] as const;
export const READING_SOURCE_TYPES = ['Written in LMS', 'URL', 'LMS resource'] as const;
export const CONTENT_STATUSES = ['Draft', 'Ready for QA', 'Needs changes', 'Approved'] as const;

function advancedDefaults(type: ModuleComponentType): ComponentSettings {
  const completionRules: Partial<Record<ModuleComponentType, string>> = {
    'live-session': 'Attend or watch recording',
    'recording-placeholder': 'Mark complete after watching',
    video: 'Watch video and mark complete',
    podcast: 'Listen and mark complete',
    reading: 'Read the material and confirm completion',
    powerpoint: 'Review slide deck',
    quiz: 'Submit',
    'monthly-ksb-quiz': 'Submit monthly KSB quiz',
    reflection: 'Submit reflection',
    assignment: 'Submit assignment',
    checkpoint: 'Complete checkpoint',
    'coaching-preparation': 'Complete coaching preparation',
  };
  const evidenceRequired: Partial<Record<ModuleComponentType, string>> = {
    'live-session': 'Attendance or recording completion',
    quiz: 'Quiz result',
    'monthly-ksb-quiz': 'Quiz result',
    checkpoint: 'Quiz result',
    reflection: 'Reflection + signature',
    assignment: 'Submission file',
    'coaching-preparation': 'Preparation notes',
  };
  return {
    completionRule: completionRules[type] || 'Mark complete',
    evidenceRequired: evidenceRequired[type] || '-',
    reflectionPrompt: defaultReflectionPrompt(type),
    contentStatus: 'Draft',
    version: '0.1',
  };
}

const definitions: ComponentAuthoringDefinition[] = [
  {
    type: 'live-session',
    label: 'Live Teams Session',
    icon: 'ri-group-line',
    group: 'Live & recorded',
    tone: 'violet',
    defaultOtjh: 2,
    defaultPoints: 10,
    reflectionDefault: false,
    workplaceEvidenceDefault: false,
    tutorValidationDefault: false,
    supportedSources: [],
    requiredSettings: [],
    capabilities: ['ksb-mapping', 'reflection', 'evidence', 'tutor-validation'],
    defaultSettings: { ...advancedDefaults('live-session'), sessionPurpose: '', selectedGroupKeys: [], selectedGroupNames: [], liveSessionUrl: '', preparationInstructions: '', reflectionQuestions: '', attendanceRequired: true, recordingExpected: true },
  },
  {
    type: 'recording-placeholder',
    label: 'Recording Placeholder',
    icon: 'ri-play-circle-line',
    group: 'Live & recorded',
    tone: 'slate',
    defaultOtjh: 2,
    defaultPoints: 10,
    reflectionDefault: false,
    workplaceEvidenceDefault: false,
    tutorValidationDefault: false,
    supportedSources: ['MIS allocation', 'External link'],
    requiredSettings: [],
    capabilities: ['media', 'preview', 'ksb-mapping', 'reflection', 'tutor-validation'],
    defaultSettings: { ...advancedDefaults('recording-placeholder'), source: 'MIS allocation', selectedGroupKeys: [], selectedGroupNames: [], recordingPurpose: '', recordingUrl: '', expectedAvailability: 'After live session', captionsExpected: false },
  },
  {
    type: 'video',
    label: 'Video',
    icon: 'ri-video-line',
    group: 'Learning materials',
    tone: 'rose',
    defaultOtjh: 0,
    defaultPoints: 10,
    reflectionDefault: false,
    workplaceEvidenceDefault: false,
    tutorValidationDefault: false,
    supportedSources: MEDIA_SOURCE_TYPES,
    requiredSettings: [],
    capabilities: ['media', 'preview', 'rich-text', 'ksb-mapping', 'reflection', 'evidence', 'tutor-validation'],
    defaultSettings: {
      ...advancedDefaults('video'),
      sourceType: 'YouTube',
      provider: 'YouTube',
      videoUrl: '',
      embedCode: '',
      durationMinutes: 10,
      requiredProgressPercentage: 0,
      lessonPreview: false,
      captionsAvailable: false,
      shortDescription: '',
      learningBrief: '',
      lessonContent: '',
      lessonMaterialLinks: '',
      lessonMaterialsNotes: '',
      postWatchTask: '',
      markersAndQuestions: '',
      qAndA: '',
    },
  },
  {
    type: 'podcast',
    label: 'Podcast',
    icon: 'ri-mic-line',
    group: 'Learning materials',
    tone: 'amber',
    defaultOtjh: 2,
    defaultPoints: 10,
    reflectionDefault: false,
    workplaceEvidenceDefault: false,
    tutorValidationDefault: false,
    supportedSources: PODCAST_SOURCE_TYPES,
    requiredSettings: [],
    capabilities: ['media', 'preview', 'ksb-mapping', 'reflection', 'tutor-validation'],
    defaultSettings: { ...advancedDefaults('podcast'), podcastSource: 'External URL', podcastUrl: '', uploadedFileName: '', uploadedFileUrl: '', uploadedFileSize: 0, uploadedFileContentType: '', uploadSource: '', durationMinutes: 20, requiredProgressPercentage: 0, listeningFocus: '', podcastReflectionQuestion: '', transcript: '' },
  },
  {
    type: 'reading',
    label: 'Reading Material',
    icon: 'ri-book-open-line',
    group: 'Learning materials',
    tone: 'emerald',
    defaultOtjh: 2,
    defaultPoints: 10,
    reflectionDefault: false,
    workplaceEvidenceDefault: false,
    tutorValidationDefault: false,
    supportedSources: READING_SOURCE_TYPES,
    requiredSettings: [],
    capabilities: ['preview', 'rich-text', 'ksb-mapping', 'reflection', 'tutor-validation'],
    defaultSettings: {
      ...advancedDefaults('reading'),
      difficulty: 'Standard',
      requirement: 'Required',
      readingSource: 'Written in LMS',
      resourceUrl: '',
      shortDescription: '',
      readingContent: '',
      mainLearningOutcomes: '',
      ksbEvidenceNotes: '',
      focusSections: '',
      learnerInstruction: '',
      keyPointCount: '0',
      keyPoints: '',
      glossaryTerms: '',
      estimatedReadingTime: 20,
      otjhRationale: '',
      audioEnabled: false,
      audioUrl: '',
      reflectionQuestionCount: '0 qs',
      readingReflectionPrompts: '',
      readingEvidenceRequired: '',
      completionRuleCount: '3 rules',
      completionConfirmationRequired: true,
      linkedActivity: '',
      coachingPrompt: '',
      requiredReading: true,
    },
  },
  {
    type: 'powerpoint',
    label: 'PowerPoint',
    icon: 'ri-file-ppt-2-line',
    group: 'Learning materials',
    tone: 'orange',
    defaultOtjh: 2,
    defaultPoints: 5,
    reflectionDefault: false,
    workplaceEvidenceDefault: false,
    tutorValidationDefault: false,
    supportedSources: ['External URL', 'LMS resource', 'Device upload'],
    requiredSettings: [],
    capabilities: ['preview', 'ksb-mapping', 'reflection', 'tutor-validation'],
    defaultSettings: { ...advancedDefaults('powerpoint'), fileName: '', presentationUrl: '', uploadedFileName: '', uploadedFileUrl: '', uploadedFileSize: 0, uploadedFileContentType: '', uploadSource: '', slideRange: '', speakerNotes: '', downloadAllowed: true },
  },
  {
    type: 'quiz',
    label: 'Quiz',
    icon: 'ri-questionnaire-line',
    group: 'Assessment',
    tone: 'sky',
    defaultOtjh: 2,
    defaultPoints: 20,
    reflectionDefault: false,
    workplaceEvidenceDefault: false,
    tutorValidationDefault: false,
    supportedSources: [],
    requiredSettings: [],
    capabilities: ['ksb-mapping', 'reflection', 'tutor-validation'],
    defaultSettings: { ...advancedDefaults('quiz'), buildMode: 'linked', linkedQuizId: '', linkedActivity: '', numberOfQuestions: 10, passMarkPercentage: 70, attemptsAllowed: 2, affectsKsbProgression: true, completionFeedback: '' },
  },
  {
    type: 'assignment',
    label: 'Assignment',
    icon: 'ri-file-list-3-line',
    group: 'Assessment',
    tone: 'purple',
    defaultOtjh: 2,
    defaultPoints: 20,
    reflectionDefault: false,
    workplaceEvidenceDefault: false,
    tutorValidationDefault: true,
    supportedSources: [],
    requiredSettings: [],
    capabilities: ['ksb-mapping', 'reflection', 'evidence', 'tutor-validation'],
    defaultSettings: { ...advancedDefaults('assignment'), assignmentBrief: '', submissionInstructions: '', dueTiming: 'End of week', markingRubric: '' },
  },
  {
    type: 'reflection',
    label: 'Reflection',
    icon: 'ri-chat-quote-line',
    group: 'Assessment',
    tone: 'teal',
    defaultOtjh: 0.5,
    defaultPoints: 15,
    reflectionDefault: true,
    workplaceEvidenceDefault: false,
    tutorValidationDefault: true,
    supportedSources: [],
    requiredSettings: ['reflectionPrompt'],
    capabilities: ['ksb-mapping', 'reflection', 'tutor-validation'],
    defaultSettings: { ...advancedDefaults('reflection'), minimumWordCount: 250, learnerGuidance: '', tutorReviewGuidance: '' },
  },
  {
    type: 'checkpoint',
    label: 'Checkpoint Quiz',
    icon: 'ri-checkbox-circle-line',
    group: 'Monthly cycle',
    tone: 'blue',
    defaultOtjh: 2,
    defaultPoints: 20,
    reflectionDefault: false,
    workplaceEvidenceDefault: false,
    tutorValidationDefault: false,
    supportedSources: [],
    requiredSettings: [],
    capabilities: ['ksb-mapping', 'reflection', 'tutor-validation'],
    defaultSettings: { ...advancedDefaults('checkpoint'), checkpointTitle: '', checkpointQuestions: '', progressReviewLinked: true, monthlyCoachingReviewLinked: true },
  },
  {
    type: 'monthly-ksb-quiz',
    label: 'Monthly KSB Quiz',
    icon: 'ri-award-line',
    group: 'Monthly cycle',
    tone: 'violet',
    defaultOtjh: 2,
    defaultPoints: 20,
    reflectionDefault: false,
    workplaceEvidenceDefault: false,
    tutorValidationDefault: false,
    supportedSources: [],
    requiredSettings: [],
    capabilities: ['ksb-mapping', 'reflection', 'tutor-validation'],
    defaultSettings: { ...advancedDefaults('monthly-ksb-quiz'), buildMode: 'linked', linkedQuizId: '', linkedActivity: '', numberOfQuestions: 12, passMarkPercentage: 70, attemptsAllowed: 2, affectsKsbProgression: true, monthFocus: '' },
  },
  {
    type: 'coaching-preparation',
    label: 'Coaching Preparation',
    icon: 'ri-user-heart-line',
    group: 'Monthly cycle',
    tone: 'pink',
    defaultOtjh: 0.5,
    defaultPoints: 10,
    reflectionDefault: true,
    workplaceEvidenceDefault: false,
    tutorValidationDefault: true,
    supportedSources: [],
    requiredSettings: [],
    capabilities: ['ksb-mapping', 'reflection', 'evidence', 'tutor-validation'],
    defaultSettings: { ...advancedDefaults('coaching-preparation'), preparationPrompt: '', evidenceToBring: '', coachDiscussionPoints: '', coachingReviewLinked: true },
  },
];

export const componentAuthoringDefinitions = Object.freeze(definitions);
const hiddenComponentTypes = new Set<ModuleComponentType>([
  'assignment',
  'reflection',
  'checkpoint',
  'monthly-ksb-quiz',
  'coaching-preparation',
]);
export const componentTypes = componentAuthoringDefinitions
  .filter(({ type }) => !hiddenComponentTypes.has(type))
  .map(({ type, label, icon, group, tone }) => ({ type, label, icon, group, tone }));
export const componentTypeGroups = Array.from(new Set(componentTypes.map(item => item.group)));

export function getComponentDefinition(type: ModuleComponentType | string) {
  return componentAuthoringDefinitions.find(item => item.type === type) || componentAuthoringDefinitions.find(item => item.type === 'reading')!;
}

export function getDefaultComponentSettings(type: ModuleComponentType): ComponentSettings {
  return { ...getComponentDefinition(type).defaultSettings };
}

export function allowedSettingKeysForType(type: ModuleComponentType) {
  const definition = getComponentDefinition(type);
  return new Set([
    ...Object.keys(definition.defaultSettings),
    'legacySettings',
    'legacySourceType',
    'legacyUnsupportedSource',
    'shortcode',
  ]);
}

export function normaliseComponentSettings(type: ModuleComponentType, settings: ComponentSettings = {}): ComponentSettings {
  const defaults = getDefaultComponentSettings(type);
  const allowed = allowedSettingKeysForType(type);
  const next: ComponentSettings = { ...defaults };
  const legacySettings: Record<string, ComponentSettingValue> = {};
  Object.entries(settings).forEach(([key, value]) => {
    if (value === null || value === undefined) return;
    if (allowed.has(key)) {
      next[key] = value;
    } else if (['string', 'number', 'boolean'].includes(typeof value) || Array.isArray(value)) {
      legacySettings[key] = value as ComponentSettingValue;
    }
  });
  if (Object.keys(legacySettings).length) next.legacySettings = JSON.stringify(legacySettings);
  if (type === 'video' && (settings.sourceType === 'Shortcode' || settings.provider === 'Shortcode')) {
    next.legacySourceType = 'Shortcode';
    next.legacyUnsupportedSource = true;
  }
  return next;
}

export function normaliseVideoSourceType(value: string) {
  const clean = String(value || '').trim();
  if ((MEDIA_SOURCE_TYPES as readonly string[]).includes(clean)) return clean;
  if (clean === 'Upload file') return 'HTML (MP4)';
  if (clean === 'External link') return 'External Link';
  if (clean === 'Shortcode') return 'YouTube';
  return 'YouTube';
}

export function providerForVideoSourceType(sourceType: string) {
  if (sourceType === 'HTML (MP4)') return 'Upload file';
  if (sourceType === 'External Link') return 'External link';
  return sourceType;
}

export function defaultCompletionRule(type: ModuleComponentType) {
  return String(advancedDefaults(type).completionRule || 'Mark complete');
}

export function defaultEvidenceRequired(type: ModuleComponentType) {
  return String(advancedDefaults(type).evidenceRequired || '-');
}

export function defaultReflectionPrompt(type: ModuleComponentType) {
  if (type === 'quiz' || type === 'monthly-ksb-quiz' || type === 'checkpoint') return 'Which questions or topics do you need to revisit after this activity?';
  return 'What did you learn? How will you apply this at work? Which KSBs did this develop?';
}

export type ComponentValidationTarget = {
  title: string;
  type: ModuleComponentType;
  expectedOtjh: number;
  points: number;
  reflectionRequired: boolean;
  workplaceEvidenceRequired: boolean;
  settings: ComponentSettings;
};

export type ModuleValidationTarget = {
  title: string;
  weekStructure: Array<{
    title: string;
    components: ComponentValidationTarget[];
  }>;
};

export type ValidationIssue = { path: string; message: string };

export function validateComponentAuthoring(component: ComponentValidationTarget, pathPrefix = 'component'): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const settings = component.settings || {};
  const allowed = allowedSettingKeysForType(component.type);
  const status = String(settings.contentStatus || 'Draft');
  if (!String(component.title || '').trim()) issues.push({ path: `${pathPrefix}.title`, message: 'Component title is required.' });
  if (!Number.isFinite(Number(component.expectedOtjh)) || Number(component.expectedOtjh) < 0) issues.push({ path: `${pathPrefix}.expectedOtjh`, message: 'Expected OTJH cannot be negative.' });
  if (!Number.isFinite(Number(component.points)) || Number(component.points) < 0) issues.push({ path: `${pathPrefix}.points`, message: 'Points cannot be negative.' });
  if (!CONTENT_STATUSES.includes(status as typeof CONTENT_STATUSES[number])) issues.push({ path: `${pathPrefix}.settings.contentStatus`, message: 'Status must be Draft, Ready for QA, Needs changes, or Approved.' });
  if (!/^\d+(?:\.\d+){0,2}$/.test(String(settings.version || '0.1'))) issues.push({ path: `${pathPrefix}.settings.version`, message: 'Version must use numbers such as 0.1 or 1.2.0.' });
  if (component.reflectionRequired && !String(settings.reflectionPrompt || '').trim()) issues.push({ path: `${pathPrefix}.settings.reflectionPrompt`, message: 'Reflection prompt is required when reflection is enabled.' });
  if (component.workplaceEvidenceRequired && !String(settings.evidenceInstructions || settings.evidenceRequired || '').trim()) issues.push({ path: `${pathPrefix}.settings.evidenceInstructions`, message: 'Evidence instructions are required when workplace evidence is enabled.' });
  Object.keys(settings).forEach(key => {
    if (!allowed.has(key)) issues.push({ path: `${pathPrefix}.settings.${key}`, message: `Unsupported setting "${key}" for ${component.type}.` });
  });

  if (component.type === 'video') {
    const rawSourceType = String(settings.sourceType || settings.provider || 'YouTube');
    if (rawSourceType === 'Shortcode') {
      if (status !== 'Draft') {
        issues.push({
          path: `${pathPrefix}.settings.sourceType`,
          message: 'Legacy Shortcode sources are preserved but cannot be marked ready or approved in the new Module Builder.',
        });
      }
      return issues;
    }
    const sourceType = normaliseVideoSourceType(rawSourceType);
    const url = String(settings.videoUrl || '').trim();
    const progress = Number(settings.requiredProgressPercentage || 0);
    if (!Number.isFinite(progress) || progress < 0 || progress > 100) issues.push({ path: `${pathPrefix}.settings.requiredProgressPercentage`, message: 'Required progress must be between 0 and 100.' });
    if (url && sourceType === 'YouTube' && !isYouTubeUrl(url)) issues.push({ path: `${pathPrefix}.settings.videoUrl`, message: 'Enter a valid YouTube URL.' });
    if (url && sourceType === 'Vimeo' && !isVimeoUrl(url)) issues.push({ path: `${pathPrefix}.settings.videoUrl`, message: 'Enter a valid Vimeo URL.' });
    if (url && ['External Link', 'HTML (MP4)'].includes(sourceType) && !isHttpUrl(url)) issues.push({ path: `${pathPrefix}.settings.videoUrl`, message: 'Enter a valid URL.' });
    if (sourceType === 'Embed' && status !== 'Draft' && !String(settings.embedCode || '').trim()) issues.push({ path: `${pathPrefix}.settings.embedCode`, message: 'Embed content is required before QA or approval.' });
    if (sourceType !== 'Embed' && status !== 'Draft' && !url) issues.push({ path: `${pathPrefix}.settings.videoUrl`, message: 'Video URL is required before QA or approval.' });
  }

  if (component.type === 'recording-placeholder') {
    const url = String(settings.recordingUrl || '').trim();
    if (url && !isHttpUrl(url)) issues.push({ path: `${pathPrefix}.settings.recordingUrl`, message: 'Enter a valid recording URL.' });
    if (status !== 'Draft' && !url) issues.push({ path: `${pathPrefix}.settings.recordingUrl`, message: 'Recording URL is required before QA or approval.' });
  }

  if (component.type === 'podcast') {
    const url = String(settings.podcastUrl || '').trim();
    const progress = Number(settings.requiredProgressPercentage || 0);
    if (!Number.isFinite(progress) || progress < 0 || progress > 100) issues.push({ path: `${pathPrefix}.settings.requiredProgressPercentage`, message: 'Required progress must be between 0 and 100.' });
    if (url && !isResourceUrl(url)) issues.push({ path: `${pathPrefix}.settings.podcastUrl`, message: 'Enter a valid podcast URL.' });
  }

  if (component.type === 'reading') {
    const url = String(settings.resourceUrl || '').trim();
    if (url && !isHttpUrl(url)) issues.push({ path: `${pathPrefix}.settings.resourceUrl`, message: 'Enter a valid reading URL.' });
    const audioUrl = String(settings.audioUrl || '').trim();
    if (audioUrl && !isHttpUrl(audioUrl)) issues.push({ path: `${pathPrefix}.settings.audioUrl`, message: 'Enter a valid audio URL.' });
  }

  if (component.type === 'powerpoint') {
    const url = String(settings.presentationUrl || '').trim();
    if (url && !isResourceUrl(url)) issues.push({ path: `${pathPrefix}.settings.presentationUrl`, message: 'Enter a valid presentation URL.' });
  }

  return issues;
}

export function validateModuleAuthoringStructure(module: ModuleValidationTarget): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!String(module.title || '').trim()) issues.push({ path: 'module.title', message: 'Module title is required.' });
  module.weekStructure.forEach((week, weekIndex) => {
    if (!String(week.title || '').trim()) issues.push({ path: `weekStructure.${weekIndex}.title`, message: `Week ${weekIndex + 1} needs a title.` });
    week.components.forEach((component, componentIndex) => {
      issues.push(...validateComponentAuthoring(component, `weekStructure.${weekIndex}.components.${componentIndex}`));
    });
  });
  return issues;
}

export function firstValidationMessage(issues: ValidationIssue[]) {
  if (!issues.length) return '';
  const first = issues[0];
  const extra = issues.length > 1 ? ` (${issues.length - 1} more issue${issues.length === 2 ? '' : 's'}).` : '';
  return `${first.message}${extra}`;
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol);
  } catch {
    return false;
  }
}

function isResourceUrl(value: string) {
  const text = String(value || '').trim();
  return text.startsWith('/curriculum_api/curriculum/uploads/') || isHttpUrl(text);
}

function isYouTubeUrl(value: string) {
  if (!isHttpUrl(value)) return false;
  const host = new URL(value).hostname.replace(/^www\./, '').toLowerCase();
  return ['youtube.com', 'youtu.be', 'm.youtube.com'].includes(host) || host.endsWith('.youtube.com');
}

function isVimeoUrl(value: string) {
  if (!isHttpUrl(value)) return false;
  const host = new URL(value).hostname.replace(/^www\./, '').toLowerCase();
  return host === 'vimeo.com' || host.endsWith('.vimeo.com');
}
