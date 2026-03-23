/**
 * Whisper STT Web Worker
 * 
 * Runs speech-to-text transcription in a separate thread
 */

import { pipeline, env } from '@xenova/transformers';

// Configure Transformers.js
env.allowLocalModels = false;
env.allowRemoteModels = true;

let whisperPipeline: any = null;

interface InitMessage {
  type: 'init';
}

interface TranscribeMessage {
  type: 'transcribe';
  id: string;
  audio: Float32Array;
}

type WorkerMessage = InitMessage | TranscribeMessage;

// Initialize Whisper model
async function initWhisper() {
  if (whisperPipeline) return;
  
  try {
    self.postMessage({ type: 'progress', status: 'Loading Whisper model...' });
    
    whisperPipeline = await pipeline(
      'automatic-speech-recognition',
      'Xenova/whisper-tiny.en',
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
      error: error instanceof Error ? error.message : 'Failed to initialize Whisper'
    });
  }
}

// Transcribe audio
async function transcribe(audio: Float32Array): Promise<string> {
  if (!whisperPipeline) {
    await initWhisper();
  }
  
  const result = await whisperPipeline(audio, {
    chunk_length_s: 30,
    stride_length_s: 5,
  });
  
  return result.text;
}

// Handle messages
self.onmessage = async (e: MessageEvent<WorkerMessage>) => {
  const message = e.data;
  
  try {
    switch (message.type) {
      case 'init':
        await initWhisper();
        break;
        
      case 'transcribe':
        const text = await transcribe(message.audio);
        self.postMessage({
          type: 'transcribeResult',
          id: message.id,
          text,
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
