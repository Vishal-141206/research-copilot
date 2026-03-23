/**
 * DocumentStore - Manages uploaded PDFs with RAG capabilities
 * Stores documents with text chunks and embeddings for semantic search
 */

import * as pdfjsLib from 'pdfjs-dist';
import { chunkText } from './pdfProcessor';
import { cosineSimilarity, SearchResult } from './embeddings';
import { workerManager } from '../workers/workerManager';

// Configure PDF.js worker with CDN for reliability
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

export interface Document {
  id: string;
  name: string;
  text: string;
  pages: number;
  uploadedAt: number;
  size: number;
  chunks?: string[];
  embeddings?: number[][];
}

const STORAGE_KEY = 'research-copilot-documents';

class DocumentStoreClass {
  private documents: Map<string, Document> = new Map();
  private listeners: Set<() => void> = new Set();

  constructor() {
    this.loadFromStorage();
  }

  private loadFromStorage() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const docs = JSON.parse(stored) as Document[];
        docs.forEach(doc => this.documents.set(doc.id, doc));
      }
    } catch (err) {
      console.error('Failed to load documents from storage:', err);
    }
  }

  private saveToStorage() {
    try {
      const docs = Array.from(this.documents.values());
      localStorage.setItem(STORAGE_KEY, JSON.stringify(docs));
    } catch (err) {
      console.error('Failed to save documents to storage:', err);
    }
  }

  private notifyListeners() {
    this.listeners.forEach(listener => listener());
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async addDocument(
    file: File,
    onProgress?: (status: string, progress: number) => void
  ): Promise<Document> {
    // Extract text from PDF
    if (onProgress) onProgress('Extracting text from PDF...', 0);
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    
    let text = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item: any) => item.str)
        .join(' ');
      text += pageText + '\n\n';
      
      if (onProgress) {
        onProgress('Extracting text from PDF...', i / pdf.numPages * 0.3);
      }
    }

    // Create document
    const doc: Document = {
      id: `doc-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name: file.name,
      text: text.trim(),
      pages: pdf.numPages,
      uploadedAt: Date.now(),
      size: file.size,
    };

    this.documents.set(doc.id, doc);
    this.saveToStorage();
    this.notifyListeners();

    return doc;
  }

  /**
   * Process document for RAG: chunk text and generate embeddings
   */
  async processDocumentForRAG(
    docId: string,
    onProgress?: (status: string, progress: number) => void
  ): Promise<void> {
    const doc = this.documents.get(docId);
    if (!doc) throw new Error('Document not found');

    // Chunk the text
    if (onProgress) onProgress('Chunking document...', 0.3);
    const chunks = chunkText(doc.text, 800, 75);
    doc.chunks = chunks;

    // Initialize worker if needed
    if (onProgress) onProgress('Initializing embedding model...', 0.35);
    await workerManager.initEmbeddings((prog) => {
      if (onProgress) onProgress(`Loading model: ${prog.status}`, 0.35 + (prog.progress || 0) * 0.05);
    });

    // Generate embeddings in a separate non-blocking thread
    if (onProgress) onProgress('Generating embeddings in background...', 0.4);
    const embeddings = await workerManager.generateEmbeddings(chunks, (current, total) => {
      if (onProgress) {
        const progress = 0.4 + (current / total) * 0.6;
        onProgress(`Generating embeddings (${current}/${total})...`, progress);
      }
    });
    doc.embeddings = embeddings;

    this.documents.set(docId, doc);
    // Note: We don't save embeddings to localStorage as they're too large
    this.notifyListeners();

    if (onProgress) onProgress('Document ready for RAG!', 1);
  }

  /**
   * Search for relevant chunks in a document using semantic search
   */
  async searchDocument(
    docId: string,
    query: string,
    topK: number = 3
  ): Promise<SearchResult[]> {
    const doc = this.documents.get(docId);
    if (!doc) throw new Error('Document not found');
    if (!doc.chunks || !doc.embeddings) {
      throw new Error('Document not processed for RAG. Call processDocumentForRAG first.');
    }

    // Generate query embedding in background worker to completely avoid freezing the UI
    const queryEmbedding = await workerManager.generateEmbedding(query);

    // Calculate similarities in main thread (fast since it's just math on a few hundred small arrays)
    const results: SearchResult[] = [];
    for (let i = 0; i < doc.chunks.length; i++) {
      const similarity = cosineSimilarity(queryEmbedding, doc.embeddings[i]);
      results.push({
        chunkIndex: i,
        chunk: doc.chunks[i],
        similarity,
      });
    }

    // Sort descending by similarity and take top K
    return results
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK);
  }

  /**
   * Check if a document is ready for RAG
   */
  isDocumentReady(docId: string): boolean {
    const doc = this.documents.get(docId);
    return !!(doc?.chunks && doc?.embeddings);
  }

  removeDocument(id: string) {
    this.documents.delete(id);
    this.saveToStorage();
    this.notifyListeners();
  }

  getDocument(id: string): Document | undefined {
    return this.documents.get(id);
  }

  getAllDocuments(): Document[] {
    return Array.from(this.documents.values()).sort((a, b) => b.uploadedAt - a.uploadedAt);
  }

  clearAll() {
    this.documents.clear();
    this.saveToStorage();
    this.notifyListeners();
  }

  /**
   * Search for relevant text snippets in a SPECIFIC document
   * Simple keyword-based search for RAG context
   */
  searchDocumentByKeyword(docId: string, query: string, maxSnippets: number = 3): Array<{ snippet: string }> {
    const doc = this.documents.get(docId);
    if (!doc) return [];

    const keywords = query.toLowerCase().split(/\s+/).filter(k => k.length > 3);
    if (keywords.length === 0) return [];

    const results: Array<{ snippet: string; score: number }> = [];
    const text = doc.text.toLowerCase();
    
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
    
    for (const sentence of sentences) {
      let score = 0;
      for (const keyword of keywords) {
        if (sentence.includes(keyword)) score += 1;
      }
      
      if (score > 0) {
        results.push({ snippet: sentence.trim(), score });
      }
    }

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, maxSnippets)
      .map(({ snippet }) => ({ snippet }));
  }

  /**
   * Search for relevant text snippets across ALL documents
   * Used by ResearchChatTab
   */
  searchAllDocuments(query: string, maxSnippets: number = 3): Array<{ doc: Document; snippet: string }> {
    const keywords = query.toLowerCase().split(/\s+/).filter(k => k.length > 3);
    if (keywords.length === 0) return [];

    const results: Array<{ doc: Document; snippet: string; score: number }> = [];

    for (const doc of this.documents.values()) {
      const text = doc.text.toLowerCase();
      
      let score = 0;
      for (const keyword of keywords) {
        const matches = (text.match(new RegExp(keyword, 'g')) || []).length;
        score += matches;
      }

      if (score > 0) {
        const firstKeyword = keywords[0];
        const index = text.indexOf(firstKeyword);
        const start = Math.max(0, index - 200);
        const end = Math.min(text.length, index + 300);
        const snippet = doc.text.substring(start, end).trim();

        results.push({ doc, snippet: '...' + snippet + '...', score });
      }
    }

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, maxSnippets)
      .map(({ doc, snippet }) => ({ doc, snippet }));
  }
}

export const DocumentStore = new DocumentStoreClass();
