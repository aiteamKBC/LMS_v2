import { useMemo, useState } from 'react';
import { EmptyState } from '@/pages/users/components/ui';
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
        <StatCard icon="ri-group-line" label="Cohort Peers" value={String(peerRows.length)} tone="primary" />
        <StatCard icon="ri-building-2-line" label="Same Employer" value={String(sameEmployerPeers.length)} tone="accent" />
        <StatCard icon="ri-line-chart-line" label="Cohort Avg Progress" value={formatPercent(averageProgress)} tone="emerald" />
        <StatCard icon="ri-alert-line" label="At Risk Peers" value={String(atRiskPeers)} tone="amber" />
      </section>

      <section className="flex items-center gap-3">
        <div className="relative flex-1">
          <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></i>
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
              <i className="ri-team-line text-primary-500"></i> Cohort Connections
            </h2>
            <span className="text-[11px] text-foreground-400">Live caseload cohort view</span>
          </div>
          {peerRows.length === 0 ? (
            <EmptyState text="No same-cohort peers were returned for this learner." />
          ) : filteredRows.length === 0 ? (
            <EmptyState text={`No peers matched "${searchTerm.trim()}".`} />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {filteredRows.map((row) => (
                <div
                  key={row.id}
                  className={`rounded-xl border p-4 transition-all ${row.isSelected ? 'border-primary-200 bg-primary-50/30' : 'border-foreground-200/60 bg-background-100/50'}`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`w-11 h-11 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${row.isSelected ? 'bg-primary-500 text-white' : 'bg-background-200 text-foreground-700'}`}>
                      {row.initials}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="text-[13px] font-semibold text-foreground-900">{row.name}</h4>
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${statusBadge(row.status, row.isSelected)}`}>
                          {statusLabel(row.status, row.isSelected)}
                        </span>
                      </div>
                      <p className="text-[11px] text-foreground-400 mt-1">{row.employer || '--'}</p>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-[11px] text-foreground-500">
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
              <i className="ri-bar-chart-grouped-line text-accent-500"></i> Cohort Leaderboard
            </h2>
            <span className="text-[11px] text-foreground-400">Ranked by overall progress</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-background-200">
                  <th className="pb-3 text-[11px] font-semibold text-foreground-400 uppercase tracking-wider w-8">#</th>
                  <th className="pb-3 text-[11px] font-semibold text-foreground-400 uppercase tracking-wider">Learner</th>
                  <th className="pb-3 text-[11px] font-semibold text-foreground-400 uppercase tracking-wider text-center">Progress</th>
                  <th className="pb-3 text-[11px] font-semibold text-foreground-400 uppercase tracking-wider text-center">KSB</th>
                  <th className="pb-3 text-[11px] font-semibold text-foreground-400 uppercase tracking-wider text-center">Evidence</th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.map((row, index) => (
                  <tr key={row.id} className={`border-b border-background-100 transition-all ${row.isSelected ? 'bg-primary-50/30' : 'hover:bg-background-100/30'}`}>
                    <td className="py-2.5 text-[12px] font-bold text-foreground-400">
                      {index === 0 ? <i className="ri-medal-fill text-amber-500"></i> : <span className="text-[11px]">{index + 1}</span>}
                    </td>
                    <td className="py-2.5">
                      <div className="flex items-center gap-2">
                        <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold ${row.isSelected ? 'bg-primary-500 text-white' : 'bg-background-200 text-foreground-700'}`}>
                          {row.initials}
                        </span>
                        <div>
                          <p className={`text-[12px] font-medium ${row.isSelected ? 'text-primary-700' : 'text-foreground-900'}`}>
                            {row.name}{row.isSelected ? ' (Selected learner)' : ''}
                          </p>
                          <p className="text-[10px] text-foreground-400">{row.employer || '--'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-2.5 text-center text-[12px] font-semibold text-foreground-700">{formatPercent(row.progress)}</td>
                    <td className="py-2.5 text-center text-[12px] font-semibold text-foreground-700">{formatPercent(row.ksbProgress)}</td>
                    <td className="py-2.5 text-center text-[11px] text-foreground-500">{row.evidenceCount ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-foreground-400 mt-4">
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

function statusBadge(status: string, isSelected: boolean) {
  if (isSelected) return 'bg-primary-50 text-primary-700 border-primary-200';
  if (status === 'at-risk') return 'bg-red-50 text-red-700 border-red-200';
  if (status === 'high') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (status === 'new-starter') return 'bg-amber-50 text-amber-700 border-amber-200';
  return 'bg-background-50 text-foreground-600 border-background-200';
}

function StatCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: string;
  label: string;
  value: string;
  tone: 'primary' | 'accent' | 'emerald' | 'amber';
}) {
  const toneMap = {
    primary: 'bg-primary-100 text-primary-600',
    accent: 'bg-accent-100 text-accent-600',
    emerald: 'bg-emerald-100 text-emerald-600',
    amber: 'bg-amber-100 text-amber-600',
  } as const;

  return (
    <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4">
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center mb-3 ${toneMap[tone]}`}>
        <i className={`${icon} text-base`}></i>
      </div>
      <p className="text-xl font-heading font-bold text-foreground-900">{value}</p>
      <p className="text-[11px] text-foreground-400">{label}</p>
    </div>
  );
}
