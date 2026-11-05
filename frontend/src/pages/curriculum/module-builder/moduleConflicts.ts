/**
 * The disagreements a Module Builder save has to settle before it goes.
 *
 * Two people changed the same field, or one deleted what the other was
 * changing. Neither version is written over the other until the author picks:
 * "keep mine" leaves their copy as it is (the next save sends it, now as a
 * decision); "use theirs" puts the other editor's version into the workspace.
 * Everything else the other editor saved has already been merged in.
 */
import type { MergeCollision } from '@/lib/collaborativeMerge';
import { conflictQuestion } from '@/pages/curriculum/shared/entities/mergeModuleStructure';
import {
  recalculateModule,
  type ModuleCatalogueItem,
  type ModuleSaveConflict,
} from './moduleAuthoringData';

export interface ModuleConflict {
  /** Stable for one disagreement, so a re-merge does not duplicate it. */
  key: string;
  path: string;
  kind: NonNullable<MergeCollision['kind']>;
  /** What this author has (kept on screen until they choose). */
  local: unknown;
  /** What the other editor saved, when it is known. */
  remote: unknown;
  /** The week or component id the disagreement is about. */
  itemId: string;
  question: string;
}

type Dict = Record<string, unknown>;

interface PathStep {
  key: string;
  id?: string;
}

function parsePath(path: string): PathStep[] {
  return path.split('.').filter(Boolean).map(token => {
    const match = /^([^[]+)(?:\[([^\]]*)\])?$/.exec(token);
    return match ? { key: match[1], id: match[2] } : { key: token };
  });
}

function lastId(path: string): string {
  const ids = [...path.matchAll(/\[([^\]]*)\]/g)].map(match => match[1]).filter(Boolean);
  return ids[ids.length - 1] || '';
}

export function conflictsFromCollisions(module: ModuleCatalogueItem, collisions: MergeCollision[]): ModuleConflict[] {
  return collisions.map(collision => {
    const kind = collision.kind || 'value';
    return {
      key: `${kind}:${collision.path}`,
      path: collision.path,
      kind,
      local: collision.local,
      remote: collision.remote,
      itemId: lastId(collision.path),
      question: conflictQuestion(module, { ...collision, kind }),
    };
  });
}

/** The server's own findings, for when the browser's merge found nothing to ask. */
export function conflictsFromServer(module: ModuleCatalogueItem, conflicts: ModuleSaveConflict[]): ModuleConflict[] {
  return conflictsFromCollisions(module, conflicts.map(conflict => ({
    path: conflict.path,
    kind: conflict.kind,
    local: conflict.local,
    remote: conflict.remote,
  })));
}

/** One conflict per key: the newest finding wins, nothing is listed twice. */
export function mergeConflictLists(current: ModuleConflict[], incoming: ModuleConflict[]): ModuleConflict[] {
  const byKey = new Map(current.map(item => [item.key, item]));
  incoming.forEach(item => byKey.set(item.key, item));
  return [...byKey.values()];
}

function updateAt(value: unknown, steps: PathStep[], update: (current: unknown) => unknown): unknown {
  if (!steps.length) return update(value);
  const [step, ...rest] = steps;
  const container = (value && typeof value === 'object' && !Array.isArray(value)) ? value as Dict : {};
  const child = container[step.key];
  if (step.id === undefined) {
    return { ...container, [step.key]: updateAt(child, rest, update) };
  }
  const list = Array.isArray(child) ? child as Dict[] : [];
  if (!rest.length) {
    // The step names an entry itself: the update decides the whole list.
    return { ...container, [step.key]: update(list) };
  }
  return {
    ...container,
    [step.key]: list.map(entry => (String(entry?.id) === step.id ? updateAt(entry, rest, update) as Dict : entry)),
  };
}

function reorderTo(list: Dict[], remoteOrder: string[]): Dict[] {
  const wanted = new Set(remoteOrder);
  const shared = remoteOrder
    .map(id => list.find(entry => String(entry.id) === id))
    .filter((entry): entry is Dict => Boolean(entry));
  const result = [...shared];
  list.forEach((entry, index) => {
    if (wanted.has(String(entry.id))) return;
    const anchor = index > 0 ? String(list[index - 1].id) : '';
    const at = anchor ? result.findIndex(item => String(item.id) === anchor) : -1;
    result.splice(at + 1, 0, entry);
  });
  return result;
}

/** The workspace with the other editor's version of one disagreement put in. */
export function applyTheirs(module: ModuleCatalogueItem, conflict: ModuleConflict): ModuleCatalogueItem {
  const steps = parsePath(conflict.path);
  if (!steps.length) return module;
  const id = conflict.itemId;
  let next: unknown = module;
  if (conflict.kind === 'value') {
    next = updateAt(module, steps, () => conflict.remote);
  } else if (conflict.kind === 'remote-deleted') {
    // They deleted it: take the delete.
    next = updateAt(module, steps, list => (list as Dict[]).filter(entry => String(entry?.id) !== id));
  } else if (conflict.kind === 'local-deleted') {
    // They kept working on what this author deleted: put their copy back.
    if (!conflict.remote || typeof conflict.remote !== 'object') return module;
    next = updateAt(module, steps, list => {
      const entries = list as Dict[];
      return entries.some(entry => String(entry?.id) === id) ? entries : [...entries, conflict.remote as Dict];
    });
  } else if (conflict.kind === 'reorder') {
    const remoteOrder = String(conflict.remote || '').split('\u0000').filter(Boolean);
    next = updateAt(module, steps, list => reorderTo(Array.isArray(list) ? list as Dict[] : [], remoteOrder));
  }
  return recalculateModule(next as ModuleCatalogueItem);
}
