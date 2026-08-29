import { describe, expect, it } from 'vitest';

// Every Curriculum route is code-split via React.lazy. A lazy() specifier that no
// longer resolves — a moved page, a renamed folder — is invisible to tsc and to a
// production build; it only surfaces as a blank screen when a user navigates there.
// These tests actually execute the dynamic imports.
const CURRICULUM_ROUTE_IMPORTS: Record<string, () => Promise<unknown>> = {
  '/curriculum/programmes': () => import('@/pages/curriculum/programmes/page'),
  '/curriculum/programmes/:id': () => import('@/pages/curriculum/programme-detail/page'),
  '/curriculum/cohorts': () => import('@/pages/curriculum/cohorts/page'),
  '/curriculum/cohorts/:id': () => import('@/pages/curriculum/cohort-workspace/page'),
  '/curriculum/groups': () => import('@/pages/curriculum/groups/page'),
  '/curriculum/groups/:id': () => import('@/pages/curriculum/group-workspace/page'),
  '/curriculum/modules/:id': () => import('@/pages/curriculum/module-workspace/page'),
  '/curriculum/holidays': () => import('@/pages/curriculum/holidays/page'),
  '/curriculum/module-builder': () => import('@/pages/curriculum/module-builder/page'),
  '/curriculum/week-builder': () => import('@/pages/curriculum/week-builder/page'),
  '/curriculum/ksb-mapping': () => import('@/pages/curriculum/ksb-mapping/page'),
  '/curriculum/standards': () => import('@/pages/curriculum/standards/page'),
  '/curriculum/checkpoints': () => import('@/pages/curriculum/checkpoints/page'),
  '/curriculum/ksb-frameworks': () => import('@/pages/curriculum/ksb-frameworks/page'),
  '/curriculum/published': () => import('@/pages/curriculum/published/page'),
  '/curriculum/reports': () => import('@/pages/curriculum/reports/page'),
  '/curriculum/version-control': () => import('@/pages/curriculum/version-control/page'),
  '/curriculum/session-calendar': () => import('@/pages/curriculum/session-calendar/page'),
  '/curriculum/question-bank': () => import('@/pages/curriculum/question-bank/page'),
  '/curriculum/quiz-xml': () => import('@/pages/curriculum/quiz-xml/page'),
};

describe('curriculum route lazy imports', { timeout: 15000 }, () => {
  it.each(Object.keys(CURRICULUM_ROUTE_IMPORTS))('%s resolves to a component', async route => {
    const loaded = (await CURRICULUM_ROUTE_IMPORTS[route]()) as { default?: unknown };
    // lazy() requires a default export; a module that only has named exports renders
    // as an error boundary rather than the page.
    expect(loaded.default).toBeTypeOf('function');
  });

  it('lazily-loaded quiz panels resolve', async () => {
    const [editor, upload] = await Promise.all([
      import('@/pages/curriculum/quiz-xml/edit/QuizEditorPanel'),
      import('@/pages/curriculum/week-builder/GuidedQuizUpload'),
    ]);
    expect(editor.QuizEditorPanel).toBeTypeOf('function');
    expect(upload.GuidedQuizUpload).toBeTypeOf('function');
  });

  it('lazily-loaded curriculum hubs resolve', async () => {
    const hubs = await import('@/pages/curriculum/hubs/page');
    expect(hubs.CurriculumLibraryHub).toBeTypeOf('function');
    expect(hubs.CurriculumDeliveryHub).toBeTypeOf('function');
    expect(hubs.CurriculumQualityHub).toBeTypeOf('function');
  });
});
