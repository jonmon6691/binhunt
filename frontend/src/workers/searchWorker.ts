import Fuse from 'fuse.js';
import type { Photo, MatchResult, WorkerIncomingMessage, WorkerOutgoingMessage } from '../types';

interface IndexedBin {
  id: string;
  photoId: string;
  label: string;
  tagsText: string;
}

let fuseInstance: Fuse<IndexedBin> | null = null;
let allBins: IndexedBin[] = [];

function handleInitManifest(manifest: Photo[]) {
  allBins = [];

  for (const photo of manifest) {
    for (const bin of photo.bins) {
      allBins.push({
        id: bin.id,
        photoId: photo.id,
        label: bin.label,
        tagsText: bin.semantic_tags.join(' '),
      });
    }
  }

  // Configure Fuse for fuzzy matching on label and Gemini-generated semantic tags
  fuseInstance = new Fuse(allBins, {
    keys: [
      { name: 'label', weight: 0.6 },
      { name: 'tagsText', weight: 0.4 },
    ],
    threshold: 0.5,
    ignoreLocation: true,
    includeScore: true,
    minMatchCharLength: 2,
  });

  const reply: WorkerOutgoingMessage = {
    type: 'INIT_READY',
    totalBins: allBins.length,
  };
  self.postMessage(reply);
}

function handleSearch(query: string, queryId: number) {
  const trimmed = query.trim();
  if (!trimmed || allBins.length === 0) {
    const emptyReply: WorkerOutgoingMessage = {
      type: 'SEARCH_RESULTS',
      queryId,
      matches: {},
      totalMatches: 0,
      highCount: 0,
      moderateCount: 0,
    };
    self.postMessage(emptyReply);
    return;
  }

  const matches: Record<string, MatchResult> = {};
  let highCount = 0;
  let moderateCount = 0;

  if (fuseInstance) {
    const fuseResults = fuseInstance.search(trimmed);
    for (const res of fuseResults) {
      const fuseScore = res.score ?? 1.0;
      // 0.0 is perfect match, 1.0 is complete mismatch
      const confidence = Math.max(0, 1.0 - fuseScore);

      if (confidence >= 0.65) {
        matches[res.item.id] = {
          binId: res.item.id,
          photoId: res.item.photoId,
          score: Math.min(1.0, confidence),
          tier: 'high',
          label: res.item.label,
        };
        highCount++;
      } else if (confidence >= 0.45) {
        matches[res.item.id] = {
          binId: res.item.id,
          photoId: res.item.photoId,
          score: Math.min(1.0, confidence),
          tier: 'moderate',
          label: res.item.label,
        };
        moderateCount++;
      }
    }
  }

  const reply: WorkerOutgoingMessage = {
    type: 'SEARCH_RESULTS',
    queryId,
    matches,
    totalMatches: highCount + moderateCount,
    highCount,
    moderateCount,
  };
  self.postMessage(reply);
}

self.onmessage = (e: MessageEvent<WorkerIncomingMessage>) => {
  const msg = e.data;
  if (msg.type === 'INIT_MANIFEST') {
    handleInitManifest(msg.manifest);
  } else if (msg.type === 'SEARCH') {
    handleSearch(msg.query, msg.queryId);
  }
};
