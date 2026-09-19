import { FC } from 'react';
import type { Bin, MatchResult } from '../types';

interface HighlightOverlayProps {
  bins: Bin[];
  matchesByBinId: Record<string, MatchResult>;
  activeBinId?: string | null;
}

export const HighlightOverlay: FC<HighlightOverlayProps> = ({
  bins,
  matchesByBinId,
  activeBinId,
}) => {
  const activeMatches = bins.filter((b) => Boolean(matchesByBinId[b.id]));

  if (activeMatches.length === 0) {
    return null;
  }

  return (
    <div className="absolute inset-0 w-full h-full pointer-events-none select-none z-10 overflow-visible">
      {activeMatches.map((bin) => {
        const match = matchesByBinId[bin.id];
        const isHigh = match.tier === 'high';
        const percent = Math.round(match.score * 100);
        const isActive = bin.id === activeBinId;

        const leftPercent = bin.bbox[0] * 100;
        const topPercent = bin.bbox[1] * 100;
        const widthPercent = bin.bbox[2] * 100;
        const heightPercent = bin.bbox[3] * 100;

        // If bin is near the top edge of the image (< 5%), dock badge inside top of box, else above
        const isNearTop = topPercent < 5;

        return (
          <div
            key={bin.id}
            style={{
              left: `${leftPercent}%`,
              top: `${topPercent}%`,
              width: `${widthPercent}%`,
              height: `${heightPercent}%`,
            }}
            className={`absolute transition-all duration-150 ${isActive ? 'z-30' : 'z-10'}`}
          >
            {isHigh ? (
              /* High Confidence: Heavy-stroke marching ants outline with black secondary color, hollow interior */
              <svg
                className={`absolute inset-0 w-full h-full overflow-visible pointer-events-none ${
                  isActive ? 'drop-shadow-[0_0_12px_rgba(250,204,21,1)]' : ''
                }`}
              >
                {/* Heavy solid black base stroke */}
                <rect
                  x="0"
                  y="0"
                  width="100%"
                  height="100%"
                  rx="4"
                  fill="none"
                  stroke="#000000"
                  strokeWidth="4.5"
                />
                {/* Heavy animated marching yellow dashes */}
                <rect
                  x="0"
                  y="0"
                  width="100%"
                  height="100%"
                  rx="4"
                  fill="none"
                  stroke="#facc15"
                  strokeWidth="4.5"
                  strokeDasharray="10 10"
                  className="marching-ants-svg"
                />
                {/* Active outer pulse ring */}
                {isActive && (
                  <rect
                    x="-3"
                    y="-3"
                    width="calc(100% + 6px)"
                    height="calc(100% + 6px)"
                    rx="7"
                    fill="none"
                    stroke="#facc15"
                    strokeWidth="2.5"
                    className="animate-pulse"
                  />
                )}
              </svg>
            ) : (
              /* Moderate Confidence: Solid yellow outline, no thin dotted line, hollow interior */
              <div
                className={`absolute inset-0 rounded-[4px] bg-transparent ${
                  isActive
                    ? 'border-[4px] border-yellow-300 ring-2 ring-yellow-400 shadow-[0_0_16px_rgba(250,204,21,0.9)]'
                    : 'border-[3px] border-yellow-400/90 shadow-[0_0_8px_rgba(250,204,21,0.4)]'
                }`}
              />
            )}

            {/* Industrial Yellow Label Badge - consistent yellow on all matches, inverted on active */}
            <div
              style={{
                top: isNearTop ? '6px' : '-26px',
                left: '0px',
              }}
              className={`absolute flex items-center space-x-1.5 px-2.5 py-0.5 rounded shadow-2xl backdrop-blur-md whitespace-nowrap z-20 pointer-events-none transition-all duration-150 ${
                isActive
                  ? 'bg-yellow-400 border-2 border-white text-black font-black shadow-[0_0_16px_rgba(250,204,21,0.9)] scale-105'
                  : isHigh
                  ? 'bg-black/95 border-2 border-yellow-400 text-yellow-400 font-extrabold shadow-black'
                  : 'bg-black/90 border border-yellow-400/80 text-yellow-400 font-bold shadow-black'
              }`}
            >
              {isActive && (
                <span className="inline-block px-1 py-0.2 text-[9px] font-black bg-black text-yellow-300 rounded mr-0.5 uppercase tracking-wider">
                  ACTIVE
                </span>
              )}
              <span
                className={`font-mono text-xs tracking-tight ${
                  isActive ? 'text-black font-black' : 'drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]'
                }`}
              >
                {bin.label}
              </span>
              <span
                className={`font-mono text-[10px] font-bold ${
                  isActive ? 'text-black/80' : 'text-yellow-300 opacity-90'
                }`}
              >
                ({percent}%)
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
};
