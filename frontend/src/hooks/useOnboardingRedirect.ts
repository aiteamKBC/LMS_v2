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
/** Where an onboarding learner books their three enrolment reviews. */
export const ONBOARDING_REVIEWS_ROUTE = '/learner/onboarding/reviews';

export const ONBOARDING_NAV_ITEMS: SidebarNavItem[] = [
  { id: 'learner-onboarding', label: 'My Enrolment', icon: 'ri-file-user-line', href: ONBOARDING_ROUTE },
  { id: 'learner-onboarding-reviews', label: 'Reviews', icon: 'ri-calendar-check-line', href: ONBOARDING_REVIEWS_ROUTE },
];

/** Onboarding is signed off but delivery hasn't started — see the backend's
 *  promote_to_delivery_if_ready. */
export const DELIVERY_STATUS = 'Delivery';

/**
 * A learner at Delivery has finished enrolment but isn't being taught yet: no
 * training plan is running, so no evidence, attendance or progress exists to
 * show. They keep their overview, their submitted enrolment, and the compliance
 * paperwork — the Apprenticeship Agreement is waiting for their signature.
 */
export const DELIVERY_NAV_IDS = [
  'learner-overview',
  'learner-onboarding',
  'learner-compliance-documents',
];

export function isOnboardingStatus(programmeStatus?: string | null): boolean {
  return (programmeStatus || '').trim().toLowerCase() === ONBOARDING_STATUS.toLowerCase();
}

export function isDeliveryStatus(programmeStatus?: string | null): boolean {
  return (programmeStatus || '').trim().toLowerCase() === DELIVERY_STATUS.toLowerCase();
}

/**
 * The sidebar for a learner at the given programme status.
 *
 * Onboarding and Delivery are both pre-teaching states where most of the
 * workspace would render as empty shells, so each gets a reduced menu. Every
 * other status gets the full nav unchanged.
 */
export function navItemsForStatus(
  programmeStatus: string | null | undefined,
  fullNav: SidebarNavItem[],
): SidebarNavItem[] {
  if (isOnboardingStatus(programmeStatus)) return ONBOARDING_NAV_ITEMS;
  if (isDeliveryStatus(programmeStatus)) {
    // Filtered from the real nav, not re-declared, so labels/icons/hrefs stay
    // in one place and cannot drift.
    return DELIVERY_NAV_IDS.map((id) => fullNav.find((item) => item.id === id)).filter(
      (item): item is SidebarNavItem => Boolean(item),
    );
  }
  return fullNav;
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
