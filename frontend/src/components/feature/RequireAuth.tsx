import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { PageSkeleton } from '@/components/feature/Skeletons';
import { homeRouteFor, mayAccessRoute } from '@/lib/routeAccess';

/**
 * The router-level gate. Everything that is not explicitly public in
 * `router/config.tsx` renders below this, so a route is protected by default
 * and being reachable signed-out has to be a deliberate, listed decision.
 *
 * It asks two questions.
 *
 * **Is there a session.** It waits for `isInitialized` first: the session lives
 * in an HttpOnly cookie that JS cannot read, so on a page load we do not know
 * whether there is one until `/login_api/me/` answers, and redirecting before
 * that would bounce a signed-in user to /login on every refresh. Then it
 * requires `auth.account` — the server's record — not `isAuthenticated`.
 * `previewAs` sets `isAuthenticated: true` with `account: null` for the demo
 * launcher, and a gate that accepted that would be one any visitor could walk
 * through by clicking "explore this section". Cookie or nothing.
 *
 * **Is this account's kind of person meant to be here.** See `lib/routeAccess`.
 * Someone signed in but in the wrong area is sent to their own home rather than
 * shown an error: they have done nothing wrong, and the page they wanted does
 * not exist for them.
 *
 * This only decides what this browser renders. It is not the security boundary:
 * that is the API gate (`login/api_gate.py`), which applies the same role rules
 * to the request itself, whether or not a page was ever drawn.
 */
export function RequireAuth() {
  const { auth, isInitialized } = useAuth();
  const location = useLocation();

  // Session unresolved: hold the page's shape rather than flashing either the
  // login form or a console we may be about to take away.
  if (!isInitialized) return <PageSkeleton />;

  const account = auth.account;

  if (!account) {
    // `from` is what LoginPage reads to return here after signing in, so a
    // pasted deep link still lands where it was aimed — it just asks who you
    // are first. Search is kept; a bare pathname would drop the filters.
    return (
      <Navigate
        to="/login"
        state={{ from: `${location.pathname}${location.search}` }}
        replace
      />
    );
  }

  if (!mayAccessRoute(location.pathname, account)) {
    const home = homeRouteFor(account);
    // Guard against a home route the account is itself refused: that would be a
    // redirect loop, and a blank screen is a worse answer than a plain refusal.
    // It should be unreachable — every home in ACCESS_HOME_ROUTES is a route
    // its own role is admitted to — which is exactly why it is worth asserting.
    if (home !== location.pathname && mayAccessRoute(home, account)) {
      return <Navigate to={home} replace />;
    }
    return <NoAccess />;
  }

  return <Outlet />;
}

function NoAccess() {
  return (
    <div className="flex min-h-screen items-center justify-center p-8">
      <div className="max-w-md text-center">
        <h1 className="text-lg font-semibold text-foreground-900">
          This page is not available for your account
        </h1>
        <p className="mt-2 text-sm text-foreground-500">
          Ask an administrator if you think you should have access to it.
        </p>
      </div>
    </div>
  );
}
