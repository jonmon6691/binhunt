export interface Bin {
  id: string;
  photo_id: string;
  label: string;
  semantic_tags: string[];
  bbox: [number, number, number, number]; // [x, y, w, h] normalized 0.0 - 1.0
}

export interface Photo {
  id: string;
  filename: string;
  original_name: string;
  width: number;
  height: number;
  created_at: string;
  bins: Bin[];
}

export type MatchTier = 'high' | 'moderate';

export interface MatchResult {
  binId: string;
  photoId: string;
  score: number;
  tier: MatchTier;
  label: string;
}

export interface SearchState {
  matchesByBinId: Record<string, MatchResult>;
  highCount: number;
  moderateCount: number;
  totalMatches: number;
  activeQuery: string;
}

export type WorkerIncomingMessage =
  | { type: 'INIT_MANIFEST'; manifest: Photo[] }
  | { type: 'SEARCH'; query: string; queryId: number };

export type WorkerOutgoingMessage =
  | { type: 'INIT_READY'; totalBins: number }
  | {
      type: 'SEARCH_RESULTS';
      queryId: number;
      matches: Record<string, MatchResult>;
      totalMatches: number;
      highCount: number;
      moderateCount: number;
    }
  | { type: 'ERROR'; message: string };
