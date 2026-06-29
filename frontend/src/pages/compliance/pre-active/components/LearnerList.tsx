import { useState, useMemo } from 'react';
import type { PreActiveLearner } from '@/mocks/pre-active-learners';
import { PRE_ACTIVE_LEARNERS } from '@/mocks/pre-active-learners';

interface LearnerListProps {
  selectedId: string;
  onSelect: (learner: PreActiveLearner) => void;
}

export function LearnerList({ selectedId, onSelect }: LearnerListProps) {
  const [filterStage, setFilterStage] = useState<string>('all');
  const [filterRisk, setFilterRisk] = useState<string>('all');
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    return PRE_ACTIVE_LEARNERS.filter(l => {
      if (filterRisk !== 'all' && l.riskStatus !== filterRisk) return false;
      if (search && !l.name.toLowerCase().includes(search.toLowerCase()) && !l.employer.toLowerCase().includes(search.toLowerCase())) return false;
      if (filterStage !== 'all') {
        const stageKey = getStageKey(l.currentStageIndex);
        if (stageKey !== filterStage) return false;
      }
      return true;
    });
  }, [filterStage, filterRisk, search]);

  return (
    <div className="bg-background-50 rounded-xl border border-background-200/50 p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-heading font-semibold text-foreground-900">
          Pre-Active Caseload
          <span className="text-[11px] text-foreground-400 font-normal ml-2">{PRE_ACTIVE_LEARNERS.length} learners</span>
        </h3>
      </div>

      {/* Filters */}
      <div className="space-y-2 mb-4">
        <div className="relative">
          <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-300 text-sm"></i>
          <input
            type="text"
            placeholder="Search learners or employers..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-[13px] rounded-lg border border-foreground-200 bg-background-50 focus:border-primary-300 focus:ring-1 focus:ring-primary-300/30 outline-none transition-smooth"
          />
        </div>
        <div className="flex items-center gap-2">
          <select
            value={filterRisk}
            onChange={(e) => setFilterRisk(e.target.value)}
            className="text-[12px] px-3 py-1.5 rounded-lg border border-foreground-200 bg-background-50 text-foreground-600 cursor-pointer outline-none"
          >
            <option value="all">All Risks</option>
            <option value="Low">Low Risk</option>
            <option value="Medium">Medium Risk</option>
            <option value="High">High Risk</option>
          </select>
          <select
            value={filterStage}
            onChange={(e) => setFilterStage(e.target.value)}
            className="text-[12px] px-3 py-1.5 rounded-lg border border-foreground-200 bg-background-50 text-foreground-600 cursor-pointer outline-none"
          >
            <option value="all">All Stages</option>
            <option value="lead">Lead / Campaign</option>
            <option value="induction">Induction</option>
            <option value="employer-contracting">Employer Contracting</option>
            <option value="self-onboarding">Self-Onboarding</option>
            <option value="enrolment-review">Enrolment Review</option>
            <option value="eligibility">Eligibility Review</option>
            <option value="initial-assessment">Initial Assessment</option>
            <option value="rpl">RPL / Skills Scan</option>
            <option value="compliance-pack">Compliance Pack</option>
            <option value="signatures">Digital Signatures</option>
            <option value="das">DAS Tracker</option>
            <option value="ilr">ILR Readiness</option>
            <option value="qa">QA Final Review</option>
            <option value="activation">Activation Setup</option>
          </select>
        </div>
      </div>

      {/* Learner cards */}
      <div className="space-y-2 max-h-[calc(100vh-520px)] min-h-[300px] overflow-y-auto pr-1">
        {filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="w-10 h-10 rounded-full bg-background-100 flex items-center justify-center mb-3">
              <i className="ri-search-line text-foreground-300"></i>
            </div>
            <p className="text-[13px] text-foreground-500">No learners match your filters</p>
            <button
              onClick={() => { setFilterStage('all'); setFilterRisk('all'); setSearch(''); }}
              className="text-[12px] text-primary-600 hover:text-primary-700 mt-1 cursor-pointer"
            >
              Clear all filters
            </button>
          </div>
        )}
        {filtered.map(learner => (
          <LearnerCard
            key={learner.id}
            learner={learner}
            isSelected={learner.id === selectedId}
            onClick={() => onSelect(learner)}
          />
        ))}
      </div>
    </div>
  );
}

function LearnerCard({ learner, isSelected, onClick }: {
  learner: PreActiveLearner;
  isSelected: boolean;
  onClick: () => void;
}) {
  const riskConfig: Record<string, string> = {
    'Low': 'bg-emerald-100 text-emerald-700',
    'Medium': 'bg-amber-100 text-amber-700',
    'High': 'bg-red-100 text-red-700',
  };

  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-3 rounded-xl border transition-smooth cursor-pointer ${
        isSelected
          ? 'bg-primary-50/80 border-primary-200/50 shadow-[0_0_12px_-3px_rgba(var(--glow-purple)_/_0.08)]'
          : 'bg-background-50 border-background-200/50 hover:border-background-300/70 hover:bg-background-100/50'
      }`}
    >
      <div className="flex items-center gap-3">
        {/* Avatar */}
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
          isSelected ? 'bg-primary-100 text-primary-700' : 'bg-background-100 text-foreground-500'
        }`}>
          <span className="text-sm font-semibold">{learner.name.charAt(0)}</span>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className={`text-[13px] font-medium truncate ${isSelected ? 'text-primary-900' : 'text-foreground-900'}`}>
              {learner.name}
            </p>
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 ${riskConfig[learner.riskStatus] || 'bg-background-100 text-foreground-400'}`}>
              {learner.riskStatus}
            </span>
          </div>
          <p className="text-[11px] text-foreground-400 truncate">{learner.programme}</p>
        </div>

        <div className="text-right shrink-0">
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${getOverallBadge(learner.overallStatus)}`}>
            {getShortStatusLabel(learner.overallStatus)}
          </span>
          <p className="text-[10px] text-foreground-400 mt-0.5">Stage {learner.currentStageIndex + 1}/15</p>
        </div>
      </div>

      {/* Quick status strip */}
      <div className="flex items-center gap-2 mt-2 pt-2 border-t border-background-200/50">
        <MiniStatus label="C" status={learner.complianceStatus} />
        <MiniStatus label="E" status={learner.eligibilityStatus} />
        <MiniStatus label="S" status={learner.signatureStatus} />
        <MiniStatus label="D" status={learner.dasStatus} />
        <MiniStatus label="I" status={learner.ilrStatus} />
        <MiniStatus label="Q" status={learner.qaStatus} />
        <span className="text-[9px] text-foreground-300 ml-auto">{learner.daysSinceLastUpdate}d ago</span>
      </div>
    </button>
  );
}

function MiniStatus({ label, status }: { label: string; status: string }) {
  const config: Record<string, string> = {
    'Compliant': 'bg-emerald-500',
    'Eligible': 'bg-emerald-500',
    'Fully Signed': 'bg-emerald-500',
    'Confirmed': 'bg-emerald-500',
    'Ready': 'bg-emerald-500',
    'Approved': 'bg-emerald-500',
    'Completed': 'bg-emerald-500',
    'In Progress': 'bg-amber-400',
    'Partially Signed': 'bg-amber-400',
    'Pending': 'bg-amber-400',
    'Pending Review': 'bg-amber-400',
    'Not Started': 'bg-foreground-200',
    'N/A': 'bg-foreground-300',
    'Not Assessed': 'bg-foreground-200',
    'Not Ready': 'bg-foreground-200',
  };
  const color = config[status] || 'bg-foreground-200';
  return (
    <div className="flex items-center gap-1 shrink-0" title={`${label}: ${status}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${color}`}></span>
      <span className="text-[9px] text-foreground-400 font-medium">{label}</span>
    </div>
  );
}

function getOverallBadge(status: string): string {
  const map: Record<string, string> = {
    'Candidate': 'bg-background-100 text-foreground-500',
    'Proceeding': 'bg-emerald-50 text-emerald-700',
    'Evidence Required': 'bg-amber-50 text-amber-700',
    'Employer In Review': 'bg-amber-50 text-amber-700',
    'No Show': 'bg-red-50 text-red-700',
    'Awaiting Employer Signature': 'bg-amber-50 text-amber-700',
    'Ready for QA': 'bg-primary-50 text-primary-700',
    'Activation Pending': 'bg-emerald-50 text-emerald-700',
  };
  return map[status] || 'bg-background-100 text-foreground-500';
}

function getShortStatusLabel(status: string): string {
  const map: Record<string, string> = {
    'Candidate': 'Candidate',
    'Proceeding': 'Proceeding',
    'Evidence Required': 'Evidence Needed',
    'Employer In Review': 'Employer Review',
    'No Show': 'No Show',
    'Awaiting Employer Signature': 'Awaiting Sig.',
    'Ready for QA': 'Ready for QA',
    'Activation Pending': 'Activation Pending',
  };
  return map[status] || status;
}

function getStageKey(index: number): string {
  const keys = [
    'lead', 'induction', 'employer-contracting', 'self-onboarding',
    'enrolment-review', 'eligibility', 'initial-assessment', 'rpl',
    'compliance-pack', 'signatures', 'das', 'ilr', 'qa', 'activation', 'active',
  ];
  return keys[index] || 'lead';
}