import type { ModuleCatalogueItem } from '@/pages/curriculum/module-builder/moduleAuthoringData';


export type ModuleBuilderListItem = ModuleCatalogueItem & {
  deliveryUsages?: ModuleDeliveryUsage[];
};


export type ModuleDeliveryUsage = {
  id: string;
  moduleId: string;
  /**
   * The identity the per-module endpoints answer to, resolved exactly the way
   * the entity pages resolve it. `moduleId` above keeps its own legacy order and
   * is used for matching, so the two are deliberately separate.
   */
  deliveryModuleId: string;
  sourceId: string;
  catalogueId: string;
  structureId: string;
  programmeId: string;
  programme: string;
  moduleTitle: string;
  cohortId?: string;
  cohort: string;
  groupId?: string;
  group: string;
  tutor: string;
  deliveryStatus: string;
  startDate?: string;
  endDate?: string;
  sessions: number;
  weekDays?: string;
  startTime?: string;
  endTime?: string;
};
