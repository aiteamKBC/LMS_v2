import { QueryClient } from "@tanstack/react-query";
import { createMemoryHistory, createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient();

  // @ts-expect-error TanStack requires strictNullChecks; the host application has it disabled.
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/search"] }),
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
