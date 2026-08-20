import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';

// The route tree used to sit in a bare <Suspense>. One throw anywhere under it —
// a render bug, or a `lazy()` chunk that fails to fetch because the dev server
// restarted or a new build shipped mid-session — unmounted the entire app and
// left a blank white page: no message, nothing to click, and no way to tell the
// two causes apart without opening DevTools. This catches the throw instead.
//
// Nothing else in the project consumes React errors (there is no Sentry or
// equivalent wired up), so the console is still where the component stack goes.

const STALE_CHUNK = /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError/i;

interface RouteErrorBoundaryProps {
  // Optional so the boundary can be built with createElement(Component, props,
  // children) from `router/index.ts`, which passes children positionally.
  children?: ReactNode;
}

interface RouteErrorBoundaryState {
  error: Error | null;
}

export class RouteErrorBoundary extends Component<RouteErrorBoundaryProps, RouteErrorBoundaryState> {
  state: RouteErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): RouteErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled error while rendering a route', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children ?? null;

    // A missing chunk is not a bug in the page — the JS it was told to load is
    // simply no longer on the server. Reloading fixes it, so say so rather than
    // showing a stack the reader cannot act on.
    const staleChunk = STALE_CHUNK.test(error.message || '');

    return (
      <div className="flex min-h-screen items-center justify-center bg-background-200 px-6 py-10">
        <div className="w-full max-w-xl rounded-2xl border border-foreground-200 bg-background-50 p-6 shadow-sm">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-700">
              <AppIcon className={staleChunk ? 'ri-refresh-line text-lg' : 'ri-error-warning-line text-lg'}></AppIcon>
            </span>
            <div className="min-w-0">
              <h1 className="text-base font-heading font-bold text-foreground-950">
                {staleChunk ? 'This page needs reloading' : 'This page stopped working'}
              </h1>
              <p className="mt-1 text-[13px] text-foreground-600">
                {staleChunk
                  ? 'The app was updated while this tab was open, so part of it could no longer be downloaded. Reloading picks up the new version.'
                  : 'Something in this page threw an error, so it was stopped instead of being left half-rendered. Nothing you had saved is affected.'}
              </p>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary-600 px-4 text-[13px] font-bold text-white transition-smooth hover:bg-primary-700"
            >
              <AppIcon className="ri-refresh-line"></AppIcon>
              Reload the page
            </button>
            <button
              type="button"
              onClick={() => { window.location.href = '/'; }}
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-foreground-200 bg-background-100 px-4 text-[13px] font-bold text-foreground-700 transition-smooth hover:bg-background-200"
            >
              <AppIcon className="ri-home-4-line"></AppIcon>
              Back to the dashboard
            </button>
          </div>

          <details className="mt-5 rounded-xl border border-background-200 bg-background-100/60 p-3">
            <summary className="cursor-pointer text-[11px] font-bold uppercase tracking-wider text-foreground-500">
              Error detail
            </summary>
            <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-5 text-foreground-700">
              {error.message}
              {error.stack ? `\n\n${error.stack}` : ''}
            </pre>
          </details>
        </div>
      </div>
    );
  }
}
