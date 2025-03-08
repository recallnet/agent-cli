import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';
import { getDbPath } from '../utils/config-paths.js';

/**
 * Interface for document metadata
 */
export interface DocumentMetadata {
  id?: number;
  title: string;
  source: string;
  url: string;
  timestamp: number;
  plugin_name?: string;
  plugin_version?: string;
  doc_type: string;
}

/**
 * Interface for document chunk
 */
export interface DocumentChunk {
  id?: number;
  document_id: number;
  content: string;
  chunk_index: number;
  metadata?: Record<string, any>;
}

/**
 * Interface for chunk embedding
 */
export interface ChunkEmbedding {
  id?: number;
  chunk_id: number;
  embedding: Float32Array | number[];
  dimensions: number;
}

/**
 * Class for managing document storage and retrieval
 */
export class DocumentStore {
  private db: Database.Database;
  private isInitialized: boolean = false;
  private dbPath: string;
  
  /**
   * Create a new DocumentStore
   * @param dbPath Custom path for the SQLite database
   */
  constructor(dbPath?: string) {
    // Use provided path, or get from platform-specific location
    this.dbPath = dbPath || getDbPath();
    
    // Ensure directory exists
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    console.log(`📦 DOCSTORE: Initializing document store at ${this.dbPath}`);
    this.db = new Database(this.dbPath);
    
    // Initialize database schema
    this.initSchema();
  }
  
  /**
   * Initialize the database schema
   */
  private initSchema(): void {
    if (this.isInitialized) return;
    
    // Create documents table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        source TEXT NOT NULL,
        url TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        plugin_name TEXT,
        plugin_version TEXT,
        doc_type TEXT NOT NULL,
        UNIQUE(source, url)
      )
    `);
    
    // Create chunks table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        document_id INTEGER NOT NULL,
        content TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        metadata TEXT,
        FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE,
        UNIQUE(document_id, chunk_index)
      )
    `);
    
    // Create embeddings table (for future vector search)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS embeddings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chunk_id INTEGER NOT NULL,
        embedding BLOB NOT NULL,
        dimensions INTEGER NOT NULL,
        FOREIGN KEY(chunk_id) REFERENCES chunks(id) ON DELETE CASCADE,
        UNIQUE(chunk_id)
      )
    `);
    
    // Create indexes for faster retrieval
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_documents_source ON documents(source);
      CREATE INDEX IF NOT EXISTS idx_documents_plugin ON documents(plugin_name, plugin_version);
      CREATE INDEX IF NOT EXISTS idx_chunks_document ON chunks(document_id);
    `);
    
    this.isInitialized = true;
    console.log('📦 DOCSTORE: Database schema initialized');
  }
  
  /**
   * Store a document in the database
   * @param document The document metadata
   * @param chunks Array of content chunks from the document
   * @returns ID of the stored document
   */
  storeDocument(document: DocumentMetadata, chunks: string[]): number {
    const insert = this.db.prepare(`
      INSERT OR REPLACE INTO documents (title, source, url, timestamp, plugin_name, plugin_version, doc_type)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    
    // Insert document and get the ID
    const info = insert.run(
      document.title,
      document.source,
      document.url,
      document.timestamp,
      document.plugin_name || null,
      document.plugin_version || null,
      document.doc_type
    );
    
    const documentId = info.lastInsertRowid as number;
    
    // Insert chunks
    const insertChunk = this.db.prepare(`
      INSERT OR REPLACE INTO chunks (document_id, content, chunk_index, metadata)
      VALUES (?, ?, ?, ?)
    `);
    
    // Start a transaction for inserting chunks
    const transaction = this.db.transaction((docId: number, contentChunks: string[]) => {
      // Delete existing chunks for this document
      this.db.prepare('DELETE FROM chunks WHERE document_id = ?').run(docId);
      
      // Insert new chunks
      for (let i = 0; i < contentChunks.length; i++) {
        insertChunk.run(docId, contentChunks[i], i, null);
      }
    });
    
    transaction(documentId, chunks);
    
    console.log(`📦 DOCSTORE: Stored document "${document.title}" with ${chunks.length} chunks`);
    return documentId;
  }
  
  /**
   * Get a document by ID
   * @param id Document ID
   * @returns Document metadata and chunks
   */
  getDocument(id: number): { metadata: DocumentMetadata, chunks: string[] } | null {
    // Get document metadata
    const docQuery = this.db.prepare(`
      SELECT * FROM documents WHERE id = ?
    `);
    
    const doc = docQuery.get(id) as DocumentMetadata | undefined;
    if (!doc) return null;
    
    // Get document chunks
    const chunksQuery = this.db.prepare(`
      SELECT * FROM chunks WHERE document_id = ? ORDER BY chunk_index ASC
    `);
    
    const chunks = chunksQuery.all(id) as DocumentChunk[];
    const contentChunks = chunks.map(chunk => chunk.content);
    
    return {
      metadata: doc,
      chunks: contentChunks
    };
  }
  
  /**
   * Search for documents by keyword
   * @param query Search query
   * @param limit Maximum number of results
   * @returns Array of document IDs and matching chunks
   */
  searchDocuments(query: string, limit: number = 5): { document_id: number, chunk_id: number, content: string, title: string, source: string }[] {
    // Simple keyword search implementation
    const searchQuery = this.db.prepare(`
      SELECT c.id as chunk_id, c.document_id, c.content, d.title, d.source
      FROM chunks c
      JOIN documents d ON c.document_id = d.id
      WHERE c.content LIKE ?
      ORDER BY d.timestamp DESC
      LIMIT ?
    `);
    
    const results = searchQuery.all(`%${query}%`, limit) as { 
      document_id: number;
      chunk_id: number;
      content: string;
      title: string;
      source: string;
    }[];
    
    console.log(`📦 DOCSTORE: Found ${results.length} results for query "${query}"`);
    return results;
  }
  
  /**
   * Get all documents for a specific plugin
   * @param pluginName Name of the plugin
   * @param version Optional specific version
   * @returns Array of document IDs
   */
  getPluginDocuments(pluginName: string, version?: string): number[] {
    const query = this.db.prepare(`
      SELECT id FROM documents
      WHERE plugin_name = ?
      ${version ? 'AND plugin_version = ?' : ''}
      ORDER BY timestamp DESC
    `);
    
    let rows;
    if (version) {
      rows = query.all(pluginName, version) as { id: number }[];
    } else {
      rows = query.all(pluginName) as { id: number }[];
    }
    
    return rows.map(row => row.id);
  }
  
  /**
   * Delete a document and all its chunks
   * @param id Document ID
   * @returns Boolean indicating success
   */
  deleteDocument(id: number): boolean {
    const query = this.db.prepare(`
      DELETE FROM documents WHERE id = ?
    `);
    
    const info = query.run(id);
    const success = info.changes > 0;
    
    if (success) {
      console.log(`📦 DOCSTORE: Deleted document with ID ${id}`);
    }
    
    return success;
  }
  
  /**
   * Get the path to the SQLite database file
   * @returns The database file path
   */
  getDbPath(): string {
    return this.dbPath;
  }
  
  /**
   * Close the database connection
   */
  close(): void {
    this.db.close();
    console.log('📦 DOCSTORE: Database connection closed');
  }
  
  /**
   * Store an embedding for a document chunk
   * @param documentId The document ID
   * @param chunkIndex The chunk index
   * @param embedding The embedding vector
   * @returns The embedding ID
   */
  storeEmbedding(documentId: number, chunkIndex: number, embedding: { vector: number[], size: number }): number {
    // First, get the chunk ID
    const chunkQuery = this.db.prepare(`
      SELECT id FROM chunks
      WHERE document_id = ? AND chunk_index = ?
    `);
    
    const chunk = chunkQuery.get(documentId, chunkIndex) as { id: number } | undefined;
    
    if (!chunk) {
      throw new Error(`Chunk not found for document ${documentId} at index ${chunkIndex}`);
    }
    
    // Convert the vector to a string for storage
    const vectorString = JSON.stringify(embedding.vector);
    
    // Check if an embedding already exists for this chunk
    const existingQuery = this.db.prepare(`
      SELECT id FROM embeddings
      WHERE chunk_id = ?
    `);
    
    const existing = existingQuery.get(chunk.id) as { id: number } | undefined;
    
    if (existing) {
      // Update existing embedding
      const updateQuery = this.db.prepare(`
        UPDATE embeddings
        SET embedding = ?, dimensions = ?
        WHERE id = ?
      `);
      
      updateQuery.run(vectorString, embedding.size, existing.id);
      return existing.id;
    } else {
      // Insert new embedding
      const insertQuery = this.db.prepare(`
        INSERT INTO embeddings (chunk_id, embedding, dimensions)
        VALUES (?, ?, ?)
      `);
      
      const result = insertQuery.run(chunk.id, vectorString, embedding.size);
      return result.lastInsertRowid as number;
    }
  }
  
  /**
   * Get the embedding for a document chunk
   * @param chunkId The chunk ID
   * @returns The embedding or null if not found
   */
  getEmbedding(chunkId: number): { vector: number[], size: number } | null {
    const query = this.db.prepare(`
      SELECT embedding, dimensions
      FROM embeddings
      WHERE chunk_id = ?
    `);
    
    const result = query.get(chunkId) as { embedding: string, dimensions: number } | undefined;
    
    if (!result) {
      return null;
    }
    
    return {
      vector: JSON.parse(result.embedding),
      size: result.dimensions
    };
  }
  
  /**
   * Search for documents using vector similarity
   * @param embedding The query embedding
   * @param limit Maximum number of results
   * @returns Array of document chunks with similarity scores
   */
  searchByVector(embedding: { vector: number[], size: number }, limit: number = 5): Array<{
    document_id: number;
    chunk_id: number;
    content: string;
    title: string;
    source: string;
    similarity: number;
  }> {
    // This is a naive implementation that loads all embeddings into memory
    // For a production system, you would use a vector database or specialized index
    
    // Get all embeddings
    const query = this.db.prepare(`
      SELECT e.id, e.chunk_id, e.embedding, e.dimensions, 
             c.document_id, c.content, 
             d.title, d.source
      FROM embeddings e
      JOIN chunks c ON e.chunk_id = c.id
      JOIN documents d ON c.document_id = d.id
    `);
    
    const embeddings = query.all() as Array<{
      id: number;
      chunk_id: number;
      embedding: string;
      dimensions: number;
      document_id: number;
      content: string;
      title: string;
      source: string;
    }>;
    
    // Calculate similarity for each embedding
    const results = embeddings.map(item => {
      const docEmbedding = {
        vector: JSON.parse(item.embedding),
        size: item.dimensions
      };
      
      // Calculate cosine similarity
      let dotProduct = 0;
      let magnitude1 = 0;
      let magnitude2 = 0;
      
      for (let i = 0; i < embedding.size; i++) {
        dotProduct += embedding.vector[i] * docEmbedding.vector[i];
        magnitude1 += embedding.vector[i] * embedding.vector[i];
        magnitude2 += docEmbedding.vector[i] * docEmbedding.vector[i];
      }
      
      magnitude1 = Math.sqrt(magnitude1);
      magnitude2 = Math.sqrt(magnitude2);
      
      const similarity = dotProduct / (magnitude1 * magnitude2);
      
      return {
        document_id: item.document_id,
        chunk_id: item.chunk_id,
        content: item.content,
        title: item.title,
        source: item.source,
        similarity: similarity || 0
      };
    });
    
    // Sort by similarity (descending) and limit results
    return results
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  }
  
  /**
   * Get the total number of documents in the store
   * @returns Document count
   */
  getDocumentCount(): number {
    const query = this.db.prepare('SELECT COUNT(*) as count FROM documents');
    const result = query.get() as { count: number };
    return result.count;
  }
  
  /**
   * Get the total number of chunks in the store
   * @returns Chunk count
   */
  getChunkCount(): number {
    const query = this.db.prepare('SELECT COUNT(*) as count FROM chunks');
    const result = query.get() as { count: number };
    return result.count;
  }
  
  /**
   * Get the total number of embeddings in the store
   * @returns Embedding count
   */
  getEmbeddingCount(): number {
    const query = this.db.prepare('SELECT COUNT(*) as count FROM embeddings');
    const result = query.get() as { count: number };
    return result.count;
  }
} 