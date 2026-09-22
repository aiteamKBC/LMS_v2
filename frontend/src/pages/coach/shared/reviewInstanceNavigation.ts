export interface ReviewInstanceRouteEvent {
  learner?: string | null;
  programme?: string | null;
}

export interface ReviewInstanceRouteState {
  event: ReviewInstanceRouteEvent;
  returnTo: string;
}

export function reviewInstancePath(instanceId: string) {
  return `/coach/review-instances/${encodeURIComponent(instanceId)}`;
}

export function reviewInstanceRouteState(event: ReviewInstanceRouteEvent, returnTo: string): ReviewInstanceRouteState {
  return {
    event: { learner: event.learner || null, programme: event.programme || null },
    returnTo,
  };
}
