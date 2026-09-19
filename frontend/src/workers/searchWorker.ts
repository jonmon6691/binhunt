import Fuse from 'fuse.js';
import { pipeline, env } from '@xenova/transformers';
import type { Photo, MatchResult, WorkerIncomingMessage, WorkerOutgoingMessage } from '../types';

// Configure transformers.js for client browser execution
env.allowLocalModels = false;
env.useBrowserCache = true;

interface IndexedBin {
  id: string;
  photoId: string;
  label: string;
  tagsText: string;
  vector: Float32Array | null;
}

let fuseInstance: Fuse<IndexedBin> | null = null;
let allBins: IndexedBin[] = [];
let featureExtractor: any = null;
let isExtractorLoading = false;

async function initFeatureExtractor() {
  if (featureExtractor || isExtractorLoading) return featureExtractor;
  isExtractorLoading = true;
  try {
    featureExtractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
      quantized: true,
    });
  } catch (err) {
    console.warn('Could not initialize transformers.js pipeline in worker:', err);
  } finally {
    isExtractorLoading = false;
  }
  return featureExtractor;
}

// Start loading the embedding pipeline in background
initFeatureExtractor();

function handleInitManifest(manifest: Photo[]) {
  allBins = [];

  for (const photo of manifest) {
    for (const bin of photo.bins) {
      let vecArray: Float32Array | null = null;
      if (bin.embedding && bin.embedding.length > 0) {
        vecArray = new Float32Array(bin.embedding);
        // Ensure unit normalization
        let normSq = 0;
        for (let i = 0; i < vecArray.length; i++) normSq += vecArray[i] * vecArray[i];
        const norm = Math.sqrt(normSq);
        if (norm > 0) {
          for (let i = 0; i < vecArray.length; i++) vecArray[i] /= norm;
        }
      }

      allBins.push({
        id: bin.id,
        photoId: photo.id,
        label: bin.label,
        tagsText: bin.semantic_tags.join(' '),
        vector: vecArray,
      });
    }
  }

  // Configure Fuse for fuzzy literal matching
  fuseInstance = new Fuse(allBins, {
    keys: [
      { name: 'label', weight: 0.7 },
      { name: 'tagsText', weight: 0.3 },
    ],
    threshold: 0.45,
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

async function handleSearch(query: string, queryId: number) {
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

  // 1. Literal search via Fuse.js
  const literalScores: Record<string, number> = {};
  if (fuseInstance) {
    const fuseResults = fuseInstance.search(trimmed);
    for (const res of fuseResults) {
      // Fuse score: 0 is perfect, 1 is complete mismatch
      const fuseScore = res.score ?? 1.0;
      const scoreLiteral = Math.max(0, 1.0 - fuseScore);
      literalScores[res.item.id] = scoreLiteral;
    }
  }

  // 2. Semantic vector search
  const semanticScores: Record<string, number> = {};
  try {
    const extractor = await initFeatureExtractor();
    if (extractor) {
      const output = await extractor(trimmed, { pooling: 'mean', normalize: true });
      const queryVec = output.data as Float32Array;

      for (const bin of allBins) {
        if (!bin.vector) continue;
        let dotProduct = 0;
        const len = Math.min(queryVec.length, bin.vector.length);
        for (let i = 0; i < len; i++) {
          dotProduct += queryVec[i] * bin.vector[i];
        }
        semanticScores[bin.id] = dotProduct;
      }
    }
  } catch (err) {
    console.warn('Semantic vector inference failed:', err);
  }

  // 3. Score combination: max(Score_literal * 1.25, Score_semantic)
  const matches: Record<string, MatchResult> = {};
  let highCount = 0;
  let moderateCount = 0;

  for (const bin of allBins) {
    const sLit = (literalScores[bin.id] ?? 0.0) * 1.25;
    const sSem = semanticScores[bin.id] ?? 0.0;
    const finalScore = Math.max(sLit, sSem);

    if (finalScore >= 0.70) {
      matches[bin.id] = {
        binId: bin.id,
        photoId: bin.photoId,
        score: Math.min(1.0, finalScore),
        tier: 'high',
        label: bin.label,
      };
      highCount++;
    } else if (finalScore >= 0.50) {
      matches[bin.id] = {
        binId: bin.id,
        photoId: bin.photoId,
        score: Math.min(1.0, finalScore),
        tier: 'moderate',
        label: bin.label,
      };
      moderateCount++;
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

self.onmessage = async (e: MessageEvent<WorkerIncomingMessage>) => {
  const msg = e.data;
  if (msg.type === 'INIT_MANIFEST') {
    handleInitManifest(msg.manifest);
  } else if (msg.type === 'SEARCH') {
    await handleSearch(msg.query, msg.queryId);
  }
};
