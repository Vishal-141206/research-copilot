import pdfWorkerUrl from '../workers/pdf-worker?worker&url';

type CommonAnswerKey = 'summary' | 'key_points' | 'methodology';

export interface ChunkMeta {
  index: number;
  text: string;
  heading?: string;
  keywords: string[];
  positionWeight: number;
  headingBonus: number;
  baseScore: number;
}

export interface Document {
  id: string;
  name: string;
  text: string;
  chunks: string[];
  embeddings?: number[][];
  pages: number;
  uploadedAt: number;
  size: number;
  keywords?: string[];
  chunkMeta?: ChunkMeta[];
  commonAnswers?: Partial<Record<CommonAnswerKey, string>>;
}

export interface HybridSearchResult {
  chunk: string;
  score: number;
  keywordScore: number;
  embeddingScore: number;
  positionWeight: number;
  headingBonus: number;
  index: number;
  heading?: string;
}

const STORAGE_KEY = 'research-copilot-documents-v5';
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be', 'been',
  'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'to', 'of', 'in',
  'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
  'before', 'after', 'above', 'below', 'between', 'under', 'again', 'further',
  'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each',
  'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only',
  'own', 'same', 'so', 'than', 'too', 'very', 'just', 'also', 'now', 'this',
  'that', 'these', 'those', 'its', 'it', 'we', 'they', 'you', 'he', 'she',
  'i', 'me', 'my', 'our', 'your', 'their', 'his', 'her', 'which', 'who',
  'whom', 'what', 'if', 'because', 'while', 'about', 'using', 'used'
]);

const HEADING_PATTERNS: Record<CommonAnswerKey, RegExp> = {
  summary: /(abstract|summary|overview|introduction|conclusion)/i,
  key_points: /(finding|result|conclusion|discussion|insight)/i,
  methodology: /(method|methodology|approach|procedure|design|pipeline|stage)/i,
};

class DocumentStoreClass {
  private documents: Map<string, Document> = new Map();
  private listeners: Set<() => void> = new Set();
  private embeddingWorker: Worker | null = null;
  private embeddingJobs: Map<string, Promise<Document | null>> = new Map();

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
      if (!stored) return;

      const docs = JSON.parse(stored) as Document[];
      docs.forEach((doc) => {
        const hydrated = this.hydrateDocument(doc);
        this.documents.set(hydrated.id, hydrated);
      });
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
    this.listeners.forEach((listener) => listener());
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private updateDocument(doc: Document) {
    const hydrated = this.hydrateDocument(doc);
    this.documents.set(hydrated.id, hydrated);
    this.saveToStorage();
    this.notifyListeners();
  }

  private hydrateDocument(doc: Document): Document {
    // If already fully hydrated with chunks and answers, return as-is
    if (doc.chunkMeta?.length && doc.commonAnswers && doc.keywords) {
      return doc;
    }

    // If already has chunkMeta but missing keywords or answers, fill in the gaps
    if (doc.chunkMeta?.length) {
      if (!doc.keywords) {
        doc.keywords = this.collectDocumentKeywords(doc.chunkMeta);
      }
      if (!doc.commonAnswers) {
        doc.commonAnswers = this.buildCommonAnswers(doc.chunkMeta);
      }
      return doc;
    }

    // Full preprocessing only needed for completely new documents
    return this.preprocessDocument({
      ...doc,
      embeddings: doc.embeddings?.length === doc.chunks?.length ? doc.embeddings : undefined,
    });
  }

  private preprocessDocument(doc: Document): Document {
    const chunkMeta = this.buildChunkMeta(doc.text);
    const chunks = chunkMeta.map((chunk) => chunk.text);
    const commonAnswers = this.buildCommonAnswers(chunkMeta);

    return {
      ...doc,
      chunks,
      embeddings: doc.embeddings?.length === chunks.length ? doc.embeddings : undefined,
      chunkMeta,
      keywords: this.collectDocumentKeywords(chunkMeta),
      commonAnswers,
    };
  }

  private normalizeText(text: string): string {
    return text
      .replace(/[^\x20-\x7E\n]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private normalizeToken(token: string): string {
    return token.toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  private extractKeywords(text: string, limit: number = 6): string[] {
    const counts = new Map<string, number>();

    for (const raw of text.split(/\s+/)) {
      const token = this.normalizeToken(raw);
      if (token.length < 3 || STOP_WORDS.has(token)) continue;
      counts.set(token, (counts.get(token) || 0) + 1);
    }

    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([token]) => token);
  }

  private looksLikeHeading(text: string): boolean {
    const cleaned = text.trim();
    if (!cleaned || cleaned.length > 72) return false;
    if (/^(abstract|introduction|background|method|methodology|approach|results?|findings?|discussion|conclusion|summary|references?)$/i.test(cleaned)) {
      return true;
    }

    const uppercaseRatio = cleaned.replace(/[^A-Z]/g, '').length / Math.max(cleaned.replace(/[^A-Za-z]/g, '').length, 1);
    return uppercaseRatio > 0.65 || /^\d+(\.\d+)*\s+[A-Z]/.test(cleaned);
  }

  private splitSentenceWindow(text: string): string[] {
    const cleaned = this.normalizeText(text);
    if (!cleaned) return [];

    const sentences = cleaned.match(/[^.!?]+[.!?]?/g)?.map((sentence) => sentence.trim()).filter(Boolean) || [cleaned];
    const chunks: string[] = [];
    let buffer = '';

    for (const sentence of sentences) {
      if (!sentence) continue;

      if (sentence.length > 120) {
        if (buffer) {
          chunks.push(buffer.trim());
          buffer = '';
        }

        const words = sentence.split(/\s+/);
        let wordBuffer = '';
        for (const word of words) {
          const candidate = wordBuffer ? `${wordBuffer} ${word}` : word;
          if (candidate.length <= 110) {
            wordBuffer = candidate;
          } else {
            if (wordBuffer) chunks.push(wordBuffer.trim());
            wordBuffer = word;
          }
        }
        if (wordBuffer) chunks.push(wordBuffer.trim());
        continue;
      }

      const candidate = buffer ? `${buffer} ${sentence}` : sentence;
      if (candidate.length < 80) {
        buffer = candidate;
        continue;
      }

      if (candidate.length <= 120) {
        chunks.push(candidate.trim());
        buffer = '';
        continue;
      }

      if (buffer) {
        chunks.push(buffer.trim());
      }
      buffer = sentence;
    }

    if (buffer) {
      chunks.push(buffer.trim());
    }

    return chunks.filter((chunk) => chunk.length >= 40);
  }

  private buildChunkMeta(text: string): ChunkMeta[] {
    const segments = text
      .split(/\n+/)
      .map((segment) => segment.trim())
      .filter(Boolean);

    const provisional: Array<{ text: string; heading?: string; headingBonus: number }> = [];
    let currentHeading = '';

    for (const segment of segments) {
      if (this.looksLikeHeading(segment)) {
        currentHeading = this.normalizeText(segment).slice(0, 72);
        continue;
      }

      const headingBonus = currentHeading
        ? HEADING_PATTERNS.methodology.test(currentHeading) || HEADING_PATTERNS.key_points.test(currentHeading) || HEADING_PATTERNS.summary.test(currentHeading)
          ? 0.45
          : 0.2
        : 0;

      for (const chunk of this.splitSentenceWindow(segment)) {
        provisional.push({
          text: chunk,
          heading: currentHeading || undefined,
          headingBonus,
        });
      }
    }

    if (provisional.length === 0) {
      provisional.push(
        ...this.splitSentenceWindow(text).map((chunk) => ({
          text: chunk,
          heading: undefined,
          headingBonus: 0,
        })),
      );
    }

    return provisional.map((chunk, index) => {
      const total = Math.max(provisional.length - 1, 1);
      const ratio = index / total;
      const positionWeight = ratio < 0.2 ? 0.45 : ratio > 0.8 ? 0.28 : 0.12;
      const keywords = this.extractKeywords(chunk.text);

      return {
        index,
        text: chunk.text,
        heading: chunk.heading,
        keywords,
        positionWeight,
        headingBonus: chunk.headingBonus,
        baseScore: positionWeight + chunk.headingBonus,
      };
    });
  }

  private collectDocumentKeywords(chunkMeta: ChunkMeta[]): string[] {
    const counts = new Map<string, number>();

    for (const chunk of chunkMeta) {
      for (const keyword of chunk.keywords) {
        counts.set(keyword, (counts.get(keyword) || 0) + 1);
      }
    }

    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([keyword]) => keyword);
  }

  private compressInsight(text: string): string {
    const words = this.normalizeText(text)
      .split(/\s+/)
      .map((word) => word.replace(/[^A-Za-z0-9-]/g, ''))
      .filter((word) => word && !STOP_WORDS.has(word.toLowerCase()));

    const shortened = words.slice(0, 9).join(' ');
    if (!shortened) return 'No clear insight found';
    return shortened.charAt(0).toUpperCase() + shortened.slice(1);
  }

  private formatInsightAnswer(title: string, chunks: ChunkMeta[]): string {
    const insights = chunks
      .map((chunk) => this.compressInsight(chunk.text))
      .filter((insight, index, arr) => insight && arr.indexOf(insight) === index)
      .slice(0, 3);

    if (insights.length === 0) {
      insights.push('No clear insight found');
    }

    return `Based on the document:\n- ${insights.join('\n- ')}`;
  }

  private buildCommonAnswers(chunkMeta: ChunkMeta[]): Partial<Record<CommonAnswerKey, string>> {
    const summaryChunks = chunkMeta
      .filter((chunk) => HEADING_PATTERNS.summary.test(chunk.heading || '') || chunk.index < 3)
      .slice(0, 3);

    const methodologyChunks = chunkMeta
      .filter((chunk) => HEADING_PATTERNS.methodology.test(chunk.heading || '') || /(method|approach|process|stage|pipeline)/i.test(chunk.text))
      .slice(0, 3);

    const keyPointChunks = chunkMeta
      .filter((chunk) => HEADING_PATTERNS.key_points.test(chunk.heading || '') || /\d|result|finding|conclusion|improv|benefit/i.test(chunk.text))
      .slice(0, 3);

    return {
      summary: this.formatInsightAnswer('Summary', summaryChunks.length ? summaryChunks : chunkMeta.slice(0, 3)),
      key_points: this.formatInsightAnswer('Key Points', keyPointChunks.length ? keyPointChunks : chunkMeta.slice(0, 3)),
      methodology: this.formatInsightAnswer('Methodology', methodologyChunks.length ? methodologyChunks : chunkMeta.slice(0, 3)),
    };
  }

  private scoreKeywordMatch(chunk: ChunkMeta, queryTerms: string[], queryLower: string): number {
    if (!queryTerms.length) return 0;

    const textLower = chunk.text.toLowerCase();
    let score = queryLower.length > 6 && textLower.includes(queryLower) ? 2 : 0;

    for (const term of queryTerms) {
      if (chunk.keywords.includes(term)) {
        score += 1.6;
      } else if (textLower.includes(term)) {
        score += 1;
      }

      if ((chunk.heading || '').toLowerCase().includes(term)) {
        score += 0.5;
      }
    }

    return score;
  }

  private inferCommonAnswerKey(query: string): CommonAnswerKey | null {
    const lower = query.toLowerCase();
    if (/(summary|summarize|overview|tldr)/.test(lower)) return 'summary';
    if (/(key point|main point|takeaway|finding|result)/.test(lower)) return 'key_points';
    if (/(method|methodology|approach|process|pipeline|how)/.test(lower)) return 'methodology';
    return null;
  }

  async addDocument(
    file: File,
    onProgress?: (status: string, progress: number) => void,
    options: { includeEmbeddings?: boolean } = {},
  ): Promise<Document> {
    return new Promise(async (resolve, reject) => {
      const arrayBuffer = await file.arrayBuffer();
      const worker = new Worker(pdfWorkerUrl, { type: 'module' });

      worker.onmessage = (e) => {
        const { type, text, pages, progress, status, error } = e.data;

        if (type === 'progress') {
          if (onProgress) onProgress(status || 'Processing...', progress);
        } else if (type === 'done') {
          if (onProgress) onProgress('Finalizing document...', 0.99);

          const baseDoc: Document = {
            id: `doc-${Date.now()}`,
            name: file.name,
            text,
            chunks: [],
            embeddings: undefined,
            pages,
            uploadedAt: Date.now(),
            size: file.size,
          };

          const doc = this.preprocessDocument(baseDoc);
          this.updateDocument(doc);

          worker.terminate();
          if (onProgress) onProgress('Ready!', 1);
          resolve(doc);
        } else if (type === 'error') {
          worker.terminate();
          reject(new Error(error));
        }
      };

      worker.postMessage({
        type: 'extract',
        arrayBuffer,
        includeEmbeddings: options.includeEmbeddings ?? false,
      }, [arrayBuffer]);
    });
  }

  async ensureEmbeddings(docId: string, onProgress?: (status: string, progress: number) => void): Promise<Document | null> {
    const existingJob = this.embeddingJobs.get(docId);
    if (existingJob) {
      return existingJob;
    }

    const job = (async () => {
      const rawDoc = this.documents.get(docId);
      if (!rawDoc) return null;

      const doc = this.hydrateDocument(rawDoc);
      if (!doc.chunks?.length) return null;
      if (doc.embeddings?.length === doc.chunks.length) {
        return doc;
      }

      const embeddings: number[][] = [];
      const targetChunks = doc.chunks;

      for (let i = 0; i < targetChunks.length; i++) {
        if (onProgress) {
          onProgress(`Building semantic index ${i + 1}/${targetChunks.length}`, i / targetChunks.length);
        }
        embeddings.push(await this.embedQuery(targetChunks[i]));
      }

      const updatedDoc: Document = {
        ...doc,
        embeddings,
      };
      this.updateDocument(updatedDoc);

      if (onProgress) {
        onProgress('Semantic index ready', 1);
      }

      return updatedDoc;
    })();

    this.embeddingJobs.set(docId, job);

    try {
      return await job;
    } finally {
      this.embeddingJobs.delete(docId);
    }
  }

  async searchDocument(docId: string, query: string, topK: number = 2): Promise<HybridSearchResult[]> {
    const rawDoc = this.documents.get(docId);
    if (!rawDoc) return [];

    const doc = this.hydrateDocument(rawDoc);
    if (!doc.chunkMeta?.length) return [];

    const queryLower = query.toLowerCase().trim();
    const queryTerms = queryLower
      .split(/\s+/)
      .map((term) => this.normalizeToken(term))
      .filter((term) => term.length >= 3);

    const keywordScores = doc.chunkMeta.map((chunk) => ({
      chunk,
      keywordScore: this.scoreKeywordMatch(chunk, queryTerms, queryLower),
    }));

    const strongestKeyword = keywordScores[0]
      ? Math.max(...keywordScores.map((entry) => entry.keywordScore))
      : 0;

    const shouldUseEmbeddings =
      strongestKeyword < 2 &&
      !!doc.embeddings &&
      doc.embeddings.length === doc.chunkMeta.length;

    const queryEmbedding = shouldUseEmbeddings ? await this.embedQuery(query) : null;

    return keywordScores
      .map(({ chunk, keywordScore }) => {
        const embeddingScore = queryEmbedding && doc.embeddings
          ? Math.max(this.cosineSimilarity(queryEmbedding, doc.embeddings[chunk.index]), 0)
          : 0;

        return {
          chunk: chunk.text,
          score: (shouldUseEmbeddings ? embeddingScore : keywordScore) + chunk.positionWeight + chunk.headingBonus,
          keywordScore,
          embeddingScore,
          positionWeight: chunk.positionWeight,
          headingBonus: chunk.headingBonus,
          index: chunk.index,
          heading: chunk.heading,
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.min(topK, 4));
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

  searchDocumentByKeyword(docId: string, query: string, maxSnippets: number = 2): Array<{ snippet: string; score: number }> {
    const rawDoc = this.documents.get(docId);
    if (!rawDoc) return [];

    const doc = this.hydrateDocument(rawDoc);
    if (!doc.chunkMeta?.length) return [];

    const queryLower = query.toLowerCase().trim();
    const queryTerms = queryLower
      .split(/\s+/)
      .map((term) => this.normalizeToken(term))
      .filter((term) => term.length >= 3);

    const results = doc.chunkMeta
      .map((chunk) => ({
        snippet: chunk.text,
        score: this.scoreKeywordMatch(chunk, queryTerms, queryLower),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, maxSnippets);

    if (results.length === 0) {
      return doc.chunks.slice(0, 1).map((snippet) => ({ snippet, score: 0 }));
    }

    return results;
  }

  getCommonAnswer(docId: string, query: string): string | null {
    const rawDoc = this.documents.get(docId);
    if (!rawDoc) return null;

    const doc = this.hydrateDocument(rawDoc);
    const key = this.inferCommonAnswerKey(query);
    if (!key) return null;

    return doc.commonAnswers?.[key] || null;
  }

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

  getDocument(id: string): Document | undefined {
    const doc = this.documents.get(id);
    return doc ? this.hydrateDocument(doc) : undefined;
  }

  getAllDocuments(): Document[] {
    return Array.from(this.documents.values())
      .map((doc) => this.hydrateDocument(doc))
      .sort((a, b) => b.uploadedAt - a.uploadedAt);
  }

  removeDocument(id: string) {
    this.documents.delete(id);
    this.saveToStorage();
    this.notifyListeners();
  }

  clearAll() {
    this.documents.clear();
    localStorage.removeItem(STORAGE_KEY);
    this.notifyListeners();
  }
}

export const DocumentStore = new DocumentStoreClass();
