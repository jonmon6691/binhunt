import { FC, useRef, useEffect } from 'react';
import { Search, X, Plus, Maximize2, Minimize2, Timer } from 'lucide-react';

interface FloatingOmnibarProps {
  searchQuery: string;
  onSearchChange: (q: string) => void;
  totalMatches: number;
  highCount: number;
  moderateCount: number;
  activeMatchIndex?: number | null;
  onEnter?: () => void;
  kioskSecondsRemaining: number;
  kioskEnabled: boolean;
  onToggleKiosk: () => void;
  onOpenUpload: () => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
}

export const FloatingOmnibar: FC<FloatingOmnibarProps> = ({
  searchQuery,
  onSearchChange,
  totalMatches,
  highCount,
  moderateCount,
  activeMatchIndex,
  onEnter,
  kioskSecondsRemaining,
  kioskEnabled,
  onToggleKiosk,
  onOpenUpload,
  isFullscreen,
  onToggleFullscreen,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);

  // Global hotkeys: '/' to focus search & highlight term, 'Escape' to clear
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (searchQuery) {
          onSearchChange('');
          inputRef.current?.blur();
        }
      } else if (e.key === '/' && document.activeElement !== inputRef.current) {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        requestAnimationFrame(() => {
          inputRef.current?.select();
        });
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [searchQuery, onSearchChange]);

  const hasSearch = searchQuery.trim().length > 0;

  return (
    <header className="fixed top-4 left-1/2 -translate-x-1/2 z-50 w-[95%] max-w-4xl">
      <div className="flex items-center justify-between px-3.5 py-2.5 rounded-2xl bg-slate-900/85 backdrop-blur-xl border border-slate-700/80 shadow-2xl shadow-black/60 transition-all duration-300 hover:border-slate-600">
        {/* Left: Search icon & text input */}
        <div className="flex items-center flex-1 space-x-2.5 min-w-0 pr-2">
          <Search className={`w-5 h-5 flex-shrink-0 transition-colors duration-200 ${
            hasSearch ? 'text-yellow-400' : 'text-slate-400'
          }`} />
          <input
            ref={inputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                inputRef.current?.blur();
                onEnter?.();
              }
            }}
            placeholder="Search parts, chips, tools (e.g., 'heat tape', 'CR2032', 'measure volts')..."
            className="w-full bg-transparent text-sm text-slate-100 placeholder-slate-400 focus:outline-none font-medium truncate"
            autoFocus
          />

          {hasSearch && (
            <button
              onClick={() => {
                onSearchChange('');
                inputRef.current?.focus();
              }}
              className="p-1 rounded-full text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
              title="Clear search (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Center/Right: Match statistics badges */}
        <div className="flex items-center space-x-2.5 flex-shrink-0">
          {hasSearch && (
            <div className="flex items-center space-x-2 text-xs font-mono">
              {totalMatches > 0 ? (
                <>
                  <span className="px-2 py-0.5 rounded-md bg-yellow-950/80 text-yellow-300 border border-yellow-500/50 font-bold">
                    {activeMatchIndex != null
                      ? `${activeMatchIndex + 1} of ${totalMatches}`
                      : `${totalMatches} ${totalMatches === 1 ? 'match' : 'matches'}`}
                  </span>
                  {highCount > 0 && moderateCount > 0 && (
                    <span className="hidden sm:inline text-[11px] text-slate-400">
                      ({highCount} high, {moderateCount} mod)
                    </span>
                  )}
                </>
              ) : (
                <span className="px-2 py-0.5 rounded-md bg-slate-800 text-slate-400 text-xs">
                  No bins found
                </span>
              )}
            </div>
          )}

          {/* Kiosk Auto-Reset Timer Pill - only visible when 10 seconds or fewer remain */}
          {kioskEnabled && kioskSecondsRemaining <= 10 && (
            <button
              onClick={onToggleKiosk}
              className="flex items-center space-x-1.5 px-2.5 py-1 rounded-lg text-xs font-mono transition-all bg-amber-950/80 border border-amber-500/50 text-amber-300 animate-pulse hover:bg-amber-900/80"
              title={`Kiosk auto-reset in ${kioskSecondsRemaining}s. Click to pause/disable.`}
            >
              <Timer className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-[11px] font-bold">Reset in {kioskSecondsRemaining}s</span>
            </button>
          )}

          {/* Upload Shelf Button */}
          <button
            onClick={onOpenUpload}
            className="flex items-center space-x-1 px-3 py-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 active:bg-cyan-700 text-white font-medium text-xs shadow-lg shadow-cyan-950/50 transition-all duration-150 active:scale-95"
          >
            <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
            <span className="hidden sm:inline">Upload Shelf</span>
          </button>

          {/* Fullscreen Toggle */}
          <button
            onClick={onToggleFullscreen}
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
            title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen (Kiosk)'}
          >
            {isFullscreen ? (
              <Minimize2 className="w-4 h-4" />
            ) : (
              <Maximize2 className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>
    </header>
  );
};
