/**
 * Orama Vector Database
 * 
 * Fast in-memory vector search with Orama
 */

import { create, insert, search, Orama } from '@orama/orama';
import { generateEmbedding } from './embeddings';

export interface VectorDocument {
  id: string;
  text: string;
  pageNumber: number;
  chunkIndex: number;
  embedding: number[];
}

export interface SearchResult {
  id: string;
  text: string;
  pageNumber: number;
  chunkIndex: number;
  score: number;
}

let db: Orama<any> | null = null;

/**
 * Initialize the Orama database
 */
export async function initVectorDB() {
  db = await create({
    schema: {
      id: 'string',
      text: 'string',
      pageNumber: 'number',
      chunkIndex: 'number',
      embedding: 'vector[384]', // all-MiniLM-L6-v2 dimension
    },
  });
}

/**
 * Insert a document into the vector database
 */
export async function insertDocument(doc: VectorDocument) {
  if (!db) await initVectorDB();
  
  await insert(db!, {
    id: doc.id,
    text: doc.text,
    pageNumber: doc.pageNumber,
    chunkIndex: doc.chunkIndex,
    embedding: doc.embedding,
  });
}

/**
 * Search for similar documents
 */
export async function searchSimilar(
  query: string,
  limit: number = 3
): Promise<SearchResult[]> {
  if (!db) throw new Error('Vector database not initialized');
  
  // Generate query embedding
  const queryEmbedding = await generateEmbedding(query);
  
  // Search using vector similarity
  const results = await search(db, {
    mode: 'vector',
    vector: {
      value: queryEmbedding,
      property: 'embedding',
    },
    limit,
  });
  
  return results.hits.map((hit: any) => ({
    id: hit.document.id,
    text: hit.document.text,
    pageNumber: hit.document.pageNumber,
    chunkIndex: hit.document.chunkIndex,
    score: hit.score,
  }));
}

/**
 * Clear the database
 */
export async function clearVectorDB() {
  db = null;
  await initVectorDB();
}

/**
 * Check if database is ready
 */
export function isVectorDBReady(): boolean {
  return db !== null;
}
