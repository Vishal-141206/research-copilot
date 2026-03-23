/**
 * PDF Processing Utilities
 * 
 * Handles PDF file upload and text extraction using pdf.js
 */

import * as pdfjsLib from 'pdfjs-dist';

// Configure the worker for pdf.js
const WORKER_URL = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER_URL;

export interface PDFMetadata {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string;
  creator?: string;
  producer?: string;
  creationDate?: string;
  modificationDate?: string;
  pageCount: number;
}

export interface PageText {
  pageNumber: number;
  text: string;
}

export interface ExtractedPDF {
  text: string;
  pages: PageText[];
  metadata: PDFMetadata;
}

export interface TextChunk {
  text: string;
  pageNumber: number;
  chunkIndex: number;
}

/**
 * Extract text from a PDF file
 */
export async function extractTextFromPDF(
  file: File,
  onProgress?: (progress: number) => void
): Promise<ExtractedPDF> {
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  
  const pdf = await loadingTask.promise;
  const numPages = pdf.numPages;
  
  // Extract metadata
  const metadata = await pdf.getMetadata();
  const info = metadata.info as any;
  const pdfMetadata: PDFMetadata = {
    title: info?.Title,
    author: info?.Author,
    subject: info?.Subject,
    keywords: info?.Keywords,
    creator: info?.Creator,
    producer: info?.Producer,
    pageCount: numPages,
  };
  
  // Extract text from all pages
  let fullText = '';
  const pages: PageText[] = [];
  
  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    
    const pageText = textContent.items
      .map((item: any) => item.str)
      .join(' ');
    
    pages.push({
      pageNumber: pageNum,
      text: pageText,
    });
    
    fullText += `\n\n=== Page ${pageNum} ===\n\n${pageText}`;
    
    // Report progress
    if (onProgress) {
      onProgress(pageNum / numPages);
    }
  }
  
  return {
    text: fullText.trim(),
    pages,
    metadata: pdfMetadata,
  };
}

/**
 * Chunk text into smaller segments for embedding with page tracking
 */
export function chunkTextWithPages(
  pages: PageText[],
  chunkSize: number = 500,
  overlap: number = 50
): TextChunk[] {
  const chunks: TextChunk[] = [];
  
  for (const page of pages) {
    const pageChunks = chunkText(page.text, chunkSize, overlap);
    
    pageChunks.forEach((chunkText, index) => {
      chunks.push({
        text: chunkText,
        pageNumber: page.pageNumber,
        chunkIndex: chunks.length,
      });
    });
  }
  
  return chunks;
}

/**
 * Chunk text into smaller segments for embedding
 * Uses a simple sliding window approach with overlap
 */
export function chunkText(
  text: string,
  chunkSize: number = 500,
  overlap: number = 50
): string[] {
  // Split by sentences first (simple approach)
  const sentences = text
    .replace(/\n+/g, ' ')
    .split(/[.!?]+/)
    .map(s => s.trim())
    .filter(s => s.length > 0);
  
  const chunks: string[] = [];
  let currentChunk: string[] = [];
  let currentLength = 0;
  
  for (const sentence of sentences) {
    const sentenceLength = sentence.split(/\s+/).length;
    
    if (currentLength + sentenceLength > chunkSize && currentChunk.length > 0) {
      // Save current chunk
      chunks.push(currentChunk.join('. ') + '.');
      
      // Start new chunk with overlap
      const overlapSentences = Math.floor(overlap / (currentLength / currentChunk.length));
      currentChunk = currentChunk.slice(-Math.max(1, overlapSentences));
      currentLength = currentChunk.reduce(
        (sum, s) => sum + s.split(/\s+/).length,
        0
      );
    }
    
    currentChunk.push(sentence);
    currentLength += sentenceLength;
  }
  
  // Add the last chunk
  if (currentChunk.length > 0) {
    chunks.push(currentChunk.join('. ') + '.');
  }
  
  return chunks;
}

/**
 * Clean and normalize text
 */
export function cleanText(text: string): string {
  return text
    .replace(/\s+/g, ' ') // Normalize whitespace
    .replace(/[^\x20-\x7E\n]/g, '') // Remove non-printable characters
    .trim();
}
