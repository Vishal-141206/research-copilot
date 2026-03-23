/**
 * Smart Query Cache System
 * Stores queries and responses for instant replay during demos
 */

import localforage from 'localforage';

interface CachedQuery {
  query: string;
  response: string;
  context?: string[];
  timestamp: number;
  mode?: 'simple' | 'detailed' | 'exam';
}

class QueryCacheClass {
  private cache: Map<string, CachedQuery> = new Map();
  private storage = localforage.createInstance({
    name: 'research-copilot',
    storeName: 'query-cache',
  });

  async init() {
    try {
      const keys = await this.storage.keys();
      for (const key of keys) {
        const value = await this.storage.getItem<CachedQuery>(key);
        if (value) {
          this.cache.set(key, value);
        }
      }
    } catch (err) {
      console.warn('Failed to load cache:', err);
    }
  }

  private normalizeQuery(query: string): string {
    return query.toLowerCase().trim().replace(/\s+/g, ' ');
  }

  async get(query: string, mode?: string, documentId?: string): Promise<CachedQuery | null> {
    const key = this.normalizeQuery(query) + (mode ? `-${mode}` : '') + (documentId ? `-${documentId}` : '');
    return this.cache.get(key) || null;
  }

  async set(query: string, response: string, context?: string[], mode?: string, documentId?: string) {
    const key = this.normalizeQuery(query) + (mode ? `-${mode}` : '') + (documentId ? `-${documentId}` : '');
    const cached: CachedQuery = {
      query,
      response,
      context,
      timestamp: Date.now(),
      mode: mode as any,
    };
    
    this.cache.set(key, cached);
    
    try {
      await this.storage.setItem(key, cached);
    } catch (err) {
      console.warn('Failed to persist cache:', err);
    }
  }

  clear() {
    this.cache.clear();
    this.storage.clear();
  }
}

export const QueryCache = new QueryCacheClass();
