/**
 * OUTPUT TRANSFORMER - Transform Raw Extractive Output into Quality Responses
 *
 * Pipeline: Clean → Filter → Score → Select → Rewrite → Structure
 * Target: <200ms latency while producing intelligent-looking output
 */

// ============================================================================
// CONSTANTS
// ============================================================================

/** Words that indicate low-quality/reference sentences to filter out */
const LOW_QUALITY_MARKERS = new Set([
  'figure',
  'table',
  'documentation',
  'appendix',
  'see',
  'refer to',
  'cf.',
  'e.g.',
  'i.e.',
  'et al',
  'ibid',
  'op. cit.',
  'fig.',
  'tab.',
]);

/** Minimum sentence length to keep */
const MIN_SENTENCE_LENGTH = 50;

/** Maximum sentence length for bullets */
const MAX_BULLET_LENGTH = 180;

/** Stop words for keyword matching */
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were',
  'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
  'will', 'would', 'could', 'should', 'may', 'might', 'must', 'shall',
  'can', 'need', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by',
  'from', 'as', 'into', 'through', 'during', 'before', 'after',
  'this', 'that', 'these', 'those', 'it', 'its', 'they', 'them',
]);

/** Incomplete phrase patterns */
const INCOMPLETE_PATTERNS = [
  /^(and|or|but|however|therefore|thus|hence|so)\s/i,
  /^(the|a|an)\s+\w+$/i, // Just "the thing" with no verb
  /^\d+[\.\)]\s*$/,      // Just numbering
  /^[-•]\s*$/,           // Just bullets
  /[,;:]$/,              // Ends with continuation punctuation
];

/** Rephrasing templates for common patterns */
const REPHRASE_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /^(\w+)\s*&\s*(\w+)/i, replacement: 'Focuses on $1 and $2' },
  { pattern: /^privacy[- ]preserving/i, replacement: 'Ensures data privacy through' },
  { pattern: /^local[- ]processing/i, replacement: 'Processes data locally, enabling' },
  { pattern: /^offline[- ]capable/i, replacement: 'Works offline, allowing' },
  { pattern: /^real[- ]time/i, replacement: 'Provides real-time' },
];

// ============================================================================
// CORE FUNCTIONS
// ============================================================================

/**
 * Clean a sentence by removing special characters and normalizing
 */
export function cleanSentence(sentence: string): string {
  return sentence
    // Remove special/corrupted characters
    .replace(/[^\x20-\x7E\u00A0-\u00FF]/g, ' ')
    // Normalize whitespace
    .replace(/\s+/g, ' ')
    // Remove leading/trailing punctuation (except ending period)
    .replace(/^[^\w]+/, '')
    .replace(/[,;:\s]+$/, '')
    // Capitalize first letter
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

/**
 * Check if a sentence is low-quality and should be filtered
 */
export function isLowQualitySentence(sentence: string): boolean {
  const lower = sentence.toLowerCase();
  const len = sentence.length;

  // Too short
  if (len < MIN_SENTENCE_LENGTH) return true;

  // Contains low-quality markers
  for (const marker of LOW_QUALITY_MARKERS) {
    if (lower.includes(marker)) return true;
  }

  // Matches incomplete patterns
  for (const pattern of INCOMPLETE_PATTERNS) {
    if (pattern.test(sentence)) return true;
  }

  // No verb (likely a fragment) - simple heuristic
  const hasVerb = /\b(is|are|was|were|has|have|had|does|do|did|will|would|can|could|should|may|might|must|shall|being|been|becomes?|provides?|enables?|allows?|ensures?|focuses?|presents?|describes?|shows?|demonstrates?|achieves?|improves?|uses?|processes?|supports?|works?|runs?|operates?)\b/i.test(sentence);
  if (!hasVerb && len < 80) return true;

  return false;
}

/**
 * Score a sentence for relevance and quality
 */
export function scoreSentence(
  sentence: string,
  queryKeywords: string[],
  position: number,
  totalSentences: number
): number {
  const lower = sentence.toLowerCase();
  const words = lower.split(/\s+/);
  let score = 0;

  // 1. Keyword match (0-10 points)
  const keywordSet = new Set(queryKeywords.map(k => k.toLowerCase()));
  for (const word of words) {
    const cleanWord = word.replace(/[^a-z]/g, '');
    if (keywordSet.has(cleanWord)) {
      score += 2;
    }
    // Partial match bonus
    for (const kw of keywordSet) {
      if (cleanWord.length > 3 && kw.length > 3) {
        if (cleanWord.includes(kw) || kw.includes(cleanWord)) {
          score += 0.5;
        }
      }
    }
  }

  // 2. Sentence length score (0-2 points)
  const len = sentence.length;
  if (len >= 50 && len <= 200) {
    score += 2;
  } else if (len >= 40 && len <= 250) {
    score += 1;
  }

  // 3. Position weight (0-3 points)
  // Early sentences (intro) and late sentences (conclusion) are more important
  const relativePosition = position / Math.max(totalSentences, 1);
  if (relativePosition < 0.1) {
    score += 3; // First 10%
  } else if (relativePosition < 0.2) {
    score += 2; // 10-20%
  } else if (relativePosition > 0.85) {
    score += 2.5; // Last 15% (conclusions)
  } else if (relativePosition > 0.75) {
    score += 1.5; // 75-85%
  }

  // 4. Signal words bonus (0-2 points)
  const signals = ['key', 'main', 'important', 'significant', 'result', 'finding',
    'conclude', 'demonstrate', 'show', 'achieve', 'improve', 'enable', 'provide'];
  if (signals.some(s => lower.includes(s))) {
    score += 2;
  }

  // 5. Contains numbers/data (0-1 point)
  if (/\d+%|\d+\.\d+|\d+x|\d+ (times|percent|faster|slower)/.test(sentence)) {
    score += 1;
  }

  return score;
}

/**
 * Rewrite a sentence into a clear, complete bullet point
 * NO LENGTH BOUNDS - let RAG decide appropriate length
 */
export function rewriteSentence(sentence: string): string {
  let rewritten = cleanSentence(sentence);

  // Skip only if essentially empty
  if (rewritten.length < 15) return '';

  // Apply rephrasing patterns for common incomplete starts
  for (const { pattern, replacement } of REPHRASE_PATTERNS) {
    if (pattern.test(rewritten)) {
      rewritten = rewritten.replace(pattern, replacement);
      break;
    }
  }

  // Remove leading articles/pronouns for bullet style
  rewritten = rewritten.replace(/^(the|a|an|this|that|these|those|it|we|they)\s+/i, '');

  // Capitalize first letter
  if (rewritten.length > 0) {
    rewritten = rewritten.charAt(0).toUpperCase() + rewritten.slice(1);
  }

  // Ensure proper ending - NO TRUNCATION
  rewritten = rewritten.replace(/[,;:\s]+$/, '');
  if (rewritten.length > 0 && !rewritten.match(/[.!?]$/)) {
    rewritten += '.';
  }

  return rewritten;
}

/**
 * Extract keywords from a query for matching
 */
export function extractQueryKeywords(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

/**
 * Transform raw sentences into quality insights
 * Let the content decide how many insights to return (no hard bound)
 */
export function transformToInsights(
  sentences: string[],
  query: string,
  maxInsights?: number // Optional - if not provided, RAG decides
): string[] {
  const keywords = extractQueryKeywords(query);

  // Step 1: Clean all sentences
  const cleaned = sentences.map(s => cleanSentence(s));

  // Step 2: Filter low-quality sentences
  const filtered = cleaned.filter(s => !isLowQualitySentence(s));

  // Step 3: Score and rank
  const scored = filtered.map((sentence, index) => ({
    sentence,
    score: scoreSentence(sentence, keywords, index, filtered.length),
  }));

  scored.sort((a, b) => b.score - a.score);

  // Step 4: Remove duplicates (based on first 5 words)
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const { sentence } of scored) {
    const key = sentence.toLowerCase().split(/\s+/).slice(0, 5).join(' ');
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(sentence);
    }
  }

  // Step 5: Dynamically decide how many insights to return
  // If maxInsights specified, use it. Otherwise, return all quality insights (up to 8)
  const limit = maxInsights ?? Math.min(unique.length, 8);
  
  // Only include high-scoring insights (score > 0.5)
  const qualityInsights = scored
    .filter(({ score }) => score > 0.5)
    .slice(0, limit);

  // If we have good quality insights, use them; otherwise use top unique
  const finalSentences = qualityInsights.length >= 2
    ? qualityInsights.map(({ sentence }) => sentence)
    : unique.slice(0, Math.max(3, limit));

  // Step 6: Rewrite sentences
  return finalSentences.map(s => rewriteSentence(s));
}

/**
 * Format insights into a structured response
 * Each section on separate lines for better UI rendering
 */
export function formatStructuredResponse(
  insights: string[],
  title: string = 'Key Insights'
): string {
  if (insights.length === 0) {
    return `**${title}**\n\nNo relevant insights found in the document.`;
  }

  const bullets = insights.map(insight => `• ${insight}`).join('\n');

  // Title on its own line, subtitle on next line, then bullets
  return `**${title}**\n\nBased on the document:\n\n${bullets}`;
}

/**
 * Complete pipeline: Transform raw text into structured response
 * Let the content decide appropriate length - no artificial bounds
 */
export function transformOutput(
  rawSentences: string[],
  query: string,
  options: {
    maxInsights?: number; // Optional - if not set, RAG decides
    title?: string;
  } = {}
): string {
  const { maxInsights, title = 'Key Insights' } = options;

  // Let transformToInsights decide the appropriate number
  const insights = transformToInsights(rawSentences, query, maxInsights);
  return formatStructuredResponse(insights, title);
}

/**
 * Check if query should trigger LLM (complex queries only)
 */
export function shouldTriggerLLM(query: string): boolean {
  const lower = query.toLowerCase();
  const llmTriggers = ['why', 'how', 'analyze', 'compare', 'explain why', 'reason'];

  return llmTriggers.some(trigger => lower.includes(trigger));
}

/**
 * Quick check if text looks like raw/unprocessed output
 */
export function isRawOutput(text: string): boolean {
  // Check for signs of raw extraction
  const indicators = [
    /^\s*[-•]\s*[a-z]/m,           // Bullet starting with lowercase
    /\n{3,}/,                       // Multiple blank lines
    /[^\x20-\x7E\u00A0-\u00FF]/,   // Non-printable characters
    /\b(fig\.|table \d|see appendix)/i, // Reference markers
    /^\d+\.\s*$/m,                  // Orphan numbering
  ];

  return indicators.some(pattern => pattern.test(text));
}

// ============================================================================
// EXPORTS
// ============================================================================

export const OutputTransformer = {
  cleanSentence,
  isLowQualitySentence,
  scoreSentence,
  rewriteSentence,
  extractQueryKeywords,
  transformToInsights,
  formatStructuredResponse,
  transformOutput,
  shouldTriggerLLM,
  isRawOutput,
};
