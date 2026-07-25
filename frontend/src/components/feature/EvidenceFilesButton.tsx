import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { LearnerKind } from '@/api/learnerDetail';
import { fetchEvidence, getEvidenceDownloadUrl, type EvidenceRecord } from '@/api/evidence';

/* ═══════════════════════════════════════════════════════
   EVIDENCE FILES BUTTON — compact "view uploaded file(s)"
   affordance for an assignment row in the training plan.
   Renders nothing until we know the learner actually has
   evidence for this component, so rows stay uncluttered.
   Approved files open via a short-lived Azure SAS URL.
   ═══════════════════════════════════════════════════════ */

export function EvidenceFilesButton({ kind, learnerId, componentId }: {
  kind: LearnerKind;
  learnerId: string;
  componentId: string;
}) {
  const [files, setFiles] = useState<EvidenceRecord[]>([]);
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The menu is portalled to <body>: the training-plan week/module cards use
  // `overflow-hidden` for their rounded corners, which would otherwise clip an
  // absolutely-positioned dropdown.
  const [menuRect, setMenuRect] = useState({ left: 0, top: 0 });
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchEvidence(kind, learnerId, { sectionRef: componentId })
      .then((rows) => { if (!cancelled) setFiles(rows); })
      .catch(() => { /* a row is not the place to surface a load failure */ });
    return () => { cancelled = true; };
  }, [kind, learnerId, componentId]);

  const MENU_WIDTH = 256;

  useEffect(() => {
    if (!open) return undefined;
    const positionMenu = () => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      // Right-align to the trigger (it sits at the row's right edge), clamped
      // so the menu can never run off the left of the viewport.
      setMenuRect({ left: Math.max(8, rect.right - MENU_WIDTH), top: rect.bottom + 6 });
    };
    positionMenu();
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', positionMenu);
    window.addEventListener('scroll', positionMenu, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', positionMenu);
      window.removeEventListener('scroll', positionMenu, true);
    };
  }, [open]);

  if (files.length === 0) return null;

  const openFile = async (file: EvidenceRecord) => {
    setError(null);
    setBusyId(file.id);
    try {
      const url = await getEvidenceDownloadUrl(kind, learnerId, file.id);
      window.open(url, '_blank', 'noreferrer');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open the file.');
    } finally {
      setBusyId(null);
    }
  };

  const approved = files.filter((f) => f.status === 'approved');

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        onClick={(e) => {
          e.stopPropagation();
          // One file that's ready to read → skip the menu and just open it.
          if (files.length === 1 && approved.length === 1) openFile(approved[0]);
          else setOpen((s) => !s);
        }}
        className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-lg border border-background-300 bg-white text-foreground-600 hover:bg-background-50 transition-colors cursor-pointer"
        title="View uploaded evidence"
      >
        <i className="ri-attachment-2 text-[10px]" />
        {files.length === 1 ? 'View file' : `${files.length} files`}
      </button>

      {open && createPortal(
        <div
          ref={menuRef}
          className="fixed z-[120] rounded-xl border border-background-300 bg-white shadow-xl overflow-hidden"
          style={{ left: menuRect.left, top: menuRect.top, width: MENU_WIDTH }}
        >
          <ul className="divide-y divide-background-200 max-h-64 overflow-y-auto">
            {files.map((f) => {
              const isApproved = f.status === 'approved';
              return (
                <li key={f.id}>
                  <button
                    disabled={!isApproved || busyId === f.id}
                    onClick={(e) => { e.stopPropagation(); openFile(f); }}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors ${
                      isApproved ? 'hover:bg-background-50 cursor-pointer' : 'cursor-default opacity-60'
                    }`}
                  >
                    <i className="ri-file-line text-foreground-400 text-sm shrink-0" />
                    <span className="flex-1 min-w-0">
                      <span className="block text-[12px] font-semibold text-foreground-800 truncate">{f.filename}</span>
                      {!isApproved && (
                        <span className="block text-[10px] text-foreground-400">
                          {f.status === 'pending' ? 'Scanning…' : 'Rejected'}
                        </span>
                      )}
                    </span>
                    {isApproved && <i className="ri-external-link-line text-foreground-400 text-xs shrink-0" />}
                  </button>
                </li>
              );
            })}
          </ul>
          {error && <p className="px-3 py-2 text-[11px] font-medium text-red-600 border-t border-background-200">{error}</p>}
        </div>,
        document.body,
      )}
    </div>
  );
}
