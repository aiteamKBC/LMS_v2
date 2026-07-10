import { useState } from 'react';
import { useWizard } from '../WizardContext';
import type { PlrRecord } from '../../types';
import { Table, Pagination, inputClass, btnPrimary, btnSecondary, iconBtn, EmptyState, ActionLink } from '../../components/ui';
import { StepHeading } from './fields';

const PLR_SAMPLE: PlrRecord[] = [
  { id: 'plr-1', placeOfStudy: 'LONDON METROPOLITAN COLLEGE LIMITED', qualificationType: 'BSc', subject: 'BSc (Hons) in Project Management – The University of West London – Project Management Degree Apprenticeship Standard (00305040)', level: '', awardDate: '', credits: 0, grade: '999999999', recordType: 'Imported' },
  { id: 'plr-2', placeOfStudy: 'LONDON METROPOLITAN COLLEGE LIMITED', qualificationType: 'Other', subject: 'Non regulated provision Level 6 Business Management (Z0002074)', level: '', awardDate: '', credits: 0, grade: '999999999', recordType: 'Imported' },
  { id: 'plr-3', placeOfStudy: 'LONDON METROPOLITAN COLLEGE LIMITED', qualificationType: 'Other', subject: 'Apprenticeship standard / Project Manager (integrated degree) (ZPROG001)', level: '', awardDate: '', credits: 0, grade: '999999999', recordType: 'Imported' },
];

const PER_PAGE = 8;

export default function Plr() {
  const { draft, setSection } = useWizard();
  const plr = draft.plr;
  const [page, setPage] = useState(1);

  const setUln = (uln: string) => setSection('plr', { ...plr, uln });
  const getPlr = () => setSection('plr', { ...plr, records: PLR_SAMPLE });
  const addManual = () =>
    setSection('plr', {
      ...plr,
      records: [
        ...plr.records,
        { id: `plr-${Date.now()}`, placeOfStudy: '', qualificationType: '', subject: 'New manual record', level: '', awardDate: '', credits: 0, grade: '', recordType: 'Manual' },
      ],
    });
  const remove = (id: string) => setSection('plr', { ...plr, records: plr.records.filter((r) => r.id !== id) });

  const totalPages = Math.max(1, Math.ceil(plr.records.length / PER_PAGE));
  const rows = plr.records.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  return (
    <div>
      <StepHeading title="Personal Learning Record" />
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div>
          <label className="block text-[11px] uppercase tracking-wider font-medium text-foreground-500 mb-1">ULN</label>
          <input value={plr.uln} onChange={(e) => setUln(e.target.value)} placeholder="5757627173" className={`${inputClass} w-48`} />
        </div>
        <button className={btnPrimary} onClick={getPlr}><i className="ri-download-cloud-line" />Get PLR</button>
        <button className={btnSecondary} onClick={addManual}><i className="ri-add-line" />Add</button>
        <div className="ml-auto"><ActionLink label="Export to CSV" icon="ri-file-excel-2-line" /></div>
      </div>

      {plr.records.length === 0 ? (
        <EmptyState text="No PLR records. Enter a ULN and click Get PLR, or add a manual record." />
      ) : (
        <>
          <div className="border border-foreground-200/60 rounded-xl overflow-hidden">
            <Table headers={['Place of Study', 'Qualification Type', 'Subject', 'Level', 'Award Date', 'Credits', 'Grade', 'Record Type', 'Edit', 'Delete']}>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-foreground-100 last:border-0">
                  <td className="py-2 px-3 text-foreground-700">{r.placeOfStudy}</td>
                  <td className="py-2 px-3 text-foreground-600">{r.qualificationType}</td>
                  <td className="py-2 px-3 text-foreground-700 max-w-[260px]">{r.subject}</td>
                  <td className="py-2 px-3 text-foreground-600">{r.level || '—'}</td>
                  <td className="py-2 px-3 text-foreground-600">{r.awardDate || '—'}</td>
                  <td className="py-2 px-3 text-foreground-600">{r.credits}</td>
                  <td className="py-2 px-3 text-foreground-600">{r.grade}</td>
                  <td className="py-2 px-3 text-foreground-600">{r.recordType}</td>
                  <td className="py-2 px-3"><button className={iconBtn} aria-label="Edit record"><i className="ri-pencil-line text-sm" /></button></td>
                  <td className="py-2 px-3"><button className={iconBtn} aria-label="Delete record" onClick={() => remove(r.id)}><i className="ri-delete-bin-line text-sm" /></button></td>
                </tr>
              ))}
            </Table>
            <div className="border-t border-foreground-100"><Pagination page={page} totalPages={totalPages} onChange={setPage} /></div>
          </div>
        </>
      )}
    </div>
  );
}
