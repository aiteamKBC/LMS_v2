import { Suspense, createElement, useEffect, useLayoutEffect } from "react";
import { useLocation, useNavigate, useRoutes, type NavigateFunction } from "react-router-dom";
import { RouteErrorBoundary } from "@/components/feature/RouteErrorBoundary";
import { RouteLoadingSkeleton } from "@/components/feature/RouteLoadingSkeleton";
import { useAuth } from "@/hooks/useAuth";
import routes from "./config";
import { installCurriculumRoutePreloading, installLearnerRoutePreloading } from './preload';
import { recordPageView } from '@/lib/activityTrail';
import { installActivityCapture } from '@/lib/activityCapture';
import { recordPerformanceNavigation } from '@/lib/performanceDiagnostics';
import { OldOtjhProvider } from '@/features/old-otjh/hooks';
import { KeepAliveSlot, useKeptLocation } from './keepAlive';

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
// and rebuilt it, which reads as a page flash on every navigation.
// RouteLoadingSkeleton preserves the shell for the destination route.
function RouteLoadingFallback() {
  return createElement(RouteLoadingSkeleton);
}

export function AppRoutes() {
  const location = useLocation();
  // A learner preview opened from an authoring page renders over it. The
  // opener stays mounted and hidden, so returning resumes it instead of
  // re-initialising it. The kept slot always takes an explicit location so
  // its tree does not change shape when a preview starts or ends.
  const kept = useKeptLocation(location);
  const element = useRoutes(routes, kept ?? location);
  const preview = useRoutes(routes, location);
  const navigate = useNavigate();
  const { pathname } = location;
  const { auth } = useAuth();
  useEffect(() => installLearnerRoutePreloading(routes), []);
  useEffect(() => installCurriculumRoutePreloading(routes), []);

  useEffect(() => {
    window.REACT_APP_NAVIGATE = navigate;
    navigateResolver(window.REACT_APP_NAVIGATE);
  }, [navigate]);

  // The LMS records who opened which page, for the Audit Trail's People view.
  // Mounted here rather than in WorkspaceShell because this is the one place
  // every route passes through, so a page that renders its own chrome is not
  // quietly missing from the trail. The recorder skips the signed-out pages and
  // the learner content runner, and swallows its own failures, so no navigation
  // can fail because of it.
  // Start the navigation clock before descendant passive effects issue their
  // page APIs. A normal effect here can run after a page's own data effect and
  // silently under-count the initial requests we are trying to measure.
  useLayoutEffect(() => {
    recordPerformanceNavigation(pathname);
  }, [pathname]);

  useEffect(() => {
    recordPageView(pathname);
  }, [pathname]);

  // What was done on those pages -- searched, filtered, exported. One delegated
  // listener for the whole LMS rather than a call in each workspace, so a page
  // is covered by existing rather than by being remembered. Toolkits that
  // report themselves are marked `data-audit="manual"` and skipped here.
  useEffect(() => installActivityCapture(), []);

  // These provisioned learner accounts intentionally have a two-screen UI:
  // their material list and the content runner. Quiz and video URLs
  // are implementation details of the runner and remain available so time,
  // reflection and results continue to work. A copied/bookmarked URL to any
  // other learner page returns to Materials instead of exposing the normal
  // learner workspace.
  // Reset only the error on navigation. A pathname key remounted Suspense and
  // the access gate on every click, discarding the current page while its next
  // chunk loads and making navigation look like a fresh application startup.
  // The preview has its own boundaries: its chunk loading or failing must not
  // suspend or tear down the page kept underneath it.
  return createElement(OldOtjhProvider, {
    key: auth.account?.id ?? 'signed-out',
    children: [
      createElement(RouteErrorBoundary, { key: 'page', resetKey: kept ? kept.pathname : pathname },
        createElement(Suspense, { fallback: createElement(RouteLoadingFallback) },
          createElement(KeepAliveSlot, { hidden: !!kept }, element))),
      kept ? createElement(RouteErrorBoundary, { key: 'preview', resetKey: pathname },
        createElement(Suspense, { fallback: createElement(RouteLoadingFallback) }, preview)) : null,
    ],
  });
}
