import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { roleNavMap } from '@/mocks/navigation';

const financeConfig = roleNavMap.finance;

interface Invoice {
  id: string;
  employer: string;
  amount: string;
  amountNum: number;
  date: string;
  dueDate: string;
  status: 'Paid' | 'Pending' | 'Overdue' | 'Draft';
  type: 'Co-investment' | 'Top-up' | 'Employer';
  learners: number;
}

const INVOICES: Invoice[] = [
  { id: 'INV-0421', employer: 'Kent County Council', amount: '£21,400', amountNum: 21400, date: '05 Jun 2026', dueDate: '19 Jun 2026', status: 'Paid', type: 'Co-investment', learners: 12 },
  { id: 'INV-0420', employer: 'Tim Hortons UK', amount: '£10,700', amountNum: 10700, date: '04 Jun 2026', dueDate: '18 Jun 2026', status: 'Pending', type: 'Co-investment', learners: 6 },
  { id: 'INV-0419', employer: 'Medway NHS Trust', amount: '£8,400', amountNum: 8400, date: '02 Jun 2026', dueDate: '16 Jun 2026', status: 'Paid', type: 'Co-investment', learners: 4 },
  { id: 'INV-0418', employer: 'Canterbury City Council', amount: '£14,200', amountNum: 14200, date: '28 May 2026', dueDate: '11 Jun 2026', status: 'Overdue', type: 'Co-investment', learners: 8 },
  { id: 'INV-0417', employer: 'Ashford Borough Council', amount: '£6,300', amountNum: 6300, date: '22 May 2026', dueDate: '05 Jun 2026', status: 'Paid', type: 'Co-investment', learners: 3 },
  { id: 'INV-0416', employer: 'NHS England', amount: '£32,500', amountNum: 32500, date: '20 May 2026', dueDate: '03 Jun 2026', status: 'Paid', type: 'Top-up', learners: 15 },
  { id: 'INV-0415', employer: 'Unilever UK', amount: '£18,900', amountNum: 18900, date: '15 May 2026', dueDate: '29 May 2026', status: 'Paid', type: 'Employer', learners: 9 },
  { id: 'INV-0414', employer: 'Tesco PLC', amount: '£11,200', amountNum: 11200, date: '10 May 2026', dueDate: '24 May 2026', status: 'Paid', type: 'Co-investment', learners: 5 },
  { id: 'INV-0413', employer: 'Barclays Bank', amount: '£25,600', amountNum: 25600, date: '05 May 2026', dueDate: '19 May 2026', status: 'Draft', type: 'Employer', learners: 12 },
  { id: 'INV-0412', employer: 'KPMG UK', amount: '£9,800', amountNum: 9800, date: '01 May 2026', dueDate: '15 May 2026', status: 'Paid', type: 'Co-investment', learners: 4 },
];

export default function InvoicingPage() {
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState<'all' | 'Paid' | 'Pending' | 'Overdue' | 'Draft'>('all');
  const [search, setSearch] = useState('');

  const filtered = INVOICES.filter(inv => {
    const matchStatus = statusFilter === 'all' || inv.status === statusFilter;
    const matchSearch = inv.employer.toLowerCase().includes(search.toLowerCase()) || inv.id.toLowerCase().includes(search.toLowerCase());
    return matchStatus && matchSearch;
  });

  const totalInvoiced = INVOICES.reduce((s, i) => s + i.amountNum, 0);
  const totalPaid = INVOICES.filter(i => i.status === 'Paid').reduce((s, i) => s + i.amountNum, 0);
  const totalOutstanding = INVOICES.filter(i => i.status === 'Pending' || i.status === 'Overdue').reduce((s, i) => s + i.amountNum, 0);
  const overdueCount = INVOICES.filter(i => i.status === 'Overdue').length;

  return (
    <WorkspaceShell
      role="finance" roleLabel={financeConfig.label} navItems={financeConfig.items} workspaceLabel={financeConfig.workspaceLabel}
      pageTitle="Invoicing" pageSubtitle="Generate and manage employer invoices with payment tracking and reminders"
      userName="David Morgan" userRole="Finance Director"
    >
      <div className="p-6 space-y-6">
        <WorkspaceHeroBanner
          title="Invoicing"
          description={`£${totalInvoiced.toLocaleString()} total invoiced. £${totalPaid.toLocaleString()} paid, £${totalOutstanding.toLocaleString()} outstanding. ${overdueCount} overdue invoices requiring action.`}
          icon="ri-bill-line"
          imageUrl="https://readdy.ai/api/search-image?query=UK%20professional%20invoicing%20finance%20billing%20document%20modern%20office%20warm%20lighting%20desk&width=400&height=160&seq=invoicing-hero-01&orientation=landscape"
          imageAlt="Invoicing"
          stats={[{ label: 'Total', value: `£${(totalInvoiced / 1000).toFixed(0)}k` }, { label: 'Paid', value: `£${(totalPaid / 1000).toFixed(0)}k` }, { label: 'Overdue', value: String(overdueCount), variant: 'danger' }]}
        />

        {/* Stats Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="w-8 h-8 rounded-lg bg-primary-50 text-primary-600 flex items-center justify-center"><i className="ri-bill-line text-xs"></i></span>
              <span className="text-[11px] text-foreground-400">Total Invoiced</span>
            </div>
            <p className="text-xl font-heading font-semibold text-foreground-900">£{totalInvoiced.toLocaleString()}</p>
          </div>
          <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center"><i className="ri-check-line text-xs"></i></span>
              <span className="text-[11px] text-foreground-400">Paid</span>
            </div>
            <p className="text-xl font-heading font-semibold text-foreground-900">£{totalPaid.toLocaleString()}</p>
          </div>
          <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center"><i className="ri-time-line text-xs"></i></span>
              <span className="text-[11px] text-foreground-400">Outstanding</span>
            </div>
            <p className="text-xl font-heading font-semibold text-foreground-900">£{totalOutstanding.toLocaleString()}</p>
          </div>
          <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="w-8 h-8 rounded-lg bg-red-50 text-red-600 flex items-center justify-center"><i className="ri-error-warning-line text-xs"></i></span>
              <span className="text-[11px] text-foreground-400">Overdue</span>
            </div>
            <p className="text-xl font-heading font-semibold text-foreground-900">{overdueCount}</p>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="relative flex-1 w-full sm:max-w-sm">
            <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></i>
            <input type="text" placeholder="Search invoices..." value={search} onChange={e => setSearch(e.target.value)} className="w-full pl-9 pr-3 py-2 bg-background-50 border border-foreground-200/60 rounded-lg text-[12px] text-foreground-700 focus:outline-none focus:ring-2 focus:ring-primary-300" />
          </div>
          <div className="flex items-center gap-1 bg-background-100 rounded-lg p-1 overflow-x-auto">
            {(['all', 'Paid', 'Pending', 'Overdue', 'Draft'] as const).map(f => (
              <button key={f} onClick={() => setStatusFilter(f)} className={`px-3 py-1.5 rounded-md text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${statusFilter === f ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>
                {f === 'all' ? 'All' : f}
                {f === 'Overdue' && overdueCount > 0 && <span className="bg-red-500 text-white text-[10px] px-1.5 py-0.5 rounded-full leading-none ml-1">{overdueCount}</span>}
              </button>
            ))}
          </div>
          <div className="flex-1"></div>
          <button className="flex items-center gap-2 px-4 py-2 bg-primary-500 text-white rounded-lg text-[12px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
            <i className="ri-add-line"></i> New Invoice
          </button>
        </div>

        {/* Invoice List */}
        <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
          <div className="p-4 border-b border-foreground-400/50 flex items-center justify-between">
            <h3 className="text-sm font-heading font-semibold text-foreground-900">Invoices</h3>
            <span className="text-[10px] text-foreground-400 bg-background-100 px-2 py-1 rounded-full">{filtered.length} invoices</span>
          </div>
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-background-100 text-[11px] text-foreground-400 uppercase tracking-wider">
                <th className="text-left px-4 py-2.5 font-medium">Invoice</th>
                <th className="text-left px-4 py-2.5 font-medium">Employer</th>
                <th className="text-left px-4 py-2.5 font-medium">Type</th>
                <th className="text-right px-4 py-2.5 font-medium">Amount</th>
                <th className="text-left px-4 py-2.5 font-medium">Due Date</th>
                <th className="text-right px-4 py-2.5 font-medium">Status</th>
                <th className="text-right px-4 py-2.5 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(inv => (
                <tr key={inv.id} className="border-b border-background-50 hover:bg-background-50/50 transition-smooth">
                  <td className="px-4 py-3 text-foreground-800 font-medium">{inv.id}</td>
                  <td className="px-4 py-3 text-foreground-700">{inv.employer}</td>
                  <td className="px-4 py-3 text-foreground-500"><span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-secondary-100 text-secondary-700">{inv.type}</span></td>
                  <td className="px-4 py-3 text-right text-foreground-900 font-semibold">{inv.amount}</td>
                  <td className="px-4 py-3 text-foreground-500">{inv.dueDate}</td>
                  <td className="px-4 py-3 text-right">
                    <span className={`inline-flex text-[11px] font-medium px-2 py-0.5 rounded-full ${inv.status === 'Paid' ? 'bg-emerald-50 text-emerald-700' : inv.status === 'Pending' ? 'bg-amber-50 text-amber-700' : inv.status === 'Draft' ? 'bg-foreground-100 text-foreground-500' : 'bg-red-50 text-red-700'}`}>{inv.status}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button className="px-2 py-1 bg-background-50 border border-foreground-200/60 rounded-lg text-[10px] text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">
                        <i className="ri-eye-line mr-0.5"></i> View
                      </button>
                      <button className="px-2 py-1 bg-background-50 border border-foreground-200/60 rounded-lg text-[10px] text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">
                        <i className="ri-download-line mr-0.5"></i> PDF
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </WorkspaceShell>
  );
}