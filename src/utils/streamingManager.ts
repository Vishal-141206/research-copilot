/**
 * Streaming Response Manager
 * Handles streaming with status updates and perceived speed optimization
 */

export type ResponseStatus = 'idle' | 'listening' | 'processing' | 'searching' | 'generating' | 'complete' | 'error';

export interface StreamConfig {
  onStatus?: (status: ResponseStatus) => void;
  onToken?: (token: string, accumulated: string) => void;
  onComplete?: (text: string, stats?: any) => void;
  onError?: (error: string) => void;
}

export class StreamingResponseManager {
  private currentStatus: ResponseStatus = 'idle';
  private config: StreamConfig = {};

  setConfig(config: StreamConfig) {
    this.config = config;
  }

  setStatus(status: ResponseStatus) {
    this.currentStatus = status;
    this.config.onStatus?.(status);
  }

  async streamTokens(text: string, delayMs: number = 15) {
    // Simulate streaming by splitting into tokens
    const words = text.split(' ');
    let accumulated = '';

    for (const word of words) {
      accumulated += (accumulated ? ' ' : '') + word;
      this.config.onToken?.(word, accumulated);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }

    return accumulated;
  }

  /**
   * Generate response with streaming and status updates
   * Falls back to cached or simplified responses for speed
   */
  async generateResponse(
    query: string,
    context: string[],
    mode: 'simple' | 'detailed' | 'exam',
    generateFn: (prompt: string) => Promise<{ text: string; stats?: any }>
  ): Promise<string> {
    try {
      this.setStatus('processing');
      
      // Build prompt based on mode
      const systemPrompts = {
        simple: 'Explain in 1-2 simple sentences. Use everyday language.',
        detailed: 'Provide a detailed explanation with examples and context. 3-4 sentences.',
        exam: 'Answer as if for an exam: structured, comprehensive, with key points. 4-5 sentences.',
      };

      let prompt = `${systemPrompts[mode]}\n\n`;
      
      if (context.length > 0) {
        this.setStatus('searching');
        await new Promise(resolve => setTimeout(resolve, 300)); // Show "searching" briefly
        prompt += `Context:\n${context.join('\n\n')}\n\n`;
      }

      prompt += `Question: ${query}\n\nAnswer:`;

      this.setStatus('generating');

      const result = await generateFn(prompt);
      
      // Stream the response
      await this.streamTokens(result.text, mode === 'simple' ? 10 : 15);

      this.setStatus('complete');
      this.config.onComplete?.(result.text, result.stats);

      return result.text;

    } catch (error) {
      this.setStatus('error');
      const errorMsg = error instanceof Error ? error.message : 'Failed to generate response';
      this.config.onError?.(errorMsg);
      throw error;
    }
  }

  /**
   * Fast response for highlighted text (no retrieval needed)
   */
  async explainSelection(
    selectedText: string,
    action: 'explain' | 'summarize' | 'keypoints',
    generateFn: (prompt: string) => Promise<{ text: string; stats?: any }>
  ): Promise<string> {
    try {
      this.setStatus('processing');

      const prompts = {
        explain: `Explain this text in simple terms (2 sentences):\n\n"${selectedText}"\n\nExplanation:`,
        summarize: `Summarize this in 1 sentence:\n\n"${selectedText}"\n\nSummary:`,
        keypoints: `List 3 key points from this text:\n\n"${selectedText}"\n\nKey points:`,
      };

      this.setStatus('generating');
      const result = await generateFn(prompts[action]);
      
      // Fast streaming for instant feel
      await this.streamTokens(result.text, 8);

      this.setStatus('complete');
      this.config.onComplete?.(result.text);

      return result.text;

    } catch (error) {
      this.setStatus('error');
      this.config.onError?.('Failed to process selection');
      throw error;
    }
  }

  reset() {
    this.setStatus('idle');
  }
}
