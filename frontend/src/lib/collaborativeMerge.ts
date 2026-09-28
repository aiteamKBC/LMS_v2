/**
 * Three-way merge for records two people can have open at once.
 *
 * The LMS saves authored records whole: a module structure PATCH replaces every
 * week, component and mapping it is sent. That makes any two editors of the
 * same record an all-or-nothing fight -- whoever saves second either loses
 * their work or is refused. Refusing is what the module builder did, and it is
 * honest, but it is not what people expect of a shared screen.
 *
 * The fix is the one version control settled on. Keep the copy the record was
 * read at (`base`), and when a write from somebody else arrives, compare three
 * things rather than two:
 *
 * - a field only they changed  -> take theirs. The reader never touched it, so
 *   there is nothing of theirs to lose and a stale screen is the only thing
 *   keeping the old value on it.
 * - a field only the reader changed -> keep theirs. The other writer's save
 *   carried the pre-edit value because that is what they had, not because they
 *   decided anything about it.
 * - a field both changed, to different values -> keep the reader's, and say so.
 *   This is the only real disagreement, and it is the only one worth a sentence
 *   on screen. Silently taking either side is how work disappears.
 *
 * Everything else here is bookkeeping in service of that: objects merge key by
 * key, lists of records merge by `id` so two people adding a week each end up
 * with both weeks, and a value that is not a record -- a number, a date, a list
 * of plain strings -- is compared whole, because half a date is not a date.
 *
 * Nothing in this file knows what a module is. It is shared by every curriculum
 * authoring screen, and each one supplies its own labels for the sentences.
 */

/** A field both editors changed, to different values. Local won; this is the receipt. */
export interface MergeCollision {
  /** Where it happened, as a dotted path with list ids in brackets. */
  path: string;
  /** What the reader kept. */
  local: unknown;
  /** What the other editor had saved. */
  remote: unknown;
  /**
   * What the disagreement was about: a value, whether the record exists at all,
   * or -- `reorder` -- where in the list it sits.
   */
  kind?: 'value' | 'local-deleted' | 'remote-deleted' | 'reorder';
}

export interface MergeOutcome<T> {
  /** The reader's copy with the other editor's work folded into it. */
  value: T;
  /** Real disagreements, in the order they were found. */
  collisions: MergeCollision[];
  /**
   * How many of the other editor's changes this merge took.
   *
   * Zero with no collisions means their write touched nothing this record
   * holds, and the screen has nothing to announce.
   */
  adopted: number;
}

export interface MergeOptions {
  /**
   * Fields to compare whole rather than field by field.
   *
   * Tested against the dotted path with list ids replaced by `*`, e.g.
   * `weekStructure[*].settings`. For values whose halves only make sense
   * together -- a schedule whose start and end are chosen as a pair, a settings
   * blob a single control writes -- merging the halves separately would produce
   * a combination neither editor ever had.
   */
  atomic?: (path: string) => boolean;
  /**
   * Fields the merge must never take from the other editor.
   *
   * For values the server derives rather than either editor authoring them.
   * The local value is kept without a collision being recorded.
   */
  ignore?: (path: string) => boolean;
  /**
   * Fields where the stored copy is the authority and local edits never win.
   *
   * For values an external system owns rather than either editor: the Microsoft
   * ids that tie a live session to its meeting are the case this exists for. A
   * stale copy re-asserting the meeting id it read ten minutes ago is not an
   * edit anybody made, and letting it win is how a join link ends up pointing
   * at a meeting that no longer exists. Taken quietly -- there is no decision
   * here to put to the reader.
   */
  preferRemote?: (path: string) => boolean;
}

type Dict = Record<string, unknown>;

function isPlainObject(value: unknown): value is Dict {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * A list whose entries are records with their own identity.
 *
 * Only these merge entry by entry. A list of plain strings -- a week's learning
 * outcomes, say -- has no identity to match on, so reordering it would look
 * exactly like replacing it, and it is compared whole instead.
 */
function isKeyedList(value: unknown): value is Dict[] {
  return Array.isArray(value)
    && value.length > 0
    && value.every(entry => isPlainObject(entry) && typeof entry.id === 'string' && entry.id !== '');
}

/**
 * Whether two values are the same as far as a save is concerned.
 *
 * Serialised with sorted keys so two objects that differ only in the order
 * their keys happen to be in are not read as a change somebody made.
 */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined || a === null || b === null) return false;
  return stableJson(a) === stableJson(b);
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    if (!isPlainObject(item)) return item;
    return Object.keys(item).sort().reduce<Dict>((sorted, key) => {
      sorted[key] = item[key];
      return sorted;
    }, {});
  });
}

/** The path with list ids blanked, so an option can name a field on every entry at once. */
function patternOf(path: string): string {
  return path.replace(/\[[^\]]*\]/g, '[*]');
}

function childPath(path: string, key: string): string {
  return path ? `${path}.${key}` : key;
}

function entryPath(path: string, id: string): string {
  return `${path}[${id}]`;
}

interface MergeContext {
  collisions: MergeCollision[];
  adopted: number;
  atomic: (path: string) => boolean;
  ignore: (path: string) => boolean;
  preferRemote: (path: string) => boolean;
}

function mergeValue(base: unknown, local: unknown, remote: unknown, path: string, ctx: MergeContext): unknown {
  // Both copies already agree. Nothing was decided here by anyone.
  if (sameValue(local, remote)) return local;
  const pattern = patternOf(path);
  if (ctx.ignore(pattern)) return local;
  if (ctx.preferRemote(pattern)) {
    if (!sameValue(base, remote)) ctx.adopted += 1;
    return remote;
  }
  // Only the other editor moved this. The reader is holding the old value
  // because their screen was read before the write, not because they chose it.
  if (sameValue(base, local)) {
    ctx.adopted += 1;
    return remote;
  }
  // Only the reader moved it. The other editor's save carried the pre-edit
  // value for the same reason, so there is nothing of theirs to keep here.
  if (sameValue(base, remote)) return local;

  // Both moved it, to different values. Look inside before calling it a
  // disagreement: "both changed the module" is almost always "they changed one
  // week and the reader changed another".
  if (!ctx.atomic(pattern)) {
    // One side being empty is not a reason to fall back to comparing the lists
    // whole: "they deleted every week" and "I deleted every week" are exactly
    // the cases that must be merged entry by entry rather than swallowed as a
    // single changed value.
    if (Array.isArray(local) && Array.isArray(remote) && (isKeyedList(local) || isKeyedList(remote))) {
      return mergeKeyedList(
        Array.isArray(base) ? base as Dict[] : [],
        local as Dict[],
        remote as Dict[],
        path,
        ctx,
      );
    }
    if (isPlainObject(local) && isPlainObject(remote)) {
      return mergeObject(isPlainObject(base) ? base : {}, local, remote, path, ctx);
    }
  }

  // Nothing left to look inside. The reader keeps what they typed and the
  // screen says what the other editor had.
  ctx.collisions.push({ path, local, remote, kind: 'value' });
  return local;
}

function mergeObject(base: Dict, local: Dict, remote: Dict, path: string, ctx: MergeContext): Dict {
  const merged: Dict = {};
  const keys = new Set([...Object.keys(local), ...Object.keys(remote)]);
  // Local key order is kept so a merged record still serialises the way the
  // screen's own copy does, and a key whose merged value is `undefined` is left
  // out rather than written as an explicit undefined: on this API "absent" and
  // "explicitly cleared" are different requests.
  const ordered = [...Object.keys(local), ...[...keys].filter(key => !(key in local))];
  ordered.forEach(key => {
    const value = mergeValue(base[key], local[key], remote[key], childPath(path, key), ctx);
    if (value !== undefined) merged[key] = value;
  });
  return merged;
}

function mergeKeyedList(base: Dict[], local: Dict[], remote: Dict[], path: string, ctx: MergeContext): Dict[] {
  const byId = (rows: Dict[]) => new Map(rows.map(row => [String(row.id), row]));
  const baseById = byId(base);
  const localById = byId(local);
  const remoteById = byId(remote);

  const merged: Dict[] = [];
  local.forEach(localEntry => {
    const id = String(localEntry.id);
    const baseEntry = baseById.get(id);
    const remoteEntry = remoteById.get(id);
    if (remoteEntry) {
      merged.push(mergeValue(baseEntry, localEntry, remoteEntry, entryPath(path, id), ctx) as Dict);
      return;
    }
    // Gone from the other editor's copy. If the reader had not touched it, the
    // delete is simply their change and it stands.
    if (baseEntry && sameValue(baseEntry, localEntry)) {
      ctx.adopted += 1;
      return;
    }
    if (baseEntry) {
      // They deleted something the reader was working on. Deleting it under the
      // reader loses authored work that only exists here, so it stays and the
      // screen says the other editor removed it.
      ctx.collisions.push({ path: entryPath(path, id), local: localEntry, remote: undefined, kind: 'remote-deleted' });
    }
    // Not in base at all: the reader added it. Theirs to keep.
    merged.push(localEntry);
  });

  remote.forEach((remoteEntry, index) => {
    const id = String(remoteEntry.id);
    if (localById.has(id)) return;
    const baseEntry = baseById.get(id);
    if (baseEntry) {
      // The reader deleted it. An unchanged entry stays deleted; one the other
      // editor had edited is a real disagreement, and the reader's delete still
      // wins -- resurrecting a record somebody removed on purpose is worse than
      // telling them it was edited elsewhere.
      if (!sameValue(baseEntry, remoteEntry)) {
        ctx.collisions.push({ path: entryPath(path, id), local: undefined, remote: remoteEntry, kind: 'local-deleted' });
      }
      return;
    }
    // New on their side. Put it back where they had it, so two people adding a
    // week each end up with both weeks in a sensible order rather than one of
    // them always landing at the end.
    ctx.adopted += 1;
    const precedingId = index > 0 ? String(remote[index - 1].id) : '';
    let after = precedingId ? merged.findIndex(entry => String(entry.id) === precedingId) : -1;
    // Step over anything this editor added in the same place. Their entry goes
    // after the one it followed in their copy, but not in front of a week this
    // editor has just written, which would shuffle it down the rail for no
    // reason either of them would recognise.
    while (after >= 0 && after + 1 < merged.length && !remoteById.has(String(merged[after + 1].id))) after += 1;
    if (after >= 0) merged.splice(after + 1, 0, remoteEntry);
    else if (index === 0) merged.unshift(remoteEntry);
    else merged.push(remoteEntry);
  });

  // The order itself is one of the things two people can disagree about, and it
  // is data: a module runs in the order its weeks are in. The result above
  // follows THIS reader's order, which is right when they are the one who moved
  // something and silently wrong when the other editor is -- their reorder
  // would disappear with nothing said. So it is decided the same way every
  // other value here is decided.
  //
  // Compared over the entries both copies still have, so that an add or a
  // delete on one side is never read as a reorder on the other.
  const shared = (id: string) => baseById.has(id) && localById.has(id) && remoteById.has(id);
  const orderOf = (rows: Dict[]) => rows.map(row => String(row.id)).filter(shared).join('\u0000');
  const baseOrder = orderOf(base);
  const localMoved = orderOf(local) !== baseOrder;
  const remoteMoved = orderOf(remote) !== baseOrder;
  if (!remoteMoved) return merged;
  if (localMoved) {
    // Both rearranged the same list. There is no combination of two orders that
    // is either of them, so the reader's stands and they are told.
    ctx.collisions.push({ path, local: orderOf(local), remote: orderOf(remote), kind: 'reorder' });
    return merged;
  }
  ctx.adopted += 1;
  return inRemoteOrder(merged, remote, remoteById);
}

/**
 * Put the merged entries into the other editor's order.
 *
 * Only the entries they know about have a place in it. Anything this reader
 * added -- or kept after the other editor deleted it -- stays behind whatever
 * it was already sitting behind, so a week somebody has just written does not
 * jump to the end of the module because of a reorder somebody else made.
 */
function inRemoteOrder(merged: Dict[], remote: Dict[], remoteById: Map<string, Dict>): Dict[] {
  const mergedById = new Map(merged.map(entry => [String(entry.id), entry]));
  const anchors = new Map<string, string>();
  merged.forEach((entry, index) => {
    const id = String(entry.id);
    if (!remoteById.has(id)) anchors.set(id, index > 0 ? String(merged[index - 1].id) : '');
  });
  const ordered = remote
    .map(entry => mergedById.get(String(entry.id)))
    .filter((entry): entry is Dict => Boolean(entry));
  merged.forEach(entry => {
    const id = String(entry.id);
    if (remoteById.has(id)) return;
    const anchor = anchors.get(id) || '';
    const at = anchor ? ordered.findIndex(item => String(item.id) === anchor) : -1;
    if (at >= 0) ordered.splice(at + 1, 0, entry);
    else if (!anchor) ordered.unshift(entry);
    else ordered.push(entry);
  });
  return ordered;
}

/**
 * Fold `remote` into `local`, using `base` to tell whose change each difference is.
 *
 * `base` is the copy both sides started from: for an open editor that is the
 * record as it was last read from or written to the server. Passing the wrong
 * base is the one way to get this wrong -- with `base === local` every
 * difference reads as the other editor's and the reader's edits are silently
 * replaced -- so callers keep it beside the revision they read it with.
 */
export function mergeRecords<T>(base: T | null | undefined, local: T, remote: T, options: MergeOptions = {}): MergeOutcome<T> {
  const ctx: MergeContext = {
    collisions: [],
    adopted: 0,
    atomic: options.atomic || (() => false),
    ignore: options.ignore || (() => false),
    preferRemote: options.preferRemote || (() => false),
  };
  const value = mergeValue(base ?? undefined, local, remote, '', ctx) as T;
  return { value, collisions: ctx.collisions, adopted: ctx.adopted };
}

/**
 * The last readable name in a path: `weekStructure[w1].components[c2].title` -> `title`.
 *
 * Callers turn a path into their own sentence; this is the fallback for a field
 * nobody named, and it is deliberately the field rather than the whole path --
 * a reader is not owed the shape of our payload.
 */
export function mergePathLeaf(path: string): string {
  const parts = path.split('.').filter(Boolean);
  const last = parts[parts.length - 1] || '';
  return last.replace(/\[[^\]]*\]/g, '');
}

/**
 * Every id named in a path, outermost first.
 *
 * How a screen turns `weekStructure[w1].components[c2].title` into "the title
 * of Reading task, in Week 1" -- it looks each id up in what it is holding.
 */
export function mergePathIds(path: string): string[] {
  return [...path.matchAll(/\[([^\]]*)\]/g)].map(match => match[1]).filter(id => id && id !== '*');
}
