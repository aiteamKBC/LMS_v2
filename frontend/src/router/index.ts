import { Suspense, createElement, useEffect } from "react";
import { useLocation, useNavigate, useRoutes, type NavigateFunction } from "react-router-dom";
import { RouteErrorBoundary } from "@/components/feature/RouteErrorBoundary";
import { PageSkeleton } from "@/components/feature/Skeletons";
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

// Every route in config.tsx is lazy(), so this is what the whole site shows
// between a click and the page's chunk arriving. It used to be a pulsing dot
// beside the words "Loading workspace" — honest, but it threw the layout away
// and rebuilt it, which reads as a page flash on every navigation. PageSkeleton
// holds the shape instead: rail, breadcrumb, header, content.
function RouteLoadingFallback() {
  return createElement(PageSkeleton);
}

export function AppRoutes() {
  const element = useRoutes(routes);
  const navigate = useNavigate();
  const { pathname } = useLocation();

  useEffect(() => {
    window.REACT_APP_NAVIGATE = navigate;
    navigateResolver(window.REACT_APP_NAVIGATE);
  }, [navigate]);

  // Keyed by pathname so the boundary resets on navigation: a crashed page must
  // not survive a Back or a link click as a permanent error screen.
  return createElement(
    RouteErrorBoundary,
    { key: pathname },
    createElement(Suspense, { fallback: createElement(RouteLoadingFallback) }, element),
  );
}
