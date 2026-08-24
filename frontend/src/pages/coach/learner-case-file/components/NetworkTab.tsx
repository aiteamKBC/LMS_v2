import { useMemo, useState } from 'react';
import { EmptyState } from '@/components/ui/EmptyState';
import { MetricCard } from '@/components/ui/MetricCard';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { type StatusTone } from '@/lib/statusTone';
import { LearnerAvatar } from '@/pages/coach/shared/LearnerIdentity';
import { formatPercent, type CaseFileTabProps } from '../data';

interface NetworkLearnerRow {
  id: string;
  name: string;
  initials: string;
  employer: string;
  group: string;
  progress: number | null;
  ksbProgress: number | null;
  evidenceCount: number | null;
  status: string;
  isSelected: boolean;
}

export default function NetworkTab({ data }: CaseFileTabProps) {
  const [searchTerm, setSearchTerm] = useState('');

  const rows = useMemo<NetworkLearnerRow[]>(() => {
    const selected: NetworkLearnerRow = {
      id: data.learnerId,
      name: data.displayName,
      initials: data.initials,
      employer: data.employer,
      group: data.group,
      progress: data.overallProgress,
      ksbProgress: data.ksbProgress,
      evidenceCount: data.evidenceCount,
      status: data.snapshot?.status || 'selected',
      isSelected: true,
    };

    const peers = data.peers.map((peer) => ({
      id: peer.id,
      name: peer.name,
      initials: peer.initials,
      employer: peer.employer,
      group: peer.group,
      progress: peer.overallProgress,
      ksbProgress: peer.ksbProgress,
      evidenceCount: peer.evidenceCount,
      status: peer.status,
      isSelected: false,
    }));

    return [selected, ...peers];
  }, [data]);

  const filteredRows = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    if (!query) {
      return rows;
    }
    return rows.filter((row) =>
      row.name.toLowerCase().includes(query)
      || row.employer.toLowerCase().includes(query)
      || row.group.toLowerCase().includes(query),
    );
  }, [rows, searchTerm]);

  const peerRows = rows.filter((row) => !row.isSelected);
  const sameEmployerPeers = peerRows.filter((row) => row.employer.trim().toLowerCase() === data.employer.trim().toLowerCase());
  const averageProgress = average(rows.map((row) => row.progress));
  const atRiskPeers = peerRows.filter((row) => row.status === 'at-risk').length;
  const leaderboard = [...rows].sort((left, right) => numericValue(right.progress) - numericValue(left.progress));

  return (
    <div className="space-y-5">
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MetricCard icon="ri-group-line" label="Cohort Peers" value={peerRows.length} tone="brand" />
        <MetricCard icon="ri-building-2-line" label="Same Employer" value={sameEmployerPeers.length} tone="upcoming" />
        <MetricCard icon="ri-line-chart-line" label="Cohort Avg Progress" value={formatPercent(averageProgress)} tone="positive" />
        <MetricCard icon="ri-alert-line" label="At Risk Peers" value={atRiskPeers} tone="caution" />
      </section>

      <section className="flex items-center gap-3">
        <div className="relative flex-1">
          <AppIcon className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></AppIcon>
          <input
            type="text"
            placeholder="Search by learner, employer, or group..."
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-background-50 border border-foreground-200/60 text-[13px] text-foreground-900 placeholder:text-foreground-400 outline-none focus:border-primary-300/50 transition-all"
          />
        </div>
        <span className="text-[12px] text-foreground-400 shrink-0">{filteredRows.length} learner(s)</span>
      </section>

      <section className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
        <div className="p-5 md:p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-heading font-semibold text-foreground-900 flex items-center gap-2">
              <AppIcon className="ri-team-line text-primary-500"></AppIcon> Cohort Connections
            </h2>
            <span className="text-[12px] text-foreground-400">Live caseload cohort view</span>
          </div>
          {peerRows.length === 0 ? (
            <EmptyState
              variant="empty"
              size="sm"
              title="No cohort peers"
              description="No same-cohort peers were returned for this learner."
            />
          ) : filteredRows.length === 0 ? (
            <EmptyState
              variant="no-matches"
              size="sm"
              title={`No peers match "${searchTerm.trim()}"`}
            />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {filteredRows.map((row) => (
                <div
                  key={row.id}
                  className={`rounded-xl border p-4 transition-all ${row.isSelected ? 'border-primary-200 bg-primary-50/30' : 'border-foreground-200/60 bg-background-100/50'}`}
                >
                  <div className="flex items-start gap-3">
                    <LearnerAvatar name={row.name} initials={row.initials} size="lg" tone={row.isSelected ? 'brand' : 'neutral'} />
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="text-[13px] font-semibold text-foreground-900">{row.name}</h4>
                        <StatusBadge tone={networkTone(row.status, row.isSelected)} label={statusLabel(row.status, row.isSelected)} />
                      </div>
                      <p className="text-[12px] text-foreground-400 mt-1">{row.employer || '--'}</p>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-[12px] text-foreground-500">
                        <span>Group {row.group || '--'}</span>
                        <span>Progress {formatPercent(row.progress)}</span>
                        <span>KSB {formatPercent(row.ksbProgress)}</span>
                        <span>{row.evidenceCount ?? 0} evidence</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
        <div className="p-5 md:p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-heading font-semibold text-foreground-900 flex items-center gap-2">
              <AppIcon className="ri-bar-chart-grouped-line text-accent-500"></AppIcon> Cohort Leaderboard
            </h2>
            <span className="text-[12px] text-foreground-400">Ranked by overall progress</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-background-200">
                  <th className="pb-3 text-[12px] font-semibold text-foreground-400 uppercase tracking-wider w-8">#</th>
                  <th className="pb-3 text-[12px] font-semibold text-foreground-400 uppercase tracking-wider">Learner</th>
                  <th className="pb-3 text-[12px] font-semibold text-foreground-400 uppercase tracking-wider text-center">Progress</th>
                  <th className="pb-3 text-[12px] font-semibold text-foreground-400 uppercase tracking-wider text-center">KSB</th>
                  <th className="pb-3 text-[12px] font-semibold text-foreground-400 uppercase tracking-wider text-center">Evidence</th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.map((row, index) => (
                  <tr key={row.id} className={`border-b border-background-100 transition-all ${row.isSelected ? 'bg-primary-50/30' : 'hover:bg-background-100/30'}`}>
                    <td className="py-2.5 text-[12px] font-bold text-foreground-400">
                      {index === 0 ? <AppIcon className="ri-medal-fill text-amber-500"></AppIcon> : <span className="text-[12px]">{index + 1}</span>}
                    </td>
                    <td className="py-2.5">
                      <div className="flex items-center gap-2">
                        <LearnerAvatar name={row.name} initials={row.initials} size="sm" tone={row.isSelected ? 'brand' : 'neutral'} />
                        <div>
                          <p className={`text-[12px] font-medium ${row.isSelected ? 'text-primary-700' : 'text-foreground-900'}`}>
                            {row.name}{row.isSelected ? ' (Selected learner)' : ''}
                          </p>
                          <p className="text-[12px] text-foreground-400">{row.employer || '--'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-2.5 text-center text-[12px] font-semibold text-foreground-700">{formatPercent(row.progress)}</td>
                    <td className="py-2.5 text-center text-[12px] font-semibold text-foreground-700">{formatPercent(row.ksbProgress)}</td>
                    <td className="py-2.5 text-center text-[12px] text-foreground-500">{row.evidenceCount ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[12px] text-foreground-400 mt-4">
            Peer attendance is not shown here because this page only has learner-level live attendance for the selected learner.
          </p>
        </div>
      </section>
    </div>
  );
}

function average(values: Array<number | null>) {
  const numbers = values.filter((value): value is number => value !== null && !Number.isNaN(value));
  if (numbers.length === 0) return null;
  return Math.round(numbers.reduce((sum, value) => sum + value, 0) / numbers.length);
}

function numericValue(value: number | null) {
  return value === null || Number.isNaN(value) ? -1 : value;
}

function statusLabel(status: string, isSelected: boolean) {
  if (isSelected) return 'Selected learner';
  if (status === 'at-risk') return 'At risk';
  if (status === 'high') return 'High performer';
  if (status === 'new-starter') return 'New starter';
  return 'On track';
}

function networkTone(status: string, isSelected: boolean): StatusTone {
  if (isSelected) return 'brand';
  if (status === 'at-risk') return 'critical';
  if (status === 'high') return 'positive';
  if (status === 'new-starter') return 'caution';
  return 'positive';
}
