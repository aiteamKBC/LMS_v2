interface SearchBarProps {
  value: string;
  resultCount: number;
  onChange: (value: string) => void;
}

export default function SearchBar({
  value,
  resultCount,
  onChange,
}: SearchBarProps) {
  return (
    <div className="flex h-11 w-full items-center gap-2 rounded-lg border border-background-300 bg-background-50 px-3 focus-within:border-primary-400 md:w-96">
      <i className="ri-search-line text-base text-foreground-500" />
      <input
        type="text"
        aria-label="Search learners by name or email"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Search learner by name or email"
        className="h-full min-w-0 flex-1 bg-transparent text-sm text-foreground-950 outline-none placeholder:text-foreground-400"
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange("")}
          className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center text-foreground-500 hover:text-foreground-800"
          aria-label="Clear search"
        >
          <i className="ri-close-line" />
        </button>
      ) : (
        <span className="shrink-0 font-label text-xs text-foreground-400">
          {resultCount} found
        </span>
      )}
    </div>
  );
}
