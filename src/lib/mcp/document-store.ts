import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';
import { getDbPath } from '../utils/config-paths.js';
import { EmbeddingService, Embedding } from './embedding-service.js';
import { v4 as uuidv4 } from 'uuid';

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
  private embeddingService: EmbeddingService | null = null;
  
  /**
   * Create a new DocumentStore
   * @param dbPath Custom path for the SQLite database
   * @param embeddingService Optional embedding service for vector search
   */
  constructor(dbPath?: string, embeddingService?: EmbeddingService) {
    // Use provided path, or get from platform-specific location
    this.dbPath = dbPath || getDbPath('documentation.db');
    
    // Ensure database directory exists
    const dbDir = path.dirname(this.dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    
    console.log(`Initializing DocumentStore with database at ${this.dbPath}`);
    this.db = new Database(this.dbPath);
    this.initSchema();
    
    // Set embedding service if provided
    if (embeddingService) {
      this.embeddingService = embeddingService;
    }
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
   * Initialize the embedding service if not already set
   */
  private initializeEmbeddingService(): void {
    if (!this.embeddingService) {
      console.log('Initializing embedding service');
      this.embeddingService = new EmbeddingService();
    }
  }
  
  /**
   * Store a document in the database
   * @param document Document metadata
   * @param content Document content or pre-chunked content
   * @returns Document ID
   */
  storeDocument(document: DocumentMetadata, content: string | string[]): number {
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
    
    // Process chunks
    let chunks: string[];
    if (typeof content === 'string') {
      // If content is a string, chunk it into paragraphs
      chunks = content.split('\n\n').filter(chunk => chunk.trim().length > 0);
    } else {
      // If content is already chunked, use it directly
      chunks = content;
    }
    
    // Insert chunks
    const insertChunk = this.db.prepare(`
      INSERT INTO chunks (document_id, content, chunk_index)
      VALUES (?, ?, ?)
    `);
    
    const insertChunks = this.db.transaction((chunks: string[]) => {
      for (let i = 0; i < chunks.length; i++) {
        insertChunk.run(documentId, chunks[i], i);
      }
    });
    
    insertChunks(chunks);
    
    console.log(`📦 DOCSTORE: Stored document with ID ${documentId} (${chunks.length} chunks)`);
    
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
  
  /**
   * Generate and store embeddings for document chunks
   * @param documentId The ID of the document to generate embeddings for
   */
  async generateEmbeddingsForDocument(documentId: number): Promise<void> {
    this.initializeEmbeddingService();
    
    // Get all chunks for the document
    const chunks = this.db.prepare(`
      SELECT id, content FROM chunks
      WHERE document_id = ?
      ORDER BY chunk_index
    `).all(documentId) as Array<{id: string, content: string}>;
    
    if (chunks.length === 0) {
      console.log(`No chunks found for document ${documentId}`);
      return;
    }
    
    console.log(`Generating embeddings for ${chunks.length} chunks of document ${documentId}`);
    
    // Process chunks in batches to avoid memory issues
    const batchSize = 10;
    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      const contents = batch.map(chunk => chunk.content);
      
      try {
        // Generate embeddings for the batch
        const embeddings = await this.embeddingService!.generateEmbeddings(contents);
        
        // Store embeddings in the database
        const insertEmbeddingStmt = this.db.prepare(`
          INSERT OR REPLACE INTO embeddings (id, chunk_id, embedding, dimensions)
          VALUES (?, ?, ?, ?)
        `);
        
        const insertEmbeddingTx = this.db.transaction((embeddings: Embedding[], chunkIds: string[]) => {
          for (let j = 0; j < embeddings.length; j++) {
            const embedding = embeddings[j];
            const chunkId = chunkIds[j];
            // Store embedding as binary buffer
            const buffer = Buffer.from(new Float32Array(embedding.vector).buffer);
            insertEmbeddingStmt.run(
              uuidv4(), // Generate unique ID
              chunkId,  // Chunk ID
              buffer,   // Binary embedding data
              embedding.dimensions // Number of dimensions
            );
          }
        });
        
        insertEmbeddingTx(embeddings, batch.map(chunk => chunk.id));
        console.log(`Generated and stored embeddings for batch ${i / batchSize + 1} of ${Math.ceil(chunks.length / batchSize)}`);
      } catch (error) {
        console.error(`Error generating embeddings for batch: ${error}`);
      }
    }
  }
  
  /**
   * Store a document with vector embeddings
   * @param doc Document to store
   * @param content Document content
   * @param generateEmbeddings Whether to generate embeddings for the document chunks
   */
  async storeDocumentWithEmbeddings(
    doc: DocumentMetadata,
    content: string,
    generateEmbeddings: boolean = true
  ): Promise<number> {
    // Store the document first
    const documentId = this.storeDocument(doc, content);
    
    // Generate embeddings if requested
    if (generateEmbeddings) {
      await this.generateEmbeddingsForDocument(documentId);
    }
    
    return documentId;
  }
  
  /**
   * Search for documents using vector similarity
   * @param query The search query
   * @param limit Maximum number of results to return
   * @param threshold Similarity threshold (0-1)
   */
  async vectorSearch(query: string, limit: number = 5, threshold: number = 0.7): Promise<Array<{ document: any, chunk: any, similarity: number }>> {
    this.initializeEmbeddingService();
    
    try {
      // Generate embedding for the query
      const queryEmbedding = await this.embeddingService!.generateEmbedding(query);
      
      // Get all embeddings and chunks from the database
      const embeddingsWithChunks = this.db.prepare(`
        SELECT e.chunk_id, e.embedding, e.dimensions, c.content, c.document_id, d.title, d.plugin_name, d.plugin_version
        FROM embeddings e
        JOIN chunks c ON e.chunk_id = c.id
        JOIN documents d ON c.document_id = d.id
      `).all() as Array<{
        chunk_id: string, 
        embedding: Buffer, 
        dimensions: number, 
        content: string, 
        document_id: string, 
        title: string, 
        plugin_name: string, 
        plugin_version: string
      }>;
      
      if (embeddingsWithChunks.length === 0) {
        console.log('No embeddings found in the database');
        return [];
      }
      
      // Calculate similarities
      const results = embeddingsWithChunks.map(row => {
        const embedding = new Float32Array(row.embedding.buffer);
        const similarity = this.embeddingService!.calculateCosineSimilarity(
          queryEmbedding.vector,
          Array.from(embedding)
        );
        
        return {
          document: {
            id: row.document_id,
            title: row.title,
            plugin_name: row.plugin_name,
            plugin_version: row.plugin_version
          },
          chunk: {
            id: row.chunk_id,
            content: row.content
          },
          similarity
        };
      });
      
      // Filter by threshold and sort by similarity
      return results
        .filter(result => result.similarity >= threshold)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, limit);
    } catch (error) {
      console.error('Error performing vector search:', error);
      return [];
    }
  }
  
  /**
   * Combined search using both keyword and vector similarity
   * @param query The search query
   * @param limit Maximum number of results to return
   */
  async combinedSearch(query: string, limit: number = 5): Promise<Array<{ document: any, chunk: any, relevance: number }>> {
    try {
      // Perform keyword search
      const rawKeywordResults = this.searchDocuments(query, limit * 2);
      
      // Convert to the expected format
      const keywordResults = rawKeywordResults.map(result => ({
        id: String(result.document_id),
        title: result.title,
        plugin_name: '', // These fields might not be available in keyword search
        plugin_version: '',
        chunk_id: String(result.chunk_id),
        chunk_content: result.content
      }));
      
      // Perform vector search if embedding service is available
      let vectorResults: Array<{ document: any, chunk: any, similarity: number }> = [];
      if (this.embeddingService) {
        vectorResults = await this.vectorSearch(query, limit * 2);
      }
      
      // Combine results
      const combinedResults = new Map();
      
      // Add keyword results first
      keywordResults.forEach(result => {
        const key = `${result.id}:${result.chunk_id}`;
        combinedResults.set(key, {
          document: {
            id: result.id,
            title: result.title,
            plugin_name: result.plugin_name,
            plugin_version: result.plugin_version
          },
          chunk: {
            id: result.chunk_id,
            content: result.chunk_content
          },
          relevance: 0.5 // Base relevance for keyword match
        });
      });
      
      // Add or update with vector results
      vectorResults.forEach(result => {
        const key = `${result.document.id}:${result.chunk.id}`;
        if (combinedResults.has(key)) {
          // If already in results, update relevance score
          const existing = combinedResults.get(key);
          existing.relevance = Math.max(existing.relevance, result.similarity);
        } else {
          // Otherwise add new result
          combinedResults.set(key, {
            document: result.document,
            chunk: result.chunk,
            relevance: result.similarity
          });
        }
      });
      
      // Convert to array, sort by relevance, and limit results
      return Array.from(combinedResults.values())
        .sort((a, b) => b.relevance - a.relevance)
        .slice(0, limit);
    } catch (error) {
      console.error('Error performing combined search:', error);
      return [];
    }
  }
} 