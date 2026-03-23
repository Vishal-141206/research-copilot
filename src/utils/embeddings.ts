/**
 * Embeddings and Vector Search Utilities
 * 
 * Handles text embeddings using Transformers.js and vector similarity search
 */

import { pipeline, env } from '@xenova/transformers';

// Configure Transformers.js to use local models
env.allowLocalModels = false;
env.allowRemoteModels = true;

let embeddingPipeline: any = null;

/**
 * Initialize the embedding model
 */
export async function initEmbeddings(
  onProgress?: (progress: { status: string; progress?: number }) => void
): Promise<void> {
  if (embeddingPipeline) return;
  
  embeddingPipeline = await pipeline(
    'feature-extraction',
    'Xenova/all-MiniLM-L6-v2',
    {
      progress_callback: onProgress,
    }
  );
}

/**
 * Generate embeddings for a text
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  if (!embeddingPipeline) {
    await initEmbeddings();
  }
  
  const output = await embeddingPipeline(text, {
    pooling: 'mean',
    normalize: true,
  });
  
  // Convert to regular array
  return Array.from(output.data);
}

/**
 * Generate embeddings for multiple texts in batch
 */
export async function generateEmbeddings(
  texts: string[],
  onProgress?: (current: number, total: number) => void
): Promise<number[][]> {
  const embeddings: number[][] = [];
  
  for (let i = 0; i < texts.length; i++) {
    const embedding = await generateEmbedding(texts[i]);
    embeddings.push(embedding);
    
    if (onProgress) {
      onProgress(i + 1, texts.length);
    }
  }
  
  return embeddings;
}

/**
 * Calculate cosine similarity between two vectors
 */
export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length) {
    throw new Error('Vectors must have the same length');
  }
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Find the most similar chunks to a query
 */
export interface SearchResult {
  chunkIndex: number;
  chunk: string;
  similarity: number;
}

export async function searchSimilarChunks(
  query: string,
  chunks: string[],
  embeddings: number[][],
  topK: number = 3
): Promise<SearchResult[]> {
  // Generate query embedding
  const queryEmbedding = await generateEmbedding(query);
  
  // Calculate similarities
  const results: SearchResult[] = chunks.map((chunk, index) => ({
    chunkIndex: index,
    chunk,
    similarity: cosineSimilarity(queryEmbedding, embeddings[index]),
  }));
  
  // Sort by similarity (descending) and take top K
  results.sort((a, b) => b.similarity - a.similarity);
  
  return results.slice(0, topK);
}

/**
 * Check if embeddings are initialized
 */
export function isEmbeddingsReady(): boolean {
  return embeddingPipeline !== null;
}
