import { createContext, type ReactNode } from 'react';
import type { SidebarNavItem } from './Sidebar';

/** Scoped navigation presentation; the shell and branding stay intact. */
export interface SidebarNavigationPresentation {
  className?: string;
  header?: ReactNode;
  expandedStorageKey: string;
  mapItems: (permittedItems: SidebarNavItem[]) => SidebarNavItem[];
  renderIcon?: (item: SidebarNavItem) => ReactNode;
}

export const SidebarNavigationContext = createContext<SidebarNavigationPresentation | null>(null);
