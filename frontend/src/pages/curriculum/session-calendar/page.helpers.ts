export function formatDate(d: Date) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function sessionGroups(group: string): string[] {
  return group.split(',').map(name => name.trim()).filter(Boolean);
}

export function matchesSessionGroup(group: string, selected: string): boolean {
  return selected === 'all' || sessionGroups(group).includes(selected);
}
