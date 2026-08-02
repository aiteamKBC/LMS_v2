import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { SidebarNavItem } from '@/components/feature/Sidebar';

/** Programme status that means "the learner is still filling in their enrolment". */
export const ONBOARDING_STATUS = 'Onboarding';

/** Where an onboarding learner is sent. */
export const ONBOARDING_ROUTE = '/learner/onboarding';

/**
 * The only nav an onboarding learner gets. Every other learner page (training
 * plan, evidence, attendance, clubs…) depends on an enrolled learner with a
 * training plan, so showing them mid-enrolment offers links that lead nowhere.
 */
export const ONBOARDING_NAV_ITEMS: SidebarNavItem[] = [
  { id: 'learner-onboarding', label: 'My Enrolment', icon: 'ri-file-user-line', href: ONBOARDING_ROUTE },
];

export function isOnboardingStatus(programmeStatus?: string | null): boolean {
  return (programmeStatus || '').trim().toLowerCase() === ONBOARDING_STATUS.toLowerCase();
}

/**
 * Send a learner whose programme status is 'Onboarding' to their own enrolment
 * wizard instead of the page they asked for.
 *
 * Until enrolment is done there is no training plan, progress or attendance to
 * show, so the normal learner pages would render as empty shells — the wizard is
 * the only thing they can act on. Staff moving the learner off 'Onboarding'
 * restores normal navigation with no further change.
 *
 * Pass `enabled: false` while the learner record is still loading, so an
 * undefined status is never mistaken for "not onboarding".
 */
export function useOnboardingRedirect(programmeStatus: string | undefined, enabled = true): boolean {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const shouldRedirect = enabled && isOnboardingStatus(programmeStatus);

  useEffect(() => {
    // Never redirect away from the onboarding route itself, or the wizard could
    // not be displayed at all.
    if (shouldRedirect && !pathname.startsWith(ONBOARDING_ROUTE)) {
      // `replace` so Back doesn't bounce between the two pages.
      navigate(ONBOARDING_ROUTE, { replace: true });
    }
  }, [shouldRedirect, pathname, navigate]);

  return shouldRedirect;
}
