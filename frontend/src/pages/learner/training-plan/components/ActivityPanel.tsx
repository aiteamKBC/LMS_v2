import { TrainingActivity, ACTIVITY_TYPE_META, STATUS_META } from '@/mocks/training-plan';

interface ActivityPanelProps {
  activity: TrainingActivity | null;
  onClose: () => void;
}

export default function ActivityPanel({ activity, onClose }: ActivityPanelProps) {
  if (!activity) return null;

  const typeMeta = ACTIVITY_TYPE_META[activity.type] || ACTIVITY_TYPE_META['Evidence'];
  const statusMeta = STATUS_META[activity.status] || STATUS_META['Not Started'];
  const isCompleted = activity.status === 'Completed';
  const isReferred = activity.status === 'Referred';
  const isOverdue = activity.status === 'overdue';
  const isInProgress = activity.status === 'In Progress';

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/20 z-40"
        onClick={onClose}
      />
      {/* Panel */}
      <div className="fixed top-0 right-0 h-full w-[460px] max-w-full bg-background-50 shadow-2xl z-50 flex flex-col border-l border-background-200/50">
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-foreground-400/50">
          <div className="flex-1 pr-3">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2 py-1 rounded-full ${typeMeta.bg} ${typeMeta.color}`}>
                <i className={`${activity.typeIcon || typeMeta.icon} text-xs`}></i>
                {typeMeta.label}
              </span>
              {activity.isLive && (
                <span className="text-xs font-semibold text-red-600 bg-red-50 px-2 py-0.5 rounded-full animate-pulse">LIVE</span>
              )}
              <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full ${statusMeta.bg} ${statusMeta.color}`}>
                <span className={`inline-block w-1.5 h-1.5 rounded-full ${statusMeta.dot || 'bg-current'}`}></span>
                {statusMeta.label}
              </span>
            </div>
            <h2 className="text-[16px] font-heading font-bold text-foreground-900 leading-snug">{activity.title}</h2>
            <p className="text-sm text-foreground-400 mt-1">
              {activity.month} · {activity.weekLabel ? activity.weekLabel : `Week ${activity.weekNumber}`}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-background-100 transition-colors cursor-pointer shrink-0"
          >
            <i className="ri-close-line text-foreground-400 text-lg"></i>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Key Info Grid */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-background-100/60 rounded-xl p-3">
              <p className="text-xs text-foreground-400 uppercase tracking-wider font-semibold mb-1">Due Date</p>
              <p className={`text-sm font-semibold ${isOverdue ? 'text-red-600' : 'text-foreground-900'}`}>
                {isOverdue && <i className="ri-error-warning-fill mr-1 text-red-500"></i>}
                {activity.dueDate}
              </p>
            </div>
            <div className="bg-background-100/60 rounded-xl p-3">
              <p className="text-xs text-foreground-400 uppercase tracking-wider font-semibold mb-1">Duration</p>
              <p className="text-sm font-semibold text-foreground-900">{activity.duration}</p>
            </div>
            <div className="bg-background-100/60 rounded-xl p-3">
              <p className="text-xs text-foreground-400 uppercase tracking-wider font-semibold mb-1">Planned OTJH</p>
              <p className="text-sm font-semibold text-foreground-900">{activity.plannedOTJH} hrs</p>
            </div>
            <div className="bg-background-100/60 rounded-xl p-3">
              <p className="text-xs text-foreground-400 uppercase tracking-wider font-semibold mb-1">Actual OTJH</p>
              <p className={`text-sm font-semibold ${activity.actualOTJH > 0 ? 'text-emerald-600' : 'text-foreground-400'}`}>
                {activity.actualOTJH > 0 ? `${activity.actualOTJH} hrs` : 'Not logged yet'}
              </p>
            </div>
            <div className="bg-background-100/60 rounded-xl p-3">
              <p className="text-xs text-foreground-400 uppercase tracking-wider font-semibold mb-1">Points</p>
              <p className="text-sm font-semibold text-amber-600">{activity.points} pts</p>
            </div>
            <div className="bg-background-100/60 rounded-xl p-3">
              <p className="text-xs text-foreground-400 uppercase tracking-wider font-semibold mb-1">Assessment</p>
              <p className="text-sm font-semibold text-foreground-900">
                {activity.assessmentMethod === 'ai-assisted' ? 'AI Assisted' : activity.assessmentMethod === 'tutor-assessed' ? 'Tutor Assessed' : 'Standard'}
              </p>
            </div>
          </div>

          {/* Completed summary */}
          {isCompleted && (
            <div className="bg-background-50 border border-foreground-200/50 rounded-xl p-4">
              <h3 className="text-xs text-foreground-400 uppercase tracking-wider font-semibold mb-3">Completed Summary</h3>
              <div className="space-y-2.5">
                <SummaryRow label="Completed Date" value={activity.completedDate || '—'} />
                <SummaryRow label="Evidence Submitted" value={activity.evidenceSubmittedDate || '—'} />
                <SummaryRow label="Coach Approval" value={activity.coachApprovedDate || '—'} />
                <SummaryRow label="QA Approval" value={activity.qaApprovedDate || '—'} />
                <SummaryRow label="OTJH Awarded" value={`${activity.otjhAwarded || activity.plannedOTJH} hours`} />
                <SummaryRow label="Points Earned" value={`${activity.pointsEarned || activity.points} pts`} />
                {activity.ksbsAchieved && activity.ksbsAchieved.length > 0 && (
                  <div>
                    <p className="text-xs text-foreground-400 font-semibold mb-1.5">KSBs Achieved</p>
                    <div className="flex flex-wrap gap-1">
                      {activity.ksbsAchieved.map(k => (
                        <span key={k} className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200">{k}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Referred details */}
          {isReferred && (
            <div className="bg-red-50/60 border border-red-200/50 rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-2">
                <span className="w-7 h-7 rounded-full bg-red-100 flex items-center justify-center shrink-0">
                  <i className="ri-arrow-go-back-line text-red-600 text-sm"></i>
                </span>
                <h3 className="text-sm font-semibold text-red-800">Submission Referred</h3>
              </div>
              {activity.referralReason && (
                <div>
                  <p className="text-xs text-red-500 uppercase tracking-wider font-semibold mb-1">Reason for Referral</p>
                  <p className="text-sm text-red-700 leading-relaxed">{activity.referralReason}</p>
                </div>
              )}
              {activity.referralSource && (
                <div>
                  <p className="text-xs text-red-500 uppercase tracking-wider font-semibold mb-1">Referral Source</p>
                  <p className="text-sm text-red-700">{activity.referralSource}</p>
                </div>
              )}
              {activity.requiredActions && (
                <div>
                  <p className="text-xs text-red-500 uppercase tracking-wider font-semibold mb-1">Required Actions</p>
                  <p className="text-sm text-red-700 leading-relaxed whitespace-pre-line">{activity.requiredActions}</p>
                </div>
              )}
            </div>
          )}

          {/* Feedback */}
          {activity.coachFeedback && (
            <div className="bg-background-50 border border-foreground-200/50 rounded-xl p-4">
              <h3 className="text-xs text-foreground-400 uppercase tracking-wider font-semibold mb-2">Coach Feedback</h3>
              <p className="text-sm text-foreground-700 leading-relaxed">{activity.coachFeedback.text}</p>
              <p className="text-xs text-foreground-400 mt-2">{activity.coachFeedback.from} · {activity.coachFeedback.date}</p>
            </div>
          )}
          {activity.aiFeedback && (
            <div className="bg-background-50 border border-foreground-200/50 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <i className="ri-robot-line text-primary-500"></i>
                <h3 className="text-xs text-foreground-400 uppercase tracking-wider font-semibold">AI Assessment</h3>
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-primary-100 text-primary-700">{activity.aiFeedback.score}%</span>
              </div>
              <p className="text-sm text-foreground-700 leading-relaxed">{activity.aiFeedback.summary}</p>
            </div>
          )}

          {/* KSBs */}
          {activity.ksbs && activity.ksbs.length > 0 && (
            <div>
              <h4 className="text-xs text-foreground-400 uppercase tracking-wider font-semibold mb-2">KSBs Developed</h4>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {activity.ksbs.map(ksb => (
                  <span key={ksb} className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${
                    ksb.startsWith('K') ? 'bg-primary-100 text-primary-700 border-primary-200' :
                    ksb.startsWith('S') ? 'bg-accent-100 text-accent-700 border-accent-200' :
                    'bg-secondary-100 text-secondary-700 border-secondary-200'
                  }`}>
                    {ksb}
                  </span>
                ))}
              </div>
              {activity.ksbLabels && (
                <p className="text-sm text-foreground-500 leading-relaxed">{activity.ksbLabels}</p>
              )}
            </div>
          )}

          {/* Instructions */}
          {activity.instructions && (
            <div>
              <h4 className="text-xs text-foreground-400 uppercase tracking-wider font-semibold mb-2">Instructions</h4>
              <div className="bg-background-100/60 rounded-xl p-4">
                <p className="text-sm text-foreground-700 leading-relaxed whitespace-pre-line">{activity.instructions}</p>
              </div>
            </div>
          )}

          {/* Complete When */}
          {activity.completeWhen && (
            <div>
              <h4 className="text-xs text-foreground-400 uppercase tracking-wider font-semibold mb-2">Complete When</h4>
              <div className="flex items-start gap-2 bg-primary-50/60 border border-primary-100 rounded-xl p-4">
                <i className="ri-checkbox-circle-line text-primary-500 text-sm mt-0.5 shrink-0"></i>
                <p className="text-sm text-primary-800 leading-relaxed">{activity.completeWhen}</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-5 border-t border-background-200/50 space-y-2">
          {isCompleted ? (
            <div className="flex items-center justify-center gap-2 py-2.5 bg-emerald-50 border border-emerald-200 rounded-xl text-sm font-semibold text-emerald-700">
              <i className="ri-checkbox-circle-fill text-emerald-500"></i>
              Component Completed &amp; Validated
            </div>
          ) : isReferred ? (
            <>
              <button className="w-full py-2.5 bg-red-500 text-white rounded-xl text-sm font-semibold hover:bg-red-600 transition-colors cursor-pointer whitespace-nowrap">
                <i className="ri-edit-line mr-2"></i>Update Submission
              </button>
              <button className="w-full py-2.5 bg-background-100 text-foreground-600 rounded-xl text-sm font-medium hover:bg-background-200 transition-colors cursor-pointer whitespace-nowrap">
                <i className="ri-message-3-line mr-2"></i>Message Coach
              </button>
            </>
          ) : isOverdue ? (
            <>
              <button className="w-full py-2.5 bg-red-500 text-white rounded-xl text-sm font-semibold hover:bg-red-600 transition-colors cursor-pointer whitespace-nowrap">
                <i className="ri-upload-2-line mr-2"></i>Submit Now — Overdue
              </button>
              <button className="w-full py-2.5 bg-background-100 text-foreground-600 rounded-xl text-sm font-medium hover:bg-background-200 transition-colors cursor-pointer whitespace-nowrap">
                <i className="ri-message-3-line mr-2"></i>Message Coach
              </button>
            </>
          ) : isInProgress ? (
            <>
              <button className="w-full py-2.5 bg-accent-500 text-foreground-950 rounded-xl text-sm font-semibold hover:bg-accent-600 transition-colors cursor-pointer whitespace-nowrap">
                <i className="ri-play-circle-line mr-2"></i>Continue Learning
              </button>
              <button className="w-full py-2.5 bg-background-100 text-foreground-600 rounded-xl text-sm font-medium hover:bg-background-200 transition-colors cursor-pointer whitespace-nowrap">
                <i className="ri-file-add-line mr-2"></i>Log Evidence
              </button>
            </>
          ) : activity.status === 'Evidence Required' ? (
            <>
              <button className="w-full py-2.5 bg-amber-500 text-foreground-950 rounded-xl text-sm font-semibold hover:bg-amber-600 transition-colors cursor-pointer whitespace-nowrap">
                <i className="ri-file-add-line mr-2"></i>Log Evidence
              </button>
              <button className="w-full py-2.5 bg-background-100 text-foreground-600 rounded-xl text-sm font-medium hover:bg-background-200 transition-colors cursor-pointer whitespace-nowrap">
                <i className="ri-eye-line mr-2"></i>View Details
              </button>
            </>
          ) : activity.status === 'Evidence Submitted' ? (
            <>
              <button className="w-full py-2.5 bg-primary-500 text-white rounded-xl text-sm font-semibold hover:bg-primary-600 transition-colors cursor-pointer whitespace-nowrap">
                <i className="ri-file-list-line mr-2"></i>View Submission
              </button>
              <button className="w-full py-2.5 bg-background-100 text-foreground-600 rounded-xl text-sm font-medium hover:bg-background-200 transition-colors cursor-pointer whitespace-nowrap">
                <i className="ri-edit-line mr-2"></i>Update Evidence
              </button>
            </>
          ) : (
            <>
              <button className="w-full py-2.5 bg-primary-500 text-white rounded-xl text-sm font-semibold hover:bg-primary-600 transition-colors cursor-pointer whitespace-nowrap">
                <i className="ri-play-circle-line mr-2"></i>Start Learning
              </button>
              <button className="w-full py-2.5 bg-background-100 text-foreground-600 rounded-xl text-sm font-medium hover:bg-background-200 transition-colors cursor-pointer whitespace-nowrap">
                <i className="ri-eye-line mr-2"></i>View in Portfolio
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-foreground-400">{label}</span>
      <span className="font-medium text-foreground-700 text-right">{value}</span>
    </div>
  );
}