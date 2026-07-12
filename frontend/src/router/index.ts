<<<<<<< HEAD
import { Suspense, createElement, useEffect } from "react";
import { useNavigate, useRoutes, type NavigateFunction } from "react-router-dom";
=======
import { useNavigate, type NavigateFunction } from "react-router-dom";
import { useRoutes } from "react-router-dom";
import { useEffect } from "react";
>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)
import routes from "./config";

let navigateResolver: (navigate: ReturnType<typeof useNavigate>) => void;

declare global {
  interface Window {
    REACT_APP_NAVIGATE: ReturnType<typeof useNavigate>;
  }
}

export const navigatePromise = new Promise<NavigateFunction>((resolve) => {
  navigateResolver = resolve;
});

<<<<<<< HEAD
function RouteLoadingFallback() {
  return createElement(
    "div",
    { className: "min-h-screen bg-background-200 flex items-center justify-center px-6" },
    createElement(
      "div",
      {
        className:
          "flex items-center gap-3 rounded-xl border border-foreground-200 bg-background-50 px-5 py-4 shadow-sm",
      },
      createElement("span", { className: "h-3 w-3 rounded-full bg-primary-500 animate-pulse" }),
      createElement("span", { className: "text-sm font-medium text-foreground-600" }, "Loading workspace..."),
    ),
  );
}

export function AppRoutes() {
  const element = useRoutes(routes);
  const navigate = useNavigate();

  useEffect(() => {
    window.REACT_APP_NAVIGATE = navigate;
    navigateResolver(window.REACT_APP_NAVIGATE);
  }, [navigate]);

  return createElement(Suspense, { fallback: createElement(RouteLoadingFallback) }, element);
=======
export function AppRoutes() {
  const element = useRoutes(routes);
  const navigate = useNavigate();
  useEffect(() => {
    window.REACT_APP_NAVIGATE = navigate;
    navigateResolver(window.REACT_APP_NAVIGATE);
  });
  return element;
>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)
}
