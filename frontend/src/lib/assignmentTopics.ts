export interface AssignmentTopicResource {
  fileName: string;
  url: string;
  size: number;
  contentType: string;
}

export interface AssignmentTopic {
  id: string;
  name: string;
  question: string;
  instructions: string;
  resources: AssignmentTopicResource[];
}

export const ASSIGNMENT_RESOURCE_ACCEPT = '.pdf,.doc,.docx,.txt,.rtf,.odt,.ppt,.pptx,.mp4,.webm,.mov,.m4v';

export function assignmentTopics(value: unknown): AssignmentTopic[] {
  let parsed = value;
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed); } catch { return []; }
  }
  if (!Array.isArray(parsed)) return [];
  return ['1', '2', '3'].map(id => {
    const source = parsed.find(item => item && String(item.id) === id);
    return { id, name: typeof source?.name === 'string' ? source.name : '',
      question: typeof source?.question === 'string' ? source.question : '',
      instructions: typeof source?.instructions === 'string' ? source.instructions : '',
      resources: Array.isArray(source?.resources) ? source.resources.filter((file: AssignmentTopicResource) =>
        file && typeof file.fileName === 'string' && safeAssignmentResourceUrl(file.url)) : [] };
  });
}

export function safeAssignmentResourceUrl(url: unknown): url is string {
  return typeof url === 'string' && (/^https?:\/\//i.test(url) || /^\/curriculum_api\/curriculum\/uploads\//.test(url));
}

export function topicLabel(topic: AssignmentTopic): string {
  return `Topic ${topic.id}${topic.name.trim() ? ` — ${topic.name.trim()}` : ''}`;
}

export function topicHasContent(topic: AssignmentTopic): boolean {
  return Boolean(topic.question.replace(/<[^>]*>/g, '').trim() || topic.resources.length);
}
