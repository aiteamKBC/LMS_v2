import { useEffect, useRef, useState } from 'react';
import { Camera, LoaderCircle } from 'lucide-react';
import type { LearnerKind } from '@/api/learnerDetail';
import { MAX_PHOTO_BYTES, readLearnerPhoto, uploadLearnerPhoto } from '@/api/learnerPhoto';
import { initialsFor } from '@/lib/format';
import { useToastOptional } from '@/hooks/useToast';
import styles from './LearnerProfilePhoto.module.css';

type Props = { kind: LearnerKind; learnerId: string; name: string; className?: string };

export function LearnerProfilePhoto(props: Props) {
  return <PhotoEditor key={`${props.kind}:${props.learnerId}`} {...props} />;
}

function PhotoEditor({ kind, learnerId, name, className = '' }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const sequence = useRef(0);
  const saving = useRef(false);
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const toast = useToastOptional();

  useEffect(() => {
    mounted.current = true;
    const revision = ++sequence.current;
    const controller = new AbortController();
    request.current = controller;
    void readLearnerPhoto(kind, learnerId, controller.signal).then(value => {
      if (mounted.current && revision === sequence.current) setPhoto(value);
    }).catch(() => { /* Initials remain available while photo storage is offline. */ });
    return () => { mounted.current = false; request.current?.abort(); };
  }, [kind, learnerId]);

  useEffect(() => {
    if (!photo) { setUrl(''); return; }
    const next = URL.createObjectURL(photo);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [photo]);

  async function upload(file?: File) {
    if (!file || saving.current) return;
    const validation = !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)
      ? 'Choose a JPG, PNG or WebP photo.'
      : file.size > MAX_PHOTO_BYTES ? 'Choose a photo smaller than 5 MB.' : '';
    if (validation) { setError(validation); return; }
    setError('');
    setBusy(true);
    saving.current = true;
    ++sequence.current;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    try {
      const saved = await uploadLearnerPhoto(kind, learnerId, file, controller.signal);
      if (!mounted.current) return;
      setPhoto(saved);
      toast?.success('Profile photo updated');
    } catch (reason) {
      if (!mounted.current) return;
      setError(reason instanceof Error ? reason.message : 'Your photo could not be saved. Please try again.');
    } finally {
      saving.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  return <div className={styles.root}>
    <button type="button" className={`${styles.avatar} rounded-full ${className}`} onClick={() => input.current?.click()}
      disabled={busy} aria-busy={busy} aria-label={busy ? 'Saving profile photo' : photo ? 'Change profile photo' : 'Upload profile photo'}
      title="Upload profile photo · JPG, PNG or WebP · up to 5 MB">
      <span className={styles.image}>{url ? <img src={url} alt={`${name}'s profile photo`} /> : <span aria-hidden="true">{initialsFor(name)}</span>}</span>
      <span className={styles.camera} aria-hidden="true">{busy ? <LoaderCircle className={styles.spinner} size={17} /> : <Camera size={17} />}</span>
    </button>
    <input ref={input} aria-label="Choose profile photo" type="file" accept="image/jpeg,image/png,image/webp" hidden disabled={busy}
      onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void upload(file); }} />
    {busy && <span className={styles.feedback} role="status">Saving photo…</span>}
    {error && <span className={styles.feedback} role="alert">{error}</span>}
  </div>;
}
