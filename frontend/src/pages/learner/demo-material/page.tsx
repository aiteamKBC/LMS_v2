import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { fetchDemoMaterial, type DemoMaterialAsset, type DemoMaterialTable } from '@/api/demoMaterials';
import { AppIcon } from '@/components/feature/AppIcon';
import { SignOutConfirmModal } from '@/components/feature/Header';
import { RowsSkeleton } from '@/components/feature/Skeletons';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageContainer } from '@/components/ui/PageContainer';
import { Panel } from '@/components/ui/Panel';
import { useAuth } from '@/hooks/useAuth';
import { roleNavMap } from '@/mocks/navigation';

function assetMinutes(asset: DemoMaterialAsset): number {
  if (asset.expected_otjh && asset.expected_otjh > 0) return Math.round(asset.expected_otjh * 60);
  return asset.duration_minutes || 0;
}

function formatMinutes(minutes: number): string {
  if (!minutes) return 'Time not specified';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours ? `${hours}h ${rest}m` : `${rest}m`;
}

function contentIcon(kind: string): string {
  if (kind === 'video') return 'ri-video-line';
  if (kind === 'quiz') return 'ri-questionnaire-line';
  if (kind === 'audio') return 'ri-headphone-line';
  if (kind === 'presentation') return 'ri-slideshow-line';
  return 'ri-file-text-line';
}

export default function DemoMaterialPage() {
  const { materialKey = '', kind, id } = useParams<{ materialKey: string; kind?: string; id?: string }>();
  const { auth, logout } = useAuth();
  const [material, setMaterial] = useState<DemoMaterialTable | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [signOutOpen, setSignOutOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    fetchDemoMaterial(materialKey)
      .then((value) => { if (!cancelled) setMaterial(value); })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Could not load material.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [materialKey]);

  const groups = useMemo(() => {
    const grouped = new Map<string, DemoMaterialAsset[]>();
    for (const asset of material?.results || []) {
      const label = asset.week_title || (asset.week_number != null ? `Week ${asset.week_number}` : 'Learning content');
      grouped.set(label, [...(grouped.get(label) || []), asset]);
    }
    return [...grouped.entries()];
  }, [material]);
  const backHref = kind && id ? `/workspace/learner/${kind}/${id}` : '/learner/materials';
  const learnerNav = roleNavMap.learner;
  const displayName = auth.account?.displayName || auth.user?.email || 'Learner';

  return (
    <WorkspaceShell
      role="learner"
      roleLabel={learnerNav.label}
      navItems={learnerNav.items}
      workspaceLabel={learnerNav.workspaceLabel}
      pageTitle={material?.name || 'Material'}
      userName={displayName}
      showBackButton
      breadcrumbCurrentLabel={material?.name || 'Material'}
    >
      <PageContainer>
        <div className="mb-5 overflow-hidden rounded-3xl bg-gradient-to-br from-primary-800 via-primary-600 to-violet-400 px-6 py-7 text-white shadow-lg md:px-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <span className="grid h-14 w-14 place-items-center rounded-2xl bg-white/15 ring-1 ring-white/20">
                <AppIcon className="ri-book-open-line text-2xl" />
              </span>
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/65">Learning material</p>
                <h1 className="mt-1 text-2xl font-heading font-bold text-white">{material?.name || 'Material'}</h1>
                {material && <p className="mt-1 text-[13px] text-white/75">{material.count} components · {formatMinutes(material.expectedMinutes)}</p>}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Link to={backHref} className="inline-flex h-11 items-center gap-2 rounded-xl bg-white/10 px-4 text-[12px] font-semibold text-white ring-1 ring-white/20 hover:bg-white/20">
                <AppIcon className="ri-arrow-left-line" /> Back to materials
              </Link>
              <button type="button" onClick={() => setSignOutOpen(true)} className="inline-flex h-11 items-center gap-2 rounded-xl bg-white/10 px-4 text-[12px] font-semibold text-white ring-1 ring-white/20 hover:bg-white/20">
                <AppIcon className="ri-logout-box-r-line" /> Logout
              </button>
            </div>
          </div>
        </div>

        {loading ? <RowsSkeleton rows={6} /> : error ? (
          <EmptyState title="Could not load material" description={error} />
        ) : groups.length === 0 ? (
          <EmptyState title="No published content" description="This material table is currently empty." />
        ) : (
          <div className="space-y-4">
            {groups.map(([week, assets], index) => (
              <Panel key={week}>
                <details open={index === 0}>
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
                    <div>
                      <h2 className="font-heading text-base font-bold text-foreground-900">{week}</h2>
                      <p className="mt-0.5 text-[12px] text-foreground-400">{assets.length} components</p>
                    </div>
                    <AppIcon className="ri-arrow-down-s-line text-lg text-foreground-400" />
                  </summary>
                  <div className="mt-4 divide-y divide-foreground-100 border-t border-foreground-100">
                    {assets.map((asset) => {
                      const href = asset.source_url || asset.embed_url;
                      return (
                        <div key={asset.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                          <div className="flex min-w-0 items-center gap-3">
                            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary-100 text-primary-600">
                              <AppIcon className={contentIcon(asset.content_kind)} />
                            </span>
                            <div className="min-w-0">
                              <p className="truncate text-[13px] font-semibold text-foreground-900">{asset.title}</p>
                              <p className="mt-0.5 text-[11px] text-foreground-400">{asset.content_kind || asset.component_type} · {formatMinutes(assetMinutes(asset))}</p>
                            </div>
                          </div>
                          {href ? (
                            <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-2 text-[11px] font-semibold text-white hover:bg-primary-700">
                              Open <AppIcon className="ri-external-link-line" />
                            </a>
                          ) : (
                            <span className="rounded-lg bg-background-100 px-3 py-2 text-[11px] font-semibold text-foreground-400">LMS activity</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </details>
              </Panel>
            ))}
          </div>
        )}
      </PageContainer>

      {signOutOpen && (
        <SignOutConfirmModal
          displayName={displayName}
          email={auth.user?.email || auth.account?.email || 'Signed in'}
          onClose={() => setSignOutOpen(false)}
          onConfirm={() => { setSignOutOpen(false); logout(); }}
        />
      )}
    </WorkspaceShell>
  );
}
