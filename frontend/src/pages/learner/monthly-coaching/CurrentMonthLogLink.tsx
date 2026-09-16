import { FileText } from 'lucide-react';
import { Link } from 'react-router-dom';
import { systemDateParts } from '@/lib/format';

export default function CurrentMonthLogLink({ learner, className }: {
  learner: { kind: string; id: string };
  className: string;
}) {
  const { year, month } = systemDateParts(new Date())!;
  const currentMonth = `${year}-${String(month).padStart(2, '0')}`;

  return <Link className={className} to={`/learner/monthly-logs/${learner.kind}/${learner.id}/${currentMonth}`}>
    <FileText size={17} aria-hidden="true" />This month's logs
  </Link>;
}
