import { useMemo } from "react";
import { RouterProvider } from "@tanstack/react-router";
import { getRouter } from "./learner-log-pro/router";
import "./learner-log-pro/embedded.css";

export default function AuditWorkspace() {
  const router = useMemo(() => getRouter(), []);

  return (
    <div className="learner-log-pro">
      <RouterProvider router={router} />
    </div>
  );
}
