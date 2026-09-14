export function moveCalendarDate(date: Date, view: 'monthly' | 'weekly' | 'daily', direction: -1 | 1): Date {
  const next = new Date(date);
  if (view !== 'monthly') {
    next.setDate(next.getDate() + direction * (view === 'weekly' ? 7 : 1));
    return next;
  }
  const day = next.getDate();
  next.setDate(1);
  next.setMonth(next.getMonth() + direction);
  const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
  next.setDate(Math.min(day, lastDay));
  return next;
}
