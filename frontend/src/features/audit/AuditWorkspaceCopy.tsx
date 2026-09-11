import { useMemo } from "react";
import { RouterProvider } from "@tanstack/react-router";
import { AuditWorkspaceShell } from './AuditWorkspaceShell';
import { getRouter } from "./learner-log-pro-copy/router";
import "./learner-log-pro-copy/embedded.css";

/** Independent copy of the Audit workspace for future customisation. */
export default function AuditWorkspaceCopy() {
  const router = useMemo(() => getRouter(), []);

  return (
    <AuditWorkspaceShell homePath="/workspace/auditor-copy" title="Automatic audit">
      <div className="learner-log-pro !min-h-full [&>.min-h-screen]:min-h-full">
        <RouterProvider router={router} />
      </div>
    </AuditWorkspaceShell>
  );
}
