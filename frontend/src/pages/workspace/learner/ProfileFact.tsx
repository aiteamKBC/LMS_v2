import { AppIcon } from '@/components/feature/AppIcon';
import { toneStyle, statusTone } from '@/lib/statusTone';
import { EMPTY_VALUE } from '@/lib/format';
import overviewStyles from './Overview.module.css';

/** One labelled fact in the profile header's meta row. */
export function ProfileFact({ icon, label, value, status = false }: { icon?: string; label: string; value: string; status?: boolean }) {
  const statusStyle = status ? toneStyle(statusTone(value)) : null;
  return (
    <div className={overviewStyles.fact}>
      {statusStyle ? (
        <span aria-hidden="true" className={`${overviewStyles.statusIcon} ${statusStyle.dot}`}>
          <span />
        </span>
      ) : <AppIcon aria-hidden="true" className={`${icon} ${overviewStyles.factIcon}`} />}
      <div className="min-w-0">
        <dt className={overviewStyles.factLabel}>{label}</dt>
        <dd className={overviewStyles.factValue}>{value || EMPTY_VALUE}</dd>
      </div>
    </div>
  );
}
