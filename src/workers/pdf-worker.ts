import * as pdfjsLib from 'pdfjs-dist';
import { pipeline, env } from '@xenova/transformers';

// Configure Transformers.js for worker environment
env.allowLocalModels = false;
env.useBrowserCache = true;

let embedder: any = null;

async function getEmbedder() {
  if (!embedder) {
    embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  }
  return embedder;
}

function chunkText(text: string, size = 500, overlap = 50): string[] {
  const words = text.split(/\s+/);
  const chunks: string[] = [];
  
  for (let i = 0; i < words.length; i += (size - overlap)) {
    chunks.push(words.slice(i, i + size).join(' '));
    if (i + size >= words.length) break;
  }
  return chunks;
}

self.onmessage = async (e: MessageEvent) => {
  const { type, arrayBuffer, text, includeEmbeddings = false } = e.data;
  
  try {
    if (type === 'embed') {
      const generateEmbeddings = await getEmbedder();
      const output = await generateEmbeddings(text, { pooling: 'mean', normalize: true });
      self.postMessage({ 
        type: 'done', 
        embedding: Array.from(output.data)
      });
      return;
    }

    // Default to extraction
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer, disableWorker: true } as any).promise;
    let fullText = '';
    const numPages = pdf.numPages;

    // 1. Extract Text
    for (let i = 1; i <= numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items.map((item: any) => item.str).join(' ');
      fullText += pageText + '\n\n';
      
      self.postMessage({ 
        type: 'progress', 
        status: `Extracting text: Page ${i}/${numPages}`,
        progress: (i / numPages) * 0.3 
      });
    }

    const cleanText = fullText.trim();
    const chunks = chunkText(cleanText);
    const embeddings: number[][] = [];

    if (includeEmbeddings) {
      const generateEmbeddings = await getEmbedder();

      for (let i = 0; i < chunks.length; i++) {
        self.postMessage({
          type: 'progress',
          status: `Vectorizing: Chunk ${i + 1}/${chunks.length}`,
          progress: 0.3 + (i / chunks.length) * 0.6
        });

        const output = await generateEmbeddings(chunks[i], { pooling: 'mean', normalize: true });
        embeddings.push(Array.from(output.data));
      }
    }

    self.postMessage({ 
      type: 'done', 
      text: cleanText,
      chunks: chunks,
      embeddings: includeEmbeddings ? embeddings : undefined,
      pages: numPages
    });

  } catch (error) {
    self.postMessage({ 
      type: 'error', 
      error: error instanceof Error ? error.message : String(error) 
    });
  }
};
