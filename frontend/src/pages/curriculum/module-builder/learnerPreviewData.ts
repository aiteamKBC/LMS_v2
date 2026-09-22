import type { JourneyComponent } from '@/utils/learnerJourney';
import { embeddedSrc } from '@/components/feature/VideoPlayer';
import type { ModuleComponent } from './moduleAuthoringData';

export function previewComponent(component: ModuleComponent): JourneyComponent {
  const setting = (key: string) => String(component.settings[key] ?? '');
  // An Embed source holds the provider's whole <iframe> snippet. The learner API
  // serves a plain address here (learner_detail._video_url_from_settings), so the
  // preview has to unwrap it too — the raw markup is not a URL and resolved as a
  // relative route, showing the learner a 404 where the video belongs.
  const embed = embeddedSrc(setting('embedCode'));
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
    videoUrl: setting('videoUrl') || uploaded || embed, audioUrl: audio,
    contentHtml: setting('readingContent'), hasReadingContent: Boolean(setting('readingContent')),
    resourceUrl: resource,
    fileName: setting('fileName') || setting('uploadedFileName') || setting('assignmentFileName'),
    assignmentBrief: setting('assignmentBrief') || (!assignmentHtml ? assignmentContent : ''), assignmentBriefHtml: assignmentHtml,
    downloadAllowed: Boolean(component.settings.downloadAllowed),
    reflectionPrompt: setting('reflectionPrompt') || setting('podcastReflectionQuestion') || setting('readingReflectionPrompts') || component.description,
    reflectionRequired: component.reflectionRequired, reflectionQuestion: component.reflectionQuestion,
    liveSessionUrl: setting('teamsJoinUrl') || setting('liveSessionUrl'), sessionDate: setting('sessionDate'),
    teamsLiveSessionId: setting('teamsLiveSessionId') || null,
    teamsSessionNumber: Number.isInteger(Number(setting('teamsSessionNumber'))) && Number(setting('teamsSessionNumber')) > 0
      ? Number(setting('teamsSessionNumber')) : null,
    sessionTime: setting('sessionTime'), sessionDateTimeUtc: setting('sessionDateTimeUtc'),
    durationMinutes: Number(setting('durationMinutes')) || null };
}
