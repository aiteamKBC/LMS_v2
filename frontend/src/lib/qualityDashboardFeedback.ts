export function isQualityDashboardHiddenFormName(name: string) {
  return /\(\s*t\s*\)/i.test(name);
}
