/**
 * IndexedDB Persistence
 * 
 * Save and restore app state including chat history and documents
 */

import { openDB, DBSchema, IDBPDatabase } from 'idb';

interface AppDB extends DBSchema {
  documents: {
    key: string;
    value: {
      id: string;
      filename: string;
      uploadedAt: number;
      pages: Array<{ pageNumber: number; text: string }>;
      chunks: Array<{ text: string; pageNumber: number; chunkIndex: number }>;
      currentDocumentId?: string;
    };
  };
  chatHistory: {
    key: string;
    value: {
      id: string;
      documentId: string;
      messages: Array<{
        role: 'user' | 'assistant' | 'system';
        text: string;
        citations?: Array<{ chunkIndex: number; pageNumber: number }>;
        timestamp: number;
      }>;
      updatedAt: number;
    };
  };
  settings: {
    key: string;
    value: {
      key: string;
      value: any;
    };
  };
}

let dbInstance: IDBPDatabase<AppDB> | null = null;

/**
 * Initialize IndexedDB
 */
export async function initDB(): Promise<IDBPDatabase<AppDB>> {
  if (dbInstance) return dbInstance;
  
  dbInstance = await openDB<AppDB>('research-copilot-db', 1, {
    upgrade(db) {
      // Create stores
      if (!db.objectStoreNames.contains('documents')) {
        db.createObjectStore('documents', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('chatHistory')) {
        db.createObjectStore('chatHistory', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    },
  });
  
  return dbInstance;
}

/**
 * Save document
 */
export async function saveDocument(doc: {
  id: string;
  filename: string;
  pages: Array<{ pageNumber: number; text: string }>;
  chunks: Array<{ text: string; pageNumber: number; chunkIndex: number }>;
}) {
  const db = await initDB();
  await db.put('documents', {
    ...doc,
    uploadedAt: Date.now(),
  });
}

/**
 * Get document
 */
export async function getDocument(id: string) {
  const db = await initDB();
  return await db.get('documents', id);
}

/**
 * Get all documents
 */
export async function getAllDocuments() {
  const db = await initDB();
  return await db.getAll('documents');
}

/**
 * Delete document
 */
export async function deleteDocument(id: string) {
  const db = await initDB();
  await db.delete('documents', id);
  
  // Also delete associated chat history
  const allChats = await db.getAll('chatHistory');
  for (const chat of allChats) {
    if (chat.documentId === id) {
      await db.delete('chatHistory', chat.id);
    }
  }
}

/**
 * Save chat history
 */
export async function saveChatHistory(
  documentId: string,
  messages: Array<{
    role: 'user' | 'assistant' | 'system';
    text: string;
    citations?: Array<{ chunkIndex: number; pageNumber: number }>;
    timestamp: number;
  }>
) {
  const db = await initDB();
  const id = `chat_${documentId}`;
  
  await db.put('chatHistory', {
    id,
    documentId,
    messages,
    updatedAt: Date.now(),
  });
}

/**
 * Get chat history
 */
export async function getChatHistory(documentId: string) {
  const db = await initDB();
  const id = `chat_${documentId}`;
  return await db.get('chatHistory', id);
}

/**
 * Clear all chat history
 */
export async function clearChatHistory(documentId: string) {
  const db = await initDB();
  const id = `chat_${documentId}`;
  await db.delete('chatHistory', id);
}

/**
 * Save setting
 */
export async function saveSetting(key: string, value: any) {
  const db = await initDB();
  await db.put('settings', { key, value });
}

/**
 * Get setting
 */
export async function getSetting(key: string) {
  const db = await initDB();
  const result = await db.get('settings', key);
  return result?.value;
}

/**
 * Save current document ID
 */
export async function saveCurrentDocumentId(docId: string | null) {
  await saveSetting('currentDocumentId', docId);
}

/**
 * Get current document ID
 */
export async function getCurrentDocumentId(): Promise<string | null> {
  return await getSetting('currentDocumentId');
}

/**
 * Clear all data
 */
export async function clearAllData() {
  const db = await initDB();
  await db.clear('documents');
  await db.clear('chatHistory');
  await db.clear('settings');
}
