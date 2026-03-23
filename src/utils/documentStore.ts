import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from '../workers/pdf-worker?worker&url';

// Configure PDF.js worker with CDN
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

export interface Document {
  id: string;
  name: string;
  text: string;
  chunks: string[]; 
  embeddings?: number[][]; // Semantic vectors
  pages: number;
  uploadedAt: number;
  size: number;
  keywords?: string[]; // For faster indexing
}

const STORAGE_KEY = 'research-copilot-documents-v4';

class DocumentStoreClass {
  private documents: Map<string, Document> = new Map();
  private listeners: Set<() => void> = new Set();
  private embeddingWorker: Worker | null = null;

  constructor() {
    this.loadFromStorage();
  }

  private getEmbeddingWorker(): Worker {
    if (!this.embeddingWorker) {
      this.embeddingWorker = new Worker(pdfWorkerUrl, { type: 'module' });
    }
    return this.embeddingWorker;
  }

  private loadFromStorage() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const docs = JSON.parse(stored) as Document[];
        docs.forEach(doc => this.documents.set(doc.id, doc));
      }
    } catch (err) {
      console.error('Failed to load documents:', err);
    }
  }

  private saveToStorage() {
    try {
      const docs = Array.from(this.documents.values());
      localStorage.setItem(STORAGE_KEY, JSON.stringify(docs));
    } catch (err) {
      console.error('Failed to save documents:', err);
    }
  }

  private notifyListeners() {
    this.listeners.forEach(listener => listener());
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async addDocument(file: File, onProgress?: (status: string, progress: number) => void): Promise<Document> {
    return new Promise(async (resolve, reject) => {
      const arrayBuffer = await file.arrayBuffer();
      // Temporary worker for full extraction to avoid blocking the persistent one
      const worker = new Worker(pdfWorkerUrl, { type: 'module' });
      
      worker.onmessage = (e) => {
        const { type, text, chunks, embeddings, pages, progress, status, error } = e.data;
        
        if (type === 'progress') {
          if (onProgress) onProgress(status || 'Processing...', progress);
        } else if (type === 'done') {
          if (onProgress) onProgress('Finalizing document...', 0.99);
          
          const doc: Document = {
            id: `doc-${Date.now()}`,
            name: file.name,
            text: text,
            chunks: chunks,
            embeddings: embeddings,
            pages: pages,
            uploadedAt: Date.now(),
            size: file.size,
          };

          this.documents.set(doc.id, doc);
          this.saveToStorage();
          this.notifyListeners();
          
          worker.terminate();
          if (onProgress) onProgress('Ready!', 1);
          resolve(doc);
        } else if (type === 'error') {
          worker.terminate();
          reject(new Error(error));
        }
      };

      worker.postMessage({ type: 'extract', arrayBuffer }, [arrayBuffer]);
    });
  }

  /** Vector-based retrieval using Cosine Similarity */
  async searchDocument(docId: string, query: string, topK: number = 3): Promise<any[]> {
    const doc = this.documents.get(docId);
    if (!doc || !doc.embeddings || !doc.chunks) {
      const kResults = this.searchDocumentByKeyword(docId, query, topK);
      return kResults.map(r => ({ chunk: r.snippet, score: r.score }));
    }

    try {
      return await this.searchDocumentByVector(docId, query, topK);
    } catch (err) {
      console.warn('Vector search failed, falling back to keyword:', err);
      const kResults = this.searchDocumentByKeyword(docId, query, topK);
      return kResults.map(r => ({ chunk: r.snippet, score: r.score }));
    }
  }

  private async searchDocumentByVector(docId: string, query: string, topK: number = 3): Promise<any[]> {
    const doc = this.documents.get(docId);
    if (!doc || !doc.embeddings) return [];

    // 1. Embed Query
    const queryEmbedding = await this.embedQuery(query);

    // 2. Compute Similarities
    const scores = doc.embeddings.map((emb, idx) => ({
      chunk: doc.chunks[idx],
      score: this.cosineSimilarity(queryEmbedding, emb)
    }));

    // 3. Sort and Return
    return scores
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  private embedQuery(text: string): Promise<number[]> {
    return new Promise((resolve, reject) => {
      const worker = this.getEmbeddingWorker();
      const handler = (e: MessageEvent) => {
        if (e.data.type === 'done' && e.data.embedding) {
          worker.removeEventListener('message', handler);
          resolve(e.data.embedding);
        } else if (e.data.type === 'error') {
          worker.removeEventListener('message', handler);
          reject(new Error(e.data.error));
        }
      };
      worker.addEventListener('message', handler);
      worker.postMessage({ type: 'embed', text });
    });
  }

  searchDocumentByKeyword(docId: string, query: string, maxSnippets: number = 3): Array<{ snippet: string; score: number }> {
    const doc = this.documents.get(docId);
    if (!doc || !doc.chunks || doc.chunks.length === 0) return [];

    const keywords = query.toLowerCase().split(/\s+/).filter(k => k.length > 3);
    const results: Array<{ snippet: string; score: number }> = [];
    
    for (const chunk of doc.chunks) {
      let score = 0;
      const lowerChunk = chunk.toLowerCase();
      for (const keyword of keywords) {
        if (lowerChunk.includes(keyword)) score += 1;
      }
      if (score > 0) results.push({ snippet: chunk, score });
    }

    if (results.length === 0) return [{ snippet: doc.chunks[0].substring(0, 500), score: 0 }];

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, maxSnippets);
  }

  // Implementation of cosine similarity for numbers
  cosineSimilarity(vecA: number[], vecB: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  getDocument(id: string): Document | undefined { return this.documents.get(id); }
  getAllDocuments(): Document[] { return Array.from(this.documents.values()).sort((a, b) => b.uploadedAt - a.uploadedAt); }
  removeDocument(id: string) { this.documents.delete(id); this.saveToStorage(); this.notifyListeners(); }
  clearAll() { this.documents.clear(); this.saveToStorage(); this.notifyListeners(); }
}

export const DocumentStore = new DocumentStoreClass();
