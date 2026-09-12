import { Suspense, createElement, useEffect } from "react";
import { useLocation, useNavigate, useRoutes, type NavigateFunction } from "react-router-dom";
import { RouteErrorBoundary } from "@/components/feature/RouteErrorBoundary";
import { PageSkeleton } from "@/components/feature/Skeletons";
import { useAuth } from "@/hooks/useAuth";
import routes from "./config";
import { installLearnerRoutePreloading } from './preload';
import { OldOtjhProvider } from '@/features/old-otjh/hooks';

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
  const { pathname } = useLocation();
  const learnerRoute = pathname === '/learner' || pathname.startsWith('/learner/') || pathname.startsWith('/workspace/learner');
  return createElement(PageSkeleton, { workspaceRole: learnerRoute ? 'learner' : undefined });
}

export function AppRoutes() {
  const element = useRoutes(routes);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { auth } = useAuth();
  useEffect(() => installLearnerRoutePreloading(routes), []);

  useEffect(() => {
    window.REACT_APP_NAVIGATE = navigate;
    navigateResolver(window.REACT_APP_NAVIGATE);
  }, [navigate]);

  // These provisioned learner accounts intentionally have a two-screen UI:
  // their material list and the content runner. Quiz and video URLs
  // are implementation details of the runner and remain available so time,
  // reflection and results continue to work. A copied/bookmarked URL to any
  // other learner page returns to Materials instead of exposing the normal
  // learner workspace.
  // Reset only the error on navigation. A pathname key remounted Suspense and
  // the access gate on every click, discarding the current page while its next
  // chunk loads and making navigation look like a fresh application startup.
  return createElement(OldOtjhProvider, {
    key: auth.account?.id ?? 'signed-out',
    children: createElement(RouteErrorBoundary, { resetKey: pathname },
      createElement(Suspense, { fallback: createElement(RouteLoadingFallback) }, element)),
  });
}
