import type { SavedCoachingEvidence } from '@/api/coachingRecordings';

export default function CompletionNotice({ completion }: { completion: SavedCoachingEvidence['completion'] }) {
  if (!completion) return null;
  const messages = {
    'action-required': 'This session still needs completion in Aptem. Open Aptem and complete the required steps. Reminders stop after the updated status syncs.',
    completed: 'This session is completed in Aptem. Its saved AI report will appear here when Coaching Session makes it available.',
    'awaiting-signature': 'This session is awaiting signatures in Aptem. It is not being treated as a missing coach completion.',
    unverified: 'The Aptem completion status has not been verified for this occurrence. A missing AI report does not confirm that the session is incomplete.',
    unavailable: 'The saved Aptem completion status could not be checked. No completion decision can be confirmed here.',
    mixed: 'This meeting contains sessions with different Aptem completion states. Review each learner’s session in Aptem.',
  };
  return <div className="mb-3 rounded-lg border border-background-200 bg-background-50 p-3 text-xs text-foreground-700">
    <p className="font-semibold">Aptem completion</p><p className="mt-1 leading-relaxed">{messages[completion.state]}</p>
  </div>;
}
