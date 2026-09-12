import { EmptyState } from '@/components/ui/EmptyState';
import { Panel } from '@/components/ui/Panel';

export function LearnerLoadError({ error, onRetry }: { error: string; onRetry: () => void }) {
  return <Panel><div role="alert"><EmptyState variant="error" title="Could not load your learning data" description={error}
    action={<button type="button" onClick={onRetry} className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white">Try again</button>} />
  </div></Panel>;
}
