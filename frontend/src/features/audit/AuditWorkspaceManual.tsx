import { useMemo } from "react";
import { RouterProvider } from "@tanstack/react-router";
import { getRouter } from "./learner-log-pro-manual/router";
import "./learner-log-pro-manual/embedded.css";

/** MANUAL audit workspace — independent frontend/backend/schema from the
 * automatic audit workspace, so changes to one never affect the other. */
export default function AuditWorkspaceManual() {
  const router = useMemo(() => getRouter(), []);

  return (
    <div className="learner-log-pro">
      <RouterProvider router={router} />
    </div>
  );
}
