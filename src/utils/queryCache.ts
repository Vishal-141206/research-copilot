/**
 * Smart Query Cache System
 * Stores queries and responses for instant replay during demos
 * Optimized to use native localStorage for zero-latency lookups.
 */

const STORAGE_KEY = 'research-copilot-query-cache-lite';

interface CachedQuery {
  query: string;
  response: string;
  context?: string[];
  timestamp: number;
  mode?: 'simple' | 'detailed' | 'exam';
}

class QueryCacheClass {
  private cache: Map<string, CachedQuery> = new Map();

  constructor() {
    this.init();
  }

  init() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const docs = JSON.parse(stored) as Array<[string, CachedQuery]>;
        docs.forEach(([key, value]) => this.cache.set(key, value));
      }
    } catch (err) {
      console.warn('Failed to load cache:', err);
    }
  }

  private saveToStorage() {
    try {
      const entries = Array.from(this.cache.entries());
      localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    } catch (err) {
      console.warn('Failed to save cache:', err);
    }
  }

  private normalizeQuery(query: string): string {
    return query.toLowerCase().trim().replace(/\s+/g, ' ');
  }

  async get(query: string, mode?: string, documentId?: string): Promise<CachedQuery | null> {
    const key = this.normalizeQuery(query) + (mode ? `-${mode}` : '') + (documentId ? `-${documentId}` : '');
    return this.cache.get(key) || null;
  }

  async save(query: string, response: string, context?: string[], mode?: string, documentId?: string) {
    const key = this.normalizeQuery(query) + (mode ? `-${mode}` : '') + (documentId ? `-${documentId}` : '');
    const cached: CachedQuery = {
      query,
      response,
      context,
      timestamp: Date.now(),
      mode: mode as any,
    };
    
    this.cache.set(key, cached);
    this.saveToStorage();
  }

  clear() {
    this.cache.clear();
    localStorage.removeItem(STORAGE_KEY);
  }
}

export const QueryCache = new QueryCacheClass();
