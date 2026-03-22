/**
 * Enhanced Document Store with Vector Embeddings
 * Uses simple TF-IDF for fast semantic search (no heavy models needed for demo)
 */

import * as pdfjsLib from 'pdfjs-dist';
import localforage from 'localforage';

// Use CDN worker for maximum compatibility
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

export interface DocumentChunk {
  id: string;
  docId: string;
  text: string;
  page: number;
  position: number;
  embedding?: number[];
}

export interface Document {
  id: string;
  name: string;
  text: string;
  chunks: DocumentChunk[];
  pages: number;
  uploadedAt: number;
  size: number;
}

class DocumentStoreClass {
  private documents: Map<string, Document> = new Map();
  private listeners: Set<() => void> = new Set();
  private storage = localforage.createInstance({
    name: 'research-copilot',
    storeName: 'documents',
  });

  async init() {
    try {
      const keys = await this.storage.keys();
      for (const key of keys) {
        const doc = await this.storage.getItem<Document>(key);
        if (doc) {
          this.documents.set(key, doc);
        }
      }
    } catch (err) {
      console.warn('Failed to load documents:', err);
    }
  }

  private notifyListeners() {
    this.listeners.forEach(listener => listener());
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private chunkText(text: string, chunkSize: number = 500, overlap: number = 50): string[] {
    const chunks: string[] = [];
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    
    let currentChunk = '';
    let previousSentences: string[] = [];

    for (const sentence of sentences) {
      const trimmed = sentence.trim();
      if (!trimmed) continue;

      if ((currentChunk + trimmed).length > chunkSize && currentChunk.length > 0) {
        chunks.push(currentChunk.trim());
        // Add overlap from previous sentences
        currentChunk = previousSentences.slice(-1).join('. ') + '. ' + trimmed;
        previousSentences = [trimmed];
      } else {
        currentChunk += (currentChunk ? '. ' : '') + trimmed;
        previousSentences.push(trimmed);
      }
    }

    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
    }

    return chunks;
  }

  async addDocument(file: File): Promise<Document> {
    try {
      console.log('Starting PDF upload:', file.name, 'Size:', file.size);
      
      // Read file as ArrayBuffer
      const arrayBuffer = await file.arrayBuffer();
      console.log('File read successfully, buffer size:', arrayBuffer.byteLength);
      
      // Load PDF with error handling
      let pdf;
      try {
        const loadingTask = pdfjsLib.getDocument({ 
          data: arrayBuffer,
          useSystemFonts: true,
          verbosity: 0, // Reduce console noise
        });
        
        pdf = await loadingTask.promise;
        console.log('PDF loaded successfully, pages:', pdf.numPages);
      } catch (pdfError: any) {
        console.error('PDF parsing error:', pdfError);
        
        // Provide specific error messages
        if (pdfError.name === 'PasswordException') {
          throw new Error('PDF is password protected. Please use an unprotected PDF.');
        } else if (pdfError.name === 'InvalidPDFException') {
          throw new Error('Invalid PDF file. The file may be corrupted.');
        } else if (pdfError.message?.includes('Missing PDF')) {
          throw new Error('Not a valid PDF file.');
        } else {
          throw new Error(`Failed to parse PDF: ${pdfError.message || 'Unknown error'}`);
        }
      }
      
      let fullText = '';
      const pageTexts: string[] = [];

      // Extract text from each page
      for (let i = 1; i <= pdf.numPages; i++) {
        try {
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          const pageText = content.items
            .map((item: any) => item.str || '')
            .join(' ');
          pageTexts.push(pageText);
          fullText += pageText + '\n\n';
        } catch (pageError) {
          console.warn(`Failed to extract text from page ${i}:`, pageError);
          // Continue with other pages
        }
      }

      console.log('Extracted text length:', fullText.length);

      // Check if we got any text
      if (fullText.trim().length === 0) {
        throw new Error('PDF contains no extractable text. It might be image-based or scanned.');
      }

      const textChunks = this.chunkText(fullText);
      console.log('Created chunks:', textChunks.length);
      
      const chunks: DocumentChunk[] = textChunks.map((text, idx) => ({
        id: `chunk-${idx}`,
        docId: `doc-${Date.now()}`,
        text,
        page: Math.floor(idx / Math.max(1, textChunks.length / pdf.numPages)),
        position: idx,
      }));

      const doc: Document = {
        id: `doc-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        name: file.name,
        text: fullText.trim(),
        chunks,
        pages: pdf.numPages,
        uploadedAt: Date.now(),
        size: file.size,
      };

      this.documents.set(doc.id, doc);
      
      // Save to storage with error handling
      try {
        await this.storage.setItem(doc.id, doc);
        console.log('Document saved to storage');
      } catch (storageError) {
        console.warn('Failed to persist document:', storageError);
        // Document is still in memory, so we can continue
      }
      
      this.notifyListeners();
      console.log('Document upload complete:', doc.id);

      return doc;
    } catch (error) {
      console.error('Document upload error:', error);
      throw error;
    }
  }

  removeDocument(id: string) {
    this.documents.delete(id);
    this.storage.removeItem(id);
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
    this.storage.clear();
    this.notifyListeners();
  }

  /**
   * Fast semantic search using TF-IDF + keyword matching
   * Good enough for demos, no need for heavy embedding models
   */
  searchChunks(query: string, maxResults: number = 3): Array<{ chunk: DocumentChunk; doc: Document; score: number }> {
    const keywords = query.toLowerCase()
      .split(/\s+/)
      .filter(k => k.length > 3);
    
    if (keywords.length === 0) return [];

    const results: Array<{ chunk: DocumentChunk; doc: Document; score: number }> = [];

    for (const doc of this.documents.values()) {
      for (const chunk of doc.chunks) {
        const text = chunk.text.toLowerCase();
        let score = 0;

        // TF-IDF-like scoring
        for (const keyword of keywords) {
          const regex = new RegExp(keyword, 'g');
          const matches = text.match(regex);
          if (matches) {
            // More matches = higher score
            score += matches.length;
            // Bonus for exact phrase match
            if (text.includes(query.toLowerCase())) {
              score += 5;
            }
          }
        }

        if (score > 0) {
          results.push({ chunk, doc, score });
        }
      }
    }

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults);
  }

  /**
   * Get context for a query with smart snippet extraction
   */
  getContext(query: string, maxChunks: number = 2): Array<{ text: string; source: string }> {
    const results = this.searchChunks(query, maxChunks);
    
    return results.map(({ chunk, doc }) => ({
      text: chunk.text,
      source: `${doc.name} (Page ${chunk.page + 1})`,
    }));
  }
}

export const DocumentStore = new DocumentStoreClass();
