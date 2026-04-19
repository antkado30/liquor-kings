type SearchBarProps = {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
};

export function SearchBar({ value, onChange, placeholder }: SearchBarProps) {
  const ph = placeholder ?? "Search by name or MLCC code...";
  return (
    <div className="search-bar">
      <input
        type="search"
        enterKeyHint="search"
        autoComplete="off"
        className="search-bar-input"
        placeholder={ph}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value ? (
        <button type="button" className="search-bar-clear" onClick={() => onChange("")} aria-label="Clear search">
          ×
        </button>
      ) : null}
    </div>
  );
}
