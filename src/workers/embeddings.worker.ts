/**
 * Embeddings Web Worker
 * 
 * Runs Transformers.js embeddings in a separate thread to prevent UI blocking
 */

import { pipeline, env } from '@xenova/transformers';

// Configure Transformers.js
env.allowLocalModels = false;
env.allowRemoteModels = true;

let embeddingPipeline: any = null;

// Message types
interface InitMessage {
  type: 'init';
}

interface EmbedMessage {
  type: 'embed';
  id: string;
  text: string;
}

interface EmbedBatchMessage {
  type: 'embedBatch';
  id: string;
  texts: string[];
}

type WorkerMessage = InitMessage | EmbedMessage | EmbedBatchMessage;

// Initialize the embedding model
async function initEmbeddings() {
  if (embeddingPipeline) return;
  
  try {
    self.postMessage({ type: 'progress', status: 'Loading embedding model...' });
    
    embeddingPipeline = await pipeline(
      'feature-extraction',
      'Xenova/all-MiniLM-L6-v2',
      {
        progress_callback: (progress: any) => {
          self.postMessage({ 
            type: 'progress', 
            status: progress.status,
            progress: progress.progress 
          });
        },
      }
    );
    
    self.postMessage({ type: 'ready' });
  } catch (error) {
    self.postMessage({ 
      type: 'error', 
      error: error instanceof Error ? error.message : 'Failed to initialize embeddings' 
    });
  }
}

// Generate single embedding
async function generateEmbedding(text: string): Promise<number[]> {
  if (!embeddingPipeline) {
    await initEmbeddings();
  }
  
  const output = await embeddingPipeline(text, {
    pooling: 'mean',
    normalize: true,
  });
  
  return Array.from(output.data);
}

// Generate batch embeddings
async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const embeddings: number[][] = [];
  
  for (let i = 0; i < texts.length; i++) {
    const embedding = await generateEmbedding(texts[i]);
    embeddings.push(embedding);
    
    // Report progress
    self.postMessage({
      type: 'batchProgress',
      current: i + 1,
      total: texts.length,
    });
  }
  
  return embeddings;
}

// Handle messages from main thread
self.onmessage = async (e: MessageEvent<WorkerMessage>) => {
  const message = e.data;
  
  try {
    switch (message.type) {
      case 'init':
        await initEmbeddings();
        break;
        
      case 'embed':
        const embedding = await generateEmbedding(message.text);
        self.postMessage({
          type: 'embedResult',
          id: message.id,
          embedding,
        });
        break;
        
      case 'embedBatch':
        const embeddings = await generateEmbeddings(message.texts);
        self.postMessage({
          type: 'embedBatchResult',
          id: message.id,
          embeddings,
        });
        break;
        
      default:
        self.postMessage({ 
          type: 'error', 
          error: 'Unknown message type' 
        });
    }
  } catch (error) {
    self.postMessage({
      type: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};
