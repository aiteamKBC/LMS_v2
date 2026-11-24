import { type ModuleComponentType, componentTypes } from '@/pages/curriculum/module-builder/moduleAuthoringData';


export function selectedComponentTypes(selectedTypes: Set<ModuleComponentType>) {
  return componentTypes
    .map(item => item.type)
    .filter(type => selectedTypes.has(type));
}


export function toggleComponentType(selectedTypes: Set<ModuleComponentType>, type: ModuleComponentType) {
  const next = new Set(selectedTypes);
  if (next.has(type)) {
    next.delete(type);
  } else {
    next.add(type);
  }
  return next;
}


export function componentToneClasses(tone = 'slate') {
  const map: Record<string, { soft: string; text: string; ring: string }> = {
    violet: { soft: 'bg-violet-100', text: 'text-violet-700', ring: 'border-violet-200' },
    slate: { soft: 'bg-slate-100', text: 'text-slate-700', ring: 'border-slate-200' },
    rose: { soft: 'bg-rose-100', text: 'text-rose-700', ring: 'border-rose-200' },
    amber: { soft: 'bg-amber-100', text: 'text-amber-700', ring: 'border-amber-200' },
    emerald: { soft: 'bg-emerald-100', text: 'text-emerald-700', ring: 'border-emerald-200' },
    orange: { soft: 'bg-orange-100', text: 'text-orange-700', ring: 'border-orange-200' },
    sky: { soft: 'bg-sky-100', text: 'text-sky-700', ring: 'border-sky-200' },
    purple: { soft: 'bg-purple-100', text: 'text-purple-700', ring: 'border-purple-200' },
    teal: { soft: 'bg-teal-100', text: 'text-teal-700', ring: 'border-teal-200' },
    lime: { soft: 'bg-lime-100', text: 'text-lime-700', ring: 'border-lime-200' },
    blue: { soft: 'bg-blue-100', text: 'text-blue-700', ring: 'border-blue-200' },
    pink: { soft: 'bg-pink-100', text: 'text-pink-700', ring: 'border-pink-200' },
  };
  return map[tone] || map.slate;
}
