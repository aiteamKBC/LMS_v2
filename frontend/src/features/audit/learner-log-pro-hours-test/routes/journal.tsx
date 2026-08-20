import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/journal")({
  validateSearch: (search: Record<string, unknown>) => ({
    learner: typeof search.learner === "string" ? search.learner : typeof search.learner === "number" ? String(search.learner) : "",
    period: typeof search.period === "string" ? search.period : "",
  }),
  component: () => <Outlet />,
});
