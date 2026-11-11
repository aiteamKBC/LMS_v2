import { Notice } from '@/components/ui/Notice';

export function LearnerLoadError({ error, onRetry, title = 'Could not load your learning data', retryLabel = 'Try again' }: { error: string; onRetry?: () => void; title?: string; retryLabel?: string }) {
  // API error text may contain transport or server details. Keep the failure
  // visible without asking a learner to interpret those implementation details.
  const moduleMissing = error === 'Module not found in this learner plan.';
  const accessDenied = ['Access denied', 'Permission revoked', 'Not authorized'].includes(error);
  return <Notice tone="attention" role="alert" title={moduleMissing ? 'Module not found in your learning plan' : accessDenied ? 'You do not have access to this page' : title}
    actions={onRetry && <button type="button" onClick={onRetry} className="min-h-11 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300">{retryLabel}</button>}>
    {moduleMissing ? 'Return to My Learning to choose an available module, or ask your tutor for help.' : accessDenied ? 'If you need access, contact your tutor or the support team for help.' : 'Please try again. If this continues, contact your tutor or the support team for help.'}
  </Notice>;
}
