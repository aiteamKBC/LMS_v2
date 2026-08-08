import { useMemo } from "react";
import { RouterProvider } from "@tanstack/react-router";
import { getRouter } from "./learner-log-pro-copy/router";
import "./learner-log-pro-copy/embedded.css";

/** Independent copy of the Audit workspace for future customisation. */
export default function AuditWorkspaceCopy() {
  const router = useMemo(() => getRouter(), []);

  return (
    <div className="learner-log-pro">
      <RouterProvider router={router} />
    </div>
  );
}
