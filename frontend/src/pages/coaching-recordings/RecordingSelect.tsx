import { SelectMenu, type SelectMenuProps } from '@/components/feature/SelectField';
import styles from './RecordingSelect.module.css';

/** Shared presentation for recording filters, quality forms and their dialogs. */
export default function RecordingSelect({ triggerClassName = '', menuClassName = '', className = '', ...props }: SelectMenuProps) {
  // A saving/loading state must also dismiss an already-open portaled menu.
  return <SelectMenu key={props.disabled ? 'disabled' : 'enabled'} size="sm" {...props} className={`min-w-0 max-w-full ${className}`}
    triggerClassName={`${styles.trigger} ${triggerClassName}`} menuClassName={`${styles.menu} ${menuClassName}`} />;
}
