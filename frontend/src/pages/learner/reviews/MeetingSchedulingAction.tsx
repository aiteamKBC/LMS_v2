import { Link } from 'react-router-dom';
import { AppIcon } from '@/components/feature/AppIcon';

export default function MeetingSchedulingAction({ label, calendarHref, className, onSchedule }: {
  label: string; calendarHref: string; className: string; onSchedule: () => void;
}) {
  const content = <><AppIcon className="ri-calendar-2-line" />{label}</>;
  return label === 'View in calendar'
    ? <Link to={calendarHref} className={className}>{content}</Link>
    : <button type="button" onClick={onSchedule} className={className}>{content}</button>;
}
