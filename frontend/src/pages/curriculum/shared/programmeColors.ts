/** Presentation only: never copies a programme colour into a module's stored data. */
type ProgrammeColorIdentity = { id?: string; sourceId?: string; name?: string; level?: string; color?: string };

// The requested Curriculum palette takes precedence over legacy saved colours.
// Named programmes and their modules use this one presentation policy.
const PROGRAMME_PALETTE: ReadonlyArray<{ color: string; names: readonly string[] }> = [
  { color: '#15803d', names: ['MBA', 'Master of Business Administration'] },
  { color: '#db2777', names: ['ME4', 'ME L4', 'ME Level 4', 'Marketing Executive 4', 'Marketing Executive L4', 'Marketing Executive Level 4'] },
  { color: '#2563eb', names: ['MM6', 'MM L6', 'Marketing Manager 6', 'Marketing Manager L6', 'Marketing Manager Level 6'] },
  { color: '#c2410c', names: ['PCP6', 'PCP L6', 'Project Controls Professional 6', 'Project Controls Professional L6', 'Project Controls Professional Level 6', 'Project Control Professional Level 6'] },
  { color: '#7c3aed', names: ['APM4', 'APM L4', 'Associate Project Manager 4', 'Associate Project Manager L4', 'Associate Project Manager Level 4'] },
  { color: '#0f766e', names: ['OTHM Level 7 Diploma in Project Management', 'OTHM Level 7 Diploma in Project Management - Al Fanar'] },
  { color: '#b45309', names: ['Final Test'] },
];
const colourName = (value?: string) => (value || '').normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/g, '');
const namedColours = new Map(PROGRAMME_PALETTE.flatMap(({ color, names }) => names.map(name => [colourName(name), color] as const)));

export function programmeColor(programme?: ProgrammeColorIdentity | null): string {
  const name = colourName(programme?.name);
  const level = /^(?:(?:level|lvl|l))?(\d+)$/.exec(colourName(programme?.level))?.[1];
  const assigned = namedColours.get(name) || (level ? namedColours.get(`${name}${level}`) : undefined);
  if (assigned) return assigned;
  const value = programme?.color?.trim().replace(/^#/, '') || '';
  if (/^[\da-f]{6}$/i.test(value)) return `#${value.toLowerCase()}`;
  if (/^[\da-f]{3}$/i.test(value)) return `#${[...value].map(char => char + char).join('').toLowerCase()}`;
  const identity = programme?.sourceId || programme?.id || programme?.name || '';
  if (!identity) return '#64748b';
  // Stable across filtering, sorting, pages and reloads; no array-index colours.
  let hash = 0;
  for (const char of identity) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const hue = hash * 137.508 % 360;
  const chroma = 0.48, lightness = 0.38;
  const a = chroma * Math.min(lightness, 1 - lightness);
  const channel = (offset: number) => {
    const k = (offset + hue / 30) % 12;
    return Math.round(255 * (lightness - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, '0');
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

/** WCAG readable text on the exact programme colour, including light custom colours. */
export function programmeColorText(color: string): '#ffffff' | '#172033' {
  const rgb = color.replace('#', '').match(/.{2}/g)?.map(value => parseInt(value, 16) / 255) || [];
  const linear = rgb.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  return (luminance + 0.05) / 0.05 > 1.05 / (luminance + 0.05) ? '#172033' : '#ffffff';
}
