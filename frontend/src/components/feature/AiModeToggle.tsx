interface AiModeToggleProps {
  aiMode: boolean;
  onToggle: () => void;
}

export function AiModeToggle({ aiMode, onToggle }: AiModeToggleProps) {
  return (
    <div className="flex items-center bg-background-100 rounded-full p-0.5 border border-foreground-200">
      <button
        onClick={() => !aiMode && onToggle()}
        className={`px-3 py-1 rounded-full text-[11px] font-medium transition-smooth whitespace-nowrap ${
          !aiMode
            ? 'bg-background-50 text-foreground-800 shadow-sm shadow-foreground-950/4'
            : 'text-foreground-400 hover:text-foreground-600'
        }`}
      >
        <i className="ri-tools-line mr-1 text-[10px]"></i>
        Manual
      </button>
      <button
        onClick={() => aiMode && onToggle()}
        className={`px-3 py-1 rounded-full text-[11px] font-medium transition-smooth whitespace-nowrap ${
          aiMode
            ? 'bg-primary-500 text-white shadow-sm shadow-primary-500/20'
            : 'text-foreground-400 hover:text-foreground-600'
        }`}
      >
        <i className="ri-sparkling-2-line mr-1 text-[10px]"></i>
        AI-Assisted
      </button>
    </div>
  );
}