import { Suspense, lazy, type ComponentProps } from 'react';

import type {
  ComponentEditor as ComponentEditorType,
  WeekComponentRail as WeekComponentRailType,
  WeekOverviewPanel as WeekOverviewPanelType,
} from '@/pages/curriculum/week-builder/page';

// Lazy halves of the shared week-authoring UI, for consumers that only render it
// once the user drills into a week.
//
// The three components sit in week-builder/page.tsx alongside @dnd-kit, the
// RichTextEditor and that page's own ~159 kB of code. Module Builder needs them
// only behind `expanded` / `selectedComponent` conditions, so importing them
// statically made every Module Builder visit pay for the whole Week Builder page
// up front. Splitting here moves that weight to the first week expansion.
//
// The week builder itself keeps its direct, static imports: it is already inside
// that chunk, so a dynamic import there would cost a round-trip and save nothing.
const load = () => import('@/pages/curriculum/week-builder/page');

const LazyComponentEditor = lazy(() => load().then(m => ({ default: m.ComponentEditor })));
const LazyWeekComponentRail = lazy(() => load().then(m => ({ default: m.WeekComponentRail })));
const LazyWeekOverviewPanel = lazy(() => load().then(m => ({ default: m.WeekOverviewPanel })));

// Sized to the real components so expanding a week does not collapse the layout
// and then snap back when the chunk lands.
function PanelFallback({ height }: { height: number }) {
  return (
    <div
      style={{ minHeight: height }}
      className="animate-pulse rounded-xl border border-background-200 bg-background-100/60"
      role="status"
      aria-label="Loading week authoring tools"
    />
  );
}

export function ComponentEditor(props: ComponentProps<typeof ComponentEditorType>) {
  return (
    <Suspense fallback={<PanelFallback height={420} />}>
      <LazyComponentEditor {...props} />
    </Suspense>
  );
}

export function WeekComponentRail(props: ComponentProps<typeof WeekComponentRailType>) {
  return (
    <Suspense fallback={<PanelFallback height={180} />}>
      <LazyWeekComponentRail {...props} />
    </Suspense>
  );
}

export function WeekOverviewPanel(props: ComponentProps<typeof WeekOverviewPanelType>) {
  return (
    <Suspense fallback={<PanelFallback height={220} />}>
      <LazyWeekOverviewPanel {...props} />
    </Suspense>
  );
}
