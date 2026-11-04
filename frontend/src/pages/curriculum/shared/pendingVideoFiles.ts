import { createContext, useCallback, useEffect, useRef, useState } from 'react';
import { coachFetch } from '@/lib/coachFetch';
import { COMPONENT_UPLOAD_TIMEOUT_MS } from './componentUploadPolicy';

export type VideoSettingsPatch = Record<string, string | number | boolean>;
type VideoComponent = { id: string; type: string; title: string; settings: Record<string, unknown> };
type PendingFile = { file: File; source: string; uploading?: boolean; error?: string };
export const videoComponentSource = (component: VideoComponent) => String(component.settings.videoUrl || component.settings.embedCode || '');
export function withUploadedVideo<T extends VideoComponent>(component: T, id: string, settings: VideoSettingsPatch, originalSource: string): T {
  return component.id === id && component.type === 'video' && videoComponentSource(component) === originalSource
    ? { ...component, settings: { ...component.settings, ...settings } } : component;
}

/** Files stay in the open editor, never in JSON, localStorage or an unrelated module. */
export function usePendingVideoFiles(scopeKey: string) {
  const [files, setFiles] = useState<Record<string, PendingFile>>({});
  const current = useRef(files);
  const scope = useRef(scopeKey);
  scope.current = scopeKey;
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const replace = useCallback((next: Record<string, PendingFile>) => {
    current.current = next;
    setFiles(next);
  }, []);
  const clear = useCallback(() => {
    generation.current += 1;
    controller.current?.abort();
    replace({});
  }, [replace]);
  useEffect(() => {
    clear();
    return () => { generation.current += 1; controller.current?.abort(); };
  }, [scopeKey, clear]);
  const remove = useCallback((id: string) => {
    const next = { ...current.current };
    delete next[id];
    replace(next);
  }, [replace]);
  const select = useCallback((id: string, file: File, source: string) => {
    replace({ ...current.current, [id]: { file, source } });
  }, [replace]);
  const uploadSaved = useCallback(async (
    kind: 'module' | 'template', targetId: string, components: VideoComponent[],
    onStored: (id: string, settings: VideoSettingsPatch, originalSource: string) => void,
  ) => {
    if (controller.current) throw new Error('An MP4 upload is already in progress.');
    const originalScope = scope.current;
    const originalGeneration = generation.current;
    for (const [id, pending] of Object.entries(current.current)) {
      const component = components.find(item => item.id === id && item.type === 'video');
      // A deleted component or a subsequently chosen link must not receive this file.
      if (!component || videoComponentSource(component) !== pending.source) { remove(id); continue; }
      const abort = new AbortController();
      controller.current = abort;
      const timer = setTimeout(() => abort.abort(), COMPONENT_UPLOAD_TIMEOUT_MS);
      replace({ ...current.current, [id]: { ...pending, uploading: true, error: '' } });
      try {
        const body = new FormData();
        body.set('file', pending.file);
        body.set('title', component.title);
        const response = await coachFetch(`/curriculum_api/curriculum/videos/${kind}/${encodeURIComponent(targetId)}/${encodeURIComponent(id)}/`, {
          method: 'POST', body, signal: abort.signal,
        });
        const data = await response.json() as { error?: string; savedSettings?: VideoSettingsPatch };
        if (scope.current !== originalScope || generation.current !== originalGeneration || abort.signal.aborted) throw new Error('The MP4 upload was interrupted. Save again to retry.');
        if (!response.ok || !data.savedSettings) throw new Error(data.error || 'The MP4 could not be saved. Save again to retry.');
        onStored(id, data.savedSettings, pending.source);
        remove(id);
      } catch (cause) {
        if (scope.current === originalScope && generation.current === originalGeneration) {
          const error = cause instanceof Error ? cause.message : 'The MP4 could not be saved. Save again to retry.';
          replace({ ...current.current, [id]: { ...pending, uploading: false, error } });
        }
        throw new Error('The component was saved, but its MP4 upload did not finish. Save again to retry.');
      } finally { clearTimeout(timer); if (controller.current === abort) controller.current = null; }
    }
  }, [remove, replace]);
  return { files, select, remove, clear, uploadSaved, hasPending: Object.keys(files).length > 0 };
}

export const PendingVideoFilesContext = createContext<ReturnType<typeof usePendingVideoFiles> | null>(null);
