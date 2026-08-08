import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { roleNavMap } from '@/mocks/navigation';

const financeConfig = roleNavMap.finance;

interface Payment {
  id: string;
  invoiceId: string;
  employer: string;
  amount: string;
  amountNum: number;
  receivedDate: string;
  method: 'BACS' | 'Card' | 'Cheque' | 'Direct Debit';
  status: 'Reconciled' | 'Pending' | 'Failed';
  reference: string;
}

const PAYMENTS: Payment[] = [
  { id: 'PAY-0281', invoiceId: 'INV-0421', employer: 'Kent County Council', amount: '£21,400', amountNum: 21400, receivedDate: '05 Jun 2026', method: 'BACS', status: 'Reconciled', reference: 'KCC-APP-2026' },
  { id: 'PAY-0280', invoiceId: 'INV-0419', employer: 'Medway NHS Trust', amount: '£8,400', amountNum: 8400, receivedDate: '02 Jun 2026', method: 'Direct Debit', status: 'Reconciled', reference: 'NHS-MED-456' },
  { id: 'PAY-0279', invoiceId: 'INV-0417', employer: 'Ashford Borough Council', amount: '£6,300', amountNum: 6300, receivedDate: '28 May 2026', method: 'BACS', status: 'Reconciled', reference: 'ABC-APP-789' },
  { id: 'PAY-0278', invoiceId: 'INV-0416', employer: 'NHS England', amount: '£32,500', amountNum: 32500, receivedDate: '22 May 2026', method: 'BACS', status: 'Reconciled', reference: 'NHS-ENG-2026' },
  { id: 'PAY-0277', invoiceId: 'INV-0415', employer: 'Unilever UK', amount: '£18,900', amountNum: 18900, receivedDate: '18 May 2026', method: 'Direct Debit', status: 'Reconciled', reference: 'UNI-UK-2026' },
  { id: 'PAY-0276', invoiceId: 'INV-0414', employer: 'Tesco PLC', amount: '£11,200', amountNum: 11200, receivedDate: '15 May 2026', method: 'BACS', status: 'Reconciled', reference: 'TES-APP-2026' },
  { id: 'PAY-0275', invoiceId: 'INV-0412', employer: 'KPMG UK', amount: '£9,800', amountNum: 9800, receivedDate: '10 May 2026', method: 'Card', status: 'Reconciled', reference: 'KPMG-UK-456' },
  { id: 'PAY-0274', invoiceId: 'INV-0420', employer: 'Tim Hortons UK', amount: '£10,700', amountNum: 10700, receivedDate: 'Today', method: 'BACS', status: 'Pending', reference: 'TH-UK-2026' },
  { id: 'PAY-0273', invoiceId: 'INV-0418', employer: 'Canterbury City Council', amount: '£14,200', amountNum: 14200, receivedDate: 'Awaiting', method: 'BACS', status: 'Failed', reference: 'CCC-APP-2026' },
];

export default function PaymentsPage() {
  const [statusFilter, setStatusFilter] = useState<'all' | 'Reconciled' | 'Pending' | 'Failed'>('all');
  const [methodFilter, setMethodFilter] = useState<'all' | 'BACS' | 'Card' | 'Cheque' | 'Direct Debit'>('all');

  const filtered = PAYMENTS.filter(p => {
    const matchStatus = statusFilter === 'all' || p.status === statusFilter;
    const matchMethod = methodFilter === 'all' || p.method === methodFilter;
    return matchStatus && matchMethod;
  });

  const totalReceived = PAYMENTS.filter(p => p.status === 'Reconciled').reduce((s, p) => s + p.amountNum, 0);
  const pendingAmount = PAYMENTS.filter(p => p.status === 'Pending').reduce((s, p) => s + p.amountNum, 0);
  const failedAmount = PAYMENTS.filter(p => p.status === 'Failed').reduce((s, p) => s + p.amountNum, 0);
  const reconciliationRate = Math.round((PAYMENTS.filter(p => p.status === 'Reconciled').length / PAYMENTS.length) * 100);

  return (
    <WorkspaceShell
      role="finance" roleLabel={financeConfig.label} navItems={financeConfig.items} workspaceLabel={financeConfig.workspaceLabel}
      pageTitle="Payments" pageSubtitle="Track all payments received with reconciliation against invoices and DAS"
      userName="David Morgan" userRole="Finance Director"
    >
      <div className="p-6 space-y-6">
        <WorkspaceHeroBanner
          title="Payments"
          description={`£${totalReceived.toLocaleString()} received and reconciled. £${pendingAmount.toLocaleString()} pending, £${failedAmount.toLocaleString()} failed. ${reconciliationRate}% reconciliation rate.`}
          icon="ri-money-pound-circle-line"
          imageUrl="https://readdy.ai/api/search-image?query=UK%20professional%20finance%20payment%20banking%20reconciliation%20modern%20office%20warm%20lighting&width=400&height=160&seq=payments-hero-01&orientation=landscape"
          imageAlt="Payments"
          stats={[{ label: 'Received', value: `£${(totalReceived / 1000).toFixed(0)}k` }, { label: 'Pending', value: `£${(pendingAmount / 1000).toFixed(0)}k` }, { label: 'Reconciled', value: `${reconciliationRate}%` }]}
        />

        {/* Stats Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center"><AppIcon className="ri-check-double-line text-xs"></AppIcon></span>
              <span className="text-[11px] text-foreground-400">Received & Reconciled</span>
            </div>
            <p className="text-xl font-heading font-semibold text-foreground-900">£{totalReceived.toLocaleString()}</p>
          </div>
          <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center"><AppIcon className="ri-time-line text-xs"></AppIcon></span>
              <span className="text-[11px] text-foreground-400">Pending</span>
            </div>
            <p className="text-xl font-heading font-semibold text-foreground-900">£{pendingAmount.toLocaleString()}</p>
          </div>
          <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="w-8 h-8 rounded-lg bg-red-50 text-red-600 flex items-center justify-center"><AppIcon className="ri-error-warning-line text-xs"></AppIcon></span>
              <span className="text-[11px] text-foreground-400">Failed</span>
            </div>
            <p className="text-xl font-heading font-semibold text-foreground-900">£{failedAmount.toLocaleString()}</p>
          </div>
          <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="w-8 h-8 rounded-lg bg-primary-50 text-primary-600 flex items-center justify-center"><AppIcon className="ri-percent-line text-xs"></AppIcon></span>
              <span className="text-[11px] text-foreground-400">Reconciliation Rate</span>
            </div>
            <p className="text-xl font-heading font-semibold text-foreground-900">{reconciliationRate}%</p>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="flex items-center gap-1 bg-background-100 rounded-lg p-1 overflow-x-auto">
            {(['all', 'Reconciled', 'Pending', 'Failed'] as const).map(f => (
              <button key={f} onClick={() => setStatusFilter(f)} className={`px-3 py-1.5 rounded-md text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${statusFilter === f ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>
                {f === 'all' ? 'All' : f}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 bg-background-100 rounded-lg p-1 overflow-x-auto">
            {(['all', 'BACS', 'Direct Debit', 'Card', 'Cheque'] as const).map(f => (
              <button key={f} onClick={() => setMethodFilter(f)} className={`px-3 py-1.5 rounded-md text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${methodFilter === f ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>
                {f === 'all' ? 'All Methods' : f}
              </button>
            ))}
          </div>
        </div>

        {/* Payments Table */}
        <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
          <div className="p-4 border-b border-foreground-400/50 flex items-center justify-between">
            <h3 className="text-sm font-heading font-semibold text-foreground-900">Payment Records</h3>
            <span className="text-[10px] text-foreground-400 bg-background-100 px-2 py-1 rounded-full">{filtered.length} payments</span>
          </div>
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-background-100 text-[11px] text-foreground-400 uppercase tracking-wider">
                <th className="text-left px-4 py-2.5 font-medium">Payment ID</th>
                <th className="text-left px-4 py-2.5 font-medium">Invoice</th>
                <th className="text-left px-4 py-2.5 font-medium">Employer</th>
                <th className="text-right px-4 py-2.5 font-medium">Amount</th>
                <th className="text-left px-4 py-2.5 font-medium">Date</th>
                <th className="text-left px-4 py-2.5 font-medium">Method</th>
                <th className="text-left px-4 py-2.5 font-medium">Reference</th>
                <th className="text-right px-4 py-2.5 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => (
                <tr key={p.id} className="border-b border-background-50 hover:bg-background-50/50 transition-smooth">
                  <td className="px-4 py-3 text-foreground-800 font-medium">{p.id}</td>
                  <td className="px-4 py-3 text-foreground-500">{p.invoiceId}</td>
                  <td className="px-4 py-3 text-foreground-700">{p.employer}</td>
                  <td className="px-4 py-3 text-right text-foreground-900 font-semibold">{p.amount}</td>
                  <td className="px-4 py-3 text-foreground-500">{p.receivedDate}</td>
                  <td className="px-4 py-3 text-foreground-500"><span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-secondary-100 text-secondary-700">{p.method}</span></td>
                  <td className="px-4 py-3 text-foreground-500 text-[11px]">{p.reference}</td>
                  <td className="px-4 py-3 text-right">
                    <span className={`inline-flex text-[11px] font-medium px-2 py-0.5 rounded-full ${p.status === 'Reconciled' ? 'bg-emerald-50 text-emerald-700' : p.status === 'Pending' ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'}`}>{p.status}</span>
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