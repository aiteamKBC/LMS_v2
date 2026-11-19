import type { ReactNode } from 'react';
import { SelectMenu, type SelectMenuProps } from '@/components/feature/SelectField';
import styles from './FilterSelect.module.css';

export default function FilterSelect({ icon, className = '', ...props }: SelectMenuProps & { icon?: ReactNode }) {
  return <div className={`${styles.field} ${className}`}>
    {icon && <span className={styles.icon} aria-hidden="true">{icon}</span>}
    <SelectMenu {...props} size="sm" className="min-w-0" triggerClassName={`${styles.trigger} ${icon ? styles.withIcon : ''}`}
      menuClassName={styles.menu} />
  </div>;
}
