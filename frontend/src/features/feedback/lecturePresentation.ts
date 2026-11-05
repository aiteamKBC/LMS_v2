import type { FeedbackFormType, FeedbackSection } from '@/api/feedback';

// Bank sections are editor-only categories. A delivery contains its pinned
// questions; respondents should see them together, with the fixed text last.
export function lecturePresentationSections(formType: FeedbackFormType, sections: FeedbackSection[]): FeedbackSection[] {
  if (formType !== 'post_lecture' || !sections.some(section => section.questionsPerDelivery != null)) return sections;
  return [{
    title: 'Session feedback', icon: 'ri-star-line', description: '',
    questions: sections.flatMap(section => section.questions),
  }];
}
