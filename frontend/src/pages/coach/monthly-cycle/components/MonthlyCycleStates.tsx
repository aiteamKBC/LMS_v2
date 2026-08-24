// ============================================================================
// Monthly Cycle — loading / error / empty states.
//
// Three of the page's four near-identical empty states lived here (no active
// learners, no learners matching the search, and the request-failed banner).
// All three are now `EmptyState`, which is also what gives them a consistent
// icon well and copy layout instead of three copies of the same div.
// ============================================================================
import { Panel } from '@/components/ui/Panel';
import { EmptyState, EmptyStateAction } from '@/components/ui/EmptyState';
import { RowsSkeleton } from '@/components/feature/Skeletons';

export function MonthlyCycleLoading() {
  return (
    <Panel>
      <RowsSkeleton rows={5} />
    </Panel>
  );
}

export function MonthlyCycleError({ message }: { message: string }) {
  return (
    <Panel>
      <EmptyState
        variant="error"
        title="Unable to load monthly activity"
        description={message}
      />
    </Panel>
  );
}

export function NoActiveLearners() {
  return (
    <Panel>
      <EmptyState
        variant="empty"
        icon="ri-user-search-line"
        title="No active learners found"
        description="There are no active learners assigned to this coach for the selected month."
      />
    </Panel>
  );
}

export function NoLearnerMatches({ monthLabel, onClear }: { monthLabel: string; onClear: () => void }) {
  return (
    <Panel>
      <EmptyState
        variant="no-matches"
        icon="ri-user-search-line"
        title="No learners match this search"
        description={`Try a different learner name for ${monthLabel}.`}
        action={<EmptyStateAction label="Clear search" icon="ri-close-circle-line" onClick={onClear} />}
      />
    </Panel>
  );
}
