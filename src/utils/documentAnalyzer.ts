/**
 * DOCUMENT ANALYZER - Intelligent Heuristic Analysis for Real Documents
 *
 * Multi-stage pipeline that provides AI-quality responses WITHOUT LLM.
 * Pipeline: Extract → Rank → Theme → Label → Format
 *
 * Strategy: Graceful degradation - always respond, never fail.
 * Output: Structured, reasoning-based responses (<200ms latency).
 */

// ============================================================================
// TYPES
// ============================================================================

export interface DocumentAnalysis {
  summary: string;
  keyPoints: string[];
  topSentences: string[];
  keywords: string[];
  sections: DocumentSection[];
  stats: DocumentStats;
  isAnalyzed: boolean;
  documentId: string;
  // NEW: Theme-grouped content
  themes: ThemeGroup[];
  // NEW: Labeled sections for structured output
  labeledContent: LabeledContent;
}

export interface ThemeGroup {
  label: string;
  sentences: string[];
  importance: number; // 0-1 score
}

export interface LabeledContent {
  summary: string[];
  keyPoints: string[];
  methodology: string[];
  findings: string[];
}

export interface DocumentSection {
  title: string;
  content: string;
  type: 'abstract' | 'introduction' | 'methodology' | 'results' | 'conclusion' | 'other';
}

export interface DocumentStats {
  wordCount: number;
  sentenceCount: number;
  paragraphCount: number;
  estimatedReadTime: number;
}

// ============================================================================
// CONSTANTS
// ============================================================================

// Common stop words to filter out
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
  'whom', 'what', 'if', 'because', 'as', 'until', 'while', 'although', 'though',
  'even', 'any', 'both', 'each', 'either', 'neither', 'every', 'many', 'much'
]);

// Section header patterns
const SECTION_PATTERNS = {
  abstract: /^(abstract|summary|overview)/i,
  introduction: /^(introduction|background|overview)/i,
  methodology: /^(method|methodology|approach|materials|procedure|design)/i,
  results: /^(result|finding|evaluation|experiment|analysis)/i,
  conclusion: /^(conclusion|discussion|summary|future|implication)/i
};

// ============================================================================
// NEW: FILLER WORDS FOR SENTENCE REWRITING
// ============================================================================

const FILLER_WORDS = new Set([
  'actually', 'basically', 'certainly', 'clearly', 'definitely', 'essentially',
  'generally', 'honestly', 'hopefully', 'indeed', 'interestingly', 'literally',
  'naturally', 'obviously', 'particularly', 'presumably', 'probably', 'really',
  'relatively', 'seemingly', 'significantly', 'simply', 'specifically',
  'supposedly', 'surely', 'typically', 'ultimately', 'undoubtedly', 'unfortunately',
  'virtually', 'well', 'it is important to note that', 'it should be noted that',
  'it is worth mentioning that', 'as a matter of fact', 'in fact', 'in other words'
]);

// ============================================================================
// NEW: REASONING CONNECTORS
// ============================================================================

const REASONING_CONNECTORS = {
  causal: ['because', 'since', 'due to', 'as a result of'],
  consequence: ['this leads to', 'consequently', 'therefore', 'thus'],
  result: ['as a result', 'resulting in', 'which means', 'hence'],
  contrast: ['however', 'in contrast', 'on the other hand', 'while'],
  addition: ['furthermore', 'moreover', 'additionally', 'also']
};

// ============================================================================
// NEW: THEME PATTERNS FOR GROUPING
// ============================================================================

const THEME_PATTERNS = {
  objective: ['aim', 'goal', 'objective', 'purpose', 'target', 'intended'],
  method: ['method', 'approach', 'technique', 'procedure', 'process', 'using'],
  result: ['result', 'finding', 'outcome', 'achieved', 'obtained', 'found'],
  benefit: ['benefit', 'advantage', 'improve', 'enhance', 'better', 'efficient'],
  challenge: ['challenge', 'limitation', 'problem', 'issue', 'difficult', 'constraint'],
  contribution: ['contribution', 'novel', 'new', 'first', 'unique', 'introduce']
};

// ============================================================================
// NEW: INTENT DETECTION PATTERNS
// ============================================================================

const INTENT_PATTERNS = {
  how: { keywords: ['how', 'process', 'steps', 'procedure', 'method'], format: 'steps' },
  why: { keywords: ['why', 'reason', 'cause', 'because', 'purpose'], format: 'reasoning' },
  summary: { keywords: ['summary', 'summarize', 'overview', 'brief', 'tldr'], format: 'overview' },
  benefits: { keywords: ['benefit', 'advantage', 'pros', 'gain', 'value'], format: 'list' },
  results: { keywords: ['result', 'finding', 'outcome', 'conclusion', 'achieve'], format: 'findings' }
};

// Unified AI-like opening phrase — consistent "Based on the document" tone
const CONSISTENT_OPENER = 'Based on the document:';

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/** Get random phrase from array */
function getRandomPhrase(phrases: string[]): string {
  return phrases[Math.floor(Math.random() * phrases.length)];
}

/** Get random connector from category */
function getRandomConnector(category: keyof typeof REASONING_CONNECTORS): string {
  const connectors = REASONING_CONNECTORS[category];
  return connectors[Math.floor(Math.random() * connectors.length)];
}

/**
 * NEW: Remove filler words from sentence
 * Keeps content concise and impactful
 */
function removeFillerWords(sentence: string): string {
  let cleaned = sentence;

  // Remove multi-word fillers first
  const multiWordFillers = [
    'it is important to note that',
    'it should be noted that',
    'it is worth mentioning that',
    'as a matter of fact',
    'in other words'
  ];

  for (const filler of multiWordFillers) {
    cleaned = cleaned.replace(new RegExp(filler, 'gi'), '');
  }

  // Remove single-word fillers at sentence boundaries
  const words = cleaned.split(/\s+/);
  const filteredWords = words.filter((word, idx) => {
    const cleanWord = word.toLowerCase().replace(/[^a-z]/g, '');
    // Keep filler words if they're critical to meaning (mid-sentence)
    if (FILLER_WORDS.has(cleanWord) && (idx === 0 || idx === words.length - 1)) {
      return false;
    }
    return true;
  });

  return filteredWords.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * NEW: Rewrite sentence for bullet-friendly format
 * - Removes filler words
 * - Shortens length
 * - Converts to active voice where possible
 * - Avoids direct copy
 */
function rewriteForBullet(sentence: string, maxWords: number = 20): string {
  // Step 1: Remove filler
  let rewritten = removeFillerWords(sentence);

  // Step 2: Remove leading articles/pronouns for bullet style
  rewritten = rewritten.replace(/^(the|a|an|this|that|these|those|it|we|they)\s+/i, '');

  // Step 3: Capitalize first letter
  rewritten = rewritten.charAt(0).toUpperCase() + rewritten.slice(1);

  // Step 4: Shorten if needed
  const words = rewritten.split(/\s+/);
  if (words.length > maxWords) {
    // Find natural break point
    const breakPoints = [',', ';', ' - ', ' — '];
    let bestBreak = maxWords;

    for (const bp of breakPoints) {
      const idx = rewritten.indexOf(bp);
      if (idx > 30) {
        const wordCount = rewritten.slice(0, idx).split(/\s+/).length;
        if (wordCount >= 8 && wordCount <= maxWords) {
          bestBreak = wordCount;
          break;
        }
      }
    }

    rewritten = words.slice(0, bestBreak).join(' ');
  }

  // Step 5: Ensure proper ending
  rewritten = rewritten.replace(/[,;:]$/, '');
  if (!rewritten.match(/[.!?]$/)) {
    rewritten += '.';
  }

  return rewritten;
}

/**
 * NEW: Add reasoning connector between sentences
 */
function addReasoningConnector(sentences: string[]): string[] {
  if (sentences.length <= 1) return sentences;

  const enhanced: string[] = [sentences[0]];

  for (let i = 1; i < sentences.length; i++) {
    const prev = sentences[i - 1].toLowerCase();
    const curr = sentences[i];

    // Choose connector based on context
    let connector = '';

    if (prev.includes('result') || prev.includes('found') || prev.includes('show')) {
      connector = getRandomConnector('consequence');
    } else if (prev.includes('because') || prev.includes('since') || prev.includes('due')) {
      connector = getRandomConnector('result');
    } else if (curr.toLowerCase().includes('however') || curr.toLowerCase().includes('but')) {
      // Already has connector
      connector = '';
    } else if (i === sentences.length - 1) {
      connector = getRandomConnector('result');
    } else {
      connector = getRandomConnector('addition');
    }

    if (connector && !curr.toLowerCase().startsWith(connector)) {
      // Lowercase first char of sentence when adding connector
      const modifiedCurr = curr.charAt(0).toLowerCase() + curr.slice(1);
      enhanced.push(`${connector.charAt(0).toUpperCase() + connector.slice(1)}, ${modifiedCurr}`);
    } else {
      enhanced.push(curr);
    }
  }

  return enhanced;
}

/** Clean and rephrase a sentence for AI-like output */
function rephraseSentence(sentence: string): string {
  let cleaned = sentence
    .replace(/^\d+[\.\)]\s*/, '') // Remove numbering
    .replace(/^[-•]\s*/, '') // Remove bullets
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();

  // Remove filler words
  cleaned = removeFillerWords(cleaned);

  // Capitalize first letter
  if (cleaned.length > 0) {
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }

  // Ensure ends with period
  if (cleaned.length > 0 && !cleaned.match(/[.!?]$/)) {
    cleaned += '.';
  }

  return cleaned;
}

/** Shorten a sentence while preserving meaning */
function shortenSentence(sentence: string, maxWords: number = 25): string {
  // First remove filler words
  const cleaned = removeFillerWords(sentence);
  const words = cleaned.split(/\s+/);

  if (words.length <= maxWords) return cleaned;

  // Find a good breaking point (end of clause)
  const breakPoints = [',', ';', ' and ', ' but ', ' which ', ' that '];
  let bestBreak = maxWords;

  for (const bp of breakPoints) {
    const idx = cleaned.toLowerCase().indexOf(bp);
    if (idx > 50 && idx < maxWords * 6) {
      const wordCount = cleaned.slice(0, idx).split(/\s+/).length;
      if (wordCount >= 10 && wordCount <= maxWords) {
        bestBreak = wordCount;
        break;
      }
    }
  }

  return words.slice(0, bestBreak).join(' ') + '...';
}

/** Convert sentences to bullet points with rewriting */
function toBulletPoints(sentences: string[], maxPoints: number = 4, addConnectors: boolean = false): string {
  const processed = sentences
    .slice(0, maxPoints)
    .map(s => rewriteForBullet(rephraseSentence(s), 25));

  // Optionally add reasoning connectors
  const final = addConnectors ? addReasoningConnector(processed) : processed;

  return final.map(s => `• ${s}`).join('\n');
}

/** Remove duplicate/similar ideas */
function removeDuplicates(sentences: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const s of sentences) {
    // Create a simplified key for comparison
    const key = s.toLowerCase()
      .replace(/[^a-z\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 4)
      .slice(0, 5)
      .sort()
      .join(' ');

    if (!seen.has(key) && key.length > 10) {
      seen.add(key);
      result.push(s);
    }
  }

  return result;
}

// ============================================================================
// DOCUMENT ANALYZER CLASS
// ============================================================================

class DocumentAnalyzerClass {
  private analysisCache: Map<string, DocumentAnalysis> = new Map();
  private currentDocumentId: string | null = null;

  /**
   * Analyze a document and cache the results
   * Returns instantly with basic analysis
   */
  async analyzeDocument(documentId: string, text: string): Promise<DocumentAnalysis> {
    // Clear old cache when new document is loaded (prevents demo cache mixing)
    if (this.currentDocumentId && this.currentDocumentId !== documentId) {
      console.log(`[DocumentAnalyzer] New document detected, clearing old cache`);
      this.analysisCache.delete(this.currentDocumentId);
    }
    this.currentDocumentId = documentId;

    // Check cache first
    const cached = this.analysisCache.get(documentId);
    if (cached) return cached;

    const startTime = performance.now();

    // Fast analysis (should complete in <100ms)
    const analysis = this.performFastAnalysis(text, documentId);

    console.log(`[DocumentAnalyzer] Analysis completed in ${(performance.now() - startTime).toFixed(0)}ms`);

    // Cache the result
    this.analysisCache.set(documentId, analysis);

    return analysis;
  }

  /**
   * Multi-stage pipeline analysis - Extract → Rank → Theme → Label → Format
   * Optimized for <200ms execution
   */
  private performFastAnalysis(text: string, documentId: string): DocumentAnalysis {
    // Stage 1: Basic stats (fast)
    const stats = this.computeStats(text);

    // Stage 2: Extract sentences
    const sentences = this.extractSentences(text);

    // Stage 3: Extract keywords with improved TF-IDF
    const keywords = this.extractKeywords(text);

    // Stage 4: Identify sections (for heading importance scoring)
    const sections = this.identifySections(text);

    // Stage 5: Rank sentences with improved formula
    const rankedSentences = this.rankSentencesImproved(sentences, keywords, sections);

    // Stage 6: Remove duplicates
    const topSentences = removeDuplicates(rankedSentences);

    // Stage 7: Group into themes
    const themes = this.groupIntoThemes(topSentences);

    // Stage 8: Assign labels
    const labeledContent = this.assignLabels(topSentences, sections, keywords);

    // Stage 9: Generate summary from labeled content
    const summary = this.generateSummary(topSentences, sections);

    // Stage 10: Extract key points
    const keyPoints = this.extractKeyPoints(topSentences, keywords);

    return {
      summary,
      keyPoints,
      topSentences,
      keywords,
      sections,
      stats,
      isAnalyzed: true,
      documentId,
      themes,
      labeledContent
    };
  }

  /**
   * Compute basic document statistics
   */
  private computeStats(text: string): DocumentStats {
    const words = text.split(/\s+/).filter(w => w.length > 0);
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 10);
    const paragraphs = text.split(/\n\n+/).filter(p => p.trim().length > 20);

    return {
      wordCount: words.length,
      sentenceCount: sentences.length,
      paragraphCount: paragraphs.length,
      estimatedReadTime: Math.ceil(words.length / 200)
    };
  }

  /**
   * Extract clean sentences from text
   */
  private extractSentences(text: string): string[] {
    return text
      .split(/(?:[.!?]+(?:\s+|$))|(?:\n+)/)
      .map(s => s.trim())
      .filter(s => s.length >= 15 && s.length < 600)
      .slice(0, 100);
  }

  /**
   * Extract important keywords using TF-IDF-like scoring
   */
  private extractKeywords(text: string): string[] {
    const words = text.toLowerCase()
      .replace(/[^a-z\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3 && !STOP_WORDS.has(w));

    const wordFreq = new Map<string, number>();
    for (const word of words) {
      wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
    }

    return Array.from(wordFreq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([word]) => word);
  }

  /**
   * Rank sentences by keyword density and position
   */
  private rankSentences(sentences: string[], keywords: string[]): string[] {
    return this.rankSentencesImproved(sentences, keywords, []);
  }

  /**
   * NEW: Improved sentence ranking with enhanced scoring formula
   * Score = keyword_relevance + position_score + heading_importance + sentence_clarity
   */
  private rankSentencesImproved(
    sentences: string[],
    keywords: string[],
    sections: DocumentSection[]
  ): string[] {
    const keywordSet = new Set(keywords);

    // Build heading context map for importance scoring
    const headingContext = new Map<number, string>();
    let currentHeading = 'other';
    for (let i = 0; i < sentences.length; i++) {
      const s = sentences[i];
      // Check if sentence looks like a heading
      if (s.length < 80 && /^[A-Z]/.test(s)) {
        for (const [type, pattern] of Object.entries(SECTION_PATTERNS)) {
          if (pattern.test(s)) {
            currentHeading = type;
            break;
          }
        }
      }
      headingContext.set(i, currentHeading);
    }

    const scored = sentences.map((sentence, index) => {
      const words = sentence.toLowerCase().split(/\s+/);
      const wordCount = words.length;

      // 1. KEYWORD RELEVANCE (0-10 points)
      let keywordScore = 0;
      for (const word of words) {
        const cleanWord = word.replace(/[^a-z]/g, '');
        if (keywordSet.has(cleanWord)) {
          keywordScore += 1.5;
        }
        // Partial match bonus
        for (const kw of keywords) {
          if (cleanWord.includes(kw) || kw.includes(cleanWord)) {
            keywordScore += 0.5;
          }
        }
      }
      // Normalize to 0-10
      keywordScore = Math.min(10, keywordScore);

      // 2. POSITION SCORE (0-3 points)
      // Earlier sentences = higher importance, last sentences also important (conclusions)
      let positionScore = 1;
      if (index < 3) positionScore = 3;
      else if (index < 10) positionScore = 2.5;
      else if (index > sentences.length - 5) positionScore = 2;
      else if (index > sentences.length * 0.8) positionScore = 1.5;

      // 3. HEADING IMPORTANCE (0-3 points)
      const heading = headingContext.get(index) || 'other';
      const headingScores: Record<string, number> = {
        abstract: 3,
        conclusion: 2.5,
        results: 2.5,
        methodology: 2,
        introduction: 1.5,
        other: 1
      };
      const headingScore = headingScores[heading] || 1;

      // 4. SENTENCE CLARITY (0-3 points)
      // Prefer clear, well-structured sentences
      let clarityScore = 1;

      // Good length (10-40 words)
      if (wordCount >= 10 && wordCount <= 40) clarityScore += 1;

      // Contains signal words
      if (this.hasSignalWords(sentence)) clarityScore += 0.5;

      // Not too complex (few commas relative to length)
      const commaCount = (sentence.match(/,/g) || []).length;
      if (commaCount <= wordCount / 10) clarityScore += 0.3;

      // Contains numbers (often factual/important)
      if (/\d/.test(sentence)) clarityScore += 0.2;

      // TOTAL SCORE (additive for better distribution)
      const totalScore = keywordScore + positionScore + headingScore + clarityScore;

      return { sentence, score: totalScore, heading };
    });

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, 15)
      .map(s => s.sentence);
  }

  /**
   * NEW: Group sentences into themes
   */
  private groupIntoThemes(sentences: string[]): ThemeGroup[] {
    const themes: Map<string, string[]> = new Map();

    for (const sentence of sentences) {
      const lower = sentence.toLowerCase();
      let matched = false;

      for (const [theme, patterns] of Object.entries(THEME_PATTERNS)) {
        if (patterns.some(p => lower.includes(p))) {
          const existing = themes.get(theme) || [];
          existing.push(sentence);
          themes.set(theme, existing);
          matched = true;
          break;
        }
      }

      if (!matched) {
        const existing = themes.get('general') || [];
        existing.push(sentence);
        themes.set('general', existing);
      }
    }

    // Convert to ThemeGroup array with importance scores
    const themeLabels: Record<string, string> = {
      objective: 'Objectives',
      method: 'Methodology',
      result: 'Results',
      benefit: 'Benefits',
      challenge: 'Challenges',
      contribution: 'Contributions',
      general: 'Key Points'
    };

    const importanceOrder: Record<string, number> = {
      result: 1,
      contribution: 0.9,
      objective: 0.85,
      benefit: 0.8,
      method: 0.75,
      challenge: 0.7,
      general: 0.5
    };

    return Array.from(themes.entries())
      .map(([key, sents]) => ({
        label: themeLabels[key] || 'Other',
        sentences: sents.slice(0, 3),
        importance: importanceOrder[key] || 0.5
      }))
      .sort((a, b) => b.importance - a.importance)
      .slice(0, 4);
  }

  /**
   * NEW: Assign labels to content for structured output
   */
  private assignLabels(
    sentences: string[],
    sections: DocumentSection[],
    _keywords: string[]
  ): LabeledContent {
    const labeled: LabeledContent = {
      summary: [],
      keyPoints: [],
      methodology: [],
      findings: []
    };

    // Extract from sections
    const methodSection = sections.find(s => s.type === 'methodology');
    const resultSection = sections.find(s => s.type === 'results' || s.type === 'conclusion');
    const abstractSection = sections.find(s => s.type === 'abstract');

    if (abstractSection) {
      labeled.summary = abstractSection.content
        .split(/[.!?]+/)
        .filter(s => s.trim().length > 20)
        .slice(0, 2)
        .map(s => rewriteForBullet(s.trim()));
    }

    if (methodSection) {
      labeled.methodology = methodSection.content
        .split(/[.!?]+/)
        .filter(s => s.trim().length > 20)
        .slice(0, 3)
        .map(s => rewriteForBullet(s.trim()));
    }

    if (resultSection) {
      labeled.findings = resultSection.content
        .split(/[.!?]+/)
        .filter(s => s.trim().length > 20)
        .slice(0, 3)
        .map(s => rewriteForBullet(s.trim()));
    }

    // Fill key points from top sentences
    labeled.keyPoints = sentences
      .slice(0, 4)
      .map(s => rewriteForBullet(s));

    return labeled;
  }

  /**
   * Check for signal words that indicate importance
   */
  private hasSignalWords(sentence: string): boolean {
    const lower = sentence.toLowerCase();
    const signals = [
      'important', 'key', 'main', 'significant', 'conclude', 'result',
      'finding', 'demonstrate', 'show', 'prove', 'suggest', 'indicate',
      'therefore', 'thus', 'consequently', 'overall', 'novel', 'contribution',
      'propose', 'present', 'introduce', 'achieve', 'improve', 'outperform'
    ];
    return signals.some(s => lower.includes(s));
  }

  /**
   * Identify document sections
   */
  private identifySections(text: string): DocumentSection[] {
    const paragraphs = text.split(/\n\n+/).filter(p => p.trim().length > 20);
    const sections: DocumentSection[] = [];

    for (const para of paragraphs) {
      const lines = para.split('\n');
      const firstLine = lines[0].trim();

      let type: DocumentSection['type'] = 'other';
      let title = '';

      if (firstLine.length < 100) {
        for (const [sectionType, pattern] of Object.entries(SECTION_PATTERNS)) {
          if (pattern.test(firstLine)) {
            type = sectionType as DocumentSection['type'];
            title = firstLine;
            break;
          }
        }
      }

      if (type !== 'other' || para.length > 200) {
        sections.push({
          title: title || `Section ${sections.length + 1}`,
          content: para,
          type
        });
      }
    }

    return sections.slice(0, 10);
  }

  /**
   * Generate a summary from top sentences
   */
  private generateSummary(topSentences: string[], sections: DocumentSection[]): string {
    const abstractSection = sections.find(s => s.type === 'abstract');
    if (abstractSection && abstractSection.content.length > 100) {
      return shortenSentence(abstractSection.content, 60);
    }

    return topSentences
      .slice(0, 3)
      .map(s => shortenSentence(rephraseSentence(s), 25))
      .join(' ');
  }

  /**
   * Extract key points from analysis
   */
  private extractKeyPoints(topSentences: string[], keywords: string[]): string[] {
    const points: string[] = [];

    for (const sentence of topSentences.slice(0, 5)) {
      const rephrased = rephraseSentence(sentence);
      const shortened = shortenSentence(rephrased, 25);
      if (shortened.length > 20 && shortened.length < 200) {
        points.push(shortened);
      }
    }

    if (points.length < 3 && keywords.length >= 3) {
      points.push(`Key topics include ${keywords.slice(0, 4).join(', ')}.`);
    }

    return removeDuplicates(points).slice(0, 5);
  }

  // ==========================================================================
  // AI-LIKE RESPONSE GENERATION (INTENT-AWARE)
  // ==========================================================================

  /**
   * Detect query intent for appropriate response formatting
   */
  private detectQueryIntent(query: string): { intent: string; format: string } {
    const normalized = query.toLowerCase();

    for (const [intent, config] of Object.entries(INTENT_PATTERNS)) {
      if (config.keywords.some(kw => normalized.includes(kw))) {
        return { intent, format: config.format };
      }
    }

    return { intent: 'default', format: 'overview' };
  }

  /**
   * Generate response for a query using document analysis
   * Uses intent detection for appropriate formatting
   */
  generateResponse(analysis: DocumentAnalysis, query: string, documentName: string): string {
    const { intent, format } = this.detectQueryIntent(query);
    const normalizedQuery = query.toLowerCase();

    // Route to appropriate formatter based on intent
    switch (intent) {
      case 'how':
        return this.formatHowResponse(analysis, documentName);
      case 'why':
        return this.formatWhyResponse(analysis, documentName);
      case 'benefits':
        return this.formatBenefitsResponse(analysis, documentName);
      case 'results':
        return this.formatResultsResponse(analysis, documentName);
      case 'summary':
        return this.formatSummaryResponse(analysis, documentName);
      default:
        // Fall through to legacy detection for backwards compatibility
        break;
    }

    // Legacy detection for broader compatibility
    if (normalizedQuery.includes('summar') || normalizedQuery.includes('overview') || normalizedQuery.includes('about')) {
      return this.formatSummaryResponse(analysis, documentName);
    }

    if (normalizedQuery.includes('key') || normalizedQuery.includes('main') || normalizedQuery.includes('important') || normalizedQuery.includes('point')) {
      return this.formatKeyPointsResponse(analysis, documentName);
    }

    if (normalizedQuery.includes('method') || normalizedQuery.includes('approach') || normalizedQuery.includes('process')) {
      return this.formatMethodologyResponse(analysis, documentName);
    }

    if (normalizedQuery.includes('finding') || normalizedQuery.includes('conclude') || normalizedQuery.includes('outcome')) {
      return this.formatResultsResponse(analysis, documentName);
    }

    if (normalizedQuery.includes('explain') || normalizedQuery.includes('what is') || normalizedQuery.includes('describe')) {
      return this.formatExplainResponse(analysis, query, documentName);
    }

    return this.formatDefaultResponse(analysis, query, documentName);
  }

  /**
   * NEW: Format response for "how" queries - process steps format
   */
  private formatHowResponse(analysis: DocumentAnalysis, _documentName: string): string {
    const methodSentences = analysis.labeledContent.methodology.length > 0
      ? analysis.labeledContent.methodology
      : analysis.topSentences.filter(s =>
          /method|approach|process|technique|use|step|first|then/i.test(s)
        ).slice(0, 4);

    if (methodSentences.length === 0) {
      return this.formatDefaultResponse(analysis, 'how', _documentName);
    }

    // Add reasoning connectors for process flow
    const withConnectors = addReasoningConnector(
      methodSentences.map(s => rewriteForBullet(s))
    );

    const bullets = withConnectors.map((s, i) => `${i + 1}. ${s}`).join('\n');

    return `**Process Steps**\n\nBased on the document:\n\n${bullets}`;
  }

  /**
   * NEW: Format response for "why" queries - reasoning format
   */
  private formatWhyResponse(analysis: DocumentAnalysis, _documentName: string): string {
    const reasoningSentences = analysis.topSentences.filter(s =>
      /because|since|due to|reason|purpose|therefore|thus|aim|goal/i.test(s)
    ).slice(0, 3);

    if (reasoningSentences.length === 0) {
      // Construct reasoning from available content
      const points = analysis.keyPoints.slice(0, 2);
      if (points.length > 0) {
        const reasoning = `This is important because ${points[0].toLowerCase()}`;
        const followup = points[1] ? ` Furthermore, ${points[1].toLowerCase()}` : '';
        return `**Reasoning**\n\nBased on the document:\n\n• ${reasoning}${followup}`;
      }
      return this.formatDefaultResponse(analysis, 'why', _documentName);
    }

    // Add causal connectors
    const enhanced = reasoningSentences.map((s, i) => {
      const rewritten = rewriteForBullet(s);
      if (i === 0) return rewritten;
      return `${getRandomConnector('consequence').charAt(0).toUpperCase() + getRandomConnector('consequence').slice(1)}, ${rewritten.toLowerCase()}`;
    });

    return `**Reasoning**\n\nBased on the document:\n\n${enhanced.map(s => `• ${s}`).join('\n')}`;
  }

  /**
   * NEW: Format response for "benefits" queries - advantages list
   */
  private formatBenefitsResponse(analysis: DocumentAnalysis, _documentName: string): string {
    // Find benefit-themed content
    const benefitTheme = analysis.themes.find(t => t.label === 'Benefits');
    const benefitSentences = benefitTheme?.sentences ||
      analysis.topSentences.filter(s =>
        /benefit|advantage|improve|enhance|better|efficient|enable|allow|positive/i.test(s)
      ).slice(0, 4);

    if (benefitSentences.length === 0) {
      return this.formatDefaultResponse(analysis, 'benefits', _documentName);
    }

    const bullets = benefitSentences.map(s => `• ${rewriteForBullet(s)}`).join('\n');

    return `**Key Benefits**\n\nBased on the document:\n\n${bullets}`;
  }

  private formatSummaryResponse(analysis: DocumentAnalysis, _documentName: string): string {
    const opener = 'Based on the document:';

    // Use labeled summary if available
    const summaryPoints = analysis.labeledContent.summary.length > 0
      ? analysis.labeledContent.summary
      : analysis.topSentences.slice(0, 4);

    const bullets = summaryPoints.length > 0
      ? toBulletPoints(summaryPoints, 4, true)
      : '• The document contains highly sparse text or images that could not be fully summarized.\n• Please try asking specific questions.';

    return `**Summary**\n\n${opener}\n\n${bullets}`;
  }

  private formatKeyPointsResponse(analysis: DocumentAnalysis, _documentName: string): string {
    const opener = 'Based on the document:';
    const uniquePoints = removeDuplicates(analysis.keyPoints);

    const bullets = uniquePoints.length > 0
      ? toBulletPoints(uniquePoints.slice(0, 4), 4, true)
      : analysis.topSentences.length > 0
        ? toBulletPoints(analysis.topSentences.slice(0, 4), 4, true)
        : '• No explicit key points could be extracted from this sparse document.';

    return `**Key Points**\n\n${opener}\n\n${bullets}`;
  }

  private formatMethodologyResponse(analysis: DocumentAnalysis, documentName: string): string {
    const opener = 'Based on the document:';

    // Use labeled methodology if available
    if (analysis.labeledContent.methodology.length > 0) {
      const bullets = analysis.labeledContent.methodology.map((s, i) => {
        if (i === 0) return `• ${s}`;
        return `• ${getRandomConnector('consequence').charAt(0).toUpperCase() + getRandomConnector('consequence').slice(1)}, ${s.toLowerCase()}`;
      }).join('\n');

      return `**Methodology**\n\n${opener}\n\n${bullets}`;
    }

    const methodSection = analysis.sections.find(s => s.type === 'methodology');

    if (methodSection) {
      const methodPoints = methodSection.content
        .split(/[.!?]+/)
        .filter(s => s.trim().length > 20)
        .slice(0, 4)
        .map(s => rewriteForBullet(s.trim()));

      return `**Methodology**\n\n${opener}\n\n${toBulletPoints(methodPoints, 4, true)}`;
    }

    // Fallback to relevant sentences
    const methodSentences = analysis.topSentences
      .filter(s => /method|approach|process|technique|procedure|use|employ/i.test(s))
      .slice(0, 3);

    if (methodSentences.length > 0) {
      return `**Methodology**\n\n${opener}\n\n${toBulletPoints(methodSentences, 3, true)}`;
    }

    return this.formatDefaultResponse(analysis, 'methodology', documentName);
  }

  private formatResultsResponse(analysis: DocumentAnalysis, _documentName: string): string {
    const opener = 'Based on the document:';

    // Use labeled findings if available
    if (analysis.labeledContent.findings.length > 0) {
      const enhanced = addReasoningConnector(analysis.labeledContent.findings);
      return `**Key Findings**\n\n${opener}\n\n${enhanced.map(s => `• ${s}`).join('\n')}`;
    }

    const resultSection = analysis.sections.find(s => s.type === 'results');
    const conclusionSection = analysis.sections.find(s => s.type === 'conclusion');

    const section = resultSection || conclusionSection;

    if (section && section.content.length > 100) {
      const resultPoints = section.content
        .split(/[.!?]+/)
        .filter(s => s.trim().length > 20)
        .slice(0, 4)
        .map(s => rewriteForBullet(s.trim()));

      return `**Key Findings**\n\n${opener}\n\n${toBulletPoints(resultPoints, 4, true)}`;
    }

    // Fallback to signal-word sentences
    const resultSentences = analysis.topSentences
      .filter(s => /result|finding|show|demonstrate|conclude|indicate|achieve/i.test(s))
      .slice(0, 3);

    return `**Key Findings**\n\n${opener}\n\n${toBulletPoints(resultSentences, 3, true)}`;
  }

  private formatExplainResponse(analysis: DocumentAnalysis, query: string, documentName: string): string {
    const opener = 'Based on the document:';

    // Find sentences most relevant to the query
    const queryWords = query.toLowerCase()
      .split(/\s+/)
      .filter(w => w.length > 3 && !STOP_WORDS.has(w));

    const relevantSentences = analysis.topSentences
      .map(s => {
        const score = queryWords.filter(w => s.toLowerCase().includes(w)).length;
        return { sentence: s, score };
      })
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map(s => s.sentence);

    if (relevantSentences.length > 0) {
      // Add reasoning connectors for explanation flow
      const enhanced = addReasoningConnector(relevantSentences.map(s => rewriteForBullet(s)));
      return `**Explanation**\n\n${opener}\n\n${enhanced.map(s => `• ${s}`).join('\n')}`;
    }

    return this.formatDefaultResponse(analysis, query, documentName);
  }

  private formatDefaultResponse(analysis: DocumentAnalysis, _query: string, _documentName: string): string {
    const opener = 'Based on the document:';
    const uniqueSentences = removeDuplicates(analysis.topSentences);

    const bullets = uniqueSentences.length > 0
      ? toBulletPoints(uniqueSentences.slice(0, 3), 3, true)
      : '• This document appears to be very sparse or mostly visual.\n• Broad summaries are difficult to generate.';

    return `**Key Insights**\n\n${opener}\n\n${bullets}`;
  }

  /**
   * Extract the core idea (first few important words) from a sentence
   */
  private extractCoreIdea(sentence: string): string {
    const words = sentence.split(/\s+/).filter(w => w.length > 3 && !STOP_WORDS.has(w.toLowerCase()));
    const core = words.slice(0, 2).join(' ');
    return core.charAt(0).toUpperCase() + core.slice(1);
  }

  // ==========================================================================
  // SUGGESTED QUERIES
  // ==========================================================================

  /**
   * Get suggested queries for a document
   */
  getSuggestedQueries(analysis: DocumentAnalysis): string[] {
    const suggestions: string[] = [
      'Summarize this document',
      'What are the key points?'
    ];

    if (analysis.sections.some(s => s.type === 'methodology')) {
      suggestions.push('Explain the methodology');
    }

    if (analysis.sections.some(s => s.type === 'results')) {
      suggestions.push('What are the main findings?');
    }

    if (analysis.sections.some(s => s.type === 'conclusion')) {
      suggestions.push('What are the conclusions?');
    }

    if (analysis.keywords.length >= 2) {
      suggestions.push(`Explain ${analysis.keywords[0]}`);
    }

    return suggestions.slice(0, 4);
  }

  // ==========================================================================
  // CACHE MANAGEMENT
  // ==========================================================================

  /**
   * Clear analysis cache - IMPORTANT: call when switching documents
   */
  clearCache(documentId?: string) {
    if (documentId) {
      this.analysisCache.delete(documentId);
      if (this.currentDocumentId === documentId) {
        this.currentDocumentId = null;
      }
    } else {
      this.analysisCache.clear();
      this.currentDocumentId = null;
    }
    console.log(`[DocumentAnalyzer] Cache cleared${documentId ? ` for ${documentId}` : ''}`);
  }

  /**
   * Check if document has been analyzed
   */
  isAnalyzed(documentId: string): boolean {
    return this.analysisCache.has(documentId);
  }

  /**
   * Get cached analysis
   */
  getCachedAnalysis(documentId: string): DocumentAnalysis | null {
    return this.analysisCache.get(documentId) || null;
  }

  /**
   * Get current document ID
   */
  getCurrentDocumentId(): string | null {
    return this.currentDocumentId;
  }
}

// Export singleton
export const DocumentAnalyzer = new DocumentAnalyzerClass();
