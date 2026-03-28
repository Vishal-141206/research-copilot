/**
 * Query Cache
 * Separates demo, RAG, and heuristic responses to avoid cross-mode collisions.
 */

const STORAGE_KEY = 'research-copilot-query-cache-rag-v9';

export type QueryCacheType = 'demo' | 'rag' | 'heuristic';
export type QueryCacheIntent = 'summary' | 'key_points' | 'process' | 'benefits' | 'general';
export type QueryMode = 'simple' | 'detailed' | 'exam';

export interface CachedQuery {
  query: string;
  response: string;
  context?: string[];
  timestamp: number;
  mode?: QueryMode;
  intent: QueryCacheIntent;
  documentId?: string;
  strategy: 'exact' | 'intent';
}

interface PersistedCacheStore {
  demoCache: Array<[string, CachedQuery]>;
  ragCache: Array<[string, CachedQuery]>;
  heuristicCache: Array<[string, CachedQuery]>;
}

interface QueryCacheLookupOptions {
  cacheType: QueryCacheType;
  mode?: QueryMode;
  documentId?: string;
  intent?: QueryCacheIntent;
  allowIntentFallback?: boolean;
}

interface QueryCacheSaveOptions extends QueryCacheLookupOptions {
  useIntentKey?: boolean;
}

const INTENT_PATTERNS: Array<{ intent: QueryCacheIntent; pattern: RegExp }> = [
  { intent: 'summary', pattern: /\b(summary|summarize|overview|brief|tldr|about|gist)\b/ },
  { intent: 'key_points', pattern: /\b(key points?|main points?|takeaways?|findings?|results?|conclusions?|terms?|definitions?|arguments?)\b/ },
  { intent: 'process', pattern: /\b(how|process|method|methodology|approach|procedure|steps?|pipeline|work)\b/ },
  { intent: 'benefits', pattern: /\b(benefits?|advantages?|pros|value|improve|gain|why use)\b/ },
];

export function normalizeQuery(query: string): string {
  return query
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .trim();
}

export function detectCacheIntent(query: string): QueryCacheIntent {
  const normalized = normalizeQuery(query);
  for (const { intent, pattern } of INTENT_PATTERNS) {
    if (pattern.test(normalized)) {
      return intent;
    }
  }
  return 'general';
}

class QueryCacheClass {
  private caches: Record<QueryCacheType, Map<string, CachedQuery>> = {
    demo: new Map(),
    rag: new Map(),
    heuristic: new Map(),
  };

  constructor() {
    void this.init();
  }

  async init() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return;

      const parsed = JSON.parse(stored) as Partial<PersistedCacheStore>;
      this.caches.demo = new Map(parsed.demoCache || []);
      this.caches.rag = new Map(parsed.ragCache || []);
      this.caches.heuristic = new Map(parsed.heuristicCache || []);
    } catch (err) {
      console.warn('[QueryCache] Failed to load cache:', err);
    }
  }

  private saveToStorage() {
    try {
      const payload: PersistedCacheStore = {
        demoCache: Array.from(this.caches.demo.entries()),
        ragCache: Array.from(this.caches.rag.entries()),
        heuristicCache: Array.from(this.caches.heuristic.entries()),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (err) {
      console.warn('[QueryCache] Failed to save cache:', err);
    }
  }

  private buildKey(
    query: string,
    options: { mode?: QueryMode; documentId?: string; intent: QueryCacheIntent; strategy: 'exact' | 'intent' },
  ): string {
    const scope = options.documentId || 'global';
    const mode = options.mode || 'default';
    if (options.strategy === 'intent') {
      return `${scope}|${mode}|intent:${options.intent}`;
    }
    return `${scope}|${mode}|query:${normalizeQuery(query)}`;
  }

  private debugLog(
    action: 'get' | 'save',
    cacheType: QueryCacheType,
    query: string,
    normalizedKey: string,
    intent: QueryCacheIntent,
    status: 'hit' | 'miss' | 'write',
    strategy: 'exact' | 'intent',
  ) {
    console.log(
      `[QueryCache] ${action.toUpperCase()} type=${cacheType} query="${query}" normalized="${normalizedKey}" intent=${intent} strategy=${strategy} status=${status}`,
    );
  }

  async get(query: string, options: QueryCacheLookupOptions): Promise<CachedQuery | null> {
    const intent = options.intent || detectCacheIntent(query);
    const normalizedKey = normalizeQuery(query);
    const cache = this.caches[options.cacheType];
    const exactKey = this.buildKey(query, {
      mode: options.mode,
      documentId: options.documentId,
      intent,
      strategy: 'exact',
    });

    const exactMatch = cache.get(exactKey) || null;
    this.debugLog('get', options.cacheType, query, normalizedKey, intent, exactMatch ? 'hit' : 'miss', 'exact');
    if (exactMatch) {
      return exactMatch;
    }

    if (!options.allowIntentFallback) {
      return null;
    }

    const intentKey = this.buildKey(query, {
      mode: options.mode,
      documentId: options.documentId,
      intent,
      strategy: 'intent',
    });
    const intentMatch = cache.get(intentKey) || null;
    this.debugLog('get', options.cacheType, query, normalizedKey, intent, intentMatch ? 'hit' : 'miss', 'intent');
    return intentMatch;
  }

  async save(
    query: string,
    response: string,
    context: string[] = [],
    options: QueryCacheSaveOptions,
  ) {
    const intent = options.intent || detectCacheIntent(query);
    const normalizedKey = normalizeQuery(query);
    const cache = this.caches[options.cacheType];
    const exactKey = this.buildKey(query, {
      mode: options.mode,
      documentId: options.documentId,
      intent,
      strategy: 'exact',
    });

    const cached: CachedQuery = {
      query,
      response,
      context,
      timestamp: Date.now(),
      mode: options.mode,
      intent,
      documentId: options.documentId,
      strategy: 'exact',
    };

    cache.set(exactKey, cached);
    this.debugLog('save', options.cacheType, query, normalizedKey, intent, 'write', 'exact');

    if (options.useIntentKey) {
      const intentKey = this.buildKey(query, {
        mode: options.mode,
        documentId: options.documentId,
        intent,
        strategy: 'intent',
      });
      cache.set(intentKey, {
        ...cached,
        strategy: 'intent',
      });
      this.debugLog('save', options.cacheType, query, normalizedKey, intent, 'write', 'intent');
    }

    this.saveToStorage();
  }

  clear(cacheType?: QueryCacheType) {
    if (cacheType) {
      this.caches[cacheType].clear();
    } else {
      this.caches.demo.clear();
      this.caches.rag.clear();
      this.caches.heuristic.clear();
    }
    this.saveToStorage();
  }
}

export const QueryCache = new QueryCacheClass();
