// ============================================================================
// Central Programme -> Material config for the 3 inspection-demo accounts.
//
// The hierarchy these 3 accounts show is:
//   Demo account -> Programme -> Material -> Weeks/Components -> content
//
// A "material" is a curated, human-facing grouping of one or more authored
// curriculum modules (see curriculum.modules / ModuleAuthoringModule). Some
// materials are exactly one authored module; others (PCP's MSP/Scheduling,
// EVM/Portfolio and PPC/PMO) intentionally combine two, because the curriculum
// currently authors those as separate modules. This file is the ONLY place
// that maps a database module id to the material name shown in the UI —
// nothing else in the app should string-match a module/component title to
// decide which material it belongs to.
//
// Module ids below are pinned to the specific authored module chosen for each
// demo account (see backend/login/management/commands/
// seed_inspection_demo_learners.py, which assigns these same ids to each
// learner's training plan). If curriculum re-authors a material under a new
// module id, update both this file and that command together.
// ============================================================================

export interface DemoMaterialDef {
  /** Stable key for this material, used for grouping/lookup and as a React key. */
  key: string;
  /** Display name — matches the names given for the 3 demo accounts. */
  name: string;
  /** Display order within the programme. */
  order: number;
  /** Every authored module id (curriculum.modules.module_catalogue_id) that
   * counts as part of this material. More than one when the material merges
   * separately-authored content (e.g. "MSP / Scheduling Professional"). */
  moduleIds: string[];
}

export interface DemoProgrammeDef {
  /** The demo account's email — see learnerFlowAccess.ts. */
  email: string;
  /** Short account label (ME / MM / PCP). */
  accountLabel: string;
  /** Must match the curriculum programme name (EnrolmentUser.programme /
   * LearnerDetail.programme) closely enough for display; materials are
   * matched by module id, not by this name. */
  programmeName: string;
  materials: DemoMaterialDef[];
}

export const DEMO_PROGRAMMES: DemoProgrammeDef[] = [
  {
    email: 'learner-me@learner.local',
    accountLabel: 'ME',
    programmeName: 'Marketing Executive',
    materials: [
      { key: 'impact-planning', name: 'Impact Planning', order: 1, moduleIds: ['MOD-202608228DDFCB53074A'] },
      { key: 'social-media', name: 'Social Media', order: 2, moduleIds: ['MOD-2026082243BD5ED0A8EA'] },
      { key: 'marketing-technology', name: 'Marketing Technology', order: 3, moduleIds: ['MOD-2026082273BF1B44335F'] },
    ],
  },
  {
    email: 'learner-mm@learner.local',
    accountLabel: 'MM',
    programmeName: 'Marketing Manager',
    materials: [
      { key: 'strategy-planning', name: 'Strategy Planning', order: 1, moduleIds: ['MOD-202608223E23693425BC'] },
      { key: 'customer-journey', name: 'Customer Journey', order: 2, moduleIds: ['MOD-20260822222D7B9190AA'] },
      { key: 'commercial-intelligence', name: 'Commercial Intelligence', order: 3, moduleIds: ['MOD-20260822BFA56444DE10'] },
      { key: 'ai-in-marketing', name: 'AI in Marketing', order: 4, moduleIds: ['MOD-AI-IN-MARKETING-MM'] },
    ],
  },
  {
    email: 'learner-pcp@learner.local',
    accountLabel: 'PCP',
    programmeName: 'Project Controls Professional',
    materials: [
      { key: 'project-management-professional', name: 'Project Management Professional', order: 1, moduleIds: ['MOD-2026082245779A87FE0C'] },
      {
        key: 'msp-scheduling-professional',
        name: 'Managing Successful Programmes / Scheduling Professional',
        order: 2,
        moduleIds: ['MOD-20260822B2177D2C4599', 'MOD-202608223894BBCBCF5F'],
      },
      { key: 'risk-management', name: 'Risk Management', order: 3, moduleIds: ['MOD-202608227739EC14E0CC'] },
      {
        key: 'evm-portfolio-management',
        name: 'Earned Value Management / Portfolio Management',
        order: 4,
        moduleIds: ['MOD-202608226F0A69EDAD30', 'MOD-20260822007072C8A616'],
      },
      {
        key: 'ppc-pmo',
        name: 'Project Planning Control / Project Management Office',
        order: 5,
        moduleIds: ['MOD-2026082281333774FD28', 'MOD-20260822C8C4CF8F9D6F'],
      },
    ],
  },
];

/** The demo programme/material config for one account's email, or null when
 * the account isn't one of the 3 provisioned inspection-demo accounts. */
export function demoProgrammeFor(email: string | null | undefined): DemoProgrammeDef | null {
  const normalised = (email || '').trim().toLowerCase();
  if (!normalised) return null;
  return DEMO_PROGRAMMES.find((p) => p.email === normalised) || null;
}

/** The material a given authored module id belongs to, within one demo
 * account's programme, or null when the module isn't mapped (or the id is
 * missing — legacy/id-less plan rows fall outside this inspection layer). */
export function materialForModuleId(programme: DemoProgrammeDef, moduleId: string | null | undefined): DemoMaterialDef | null {
  if (!moduleId) return null;
  return programme.materials.find((m) => m.moduleIds.includes(moduleId)) || null;
}
