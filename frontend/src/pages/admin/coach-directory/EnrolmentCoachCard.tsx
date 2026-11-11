import { Copy, Eye, Link2, MoreVertical, Pencil, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { bookingTypes, coachPagePath, type DirectoryCoach } from '@/api/coachBookingDirectory';
import styles from '@/pages/users/presentation/CoachDirectory.module.css';

export function EnrolmentCoachCard({ coach, busy, onEdit, onCopy, onRemove }: {
  coach: DirectoryCoach; busy: boolean; onEdit: (trigger: HTMLButtonElement) => void;
  onCopy: () => void; onRemove: () => void;
}) {
  const enabled = bookingTypes.filter(type => coach.links[type.key]);
  const path = coachPagePath(coach.slug);
  return <article className={styles.coachCard} aria-label={coach.name}>
    <div className={styles.coachIdentity}>
      <span className={styles.coachAvatar} data-color={coach.id % 3} aria-hidden="true">{coach.name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase()}</span>
      <div><h3>{coach.name}</h3><p>{enabled.length} booking {enabled.length === 1 ? 'option' : 'options'}</p></div>
    </div>
    <span className={styles.publicDot} role="img" aria-label="Public booking page" title="Public booking page" />
    <div className={styles.bookingSummary}>
      <p className={styles.fieldLabel}>Booking types</p>
      <p className={styles.enabledCount} data-enabled={enabled.length > 0}><span aria-hidden="true" />{enabled.length} enabled</p>
      <div className={styles.bookingDescription}>
        <span>{enabled.length ? `${enabled.slice(0, 2).map(type => type.label).join(' · ')}${enabled.length > 2 ? ` · +${enabled.length - 2}` : ''}` : 'No booking types enabled'}</span>
        <details className={styles.bookingDetails}>
          <summary>View all<span className={styles.srOnly}> booking options for {coach.name}</span></summary>
          <ul aria-label={`Booking options for ${coach.name}`}>{bookingTypes.map(type => <li key={type.key}>
            {coach.links[type.key] ? <a href={coach.links[type.key]} target="_blank" rel="noopener noreferrer">{type.label}<span className={styles.srOnly}>: Available</span></a> : <span>{type.label}: Not available</span>}
          </li>)}</ul>
        </details>
      </div>
    </div>
    <div className={styles.bookingAddress}>
      <p className={styles.fieldLabel}>Public booking link</p>
      <div><Link2 size={14} aria-hidden="true" /><Link to={path} target="_blank" rel="noopener noreferrer">{path.slice(1)}</Link>
        <button type="button" className={styles.copyButton} onClick={onCopy} aria-label={`Copy page link for ${coach.name}`} title="Copy page link"><Copy size={14} aria-hidden="true" /></button>
      </div>
    </div>
    <div className={styles.coachActions}>
      <Link className={`${styles.button} ${styles.preview}`} to={path} target="_blank" rel="noopener noreferrer" aria-label={`Preview booking page for ${coach.name}`}><Eye size={15} aria-hidden="true" />Preview</Link>
      <button type="button" className={`${styles.button} ${styles.iconButton}`} disabled={busy} onClick={event => onEdit(event.currentTarget)} aria-label={`Edit ${coach.name}`} title="Edit coach"><Pencil size={15} aria-hidden="true" /></button>
      <details className={styles.moreActions}>
        <summary className={`${styles.button} ${styles.iconButton}`} aria-label={`More actions for ${coach.name}`} title="More actions"><MoreVertical size={17} aria-hidden="true" /></summary>
        <div><button type="button" onClick={onCopy}><Copy size={14} aria-hidden="true" />Copy page link</button>
          <button type="button" disabled={busy} onClick={onRemove}><Trash2 size={14} aria-hidden="true" />Remove coach</button></div>
      </details>
    </div>
  </article>;
}
