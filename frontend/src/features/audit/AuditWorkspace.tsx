import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { jsPDF } from 'jspdf';
import SignaturePad from 'signature_pad';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { SkeletonBlock } from '@/components/feature/CurriculumSkeletons';
import { roleNavMap } from '@/mocks/navigation';
import { fetchAuditLearners, fetchAuditSignoff, fetchLearnerAudit, saveAuditSignoff, type AuditLearnerSummary, type AuditSignoffPayload, type LearnerAuditResponse } from './api';
import { cleanText, normalizeEvidence, shorten, sortableDate, valueFrom, type AuditEvidenceItem, type AuditFeedback } from './jsonEvidence';

const auditorConfig = roleNavMap.auditor;

export default function AuditWorkspace() {
  const [learners, setLearners] = useState<AuditLearnerSummary[]>([]);
  const [selectedLearnerId, setSelectedLearnerId] = useState('');
  const [audit, setAudit] = useState<LearnerAuditResponse | null>(null);
  const [search, setSearch] = useState('');
  const [evidenceSearch, setEvidenceSearch] = useState('');
  const [selectedEvidenceId, setSelectedEvidenceId] = useState('');
  const [learnerSignature, setLearnerSignature] = useState('');
  const [coachSignature, setCoachSignature] = useState('');
  const [learnerSignerName, setLearnerSignerName] = useState('');
  const [coachSignerName, setCoachSignerName] = useState('');
  const [learnerConfirmed, setLearnerConfirmed] = useState(false);
  const [coachConfirmed, setCoachConfirmed] = useState(false);
  const [learnerSignedAt, setLearnerSignedAt] = useState('');
  const [coachSignedAt, setCoachSignedAt] = useState('');
  const [savingSignoff, setSavingSignoff] = useState(false);
  const [signoffStatus, setSignoffStatus] = useState('');
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState('');
  const [loadingLearners, setLoadingLearners] = useState(true);
  const [loadingAudit, setLoadingAudit] = useState(false);
  const [error, setError] = useState('');
  const [signoffReady, setSignoffReady] = useState(false);
  const [signoffHydratedLearnerId, setSignoffHydratedLearnerId] = useState('');
  const signoffDirtyRef = useRef(false);
  const selectedLearnerIdRef = useRef('');

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setLoadingLearners(true);
      fetchAuditLearners({ search, limit: 250 })
        .then((rows) => {
          setLearners(rows);
          setSelectedLearnerId((current) => current || rows.find((row) => Number(row.evidenceCount) > 0)?.learnerId || rows[0]?.learnerId || '');
          setError('');
        })
        .catch((requestError: unknown) => {
          setLearners([]);
          setError(requestError instanceof Error ? requestError.message : 'Unable to load audit learners.');
        })
        .finally(() => setLoadingLearners(false));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const selectedLearner = learners.find((learner) => learner.learnerId === selectedLearnerId) || null;

  useEffect(() => {
    selectedLearnerIdRef.current = selectedLearnerId;
  }, [selectedLearnerId]);

  useEffect(() => {
    if (!selectedLearnerId) {
      setAudit(null);
      setSignoffReady(false);
      setSignoffHydratedLearnerId('');
      return;
    }
    let cancelled = false;
    setLoadingAudit(true);
    setSignoffReady(false);
    setSignoffHydratedLearnerId('');
    fetchLearnerAudit(selectedLearnerId, selectedLearner?.fullName)
      .then((payload) => {
        if (!cancelled) {
          setAudit(payload);
          setSelectedEvidenceId('');
          setError('');
        }
      })
      .catch((requestError: unknown) => {
        if (!cancelled) {
          setAudit(null);
          setError(requestError instanceof Error ? requestError.message : 'Unable to load learner evidence.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingAudit(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedLearnerId, selectedLearner?.fullName]);

  useEffect(() => {
    if (!selectedLearnerId) return;
    let cancelled = false;
    const learnerIdForRequest = selectedLearnerId;
    setSignoffReady(false);
    setSignoffHydratedLearnerId('');
    signoffDirtyRef.current = false;
    fetchAuditSignoff(selectedLearnerId)
      .then((signoff) => {
        if (cancelled) return;
        setLearnerSignerName('');
        setCoachSignerName('');
        setLearnerSignature(cleanText(signoff?.learner_signature));
        setCoachSignature(cleanText(signoff?.coach_signature));
        setLearnerConfirmed(cleanText(signoff?.learner_confirmed) === 'true');
        setCoachConfirmed(cleanText(signoff?.coach_confirmed) === 'true');
        setLearnerSignedAt(cleanText(signoff?.learner_signed_at));
        setCoachSignedAt(cleanText(signoff?.coach_signed_at));
        setSignoffStatus(cleanText(signoff?.updated_at) ? `Saved ${formatDate(cleanText(signoff?.updated_at))}` : '');
      })
      .catch(() => {
        if (!cancelled) setSignoffStatus('');
      })
      .finally(() => {
        if (!cancelled) {
          signoffDirtyRef.current = false;
          setSignoffHydratedLearnerId(learnerIdForRequest);
          window.setTimeout(() => setSignoffReady(true), 0);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedLearnerId, selectedLearner?.fullName]);

  const evidenceItems = useMemo(() => normalizeEvidence(audit?.evidence || [], audit?.related?.evidence_items || []), [audit]);
  const filteredEvidence = useMemo(() => {
    const needle = evidenceSearch.trim().toLowerCase();
    if (!needle) return evidenceItems;
    return evidenceItems.filter((item) =>
      [item.id, item.title, item.kind, item.status, item.content, item.componentId].join(' ').toLowerCase().includes(needle),
    );
  }, [evidenceItems, evidenceSearch]);

  const selectedEvidence = filteredEvidence.find((item) => item.id === selectedEvidenceId) || null;
  const pdfFileName = `audit-pack-${fileSegment(selectedLearner?.fullName || audit?.learnerId || 'learner')}.pdf`;
  const signoffPayload = useMemo<AuditSignoffPayload>(() => ({
    learnerName: selectedLearner?.fullName || '',
    programName: selectedLearner?.programName || '',
    evidenceCount: evidenceItems.length,
    learnerSignerName,
    learnerSignature,
    learnerConfirmed,
    learnerSignedAt,
    coachSignerName,
    coachSignature,
    coachConfirmed,
    coachSignedAt,
    pdfFileName,
  }), [coachConfirmed, coachSignature, coachSignedAt, coachSignerName, evidenceItems.length, learnerConfirmed, learnerSignature, learnerSignedAt, learnerSignerName, pdfFileName, selectedLearner?.fullName, selectedLearner?.programName]);

  const saveSignoffNow = async (learnerId: string, payload: AuditSignoffPayload) => {
    if (!learnerId || signoffHydratedLearnerId !== learnerId || !selectedLearner || loadingAudit) return false;

    setSavingSignoff(true);
    setSignoffStatus('Saving...');
    try {
      await saveAuditSignoff(learnerId, payload);
      signoffDirtyRef.current = false;
      if (selectedLearnerIdRef.current === learnerId) {
        setSignoffStatus(`Saved ${formatDate(new Date().toISOString())}`);
      }
      return true;
    } catch (saveError) {
      signoffDirtyRef.current = true;
      if (selectedLearnerIdRef.current === learnerId) {
        setSignoffStatus(saveError instanceof Error ? saveError.message : 'Could not save sign-off.');
      }
      return false;
    } finally {
      if (selectedLearnerIdRef.current === learnerId) {
        setSavingSignoff(false);
      }
    }
  };

  const selectLearner = async (learnerId: string) => {
    if (learnerId === selectedLearnerId) return;

    const currentLearnerId = selectedLearnerId;
    const currentPayload = signoffPayload;
    const canSaveCurrentSignoff = signoffDirtyRef.current && signoffHydratedLearnerId === currentLearnerId && currentLearnerId && selectedLearner && !loadingAudit;

    if (canSaveCurrentSignoff) {
      signoffDirtyRef.current = false;
      const saved = await saveSignoffNow(currentLearnerId, currentPayload);
      if (!saved) return;
    }

    signoffDirtyRef.current = false;
    setSignoffReady(false);
    setSignoffHydratedLearnerId('');
    setSignoffStatus('');
    setLearnerSignerName('');
    setLearnerSignature('');
    setCoachSignature('');
    setLearnerConfirmed(false);
    setCoachConfirmed(false);
    setLearnerSignedAt('');
    setCoachSignedAt('');
    setCoachSignerName('');
    setSelectedLearnerId(learnerId);
  };

  useEffect(() => {
    if (!signoffReady || !signoffDirtyRef.current || signoffHydratedLearnerId !== selectedLearnerId || !selectedLearnerId || !selectedLearner || loadingAudit) return;
    const timer = window.setTimeout(async () => {
      if (!signoffDirtyRef.current || signoffHydratedLearnerId !== selectedLearnerId) return;
      setSavingSignoff(true);
      setSignoffStatus('Saving...');
      try {
        await saveAuditSignoff(selectedLearnerId, signoffPayload);
        signoffDirtyRef.current = false;
        setSignoffStatus(`Saved ${formatDate(new Date().toISOString())}`);
      } catch (saveError) {
        setSignoffStatus(saveError instanceof Error ? saveError.message : 'Could not save sign-off.');
      } finally {
        setSavingSignoff(false);
      }
    }, 700);

    return () => window.clearTimeout(timer);
  }, [loadingAudit, selectedLearner, selectedLearnerId, signoffHydratedLearnerId, signoffPayload, signoffReady]);

  const markSignoffDirty = () => {
    if (signoffHydratedLearnerId === selectedLearnerId) {
      signoffDirtyRef.current = true;
    }
  };

  useEffect(() => () => {
    if (pdfPreviewUrl) URL.revokeObjectURL(pdfPreviewUrl);
  }, [pdfPreviewUrl]);

  const openPdfPreview = () => {
    if (!selectedLearner || !audit || evidenceItems.length === 0) return;
    const doc = buildAuditPdf({ learner: selectedLearner, audit, evidenceItems, signoff: signoffPayload });
    const nextUrl = URL.createObjectURL(doc.output('blob'));
    setPdfPreviewUrl(nextUrl);
  };

  const downloadCurrentPdf = () => {
    if (!selectedLearner || !audit || evidenceItems.length === 0) return;
    downloadPdf({ learner: selectedLearner, audit, evidenceItems, signoff: signoffPayload });
  };

  return (
    <WorkspaceShell
      role="auditor"
      roleLabel={auditorConfig.label}
      navItems={auditorConfig.items}
      pageTitle="Audit"
      pageSubtitle="Live learner evidence from fetching_evidence"
      userName="Patricia Stone"
      userRole="External Auditor"
      workspaceLabel={auditorConfig.workspaceLabel}
    >
      <div className="p-4 md:p-6">
        <div className="grid min-h-[calc(100vh-128px)] grid-cols-1 gap-5 xl:grid-cols-[340px_minmax(0,1fr)]">
          <aside className="flex min-h-0 flex-col rounded-xl border border-foreground-200/60 bg-background-50">
            <div className="border-b border-background-200 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-heading font-semibold text-foreground-900">Learners</h2>
                  <p className="mt-0.5 text-[11px] text-foreground-400">fetching_evidence.learner_evidence</p>
                </div>
                {loadingLearners ? (
                  <SkeletonBlock className="h-6 w-8 rounded-full" />
                ) : (
                  <span className="rounded-full bg-primary-50 px-2 py-1 text-[11px] font-semibold text-primary-700">{learners.length}</span>
                )}
              </div>
              <SearchBox value={search} onChange={setSearch} placeholder="Search learner, ID, programme" />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {loadingLearners ? (
                <LearnerListSkeleton />
              ) : learners.length === 0 ? (
                <EmptyPanel icon="ri-user-search-line" text="No learners returned from the audit database." />
              ) : (
                learners.map((learner) => (
                  <button
                    key={learner.learnerId}
                    type="button"
                    onClick={() => selectLearner(learner.learnerId)}
                    className={`w-full rounded-lg p-3 text-left transition ${selectedLearnerId === learner.learnerId ? 'bg-primary-50 ring-1 ring-primary-200' : 'hover:bg-background-100'}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-semibold text-foreground-900">{learner.fullName || `Learner ${learner.learnerId}`}</p>
                        <p className="mt-0.5 truncate text-[11px] text-foreground-500">{learner.programName || '--'}</p>
                      </div>
                      <span className="rounded-full bg-background-50 px-2 py-0.5 text-[10px] font-bold text-foreground-700 ring-1 ring-background-200">{learner.evidenceCount}</span>
                    </div>
                    <div className="mt-2 flex justify-end text-[10px] text-foreground-400">
                      <span>{formatDate(learner.latestEvidenceDate, true)}</span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </aside>

          <section className="min-w-0 space-y-5">
            {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[12px] text-red-700">{error}</div>}

            <div className="rounded-xl border border-foreground-200/60 bg-background-50 p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary-600">Live Audit Pack</p>
                  {loadingAudit && selectedLearner ? (
                    <div className="mt-2 space-y-2">
                      <SkeletonBlock className="h-7 w-72 max-w-full" />
                      <SkeletonBlock className="h-3 w-96 max-w-full" />
                    </div>
                  ) : (
                    <>
                      <h1 className="mt-1 text-2xl font-heading font-semibold text-foreground-950">{selectedLearner?.fullName || 'Select a learner'}</h1>
                      <p className="mt-1 max-w-3xl text-[13px] text-foreground-500">{selectedLearner?.programName || 'Choose a learner to review evidence records.'}</p>
                    </>
                  )}
                </div>
                <button
                  type="button"
                  onClick={openPdfPreview}
                  disabled={!audit || evidenceItems.length === 0}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-foreground-950 px-4 text-[12px] font-semibold text-white transition hover:bg-foreground-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <i className="ri-eye-line text-sm"></i>
                  Preview PDF
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-5 2xl:grid-cols-[minmax(0,430px)_minmax(0,1fr)]">
              <EvidenceList
                loading={loadingAudit}
                evidence={filteredEvidence}
                selectedId={selectedEvidence?.id || ''}
                search={evidenceSearch}
                onSearch={setEvidenceSearch}
                onSelect={setSelectedEvidenceId}
              />
              <EvidenceDetail evidence={selectedEvidence} loading={loadingAudit} />
            </div>

            <div className="rounded-xl border border-foreground-200/60 bg-background-50 p-5">
              <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <h2 className="text-sm font-heading font-semibold text-foreground-900">Sign-Off</h2>
                  <p className="mt-1 text-[11px] text-foreground-400">Names, confirmations, signatures, and timestamps are saved automatically for this audit pack.</p>
                </div>
                <div className="inline-flex h-9 items-center gap-2 self-start rounded-lg border border-background-200 bg-background-100 px-3 text-[11px] font-semibold text-foreground-500">
                  <i className={`${savingSignoff ? 'ri-loader-4-line animate-spin text-primary-600' : 'ri-cloud-line text-emerald-600'} text-sm`}></i>
                  <span>{savingSignoff ? 'Auto-saving...' : signoffStatus || 'Auto-save ready'}</span>
                </div>
              </div>
              {loadingAudit || (selectedLearnerId && !signoffReady) ? (
                <SignoffSkeleton />
              ) : (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <SignoffCard
                    label="Learner"
                    signerName={learnerSignerName}
                    onSignerNameChange={(value) => {
                      markSignoffDirty();
                      setLearnerSignerName(value);
                    }}
                    signature={learnerSignature}
                    onSignatureChange={(value) => {
                      markSignoffDirty();
                      const nextSignedAt = value ? learnerSignedAt || new Date().toISOString() : '';
                      const nextPayload = { ...signoffPayload, learnerSignature: value, learnerSignedAt: nextSignedAt };
                      setLearnerSignature(value);
                      setLearnerSignedAt(nextSignedAt);
                      void saveSignoffNow(selectedLearnerId, nextPayload);
                    }}
                    confirmed={learnerConfirmed}
                    onConfirmedChange={(value) => {
                      markSignoffDirty();
                      setLearnerConfirmed(value);
                    }}
                    signedAt={learnerSignedAt}
                  />
                  <SignoffCard
                    label="Coach"
                    signerName={coachSignerName}
                    onSignerNameChange={(value) => {
                      markSignoffDirty();
                      setCoachSignerName(value);
                    }}
                    signature={coachSignature}
                    onSignatureChange={(value) => {
                      markSignoffDirty();
                      const nextSignedAt = value ? coachSignedAt || new Date().toISOString() : '';
                      const nextPayload = { ...signoffPayload, coachSignature: value, coachSignedAt: nextSignedAt };
                      setCoachSignature(value);
                      setCoachSignedAt(nextSignedAt);
                      void saveSignoffNow(selectedLearnerId, nextPayload);
                    }}
                    confirmed={coachConfirmed}
                    onConfirmedChange={(value) => {
                      markSignoffDirty();
                      setCoachConfirmed(value);
                    }}
                    signedAt={coachSignedAt}
                  />
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
      {pdfPreviewUrl && (
        <PdfPreviewModal
          fileName={pdfFileName}
          previewUrl={pdfPreviewUrl}
          onClose={() => setPdfPreviewUrl('')}
          onDownload={downloadCurrentPdf}
        />
      )}
    </WorkspaceShell>
  );
}

function EvidenceList({ loading, evidence, selectedId, search, onSearch, onSelect }: { loading: boolean; evidence: AuditEvidenceItem[]; selectedId: string; search: string; onSearch: (value: string) => void; onSelect: (id: string) => void }) {
  const monthGroups = useMemo(() => groupEvidenceByMonth(evidence), [evidence]);
  const monthKeys = monthGroups.map((group) => group.key).join('|');
  const [expandedMonthKeys, setExpandedMonthKeys] = useState<Set<string>>(new Set());
  const allExpanded = monthGroups.length > 0 && monthGroups.every((group) => expandedMonthKeys.has(group.key));

  useEffect(() => {
    setExpandedMonthKeys(search.trim() ? new Set(monthGroups.map((group) => group.key)) : new Set());
  }, [search, monthGroups, monthKeys]);

  const toggleMonth = (key: string) => {
    setExpandedMonthKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const toggleAllMonths = () => {
    setExpandedMonthKeys(allExpanded ? new Set() : new Set(monthGroups.map((group) => group.key)));
  };

  return (
    <div className="rounded-xl border border-foreground-200/60 bg-background-50">
      <div className="border-b border-background-200 p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-heading font-semibold text-foreground-900">Evidence Timeline</h2>
          <span className="text-[11px] text-foreground-400">{evidence.length} shown</span>
        </div>
        <SearchBox value={search} onChange={onSearch} placeholder="Search evidence title, status, component" />
        {!loading && evidence.length > 0 && (
          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="text-[11px] text-foreground-400">{monthGroups.length} month sections</p>
            <button
              type="button"
              onClick={toggleAllMonths}
              className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-background-200 bg-background-50 px-2.5 text-[11px] font-semibold text-foreground-600 transition hover:bg-background-100"
            >
              <i className={`${allExpanded ? 'ri-collapse-vertical-line' : 'ri-expand-vertical-line'} text-xs`}></i>
              {allExpanded ? 'Collapse all' : 'Expand all'}
            </button>
          </div>
        )}
      </div>
      <div className="max-h-[620px] overflow-y-auto p-2">
        {loading ? (
          <EvidenceTimelineSkeleton />
        ) : evidence.length === 0 ? (
          <EmptyPanel icon="ri-file-search-line" text="No evidence items exist for this learner." />
        ) : (
          monthGroups.map((group) => (
            <section key={group.key}>
              <button
                type="button"
                onClick={() => toggleMonth(group.key)}
                className="sticky top-0 z-10 mb-1 flex w-full items-center justify-between rounded-lg border border-background-200 bg-background-50/95 px-3 py-2 text-left backdrop-blur transition hover:border-primary-200 hover:bg-primary-50/40"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <i className={`${expandedMonthKeys.has(group.key) ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} text-base text-primary-600`}></i>
                  <span className="truncate text-[11px] font-semibold uppercase tracking-wide text-foreground-700">{group.label}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="hidden text-[10px] text-foreground-400 sm:inline">{formatDate(group.items[0]?.date, true)}</span>
                  <span className="rounded-full bg-background-100 px-2 py-0.5 text-[10px] font-semibold text-foreground-500">{group.items.length}</span>
                </span>
              </button>
              {expandedMonthKeys.has(group.key) && <div className="space-y-1">
                {group.items.map((item) => (
            <button key={item.id} type="button" onClick={() => onSelect(item.id)} className={`w-full rounded-lg p-3 text-left transition ${selectedId === item.id ? 'bg-accent-50 ring-1 ring-accent-200' : 'hover:bg-background-100'}`}>
              <div className="flex items-start gap-3">
                <span className={`mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full ${statusDot(item.status)}`}></span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3">
                    <p className="truncate text-[13px] font-semibold text-foreground-900">{item.title}</p>
                    <span className="shrink-0 text-[10px] text-foreground-400">{formatDate(item.date, true)}</span>
                  </div>
                  <p className="mt-1 truncate text-[11px] text-foreground-500">{item.kind || 'Evidence'} · {item.status || 'No status'}{item.componentId ? ` · Component ${item.componentId}` : ''}</p>
                </div>
              </div>
            </button>
                ))}
              </div>}
            </section>
          ))
        )}
      </div>
    </div>
  );
}

function EvidenceDetail({ evidence, loading }: { evidence: AuditEvidenceItem | null; loading: boolean }) {
  return (
    <div className="min-w-0 rounded-xl border border-foreground-200/60 bg-background-50">
      <div className="border-b border-background-200 p-5">
        <h2 className="text-sm font-heading font-semibold text-foreground-900">Evidence Details</h2>
        <p className="mt-1 text-[11px] text-foreground-400">Review the selected learner evidence, files, and audit notes.</p>
      </div>
      {loading ? (
        <EvidenceDetailSkeleton />
      ) : !evidence ? (
        <EmptyPanel icon="ri-file-search-line" text="Select an evidence item to inspect." />
      ) : (
        <div className="space-y-5 p-5">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-heading font-semibold text-foreground-950">{evidence.title}</h3>
              {evidence.status && <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusPill(evidence.status)}`}>{evidence.status}</span>}
            </div>
            <p className="mt-1 text-[12px] text-foreground-500">Evidence #{evidence.id} · {evidence.kind || 'Evidence'} · {formatDate(evidence.date)}</p>
          </div>
          <QuickJudgement evidence={evidence} />
          <EvidenceFacts evidence={evidence} />
          <TraceabilityPanel evidence={evidence} />
          <AuditReviewPanel evidence={evidence} />
          <AuditRunPanel evidence={evidence} />
          {evidence.content && <Panel title="Evidence Text" defaultOpen={false} icon="ri-file-text-line"><p className="whitespace-pre-wrap text-[13px] leading-6 text-foreground-700">{evidence.content}</p></Panel>}
          <EvidenceDocumentsPanel evidence={evidence} />
          {(evidence.noteContent || evidence.noteBlob) && (
            <Panel title="Note Text" defaultOpen={false} icon="ri-sticky-note-line">
              {evidence.noteContent ? (
                <div className="rounded-lg border border-background-200 bg-background-50 p-3">
                  <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-foreground-400">
                    <i className="ri-file-text-line text-sm"></i>
                    {fileNameFromPath(evidence.noteBlob || evidence.fileBlob, evidence.submissionFileName || 'note.txt')}
                    <InfoTooltip text="Text captured from the learner note when the evidence was stored as a note." />
                  </div>
                  <p className="whitespace-pre-wrap text-[13px] leading-6 text-foreground-700">{evidence.noteContent}</p>
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-background-300 bg-background-50 p-3 text-[12px] text-foreground-500">
                  A note file is available, but no extracted note text was returned for this evidence.
                </div>
              )}
            </Panel>
          )}
          <CoachReplyPanel feedbacks={evidence.feedbacks} />
        </div>
      )}
    </div>
  );
}

function PdfPreviewModal({ fileName, previewUrl, onClose, onDownload }: { fileName: string; previewUrl: string; onClose: () => void; onDownload: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground-950/70 p-4">
      <div className="flex h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl bg-background-50 shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-background-200 px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-heading font-semibold text-foreground-950">PDF Preview</h2>
            <p className="mt-0.5 truncate text-[11px] text-foreground-400">{fileName}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onDownload}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-foreground-950 px-3 text-[12px] font-semibold text-white transition hover:bg-foreground-800"
            >
              <i className="ri-download-2-line text-sm"></i>
              Download PDF
            </button>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-background-200 bg-background-50 text-foreground-600 transition hover:bg-background-100"
              aria-label="Close PDF preview"
            >
              <i className="ri-close-line text-lg"></i>
            </button>
          </div>
        </div>
        <iframe title="Audit PDF preview" src={previewUrl} className="min-h-0 flex-1 bg-background-100" />
      </div>
    </div>
  );
}

function EvidenceDocumentsPanel({ evidence }: { evidence: AuditEvidenceItem }) {
  const evidenceLabel = evidence.submissionFileName || fileNameFromPath(evidence.fileBlob || evidence.noteBlob || evidence.title, evidence.kind.toLowerCase().includes('note') ? 'Learner note' : 'Evidence file');
  const reportLabel = evidence.reportFileName || fileNameFromPath(evidence.reportBlob, 'AssessmentReport.pdf');
  const hasAnyDocumentData = evidence.fileUrl || evidence.reportUrl || evidence.fileBlob || evidence.noteBlob || evidence.reportBlob;

  if (!hasAnyDocumentData) {
    return (
      <Panel title="Evidence Files" defaultOpen={false} icon="ri-folder-open-line">
        <div className="rounded-lg border border-dashed border-background-300 bg-background-50 p-3 text-[12px] text-foreground-500">
          No evidence file or assessment report was returned for this item.
        </div>
      </Panel>
    );
  }

  return (
    <Panel title="Evidence Files" defaultOpen={false} icon="ri-folder-open-line">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <DocumentCard
          title={evidence.kind.toLowerCase().includes('note') ? 'Evidence note' : 'Evidence file'}
          description={evidence.submissionStatus ? `File is ${humanLabel(evidence.submissionStatus)}.` : 'The original uploaded learner evidence.'}
          href={evidence.fileUrl}
          fileName={evidenceLabel}
          blobPath={evidence.fileBlob || evidence.noteBlob}
          icon={evidence.kind.toLowerCase().includes('note') ? 'ri-sticky-note-line' : 'ri-file-line'}
          emptyText={evidence.submissionStatus ? `File ${humanLabel(evidence.submissionStatus).toLowerCase()}.` : 'No evidence file returned.'}
        />
        <DocumentCard
          title="Assessment report"
          description={evidence.reportStatus ? `Report is ${humanLabel(evidence.reportStatus)}.` : 'The assessor or coach report.'}
          href={evidence.reportUrl}
          fileName={reportLabel}
          blobPath={evidence.reportBlob}
          icon="ri-file-chart-line"
          emptyText={evidence.reportStatus ? `Report ${humanLabel(evidence.reportStatus).toLowerCase()}.` : 'No assessment report returned.'}
        />
      </div>
    </Panel>
  );
}

function CoachReplyPanel({ feedbacks }: { feedbacks: AuditFeedback[] }) {
  if (feedbacks.length === 0) {
    return (
      <Panel title="Coach Reply" defaultOpen={false} icon="ri-chat-check-line">
        <div className="rounded-lg border border-dashed border-background-300 bg-background-50 p-3 text-[12px] text-foreground-500">
          No coach reply was returned for this evidence.
        </div>
      </Panel>
    );
  }

  return (
    <Panel title="Coach Reply" defaultOpen icon="ri-chat-check-line">
      <div className="space-y-3">
        {feedbacks.map((feedback) => (
          <div key={feedback.id} className="rounded-xl border border-background-200 bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-foreground-400">Coach / assessor</p>
                <h5 className="mt-1 text-[13px] font-semibold text-foreground-950">{feedback.author || 'Coach reply'}</h5>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {feedback.assessedStatus && <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusPill(feedback.assessedStatus)}`}>{feedback.assessedStatus}</span>}
                {feedback.count && <span className="rounded-full bg-background-100 px-2 py-0.5 text-[10px] font-semibold text-foreground-500 ring-1 ring-background-200">{feedback.count} reply</span>}
                {feedback.wordCount && <span className="rounded-full bg-background-100 px-2 py-0.5 text-[10px] font-semibold text-foreground-500 ring-1 ring-background-200">{feedback.wordCount} words</span>}
                {feedback.date && <span className="text-[10px] text-foreground-400">{formatDate(feedback.date)}</span>}
              </div>
            </div>
            {feedback.message && <p className="mt-3 whitespace-pre-wrap text-[13px] leading-6 text-foreground-700">{feedback.message}</p>}
            {feedback.reportUrl && (
              <div className="mt-3">
                <LinkButton href={feedback.reportUrl} label="Open feedback report" icon="ri-file-chart-line" />
              </div>
            )}
          </div>
        ))}
      </div>
    </Panel>
  );
}

function DocumentCard({ title, description, href, fileName, blobPath, icon, emptyText }: { title: string; description: string; href: string; fileName: string; blobPath: string; icon: string; emptyText: string }) {
  const extension = fileExtension(fileName || blobPath);
  const available = Boolean(href);
  return (
    <div className={`rounded-lg border p-3 ${available ? 'border-primary-100 bg-primary-50/50' : 'border-background-200 bg-background-50'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <i className={`${icon} text-sm ${available ? 'text-primary-700' : 'text-foreground-400'}`}></i>
            <h5 className="text-[12px] font-semibold text-foreground-900">{title}</h5>
            <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase ${available ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100' : 'bg-background-100 text-foreground-400 ring-1 ring-background-200'}`}>
              {available ? 'Available' : 'Not available'}
            </span>
          </div>
          <p className="mt-1 text-[11px] leading-4 text-foreground-500">{description}</p>
        </div>
        {extension && <span className="shrink-0 rounded bg-white px-1.5 py-0.5 text-[9px] font-bold uppercase text-foreground-600 ring-1 ring-background-200">{extension}</span>}
      </div>
      <p className="mt-3 truncate text-[12px] font-semibold text-foreground-800">{fileName || emptyText}</p>
      <div className="mt-3">
        {available ? (
          <LinkButton href={href} label="Open file" icon="ri-external-link-line" />
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-background-300 bg-background-100 px-3 py-2 text-[11px] font-semibold text-foreground-500">
            <i className="ri-information-line text-xs"></i>
            {emptyText}
          </span>
        )}
      </div>
    </div>
  );
}

function EvidenceFacts({ evidence }: { evidence: AuditEvidenceItem }) {
  const rows = [
    { label: 'Submitted', value: formatDate(evidence.submittedDate), note: 'When this evidence was submitted.' },
    { label: 'Completed', value: formatDate(evidence.completedDate), note: 'The completion date recorded for this evidence.' },
    { label: 'Spent Time', value: evidence.spentTime ? `${evidence.spentTime} minutes` : '', note: 'Recorded learning time returned for this evidence.' },
    { label: 'Evidence Type', value: humanLabel(evidence.kind), note: 'The type of learner submission, such as file or note.' },
    { label: 'Status', value: humanLabel(evidence.status), note: 'The current evidence status.' },
    { label: 'File Status', value: humanLabel(evidence.submissionStatus), note: 'Whether the learner evidence file is available.' },
    { label: 'Report Status', value: humanLabel(evidence.reportStatus), note: 'Whether an assessment report is available.' },
  ].filter((row) => hasDisplayValue(row.value));

  if (rows.length === 0) return null;

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
      {rows.map((row) => <InfoRow key={row.label} label={row.label} value={row.value} note={row.note} />)}
    </div>
  );
}

function QuickJudgement({ evidence }: { evidence: AuditEvidenceItem }) {
  const hasQuickJudgement = [evidence.auditScore, evidence.auditRisk, evidence.auditVerdict, evidence.recommendedAction].some(hasDisplayValue);
  if (!hasQuickJudgement) return null;

  return (
    <div className="rounded-xl border border-background-200 bg-gradient-to-r from-background-50 to-background-100/80 p-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {hasDisplayValue(evidence.auditScore) && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-foreground-400">Audit score</p>
            <p className="mt-1 text-xl font-heading font-semibold text-foreground-950">{evidence.auditScore}/100</p>
          </div>
        )}
        {(hasDisplayValue(evidence.auditRisk) || hasDisplayValue(evidence.auditVerdict)) && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-foreground-400">Risk & verdict</p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {hasDisplayValue(evidence.auditRisk) && <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${riskPill(evidence.auditRisk)}`}>{humanLabel(evidence.auditRisk)}</span>}
              {hasDisplayValue(evidence.auditVerdict) && <span className="rounded-full bg-background-50 px-2.5 py-1 text-[10px] font-semibold text-foreground-700 ring-1 ring-background-200">{humanLabel(evidence.auditVerdict)}</span>}
            </div>
          </div>
        )}
        {hasDisplayValue(evidence.recommendedAction) && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-foreground-400">Next action</p>
            <p className="mt-1 line-clamp-2 text-[12px] leading-5 text-foreground-700">{evidence.recommendedAction}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function TraceabilityPanel({ evidence }: { evidence: AuditEvidenceItem }) {
  const rows = [
    { label: 'Content Format', value: humanLabel(evidence.contentFormatLabel), note: 'Format detected by the extraction/audit pipeline, such as note or document.' },
    { label: 'Extraction Method', value: humanLabel(evidence.extractionMethod), note: 'How text was extracted for audit review, for example aptem-note or pypdf.' },
    { label: 'Content Chars', value: evidence.contentCharCount, note: 'How much text content was available for automated review.' },
    { label: 'Feedback Words', value: evidence.feedbackWordCount, note: 'Word count for assessor feedback when available.' },
  ].filter((row) => row.value && row.value !== '--');

  if (rows.length === 0) return null;

  return (
    <Panel title="Evidence Context" defaultOpen={false} icon="ri-information-line">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((row) => <InfoRow key={row.label} label={row.label} value={row.value} note={row.note} />)}
      </div>
    </Panel>
  );
}

function AuditRunPanel({ evidence }: { evidence: AuditEvidenceItem }) {
  const rows = [
    { label: 'Audit Status', value: humanLabel(evidence.auditStatus), note: 'Current processing state for this audit item.' },
    { label: 'Needs Manual Review', value: humanLabel(evidence.needsManualReview), note: 'Flags items that should be manually reviewed before final sign-off.' },
    { label: 'Review Status', value: humanLabel(evidence.reviewStatus), note: 'Manual review workflow state.' },
    { label: 'Review Note', value: evidence.reviewNote, note: 'Human reviewer note if one has been added.' },
    { label: 'Reviewed By', value: evidence.reviewedBy, note: 'User who performed the manual review, if available.' },
    { label: 'Reviewed At', value: formatDate(evidence.reviewedAt), note: 'When the manual review was completed.' },
    { label: 'Audited At', value: formatDate(evidence.auditedAt), note: 'When automated audit processing completed.' },
    { label: 'Last Error', value: evidence.lastError, note: 'Latest processing error if the audit pipeline failed.' },
  ].filter((row) => row.value && row.value !== '--');

  if (rows.length === 0) return null;

  return (
    <Panel title="Review Workflow" defaultOpen={false} icon="ri-route-line">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((row) => <InfoRow key={row.label} label={row.label} value={row.value} note={row.note} />)}
      </div>
    </Panel>
  );
}

function AuditReviewPanel({ evidence }: { evidence: AuditEvidenceItem }) {
  const hasAuditDetails = Boolean(
    evidence.auditScore ||
    evidence.auditVerdict ||
    evidence.auditRisk ||
    evidence.auditSummary ||
    evidence.recommendedAction ||
    evidence.strengths.length ||
    evidence.weaknesses.length ||
    evidence.missingRequirements.length ||
    evidence.redFlags.length,
  );

  if (!hasAuditDetails) return null;
  const badges = [
    { label: 'Score', value: evidence.auditScore ? `${evidence.auditScore}/100` : '', note: 'A quick quality signal for how convincing this evidence is for audit purposes.', tone: scoreTone(evidence.auditScore) },
    { label: 'Risk', value: humanLabel(evidence.auditRisk), note: 'Highlights the chance this item needs extra checking before sign-off.', tone: riskTone(evidence.auditRisk) },
    { label: 'Verdict', value: humanLabel(evidence.auditVerdict), note: 'Summarises whether the evidence looks convincing enough to rely on.', tone: 'neutral' as const },
    { label: 'Evidence Type', value: humanLabel(evidence.evidenceType), note: 'Classifies what kind of evidence this is, such as learner work, admin evidence, or a note.', tone: 'neutral' as const },
    { label: 'Authenticity', value: humanLabel(evidence.authenticityConfidence), note: 'Indicates how confidently the evidence can be tied to a genuine learner activity.', tone: 'neutral' as const },
    { label: 'Time Plausibility', value: humanLabel(evidence.timePlausibilityLabel), note: 'Checks whether the recorded learning time appears reasonable from the available content.', tone: 'neutral' as const },
    { label: 'Feedback Quality', value: humanLabel(evidence.feedbackQualityLabel), note: 'Shows whether assessor feedback is present and useful enough for review.', tone: 'neutral' as const },
    { label: 'Feedback Alignment', value: humanLabel(evidence.feedbackAlignment), note: 'Checks whether feedback appears aligned to the evidence and assessment outcome.', tone: 'neutral' as const },
    { label: 'Overall Quality', value: humanLabel(evidence.overallQualityLabel), note: 'A compact quality label derived from the audit result.', tone: 'neutral' as const },
  ].filter((badge) => hasDisplayValue(badge.value));

  return (
    <Panel title="Audit Review" defaultOpen={false} icon="ri-shield-check-line">
      {badges.length > 0 && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {badges.map((badge) => <AuditBadge key={badge.label} label={badge.label} value={badge.value} note={badge.note} tone={badge.tone} />)}
        </div>
      )}

      {(evidence.auditSummary || evidence.recommendedAction) && (
        <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
          {evidence.auditSummary && <Callout title="Summary" text={evidence.auditSummary} icon="ri-file-search-line" note="Why this evidence matters in one short audit-focused view." />}
          {evidence.recommendedAction && <Callout title="Recommended Action" text={evidence.recommendedAction} icon="ri-compass-3-line" note="The next practical step before the pack is signed off or exported." />}
        </div>
      )}

      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <InsightList title="Audit Reasons" items={evidence.auditReasons} icon="ri-lightbulb-flash-line" tone="neutral" note="The reasons behind the audit judgement, score, and risk label." />
        <InsightList title="Strengths" items={evidence.strengths} icon="ri-check-double-line" tone="good" note="Positive points that support accepting or relying on this evidence." />
        <InsightList title="Weaknesses" items={evidence.weaknesses} icon="ri-error-warning-line" tone="warn" note="Issues the team may need to fix, explain, or support with extra evidence." />
        <InsightList title="Missing Requirements" items={evidence.missingRequirements} icon="ri-list-check-3" tone="warn" note="Items that should be added before final audit sign-off where applicable." />
        <InsightList title="Red Flags" items={evidence.redFlags} icon="ri-flag-line" tone="bad" note="Higher-risk points that deserve manual attention before relying on the evidence." />
      </div>
    </Panel>
  );
}

function AuditBadge({ label, value, note, tone = 'neutral' }: { label: string; value: string; note: string; tone?: 'good' | 'warn' | 'bad' | 'neutral' }) {
  const toneClass = {
    good: 'bg-emerald-50 text-emerald-800 ring-emerald-100',
    warn: 'bg-amber-50 text-amber-800 ring-amber-100',
    bad: 'bg-red-50 text-red-800 ring-red-100',
    neutral: 'bg-background-50 text-foreground-800 ring-background-200',
  }[tone];

  return (
    <div className={`rounded-lg px-3 py-2 ring-1 ${toneClass}`}>
      <div className="flex items-center gap-1.5">
        <p className="text-[10px] font-semibold uppercase tracking-wide opacity-70">{label}</p>
        <InfoTooltip text={note} />
      </div>
      <p className="mt-1 truncate text-[13px] font-semibold">{value}</p>
    </div>
  );
}

function Callout({ title, text, icon, note }: { title: string; text: string; icon: string; note: string }) {
  return (
    <div className="rounded-lg border border-background-200 bg-background-50 p-3">
      <div className="mb-2 flex items-center gap-2">
        <i className={`${icon} text-sm text-primary-600`}></i>
        <h5 className="text-[11px] font-semibold uppercase tracking-wide text-foreground-500">{title}</h5>
        <InfoTooltip text={note} />
      </div>
      <p className="text-[12px] leading-5 text-foreground-700">{text}</p>
    </div>
  );
}

function InsightList({ title, items, icon, tone, note }: { title: string; items: string[]; icon: string; tone: 'good' | 'warn' | 'bad' | 'neutral'; note: string }) {
  if (items.length === 0) return null;
  const toneClass = {
    good: 'text-emerald-700',
    warn: 'text-amber-700',
    bad: 'text-red-700',
    neutral: 'text-primary-700',
  }[tone];
  const dotClass = {
    good: 'bg-emerald-500',
    warn: 'bg-amber-500',
    bad: 'bg-red-500',
    neutral: 'bg-primary-500',
  }[tone];

  return (
    <div className="rounded-lg border border-background-200 bg-background-50 p-3">
      <div className="mb-2 flex items-center gap-2">
        <i className={`${icon} text-sm ${toneClass}`}></i>
        <h5 className="text-[11px] font-semibold uppercase tracking-wide text-foreground-500">{title}</h5>
        <InfoTooltip text={note} />
      </div>
      <ul className="space-y-1.5">
        {items.slice(0, 4).map((item) => (
          <li key={item} className="flex gap-2 text-[12px] leading-5 text-foreground-700">
            <span className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}`}></span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return (
    <div className="relative mt-3">
      <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-sm text-foreground-400"></i>
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="h-10 w-full rounded-lg border border-background-200 bg-background-50 pl-9 pr-3 text-[13px] text-foreground-800 outline-none transition focus:border-primary-400" />
    </div>
  );
}

function EmptyPanel({ icon, text }: { icon: string; text: string }) {
  return <div className="flex min-h-36 flex-col items-center justify-center p-6 text-center"><i className={`${icon} text-2xl text-foreground-300`}></i><p className="mt-2 text-[13px] text-foreground-500">{text}</p></div>;
}

function LearnerListSkeleton() {
  return (
    <div className="space-y-2 p-1">
      {Array.from({ length: 7 }).map((_, index) => (
        <div key={index} className="rounded-lg p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-2">
              <SkeletonBlock className="h-3.5 w-40 max-w-full" />
              <SkeletonBlock className="h-2.5 w-52 max-w-full" />
            </div>
            <SkeletonBlock className="h-5 w-7 rounded-full" />
          </div>
          <div className="mt-3 flex items-center justify-between gap-3">
            <SkeletonBlock className="h-2.5 w-14" />
            <SkeletonBlock className="h-2.5 w-20" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EvidenceTimelineSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 3 }).map((_, groupIndex) => (
        <section key={groupIndex}>
          <div className="mb-1 flex items-center justify-between rounded-lg border border-background-200 bg-background-50 px-3 py-2">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <SkeletonBlock className="h-4 w-4 rounded" />
              <SkeletonBlock className="h-3 w-28 max-w-full" />
            </div>
            <SkeletonBlock className="h-5 w-7 rounded-full" />
          </div>
          <div className="space-y-1">
            {Array.from({ length: groupIndex === 0 ? 3 : 2 }).map((_, itemIndex) => (
              <div key={itemIndex} className="rounded-lg p-3">
                <div className="flex items-start gap-3">
                  <SkeletonBlock className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <SkeletonBlock className="h-3.5 w-44 max-w-full" />
                      <SkeletonBlock className="h-2.5 w-16" />
                    </div>
                    <SkeletonBlock className="h-2.5 w-56 max-w-full" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function EvidenceDetailSkeleton() {
  return (
    <div className="space-y-5 p-5">
      <div className="space-y-2">
        <SkeletonBlock className="h-6 w-80 max-w-full" />
        <SkeletonBlock className="h-3 w-64 max-w-full" />
      </div>
      <div className="rounded-xl border border-background-200 bg-background-100/60 p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="space-y-2">
              <SkeletonBlock className="h-2.5 w-20" />
              <SkeletonBlock className="h-5 w-24" />
            </div>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="rounded-lg border border-background-200 bg-background-100/50 p-3">
            <SkeletonBlock className="h-2.5 w-20" />
            <SkeletonBlock className="mt-2 h-3.5 w-28" />
          </div>
        ))}
      </div>
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="rounded-xl border border-background-200 bg-background-50">
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-2">
              <SkeletonBlock className="h-4 w-4 rounded" />
              <SkeletonBlock className="h-3 w-32" />
            </div>
            <SkeletonBlock className="h-4 w-4 rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}

function SignoffSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {Array.from({ length: 2 }).map((_, cardIndex) => (
        <div key={cardIndex} className="rounded-xl border border-background-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="space-y-2">
              <SkeletonBlock className="h-3 w-28" />
              <SkeletonBlock className="h-2.5 w-20" />
            </div>
            <SkeletonBlock className="h-5 w-24 rounded-full" />
          </div>
          <div className="space-y-3">
            <SignoffStepSkeleton lineWidth="w-32" bodyHeight="h-11" />
            <SignoffStepSkeleton lineWidth="w-40" bodyHeight="h-14" />
            <SignoffStepSkeleton lineWidth="w-36" bodyHeight="h-36" />
          </div>
        </div>
      ))}
    </div>
  );
}

function SignoffStepSkeleton({ lineWidth, bodyHeight }: { lineWidth: string; bodyHeight: string }) {
  return (
    <section className="rounded-xl border border-background-200 bg-background-50 p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <SkeletonBlock className="h-6 w-6 rounded-full" />
          <SkeletonBlock className={`h-3 ${lineWidth}`} />
        </div>
        <SkeletonBlock className="h-4 w-14 rounded-full" />
      </div>
      <SkeletonBlock className={`${bodyHeight} w-full rounded-lg`} />
    </section>
  );
}

function InfoRow({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-lg border border-background-200 bg-background-100/50 p-3 transition hover:border-primary-200 hover:bg-primary-50/30">
      <div className="flex items-center gap-1.5">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-foreground-400">{label}</p>
        {note && <InfoTooltip text={note} />}
      </div>
      <p className="mt-1 break-words text-[13px] font-medium text-foreground-900">{value || '--'}</p>
    </div>
  );
}

function Panel({ title, children, defaultOpen = true, icon = 'ri-layout-4-line' }: { title: string; children: React.ReactNode; defaultOpen?: boolean; icon?: string }) {
  return (
    <details open={defaultOpen} className="group rounded-xl border border-background-200 bg-background-50 shadow-sm transition hover:border-primary-100">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
        <span className="flex min-w-0 items-center gap-2">
          <i className={`${icon} text-sm text-primary-600`}></i>
          <span className="truncate text-[12px] font-semibold uppercase tracking-wide text-foreground-600">{title}</span>
        </span>
        <i className="ri-arrow-down-s-line text-base text-foreground-400 transition group-open:rotate-180"></i>
      </summary>
      <div className="border-t border-background-200 p-4">{children}</div>
    </details>
  );
}

function InfoTooltip({ text }: { text: string }) {
  return (
    <span className="relative inline-flex">
      <button type="button" className="peer inline-flex h-4 w-4 items-center justify-center rounded-full text-foreground-400 transition hover:bg-background-200 hover:text-primary-700 focus:bg-background-200 focus:text-primary-700" aria-label={text}>
        <i className="ri-information-line text-xs"></i>
      </button>
      <span className="pointer-events-none absolute left-1/2 top-6 z-20 hidden w-64 -translate-x-1/2 rounded-lg bg-foreground-950 px-3 py-2 text-[11px] font-normal leading-4 text-white shadow-xl peer-hover:block peer-focus:block">
        {text}
      </span>
    </span>
  );
}

function LinkButton({ href, label, icon }: { href: string; label: string; icon: string }) {
  const extension = fileExtension(label);
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-2 rounded-lg bg-primary-50 px-3 py-2 text-[12px] font-semibold text-primary-700 ring-1 ring-primary-100 transition hover:bg-primary-100">
      <i className={`${icon} shrink-0 text-sm`}></i>
      {extension && <span className="shrink-0 rounded bg-white/80 px-1.5 py-0.5 text-[9px] font-bold uppercase text-primary-700 ring-1 ring-primary-100">{extension}</span>}
      <span className="truncate">{label}</span>
      <i className="ri-external-link-line shrink-0 text-xs text-primary-500"></i>
    </a>
  );
}

function fileNameFromPath(value: string, fallback: string) {
  const normalized = String(value || '').trim();
  if (!normalized) return fallback;
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || fallback;
}

function fileExtension(value: string) {
  const match = fileNameFromPath(value, '').match(/\.([a-z0-9]{1,8})(?:$|\?)/i);
  return match?.[1] || '';
}

const penCursor = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%23111827' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M12 20h9'/%3E%3Cpath d='M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z'/%3E%3C/svg%3E") 2 22, auto`;

function SignoffCard({ label, signerName, onSignerNameChange, signature, onSignatureChange, confirmed, onConfirmedChange, signedAt }: { label: string; signerName: string; onSignerNameChange: (value: string) => void; signature: string; onSignatureChange: (value: string) => void; confirmed: boolean; onConfirmedChange: (value: boolean) => void; signedAt: string }) {
  const isReady = Boolean(signature && confirmed && signerName.trim());

  return (
    <div className="rounded-xl border border-background-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground-500">{label} sign-off</p>
          <p className="mt-0.5 text-[10px] text-foreground-400">{signedAt ? `Signed ${formatDate(signedAt)}` : 'Not signed yet'}</p>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${isReady ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700 ring-1 ring-amber-100'}`}>
          {isReady ? 'Ready' : 'Action needed'}
        </span>
      </div>
      <div className="space-y-3">
        <ActionStep number="1" title="Review confirmation" complete={confirmed}>
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-background-200 bg-background-50 p-3 text-[12px] leading-5 text-foreground-700 transition hover:border-primary-200 hover:bg-primary-50/30">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => onConfirmedChange(event.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-background-300 text-primary-600 focus:ring-primary-500"
            />
            <span>I confirm this evidence pack has been reviewed and is ready for sign-off.</span>
          </label>
        </ActionStep>
        <ActionStep number="2" title="Signer name" complete={Boolean(signerName.trim())}>
          <input
            value={signerName}
            onChange={(event) => onSignerNameChange(event.target.value)}
            className="h-11 w-full rounded-lg border border-background-200 bg-background-50 px-3 text-[13px] text-foreground-800 outline-none transition focus:border-primary-400 focus:bg-white focus:ring-2 focus:ring-primary-100"
            placeholder={`${label} full name`}
          />
        </ActionStep>
        <ActionStep number="3" title="Draw e-signature" complete={Boolean(signature)}>
          <SignatureCapture label={`${label} signature`} value={signature} onChange={onSignatureChange} />
        </ActionStep>
      </div>
    </div>
  );
}

function ActionStep({ number, title, complete, children }: { number: string; title: string; complete: boolean; children: ReactNode }) {
  return (
    <section className={`rounded-xl border p-3 transition ${complete ? 'border-emerald-100 bg-emerald-50/30' : 'border-amber-100 bg-amber-50/30'}`}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold ${complete ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
            {complete ? <i className="ri-check-line text-sm"></i> : number}
          </span>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground-600">{title}</p>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${complete ? 'text-emerald-700' : 'text-amber-700'}`}>
          {complete ? 'Done' : 'Required'}
        </span>
      </div>
      {children}
    </section>
  );
}

function SignatureCapture({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const padRef = useRef<SignaturePad | null>(null);
  const onChangeRef = useRef(onChange);
  const emittedValueRef = useRef('');
  const loadedValueRef = useRef('');
  const latestValueRef = useRef(value);
  const externalLoadIdRef = useRef(0);
  const isDrawingRef = useRef(false);
  const [hasInk, setHasInk] = useState(Boolean(value));

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    latestValueRef.current = value;
  }, [value]);

  const drawSignatureImage = useCallback((signatureValue: string, loadId: number) => {
    if (!signatureValue) return;
    const image = new Image();
    image.onload = () => {
      if (isDrawingRef.current || loadId !== externalLoadIdRef.current) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const context = canvas.getContext('2d');
      if (!context) return;
      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      context.drawImage(image, 0, 0, canvas.width / ratio, canvas.height / ratio);
      loadedValueRef.current = signatureValue;
      setHasInk(true);
    };
    image.src = signatureValue;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resizeCanvas = () => {
      const pad = padRef.current;
      const existingData = pad?.toData();
      const existingImage = loadedValueRef.current || emittedValueRef.current || latestValueRef.current;
      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(Math.floor(rect.width * ratio), 1);
      canvas.height = Math.max(Math.floor(rect.height * ratio), 1);
      const context = canvas.getContext('2d');
      context?.scale(ratio, ratio);
      if (pad && existingData?.length) {
        pad.clear();
        pad.fromData(existingData);
      } else if (existingImage) {
        const loadId = externalLoadIdRef.current + 1;
        externalLoadIdRef.current = loadId;
        drawSignatureImage(existingImage, loadId);
      }
    };

    const pad = new SignaturePad(canvas, {
      backgroundColor: 'rgb(255, 255, 255)',
      penColor: 'rgb(17, 24, 39)',
      minWidth: 0.8,
      maxWidth: 2.4,
      velocityFilterWeight: 0.7,
    });
    padRef.current = pad;
    resizeCanvas();

    const handleBeginStroke = () => {
      isDrawingRef.current = true;
      externalLoadIdRef.current += 1;
    };
    const handleEndStroke = () => {
      isDrawingRef.current = false;
      const signatureValue = pad.isEmpty() ? '' : pad.toDataURL('image/png');
      emittedValueRef.current = signatureValue;
      loadedValueRef.current = signatureValue;
      setHasInk(Boolean(signatureValue));
      onChangeRef.current(signatureValue);
    };
    pad.addEventListener('beginStroke', handleBeginStroke);
    pad.addEventListener('endStroke', handleEndStroke);

    const handleResize = () => resizeCanvas();
    window.addEventListener('resize', handleResize);

    return () => {
      pad.removeEventListener('beginStroke', handleBeginStroke);
      pad.removeEventListener('endStroke', handleEndStroke);
      pad.off();
      window.removeEventListener('resize', handleResize);
      padRef.current = null;
    };
  }, [drawSignatureImage]);

  useEffect(() => {
    const pad = padRef.current;
    if (!pad || value === loadedValueRef.current || value === emittedValueRef.current) return;

    if (!value) {
      pad.clear();
      emittedValueRef.current = '';
      loadedValueRef.current = '';
      setHasInk(false);
      return;
    }

    const loadId = externalLoadIdRef.current + 1;
    externalLoadIdRef.current = loadId;
    pad.clear();
    drawSignatureImage(value, loadId);
  }, [drawSignatureImage, value]);

  const clearSignature = () => {
    padRef.current?.clear();
    emittedValueRef.current = '';
    loadedValueRef.current = '';
    setHasInk(false);
    onChangeRef.current('');
  };

  return (
    <div className="rounded-lg border border-background-200 bg-white p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground-500">{label}</p>
          <p className="mt-0.5 text-[10px] text-foreground-400">Draw with mouse, touch, or stylus.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${hasInk ? 'bg-emerald-50 text-emerald-700' : 'bg-background-50 text-foreground-400 ring-1 ring-background-200'}`}>
            {hasInk ? 'Signed' : 'Not signed'}
          </span>
          <button
            type="button"
            onClick={clearSignature}
            disabled={!hasInk}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-background-200 bg-background-50 px-2.5 text-[11px] font-semibold text-foreground-600 transition hover:bg-background-100 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <i className="ri-eraser-line text-xs"></i>
            Clear
          </button>
        </div>
      </div>
      <div className="relative h-40 overflow-hidden rounded-lg border border-background-200 bg-white">
        <canvas ref={canvasRef} className="h-full w-full touch-none" style={{ cursor: penCursor }} />
        {!hasInk && <i className="ri-pen-nib-line pointer-events-none absolute right-4 top-4 text-lg text-foreground-300"></i>}
        <div className="pointer-events-none absolute inset-x-6 bottom-8 border-b border-dashed border-foreground-300"></div>
      </div>
    </div>
  );
}

function groupEvidenceByMonth(evidence: AuditEvidenceItem[]) {
  const groups = new Map<string, { key: string; label: string; sortValue: number; items: AuditEvidenceItem[] }>();

  evidence.forEach((item) => {
    const parsed = new Date(item.date);
    const hasDate = !Number.isNaN(parsed.getTime());
    const key = hasDate ? `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}` : 'unknown';
    const label = hasDate ? new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }).format(parsed) : 'No evidence date';
    const sortValue = hasDate ? new Date(parsed.getFullYear(), parsed.getMonth(), 1).getTime() : -1;
    const group = groups.get(key);
    if (group) {
      group.items.push(item);
    } else {
      groups.set(key, { key, label, sortValue, items: [item] });
    }
  });

  return Array.from(groups.values())
    .sort((left, right) => right.sortValue - left.sortValue)
    .map((group) => ({
      ...group,
      items: group.items.slice().sort((left, right) => sortableDate(right.date) - sortableDate(left.date)),
    }));
}

function statusDot(status: string) {
  const normalized = status.toLowerCase();
  if (normalized.includes('accept') || normalized.includes('confirm')) return 'bg-emerald-500';
  if (normalized.includes('reject') || normalized.includes('refer')) return 'bg-red-500';
  return 'bg-amber-500';
}

function statusPill(status: string) {
  const normalized = status.toLowerCase();
  if (normalized.includes('accept') || normalized.includes('confirm')) return 'bg-emerald-50 text-emerald-700';
  if (normalized.includes('reject') || normalized.includes('refer')) return 'bg-red-50 text-red-700';
  return 'bg-amber-50 text-amber-700';
}

function riskPill(risk: string): string {
  const normalized = risk.toLowerCase();
  if (normalized.includes('high')) return 'bg-red-50 text-red-700 ring-1 ring-red-100';
  if (normalized.includes('medium')) return 'bg-amber-50 text-amber-700 ring-1 ring-amber-100';
  if (normalized.includes('low')) return 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100';
  return 'bg-background-50 text-foreground-700 ring-1 ring-background-200';
}

function formatDate(value?: string | null, short = false) {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.startsWith('0001-01-01')) return '--';
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return normalized;
  return new Intl.DateTimeFormat('en-GB', short ? { day: '2-digit', month: 'short' } : { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(parsed);
}

function humanLabel(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()).trim();
}

function hasDisplayValue(value: string) {
  const normalized = String(value || '').trim().toLowerCase();
  return Boolean(
    normalized &&
    normalized !== '--' &&
    normalized !== 'none' &&
    normalized !== 'null' &&
    normalized !== 'not specified' &&
    normalized !== 'no risk' &&
    normalized !== 'no verdict' &&
    normalized !== 'no action recorded.'
  );
}

function riskTone(value: string): 'good' | 'warn' | 'bad' | 'neutral' {
  const normalized = value.toLowerCase();
  if (normalized.includes('high')) return 'bad';
  if (normalized.includes('medium')) return 'warn';
  if (normalized.includes('low')) return 'good';
  return 'neutral';
}

function scoreTone(value: string): 'good' | 'warn' | 'bad' | 'neutral' {
  const score = Number(value);
  if (Number.isNaN(score)) return 'neutral';
  if (score >= 75) return 'good';
  if (score >= 45) return 'warn';
  return 'bad';
}

function buildAuditPdf({ learner, audit, evidenceItems, signoff }: { learner: AuditLearnerSummary; audit: LearnerAuditResponse; evidenceItems: AuditEvidenceItem[]; signoff: AuditSignoffPayload }) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const page = { left: 16, right: 194, top: 16, bottom: 282, width: 178 };
  let y = page.top;

  const ensureSpace = (height: number) => {
    if (y + height > page.bottom) {
      doc.addPage();
      y = page.top;
    }
  };

  const addText = (text: string, options: { size?: number; bold?: boolean; color?: [number, number, number]; indent?: number; gap?: number } = {}) => {
    const x = page.left + (options.indent || 0);
    const maxWidth = page.width - (options.indent || 0);
    doc.setFont('helvetica', options.bold ? 'bold' : 'normal');
    doc.setFontSize(options.size || 10);
    const color = options.color || [17, 24, 39];
    doc.setTextColor(color[0], color[1], color[2]);
    const lines = doc.splitTextToSize(text || '--', maxWidth) as string[];
    ensureSpace(lines.length * 4.8 + 2);
    doc.text(lines, x, y);
    y += Math.max(options.gap || 5.5, lines.length * 4.8);
  };

  const divider = () => { doc.setDrawColor(226, 232, 240); doc.line(page.left, y, page.right, y); y += 6; };
  const sectionTitle = (title: string) => {
    ensureSpace(12);
    doc.setFillColor(246, 247, 251);
    doc.rect(page.left, y - 5, page.width, 9, 'F');
    addText(title, { size: 11, bold: true, color: [79, 70, 229], gap: 8 });
  };
  const keyValue = (label: string, value: string, x: number, width: number) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(107, 114, 128);
    doc.text(label.toUpperCase(), x, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(17, 24, 39);
    const lines = doc.splitTextToSize(value || '--', width) as string[];
    doc.text(lines, x, y + 5);
    return Math.max(12, 6 + lines.length * 4.5);
  };
  const factRow = (items: Array<{ label: string; value: string }>) => {
    ensureSpace(18);
    const columnWidth = (page.width - 6) / 3;
    const height = Math.max(...items.map((item, index) => keyValue(item.label, item.value, page.left + index * (columnWidth + 3), columnWidth)));
    y += height;
  };
  const bulletList = (title: string, items: string[], color: [number, number, number]) => {
    if (items.length === 0) return;
    addText(title, { bold: true, color });
    items.forEach((item) => addText(`- ${shorten(item, 260)}`, { color, indent: 4, gap: 5 }));
  };

  addText('Learner Audit Evidence Pack', { size: 18, bold: true, gap: 8 });
  divider();
  factRow([
    { label: 'Learner', value: learner.fullName || audit.learnerId },
    { label: 'Programme', value: learner.programName || cleanText(valueFrom(audit.learner || {}, ['program_name'])) || '--' },
    { label: 'Evidence Count', value: String(evidenceItems.length) },
  ]);
  divider();
  sectionTitle('Evidence Timeline');

  groupEvidenceByMonth(evidenceItems).forEach((group) => {
    addText(`${group.label} (${group.items.length})`, { size: 12, bold: true, color: [79, 70, 229], gap: 7 });
    group.items.forEach((item, index) => {
      ensureSpace(44);
      doc.setDrawColor(229, 231, 235);
      doc.setFillColor(255, 255, 255);
      doc.rect(page.left, y - 4, page.width, 1, 'S');
      addText(`${index + 1}. ${item.title}`, { size: 11, bold: true, gap: 7 });
      factRow([
        { label: 'Date', value: formatDate(item.date) },
        { label: 'Status / Type', value: `${item.status || '--'} / ${item.kind || '--'}` },
        { label: 'Hours', value: `${item.spentTime || '--'} (${humanLabel(item.spentTimeType) || 'Not specified'})` },
      ]);
      factRow([
        { label: 'Component', value: item.componentId || '--' },
        { label: 'Audit', value: `Score ${item.auditScore || '--'} | ${humanLabel(item.auditRisk) || 'No risk'} | ${humanLabel(item.auditVerdict) || 'No verdict'}` },
        { label: 'Review', value: humanLabel(item.reviewStatus || item.auditStatus) || '--' },
      ]);
      if (item.auditSummary) addText(`Summary: ${shorten(item.auditSummary, 520)}`, { color: [55, 65, 81], gap: 6 });
      if (item.recommendedAction) addText(`Recommended action: ${shorten(item.recommendedAction, 520)}`, { color: [146, 64, 14], gap: 6 });
      bulletList('Red flags', item.redFlags.slice(0, 3), [185, 28, 28]);
      bulletList('Missing requirements', item.missingRequirements.slice(0, 3), [146, 64, 14]);
      bulletList('Audit reasons', item.auditReasons.slice(0, 3), [75, 85, 99]);
      if (item.content) addText(`Evidence text: ${shorten(item.content, 520)}`, { color: [75, 85, 99], gap: 6 });
      if (item.noteContent && item.noteContent !== item.content) addText(`Note text: ${shorten(item.noteContent, 520)}`, { color: [75, 85, 99], gap: 6 });
      item.feedbacks.slice(0, 2).forEach((feedback) => addText(`Feedback (${formatDate(feedback.date)}): ${shorten(feedback.message || feedback.assessedStatus, 420)}`, { color: [6, 95, 70], gap: 6 }));
      if (item.fileUrl) addText(`File: ${fileNameFromPath(item.fileBlob || item.title, 'Evidence file')}`, { color: [79, 70, 229], gap: 5 });
      if (item.reportUrl) addText(`Report: ${fileNameFromPath(item.reportBlob, 'AssessmentReport.pdf')}`, { color: [79, 70, 229], gap: 5 });
      y += 4;
    });
  });

  divider();
  sectionTitle('Signatures');
  ensureSpace(45);
  y += 8;
  doc.setDrawColor(148, 163, 184);
  if (signoff.learnerSignature) {
    doc.addImage(signoff.learnerSignature, 'PNG', page.left, y - 14, 72, 24);
  }
  if (signoff.coachSignature) {
    doc.addImage(signoff.coachSignature, 'PNG', 118, y - 14, 72, 24);
  }
  doc.line(page.left, y + 12, 92, y + 12);
  doc.line(118, y + 12, 196, y + 12);
  y += 6;
  doc.setFontSize(10);
  doc.setTextColor(75, 85, 99);
  doc.text(`Learner: ${signoff.learnerSignerName || learner.fullName || '--'}`, page.left, y + 14);
  doc.text(`Coach: ${signoff.coachSignerName || '--'}`, 118, y + 14);
  doc.setFontSize(8);
  doc.text(`Confirmed: ${signoff.learnerConfirmed ? 'Yes' : 'No'} | Signed: ${formatDate(signoff.learnerSignedAt)}`, page.left, y + 20);
  doc.text(`Confirmed: ${signoff.coachConfirmed ? 'Yes' : 'No'} | Signed: ${formatDate(signoff.coachSignedAt)}`, 118, y + 20);
  return doc;
}

function downloadPdf({ learner, audit, evidenceItems, signoff }: { learner: AuditLearnerSummary; audit: LearnerAuditResponse; evidenceItems: AuditEvidenceItem[]; signoff: AuditSignoffPayload }) {
  const doc = buildAuditPdf({ learner, audit, evidenceItems, signoff });
  doc.save(`audit-pack-${fileSegment(learner.fullName || audit.learnerId)}.pdf`);
}

function fileSegment(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'learner';
}
