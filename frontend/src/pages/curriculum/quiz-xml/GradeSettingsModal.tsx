import { useState, type ReactNode } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import { ThemedSelect } from '@/components/feature/ThemedSelect';
import { showCurriculumConfirm } from '@/components/feature/CurriculumSweetAlert';
import { formatQuizGradeRange, type QuizGradeRow, type QuizGradeSettings } from '@/lib/quizGradeSettings';

export function GradeSettingsModal({
  settings,
  onChange,
  onClose,
  onSaved,
  saving = false,
  error = '',
  onReload,
}: {
  settings: QuizGradeSettings;
  onChange: (settings: QuizGradeSettings) => void;
  onClose: () => void;
  onSaved: () => void;
  saving?: boolean;
  error?: string;
  onReload?: () => void;
}) {
  const [newGrade, setNewGrade] = useState({ grade: '', point: '', min: '', color: '#1d7df2' });
  const [draggedGradeKey, setDraggedGradeKey] = useState<string | null>(null);
  const [dragOverGradeKey, setDragOverGradeKey] = useState<string | null>(null);

  const gradeRowKey = (row: QuizGradeRow) => `${row.grade}-${row.min}-${row.point}`;

  const updateSettings = (patch: Partial<QuizGradeSettings>) => {
    onChange({ ...settings, ...patch });
  };

  const deleteRow = (row: QuizGradeRow) => {
    const nextRows = settings.rows.filter(item => !(item.grade === row.grade && item.min === row.min && item.point === row.point));
    if (!nextRows.length) return;
    onChange({ ...settings, rows: nextRows });
  };

  const confirmDeleteRow = async (row: QuizGradeRow) => {
    await showCurriculumConfirm({
      title: `Delete ${row.grade} grade?`,
      text: `Are you sure you want to delete the ${row.grade} grade from the default quiz grades table?`,
      icon: 'warning',
      confirmButtonText: 'Delete grade',
      onConfirm: () => deleteRow(row),
    });
  };

  const addRow = () => {
    const grade = newGrade.grade.trim();
    const point = Number(newGrade.point);
    const min = Math.round(Number(newGrade.min));
    if (!grade || !Number.isFinite(point) || !Number.isFinite(min)) return;
    onChange({
      ...settings,
      rows: [
        ...settings.rows,
        {
          grade,
          point,
          min: Math.max(0, Math.min(100, min)),
          color: newGrade.color,
        },
      ],
    });
    setNewGrade({ grade: '', point: '', min: '', color: '#1d7df2' });
  };

  const moveGradeRow = (sourceIndex: number, targetIndex: number) => {
    if (sourceIndex === targetIndex) return;
    const nextRows = [...settings.rows];
    const [moved] = nextRows.splice(sourceIndex, 1);
    nextRows.splice(targetIndex, 0, moved);
    onChange({ ...settings, rows: nextRows });
  };

  const moveDraggedGradeOver = (targetIndex: number) => {
    if (!draggedGradeKey) return;
    const sourceIndex = settings.rows.findIndex(row => gradeRowKey(row) === draggedGradeKey);
    if (sourceIndex === -1 || sourceIndex === targetIndex) return;
    moveGradeRow(sourceIndex, targetIndex);
  };

  const finishGradeDrag = () => {
    setDraggedGradeKey(null);
    setDragOverGradeKey(null);
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/45 p-4 sm:p-6" onClick={onClose} onKeyDown={event => { if (event.key === 'Escape' && !saving) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label="Grade settings" className="min-w-0 w-full max-w-4xl rounded-2xl bg-[#eef3f6] p-5 sm:p-6 shadow-2xl border border-white/70" onClick={event => event.stopPropagation()}>
        <div className="mb-6 flex items-center justify-between gap-4">
          <h3 className="text-2xl font-heading font-bold text-[#10233d]">Grades Settings</h3>
          <button type="button" aria-label="Close grade settings" disabled={saving} onClick={onClose} className="h-9 w-9 shrink-0 rounded-full bg-white text-[#64748b] hover:bg-[#e2e8f0]">
            <AppIcon className="ri-close-line text-lg"></AppIcon>
          </button>
        </div>

        {error && <p role="alert" className="mb-3 text-sm text-red-700">{error}</p>}
        {error && onReload && <button type="button" disabled={saving} onClick={onReload} className="mb-3 text-sm text-primary-700">Reload saved settings (discard changes)</button>}
        <button type="button" disabled={saving} onClick={onSaved} className="mb-4 rounded-lg bg-primary-600 px-4 py-2 text-white disabled:opacity-50">{saving ? 'Saving...' : 'Save grade settings'}</button>
        <fieldset disabled={saving} className="min-w-0 space-y-3">
          <GradeSettingRow title="Result display" subtitle="Select the format to display scores to student">
            <ThemedSelect
              value={settings.resultDisplay}
              options={[
                { value: 'grade', label: 'Grade' },
                { value: 'percentage', label: 'Percentage' },
                { value: 'points', label: 'Points' },
                { value: 'grade_percentage', label: 'Grade and percentage' },
              ]}
              onChange={resultDisplay => {
                updateSettings({ resultDisplay });
              }}
              buttonClassName="h-9 bg-[#f8fafc]"
            />
          </GradeSettingRow>

          <GradeSettingRow title="Score Separator" subtitle="Choose the symbol or text to separate the score from the maximum value">
            <input
              value={settings.scoreSeparator}
              onChange={event => updateSettings({ scoreSeparator: event.target.value })}
              className="h-9 w-full rounded-md border border-[#b9c4d1] bg-[#f8fafc] px-3 text-sm outline-none focus:border-[#5b2dbb] focus:ring-2 focus:ring-[#ede9fe]"
            />
          </GradeSettingRow>

          <GradeSettingRow title="Grade table on learner quiz page" subtitle="Choose where learners can view the grading scale before starting">
            <ThemedSelect
              value={settings.coursePageDisplay}
              options={[
                { value: 'separate_tab', label: 'Show as separate tab' },
                { value: 'inside_quiz', label: 'Show in quiz overview' },
                { value: 'hidden', label: 'Hide grading scale' },
              ]}
              onChange={coursePageDisplay => {
                updateSettings({ coursePageDisplay });
              }}
              buttonClassName="h-9 bg-[#f8fafc]"
            />
          </GradeSettingRow>

          <section className="min-w-0 rounded-lg bg-white px-4 py-5">
            <h4 className="mb-3 text-2xl font-heading font-bold text-[#0f172a]">Grades Table</h4>
            <div className="overflow-x-auto rounded border border-[#d5deea]">
              <table className="w-full min-w-[500px] text-left">
                <thead>
                  <tr className="border-b border-[#d5deea] bg-white">
                    <th className="w-10 px-3 py-3 text-xs font-bold text-[#0f172a]"></th>
                    <th className="px-4 py-3 text-xs font-bold text-[#0f172a]">Grade name</th>
                    <th className="px-4 py-3 text-xs font-bold text-[#0f172a]">Grade point</th>
                    <th className="px-4 py-3 text-xs font-bold text-[#0f172a]">Grade range</th>
                    <th className="w-16 px-4 py-3 text-xs font-bold text-[#0f172a]"></th>
                  </tr>
                </thead>
                <tbody>
                  {settings.rows.map((row, index) => (
                    <tr
                      key={gradeRowKey(row)}
                      draggable
                      onDragStart={event => {
                        setDraggedGradeKey(gradeRowKey(row));
                        event.dataTransfer.effectAllowed = 'move';
                        event.dataTransfer.setData('text/plain', gradeRowKey(row));
                      }}
                      onDragOver={event => {
                        event.preventDefault();
                        event.dataTransfer.dropEffect = 'move';
                        setDragOverGradeKey(gradeRowKey(row));
                        moveDraggedGradeOver(index);
                      }}
                      onDragLeave={() => setDragOverGradeKey(current => current === gradeRowKey(row) ? null : current)}
                      onDrop={event => {
                        event.preventDefault();
                        finishGradeDrag();
                      }}
                      onDragEnd={finishGradeDrag}
                      className={`border-b border-[#d5deea] transition-smooth last:border-b-0 ${draggedGradeKey === gradeRowKey(row) ? 'opacity-50' : ''} ${dragOverGradeKey === gradeRowKey(row) && draggedGradeKey !== gradeRowKey(row) ? 'bg-[#f4f0ff] ring-2 ring-inset ring-[#c4b5fd]' : 'bg-white'}`}
                    >
                      <td className="px-3 py-2.5">
                        <span className="flex h-8 w-8 cursor-grab items-center justify-center rounded bg-[#f1f5f9] text-[#94a3b8] active:cursor-grabbing" title="Drag to reorder">
                          <AppIcon className="ri-draggable text-sm"></AppIcon>
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="inline-flex min-w-9 items-center justify-center rounded-full px-2.5 py-1 text-sm font-bold text-white" style={{ backgroundColor: row.color }}>{row.grade}</span>
                      </td>
                      <td className="px-4 py-2.5 text-sm text-[#0f172a]">{row.point}</td>
                      <td className="px-4 py-2.5 text-sm text-[#0f172a]">{formatQuizGradeRange(settings.rows, index)}</td>
                      <td className="px-4 py-2.5 text-right">
                        <button type="button" onClick={() => void confirmDeleteRow(row)} className="h-9 w-9 rounded bg-red-50 text-red-500 hover:bg-red-100" title={`Delete ${row.grade}`}>
                          <AppIcon className="ri-delete-bin-fill"></AppIcon>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr_1fr_1fr_auto] md:items-end">
              <GradeAddField label="Grade name">
                <input value={newGrade.grade} onChange={event => setNewGrade({ ...newGrade, grade: event.target.value })} placeholder="A+" className="h-10 w-full rounded border border-[#b9c4d1] bg-[#f8fafc] px-3 text-sm outline-none focus:border-[#5b2dbb]" />
              </GradeAddField>
              <GradeAddField label="Grade point">
                <input value={newGrade.point} onChange={event => setNewGrade({ ...newGrade, point: event.target.value })} placeholder="1" type="number" step="0.1" className="h-10 w-full rounded border border-[#b9c4d1] bg-[#f8fafc] px-3 text-sm outline-none focus:border-[#5b2dbb]" />
              </GradeAddField>
              <GradeAddField label="Grade range min, %">
                <input value={newGrade.min} onChange={event => setNewGrade({ ...newGrade, min: event.target.value })} placeholder="20%" type="number" min="0" max="100" className="h-10 w-full rounded border border-[#b9c4d1] bg-[#f8fafc] px-3 text-sm outline-none focus:border-[#5b2dbb]" />
              </GradeAddField>
              <GradeAddField label="Color">
                <div className="flex h-10 items-center gap-2 rounded border border-[#b9c4d1] bg-[#f8fafc] px-2">
                  <input value={newGrade.color} onChange={event => setNewGrade({ ...newGrade, color: event.target.value })} type="color" className="h-7 w-8 rounded border border-[#cbd5e1] bg-white p-0" />
                  <span className="min-w-0 truncate text-xs text-[#94a3b8]">{newGrade.color}</span>
                </div>
              </GradeAddField>
              <button type="button" onClick={addRow} disabled={!newGrade.grade.trim() || !newGrade.point || !newGrade.min} className="h-10 rounded-md bg-[#1f6fed] px-5 text-sm font-bold text-white hover:bg-[#1858c7] disabled:opacity-45 disabled:cursor-not-allowed">
                Add
              </button>
            </div>
          </section>
        </fieldset>
      </div>
    </div>
  );
}

export function GradeSettingRow({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <section className="grid min-w-0 grid-cols-1 gap-3 rounded-lg bg-white px-4 py-4 md:grid-cols-[280px_minmax(0,1fr)] md:items-center">
      <div>
        <p className="text-sm font-semibold text-[#0f172a]">{title}</p>
        <p className="mt-2 text-xs text-[#7b8aa0]">{subtitle}</p>
      </div>
      {children}
    </section>
  );
}

function GradeAddField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-bold text-[#0f172a]">{label}</span>
      {children}
    </label>
  );
}

