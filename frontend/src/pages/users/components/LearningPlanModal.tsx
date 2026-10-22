import { formatHours, formatPlanDate } from '@/api/learningPlan';
import { useLearningPlanEditor, type LearningPlanEditorProps } from './useLearningPlanEditor';
import { Modal } from './Modal';
import { btnPrimary, btnSecondary, inputClass } from './ui';
import { RowsSkeleton, SkeletonBlock } from '@/components/feature/Skeletons';

export function LearningPlanModal(props: LearningPlanEditorProps) {
  return <LearningPlanForm key={props.learnerId} {...props} />;
}

function LearningPlanForm(props: LearningPlanEditorProps) {
  const { learnerName, onClose, readOnly = false } = props;
  const {
    data, plan, loading, saving, error, search,
    setSearch, picker, setPicker, pickerProgramme, setPickerProgramme, place,
    setPlace, programmeOptions, cohortOptions, groupOptions, placing, freeCourses,
    freeCourseOptions, freeCoursesLoading, freeCoursePicker, setFreeCoursePicker, needsPlacement, addable,
    moduleHours, meetings, meetingsEmptyMessage, meetingHours, totalHours, canSave,
    remove, add, addFreeCourse, removeFreeCourse, resetToGroup, savePlacement,
    save, learner,
  } = useLearningPlanEditor(props);
  return (
    <Modal
      title={
        <span className="flex items-baseline gap-2">
          <span>Learning plan</span>
          <span className="text-[12px] font-normal text-foreground-400">{learnerName}</span>
        </span>
      }
      onClose={onClose}
      size="max-w-4xl"
      footer={
        <div className="flex items-center justify-between gap-3 w-full">
          <span className="text-[12px] text-foreground-500">
            {needsPlacement ? (
              'A programme, cohort and group decide which modules this plan can hold.'
            ) : (
              <>
                {plan.length} module{plan.length === 1 ? '' : 's'}
                {meetings.length > 0 && ` · ${meetings.length} meeting${meetings.length === 1 ? '' : 's'}`} ·{' '}
                <strong className="text-foreground-800">{formatHours(totalHours)}</strong> total
              </>
            )}
          </span>
          {needsPlacement && !readOnly ? (
            <span className="flex items-center gap-2">
              <button type="button" className={btnSecondary} onClick={onClose} disabled={placing}>
                Cancel
              </button>
              <button
                type="button"
                className={btnPrimary}
                onClick={savePlacement}
                disabled={placing || !place.programme || !place.cohort || !place.group}
                title={
                  place.programme && place.cohort && place.group
                    ? undefined
                    : 'Choose a programme, cohort and group first.'
                }
              >
                {placing ? 'Saving…' : 'Save and continue'}
              </button>
            </span>
          ) : readOnly ? (
            <button type="button" className={btnSecondary} onClick={onClose}>
              Close
            </button>
          ) : (
            <span className="flex items-center gap-2">
              <button type="button" className={btnSecondary} onClick={onClose} disabled={saving}>
                Cancel
              </button>
              <button
                type="button"
                className={btnPrimary}
                onClick={save}
                disabled={saving || !canSave}
                title={
                  canSave || saving
                    ? undefined
                    : plan.length === 0
                      ? 'Add at least one module to save this plan.'
                      : 'This plan is already saved as it stands.'
                }
              >
                {saving ? 'Saving…' : 'Save learning plan'}
              </button>
            </span>
          )}
        </div>
      }
    >
      {loading ? (
        // Shaped like the plan it is standing in for: the context line, then the
        // module table.
        <div className="space-y-5">
          <SkeletonBlock className="h-2.5 w-64" />
          <div className="rounded-xl border border-foreground-200/60 p-4">
            <RowsSkeleton rows={3} avatar={false} />
          </div>
        </div>
      ) : error && !data ? (
        <p className="py-10 text-center text-[13px] text-red-600">{error}</p>
      ) : needsPlacement ? (
        <div className="space-y-5">
          <div className="rounded-xl border border-amber-200/70 bg-amber-50/60 px-4 py-3">
            <p className="text-[13px] font-semibold text-amber-900">
              {learnerName} is not on a programme yet
            </p>
            <p className="mt-1 text-[12px] text-amber-800">
              A learning plan is built from the modules a group is taught, so this learner needs a
              programme, a cohort and a group before there is anything to plan. Choosing them here
              saves them to the learner&rsquo;s record.
            </p>
          </div>

          {error && <p className="text-[12px] text-red-600">{error}</p>}

          {readOnly ? (
            <p className="py-6 text-center text-[13px] text-foreground-400">
              This learner has no programme, cohort or group. They are past the stage where the plan
              is edited here, so this has to be set on their record.
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-3">
              <label className="block">
                <span className="mb-1.5 block text-[12px] font-semibold text-foreground-600">
                  Programme
                </span>
                <select
                  className={inputClass}
                  value={place.programme}
                  // A cohort belongs to one programme and a group to one cohort,
                  // so changing either clears what sat underneath it.
                  onChange={(e) => setPlace({ programme: e.target.value, cohort: '', group: '' })}
                >
                  <option value="">Choose a programme…</option>
                  {programmeOptions.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-1.5 block text-[12px] font-semibold text-foreground-600">
                  Cohort
                </span>
                <select
                  className={inputClass}
                  value={place.cohort}
                  disabled={!place.programme}
                  onChange={(e) => setPlace((current) => ({ ...current, cohort: e.target.value, group: '' }))}
                >
                  <option value="">
                    {place.programme ? 'Choose a cohort…' : 'Pick a programme first'}
                  </option>
                  {cohortOptions.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
                {/* Says where to go rather than leaving an empty list to be read
                    as a loading state that never finishes. */}
                {place.programme && cohortOptions.length === 0 && (
                  <span className="mt-1 block text-[11px] text-amber-700">
                    {place.programme} has no cohorts yet — add one in Curriculum Studio.
                  </span>
                )}
              </label>

              <label className="block">
                <span className="mb-1.5 block text-[12px] font-semibold text-foreground-600">
                  Group
                </span>
                <select
                  className={inputClass}
                  value={place.group}
                  disabled={!place.cohort}
                  onChange={(e) => setPlace((current) => ({ ...current, group: e.target.value }))}
                >
                  <option value="">
                    {place.cohort ? 'Choose a group…' : 'Pick a cohort first'}
                  </option>
                  {groupOptions.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
                {place.cohort && groupOptions.length === 0 && (
                  <span className="mt-1 block text-[11px] text-amber-700">
                    {place.cohort} has no groups yet — add one in Curriculum Studio.
                  </span>
                )}
              </label>
            </div>
          )}

          {/* A plan saved before this — against no programme — is still on the
              record, and its modules are why the reader may be here at all. */}
          {plan.length > 0 && (
            <p className="text-[12px] text-foreground-500">
              This learner already has {plan.length} module{plan.length === 1 ? '' : 's'} saved
              against no programme. They will still be listed once the placement is saved, marked
              as not in the catalogue where they no longer resolve.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-5">
          {/* Context: which programme/group this plan came from. */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[12px] text-foreground-500">
            <span>
              Programme: <strong className="text-foreground-800">{learner?.programme || '—'}</strong>
            </span>
            <span>
              Group: <strong className="text-foreground-800">{learner?.group || '—'}</strong>
            </span>
            {!data?.saved && (
              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                Pre-filled from group — not saved yet
              </span>
            )}
            {/* Says why there is nothing to change here, rather than leaving the
                missing controls to be read as a bug. */}
            {readOnly && (
              <span className="rounded-full bg-background-100 px-2 py-0.5 text-[11px] font-semibold text-foreground-500">
                View only — a plan is edited while the learner is in Delivery
              </span>
            )}
          </div>

          {error && <p className="text-[12px] text-red-600">{error}</p>}

          {/* The plan itself. */}
          <div className="rounded-xl border border-foreground-200/60 overflow-hidden">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-background-100/60 text-left">
                  <th className="py-2 px-3 font-semibold text-foreground-600">Module</th>
                  <th className="py-2 px-3 font-semibold text-foreground-600">Group</th>
                  <th className="py-2 px-3 font-semibold text-foreground-600">Start</th>
                  <th className="py-2 px-3 font-semibold text-foreground-600">End</th>
                  <th className="py-2 px-3 font-semibold text-foreground-600 text-right">Hours</th>
                  {!readOnly && <th className="py-2 px-3 w-10" />}
                </tr>
              </thead>
              <tbody>
                {plan.length === 0 && (
                  <tr>
                    <td colSpan={readOnly ? 5 : 6} className="py-8 text-center text-foreground-400">
                      {readOnly
                        ? 'No modules on this plan.'
                        : 'No modules on this plan yet — add one below.'}
                    </td>
                  </tr>
                )}
                {plan.map((m) => (
                  <tr key={m.moduleId} className="border-t border-foreground-200/50">
                    <td className="py-2 px-3 text-foreground-900">
                      {m.moduleTitle}
                      {m.orphaned && (
                        <span
                          className="ml-2 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700"
                          title="Saved on this plan but no longer in the module catalogue"
                        >
                          Not in catalogue
                        </span>
                      )}
                      {/* Arrived from the group after this plan was agreed. The
                          learner is taught it either way; saving records it. */}
                      {/* Taught through the Aptem import but never recorded on
                          the plan. Saving is what writes it to the learner. */}
                      {m.fromAptem && (
                        <span
                          className="ml-2 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700"
                          title="This learner is enrolled in this subject through their Aptem import. Save to record it on the plan."
                        >
                          From Aptem
                        </span>
                      )}
                      {m.inherited && (
                        <span
                          className="ml-2 rounded-full bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700"
                          title={`Added to ${learner?.group || 'this group'} since this plan was agreed. Save to record it on the plan.`}
                        >
                          New from group
                        </span>
                      )}
                      {/* A module borrowed from another programme maps to
                          different KSBs and funding, so the plan says which. */}
                      {learner && m.programmeId && m.programmeId !== learner.programmeId && (
                        <span
                          className="ml-2 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700"
                          title={`From the ${m.programmeName} programme, not ${learner.programme}`}
                        >
                          {m.programmeName}
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-3 text-foreground-500">{m.groupName || '—'}</td>
                    <td className="py-2 px-3 whitespace-nowrap text-foreground-500">
                      {formatPlanDate(m.startDate)}
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap text-foreground-500">
                      {formatPlanDate(m.endDate)}
                    </td>
                    <td className="py-2 px-3 text-right font-medium text-foreground-700">
                      {formatHours(m.hours)}
                    </td>
                    {!readOnly && (
                      <td className="py-2 px-3 text-right">
                        <button
                          type="button"
                          onClick={() => remove(m.moduleId)}
                          title={`Remove ${m.moduleTitle}`}
                          className="text-foreground-400 hover:text-red-600 cursor-pointer"
                        >
                          <i className="ri-close-line" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-foreground-300/50 bg-background-100/40">
                  <td className="py-2 px-3 font-semibold text-foreground-700" colSpan={4}>
                    {/* Module hours alone once meetings are listed too, so the
                        column still adds up to the number beneath it. */}
                    {meetings.length > 0 ? 'Modules total' : 'Total'}
                  </td>
                  <td className="py-2 px-3 text-right font-bold text-foreground-900">
                    {formatHours(moduleHours)}
                  </td>
                  {!readOnly && <td />}
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Recurring Reviews that count as off-the-job training. A separate
              table because these are not chosen here: Curriculum's Review
              templates and the learner's own start date generate them, so
              there is nothing to add or remove — only hours to account for. */}
          {/* Always rendered, even with no rows: see meetingsEmptyMessage. */}
          <div>
              <div className="flex items-baseline justify-between gap-3 mb-2">
                <h3 className="text-[13px] font-semibold text-foreground-800">Meetings</h3>
                <span className="text-[11px] text-foreground-500">
                  Scheduled from this learner&apos;s start date — not editable here
                </span>
              </div>
              <div className="rounded-xl border border-foreground-200/60 overflow-hidden">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="bg-background-100/60 text-left">
                      <th className="py-2 px-3 font-semibold text-foreground-600">Meeting</th>
                      <th className="py-2 px-3 font-semibold text-foreground-600">Frequency</th>
                      <th className="py-2 px-3 font-semibold text-foreground-600">Start</th>
                      <th className="py-2 px-3 font-semibold text-foreground-600">End</th>
                      <th className="py-2 px-3 font-semibold text-foreground-600 text-right">Hours</th>
                      {!readOnly && <th className="py-2 px-3 w-10" />}
                    </tr>
                  </thead>
                  <tbody>
                    {meetings.length === 0 && (
                      <tr>
                        <td
                          colSpan={readOnly ? 5 : 6}
                          className="py-6 px-3 text-center text-foreground-400"
                        >
                          {meetingsEmptyMessage}
                        </td>
                      </tr>
                    )}
                    {meetings.map((m) => (
                      <tr key={m.reviewTemplateId} className="border-t border-foreground-200/50">
                        <td className="py-2 px-3 text-foreground-900">
                          {m.name}
                          {/* Where the hours come from, so a total that looks
                              large can be checked against its own arithmetic. */}
                          <span className="ml-2 text-[11px] text-foreground-500">
                            {formatHours(m.hoursEach)} × {m.occurrences}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-foreground-500">{m.recurrenceLabel || '—'}</td>
                        <td className="py-2 px-3 whitespace-nowrap text-foreground-500">
                          {formatPlanDate(m.startDate)}
                        </td>
                        <td className="py-2 px-3 whitespace-nowrap text-foreground-500">
                          {formatPlanDate(m.endDate)}
                        </td>
                        <td className="py-2 px-3 text-right font-medium text-foreground-700">
                          {formatHours(m.hours)}
                        </td>
                        {!readOnly && <td className="py-2 px-3" />}
                      </tr>
                    ))}
                  </tbody>
                  {meetings.length > 0 && (
                    <tfoot>
                      <tr className="border-t-2 border-foreground-300/50 bg-background-100/40">
                        <td className="py-2 px-3 font-semibold text-foreground-700" colSpan={4}>
                          Meetings total
                        </td>
                        <td className="py-2 px-3 text-right font-bold text-foreground-900">
                          {formatHours(meetingHours)}
                        </td>
                        {!readOnly && <td />}
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
              {/* The two tables above are halves of one commitment. Only worth
                  printing once meetings actually add something: with none, it
                  would just restate the modules total directly beneath it. */}
              {meetings.length > 0 && (
                <div className="mt-2 flex items-baseline justify-end gap-2 text-[13px]">
                  <span className="font-semibold text-foreground-700">Plan total</span>
                  <strong className="text-foreground-900">{formatHours(totalHours)}</strong>
                </div>
              )}
            </div>

          {/* Add a module from anywhere in the catalogue. Absent when viewing:
              nothing here is meaningful without a save. */}
          {!readOnly && (
            <div>
              <div className="flex items-center justify-between gap-3 mb-2">
                <button
                  type="button"
                  onClick={() => setPicker((v) => !v)}
                  className="text-[12px] font-semibold text-primary-600 hover:underline cursor-pointer"
                >
                  <i className={`ri-${picker ? 'subtract' : 'add'}-line mr-1`} />
                  Add a module
                </button>
                {data && data.preset.length > 0 && (
                  <button
                    type="button"
                    onClick={resetToGroup}
                    className="text-[12px] text-foreground-500 hover:text-foreground-800 hover:underline cursor-pointer"
                  >
                    Reset to group default
                  </button>
                )}
              </div>

              {picker && (
                <div className="rounded-xl border border-foreground-200/60 p-3 space-y-2">
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <select
                      className={`${inputClass} sm:max-w-[16rem]`}
                      value={pickerProgramme}
                      onChange={(e) => setPickerProgramme(e.target.value)}
                      aria-label="Programme to add modules from"
                    >
                      <option value="">All programmes</option>
                      {(data?.programmes ?? []).map((p) => (
                        <option key={p.programmeId} value={p.programmeId}>
                          {p.programmeName} ({p.moduleCount})
                        </option>
                      ))}
                    </select>
                    <input
                      className={inputClass}
                      placeholder="Search modules…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </div>
                  <div className="max-h-56 overflow-y-auto divide-y divide-foreground-200/40">
                    {addable.length === 0 && (
                      <p className="py-4 text-center text-[12px] text-foreground-400">
                        {search.trim()
                          ? 'No modules match that search.'
                          : 'No modules left to add here.'}
                      </p>
                    )}
                    {addable.map((m) => (
                      <div key={m.moduleId} className="flex items-center gap-3 py-2">
                        <span className="flex-1 min-w-0">
                          <span className="block truncate text-[13px] text-foreground-900">{m.moduleTitle}</span>
                          <span className="block text-[11px] text-foreground-400">
                            {m.groupName || 'No group'} · {formatHours(m.hours)}
                            {/* Its window, where it has one — the same dates the
                                plan table will show once it is added. */}
                            {m.startDate && m.endDate && ` · ${formatPlanDate(m.startDate)} – ${formatPlanDate(m.endDate)}`}
                          </span>
                          {/* Only worth saying when it is not where you would
                              expect the module to come from. */}
                          {learner && m.programmeId && m.programmeId !== learner.programmeId && (
                            <span className="mt-0.5 inline-block rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                              {m.programmeName}
                            </span>
                          )}
                        </span>
                        <button
                          type="button"
                          onClick={() => add(m)}
                          className="rounded-lg border border-foreground-200 px-2.5 py-1 text-[11px] font-semibold text-foreground-600 hover:border-primary-300 hover:bg-primary-50/60 hover:text-primary-700 cursor-pointer whitespace-nowrap"
                        >
                          Add
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Free courses — optional extras assigned to the learner. Held apart
              from the modules above: no hours, no KSBs, no progress, and no
              programme/group needed. */}
          <div>
            <div className="flex items-baseline justify-between gap-3 mb-2">
              <h3 className="text-[13px] font-semibold text-foreground-800">Free courses</h3>
              <span className="text-[11px] text-foreground-500">Extras — no hours or KSBs</span>
            </div>

            {freeCourses.length === 0 ? (
              <p className="text-[12px] text-foreground-400">
                {readOnly ? 'No free courses assigned.' : 'No free courses assigned yet — add one below.'}
              </p>
            ) : (
              <ul className="rounded-xl border border-foreground-200/60 divide-y divide-foreground-200/40">
                {freeCourses.map((f) => (
                  <li key={f.freeCourseId} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="text-[13px] text-foreground-900 inline-flex items-center gap-2 min-w-0">
                      <i className="ri-gift-line text-primary-600 shrink-0" />
                      <span className="truncate">{f.courseName || f.freeCourseId}</span>
                    </span>
                    {!readOnly && (
                      <button
                        type="button"
                        onClick={() => removeFreeCourse(f.freeCourseId)}
                        title={`Remove ${f.courseName || f.freeCourseId}`}
                        className="text-foreground-400 hover:text-red-600 cursor-pointer shrink-0"
                      >
                        <i className="ri-close-line" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {!readOnly && (() => {
              const assigned = new Set(freeCourses.map((f) => f.freeCourseId));
              const available = freeCourseOptions.filter((o) => !assigned.has(o.freeCourseId));
              // Distinguish "still loading" from "genuinely none left": an empty
              // dropdown during the cold-cache fetch otherwise reads as broken.
              const placeholder = freeCoursesLoading
                ? 'Loading free courses…'
                : available.length === 0
                  ? 'No free courses to add'
                  : 'Add a free course…';
              return (
                <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                  <select
                    className={`${inputClass} sm:max-w-[20rem]`}
                    value={freeCoursePicker}
                    onChange={(e) => setFreeCoursePicker(e.target.value)}
                    disabled={freeCoursesLoading || available.length === 0}
                    aria-label="Free course to add"
                  >
                    <option value="">{placeholder}</option>
                    {available.map((o) => (
                      <option key={o.freeCourseId} value={o.freeCourseId}>{o.courseName}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className={btnSecondary}
                    disabled={!freeCoursePicker}
                    onClick={() => {
                      const option = freeCourseOptions.find((o) => o.freeCourseId === freeCoursePicker);
                      if (option) addFreeCourse(option);
                    }}
                  >
                    Add free course
                  </button>
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </Modal>
  );
}
