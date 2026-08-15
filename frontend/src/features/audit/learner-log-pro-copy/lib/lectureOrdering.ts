/**
 * Order LMS rows as lecture bundles without changing any stored data:
 *
 *   P1 / VID 1 (media)
 *   P1-PPT      (reading + quiz)
 *   P1-Textbook (reading + quiz)
 *   P2 / VID 2 (media)
 *   ...
 *
 * Date and LMS course stay ahead of the lecture number, so components are
 * bundled only when they belong to the same teaching day and course.
 */
export type LmsLectureRow = {
  key: string;
  activity_date: string | null;
  category: string;
  source_course?: string | null;
  source_ref?: string | null;
  title: string;
};

export type LmsLectureArrangement<T extends LmsLectureRow> = {
  rows: T[];
  /** Audio / Reading / Quiz rows matched to a lecture and rendered beneath it. */
  nestedRowKeys: Set<string>;
  /** Linked component row keys, used to cascade a parent lecture date change. */
  bundleRowKeysByPrimary: Map<string, string[]>;
};

const natural = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

function sourceGroup(row: LmsLectureRow): string {
  const match = String(row.source_ref ?? "").match(/^(?:la|rq):(\d+):/i);
  return match?.[1] ?? row.source_course ?? "";
}

/** Lecture 1 aliases used across the LMS mirror: P1, VID 1, Q1, L1, etc. */
export function lectureNumber(title: string): number | null {
  const value = String(title ?? "").replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
  const patterns = [
    /^(?:p|part)\s*[-_: ]*\s*(\d+)\b/i,
    /^(?:vid(?:eo)?|aud(?:io)?|quiz|q|reading|r|lecture|lesson|l)\s*[-_: ]*\s*(\d+)\b/i,
    /^(?:ppt|textbook)\s*[-_: ]*(?:(?:lecture|lesson|l|p)\s*[-_: ]*)?(\d+)\b/i,
  ];
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match) return Number(match[1]);
  }
  return null;
}

function categoryOrder(category: string): number {
  switch (String(category).toLowerCase()) {
    case "video": return 0;
    case "audio": return 1;
    case "reading+quiz": return 2;
    default: return 3;
  }
}

function readingComponentOrder(row: LmsLectureRow): number {
  if (row.category.toLowerCase() !== "reading+quiz") return 0;
  const title = row.title.toLowerCase();
  if (/\b(?:ppt|power\s*point|powerpoint)\b/.test(title)) return 0;
  if (/\b(?:textbook|reading)\b/.test(title)) return 1;
  if (/\b(?:quiz|q\s*\d+)\b/.test(title)) return 2;
  return 3;
}

const TOPIC_STOP_WORDS = new Set([
  "and", "assessment", "audio", "aud", "for", "from", "lesson", "lecture",
  "part", "pdf", "podcast", "powerpoint", "ppt", "quiz", "reading", "the",
  "textbook", "video", "vid", "with",
]);

function topicTokens(title: string): string[] {
  return String(title ?? "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/g, " ")
    .toLowerCase()
    .match(/[a-z0-9]+/g)
    ?.filter((token) => !/^\d+$/.test(token) && token.length >= 3 && !TOPIC_STOP_WORDS.has(token))
    ?? [];
}

function componentMatchScore(component: LmsLectureRow, media: LmsLectureRow): number {
  const componentNumber = lectureNumber(component.title);
  const mediaNumber = lectureNumber(media.title);
  if (componentNumber != null && mediaNumber != null && componentNumber !== mediaNumber) return -1;

  const componentTokens = new Set(topicTokens(component.title));
  const mediaTokens = new Set(topicTokens(media.title));
  const shared = [...componentTokens].filter((token) => mediaTokens.has(token));
  const longestShared = shared.reduce((length, token) => Math.max(length, token.length), 0);
  const topicMatch = shared.length >= 2 || (shared.length === 1 && longestShared >= 7);
  const numberMatch = componentNumber != null && componentNumber === mediaNumber;
  if (!numberMatch && !topicMatch) return -1;

  const coverage = shared.length / Math.max(1, Math.min(componentTokens.size, mediaTokens.size));
  return (numberMatch ? 100 : 0) + shared.length * 20 + coverage * 10;
}

function baseRowCompare(left: LmsLectureRow, right: LmsLectureRow): number {
  const leftLecture = lectureNumber(left.title);
  const rightLecture = lectureNumber(right.title);
  if (leftLecture != null || rightLecture != null) {
    if (leftLecture == null) return 1;
    if (rightLecture == null) return -1;
    if (leftLecture !== rightLecture) return leftLecture - rightLecture;
  }

  const byCategory = categoryOrder(left.category) - categoryOrder(right.category);
  if (byCategory) return byCategory;

  const byReadingComponent = readingComponentOrder(left) - readingComponentOrder(right);
  if (byReadingComponent) return byReadingComponent;

  return natural.compare(left.title, right.title);
}

function arrangeTeachingDay<T extends LmsLectureRow>(rows: readonly T[]): LmsLectureArrangement<T> {
  const videos = rows.filter((row) => row.category.toLowerCase() === "video");
  const audios = rows.filter((row) => row.category.toLowerCase() === "audio");
  const readingQuiz = rows.filter((row) => row.category.toLowerCase() === "reading+quiz");
  const other = rows.filter((row) => !videos.includes(row) && !audios.includes(row) && !readingQuiz.includes(row));
  // Video is the lecture parent when available. An unmatched audio becomes a
  // parent itself, allowing its Q/R material to sit underneath it.
  const bundles = videos.map((primary) => ({ primary, components: [] as T[] }));
  const standalone: T[] = [];
  const nestedRowKeys = new Set<string>();

  function matchingBundle(component: T) {
    let bestBundle: (typeof bundles)[number] | null = null;
    let bestScore = -1;
    for (const bundle of bundles) {
      const score = Math.max(
        componentMatchScore(component, bundle.primary),
        ...bundle.components.map((candidate) => componentMatchScore(component, candidate)),
      );
      if (score > bestScore) {
        bestBundle = bundle;
        bestScore = score;
      }
    }
    return bestBundle && bestScore >= 0 ? bestBundle : null;
  }

  for (const audio of audios) {
    const bundle = matchingBundle(audio);
    if (bundle) {
      bundle.components.push(audio);
      nestedRowKeys.add(audio.key);
    } else {
      bundles.push({ primary: audio, components: [] });
    }
  }

  for (const component of readingQuiz) {
    const bestBundle = matchingBundle(component);
    if (bestBundle) {
      bestBundle.components.push(component);
      nestedRowKeys.add(component.key);
    } else {
      standalone.push(component);
    }
  }

  const units = [
    ...bundles,
    ...standalone.map((primary) => ({ primary, components: [] as T[] })),
  ];
  units.sort((left, right) => {
    const leftNumbers = [left.primary, ...left.components].map((row) => lectureNumber(row.title)).filter((value): value is number => value != null);
    const rightNumbers = [right.primary, ...right.components].map((row) => lectureNumber(row.title)).filter((value): value is number => value != null);
    const leftNumber = leftNumbers.length ? Math.min(...leftNumbers) : null;
    const rightNumber = rightNumbers.length ? Math.min(...rightNumbers) : null;
    if (leftNumber != null || rightNumber != null) {
      if (leftNumber == null) return 1;
      if (rightNumber == null) return -1;
      if (leftNumber !== rightNumber) return leftNumber - rightNumber;
    }
    return baseRowCompare(left.primary, right.primary);
  });

  const orderedBundles = units.flatMap((bundle) => [
    bundle.primary,
    ...bundle.components.sort(baseRowCompare),
  ]);

  // Components with no matching media still stay in deterministic P1/P2/P10
  // order; they are not visually indented because no parent was inferred.
  return {
    rows: [...orderedBundles, ...other.sort(baseRowCompare)],
    nestedRowKeys,
    bundleRowKeysByPrimary: new Map(
      bundles
        .filter((bundle) => bundle.components.length > 0)
        .map((bundle) => [bundle.primary.key, bundle.components.map((row) => row.key)]),
    ),
  };
}

export function arrangeLmsLectureRows<T extends LmsLectureRow>(rows: readonly T[]): LmsLectureArrangement<T> {
  const teachingDays = new Map<string, T[]>();
  for (const row of rows) {
    const date = row.activity_date || "9999-12-31";
    const key = `${date}\u0000${sourceGroup(row)}`;
    const group = teachingDays.get(key) ?? [];
    group.push(row);
    teachingDays.set(key, group);
  }

  const orderedDays = [...teachingDays.entries()].sort(([left], [right]) => natural.compare(left, right));
  const orderedRows: T[] = [];
  const nestedRowKeys = new Set<string>();
  const bundleRowKeysByPrimary = new Map<string, string[]>();
  for (const [, dayRows] of orderedDays) {
    const arranged = arrangeTeachingDay(dayRows);
    orderedRows.push(...arranged.rows);
    for (const key of arranged.nestedRowKeys) nestedRowKeys.add(key);
    for (const [primaryKey, componentKeys] of arranged.bundleRowKeysByPrimary) {
      bundleRowKeysByPrimary.set(primaryKey, componentKeys);
    }
  }
  return { rows: orderedRows, nestedRowKeys, bundleRowKeysByPrimary };
}

export function orderLmsLectureRows<T extends LmsLectureRow>(rows: readonly T[]): T[] {
  return arrangeLmsLectureRows(rows).rows;
}
