import { Link as TanStackLink, useNavigate, type AnyRouter } from '@tanstack/react-router';
import type { ComponentType, ComponentProps } from 'react';

// These are four independent embedded routers, not the host application's
// global RegisteredRouter. Model their shared URL boundary explicitly: the
// host currently disables strictNullChecks, which makes TanStack's inferred
// search/params types resolve to never. Runtime navigation remains TanStack's.
export type AuditPath = '/' | '/search' | '/activity' | '/journal' | '/journal/'
  | '/doc' | '/evidence' | '/ledger' | '/learner/$learnerId' | '/learners' | '/learners/$planId';
export type AuditSearch = Record<string, string | number | boolean | undefined>;
type UrlValue<T> = T | ((previous: T) => T);
export type AuditNavigation = {
  to: AuditPath;
  search?: UrlValue<AuditSearch>;
  params?: UrlValue<Record<string, string>>;
  replace?: boolean;
};
export const AuditLink = TanStackLink as unknown as ComponentType<
  Omit<ComponentProps<'a'>, 'href'> & AuditNavigation
>;

export function navigateAudit(router: AnyRouter, options: AuditNavigation): Promise<void> {
  const navigate = router.navigate as (options: AuditNavigation) => Promise<void>;
  return navigate(options);
}

export function useAuditNavigate() {
  return useNavigate() as (options: AuditNavigation) => Promise<void>;
}
