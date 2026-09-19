import { FC, useEffect, useState, useCallback, useRef } from 'react';
import { ArrowUp } from 'lucide-react';
import type { Photo, MatchResult } from '../types';

interface OffscreenIndicator {
  binId: string;
  photoId: string;
  label: string;
  score: number;
  tier: 'high' | 'moderate';
  screenX: number;
  screenY: number;
  angleDeg: number;
  targetAbsoluteY: number;
  edge: 'top' | 'bottom';
}

interface RadarIndicatorsProps {
  photos: Photo[];
  matchesByBinId: Record<string, MatchResult>;
  cardRefs: React.MutableRefObject<Map<string, HTMLDivElement>>;
  activeBinId?: string | null;
  onSelectBin?: (binId: string) => void;
}

export const RadarIndicators: FC<RadarIndicatorsProps> = ({
  photos,
  matchesByBinId,
  cardRefs,
  activeBinId,
  onSelectBin,
}) => {
  const [indicators, setIndicators] = useState<OffscreenIndicator[]>([]);
  const animFrameRef = useRef<number>(0);

  const updateRadar = useCallback(() => {
    const matchIds = Object.keys(matchesByBinId);
    if (matchIds.length === 0) {
      setIndicators([]);
      return;
    }

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const topSafeMargin = 85;    // Space below the fixed floating omnibar
    const bottomSafeMargin = 36; // Space above the bottom of the viewport
    const horizontalMargin = 95; // Padding from left/right screen edges

    // Create a fast lookup for bins
    const binLookup = new Map<string, { photoId: string; bbox: number[]; label: string }>();
    for (const p of photos) {
      for (const b of p.bins) {
        binLookup.set(b.id, { photoId: p.id, bbox: b.bbox, label: b.label });
      }
    }

    const rawIndicators: OffscreenIndicator[] = [];

    for (const binId of matchIds) {
      const match = matchesByBinId[binId];
      const binData = binLookup.get(binId);
      if (!binData) continue;

      const cardEl = cardRefs.current.get(binData.photoId);
      if (!cardEl) continue;

      const imgEl = cardEl.querySelector('img');
      if (!imgEl) continue;

      const imgRect = imgEl.getBoundingClientRect();
      // Skip if image hasn't acquired layout dimensions yet
      if (imgRect.width === 0 || imgRect.height === 0) continue;

      const [bx, by, bw, bh] = binData.bbox;
      const binPixelX = imgRect.left + bx * imgRect.width;
      const binPixelY = imgRect.top + by * imgRect.height;
      const binPixelW = bw * imgRect.width;
      const binPixelH = bh * imgRect.height;

      const binCenterX = binPixelX + binPixelW / 2;
      const binCenterY = binPixelY + binPixelH / 2;

      // Check if the bin is currently visible on-screen
      const isVisible =
        binPixelY + binPixelH > topSafeMargin &&
        binPixelY < vh - bottomSafeMargin &&
        binPixelX + binPixelW > 0 &&
        binPixelX < vw;

      if (isVisible) {
        continue; // Visible on screen, no off-screen arrow needed
      }

      // Determine whether the target is above or below the active viewport
      const edge: 'top' | 'bottom' = binCenterY <= topSafeMargin ? 'top' : 'bottom';
      const screenY = edge === 'top' ? topSafeMargin : vh - bottomSafeMargin;
      const screenX = Math.max(horizontalMargin, Math.min(vw - horizontalMargin, binCenterX));

      // Calculate directional vector from the indicator position on screen to the actual bin center
      const dx = binCenterX - screenX;
      const dy = binCenterY - screenY;
      const angle = Math.atan2(dy, dx);
      const angleDeg = (angle * 180) / Math.PI;

      // Target document scroll position to center the bin vertically in the viewport
      const targetAbsoluteY = window.scrollY + binCenterY - vh / 2;

      rawIndicators.push({
        binId,
        photoId: binData.photoId,
        label: match.label || binData.label,
        score: match.score,
        tier: match.tier,
        screenX,
        screenY,
        angleDeg,
        targetAbsoluteY,
        edge,
      });
    }

    // Separate indicators by edge (top vs bottom) and distribute horizontally so they never overlap
    const distributeEdge = (items: OffscreenIndicator[]): OffscreenIndicator[] => {
      if (items.length <= 1) return items;

      // Cluster close items or deduplicate if too crowded
      // Sort by screenX
      items.sort((a, b) => a.screenX - b.screenX);

      // Keep at most 6 per edge to prevent clutter
      const selected = items.slice(0, 6);
      const minSpacing = 145; // Width of a pill badge + spacing

      for (let i = 1; i < selected.length; i++) {
        if (selected[i].screenX < selected[i - 1].screenX + minSpacing) {
          selected[i].screenX = selected[i - 1].screenX + minSpacing;
        }
      }

      // If the rightmost badge extends past the right boundary, push the cluster back left
      const maxAllowedX = vw - horizontalMargin;
      if (selected[selected.length - 1].screenX > maxAllowedX) {
        const overflow = selected[selected.length - 1].screenX - maxAllowedX;
        for (let i = 0; i < selected.length; i++) {
          selected[i].screenX = Math.max(horizontalMargin, selected[i].screenX - overflow);
        }
      }

      return selected;
    };

    const topGroup = distributeEdge(rawIndicators.filter((ind) => ind.edge === 'top'));
    const bottomGroup = distributeEdge(rawIndicators.filter((ind) => ind.edge === 'bottom'));

    setIndicators([...topGroup, ...bottomGroup]);
  }, [photos, matchesByBinId, cardRefs]);

  useEffect(() => {
    const handleScrollOrResize = () => {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = requestAnimationFrame(updateRadar);
    };

    window.addEventListener('scroll', handleScrollOrResize, { passive: true });
    window.addEventListener('resize', handleScrollOrResize);
    // Trigger on any image load event anywhere in the document
    window.addEventListener('load', handleScrollOrResize, true);

    // Also observe shelf cards resizing when images populate
    const resizeObserver = new ResizeObserver(() => {
      handleScrollOrResize();
    });

    cardRefs.current.forEach((el) => {
      if (el) resizeObserver.observe(el);
    });

    // Run initial update
    updateRadar();

    return () => {
      window.removeEventListener('scroll', handleScrollOrResize);
      window.removeEventListener('resize', handleScrollOrResize);
      window.removeEventListener('load', handleScrollOrResize, true);
      resizeObserver.disconnect();
      cancelAnimationFrame(animFrameRef.current);
    };
  }, [updateRadar, cardRefs]);

  if (indicators.length === 0) return null;

  return (
    <div className="fixed inset-0 pointer-events-none z-40 overflow-hidden">
      {indicators.map((ind) => {
        const isHigh = ind.tier === 'high';
        const percent = Math.round(ind.score * 100);
        const isActive = ind.binId === activeBinId;

        return (
          <button
            key={ind.binId}
            onClick={() => {
              onSelectBin?.(ind.binId);
              window.scrollTo({
                top: Math.max(0, ind.targetAbsoluteY),
                behavior: 'smooth',
              });
            }}
            style={{
              left: `${ind.screenX}px`,
              top: `${ind.screenY}px`,
              transform: 'translate(-50%, -50%)',
            }}
            className={`absolute pointer-events-auto cursor-pointer group flex items-center space-x-1.5 px-3 py-1.5 rounded-full shadow-2xl backdrop-blur-md transition-all duration-150 hover:scale-105 active:scale-95 ${
              isActive
                ? 'bg-yellow-400 border-2 border-white text-black font-black shadow-[0_0_20px_rgba(250,204,21,1)] scale-105 z-50 ring-2 ring-yellow-300'
                : isHigh
                ? 'bg-black/95 border-2 border-yellow-400 text-yellow-400 shadow-yellow-950/50 hover:bg-yellow-950/80 hover:border-yellow-300'
                : 'bg-black/90 border border-yellow-500/80 text-yellow-400/90 shadow-black/80 hover:bg-slate-900'
            }`}
          >
            {/* Directional arrow rotated toward target */}
            <div
              style={{
                transform: `rotate(${ind.angleDeg + 90}deg)`,
                transformOrigin: 'center center',
              }}
              className="flex-shrink-0 transition-transform duration-100"
            >
              <ArrowUp className="w-3.5 h-3.5 stroke-[2.5]" />
            </div>

            {/* Label and confidence percentage */}
            <span className="font-mono text-xs font-bold max-w-[120px] truncate">
              {ind.label}
            </span>
            <span className={`font-mono text-[11px] font-semibold ${
              isActive ? 'text-black/80' : 'text-yellow-300 opacity-90'
            }`}>
              {percent}%
            </span>
          </button>
        );
      })}
    </div>
  );
};
