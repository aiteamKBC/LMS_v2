


export function ksbVisualTone(code: string, type?: string) {
  const rawType = String(type || '').trim().toLowerCase();
  const prefix = String(code || '').trim().toUpperCase().slice(0, 1);
  if (prefix === 'S' || rawType.startsWith('skill')) {
    return {
      label: 'Skill',
      icon: 'ri-tools-line',
      row: 'border-amber-100 border-l-amber-500 bg-amber-50/35 hover:bg-amber-50',
      selectedRow: 'border-amber-300 border-l-amber-600 bg-amber-50 ring-1 ring-amber-100',
      iconClass: 'bg-amber-100 text-amber-700',
      badgeClass: 'bg-amber-100 text-amber-700',
      weightClass: 'bg-amber-50 text-amber-700',
      chipClass: 'border-amber-100 bg-amber-50 text-amber-700',
    };
  }
  if (prefix === 'B' || rawType.startsWith('behaviour')) {
    return {
      label: 'Behaviour',
      icon: 'ri-user-heart-line',
      row: 'border-emerald-100 border-l-emerald-500 bg-emerald-50/35 hover:bg-emerald-50',
      selectedRow: 'border-emerald-300 border-l-emerald-600 bg-emerald-50 ring-1 ring-emerald-100',
      iconClass: 'bg-emerald-100 text-emerald-700',
      badgeClass: 'bg-emerald-100 text-emerald-700',
      weightClass: 'bg-emerald-50 text-emerald-700',
      chipClass: 'border-emerald-100 bg-emerald-50 text-emerald-700',
    };
  }
  return {
    label: 'Knowledge',
    icon: 'ri-book-open-line',
    row: 'border-primary-100 border-l-primary-500 bg-primary-50/35 hover:bg-primary-50',
    selectedRow: 'border-primary-300 border-l-primary-600 bg-primary-50 ring-1 ring-primary-100',
    iconClass: 'bg-primary-100 text-primary-700',
    badgeClass: 'bg-primary-100 text-primary-700',
    weightClass: 'bg-primary-50 text-primary-700',
    chipClass: 'border-primary-100 bg-primary-50 text-primary-700',
  };
}


export function ksbCodeChipClass(code: string) {
  return ksbVisualTone(code).chipClass;
}
