import { AssignmentSubmissionForm } from './AssignmentSubmissionForm';
import type { ComponentProps } from 'react';
import { presentTopic, type AssignmentTopic } from '@/lib/assignmentTopics';
import { TopicAssignment } from './TopicAssignment';
import { parsePersonalLearning } from '@/lib/personalLearning';

export function AssignmentSubmissionWizard(props: ComponentProps<typeof AssignmentSubmissionForm> & { topics?: AssignmentTopic[] }) {
  if (props.topics?.length && !props.historicalReadOnly && !parsePersonalLearning(props.learnerId)) {
    return <TopicAssignment key={`${props.kind}:${props.learnerId}:${props.componentId}`} {...props} topics={props.topics} />;
  }
  const only = props.topics?.length === 1 ? presentTopic(props.topics[0]) : null;
  return <AssignmentSubmissionForm {...props} instructionsHtml={props.instructionsHtml ?? only?.instructions}
    resourceLinks={props.resourceLinks ?? only?.links} />;
}

export { AssignmentSubmissionForm } from './AssignmentSubmissionForm';
export type { AssignmentAnswers, AssignmentCompletion } from './AssignmentSubmissionForm';
