import { useCallback, useEffect, useState } from 'react';
import { fetchCurriculumComponents, type CurriculumComponent } from '@/lib/curriculumApi';

type ComponentRow = Partial<CurriculumComponent> & { id: string };

export type CompleteComponentState<T extends ComponentRow> =
  | { status: 'ready'; component: T | undefined; error?: undefined; retry: () => void }
  | { status: 'loading'; component: undefined; error?: undefined; retry: () => void }
  | { status: 'error'; component: undefined; error: string; retry: () => void };

function clean(value: unknown) {
  return String(value ?? '').trim();
}

/**
 * The component with all of its settings.
 *
 * The programme page reads its component list without the authored long text
 * (`omitContent`; each trimmed row names what it lacks in `settingsOmitted`),
 * and the KSB placement preview is the one place that text is shown. So it is
 * fetched here -- the full rows of this component's module only -- when the
 * preview opens. A row that was never trimmed is returned as it is, with no
 * request. Until the full row lands the status is `loading`; if it fails, or
 * the component is no longer in its module, the status is `error` with the
 * reason. A trimmed row is never handed back as if it were complete, so the
 * preview can never read "no content authored" off missing data.
 */
export function useCompleteComponent<T extends ComponentRow>(component: T | undefined): CompleteComponentState<T> {
  const [state, setState] = useState<{
    key: string;
    status: 'loading' | 'ready' | 'error';
    component?: T;
    error?: string;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const trimmed = Boolean(component?.settingsOmitted?.length);
  const moduleId = clean(component?.moduleCatalogueId || component?.moduleId);
  const componentId = clean(component?.id);
  const key = component && trimmed ? `${moduleId}|${componentId}|${attempt}` : '';

  useEffect(() => {
    if (!key || !component) return undefined;
    if (!moduleId) {
      setState({ key, status: 'error', error: 'This component has no module to load its content from.' });
      return undefined;
    }
    const controller = new AbortController();
    setState({ key, status: 'loading' });
    fetchCurriculumComponents(controller.signal, { moduleCatalogueIds: [moduleId] })
      .then(rows => {
        if (controller.signal.aborted) return;
        const full = rows.find(row => clean(row.id) === componentId);
        if (!full || full.settingsOmitted?.length) {
          setState({ key, status: 'error', error: 'This component is no longer in its module. Open the module to check.' });
          return;
        }
        const { settingsOmitted: _omitted, ...rest } = component;
        setState({ key, status: 'ready', component: { ...rest, ...full } as T });
      })
      .catch(error => {
        if (controller.signal.aborted) return;
        setState({ key, status: 'error', error: error instanceof Error ? error.message : 'The content could not be loaded.' });
      });
    return () => controller.abort();
    // `component` is read through `key`, which names everything that decides
    // the request; a new object for the same row must not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const retry = useCallback(() => setAttempt(value => value + 1), []);
  if (!component || !trimmed) return { status: 'ready', component, retry };
  if (!state || state.key !== key || state.status === 'loading') return { status: 'loading', component: undefined, retry };
  if (state.status === 'error') return { status: 'error', component: undefined, error: state.error || 'The content could not be loaded.', retry };
  return { status: 'ready', component: state.component, retry };
}
