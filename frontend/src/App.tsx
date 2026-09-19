import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import type { Photo, MatchResult, WorkerOutgoingMessage } from './types';
import { FloatingOmnibar } from './components/FloatingOmnibar';
import { ShelfStream } from './components/ShelfStream';
import { RadarIndicators } from './components/RadarIndicators';
import { UploadModal } from './components/UploadModal';
import { IngestBanner } from './components/IngestBanner';

const KIOSK_TIMEOUT_SECONDS = 60;

export function App() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [matchesByBinId, setMatchesByBinId] = useState<Record<string, MatchResult>>({});
  const [highCount, setHighCount] = useState(0);
  const [moderateCount, setModerateCount] = useState(0);
  const [totalMatches, setTotalMatches] = useState(0);
  const [activeMatchIndex, setActiveMatchIndex] = useState<number | null>(null);

  // Kiosk mode state
  const [kioskEnabled, setKioskEnabled] = useState(true);
  const [kioskSecondsRemaining, setKioskSecondsRemaining] = useState(KIOSK_TIMEOUT_SECONDS);

  // UI modals & state
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [bannerHeight, setBannerHeight] = useState(0);

  // References
  const workerRef = useRef<Worker | null>(null);
  const queryCounter = useRef(0);
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // Ordered matches in visual top-to-bottom reading order
  const orderedMatches = useMemo(() => {
    const list: Array<{ binId: string; photoId: string }> = [];
    for (const photo of photos) {
      const matchedBins = photo.bins
        .filter((b) => Boolean(matchesByBinId[b.id]))
        .sort((a, b) => {
          if (Math.abs(a.bbox[1] - b.bbox[1]) > 0.03) {
            return a.bbox[1] - b.bbox[1];
          }
          return a.bbox[0] - b.bbox[0];
        });

      for (const bin of matchedBins) {
        list.push({ binId: bin.id, photoId: photo.id });
      }
    }
    return list;
  }, [photos, matchesByBinId]);

  const activeBinId =
    activeMatchIndex !== null && orderedMatches[activeMatchIndex]
      ? orderedMatches[activeMatchIndex].binId
      : null;

  // Fetch manifest on mount
  const loadManifest = useCallback(async () => {
    try {
      setIsLoading(true);
      const res = await fetch('/api/manifest');
      if (!res.ok) throw new Error('Failed to load inventory manifest');
      const data: Photo[] = await res.json();
      setPhotos(data);

      // Send to worker
      if (workerRef.current) {
        workerRef.current.postMessage({
          type: 'INIT_MANIFEST',
          manifest: data,
        });
      }
    } catch (err) {
      console.error('Error loading manifest:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Initialize Search Web Worker
  useEffect(() => {
    const worker = new Worker(new URL('./workers/searchWorker.ts', import.meta.url), {
      type: 'module',
    });
    workerRef.current = worker;

    worker.onmessage = (e: MessageEvent<WorkerOutgoingMessage>) => {
      const msg = e.data;
      if (msg.type === 'SEARCH_RESULTS') {
        // Only accept if matches latest query counter
        if (msg.queryId === queryCounter.current) {
          setMatchesByBinId(msg.matches);
          setHighCount(msg.highCount);
          setModerateCount(msg.moderateCount);
          setTotalMatches(msg.totalMatches);
        }
      }
    };

    loadManifest();

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, [loadManifest]);

  // Scroll a specific bin smoothly to the vertical center of the viewport
  const scrollToBin = useCallback(
    (photoId: string, binId: string) => {
      const cardEl = cardRefs.current.get(photoId);
      if (!cardEl) return;

      const photo = photos.find((p) => p.id === photoId);
      const bin = photo?.bins.find((b) => b.id === binId);
      if (!bin) return;

      const imgEl = cardEl.querySelector('img');
      if (!imgEl) return;

      const imgRect = imgEl.getBoundingClientRect();
      const vh = window.innerHeight;
      const [, by, , bh] = bin.bbox;

      // Center of the bin in image pixel coordinates
      const binCenterPixelY = (by + bh / 2) * imgRect.height;
      // Absolute Y of the bin center in document coordinates
      const binAbsoluteY = window.scrollY + imgRect.top + binCenterPixelY;
      // Desired scroll position so that bin is in the middle of viewport
      const targetScrollY = binAbsoluteY - vh / 2;

      window.scrollTo({
        top: Math.max(0, targetScrollY),
        behavior: 'smooth',
      });
    },
    [photos]
  );

  // Cycle matches forward ('next') or backward ('prev')
  const cycleMatch = useCallback(
    (direction: 'next' | 'prev') => {
      if (orderedMatches.length === 0) return;

      let nextIndex: number;
      if (activeMatchIndex === null) {
        nextIndex = direction === 'next' ? 0 : orderedMatches.length - 1;
      } else {
        if (direction === 'next') {
          nextIndex = (activeMatchIndex + 1) % orderedMatches.length;
        } else {
          nextIndex = (activeMatchIndex - 1 + orderedMatches.length) % orderedMatches.length;
        }
      }

      setActiveMatchIndex(nextIndex);
      const target = orderedMatches[nextIndex];
      scrollToBin(target.photoId, target.binId);
    },
    [orderedMatches, activeMatchIndex, scrollToBin]
  );

  // Enter handler in searchbox: defocus and center the active/first match
  const handleSearchEnter = useCallback(() => {
    if (orderedMatches.length === 0) return;
    const targetIndex = activeMatchIndex !== null ? activeMatchIndex : 0;
    setActiveMatchIndex(targetIndex);
    const target = orderedMatches[targetIndex];
    scrollToBin(target.photoId, target.binId);
  }, [orderedMatches, activeMatchIndex, scrollToBin]);

  // Selection handler when an indicator or card element is clicked
  const handleSelectBin = useCallback(
    (binId: string) => {
      const idx = orderedMatches.findIndex((m) => m.binId === binId);
      if (idx !== -1) {
        setActiveMatchIndex(idx);
      }
    },
    [orderedMatches]
  );

  // Execute search when query changes
  const handleSearchChange = useCallback((newQuery: string) => {
    setSearchQuery(newQuery);
    setActiveMatchIndex(null);
    queryCounter.current += 1;
    const queryId = queryCounter.current;

    if (!newQuery.trim()) {
      setMatchesByBinId({});
      setHighCount(0);
      setModerateCount(0);
      setTotalMatches(0);
      return;
    }

    if (workerRef.current) {
      workerRef.current.postMessage({
        type: 'SEARCH',
        query: newQuery,
        queryId,
      });
    }
  }, []);

  // Reset app state as if the kiosk timer expired ('q' shortcut or timer expiration)
  const resetKiosk = useCallback(() => {
    handleSearchChange('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setKioskSecondsRemaining(KIOSK_TIMEOUT_SECONDS);
    setActiveMatchIndex(null);
    const activeEl = document.activeElement as HTMLElement | null;
    if (activeEl && activeEl.blur) {
      activeEl.blur();
    }
  }, [handleSearchChange]);

  // Scroll to the next or previous shelf image boundary, offset below the floating omnibar
  const scrollToShelfBoundary = useCallback(
    (direction: 'next' | 'prev') => {
      if (photos.length === 0) return;

      const TOP_NAV_OFFSET = 80;
      const SCROLL_TOLERANCE = 10;

      // Collect target scroll positions for each shelf card in visual sequence
      const targets: number[] = [];
      for (const photo of photos) {
        const cardEl = cardRefs.current.get(photo.id);
        if (cardEl) {
          const rect = cardEl.getBoundingClientRect();
          const cardAbsoluteTop = window.scrollY + rect.top;
          targets.push(Math.max(0, cardAbsoluteTop - TOP_NAV_OFFSET));
        }
      }

      if (targets.length === 0) return;

      const currentY = window.scrollY;

      if (direction === 'next') {
        const nextTarget = targets.find((t) => t > currentY + SCROLL_TOLERANCE);
        window.scrollTo({
          top: nextTarget !== undefined ? nextTarget : targets[0],
          behavior: 'smooth',
        });
      } else {
        // Snaps to the top of current shelf if scrolled partway down,
        // otherwise jumps to the previous shelf, or wraps to the last shelf.
        const prevTargets = targets.filter((t) => t < currentY - SCROLL_TOLERANCE);
        const prevTarget =
          prevTargets.length > 0 ? prevTargets[prevTargets.length - 1] : targets[targets.length - 1];
        window.scrollTo({
          top: prevTarget,
          behavior: 'smooth',
        });
      }
    },
    [photos]
  );

  // Global hotkeys for 'q' (reset), 'n' (next match), 'N' (prev match), and 'Space'/'Shift+Space' (image boundaries)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isUploadOpen) return;

      // Ignore if focused on an input, textarea, or contentEditable
      const activeEl = document.activeElement as HTMLElement | null;
      const tagName = activeEl?.tagName;
      if (tagName === 'INPUT' || tagName === 'TEXTAREA' || activeEl?.isContentEditable) {
        return;
      }

      if ((e.key === 'q' || e.key === 'Q') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        resetKiosk();
      } else if (e.key === 'n' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        cycleMatch('next');
      } else if (
        (e.key === 'N' || (e.key === 'n' && e.shiftKey)) &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey
      ) {
        e.preventDefault();
        cycleMatch('prev');
      } else if ((e.key === ' ' || e.code === 'Space') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        scrollToShelfBoundary(e.shiftKey ? 'prev' : 'next');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isUploadOpen, resetKiosk, cycleMatch, scrollToShelfBoundary]);

  // Keep activeMatchIndex in bounds if results update
  useEffect(() => {
    if (orderedMatches.length === 0) {
      if (activeMatchIndex !== null) setActiveMatchIndex(null);
    } else if (activeMatchIndex !== null && activeMatchIndex >= orderedMatches.length) {
      setActiveMatchIndex(0);
    }
  }, [orderedMatches.length, activeMatchIndex]);

  // Kiosk inactivity timer
  useEffect(() => {
    if (!kioskEnabled) return;

    const resetTimer = () => {
      setKioskSecondsRemaining(KIOSK_TIMEOUT_SECONDS);
    };

    const interval = setInterval(() => {
      if (!searchQuery && window.scrollY < 20) {
        setKioskSecondsRemaining(KIOSK_TIMEOUT_SECONDS);
        return;
      }

      setKioskSecondsRemaining((prev) => {
        if (prev <= 1) {
          resetKiosk();
          return KIOSK_TIMEOUT_SECONDS;
        }
        return prev - 1;
      });
    }, 1000);

    const userActivityEvents = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'];
    userActivityEvents.forEach((evt) => window.addEventListener(evt, resetTimer, { passive: true }));

    return () => {
      clearInterval(interval);
      userActivityEvents.forEach((evt) => window.removeEventListener(evt, resetTimer));
    };
  }, [kioskEnabled, searchQuery, resetKiosk]);

  // Fullscreen toggle handler
  const handleToggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  // Handlers for upload modal
  const handleUploadSuccess = (newPhoto: Photo) => {
    setPhotos((prev) => {
      const updated = [...prev, newPhoto];
      if (workerRef.current) {
        workerRef.current.postMessage({
          type: 'INIT_MANIFEST',
          manifest: updated,
        });
      }
      return updated;
    });
  };

  const handleDeleteSuccess = (photoId: string) => {
    setPhotos((prev) => {
      const updated = prev.filter((p) => p.id !== photoId);
      if (workerRef.current) {
        workerRef.current.postMessage({
          type: 'INIT_MANIFEST',
          manifest: updated,
        });
      }
      return updated;
    });
  };

  return (
    <div className="min-h-screen bg-[#0b0f17] text-slate-100 flex flex-col relative selection:bg-cyan-500/30 selection:text-cyan-200">
      {/* Background Ingest / Seed Progress Banner (shifts page down and scrolls away) */}
      <IngestBanner
        onJobCompleted={handleUploadSuccess}
        onBannerHeightChange={setBannerHeight}
      />

      {/* Pinned Top Omnibar */}
      <FloatingOmnibar
        bannerHeight={bannerHeight}
        searchQuery={searchQuery}
        onSearchChange={handleSearchChange}
        totalMatches={totalMatches}
        highCount={highCount}
        moderateCount={moderateCount}
        activeMatchIndex={activeMatchIndex}
        onEnter={handleSearchEnter}
        kioskSecondsRemaining={kioskSecondsRemaining}
        kioskEnabled={kioskEnabled}
        onToggleKiosk={() => setKioskEnabled(!kioskEnabled)}
        onOpenUpload={() => setIsUploadOpen(true)}
        isFullscreen={isFullscreen}
        onToggleFullscreen={handleToggleFullscreen}
      />

      {/* Main Continuous Stack of Shelf Images */}
      {isLoading ? (
        <div className="flex-1 flex flex-col items-center justify-center min-h-[70vh]">
          <div className="w-10 h-10 border-4 border-cyan-500/20 border-t-cyan-400 rounded-full animate-spin mb-4" />
          <p className="text-sm font-mono text-slate-400">Loading workshop inventory manifest...</p>
        </div>
      ) : (
        <ShelfStream
          photos={photos}
          matchesByBinId={matchesByBinId}
          cardRefs={cardRefs}
          activeBinId={activeBinId}
          onDeletePhoto={handleDeleteSuccess}
        />
      )}

      {/* Peripheral Radar / Off-screen Indicators */}
      <RadarIndicators
        photos={photos}
        matchesByBinId={matchesByBinId}
        cardRefs={cardRefs}
        activeBinId={activeBinId}
        onSelectBin={handleSelectBin}
      />

      {/* Upload and Management Modal */}
      <UploadModal
        isOpen={isUploadOpen}
        onClose={() => setIsUploadOpen(false)}
        photos={photos}
        onUploadSuccess={handleUploadSuccess}
        onDeleteSuccess={handleDeleteSuccess}
      />
    </div>
  );
}

export default App;
