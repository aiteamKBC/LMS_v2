// @ts-nocheck -- imported TanStack Router app uses strictNullChecks; the host LMS does not.
import { QueryClient } from "@tanstack/react-query";
import { createHashHistory, createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient();

  // Hash history (not memory) so the browser Back/Forward buttons navigate
  // WITHIN this embedded app — e.g. stepping back out of an activity drill-down
  // — instead of exiting the whole /workspace/auditor-hours-test page. The route lives
  // in the URL hash (…/auditor-hours-test#/activity?…), which the host react-router
  // ignores for path matching, so the two routers don't fight. An empty hash
  // lands on "/", which redirects to "/search".
  const router = createRouter({
    routeTree,
    history: createHashHistory(),
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
