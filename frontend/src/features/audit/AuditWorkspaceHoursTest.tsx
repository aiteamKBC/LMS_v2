import { useMemo } from "react";
import { RouterProvider } from "@tanstack/react-router";
import { getRouter } from "./learner-log-pro-hours-test/router";
import "./learner-log-pro-hours-test/embedded.css";

/** HOURS-TEST: a standalone copy of the Automatic audit workspace that reads
 * and writes the cloned Neon branch through /hours_test_api. Its code and its
 * data are both separate, so editing hours here never touches the live audit. */
export default function AuditWorkspaceHoursTest() {
  const router = useMemo(() => getRouter(), []);

  return (
    <div className="learner-log-pro-hours-test">
      <RouterProvider router={router} />
    </div>
  );
}
