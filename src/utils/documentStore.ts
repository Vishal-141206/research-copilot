/**
 * DocumentStore - Manages uploaded PDFs and extracted text
 * Stores documents in browser localStorage for persistence
 */

import * as pdfjsLib from 'pdfjs-dist';

// Configure PDF.js worker with CDN for reliability
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

export interface Document {
  id: string;
  name: string;
  text: string;
  pages: number;
  uploadedAt: number;
  size: number;
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

  async addDocument(file: File): Promise<Document> {
    // Extract text from PDF
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
    }

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
   * Search for relevant text snippets in documents
   * Simple keyword-based search for RAG context
   */
  searchDocuments(query: string, maxSnippets: number = 3): Array<{ doc: Document; snippet: string }> {
    const keywords = query.toLowerCase().split(/\s+/).filter(k => k.length > 3);
    if (keywords.length === 0) return [];

    const results: Array<{ doc: Document; snippet: string; score: number }> = [];

    for (const doc of this.documents.values()) {
      const text = doc.text.toLowerCase();
      
      // Count keyword matches
      let score = 0;
      for (const keyword of keywords) {
        const matches = (text.match(new RegExp(keyword, 'g')) || []).length;
        score += matches;
      }

      if (score > 0) {
        // Extract snippet around first keyword match
        const firstKeyword = keywords[0];
        const index = text.indexOf(firstKeyword);
        const start = Math.max(0, index - 200);
        const end = Math.min(text.length, index + 300);
        const snippet = doc.text.substring(start, end).trim();

        results.push({ doc, snippet: '...' + snippet + '...', score });
      }
    }

    // Sort by score and return top results
    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, maxSnippets)
      .map(({ doc, snippet }) => ({ doc, snippet }));
  }
}

export const DocumentStore = new DocumentStoreClass();
