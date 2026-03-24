/**
 * DOCUMENT ANALYZER - Fast Heuristic Analysis for Real Documents
 *
 * Provides instant AI-like responses for user-uploaded documents WITHOUT LLM.
 * Uses text extraction, keyword analysis, and sentence ranking.
 *
 * Strategy: Graceful degradation - always respond, never fail.
 * Output: Formatted to feel like real AI-generated responses.
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

// AI-like opening phrases for variety
const CONTEXT_PHRASES = {
  summary: [
    'Based on my analysis of this document,',
    'After reviewing the content,',
    'The document presents',
    'This paper explores'
  ],
  keyPoints: [
    'The key insights from this document are:',
    'Here are the main takeaways:',
    'The document highlights several important points:',
    'Based on the content, the critical points are:'
  ],
  methodology: [
    'The approach described in this document involves:',
    'The methodology centers around:',
    'The research employs the following approach:',
    'This document outlines a systematic process:'
  ],
  results: [
    'The document reveals several key findings:',
    'Based on the analysis, the main outcomes are:',
    'The evidence presented suggests:',
    'The key results demonstrate:'
  ],
  explain: [
    'Based on the document,',
    'The content indicates that',
    'According to this document,',
    'The text explains that'
  ],
  default: [
    'Here\'s what I found in the document:',
    'Based on the relevant content:',
    'The document addresses this as follows:',
    'From the analysis:'
  ]
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/** Get random phrase from array */
function getRandomPhrase(phrases: string[]): string {
  return phrases[Math.floor(Math.random() * phrases.length)];
}

/** Clean and rephrase a sentence for AI-like output */
function rephraseSentence(sentence: string): string {
  let cleaned = sentence
    .replace(/^\d+[\.\)]\s*/, '') // Remove numbering
    .replace(/^[-•]\s*/, '') // Remove bullets
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();

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
  const words = sentence.split(/\s+/);
  if (words.length <= maxWords) return sentence;

  // Find a good breaking point (end of clause)
  const breakPoints = [',', ';', ' and ', ' but ', ' which ', ' that '];
  let bestBreak = maxWords;

  for (const bp of breakPoints) {
    const idx = sentence.toLowerCase().indexOf(bp);
    if (idx > 50 && idx < maxWords * 6) {
      const wordCount = sentence.slice(0, idx).split(/\s+/).length;
      if (wordCount >= 10 && wordCount <= maxWords) {
        bestBreak = wordCount;
        break;
      }
    }
  }

  return words.slice(0, bestBreak).join(' ') + '...';
}

/** Convert sentences to bullet points */
function toBulletPoints(sentences: string[], maxPoints: number = 4): string {
  return sentences
    .slice(0, maxPoints)
    .map(s => `• ${shortenSentence(rephraseSentence(s), 30)}`)
    .join('\n');
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
   * Fast heuristic analysis - no ML, pure text processing
   */
  private performFastAnalysis(text: string, documentId: string): DocumentAnalysis {
    // Basic stats
    const stats = this.computeStats(text);

    // Extract sentences
    const sentences = this.extractSentences(text);

    // Extract keywords
    const keywords = this.extractKeywords(text);

    // Rank sentences by importance
    const rankedSentences = this.rankSentences(sentences, keywords);

    // Remove duplicates
    const topSentences = removeDuplicates(rankedSentences);

    // Identify sections
    const sections = this.identifySections(text);

    // Generate summary from top sentences
    const summary = this.generateSummary(topSentences, sections);

    // Extract key points
    const keyPoints = this.extractKeyPoints(topSentences, keywords);

    return {
      summary,
      keyPoints,
      topSentences,
      keywords,
      sections,
      stats,
      isAnalyzed: true,
      documentId
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
      .replace(/\n+/g, ' ')
      .split(/(?<=[.!?])\s+/)
      .map(s => s.trim())
      .filter(s => s.length > 30 && s.length < 500)
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
    const keywordSet = new Set(keywords);

    const scored = sentences.map((sentence, index) => {
      const words = sentence.toLowerCase().split(/\s+/);

      let keywordScore = 0;
      for (const word of words) {
        if (keywordSet.has(word.replace(/[^a-z]/g, ''))) {
          keywordScore += 1;
        }
      }

      const positionScore = index < 5 ? 2 : index > sentences.length - 5 ? 1.5 : 1;
      const lengthScore = words.length > 10 && words.length < 40 ? 1.2 : 1;
      const signalScore = this.hasSignalWords(sentence) ? 1.5 : 1;
      const totalScore = keywordScore * positionScore * lengthScore * signalScore;

      return { sentence, score: totalScore };
    });

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map(s => s.sentence);
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
  // AI-LIKE RESPONSE GENERATION
  // ==========================================================================

  /**
   * Generate response for a query using document analysis
   * Formatted to feel like real AI-generated responses
   */
  generateResponse(analysis: DocumentAnalysis, query: string, documentName: string): string {
    const normalizedQuery = query.toLowerCase();

    // Summary queries
    if (normalizedQuery.includes('summar') || normalizedQuery.includes('overview') || normalizedQuery.includes('about')) {
      return this.formatSummaryResponse(analysis, documentName);
    }

    // Key points queries
    if (normalizedQuery.includes('key') || normalizedQuery.includes('main') || normalizedQuery.includes('important') || normalizedQuery.includes('point')) {
      return this.formatKeyPointsResponse(analysis, documentName);
    }

    // Methodology queries
    if (normalizedQuery.includes('method') || normalizedQuery.includes('how') || normalizedQuery.includes('approach') || normalizedQuery.includes('process')) {
      return this.formatMethodologyResponse(analysis, documentName);
    }

    // Results/findings queries
    if (normalizedQuery.includes('result') || normalizedQuery.includes('finding') || normalizedQuery.includes('conclude') || normalizedQuery.includes('outcome')) {
      return this.formatResultsResponse(analysis, documentName);
    }

    // Explain queries
    if (normalizedQuery.includes('explain') || normalizedQuery.includes('what is') || normalizedQuery.includes('describe')) {
      return this.formatExplainResponse(analysis, query, documentName);
    }

    // Default: intelligent excerpt
    return this.formatDefaultResponse(analysis, query, documentName);
  }

  private formatSummaryResponse(analysis: DocumentAnalysis, documentName: string): string {
    const opener = getRandomPhrase(CONTEXT_PHRASES.summary);
    const cleanedSummary = shortenSentence(analysis.summary, 50);

    const topKeywords = analysis.keywords.slice(0, 5).join(', ');

    return `**Summary**

${opener} this document focuses on the following:

${toBulletPoints(analysis.topSentences.slice(0, 3), 3)}

**Key Topics:** ${topKeywords}

**Quick Stats:**
• ${analysis.stats.wordCount.toLocaleString()} words
• ~${analysis.stats.estimatedReadTime} min read`;
  }

  private formatKeyPointsResponse(analysis: DocumentAnalysis, documentName: string): string {
    const opener = getRandomPhrase(CONTEXT_PHRASES.keyPoints);
    const uniquePoints = removeDuplicates(analysis.keyPoints);

    const formattedPoints = uniquePoints
      .slice(0, 4)
      .map((p, i) => `${i + 1}. **${this.extractCoreIdea(p)}** — ${shortenSentence(p, 20)}`)
      .join('\n');

    return `**Key Points**

${opener}

${formattedPoints}

*Core themes: ${analysis.keywords.slice(0, 4).join(', ')}*`;
  }

  private formatMethodologyResponse(analysis: DocumentAnalysis, documentName: string): string {
    const opener = getRandomPhrase(CONTEXT_PHRASES.methodology);
    const methodSection = analysis.sections.find(s => s.type === 'methodology');

    if (methodSection) {
      const methodPoints = methodSection.content
        .split(/[.!?]+/)
        .filter(s => s.trim().length > 20)
        .slice(0, 4);

      return `**Methodology**

${opener}

${toBulletPoints(methodPoints, 4)}

*This approach is central to the document's findings.*`;
    }

    // Fallback to relevant sentences
    const methodSentences = analysis.topSentences
      .filter(s => /method|approach|process|technique|procedure|use|employ/i.test(s))
      .slice(0, 3);

    if (methodSentences.length > 0) {
      return `**Approach**

${opener}

${toBulletPoints(methodSentences, 3)}

*These are the key methodological aspects identified.*`;
    }

    return this.formatDefaultResponse(analysis, 'methodology', documentName);
  }

  private formatResultsResponse(analysis: DocumentAnalysis, documentName: string): string {
    const opener = getRandomPhrase(CONTEXT_PHRASES.results);
    const resultSection = analysis.sections.find(s => s.type === 'results');
    const conclusionSection = analysis.sections.find(s => s.type === 'conclusion');

    const section = resultSection || conclusionSection;

    if (section && section.content.length > 100) {
      const resultPoints = section.content
        .split(/[.!?]+/)
        .filter(s => s.trim().length > 20)
        .slice(0, 4);

      return `**Key Findings**

${opener}

${toBulletPoints(resultPoints, 4)}

*These conclusions are supported by evidence in the document.*`;
    }

    // Fallback to signal-word sentences
    const resultSentences = analysis.topSentences
      .filter(s => /result|finding|show|demonstrate|conclude|indicate|achieve/i.test(s))
      .slice(0, 3);

    return `**Findings**

${opener}

${toBulletPoints(resultSentences, 3)}

*Based on the key evidence presented.*`;
  }

  private formatExplainResponse(analysis: DocumentAnalysis, query: string, documentName: string): string {
    const opener = getRandomPhrase(CONTEXT_PHRASES.explain);

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
      return `**Explanation**

${opener}

${toBulletPoints(relevantSentences, 3)}

*This addresses the concepts mentioned in your question.*`;
    }

    return this.formatDefaultResponse(analysis, query, documentName);
  }

  private formatDefaultResponse(analysis: DocumentAnalysis, query: string, documentName: string): string {
    const opener = getRandomPhrase(CONTEXT_PHRASES.default);
    const uniqueSentences = removeDuplicates(analysis.topSentences);

    return `**From Your Document**

${opener}

${toBulletPoints(uniqueSentences.slice(0, 3), 3)}

**Related topics:** ${analysis.keywords.slice(0, 5).join(', ')}

*Try asking about "summary", "key points", or "methodology" for more specific insights.*`;
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
