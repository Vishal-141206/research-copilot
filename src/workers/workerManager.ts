/**
 * Worker Manager
 * 
 * Manages all Web Workers and provides a clean API for the main thread
 */

// @ts-ignore
import EmbeddingsWorker from './embeddings.worker.ts?worker';
// @ts-ignore
import WhisperWorker from './whisper.worker.ts?worker';

type WorkerStatus = 'idle' | 'loading' | 'ready' | 'error';

interface WorkerProgress {
  status: string;
  progress?: number;
}

class WorkerManager {
  private priorityEmbedWorker: Worker | null = null;
  private backgroundEmbedWorker: Worker | null = null;
  private whisperWorker: Worker | null = null;
  
  private embeddingsStatus: WorkerStatus = 'idle';
  private whisperStatus: WorkerStatus = 'idle';
  
  private messageId = 0;
  private pendingRequests = new Map<string, {
    resolve: (value: any) => void;
    reject: (error: any) => void;
  }>();
  
  private progressCallbacks: Map<string, (progress: WorkerProgress) => void> = new Map();

  // Initialize embeddings worker
  async initEmbeddings(onProgress?: (progress: WorkerProgress) => void): Promise<void> {
    if (this.embeddingsStatus === 'ready') return;
    if (this.embeddingsStatus === 'loading') {
      return new Promise((resolve) => {
        const checkReady = setInterval(() => {
          if (this.embeddingsStatus === 'ready') {
            clearInterval(checkReady);
            resolve();
          }
        }, 100);
      });
    }

    return new Promise((resolve, reject) => {
      // Initialize two workers: One for priority (User Queries) and one for Background (PDF indexing)
      // This prevents the search being blocked by document ingestion!
      this.priorityEmbedWorker = new EmbeddingsWorker();
      this.backgroundEmbedWorker = new EmbeddingsWorker();
      
      let priorityReady = false;
      let backgroundReady = false;

      const priorityHandler = (e: MessageEvent) => {
        const { type, ...data } = e.data;
        if (type === 'ready') {
          priorityReady = true;
          // Only start background init once priority is ready to avoid contention
          this.backgroundEmbedWorker!.postMessage({ type: 'init' });
          if (backgroundReady) {
            this.embeddingsStatus = 'ready';
            resolve();
          }
        } else if (type === 'progress') {
          if (onProgress) onProgress({ status: `Priority: ${data.status}`, progress: data.progress });
        } else if (type === 'error') {
          this.embeddingsStatus = 'error';
          reject(new Error(data.error));
        } else {
          this.handleWorkerMessage(e.data);
        }
      };

      const backgroundHandler = (e: MessageEvent) => {
        const { type, ...data } = e.data;
        if (type === 'ready') {
          backgroundReady = true;
          if (priorityReady) {
            this.embeddingsStatus = 'ready';
            resolve();
          }
        } else if (type === 'progress') {
          // Progress for background is less critical to main thread
        } else if (type === 'error') {
          console.warn('Background worker error:', data.error);
        } else {
          this.handleWorkerMessage(e.data);
        }
      };
      
      this.priorityEmbedWorker.onmessage = priorityHandler;
      this.backgroundEmbedWorker.onmessage = backgroundHandler;
      
      this.priorityEmbedWorker.postMessage({ type: 'init' });
    });
  }

  // Initialize Whisper worker
  async initWhisper(onProgress?: (progress: WorkerProgress) => void): Promise<void> {
    if (this.whisperStatus === 'ready') return;
    if (this.whisperStatus === 'loading') {
      return new Promise((resolve) => {
        const checkReady = setInterval(() => {
          if (this.whisperStatus === 'ready') {
            clearInterval(checkReady);
            resolve();
          }
        }, 100);
      });
    }

    this.whisperStatus = 'loading';
    
    return new Promise((resolve, reject) => {
      this.whisperWorker = new WhisperWorker();
      
      const messageHandler = (e: MessageEvent) => {
        const { type, ...data } = e.data;
        
        switch (type) {
          case 'ready':
            this.whisperStatus = 'ready';
            resolve();
            break;
            
          case 'progress':
            if (onProgress) {
              onProgress({ status: data.status, progress: data.progress });
            }
            break;
            
          case 'error':
            this.whisperStatus = 'error';
            reject(new Error(data.error));
            break;
            
          case 'transcribeResult':
            this.handleWorkerMessage(e.data);
            break;
        }
      };
      
      this.whisperWorker.onmessage = messageHandler;
      this.whisperWorker.onerror = (error) => {
        this.whisperStatus = 'error';
        reject(error);
      };
      
      this.whisperWorker.postMessage({ type: 'init' });
    });
  }

  // Generate single embedding
  async generateEmbedding(text: string): Promise<number[]> {
    if (!this.priorityEmbedWorker || this.embeddingsStatus !== 'ready') {
      throw new Error('Priority embeddings worker not ready');
    }

    const id = `embed_${this.messageId++}`;
    
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.priorityEmbedWorker!.postMessage({ type: 'embed', id, text });
      
      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('Embedding generation timed out'));
        }
      }, 30000);
    });
  }

  // Generate batch embeddings (USES BACKGROUND WORKER)
  async generateEmbeddings(
    texts: string[],
    onProgress?: (current: number, total: number) => void
  ): Promise<number[][]> {
    if (!this.backgroundEmbedWorker || this.embeddingsStatus !== 'ready') {
      throw new Error('Background embeddings worker not ready');
    }

    const id = `embedBatch_${this.messageId++}`;
    
    if (onProgress) {
      this.progressCallbacks.set(id, (progress) => {
        if ('current' in progress && 'total' in progress) {
          onProgress((progress as any).current, (progress as any).total);
        }
      });
    }
    
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.backgroundEmbedWorker!.postMessage({ type: 'embedBatch', id, texts });
      
      // Timeout based on batch size (10s per text)
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          this.progressCallbacks.delete(id);
          reject(new Error('Batch embedding generation timed out'));
        }
      }, texts.length * 10000);
    });
  }

  // Transcribe audio
  async transcribe(audio: Float32Array): Promise<string> {
    if (!this.whisperWorker || this.whisperStatus !== 'ready') {
      throw new Error('Whisper worker not ready');
    }

    const id = `transcribe_${this.messageId++}`;
    
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.whisperWorker!.postMessage({ type: 'transcribe', id, audio });
      
      // Timeout after 60 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('Transcription timed out'));
        }
      }, 60000);
    });
  }

  // Handle worker messages
  private handleWorkerMessage(data: any) {
    const { type, id, ...payload } = data;
    
    if (type === 'batchProgress' && this.progressCallbacks.has(id)) {
      this.progressCallbacks.get(id)!({ current: payload.current, total: payload.total } as any);
      return;
    }
    
    const pending = this.pendingRequests.get(id);
    if (!pending) return;
    
    this.pendingRequests.delete(id);
    this.progressCallbacks.delete(id);
    
    switch (type) {
      case 'embedResult':
        pending.resolve(payload.embedding);
        break;
        
      case 'embedBatchResult':
        pending.resolve(payload.embeddings);
        break;
        
      case 'transcribeResult':
        pending.resolve(payload.text);
        break;
        
      default:
        pending.reject(new Error('Unknown result type'));
    }
  }

  // Get worker statuses
  getStatus() {
    return {
      embeddings: this.embeddingsStatus,
      whisper: this.whisperStatus,
    };
  }

  // Terminate workers
  terminate() {
    this.priorityEmbedWorker?.terminate();
    this.backgroundEmbedWorker?.terminate();
    this.whisperWorker?.terminate();
    this.embeddingsStatus = 'idle';
    this.whisperStatus = 'idle';
    this.pendingRequests.clear();
    this.progressCallbacks.clear();
  }
}

// Singleton instance
export const workerManager = new WorkerManager();
