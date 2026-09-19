import { FC, useRef, useEffect, useState } from 'react';
import { Search, X, Plus, Maximize2, Minimize2, Timer } from 'lucide-react';
import { SpacegrepLogo } from './SpacegrepLogo';

function isSafeUrl(url: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

interface FloatingOmnibarProps {
  bannerHeight?: number;
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
  bannerHeight = 0,
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
  const [whiteboxLogoUrl, setWhiteboxLogoUrl] = useState<string>(
    import.meta.env.VITE_WHITEBOX_LOGO_URL || ''
  );
  const [whiteboxLinkUrl, setWhiteboxLinkUrl] = useState<string>(
    import.meta.env.VITE_WHITEBOX_LINK_URL || ''
  );
  const [imgError, setImgError] = useState(false);

  // Fetch runtime config from backend
  useEffect(() => {
    fetch('/api/config')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.whitebox_logo_url) {
          setWhiteboxLogoUrl(data.whitebox_logo_url);
        }
        if (data?.whitebox_link_url) {
          setWhiteboxLinkUrl(data.whitebox_link_url);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    setImgError(false);
  }, [whiteboxLogoUrl]);

  const [scrollY, setScrollY] = useState(0);

  useEffect(() => {
    const handleScroll = () => {
      setScrollY(window.scrollY);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

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
  const omnibarTop = Math.max(16, bannerHeight + 16 - scrollY);
  const isAtTop = scrollY === 0;

  return (
    <header
      className={`fixed left-0 right-0 z-40 px-3 sm:px-6 pointer-events-none ${
        isAtTop ? 'transition-[top] duration-200 ease-out' : ''
      }`}
      style={{ top: `${omnibarTop}px` }}
    >
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-3 sm:gap-4">
        {/* Left: Whitebox logo & spacegrep logo (scrolls with photos) */}
        <div
          className={`flex items-center gap-2.5 sm:gap-3 flex-shrink-0 transition-opacity duration-150 ${
            scrollY > 60 ? 'pointer-events-none opacity-0' : 'pointer-events-auto opacity-100'
          }`}
          style={{
            transform: `translateY(-${Math.min(scrollY, 80)}px)`,
            willChange: 'transform',
          }}
        >
          {/* Farthest left: Whitebox logo (only displayed if whiteboxLogoUrl is set; zero width when empty) */}
          {Boolean(whiteboxLogoUrl && !imgError) && (
            whiteboxLinkUrl && isSafeUrl(whiteboxLinkUrl) ? (
              <a
                href={whiteboxLinkUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="h-10 sm:h-11 flex items-center drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)] hover:opacity-80 transition-opacity flex-shrink-0"
                title="Whitebox"
                aria-label="Whitebox"
              >
                <img
                  src={whiteboxLogoUrl}
                  alt="Whitebox"
                  onError={() => setImgError(true)}
                  className="h-full w-auto max-w-[120px] object-contain"
                />
              </a>
            ) : (
              <div
                className="h-10 sm:h-11 flex items-center drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)] flex-shrink-0"
                title="Whitebox"
                aria-label="Whitebox"
              >
                <img
                  src={whiteboxLogoUrl}
                  alt="Whitebox"
                  onError={() => setImgError(true)}
                  className="h-full w-auto max-w-[120px] object-contain"
                />
              </div>
            )
          )}

          {/* Right of Whitebox: spacegrep 'sg' Logo */}
          <div className="h-10 sm:h-11 flex items-center drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]">
            <SpacegrepLogo className="h-full" />
          </div>
        </div>

        {/* Center: Main Search Omnibar (spans full width between logos) */}
        <div className="flex-1 min-w-0 pointer-events-auto">
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
    </div>

    {/* Right: GitHub Project Link (scrolls with photos) */}
    <div
      className={`flex items-center flex-shrink-0 transition-opacity duration-150 ${
        scrollY > 60 ? 'pointer-events-none opacity-0' : 'pointer-events-auto opacity-100'
      }`}
      style={{
        transform: `translateY(-${Math.min(scrollY, 80)}px)`,
        willChange: 'transform',
      }}
    >
      <a
        href="https://github.com/jonmon6691/spacegrep"
        target="_blank"
        rel="noopener noreferrer"
        className="text-slate-400 hover:text-white transition-all duration-200 hover:scale-110 active:scale-95 flex-shrink-0 drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)] p-1"
        title="View on GitHub"
        aria-label="View on GitHub"
      >
        <svg
          role="img"
          viewBox="0 0 24 24"
          fill="currentColor"
          className="w-6 h-6"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
        </svg>
      </a>
    </div>
  </div>
</header>
  );
};
