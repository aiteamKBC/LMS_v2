import { FileText } from 'lucide-react';
import { Link } from 'react-router-dom';
import { systemDateParts } from '@/lib/format';

export default function CurrentMonthLogLink({ learner, className, month, workflow }: {
  learner: { kind: string; id: string };
  className: string;
  month?: string;
  workflow?: string;
}) {
  const { month: systemMonth, year } = systemDateParts(new Date())!;
  const currentMonth = `${year}-${String(systemMonth).padStart(2, '0')}`;
  const query = workflow ? `?workflow=${encodeURIComponent(workflow)}&source=mcm` : '';

  return <Link className={className} to={`/learner/monthly-logs/${learner.kind}/${learner.id}/${month || currentMonth}${query}`}>
    <FileText size={17} aria-hidden="true" />This month's logs
  </Link>;
}
