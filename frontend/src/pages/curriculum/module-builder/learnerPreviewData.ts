import type { JourneyComponent } from '@/utils/learnerJourney';
import type { ModuleComponent } from './moduleAuthoringData';

export function previewComponent(component: ModuleComponent): JourneyComponent {
  const setting = (key: string) => String(component.settings[key] ?? '');
  const uploaded = setting('uploadedFileUrl');
  const uploadChosen = /upload/i.test(setting('powerpointSource') || setting('uploadSource'));
  const resourceKeys = uploadChosen ? ['uploadedFileUrl', 'fileUrl', 'resourceUrl', 'presentationUrl', 'externalUrl', 'url']
    : ['resourceUrl', 'presentationUrl', 'externalUrl', 'fileUrl', 'uploadedFileUrl', 'url'];
  const resource = resourceKeys.map(setting).find(Boolean) || setting('assignmentFileUrl') || setting('readingUrl');
  const assignmentContent = setting('assignmentContent');
  const assignmentHtml = /<[a-z][^>]*>/i.test(assignmentContent) ? assignmentContent : '';
  const audio = setting('podcastUrl') || setting('audioUrl') || ((component.type === 'podcast' || /\.(mp3|wav|m4a|ogg|aac|flac)(?:[?#]|$)/i.test(uploaded)) ? uploaded : '');
  return { title: component.title, componentId: component.id, type: component.type.replace(/-/g, '_'),
    expectedOtjh: component.expectedOtjh, description: component.description,
    videoUrl: setting('videoUrl') || uploaded || setting('embedCode'), audioUrl: audio,
    contentHtml: setting('readingContent'), hasReadingContent: Boolean(setting('readingContent')),
    resourceUrl: resource,
    fileName: setting('fileName') || setting('uploadedFileName') || setting('assignmentFileName'),
    assignmentBrief: setting('assignmentBrief') || (!assignmentHtml ? assignmentContent : ''), assignmentBriefHtml: assignmentHtml,
    downloadAllowed: Boolean(component.settings.downloadAllowed),
    reflectionPrompt: setting('reflectionPrompt') || setting('podcastReflectionQuestion') || setting('readingReflectionPrompts') || component.description,
    reflectionRequired: component.reflectionRequired, reflectionQuestion: component.reflectionQuestion,
    liveSessionUrl: setting('teamsJoinUrl') || setting('liveSessionUrl'), sessionDate: setting('sessionDate'),
    sessionTime: setting('sessionTime'), sessionDateTimeUtc: setting('sessionDateTimeUtc'),
    durationMinutes: Number(setting('durationMinutes')) || null };
}
