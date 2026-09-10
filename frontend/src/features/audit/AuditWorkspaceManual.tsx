import { useMemo } from "react";
import { RouterProvider } from "@tanstack/react-router";
import { AuditWorkspaceShell } from './AuditWorkspaceShell';
import { getRouter } from "./learner-log-pro-manual/router";
import "./learner-log-pro-manual/embedded.css";

/** MANUAL audit workspace — independent frontend/backend/schema from the
 * automatic audit workspace, so changes to one never affect the other. */
export default function AuditWorkspaceManual() {
  const router = useMemo(() => getRouter(), []);

  return (
    <AuditWorkspaceShell homePath="/workspace/auditor-manual" title="Manual audit">
      <div className="learner-log-pro !min-h-full [&>.min-h-screen]:min-h-full">
        <RouterProvider router={router} />
      </div>
    </AuditWorkspaceShell>
  );
}
