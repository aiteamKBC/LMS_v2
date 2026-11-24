import { AppIcon } from '@/components/feature/AppIcon';


export function IconButton({ label, icon, onClick, tone = 'default' }: { label: string; icon: string; onClick: () => void; tone?: 'default' | 'danger' }) {
  const classes = tone === 'danger'
    ? 'bg-red-50 text-red-500 hover:bg-red-100 hover:text-red-700'
    : 'bg-background-100 text-foreground-600 hover:bg-primary-50 hover:text-primary-700';
  return (
    <button onClick={onClick} title={label} aria-label={label} className={`inline-flex h-8 w-8 items-center justify-center rounded-lg transition-smooth ${classes}`}>
      <AppIcon name={icon} size={15}></AppIcon>
    </button>
  );
}


export function EmptyState({ text }: { text: string }) {
  return <div className="rounded-xl border border-dashed border-background-300 bg-background-100/40 px-3 py-5 text-center text-[12px] font-medium text-foreground-400">{text}</div>;
}
