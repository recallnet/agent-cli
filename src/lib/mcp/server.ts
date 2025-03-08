import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { EventEmitter } from 'events';
import axios, { AxiosResponse } from 'axios';
import { URL } from 'url';
import * as cheerio from 'cheerio';
import { DocumentStore } from './document-store.js';
import { TextEmbeddings } from './text-embeddings.js';
import { DocumentChunker } from './document-chunker.js';
import { DocumentMetadata } from './document-store.js';
import { PluginRegistry } from '../plugins/registry.js';
import { getDataPath } from '../utils/config-paths.js';

/**
 * MCP Server options
 */
export interface McpServerOptions {
  port: number;
  cacheTtl: number; // milliseconds
  pluginRegistryUrl?: string;
  docsBasePath?: string;
  githubApiToken?: string; // API token for GitHub API access
  maxFileSizeBytes?: number; // Maximum file size to fetch in bytes
  maxRepositoryFiles?: number; // Maximum number of files to fetch from a repository
  documentStore?: {
    dbPath: string;  // Custom path for the SQLite database
  };
}

/**
 * Documentation source types
 */
export enum DocSourceType {
  PLUGIN = 'plugin',
  GITHUB = 'github',
  GITHUB_REPO = 'github_repo', // New type for GitHub repository scanning
  MARKDOWN = 'markdown',
  URL = 'url',
  COMPETITION = 'competition',
  STRATEGY = 'strategy',
  CODE_ANALYSIS = 'code_analysis', // New type for analyzing code
}

/**
 * Documentation request type
 */
export interface DocRequest {
  type: DocSourceType;
  query: string;
  params?: Record<string, string>;
}

/**
 * Documentation response
 */
export interface DocResponse {
  content: string;
  source: string;
  timestamp: number;
  metadata?: Record<string, any>;
}

/**
 * GitHub repository scanning options
 */
export interface GithubScanOptions {
  branch?: string;
  fileTypes?: string[];
  maxDepth?: number;
  maxFiles?: number;
  includePatterns?: string[];
  excludePatterns?: string[];
  fetchContent?: boolean;
  includeDependencies?: boolean;
}

/**
 * GitHub file information
 */
export interface GithubFileInfo {
  name: string;
  path: string;
  type: 'file' | 'dir';
  size?: number;
  content?: string;
  sha: string;
  url: string;
  download_url?: string;
}

/**
 * Content type enumeration
 */
export enum ContentType {
  HTML = 'html',
  MARKDOWN = 'markdown',
  JSON = 'json',
  CODE = 'code',
  TEXT = 'text',
  UNKNOWN = 'unknown'
}

/**
 * Content extraction result
 */
export interface ContentExtractionResult {
  content: string;
  contentType: ContentType;
  title?: string;
  metadata?: Record<string, any>;
}

/**
 * Document chunk for semantic searching
 */
export interface DocumentChunk {
  id: string;
  content: string;
  source: string;
  metadata?: Record<string, any>;
  relevanceScore?: number;
}

/**
 * Managed Context Provider Server
 * Provides documentation context to LLM models based on requests
 */
export class McpServer extends EventEmitter {
  private server: http.Server | null = null;
  private options: McpServerOptions;
  private cache = new Map<string, DocResponse>();
  private pluginRegistry: PluginRegistry;
  private documentStore: DocumentStore;
  private textEmbeddings: TextEmbeddings;
  private documentChunker: DocumentChunker;
  
  constructor(options: Partial<McpServerOptions> = {}) {
    super();
    console.log('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
    console.log('!!!      USING UPDATED MCP SERVER WITH DOCS SITE       !!!');
    console.log('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
    
    this.options = {
      port: options.port || parseInt(process.env.MCP_PORT || '3333', 10),
      cacheTtl: options.cacheTtl || parseInt(process.env.CACHE_TTL || '3600000', 10), // Default 1 hour
      pluginRegistryUrl: options.pluginRegistryUrl || process.env.PLUGIN_REGISTRY_URL || 'https://raw.githubusercontent.com/elizaos/registry/main/index.json',
      docsBasePath: options.docsBasePath || process.env.DOCS_BASE_PATH || path.join(process.cwd(), 'docs'),
      githubApiToken: options.githubApiToken || process.env.GITHUB_API_TOKEN,
      maxFileSizeBytes: options.maxFileSizeBytes || parseInt(process.env.MAX_FILE_SIZE_BYTES || '1000000', 10), // Default 1MB
      maxRepositoryFiles: options.maxRepositoryFiles || parseInt(process.env.MAX_REPOSITORY_FILES || '100', 10) // Default 100 files
    };
    
    // Initialize plugin registry
    this.pluginRegistry = new PluginRegistry(this.options.pluginRegistryUrl);
    
    // Initialize document store with custom path if provided
    const documentStorePath = this.options.documentStore?.dbPath || getDataPath('docs', 'documentation.db');
    this.documentStore = new DocumentStore(documentStorePath);
    
    this.textEmbeddings = new TextEmbeddings();
    this.documentChunker = new DocumentChunker();
  }
  
  /**
   * Start the MCP server
   */
  public async start(): Promise<void> {
    if (this.server) {
      console.log(chalk.yellow('MCP server is already running'));
      return;
    }
    
    this.server = http.createServer(this.handleRequest.bind(this));
    
    // Ensure the data directory exists for SQLite before starting
    const dbPath = this.documentStore.getDbPath();
    await fs.promises.mkdir(path.dirname(dbPath), { recursive: true });
    
    const serverStartPromise = new Promise<void>((resolve) => {
      this.server?.listen(this.options.port, () => {
        console.log(chalk.green(`✓ MCP server started on port ${this.options.port}`));
        this.emit('started', { port: this.options.port });
        resolve();
      });
    });
    
    // Start the server
    await serverStartPromise;
    
    // Note: We no longer automatically populate documentation for all plugins
    // Documentation will be loaded on-demand when needed
    
    return Promise.resolve();
  }
  
  /**
   * Populate documentation for specified plugins
   * @param pluginNames Array of plugin names to populate documentation for
   * @param force Whether to force re-population even if documentation exists
   * @returns Results of the population operations
   */
  public async populatePluginDocumentation(
    pluginNames: string[],
    force: boolean = false
  ): Promise<Record<string, {
    status: string;
    message: string;
    docId?: number;
    chunks?: number;
  }>> {
    console.log(`📚 MCP: Populating documentation for ${pluginNames.length} plugins`);
    
    const results: Record<string, {
      status: string;
      message: string;
      docId?: number;
      chunks?: number;
    }> = {};
    
    // Process plugins in batches to avoid overloading
    const batchSize = 5;
    let populated = 0;
    
    // Process plugins in smaller batches
    for (let i = 0; i < pluginNames.length; i += batchSize) {
      const batch = pluginNames.slice(i, i + batchSize);
      console.log(`📚 MCP: Processing documentation batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(pluginNames.length/batchSize)}`);
      
      // Process each plugin in the batch
      const batchPromises = batch.map(async (pluginName) => {
        try {
          // Check if we already have docs for this plugin
          const existingDocs = this.documentStore.getPluginDocuments(pluginName);
          
          if (existingDocs.length > 0 && !force) {
            console.log(`📚 MCP: Documentation for ${pluginName} already exists in database`);
            return {
              pluginName,
              result: {
                status: 'skipped',
                message: `Documentation for '${pluginName}' already exists`,
                docId: existingDocs[0]
              }
            };
          }
          
          // Fetch documentation
          console.log(`📚 MCP: Fetching documentation for ${pluginName}`);
          const docResponse = await this.fetchPluginDocumentation(pluginName);
          
          // Store in database
          const docId = await this.storeDocumentationInDatabase(pluginName, docResponse);
          
          console.log(`📚 MCP: Successfully populated documentation for ${pluginName}`);
          return {
            pluginName,
            result: {
              status: 'success',
              message: `Documentation for '${pluginName}' stored successfully`,
              docId,
              chunks: docResponse.content ? this.documentChunker.chunkMarkdown(docResponse.content).length : 0
            }
          };
        } catch (error) {
          console.error(`📚 MCP: Error populating ${pluginName} documentation: ${error instanceof Error ? error.message : String(error)}`);
          return {
            pluginName,
            result: {
              status: 'error',
              message: `Failed to populate documentation: ${error instanceof Error ? error.message : String(error)}`
            }
          };
        }
      });
      
      // Wait for batch to complete
      const batchResults = await Promise.all(batchPromises);
      
      // Store results
      for (const { pluginName, result } of batchResults) {
        results[pluginName] = result;
        if (result.status === 'success') {
          populated++;
        }
      }
      
      // Simple progress indication
      console.log(`📚 MCP: Populated ${populated} plugin documentations so far`);
      
      // Brief pause between batches to avoid overwhelming the server
      if (i + batchSize < pluginNames.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    console.log(`📚 MCP: Completed plugin documentation population (${populated}/${pluginNames.length} successful)`);
    return results;
  }
  
  /**
   * Populate documentation for common plugins
   * This is now a public method to be called manually when needed
   * @param force Whether to force re-population even if documentation exists
   */
  public async populateCommonPluginDocumentation(force: boolean = false): Promise<Record<string, any>> {
    console.log('📚 MCP: Starting population of common plugin documentation');
    
    try {
      // Get plugins from registry
      const plugins = await this.pluginRegistry.getPlugins();
      const pluginNames = Object.keys(plugins);
      
      if (pluginNames.length === 0) {
        console.log('📚 MCP: No plugins found in registry to populate');
        return {};
      }
      
      console.log(`📚 MCP: Found ${pluginNames.length} plugins in registry`);
      
      // Start with most common/important plugins first
      const priorityPlugins = [
        'ccxt', 'binance', 'coinbase', 'bittensor', 'exchange', 
        'technical-indicators', 'backtest', 'sentiment', 'news'
      ];
      
      // Prioritize the list - put priority plugins first, then alphabetical
      const sortedPlugins = [
        ...priorityPlugins.filter(p => pluginNames.includes(p) || pluginNames.includes(`plugin-${p}`)),
        ...pluginNames.filter(p => !priorityPlugins.includes(p) && !priorityPlugins.includes(p.replace('plugin-', '')))
      ];
      
      // Use the main population method
      return await this.populatePluginDocumentation(sortedPlugins, force);
    } catch (error) {
      console.error(`📚 MCP: Error in common plugin documentation population: ${error instanceof Error ? error.message : String(error)}`);
      return { error: String(error) };
    }
  }
  
  /**
   * Stop the MCP server
   */
  public async stop(): Promise<void> {
    if (!this.server) {
      console.log(chalk.yellow('MCP server is not running'));
      return Promise.resolve();
    }
    
    return new Promise((resolve, reject) => {
      this.server?.close((err) => {
        if (err) {
          console.error(chalk.red(`Failed to stop MCP server: ${err.message}`));
          reject(err);
          return;
        }
        
        this.server = null;
        console.log(chalk.green('✓ MCP server stopped'));
        this.emit('stopped');
        resolve();
      });
    });
  }
  
  /**
   * Get documentation based on a request
   */
  private async getDocumentation(request: DocRequest): Promise<DocResponse> {
    const { type, query, params } = request;
    
    // Try to get from in-memory cache first
    const cacheKey = `${type}:${query}:${JSON.stringify(params || {})}`;
    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey)!;
      const now = Date.now();
      
      // Check if cache is still valid
      if (now - cached.timestamp < this.options.cacheTtl) {
        console.log(`📚 MCP: Cache hit for ${type} - ${query}`);
        return cached;
      } else {
        console.log(`📚 MCP: Cache expired for ${type} - ${query}`);
        this.cache.delete(cacheKey);
      }
    }
    
    // Next, check if we have it in the SQLite database
    if (type === DocSourceType.PLUGIN) {
      // Look for the plugin documentation in our database
      const docIds = this.documentStore.getPluginDocuments(query);
      if (docIds.length > 0) {
        // We have documentation for this plugin in the database
        const doc = this.documentStore.getDocument(docIds[0]);
        if (doc) {
          console.log(`📚 MCP: Found documentation for ${query} in SQLite database`);
          const response: DocResponse = {
            content: doc.chunks.join('\n\n'),
            source: doc.metadata.source,
            timestamp: doc.metadata.timestamp,
            metadata: {
              ...doc.metadata,
              fromDatabase: true
            }
          };
          
          // Also update in-memory cache
          this.cache.set(cacheKey, response);
          
          // If a context is provided, optimize the documentation for relevance
          if (params?.context) {
            return this.optimizeDocumentationForContext(response, params.context, docIds[0]);
          }
          
          return response;
        }
      }
    }
    
    // Not found in cache or database, fetch from external source
    console.log(`📚 MCP: Fetching ${type} documentation for ${query} from external source`);
    let response: DocResponse;
    
    try {
      switch (type) {
      case DocSourceType.PLUGIN:
        response = await this.fetchPluginDocumentation(query, params);
        break;
      case DocSourceType.GITHUB:
        response = await this.fetchGithubDocumentation(query, params);
        break;
      case DocSourceType.GITHUB_REPO:
        response = await this.scanGithubRepository(query, params);
        break;
      case DocSourceType.URL:
        response = await this.fetchUrlDocumentation(query);
        break;
      case DocSourceType.MARKDOWN:
        response = await this.fetchMarkdownDocumentation(query);
        break;
      case DocSourceType.COMPETITION:
        response = await this.fetchCompetitionDocumentation(query);
        break;
      case DocSourceType.STRATEGY:
        response = await this.fetchStrategyDocumentation(query);
        break;
      case DocSourceType.CODE_ANALYSIS:
        response = await this.analyzeCode(query, params);
        break;
      default:
        throw new Error(`Unsupported documentation type: ${type}`);
      }
      
      // Store in cache
      this.cache.set(cacheKey, response);
      
      // Store in SQLite database if it's a plugin
      if (type === DocSourceType.PLUGIN && response) {
        const docId = await this.storeDocumentationInDatabase(query, response);
        
        // If a context is provided, optimize the documentation for relevance
        if (params?.context && docId) {
          return this.optimizeDocumentationForContext(response, params.context, docId);
        }
      } else if (params?.context) {
        // For non-plugin docs, still optimize if context is provided
        return this.optimizeDocumentationForContext(response, params.context);
      }
      
      return response;
    } catch (error) {
      console.error(`📚 MCP: Error fetching documentation: ${error instanceof Error ? error.message : String(error)}`);
      
      // For plugins, try to generate fallback doc if fetch fails
      if (type === DocSourceType.PLUGIN) {
        console.log(`📚 MCP: Generating fallback documentation for ${query}`);
        response = await this.generateFallbackPluginDocumentation(query);
        this.cache.set(cacheKey, response);
        
        // Also store the fallback documentation in the database
        const docId = await this.storeDocumentationInDatabase(query, response, true);
        
        // If a context is provided, optimize the documentation
        if (params?.context && docId) {
          return this.optimizeDocumentationForContext(response, params.context, docId);
        }
        
        return response;
      }
      
      throw error;
    }
  }
  
  /**
   * Store documentation in the SQLite database
   * @param pluginName Name of the plugin
   * @param doc The documentation response
   * @param isFallback Whether this is fallback documentation
   * @returns The document ID if stored, undefined otherwise
   */
  private async storeDocumentationInDatabase(
    pluginName: string, 
    doc: DocResponse, 
    isFallback: boolean = false
  ): Promise<number | undefined> {
    try {
      console.log(`📚 MCP: Storing documentation for ${pluginName} in database${isFallback ? ' (fallback)' : ''}`);
      
      // Check if we already have this documentation
      const existingDocs = this.documentStore.getPluginDocuments(pluginName);
      
      // Only store if we don't have it already or if the existing one is fallback and this is not
      if (existingDocs.length === 0 || 
          (isFallback === false && doc.metadata?.fromDatabase !== true)) {
        
        // Process and store the documentation
        const chunks = this.documentChunker.chunkMarkdown(doc.content);
        
        // Create document metadata
        const metadata: DocumentMetadata = {
          title: doc.metadata?.title || pluginName,
          source: doc.metadata?.source || doc.source,
          url: doc.metadata?.url || '',
          timestamp: doc.timestamp,
          plugin_name: pluginName,
          plugin_version: doc.metadata?.version || '1.0.0',
          doc_type: 'markdown'
        };
        
        // Store in SQLite
        const docId = this.documentStore.storeDocument(metadata, chunks);
        
        console.log(`📚 MCP: Stored documentation for '${pluginName}' with ID ${docId} (${chunks.length} chunks)`);
        
        // Generate embeddings for each chunk in the background
        this.generateEmbeddingsForDocument(docId, chunks).catch((err: unknown) => {
          console.error(`Failed to generate embeddings for document ${docId}: ${err instanceof Error ? err.message : String(err)}`);
        });
        
        return docId;
      } else {
        console.log(`📚 MCP: Documentation for '${pluginName}' already exists in database, skipping storage`);
        return existingDocs[0]; // Return the existing document ID
      }
    } catch (error) {
      console.error(`📚 MCP: Error storing documentation in database: ${error instanceof Error ? error.message : String(error)}`);
      // Don't throw here as this is a non-critical operation
      return undefined;
    }
  }
  
  /**
   * Optimize documentation content based on a user's context
   * @param doc The documentation to optimize
   * @param context User's context
   * @param documentId Optional document ID for vector search
   * @returns Optimized documentation
   */
  private async optimizeDocumentationForContext(
    doc: DocResponse, 
    context: string,
    documentId?: number
  ): Promise<DocResponse> {
    console.log(`📚 MCP: Optimizing documentation for context: "${context.substring(0, 50)}..."`);
    
    // If we have a document ID and it's in the database, use vector search for relevance
    if (documentId) {
      try {
        // Get the full document with all chunks
        const fullDoc = this.documentStore.getDocument(documentId);
        if (fullDoc) {
          // Generate embedding for the context query
          const contextEmbedding = await this.textEmbeddings.generateEmbedding(context);
          
          // If we have vector embeddings in the database, use them for search
          if (this.documentStore.getEmbeddingCount() > 0) {
            console.log('📚 MCP: Using vector search for document optimization');
            
            // Search for relevant chunks using the context embedding
            const relevantChunks = this.documentStore.searchByVector(contextEmbedding, 5);
            
            if (relevantChunks.length > 0) {
              // Filter to only include chunks from our document
              const docChunks = relevantChunks.filter(chunk => 
                chunk.document_id === documentId
              );
              
              if (docChunks.length > 0) {
                // Create optimized content
                const optimizedContent = docChunks
                  .map(chunk => chunk.content)
                  .join('\n\n');
                
                return {
                  ...doc,
                  content: optimizedContent,
                  metadata: {
                    ...doc.metadata,
                    optimizedForContext: true,
                    relevantChunksCount: docChunks.length,
                    optimizationMethod: 'vector'
                  }
                };
              }
            }
          }
          
          // Fallback to text similarity if vector search didn't yield results
          console.log('📚 MCP: Falling back to text similarity for optimization');
          
          // Use text similarity to find relevant chunks
          const relevantChunks = await this.textEmbeddings.findSimilarTexts(
            context,
            fullDoc.chunks,
            5
          );
          
          if (relevantChunks.length > 0) {
            // Create optimized content
            const optimizedContent = relevantChunks
              .map(result => result.text)
              .join('\n\n');
            
            return {
              ...doc,
              content: optimizedContent,
              metadata: {
                ...doc.metadata,
                optimizedForContext: true,
                relevantChunksCount: relevantChunks.length,
                optimizationMethod: 'text-similarity'
              }
            };
          }
        }
      } catch (error) {
        console.error(`📚 MCP: Error optimizing with vector search: ${error instanceof Error ? error.message : String(error)}`);
        // Fall back to traditional optimization
      }
    }
    
    // Fall back to the traditional chunk-based optimization approach
    console.log('📚 MCP: Using traditional chunk-based optimization');
    
    // Create chunks from the document content
    const chunks = this.createDocumentChunks(doc.content, doc.source);
    
    // Score chunks based on relevance to the context
    const scoredChunks = this.scoreChunksForRelevance(chunks, context);
    
    // Select most relevant chunks that fit within a reasonable size
    const selectedChunks = this.selectRelevantChunks(scoredChunks, 10000);
    
    // Combine selected chunks into a coherent document
    const optimizedContent = this.combineChunks(selectedChunks);
    
    return {
      ...doc,
      content: optimizedContent,
      metadata: {
        ...doc.metadata,
        optimizedForContext: true,
        relevantChunksCount: selectedChunks.length,
        optimizationMethod: 'traditional'
      }
    };
  }
  
  /**
   * Create chunks from a document content
   */
  private createDocumentChunks(content: string, source: string): DocumentChunk[] {
    // Split by headings or natural paragraphs
    const chunks: DocumentChunk[] = [];
    
    // Clean up content
    const cleanContent = content.replace(/\r\n/g, '\n');
    
    // Try to detect if this is markdown content
    const isMarkdown = source.includes('.md') || 
                        source.includes('markdown') || 
                        /^#+ /.test(cleanContent.trim().split('\n')[0]);
    
    if (isMarkdown) {
      // Split by markdown headings
      const headingRegex = /^#{1,6} .+$/gm;
      const headingMatches = [...cleanContent.matchAll(headingRegex)];
      
      if (headingMatches.length > 0) {
        let lastIndex = 0;
        
        for (let i = 0; i < headingMatches.length; i++) {
          const match = headingMatches[i];
          if (!match.index) continue;
          
          if (i > 0 && lastIndex < match.index) {
            // Add content between headings
            const sectionContent = cleanContent.substring(lastIndex, match.index).trim();
            if (sectionContent) {
              const heading = headingMatches[i-1][0];
              chunks.push({
                id: `${source}-${i-1}`,
                content: `${heading}\n\n${sectionContent}`,
                source
              });
            }
          }
          
          lastIndex = match.index;
        }
        
        // Don't forget the last section
        const lastSection = cleanContent.substring(lastIndex).trim();
        if (lastSection) {
          const heading = headingMatches[headingMatches.length-1][0];
          chunks.push({
            id: `${source}-${headingMatches.length-1}`,
            content: `${heading}\n\n${lastSection}`,
            source
          });
        }
      }
    }
    
    // If no chunks created yet, split by paragraphs
    if (chunks.length === 0) {
      const paragraphs = cleanContent
        .split(/\n\s*\n/)
        .filter(p => p.trim().length > 0);
      
      if (paragraphs.length > 1) {
        paragraphs.forEach((p, i) => {
          chunks.push({
            id: `${source}-p${i}`,
            content: p,
            source
          });
        });
      } else {
        // If no clear paragraphs, split by sentences or fixed size
        const sentences = cleanContent
          .replace(/([.!?])\s+/g, '$1\n')
          .split('\n')
          .filter(s => s.trim().length > 0);
        
        const chunkSize = 3; // Group sentences in chunks of 3
        
        for (let i = 0; i < sentences.length; i += chunkSize) {
          const chunkSentences = sentences.slice(i, i + chunkSize);
          chunks.push({
            id: `${source}-s${i}`,
            content: chunkSentences.join(' '),
            source
          });
        }
      }
    }
    
    // If still no chunks, create a single chunk from the entire content
    if (chunks.length === 0) {
      chunks.push({
        id: `${source}-full`,
        content: cleanContent,
        source
      });
    }
    
    return chunks;
  }
  
  /**
   * Score chunks for relevance to a context
   */
  private scoreChunksForRelevance(chunks: DocumentChunk[], context: string): DocumentChunk[] {
    // Normalize context for matching
    const normalizedContext = this.normalizeText(context);
    const contextWords = new Set(this.getSignificantWords(normalizedContext));
    
    // Clone chunks to avoid modifying originals
    const scoredChunks = [...chunks];
    
    // Score each chunk
    for (const chunk of scoredChunks) {
      const normalizedContent = this.normalizeText(chunk.content);
      const contentWords = this.getSignificantWords(normalizedContent);
      
      // Calculate word overlap
      let matchCount = 0;
      for (const word of contentWords) {
        if (contextWords.has(word)) {
          matchCount++;
        }
      }
      
      // Calculate relevance score (0-1)
      const overlapScore = contextWords.size > 0 ? matchCount / contextWords.size : 0;
      
      // Boost score for chunks with headings that match context
      const hasHeading = /^#{1,6} .+$/m.test(chunk.content);
      const headingBoost = hasHeading ? 0.2 : 0;
      
      // Calculate final score
      chunk.relevanceScore = Math.min(overlapScore + headingBoost, 1);
    }
    
    return scoredChunks;
  }
  
  /**
   * Normalize text for comparison
   */
  private normalizeText(text: string): string {
    return text.toLowerCase()
      .replace(/[^\w\s]/g, ' ') // Replace punctuation with spaces
      .replace(/\s+/g, ' ')     // Normalize whitespace
      .trim();
  }
  
  /**
   * Get significant words from text (filtering out common stop words)
   */
  private getSignificantWords(text: string): string[] {
    // Common English stop words to filter out
    const stopWords = new Set([
      'a', 'an', 'the', 'and', 'but', 'or', 'for', 'nor', 'on', 'at', 'to', 'by',
      'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'in', 'of', 'if', 'it', 'its', 'it\'s', 'this', 'that',
      'from', 'with', 'as', 'i', 'we', 'our', 'you', 'he', 'she', 'they',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'shall', 'should',
      'can', 'could', 'may', 'might', 'must'
    ]);
    
    return text.split(/\s+/)
      .filter(word => word.length > 1 && !stopWords.has(word))
      .map(word => word.toLowerCase());
  }
  
  /**
   * Select the most relevant chunks up to a maximum total size
   */
  private selectRelevantChunks(chunks: DocumentChunk[], maxTotalSize: number): DocumentChunk[] {
    let totalSize = 0;
    const selectedChunks = [];
    
    // Only include chunks with some relevance
    const relevantChunks = chunks.filter(chunk => (chunk.relevanceScore || 0) > 0.1);
    
    for (const chunk of relevantChunks) {
      const chunkSize = chunk.content.length;
      
      if (totalSize + chunkSize <= maxTotalSize) {
        selectedChunks.push(chunk);
        totalSize += chunkSize;
      } else {
        break;
      }
    }
    
    return selectedChunks;
  }
  
  /**
   * Combine chunks into a coherent document
   */
  private combineChunks(chunks: DocumentChunk[]): string {
    if (chunks.length === 0) {
      return '';
    }
    
    // Sort chunks to maintain original document order
    chunks.sort((a, b) => a.id.localeCompare(b.id));
    
    return chunks.map(chunk => chunk.content).join('\n\n');
  }
  
  /**
   * Fetch documentation for a plugin from GitHub or the registry
   */
  private async fetchPluginDocumentation(pluginName: string, params?: Record<string, string>): Promise<DocResponse> {
    console.log(`🔍 MCP: Fetching documentation for plugin: ${pluginName}`);
    
    // Check if we should use fallback right away
    const useFallback = params?.useFallback === 'true';
    if (useFallback) {
      console.log(`🔍 MCP: Using fallback documentation as requested for ${pluginName}`);
      return this.generateFallbackPluginDocumentation(pluginName);
    }
    
    try {
      // First, try to get the documentation from GitHub
      const githubDoc = await this.fetchPluginDocumentationFromGitHub(pluginName, params);
      if (githubDoc) {
        console.log(`✅ MCP: Found documentation for ${pluginName} on GitHub`);
        return githubDoc;
      }
      
      // If GitHub fails, try the docs website
      const docsWebsiteDoc = await this.fetchDocsWebsiteDocumentation(pluginName);
      if (docsWebsiteDoc) {
        console.log(`✅ MCP: Found documentation for ${pluginName} on docs website`);
        return docsWebsiteDoc;
      }
      
      // If both methods fail, attempt to generate fallback documentation
      return this.generateFallbackPluginDocumentation(pluginName);
    } catch (error) {
      console.error(`❌ MCP: Error fetching plugin documentation: ${error instanceof Error ? error.message : String(error)}`);
      
      // Return minimal fallback documentation
      return this.generateFallbackPluginDocumentation(pluginName);
    }
  }
  
  /**
   * Attempt to fetch plugin documentation from GitHub
   */
  private async fetchPluginDocumentationFromGitHub(pluginName: string, params?: Record<string, string>): Promise<DocResponse | null> {
    // Normalize the plugin name for GitHub search
    const normalizedName = pluginName.replace(/^@elizaos\//, '');
    console.log(`🔍 GITHUB: Looking for plugin documentation: ${normalizedName}`);
    
    // Common GitHub repository formats for Eliza plugins
    const possibleRepos = [
      `elizaos/${normalizedName}`,
      `elizaos/eliza-${normalizedName}`,
      `elizaos/plugin-${normalizedName}`
    ];
    
    for (const repo of possibleRepos) {
      try {
        console.log(`🔍 GITHUB: Trying repository: ${repo}`);
        const doc = await this.fetchGithubDocumentation(repo, params);
        return doc;
      } catch (error) {
        console.log(`🔍 GITHUB: Repository ${repo} not found or error: ${error instanceof Error ? error.message : String(error)}`);
        // Continue to the next possible repo
      }
    }
    
    console.log(`❌ GITHUB: No GitHub documentation found for ${pluginName}`);
    return null;
  }
  
  /**
   * Generate fallback documentation when no official docs are found
   */
  private async generateFallbackPluginDocumentation(pluginName: string): Promise<DocResponse> {
    console.log(`🔄 MCP: Generating fallback documentation for ${pluginName}`);
    
    // Normalize name
    const normalizedName = pluginName.replace(/^@elizaos\//, '');
    
    // Determine plugin type
    let pluginType = 'plugin';
    if (normalizedName.startsWith('adapter-')) {
      pluginType = 'adapter';
    } else if (normalizedName.startsWith('client-')) {
      pluginType = 'client';
    }
    
    // Generate basic documentation
    const content = `# ${pluginName}

## Overview
This is an Eliza ${pluginType}. No detailed documentation could be found.

## Installation
To install this ${pluginType}, use:
\`\`\`
npm install ${pluginName}
\`\`\`

## Basic Usage
To use this ${pluginType} in your Eliza project, you'll typically need to include it in your configuration:

\`\`\`javascript
// Example configuration (may vary based on the specific ${pluginType})
const config = {
  ${pluginType}s: {
    ${normalizedName.replace(/^(adapter-|client-|plugin-)/, '')}: {
      // Configuration options would go here
    }
  }
};
\`\`\`

## Additional Resources
- [Eliza Documentation](https://elizaos.github.io/eliza/)
- [GitHub Repository](https://github.com/elizaos)
`;

    return {
      content,
      source: `Generated fallback documentation for ${pluginName}`,
      timestamp: Date.now()
    };
  }
  
  /**
   * Fetch documentation from a GitHub repository
   */
  private async fetchGithubDocumentation(repoPath: string, params?: Record<string, string>): Promise<DocResponse> {
    try {
      const branch = params?.branch || 'main';
      const filePath = params?.path || 'README.md';
      
      // Convert GitHub URL to raw content URL
      const rawUrl = `https://raw.githubusercontent.com/${repoPath}/${branch}/${filePath}`;
      
      const response = await axios.get(rawUrl);
      const content = response.data;
      
      return {
        content,
        source: `github:${repoPath}/${filePath}`,
        timestamp: Date.now(),
        metadata: {
          repository: `https://github.com/${repoPath}`,
          branch,
          filePath,
        },
      };
    } catch (error) {
      console.error(`Failed to fetch GitHub documentation: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }
  
  /**
   * Fetch documentation from a URL
   */
  private async fetchUrlDocumentation(url: string): Promise<DocResponse> {
    try {
      // Determine if this is a GitHub URL to handle special cases
      const isGitHubUrl = url.includes('github.com');
      const isGitHubRaw = url.includes('raw.githubusercontent.com');
      
      // Set headers to mimic a browser request
      const headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      };
      
      // Fetch the content with a timeout and size limit
      const response = await axios.get(url, { 
        headers,
        maxContentLength: this.options.maxFileSizeBytes || 1024 * 1024, // Default to 1MB
        timeout: 10000 // 10 second timeout
      });
      
      // Process the content based on the response
      const extractionResult = await this.extractContentFromResponse(response, url);
      
      // Create metadata
      const metadata: Record<string, any> = {
        contentType: extractionResult.contentType,
        url: url,
        title: extractionResult.title || '',
        ...extractionResult.metadata
      };
      
      // For GitHub repositories, add repository info to metadata
      if (isGitHubUrl && !isGitHubRaw) {
        const repoInfo = this.extractGitHubRepoInfo(url);
        if (repoInfo) {
          metadata.repository = repoInfo;
        }
      }
      
      return {
        content: extractionResult.content,
        source: `url:${url}`,
        timestamp: Date.now(),
        metadata
      };
    } catch (error) {
      console.error(`Failed to fetch URL documentation: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }
  
  /**
   * Extract content from HTTP response based on content type
   */
  private async extractContentFromResponse(response: any, url: string): Promise<ContentExtractionResult> {
    // Get content type from headers
    const contentType = response.headers['content-type'] || '';
    const content = response.data;
    
    // Handle different content types
    if (contentType.includes('text/html')) {
      return this.extractContentFromHtml(content, url);
    } else if (contentType.includes('application/json')) {
      return {
        content: typeof content === 'string' ? content : JSON.stringify(content, null, 2),
        contentType: ContentType.JSON,
        metadata: { jsonKeys: Object.keys(content) }
      };
    } else if (contentType.includes('text/markdown') || url.endsWith('.md')) {
      return {
        content: typeof content === 'string' ? content : String(content),
        contentType: ContentType.MARKDOWN
      };
    } else if (this.isCodeFile(url)) {
      return {
        content: typeof content === 'string' ? content : String(content),
        contentType: ContentType.CODE,
        metadata: { language: this.detectLanguageFromUrl(url) }
      };
    } else {
      // Default to text
      return {
        content: typeof content === 'string' ? content : String(content),
        contentType: ContentType.TEXT
      };
    }
  }
  
  /**
   * Extract content from HTML
   */
  private extractContentFromHtml(html: string, url: string): ContentExtractionResult {
    try {
      // Use cheerio for lightweight HTML parsing
      const $ = cheerio.load(html);
      
      // Extract title
      const title = $('title').text() || '';
      
      // For GitHub repos, handle differently
      if (url.includes('github.com') && !url.includes('raw.githubusercontent.com')) {
        return this.extractGitHubContent($, url, title);
      }
      
      // For documentation sites, focus on main content
      const mainContent = this.extractMainContent($);
      
      // Extract all text
      const allText = mainContent || $('body').text();
      
      // Clean the text
      const cleanText = this.cleanText(allText);
      
      return {
        content: cleanText,
        contentType: ContentType.HTML,
        title,
        metadata: {
          headings: $('h1, h2, h3').map((_i: number, el: any) => $(el).text()).get(),
          links: $('a').map((_i: number, el: any) => ({
            text: $(el).text(),
            href: $(el).attr('href')
          })).get()
        }
      };
    } catch (error) {
      console.error(`Error parsing HTML: ${error instanceof Error ? error.message : String(error)}`);
      return {
        content: html,
        contentType: ContentType.TEXT
      };
    }
  }
  
  /**
   * Extract main content from HTML using heuristics
   */
  private extractMainContent($: cheerio.CheerioAPI): string {
    // Try common content containers
    const contentSelectors = [
      'article', 'main', '.main-content', '.content', 
      '.article', '.post-content', '.markdown-body',
      '#readme', '.documentation', '.docs-content'
    ];
    
    for (const selector of contentSelectors) {
      const element = $(selector);
      if (element.length > 0) {
        return element.text();
      }
    }
    
    // Fallback: find the element with the most text
    let maxTextElement = $('body');
    let maxTextLength = 0;
    
    $('div, section').each((_i: number, el: any) => {
      const text = $(el).text();
      if (text.length > maxTextLength) {
        maxTextLength = text.length;
        maxTextElement = $(el);
      }
    });
    
    return maxTextElement.text();
  }
  
  /**
   * Clean text by removing excess whitespace
   */
  private cleanText(text: string): string {
    return text
      .replace(/\s+/g, ' ')
      .replace(/\n+/g, '\n')
      .trim();
  }
  
  /**
   * Check if a URL points to a code file
   */
  private isCodeFile(url: string): boolean {
    const codeExtensions = [
      '.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.c', '.cpp', '.cs',
      '.go', '.rb', '.php', '.swift', '.kt', '.rs', '.sh', '.bash', '.json'
    ];
    
    return codeExtensions.some(ext => url.endsWith(ext));
  }
  
  /**
   * Detect programming language from URL
   */
  private detectLanguageFromUrl(url: string): string {
    const extensionMap: Record<string, string> = {
      '.js': 'javascript',
      '.ts': 'typescript',
      '.jsx': 'javascript',
      '.tsx': 'typescript',
      '.py': 'python',
      '.java': 'java',
      '.c': 'c',
      '.cpp': 'cpp',
      '.cs': 'csharp',
      '.go': 'go',
      '.rb': 'ruby',
      '.php': 'php',
      '.swift': 'swift',
      '.kt': 'kotlin',
      '.rs': 'rust',
      '.sh': 'bash',
      '.bash': 'bash',
      '.json': 'json',
    };
    
    const extension = url.substring(url.lastIndexOf('.'));
    return extensionMap[extension] || 'unknown';
  }
  
  /**
   * Extract GitHub specific content
   */
  private extractGitHubContent($: cheerio.CheerioAPI, url: string, title: string): ContentExtractionResult {
    // Extract README content
    const readmeContent = $('.markdown-body');
    
    if (readmeContent.length > 0) {
      return {
        content: readmeContent.text(),
        contentType: ContentType.MARKDOWN,
        title,
        metadata: {
          headings: readmeContent.find('h1, h2, h3').map((_i: number, el: any) => $(el).text()).get(),
          repository: this.extractGitHubRepoInfo(url)
        }
      };
    }
    
    // Extract code content
    const codeContent = $('.blob-wrapper');
    
    if (codeContent.length > 0) {
      return {
        content: codeContent.text(),
        contentType: ContentType.CODE,
        title,
        metadata: {
          language: $('.blob-code-inner').attr('data-lang') || this.detectLanguageFromUrl(url),
          repository: this.extractGitHubRepoInfo(url)
        }
      };
    }
    
    // Extract repository information (files, directories)
    const files: any[] = [];
    $('.js-navigation-container .js-navigation-item').each((_i: number, el: any) => {
      const nameEl = $(el).find('.js-navigation-open');
      const name = nameEl.text().trim();
      const href = nameEl.attr('href');
      const type = $(el).find('svg.octicon-file').length > 0 ? 'file' : 'directory';
      
      if (name && href) {
        files.push({
          name,
          path: href,
          type
        });
      }
    });
    
    if (files.length > 0) {
      return {
        content: `Repository: ${title}\n\nFiles and Directories:\n${files.map(f => `- ${f.name} (${f.type})`).join('\n')}`,
        contentType: ContentType.TEXT,
        title,
        metadata: {
          files,
          repository: this.extractGitHubRepoInfo(url)
        }
      };
    }
    
    // Default extraction
    return {
      content: $('body').text(),
      contentType: ContentType.TEXT,
      title
    };
  }
  
  /**
   * Extract GitHub repository information from URL
   */
  private extractGitHubRepoInfo(url: string): Record<string, string> | null {
    // Match GitHub URL pattern
    const repoMatch = url.match(/github\.com\/([^/]+)\/([^/]+)/);
    
    if (!repoMatch) {
      return null;
    }
    
    const [, owner, repo] = repoMatch;
    
    // Extract branch if present
    let branch = 'main';
    const branchMatch = url.match(/github\.com\/[^/]+\/[^/]+\/tree\/([^/]+)/);
    
    if (branchMatch) {
      branch = branchMatch[1];
    }
    
    return {
      owner,
      repo,
      branch,
      fullName: `${owner}/${repo}`
    };
  }
  
  /**
   * Fetch documentation from a local markdown file
   */
  private async fetchMarkdownDocumentation(filePath: string): Promise<DocResponse> {
    try {
      const fullPath = path.isAbsolute(filePath) 
        ? filePath 
        : path.join(this.options.docsBasePath || '', filePath);
      
      // Check if file exists
      if (!fs.existsSync(fullPath)) {
        throw new Error(`Markdown file not found: ${fullPath}`);
      }
      
      const content = await fs.promises.readFile(fullPath, 'utf-8');
      
      return {
        content,
        source: `markdown:${filePath}`,
        timestamp: Date.now(),
      };
    } catch (error) {
      console.error(`Failed to fetch markdown documentation: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }
  
  /**
   * Fetch competition documentation
   */
  private async fetchCompetitionDocumentation(competitionId: string): Promise<DocResponse> {
    // This would normally fetch competition details from an API
    // For now, we'll just use local files in the docs/competitions directory
    try {
      const competitionPath = path.join(this.options.docsBasePath || '', 'competitions', `${competitionId}.md`);
      
      // Check if file exists
      if (!fs.existsSync(competitionPath)) {
        throw new Error(`Competition documentation not found: ${competitionPath}`);
      }
      
      const content = await fs.promises.readFile(competitionPath, 'utf-8');
      
      return {
        content,
        source: `competition:${competitionId}`,
        timestamp: Date.now(),
      };
    } catch (error) {
      console.error(`Failed to fetch competition documentation: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }
  
  /**
   * Fetch strategy documentation
   */
  private async fetchStrategyDocumentation(strategyType: string): Promise<DocResponse> {
    // This would fetch strategy templates and best practices
    try {
      const strategyPath = path.join(this.options.docsBasePath || '', 'strategies', `${strategyType}.md`);
      
      // Check if file exists
      if (!fs.existsSync(strategyPath)) {
        throw new Error(`Strategy documentation not found: ${strategyPath}`);
      }
      
      const content = await fs.promises.readFile(strategyPath, 'utf-8');
      
      return {
        content,
        source: `strategy:${strategyType}`,
        timestamp: Date.now(),
      };
    } catch (error) {
      console.error(`Failed to fetch strategy documentation: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }
  
  /**
   * Scan a GitHub repository to understand its structure and code
   */
  private async scanGithubRepository(repoPath: string, params?: Record<string, string>): Promise<DocResponse> {
    try {
      console.log(`Found ${this.options.maxRepositoryFiles} files to scan in ${repoPath}`);
      
      // Extract owner and repo
      const [owner, repo] = repoPath.split('/');
      
      if (!owner || !repo) {
        throw new Error(`Invalid repository path: ${repoPath}. Expected format: "owner/repo"`);
      }
      
      // Get branch from params or default to main
      const branch = params?.branch || 'main';
      
      // Define headers for GitHub API
      const headers: Record<string, string> = {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'ElizaOS-MCP',
      };
      
      // Add GitHub token if available
      if (this.options.githubApiToken) {
        headers['Authorization'] = `token ${this.options.githubApiToken}`;
      }
      
      // Parse options
      const options: GithubScanOptions = {
        branch,
        fileTypes: params?.fileTypes ? params.fileTypes.split(',') : undefined,
        maxDepth: params?.maxDepth ? parseInt(params.maxDepth) : 3,
        maxFiles: params?.maxFiles ? parseInt(params.maxFiles) : this.options.maxRepositoryFiles || 100,
        includePatterns: params?.includePatterns ? params.includePatterns.split(',') : undefined,
        excludePatterns: params?.excludePatterns ? params.excludePatterns.split(',') : undefined,
        fetchContent: params?.fetchContent ? params.fetchContent === 'true' : true,
        includeDependencies: params?.includeDependencies ? params.includeDependencies === 'true' : true,
      };
      
      // List repository files
      const files = await this.listRepositoryFiles(repoPath, branch, options, headers);
      
      // Filter files based on options
      const filteredFiles = files.filter(file => {
        // Skip directories
        if (file.type === 'dir') return false;
        
        // Check file types
        if (options.fileTypes && options.fileTypes.length > 0) {
          const extension = file.name.substring(file.name.lastIndexOf('.'));
          if (!options.fileTypes.includes(extension)) return false;
        }
        
        // Check include patterns
        if (options.includePatterns && options.includePatterns.length > 0) {
          if (!options.includePatterns.some(pattern => file.path.includes(pattern))) return false;
        }
        
        // Check exclude patterns
        if (options.excludePatterns && options.excludePatterns.length > 0) {
          if (options.excludePatterns.some(pattern => file.path.includes(pattern))) return false;
        }
        
        return true;
      });
      
      // Fetch content for selected files (up to maxFiles)
      const filesToFetch = filteredFiles.slice(0, options.maxFiles);
      
      if (filesToFetch.length === 0) {
        return {
          content: `No matching files found in repository ${repoPath} with the given filters.`,
          source: `github_repo:${repoPath}`,
          timestamp: Date.now(),
          metadata: {
            repository: {
              owner,
              repo,
              branch
            },
            filesScanned: files.length,
            filesMatched: 0
          }
        };
      }
      
      // Fetch content if requested
      const fileContents: Record<string, string> = {};
      
      if (options.fetchContent) {
        for (const file of filesToFetch) {
          try {
            if (file.download_url) {
              const response = await axios.get(file.download_url, { headers });
              
              // Safely store the content - ensuring it's a string
              let content = response.data;
              if (typeof content !== 'string') {
                content = JSON.stringify(content, null, 2);
              }
              
              // Limit content size to avoid memory issues
              const maxLength = 50000; // 50KB max per file
              fileContents[file.path] = content.length > maxLength 
                ? content.substring(0, maxLength) + `\n... [${content.length - maxLength} more characters truncated]` 
                : content;
            }
          } catch (error) {
            console.warn(`Failed to fetch content for ${file.path}: ${error instanceof Error ? error.message : String(error)}`);
            fileContents[file.path] = '// Error: Failed to fetch content for this file';
          }
        }
      }
      
      // Build a file structure
      const fileStructure: Record<string, any> = {};
      
      for (const file of filesToFetch) {
        this.addToFileStructure(fileStructure, file.path, file);
      }
      
      // Check for package.json to understand dependencies
      let packageJson = null;
      try {
        const packageJsonFile = filesToFetch.find(f => f.path === 'package.json');
        if (packageJsonFile && fileContents[packageJsonFile.path]) {
          packageJson = JSON.parse(fileContents[packageJsonFile.path]);
        }
      } catch (error) {
        console.warn(`Failed to parse package.json: ${error instanceof Error ? error.message : String(error)}`);
      }
      
      // Generate a summary of the repository
      const repositorySummary = this.generateRepositorySummary(repoPath, fileStructure, packageJson);
      
      // Generate code documentation if content was fetched
      let codeDocumentation = '';
      if (options.fetchContent && Object.keys(fileContents).length > 0) {
        try {
          codeDocumentation = this.generateCodeDocumentation(fileContents);
        } catch (error) {
          console.warn(`Failed to generate code documentation: ${error instanceof Error ? error.message : String(error)}`);
          // Provide a basic fallback
          codeDocumentation = 'Code documentation generation failed. Please check the file contents directly.';
        }
      }
      
      // Combine information
      const content = `
# Repository: ${repoPath} (${branch})

${repositorySummary}

${codeDocumentation ? `## Code Documentation\n\n${codeDocumentation}` : ''}
`;
      
      return {
        content,
        source: `github_repo:${repoPath}`,
        timestamp: Date.now(),
        metadata: {
          repository: {
            owner,
            repo,
            branch
          },
          filesScanned: files.length,
          filesAnalyzed: filesToFetch.length,
          fileStructure: JSON.stringify(fileStructure),
          hasPackageJson: !!packageJson
        }
      };
    } catch (error) {
      console.error(`Failed to scan GitHub repository: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }
  
  /**
   * List all files in a repository (recursive)
   */
  private async listRepositoryFiles(
    repoPath: string, 
    branch: string, 
    options: GithubScanOptions, 
    headers: Record<string, string>,
    path = '',
    depth = 0
  ): Promise<GithubFileInfo[]> {
    if (depth > (options.maxDepth || 3)) {
      return [];
    }
    
    const apiUrl = path 
      ? `https://api.github.com/repos/${repoPath}/contents/${path}?ref=${branch}`
      : `https://api.github.com/repos/${repoPath}/contents?ref=${branch}`;
      
    const response = await axios.get(apiUrl, { headers });
    
    if (!Array.isArray(response.data)) {
      return [];
    }
    
    const files: GithubFileInfo[] = [];
    
    for (const item of response.data) {
      // Apply include/exclude patterns
      if (options.includePatterns && options.includePatterns.length > 0) {
        if (!options.includePatterns.some(pattern => item.path.includes(pattern))) {
          continue;
        }
      }
      
      if (options.excludePatterns && options.excludePatterns.length > 0) {
        if (options.excludePatterns.some(pattern => item.path.includes(pattern))) {
          continue;
        }
      }
      
      // For files, check file types
      if (item.type === 'file') {
        if (options.fileTypes && options.fileTypes.length > 0) {
          const ext = item.name.substring(item.name.lastIndexOf('.')).toLowerCase();
          if (!options.fileTypes.includes(ext) && !options.fileTypes.includes('*')) {
            continue;
          }
        }
        
        files.push(item);
      } else if (item.type === 'dir') {
        // Add the directory itself
        files.push(item);
        
        // Recursively get files from this directory
        const subFiles = await this.listRepositoryFiles(
          repoPath, 
          branch, 
          options, 
          headers, 
          item.path, 
          depth + 1
        );
        
        files.push(...subFiles);
      }
    }
    
    return files;
  }
  
  /**
   * Add a file path to the file structure object
   */
  private addToFileStructure(structure: Record<string, any>, filePath: string, fileInfo: any): void {
    const parts = filePath.split('/');
    let current = structure;
    
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      current[part] = current[part] || {};
      current = current[part];
    }
    
    const fileName = parts[parts.length - 1];
    current[fileName] = fileInfo;
  }
  
  /**
   * Render file structure as a tree
   */
  private renderFileStructure(structure: Record<string, any>, prefix = '', isLast = true): string {
    const keys = Object.keys(structure);
    if (keys.length === 0) return '';
    
    let result = '';
    
    keys.forEach((key, index) => {
      const isLastItem = index === keys.length - 1;
      const item = structure[key];
      
      // Add line for this item
      result += `${prefix}${isLast ? '└── ' : '├── '}${key}${item.type === 'dir' ? '/' : ''}\n`;
      
      // If it's a directory and has children, recurse
      if (item.type !== 'file' && Object.keys(item).filter(k => k !== 'type' && k !== 'url').length > 0) {
        const newPrefix = `${prefix}${isLast ? '    ' : '│   '}`;
        result += this.renderFileStructure(item, newPrefix, isLastItem);
      }
    });
    
    return result;
  }
  
  /**
   * Generate repository summary
   */
  private generateRepositorySummary(repoPath: string, fileStructure: Record<string, any>, packageJson: any): string {
    const countFilesByType = (structure: Record<string, any>) => {
      const counts: Record<string, number> = {};
      
      const traverse = (obj: Record<string, any>) => {
        if (!obj) return;
        
        Object.entries(obj).forEach(([key, value]) => {
          if (value && typeof value === 'object') {
            if (value.type === 'file') {
              const extension = key.includes('.') ? key.substring(key.lastIndexOf('.')) : 'unknown';
              counts[extension] = (counts[extension] || 0) + 1;
            } else {
              traverse(value);
            }
          }
        });
      };
      
      traverse(structure);
      return counts;
    };
    
    const fileCounts = countFilesByType(fileStructure);
    
    let summary = '## Repository Summary\n\n';
    
    // Add file counts by type
    summary += '### File Types\n\n';
    const fileTypes = Object.entries(fileCounts)
      .sort((a, b) => b[1] - a[1]) // Sort by count in descending order
      .map(([type, count]) => `- ${type}: ${count} file${count !== 1 ? 's' : ''}`)
      .join('\n');
    
    summary += fileTypes || 'No files analyzed.';
    
    // Add package.json info if available
    if (packageJson) {
      summary += '\n\n### Package Information\n\n';
      summary += `- Name: ${packageJson.name || 'unknown'}\n`;
      summary += `- Version: ${packageJson.version || 'unknown'}\n`;
      summary += `- Description: ${packageJson.description || 'No description'}\n`;
      
      // Add dependencies if available
      if (packageJson.dependencies && Object.keys(packageJson.dependencies).length > 0) {
        summary += '\n#### Dependencies\n\n';
        const dependencies = Object.entries(packageJson.dependencies)
          .map(([name, version]) => `- ${name}: ${version}`)
          .join('\n');
        summary += dependencies;
      }
      
      // Add dev dependencies if available
      if (packageJson.devDependencies && Object.keys(packageJson.devDependencies).length > 0) {
        summary += '\n\n#### Dev Dependencies\n\n';
        const devDependencies = Object.entries(packageJson.devDependencies)
          .map(([name, version]) => `- ${name}: ${version}`)
          .join('\n');
        summary += devDependencies;
      }
    }
    
    // Add file structure
    summary += '\n\n### File Structure\n\n';
    summary += '```\n';
    summary += this.renderFileStructure(fileStructure);
    summary += '```';
    
    return summary;
  }
  
  /**
   * Generate code documentation
   */
  private generateCodeDocumentation(fileContents: Record<string, string>): string {
    if (!fileContents || Object.keys(fileContents).length === 0) {
      return '';
    }
    
    let documentation = '';
    
    // Process main source files first (prefer src/index.ts if it exists)
    const mainFiles = Object.keys(fileContents).filter(path => 
      path.includes('index.ts') || 
      path.includes('index.js') || 
      path.includes('main.ts') || 
      path.includes('main.js')
    );
    
    // Then other source files
    const sourceFiles = Object.keys(fileContents).filter(path => 
      !mainFiles.includes(path) && 
      (path.endsWith('.ts') || path.endsWith('.js'))
    );
    
    // Then other files
    const otherFiles = Object.keys(fileContents).filter(path => 
      !mainFiles.includes(path) && 
      !sourceFiles.includes(path)
    );
    
    // Combine the files in priority order
    const orderedFiles = [...mainFiles, ...sourceFiles, ...otherFiles];
    
    // Limit to a reasonable number of files to avoid huge outputs
    const filesToDocument = orderedFiles.slice(0, 10);
    
    // Generate documentation for each file
    for (const filePath of filesToDocument) {
      try {
        const content = fileContents[filePath];
        
        if (!content || content.trim().length === 0) {
          continue;
        }
        
        documentation += `### File: ${filePath}\n\n`;
        
        // Add language hint for code blocks
        const language = this.getLanguageFromPath(filePath);
        
        // For source files, extract exports
        if (filePath.endsWith('.ts') || filePath.endsWith('.js')) {
          const exports = this.extractExports(content);
          
          if (exports.length > 0) {
            documentation += '#### Exports\n\n';
            for (const exp of exports) {
              documentation += `- **${exp.type}** \`${exp.name}\`: ${exp.description}\n`;
            }
            documentation += '\n';
          }
          
          // Add truncated file content (first 20 lines)
          documentation += '#### Content Preview\n\n';
          documentation += '```' + language + '\n';
          
          // Safely get the first 20 lines
          if (content) {
            const lines = content.split('\n');
            const previewLines = lines.slice(0, 20);
            documentation += previewLines.join('\n');
            
            if (lines.length > 20) {
              documentation += '\n// ... additional lines truncated ...\n';
            }
          } else {
            documentation += '// Content unavailable';
          }
          
          documentation += '\n```\n\n';
        } else if (filePath.endsWith('.md') || filePath.endsWith('.markdown')) {
          // For markdown files, include content directly
          // Trim if too long
          const maxLength = 2000;
          if (content && content.length > maxLength) {
            documentation += content.substring(0, maxLength) + '\n\n... (content truncated) ...\n\n';
          } else if (content) {
            documentation += content + '\n\n';
          } else {
            documentation += '(Empty or invalid content)\n\n';
          }
        } else {
          // For other files, add a preview
          documentation += '```' + language + '\n';
          
          // Safely get a content preview
          if (content) {
            const preview = content.length > 500 ? content.substring(0, 500) + '\n// ... (truncated) ...' : content;
            documentation += preview;
          } else {
            documentation += '// Content unavailable';
          }
          
          documentation += '\n```\n\n';
        }
      } catch (error) {
        console.warn(`Error documenting file ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
        documentation += `Error documenting file ${filePath}: ${error instanceof Error ? error.message : String(error)}\n\n`;
      }
    }
    
    // If there are more files that weren't documented, add a note
    if (orderedFiles.length > filesToDocument.length) {
      documentation += `\n_Note: ${orderedFiles.length - filesToDocument.length} additional files were not included in this documentation._\n`;
    }
    
    return documentation;
  }
  
  /**
   * Extract exports from TypeScript code
   */
  private extractExports(content: string): Array<{ type: string; name: string; description: string }> {
    const exports: Array<{ type: string; name: string; description: string }> = [];
    
    // Regular expressions to match common exports
    const classRegex = /export\s+(abstract\s+)?class\s+(\w+)/g;
    const interfaceRegex = /export\s+interface\s+(\w+)/g;
    const typeRegex = /export\s+type\s+(\w+)/g;
    const functionRegex = /export\s+(async\s+)?function\s+(\w+)/g;
    const constRegex = /export\s+const\s+(\w+)/g;
    const enumRegex = /export\s+enum\s+(\w+)/g;
    
    // Get JSDoc/comment for the export
    const getDescription = (line: number): string => {
      const lines = content.split('\n');
      let desc = '';
      
      // Look for comments above the line
      for (let i = line - 1; i >= 0; i--) {
        const textLine = lines[i].trim();
        if (textLine.startsWith('*') && !textLine.startsWith('*/')) {
          // Inside a JSDoc comment
          desc = textLine.replace(/^\*\s*/, '') + ' ' + desc;
        } else if (textLine.startsWith('/**')) {
          // Start of JSDoc
          break;
        } else if (textLine === '' || textLine.startsWith('//')) {
          // Skip blank lines and single line comments
          continue;
        } else {
          // No more comments
          break;
        }
      }
      
      return desc.trim();
    };
    
    // Match classes
    let match;
    while ((match = classRegex.exec(content)) !== null) {
      const lineNumber = content.substring(0, match.index).split('\n').length;
      exports.push({
        type: match[1] ? 'abstract class' : 'class',
        name: match[2],
        description: getDescription(lineNumber)
      });
    }
    
    // Match interfaces
    while ((match = interfaceRegex.exec(content)) !== null) {
      const lineNumber = content.substring(0, match.index).split('\n').length;
      exports.push({
        type: 'interface',
        name: match[1],
        description: getDescription(lineNumber)
      });
    }
    
    // Match types
    while ((match = typeRegex.exec(content)) !== null) {
      const lineNumber = content.substring(0, match.index).split('\n').length;
      exports.push({
        type: 'type',
        name: match[1],
        description: getDescription(lineNumber)
      });
    }
    
    // Match functions
    while ((match = functionRegex.exec(content)) !== null) {
      const lineNumber = content.substring(0, match.index).split('\n').length;
      exports.push({
        type: match[1] ? 'async function' : 'function',
        name: match[2],
        description: getDescription(lineNumber)
      });
    }
    
    // Match consts
    while ((match = constRegex.exec(content)) !== null) {
      const lineNumber = content.substring(0, match.index).split('\n').length;
      exports.push({
        type: 'const',
        name: match[1],
        description: getDescription(lineNumber)
      });
    }
    
    // Match enums
    while ((match = enumRegex.exec(content)) !== null) {
      const lineNumber = content.substring(0, match.index).split('\n').length;
      exports.push({
        type: 'enum',
        name: match[1],
        description: getDescription(lineNumber)
      });
    }
    
    return exports;
  }
  
  /**
   * Get language identifier from file path
   */
  private getLanguageFromPath(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    
    const languageMap: Record<string, string> = {
      '.js': 'javascript',
      '.jsx': 'jsx',
      '.ts': 'typescript',
      '.tsx': 'tsx',
      '.json': 'json',
      '.md': 'markdown',
      '.html': 'html',
      '.css': 'css',
      '.scss': 'scss',
      '.less': 'less',
      '.py': 'python',
      '.rb': 'ruby',
      '.java': 'java',
      '.c': 'c',
      '.cpp': 'cpp',
      '.h': 'c',
      '.hpp': 'cpp',
      '.go': 'go',
      '.rs': 'rust',
      '.php': 'php',
      '.sh': 'bash',
      '.yml': 'yaml',
      '.yaml': 'yaml',
      '.toml': 'toml',
    };
    
    return languageMap[ext] || '';
  }

  /**
   * Analyze code to provide insights about its structure and usage
   */
  private async analyzeCode(code: string, params?: Record<string, string>): Promise<DocResponse> {
    try {
      const language = params?.language || 'typescript';
      const fileName = params?.fileName || 'code.ts';
      
      // Simple analysis based on language
      let analysis = '';
      
      if (language === 'typescript' || language === 'javascript') {
        // Extract imports
        const imports: string[] = [];
        const importRegex = /import\s+(?:{[^}]+}|\*\s+as\s+\w+|\w+)\s+from\s+['"]([^'"]+)['"]/g;
        let match;
        while ((match = importRegex.exec(code)) !== null) {
          imports.push(match[1]);
        }
        
        // Extract exports
        const exports = this.extractExports(code);
        
        // Count functions
        const functionCount = (code.match(/function\s+\w+/g) || []).length;
        
        // Count classes
        const classCount = (code.match(/class\s+\w+/g) || []).length;
        
        // Count interfaces
        const interfaceCount = (code.match(/interface\s+\w+/g) || []).length;
        
        // Analyze complexity (very simple metric - just count control structures)
        const controlStructures = (code.match(/if|for|while|switch|catch/g) || []).length;
        
        analysis = `
## Code Analysis for ${fileName}

### Overview
- **Language**: ${language}
- **Size**: ${code.length} characters, ${code.split('\n').length} lines
- **Imports**: ${imports.length} (${imports.join(', ')})
- **Exported Items**: ${exports.length}
- **Functions**: ${functionCount}
- **Classes**: ${classCount}
- **Interfaces**: ${interfaceCount}
- **Complexity**: ${controlStructures} control structures

### Exported Items
${exports.map(exp => `- \`${exp.type}\` **${exp.name}**${exp.description ? `: ${exp.description}` : ''}`).join('\n')}

### Usage Examples
${this.generateUsageExamples(exports, language)}
`;
      } else {
        // Basic analysis for other languages
        analysis = `
## Code Analysis for ${fileName}

### Overview
- **Language**: ${language}
- **Size**: ${code.length} characters, ${code.split('\n').length} lines

No detailed analysis available for this language.
`;
      }
      
      return {
        content: analysis,
        source: `code_analysis:${fileName}`,
        timestamp: Date.now(),
        metadata: {
          language,
          fileName,
          size: code.length,
          lines: code.split('\n').length,
        },
      };
    } catch (error) {
      console.error(`Failed to analyze code: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }
  
  /**
   * Generate usage examples for exported items
   */
  private generateUsageExamples(exports: Array<{ type: string; name: string; description: string }>, language: string): string {
    if (exports.length === 0) {
      return 'No exports found to generate examples for.';
    }
    
    let examples = '';
    
    for (const exp of exports) {
      if (exp.type === 'class') {
        examples += `
#### Example usage of \`${exp.name}\` class:
\`\`\`${language}
// Import the class
import { ${exp.name} } from './path-to-module';

// Create an instance
const instance = new ${exp.name}();

// Use the instance
// (Add specific method calls based on class purpose)
\`\`\`
`;
      } else if (exp.type === 'function' || exp.type === 'async function') {
        examples += `
#### Example usage of \`${exp.name}\` function:
\`\`\`${language}
// Import the function
import { ${exp.name} } from './path-to-module';

// Call the function
${exp.type === 'async function' ? 'await ' : ''}${exp.name}();
\`\`\`
`;
      } else if (exp.type === 'interface' || exp.type === 'type') {
        examples += `
#### Example usage of \`${exp.name}\` ${exp.type}:
\`\`\`${language}
// Import the ${exp.type}
import { ${exp.name} } from './path-to-module';

// Use the ${exp.type} in a function parameter or variable declaration
const item: ${exp.name} = {
  // Add properties based on the interface/type
};
\`\`\`
`;
      }
    }
    
    return examples || 'No examples generated.';
  }
  
  /**
   * Convert GitHub URL to raw content URL
   */
  private convertGithubUrlToRaw(url: string): string {
    return url
      .replace('github.com', 'raw.githubusercontent.com')
      .replace('/blob/', '/');
  }
  
  /**
   * Scrape all plugin documentation URLs from the packages directory
   * This is used to build a mapping of plugin names to their documentation URLs
   */
  private async scrapePluginDocUrls(): Promise<Map<string, string>> {
    // The base URL for the Eliza documentation site
    const baseUrl = 'https://elizaos.github.io/eliza';
    const packagesBaseUrl = `${baseUrl}/packages/`;
    
    console.log(`🔍 DOCS SITE: Scraping plugin documentation URLs from ${packagesBaseUrl}`);
    
    const urlMapping = new Map<string, string>();
    
    try {
      // Fetch the packages directory
      console.log(`🔍 DOCS SITE: Sending request to ${packagesBaseUrl}`);
      const response = await axios.get(packagesBaseUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; RecallCLI/1.0)'
        },
        timeout: 10000 // 10 second timeout
      });
      console.log(`🔍 DOCS SITE: Received response with status ${response.status}`);
      
      // Debug: Show response headers
      console.log('🔍 DOCS SITE: Response headers:', JSON.stringify(response.headers, null, 2));
      
      if (response.headers['content-type']?.includes('text/html')) {
        // Add hardcoded known URLs to ensure we have the basics
        this.addKnownPluginUrls(urlMapping, baseUrl);
        
        const $ = cheerio.load(response.data);
        
        // Get all links from the page
        const links = $('a');
        
        // Extract all plugin links
        console.log(`🔍 DOCS SITE: Found ${links.length} links on packages page`);
        
        if (links.length === 0) {
          console.log('🔍 DOCS SITE: WARNING - No links found on the page. Here\'s the HTML:');
          console.log(response.data.substring(0, 500) + '...');
        }
        
        // Process subdirectories first to ensure they're done
        const subDirs: Array<{url: string, type: string}> = [];
        links.each((i, link) => {
          const href = $(link).attr('href');
          if (href === 'adapters/' || href === 'clients/') {
            subDirs.push({ url: packagesBaseUrl + href, type: href.replace('/', '') });
          }
        });
        
        // Process subdirectories in parallel
        console.log(`🔍 DOCS SITE: Processing ${subDirs.length} subdirectories`);
        const subDirPromises = subDirs.map(dir => 
          this.processSubdirectory(dir.url, dir.type, urlMapping).catch(error => {
            console.error(`🔍 DOCS SITE: Error processing subdirectory ${dir.type}: ${error instanceof Error ? error.message : String(error)}`);
          })
        );
        
        // Wait for all subdirectories to be processed
        await Promise.all(subDirPromises);
        
        // Add direct plugin URLs 
        links.each((i, link) => {
          const href = $(link).attr('href');
          
          if (href && href !== '../' && href !== './') {
            // Skip subdirectories as they've already been processed
            if (href === 'adapters/' || href === 'clients/') {
              return;
            }
            
            // Log each link to understand what we're processing
            console.log(`🔍 DOCS SITE: Examining plugin link: href="${href}"`);
            
            // Clean the URL (remove trailing slash)
            const cleanUrl = `${packagesBaseUrl}${href}`.replace(/\/$/, '');
            
            // Plugin URL pattern
            if (href.startsWith('plugin-')) {
              const pluginName = href.replace(/\/$/, '');
              urlMapping.set(pluginName, cleanUrl);
              urlMapping.set(`@elizaos/${pluginName}`, cleanUrl);
              console.log(`🔍 DOCS SITE: Mapped plugin "${pluginName}" → ${cleanUrl}`);
            }
          }
        });
        
        console.log(`🔍 DOCS SITE: Scraped ${urlMapping.size} plugin documentation URLs`);
      } else {
        console.error(`🔍 DOCS SITE: Response is not HTML: ${response.headers['content-type']}`);
      }
    } catch (error) {
      console.error(`🔍 DOCS SITE: Error scraping plugin documentation URLs: ${error instanceof Error ? error.message : String(error)}`);
      if (error instanceof Error && error.stack) {
        console.error(`Stack trace: ${error.stack}`);
      }
    }
    
    return urlMapping;
  }
  
  /**
   * Add hardcoded known plugin URLs to the mapping
   * This ensures we have at least the basic plugins covered
   */
  private addKnownPluginUrls(urlMapping: Map<string, string>, baseUrl: string): void {
    const packages = [
      // Adapters
      { name: 'adapter-sqlite', url: `${baseUrl}/packages/adapters/sqlite/` },
      { name: 'adapter-postgres', url: `${baseUrl}/packages/adapters/postgres/` },
      
      // Clients
      { name: 'client-auto', url: `${baseUrl}/packages/clients/auto/` },
      { name: 'client-direct', url: `${baseUrl}/packages/clients/direct/` },
      { name: 'client-discord', url: `${baseUrl}/packages/clients/discord/` },
      { name: 'client-telegram', url: `${baseUrl}/packages/clients/telegram/` },
      { name: 'client-twitter', url: `${baseUrl}/packages/clients/twitter/` },
      
      // Core plugins
      { name: 'core', url: `${baseUrl}/packages/core/` },
      { name: 'plugin-bootstrap', url: `${baseUrl}/packages/plugin-bootstrap/` },
      { name: 'plugin-image-generation', url: `${baseUrl}/packages/plugin-image-generation/` },
      { name: 'plugin-solana', url: `${baseUrl}/packages/plugin-solana/` },
      { name: 'plugin-starknet', url: `${baseUrl}/packages/plugin-starknet/` },
      { name: 'plugin-tee-log', url: `${baseUrl}/packages/plugin-tee-log/` },
      { name: 'plugin-coingecko', url: `${baseUrl}/packages/plugin-coingecko/` },
      { name: 'plugin-rabbi-trader', url: `${baseUrl}/packages/plugin-rabbi-trader/` }
    ];
    
    // Add each package with different naming formats
    for (const pkg of packages) {
      const { name, url } = pkg;
      
      // Base format
      urlMapping.set(name, url);
      
      // With @elizaos prefix
      urlMapping.set(`@elizaos/${name}`, url);
      
      // Handle specific package types
      if (name.startsWith('adapter-')) {
        const baseName = name.replace(/^adapter-/, '');
        urlMapping.set(baseName, url);
        urlMapping.set(`@elizaos/plugin-${name}`, url);
      } else if (name.startsWith('client-')) {
        const baseName = name.replace(/^client-/, '');
        urlMapping.set(baseName, url);
        urlMapping.set(`@elizaos/plugin-${name}`, url);
      } else if (name.startsWith('plugin-')) {
        const baseName = name.replace(/^plugin-/, '');
        urlMapping.set(baseName, url);
      }
    }
    
    console.log(`🔍 DOCS SITE: Added ${packages.length} known plugin URLs to mapping`);
  }
  
  private async processSubdirectory(dirUrl: string, dirType: string, urlMapping: Map<string, string>): Promise<void> {
    console.log(`🔍 DOCS SITE: Processing ${dirType} subdirectory at ${dirUrl}`);
    
    try {
      const response = await axios.get(dirUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; RecallCLI/1.0)'
        },
        timeout: 10000 // 10 second timeout
      });
      
      console.log(`🔍 DOCS SITE: Received response from ${dirType} directory with status ${response.status}`);
      
      if (response.headers['content-type']?.includes('text/html')) {
        const $ = cheerio.load(response.data);
        const links = $('a');
        
        console.log(`🔍 DOCS SITE: Found ${links.length} links in ${dirType} directory`);
        
        if (links.length === 0) {
          console.log(`🔍 DOCS SITE: WARNING - No links found in ${dirType} directory. Here's the HTML:`);
          console.log(response.data.substring(0, 500) + '...');
        }
        
        links.each((i, link) => {
          const href = $(link).attr('href');
          
          if (href && !href.startsWith('..') && !href.startsWith('./') && href !== './') {
            // This is a package in the subdirectory
            console.log(`🔍 DOCS SITE: Found ${dirType} package: ${href}`);
            
            // Clean the URL (remove trailing slash)
            const packageUrl = `${dirUrl}${href}`.replace(/\/$/, '');
            const packageName = href.replace(/\/$/, '');
            
            // Map different naming patterns
            if (dirType === 'adapters') {
              // adapter-[name]
              const adapterName = `adapter-${packageName}`;
              urlMapping.set(adapterName, packageUrl);
              urlMapping.set(`@elizaos/${adapterName}`, packageUrl);
              urlMapping.set(packageName, packageUrl);
              urlMapping.set(`@elizaos/plugin-${adapterName}`, packageUrl);
              console.log(`🔍 DOCS SITE: Mapped adapter "${adapterName}" → ${packageUrl}`);
            } else if (dirType === 'clients') {
              // client-[name]
              const clientName = `client-${packageName}`;
              urlMapping.set(clientName, packageUrl);
              urlMapping.set(`@elizaos/${clientName}`, packageUrl);
              urlMapping.set(packageName, packageUrl);
              urlMapping.set(`@elizaos/plugin-${clientName}`, packageUrl);
              console.log(`🔍 DOCS SITE: Mapped client "${clientName}" → ${packageUrl}`);
            }
          }
        });
      } else {
        console.error(`🔍 DOCS SITE: Response from ${dirType} directory is not HTML: ${response.headers['content-type']}`);
      }
    } catch (error) {
      console.error(`🔍 DOCS SITE: Failed to process ${dirType} subdirectory: ${error instanceof Error ? error.message : String(error)}`);
      if (error instanceof Error && error.stack) {
        console.error(`Stack trace: ${error.stack}`);
      }
    }
  }
  
  /**
   * Cache for the plugin documentation URLs
   * This is used to avoid scraping the packages directory for every request
   */
  private pluginDocUrlsCache: Map<string, string> | null = null;
  private pluginDocUrlsCacheTime: number = 0;
  private readonly PLUGIN_DOC_URLS_CACHE_TTL = 3600000; // 1 hour
  
  /**
   * Clear the plugin doc URL cache to force a fresh scrape
   */
  private clearPluginDocUrlsCache(): void {
    console.log('🔍 DOCS SITE: Clearing plugin documentation URL cache');
    this.pluginDocUrlsCache = null;
    this.pluginDocUrlsCacheTime = 0;
  }
  
  /**
   * Get the documentation URL for a plugin by name
   */
  private async getPluginDocUrl(pluginName: string): Promise<string | null> {
    // Force a fresh scrape for testing
    this.clearPluginDocUrlsCache();
    
    // Check if we need to refresh the cache or if it doesn't exist
    if (
      !this.pluginDocUrlsCache ||
      Date.now() - this.pluginDocUrlsCacheTime > this.PLUGIN_DOC_URLS_CACHE_TTL
    ) {
      console.log('🔍 DOCS SITE: Cache is stale or doesn\'t exist, fetching fresh plugin doc URLs');
      this.pluginDocUrlsCache = await this.scrapePluginDocUrls();
      this.pluginDocUrlsCacheTime = Date.now();
      
      // Debug: dump the URL mapping
      console.log('🔍 DOCS SITE: URL mapping entries:', this.pluginDocUrlsCache?.size || 0);
      if (this.pluginDocUrlsCache) {
        for (const [key, value] of this.pluginDocUrlsCache.entries()) {
          console.log(`   → ${key}: ${value}`);
        }
      }
    }
    
    // Try different variations of the plugin name to find a match
    const normalizedName = pluginName.startsWith('@') 
      ? pluginName.split('/')[1] 
      : pluginName;
    
    // Detect what type of package we're dealing with
    const isAdapter = normalizedName.includes('adapter') || normalizedName.startsWith('adapter-');
    const isClient = normalizedName.includes('client') || normalizedName.startsWith('client-');
    
    // Basic variations that apply to all types
    const possibleNames = [
      pluginName,
      normalizedName
    ];
    
    // Add type-specific variations
    if (isAdapter) {
      // Extract base name (removing adapter- prefix if it exists)
      const baseName = normalizedName.replace(/^adapter-/, '');
      
      possibleNames.push(
        `adapter-${baseName}`,
        `@elizaos/adapter-${baseName}`,
        baseName,
        // Common mistake formats
        `@elizaos/plugin-adapter-${baseName}`,
        `plugin-adapter-${baseName}`
      );
    } else if (isClient) {
      // Extract base name (removing client- prefix if it exists)
      const baseName = normalizedName.replace(/^client-/, '');
      
      possibleNames.push(
        `client-${baseName}`,
        `@elizaos/client-${baseName}`,
        baseName,
        // Common mistake formats
        `@elizaos/plugin-client-${baseName}`,
        `plugin-client-${baseName}`
      );
    } else {
      // Default to plugin variations if no specific type detected
      const baseName = normalizedName.replace(/^plugin-/, '');
      
      possibleNames.push(
        baseName,
        `plugin-${baseName}`,
        `@elizaos/plugin-${baseName}`
      );
    }
    
    console.log(`🔍 REGISTRY: Looking for plugin ${pluginName} in possible formats:`, possibleNames);
    
    // Try to find a match in the cache
    for (const name of possibleNames) {
      if (this.pluginDocUrlsCache.has(name)) {
        return this.pluginDocUrlsCache.get(name) || null;
      }
    }
    
    // Use fuzzy matching for plugin names if no exact match is found
    const bestMatch = this.findBestPluginNameMatch(pluginName, this.pluginDocUrlsCache);
    if (bestMatch) {
      console.log(`🔍 DOCS SITE: Using fuzzy match: ${pluginName} → ${bestMatch}`);
      return this.pluginDocUrlsCache.get(bestMatch) || null;
    }
    
    return null;
  }
  
  /**
   * Find the best matching plugin name from the available names
   * Uses a simple similarity score based on common substrings
   */
  private findBestPluginNameMatch(queryName: string, urlMapping: Map<string, string>): string | null {
    // Try exact match first
    if (urlMapping.has(queryName)) {
      console.log(`🔍 REGISTRY: Found exact match for ${queryName}`);
      return queryName;
    }
    
    // Remove @elizaos/ prefix if present for comparison
    const normalizedQuery = queryName.replace(/^@elizaos\//, '');
    
    // Check if normalized version exists
    if (urlMapping.has(normalizedQuery)) {
      console.log(`🔍 REGISTRY: Found match for normalized name ${normalizedQuery}`);
      return normalizedQuery;
    }
    
    // Define possible variations based on the query
    const possibleFormats: string[] = [queryName, normalizedQuery];
    
    // Handle adapter-* patterns
    if (queryName.includes('adapter-') || queryName.includes('adapter/')) {
      const baseName = normalizedQuery
        .replace(/^adapter-/, '')
        .replace(/^adapter\//, '');
      
      possibleFormats.push(`adapter-${baseName}`);
      possibleFormats.push(`@elizaos/adapter-${baseName}`);
      possibleFormats.push(`@elizaos/plugin-adapter-${baseName}`);
      possibleFormats.push(`plugin-adapter-${baseName}`);
      possibleFormats.push(baseName);
    }
    
    // Handle client-* patterns
    if (queryName.includes('client-') || queryName.includes('client/')) {
      const baseName = normalizedQuery
        .replace(/^client-/, '')
        .replace(/^client\//, '');
      
      possibleFormats.push(`client-${baseName}`);
      possibleFormats.push(`@elizaos/client-${baseName}`);
      possibleFormats.push(`@elizaos/plugin-client-${baseName}`);
      possibleFormats.push(`plugin-client-${baseName}`);
      possibleFormats.push(baseName);
    }
    
    // Handle plugin-* patterns
    if (queryName.includes('plugin-') || queryName.includes('plugin/')) {
      const baseName = normalizedQuery
        .replace(/^plugin-/, '')
        .replace(/^plugin\//, '');
      
      possibleFormats.push(`plugin-${baseName}`);
      possibleFormats.push(`@elizaos/plugin-${baseName}`);
      possibleFormats.push(baseName);
    }
    
    console.log(`🔍 REGISTRY: Looking for plugin ${queryName} in possible formats: ${JSON.stringify(possibleFormats, null, 2)}`);
    
    // Check each possible format
    for (const format of possibleFormats) {
      if (urlMapping.has(format)) {
        console.log(`🔍 REGISTRY: Found match with format: ${format}`);
        return format;
      }
    }
    
    // If no direct match, try fuzzy matching
    let bestMatch: string | null = null;
    let bestScore = 0;
    
    for (const key of urlMapping.keys()) {
      const score = this.calculateSimilarity(normalizedQuery, key);
      if (score > bestScore && score > 0.7) { // Threshold for fuzzy matching
        bestScore = score;
        bestMatch = key;
      }
    }
    
    if (bestMatch) {
      console.log(`🔍 REGISTRY: Found fuzzy match: ${bestMatch} (score: ${bestScore.toFixed(2)})`);
      return bestMatch;
    }
    
    console.log(`❌ REGISTRY: Plugin ${queryName} not found in registry`);
    return null;
  }
  
  /**
   * Calculate similarity between two strings using Levenshtein distance
   * @param a First string
   * @param b Second string
   * @returns Score between 0 and 1 where 1 is exact match
   */
  private calculateSimilarity(a: string, b: string): number {
    if (a === b) return 1.0;
    if (a.length === 0 || b.length === 0) return 0.0;
    
    // Normalize both strings
    const strA = a.toLowerCase().replace(/^@elizaos\//, '');
    const strB = b.toLowerCase().replace(/^@elizaos\//, '');
    
    // Simple substring check
    if (strA.includes(strB)) return 0.9 * (strB.length / strA.length);
    if (strB.includes(strA)) return 0.9 * (strA.length / strB.length);
    
    // Calculate Levenshtein distance
    const matrix: number[][] = [];
    
    // Initialize matrix
    for (let i = 0; i <= strA.length; i++) {
      matrix[i] = [i];
    }
    
    for (let j = 0; j <= strB.length; j++) {
      matrix[0][j] = j;
    }
    
    // Fill the matrix
    for (let i = 1; i <= strA.length; i++) {
      for (let j = 1; j <= strB.length; j++) {
        const cost = strA[i - 1] === strB[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,      // deletion
          matrix[i][j - 1] + 1,      // insertion
          matrix[i - 1][j - 1] + cost // substitution
        );
      }
    }
    
    // Calculate score (1 - normalized distance)
    const distance = matrix[strA.length][strB.length];
    const maxLength = Math.max(strA.length, strB.length);
    
    return 1 - (distance / maxLength);
  }
  
  /**
   * Fetch documentation from the elizaos.github.io website
   */
  private async fetchDocsWebsiteDocumentation(pluginName: string): Promise<DocResponse> {
    console.log(`🌐 DOCS SITE: Fetching documentation for ${pluginName}`);
    
    try {
      // Get the documentation URL for this plugin
      const docUrl = await this.getPluginDocUrl(pluginName);
      
      if (!docUrl) {
        console.error(`❌ DOCS SITE: No documentation URL found for ${pluginName}`);
        throw new Error(`No documentation URL found for ${pluginName}`);
      }
      
      console.log(`🌐 DOCS SITE: Attempting to fetch from ${docUrl}`);
      
      // Various URL formats to try
      const urlsToTry = [
        docUrl,                            // Base URL
        `${docUrl}/`,                      // With trailing slash
        `${docUrl}/index.html`,            // With index.html
        `${docUrl}/README.md`,             // With README.md
        `${docUrl}/docs/README.md`         // In docs folder
      ];
      
      // Try each URL until we get a successful response
      let response = null;
      let successfulUrl = null;
      
      for (const url of urlsToTry) {
        try {
          console.log(`🌐 DOCS SITE: Trying URL: ${url}`);
          response = await axios.get(url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (compatible; RecallCLI/1.0)'
            },
            timeout: 10000 // 10 second timeout
          });
          
          if (response.status === 200) {
            successfulUrl = url;
            console.log(`✅ DOCS SITE: Successfully fetched from ${url}`);
            break;
          }
        } catch (urlError) {
          console.log(`❌ DOCS SITE: Failed to fetch from ${url}: ${urlError instanceof Error ? urlError.message : String(urlError)}`);
          // Continue to next URL
        }
      }
      
      if (!response || !successfulUrl) {
        console.error(`❌ DOCS SITE: All URLs failed for ${pluginName}`);
        throw new Error(`Failed to fetch documentation for ${pluginName} from any URL`);
      }
      
      // Process the response based on content type
      const contentType = response.headers['content-type'] || '';
      
      if (contentType.includes('text/html')) {
        return this.processHtmlDocResponse(response, pluginName, successfulUrl);
      } else if (contentType.includes('text/markdown') || contentType.includes('text/plain') || successfulUrl.endsWith('.md')) {
        // Process markdown content
        return {
          content: response.data,
          source: successfulUrl,
          timestamp: Date.now()
        };
      } else {
        console.error(`❌ DOCS SITE: Unexpected content type: ${contentType}`);
        throw new Error(`Unexpected content type: ${contentType}`);
      }
    } catch (error) {
      console.error(`❌ DOCS SITE: Error fetching from docs website: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }
  
  /**
   * Process HTML documentation response
   */
  private async processHtmlDocResponse(response: AxiosResponse, pluginName: string, url: string): Promise<DocResponse> {
    // If we get HTML back, we need to extract the relevant content
    if (response.headers['content-type']?.includes('text/html')) {
      console.log('🌐 DOCS SITE: Processing HTML content...');
      const $ = cheerio.load(response.data);
      
      // Try to find the README content
      let content = '';
      
      // First, try to extract content from the main documentation area
      // Since this is a documentation site, look for specific content areas
      // Based on the screenshot, we should look for content within the main area
      const mainContent = $('main').html();
      if (mainContent) {
        console.log('🌐 DOCS SITE: Found content in <main> tag');
        content = mainContent;
      } else {
        // Try alternative selectors for content
        const articleContent = $('article').html();
        if (articleContent) {
          console.log('🌐 DOCS SITE: Found content in <article> tag');
          content = articleContent;
        } else {
          // Try to find a content div
          const contentDiv = $('.content, #content, .documentation, #documentation').html();
          if (contentDiv) {
            console.log('🌐 DOCS SITE: Found content in content div');
            content = contentDiv;
          } else {
            // Just grab the body as a last resort
            console.log('🌐 DOCS SITE: Falling back to body content');
            content = $('body').html() || response.data;
          }
        }
      }
      
      // If content is still empty, try a different approach
      if (!content) {
        console.log('🌐 DOCS SITE: No content found with primary selectors, trying alternative extraction');
        // Look for specific elements that might contain documentation
        const features = $('.features');
        if (features.length) {
          console.log('🌐 DOCS SITE: Found features section');
          content = features.html() || '';
        }
      }
      
      // Look for the README button and follow it if possible
      const readmeLink = $('a.readme-button, a:contains("README"), a[href*="README"], a[href*="readme"]').attr('href');
      if (readmeLink) {
        console.log(`🌐 DOCS SITE: Found README button with link: ${readmeLink}`);
        try {
          // Try to get the README content directly
          const readmeUrl = new URL(readmeLink, url).toString();
          console.log(`🌐 DOCS SITE: Following README link to: ${readmeUrl}`);
          
          const readmeResponse = await axios.get(readmeUrl);
          content = readmeResponse.data;
          console.log(`🌐 DOCS SITE: Successfully fetched README content (${content.length} bytes)`);
        } catch (readmeErr) {
          console.warn(`🌐 DOCS SITE: Failed to fetch README: ${readmeErr instanceof Error ? readmeErr.message : String(readmeErr)}`);
          // Fall back to the main page content
          content = $('main').html() || $('body').html() || response.data;
          console.log(`🌐 DOCS SITE: Using main page content as fallback (${content.length} bytes)`);
        }
      } else {
        // Just use the main content if no README link is found
        console.log('🌐 DOCS SITE: No README button found, using main content');
        content = $('main').html() || $('body').html() || response.data;
        console.log(`🌐 DOCS SITE: Extracted content length: ${content ? content.length : 0} bytes`);
      }
      
      // Normalize the plugin name
      const normalizedName = pluginName.startsWith('@') 
        ? pluginName.split('/')[1] 
        : pluginName;
      
      // Extract plugin metadata if available
      const name = $('h1').first().text() || normalizedName;
      
      console.log(`🌐 DOCS SITE: Successfully extracted documentation for ${name}`);
      return {
        content: this.cleanText(content),
        source: `docs:${pluginName}`,
        timestamp: Date.now(),
        metadata: {
          name: normalizedName,
          description: `Plugin documentation for ${normalizedName}`,
          url: url,
          category: 'plugins'
        }
      };
    } else {
      // Just return the raw content if it's not HTML
      console.log('🌐 DOCS SITE: Received non-HTML content, using as-is');
      
      // Normalize the plugin name
      const normalizedName = pluginName.startsWith('@') 
        ? pluginName.split('/')[1] 
        : pluginName;
      
      return {
        content: response.data,
        source: `docs:${pluginName}`,
        timestamp: Date.now(),
        metadata: {
          name: normalizedName,
          url: url
        }
      };
    }
  }
  
  /**
   * Handle incoming HTTP requests
   */
  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // Parse URL
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    // Handle OPTIONS request (CORS preflight)
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }
    
    // Handle different endpoints
    if (url.pathname === '/documentation' && req.method === 'GET') {
      // Simple query-based documentation request
      const query = url.searchParams.get('query') || '';
      const type = (url.searchParams.get('type') as DocSourceType) || DocSourceType.PLUGIN;
      const params = Object.fromEntries(url.searchParams.entries());
      
      try {
        const documentation = await this.getDocumentation({
          type,
          query,
          params,
        });
        
        res.setHeader('Content-Type', 'application/json');
        res.statusCode = 200;
        res.end(JSON.stringify(documentation));
      } catch (error) {
        res.statusCode = 500;
        res.end(JSON.stringify({ 
          error: `Failed to fetch documentation: ${error instanceof Error ? error.message : String(error)}` 
        }));
      }
    } else if (url.pathname === '/documentation' && req.method === 'POST') {
      // Handle POST request with full DocRequest body
      console.log('📝 SERVER: Received POST request to /documentation endpoint');
      let body = '';
      
      req.on('data', (chunk) => {
        body += chunk.toString();
      });
      
      req.on('end', async () => {
        try {
          console.log(`📝 SERVER: Processing POST body: ${body}`);
          const request = JSON.parse(body) as DocRequest;
          
          // Validate request
          if (!request.type || !request.query) {
            console.log('📝 SERVER: Invalid request - missing type or query');
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'Invalid request: missing type or query' }));
            return;
          }
          
          console.log(`📝 SERVER: Valid request, fetching documentation for ${request.type} - ${request.query}`);
          
          try {
            const documentation = await this.getDocumentation(request);
            
            console.log('📝 SERVER: Documentation fetched successfully, sending response');
            res.setHeader('Content-Type', 'application/json');
            res.statusCode = 200;
            res.end(JSON.stringify(documentation));
          } catch (docError) {
            console.error(`📝 SERVER: Error fetching documentation: ${docError instanceof Error ? docError.message : String(docError)}`);
            res.statusCode = 500;
            res.end(JSON.stringify({ 
              error: `Failed to fetch documentation: ${docError instanceof Error ? docError.message : String(docError)}` 
            }));
          }
        } catch (parseError) {
          console.error(`📝 SERVER: Error parsing request body: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
          res.statusCode = 400;
          res.end(JSON.stringify({ error: 'Invalid JSON in request body' }));
        }
      });
    } else if (url.pathname === '/query' && req.method === 'POST') {
      // Special endpoint for our test command
      console.log('📝 SERVER: Received POST request to /query endpoint (testing)');
      let body = '';
      
      req.on('data', (chunk) => {
        body += chunk.toString();
      });
      
      req.on('end', async () => {
        try {
          console.log(`📝 SERVER: Processing test query: ${body}`);
          const request = JSON.parse(body);
          
          if (!request.type || !request.query) {
            console.log('📝 SERVER: Invalid test request');
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'Invalid request' }));
            return;
          }
          
          console.log(`📝 SERVER: Processing test request for ${request.type} - ${request.query}`);
          let documentation;
          
          // Special case for testing - always generate fallback doc for specific flag
          if (request.params?.useFallback === 'true') {
            console.log('📝 SERVER: Using fallback documentation as requested');
            documentation = await this.generateFallbackPluginDocumentation(request.query);
          } else {
            try {
              documentation = await this.getDocumentation({
                type: request.type,
                query: request.query,
                params: request.params
              });
            } catch (error) {
              console.log('📝 SERVER: Error in test request, using fallback');
              documentation = await this.generateFallbackPluginDocumentation(request.query);
            }
          }
          
          console.log('📝 SERVER: Test documentation generated, sending response');
          res.setHeader('Content-Type', 'application/json');
          res.statusCode = 200;
          res.end(JSON.stringify(documentation));
        } catch (parseError) {
          console.error(`📝 SERVER: Error in test query: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
          res.statusCode = 500;
          res.end(JSON.stringify({ error: 'Test query failed' }));
        }
      });
    } else if (url.pathname === '/plugins') {
      // List available plugins
      try {
        // Get raw registry data directly
        const registryUrl = this.options.pluginRegistryUrl || 'https://raw.githubusercontent.com/elizaos/registry/main/index.json';
        const plugins: Record<string, any> = {};
        
        // Fetch data from registry URL
        try {
          console.log(`MCP Server: Fetching plugins from ${registryUrl}`);
          const response = await axios.get(registryUrl);
          const registryData = response.data;
          
          // If we got a simple key-value mapping (like what we see in the browser)
          if (registryData && typeof registryData === 'object') {
            console.log(`MCP Server: Processing ${Object.keys(registryData).length} plugins from registry`);
            
            // Transform the simple key-value mapping into our expected structure
            for (const [packageName, repoUrl] of Object.entries(registryData)) {
              // Extract plugin name from package name
              const pluginName = this.extractPluginNameFromPackage(packageName);
              const repoString = String(repoUrl);
              
              // Extract repo path from the github URL value
              const repoMatches = repoString.match(/github:(.+)/);
              if (!repoMatches) continue;
              
              const repoPath = repoMatches[1];
              const pluginClassName = pluginName.replace(/-./g, x => x[1].toUpperCase());
              
              // Create a valid PluginInfo object
              plugins[pluginName] = {
                name: pluginName,
                description: `Plugin for ${pluginName.replace(/-/g, ' ')}`,
                version: '1.0.0', // Default version
                author: 'Eliza Team',
                license: 'MIT',
                repository: `https://github.com/${repoPath}`,
                dependencies: {},
                requiredEnv: [],
                documentation: `https://github.com/${repoPath}#readme`,
                importStatement: `import { ${this.capitalizeFirstLetter(pluginClassName)} } from '@elizaos/${pluginName}';`
              };
            }
          } else {
            throw new Error('Unexpected registry data format');
          }
        } catch (error) {
          console.error(`MCP Server: Failed to fetch from registry: ${error instanceof Error ? error.message : String(error)}`);
          throw error;
        }
        
        // Send the processed plugins
        res.setHeader('Content-Type', 'application/json');
        res.statusCode = 200;
        res.end(JSON.stringify({ plugins }));
      } catch (error) {
        console.error(`MCP Server plugin endpoint error: ${error}`);
        res.statusCode = 500;
        res.end(JSON.stringify({ 
          error: `Failed to list plugins: ${error instanceof Error ? error.message : String(error)}` 
        }));
      }
    } else if (url.pathname === '/search') {
      // Enhanced search across documentation sources using SQLite and vector search
      const query = url.searchParams.get('query') || '';
      const limit = parseInt(url.searchParams.get('limit') || '5', 10);
      const pluginName = url.searchParams.get('plugin') || '';
      const useVector = url.searchParams.get('vector') !== 'false'; // Default to using vector search
      
      if (!query) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'Missing query parameter' }));
        return;
      }
      
      try {
        console.log(`📝 SERVER: Processing search request for '${query}'`);
        
        // First, try to find documents in our SQLite store
        let results: Array<{
          id: string;
          chunk_id?: string;
          content: string;
          title: string;
          source: string;
          score: number;
          relevance: number;
        }> = [];
        
        // If vector search is enabled, use it
        if (useVector) {
          console.log(`📝 SERVER: Using vector search for '${query}'`);
          
          // Generate embedding for the query
          const queryEmbedding = await this.textEmbeddings.generateEmbedding(query);
          
          // If we have a specific plugin name, filter results after search
          const vectorResults = this.documentStore.searchByVector(queryEmbedding, limit * 2);
          
          // Filter by plugin name if specified
          const filteredResults = pluginName 
            ? vectorResults.filter(doc => {
              // Get the plugin name from the document store
              const docDetails = this.documentStore.getDocument(doc.document_id);
              return docDetails?.metadata.plugin_name === pluginName;
            })
            : vectorResults;
          
          // Map to the expected format
          results = filteredResults.slice(0, limit).map(doc => ({
            id: doc.document_id.toString(),
            chunk_id: doc.chunk_id.toString(),
            content: doc.content,
            title: doc.title,
            source: doc.source,
            score: doc.similarity,
            relevance: doc.similarity
          }));
          
          console.log(`📝 SERVER: Vector search found ${results.length} results`);
        } else {
          // Fall back to keyword search
          // If we have a specific plugin name, search only that plugin's docs
          if (pluginName) {
            console.log(`📝 SERVER: Searching for '${query}' in plugin '${pluginName}'`);
            
            // Get all chunks for this plugin
            const docIds = this.documentStore.getPluginDocuments(pluginName);
            
            if (docIds.length > 0) {
              // Get the full documents with chunks
              const pluginDocs = docIds.map(id => this.documentStore.getDocument(id))
                .filter((doc): doc is { metadata: DocumentMetadata, chunks: string[] } => doc !== null);
              
              if (pluginDocs.length > 0) {
                // Flatten all chunks for vector search
                const allChunks = pluginDocs.flatMap(doc => doc.chunks);
                
                // Use vector search to find the most relevant chunks
                const vectorResults = await this.textEmbeddings.findSimilarTexts(query, allChunks, limit);
                
                // Map back to document format
                results = vectorResults.map(result => {
                  // Find which document this chunk belongs to
                  const chunkIndex = allChunks.indexOf(result.text);
                  let docIndex = 0;
                  let chunkOffset = 0;
                  
                  for (let i = 0; i < pluginDocs.length; i++) {
                    if (chunkOffset + pluginDocs[i].chunks.length > chunkIndex) {
                      docIndex = i;
                      break;
                    }
                    chunkOffset += pluginDocs[i].chunks.length;
                  }
                  
                  const doc = pluginDocs[docIndex];
                  
                  return {
                    id: String(docIds[docIndex]),
                    chunk_id: String(chunkIndex - chunkOffset),
                    content: result.text,
                    title: doc.metadata.title,
                    source: doc.metadata.source,
                    score: result.score,
                    relevance: result.score
                  };
                });
              }
            }
          } else {
            // Search across all documents
            console.log(`📝 SERVER: Searching for '${query}' across all documents`);
            
            // First try keyword search in SQLite
            const sqliteResults = this.documentStore.searchDocuments(query, limit * 2);
            
            if (sqliteResults.length > 0) {
              // Extract the text content from each result for vector search refinement
              const chunks = sqliteResults.map(doc => doc.content);
              
              // Use vector search to re-rank the results
              const vectorResults = await this.textEmbeddings.findSimilarTexts(query, chunks, limit);
              
              // Map back to document format with scores
              results = vectorResults.map(result => {
                const index = chunks.indexOf(result.text);
                const doc = sqliteResults[index];
                return {
                  id: doc.document_id.toString(),
                  chunk_id: doc.chunk_id.toString(),
                  content: doc.content,
                  title: doc.title,
                  source: doc.source,
                  score: result.score,
                  relevance: result.score
                };
              });
            }
          }
        }
        
        // If we don't have enough results from the document store, fall back to plugin registry search
        if (results.length < limit) {
          console.log('📝 SERVER: Not enough results from document store, falling back to plugin registry');
          
          // Get plugins that match the query
          const plugins = await this.pluginRegistry.getPlugins();
          const pluginResults = Object.values(plugins)
            .filter((plugin: any) => 
              plugin.name.includes(query) || 
              plugin.description.toLowerCase().includes(query.toLowerCase())
            )
            .slice(0, limit - results.length)
            .map((plugin: any) => ({
              id: `plugin-${plugin.name}`,
              content: plugin.description,
              title: plugin.name,
              source: 'plugin-registry',
              score: 0.5, // Default score for registry results
              relevance: 0.5
            }));
          
          // Combine results
          results = [...results, ...pluginResults];
        }
        
        console.log(`📝 SERVER: Returning ${results.length} search results`);
        
        res.setHeader('Content-Type', 'application/json');
        res.statusCode = 200;
        res.end(JSON.stringify({ 
          results,
          query,
          total: results.length
        }));
      } catch (error) {
        console.error(`📝 SERVER: Search error: ${error instanceof Error ? error.message : String(error)}`);
        res.statusCode = 500;
        res.end(JSON.stringify({ 
          error: `Failed to search: ${error instanceof Error ? error.message : String(error)}` 
        }));
      }
    } else if (url.pathname === '/analyze-code' && req.method === 'POST') {
      // Handle code analysis request
      let body = '';
      
      req.on('data', (chunk) => {
        body += chunk.toString();
      });
      
      req.on('end', async () => {
        try {
          const data = JSON.parse(body);
          
          if (!data.code) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'Missing code parameter' }));
            return;
          }
          
          const analysis = await this.analyzeCode(data.code, data.params || {});
          
          res.setHeader('Content-Type', 'application/json');
          res.statusCode = 200;
          res.end(JSON.stringify(analysis));
        } catch (error) {
          res.statusCode = 500;
          res.end(JSON.stringify({ 
            error: `Failed to analyze code: ${error instanceof Error ? error.message : String(error)}` 
          }));
        }
      });
    } else if (url.pathname === '/scan-repository') {
      // Repository scanning endpoint
      const repo = url.searchParams.get('repo');
      
      if (!repo) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'Missing repo parameter' }));
        return;
      }
      
      try {
        const params: Record<string, string> = {};
        
        // Transfer query parameters
        for (const [key, value] of url.searchParams.entries()) {
          if (key !== 'repo') {
            params[key] = value;
          }
        }
        
        const scan = await this.scanGithubRepository(repo, params);
        
        res.setHeader('Content-Type', 'application/json');
        res.statusCode = 200;
        res.end(JSON.stringify(scan));
      } catch (error) {
        res.statusCode = 500;
        res.end(JSON.stringify({ 
          error: `Failed to scan repository: ${error instanceof Error ? error.message : String(error)}` 
        }));
      }
    } else if (url.pathname === '/populate-docs' && req.method === 'POST') {
      // Endpoint to populate the document store with plugin documentation
      let body = '';
      
      req.on('data', (chunk) => {
        body += chunk.toString();
      });
      
      req.on('end', async () => {
        try {
          const request = JSON.parse(body);
          const pluginName = request.plugin;
          const force = request.force === true;
          
          if (!pluginName) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'Missing plugin parameter' }));
            return;
          }
          
          console.log(`📝 SERVER: Populating documentation for plugin '${pluginName}'`);
          
          try {
            // Check if we already have docs for this plugin
            const existingDocs = this.documentStore.getPluginDocuments(pluginName);
            
            if (existingDocs.length > 0 && !force) {
              console.log(`📝 SERVER: Documentation for '${pluginName}' already exists (${existingDocs.length} documents)`);
              res.statusCode = 200;
              res.end(JSON.stringify({ 
                status: 'skipped',
                message: `Documentation for '${pluginName}' already exists`,
                count: existingDocs.length
              }));
              return;
            }
            
            // Fetch documentation for the plugin
            const documentation = await this.getDocumentation({
              type: DocSourceType.PLUGIN,
              query: pluginName
            });
            
            if (!documentation || !documentation.content) {
              throw new Error(`No documentation found for plugin '${pluginName}'`);
            }
            
            // Process and store the documentation
            const chunks = this.documentChunker.chunkMarkdown(documentation.content);
            
            // Create document metadata
            const metadata: DocumentMetadata = {
              title: documentation.metadata?.title || pluginName,
              source: documentation.metadata?.source || 'plugin-docs',
              url: documentation.metadata?.url || '',
              timestamp: Date.now(),
              plugin_name: pluginName,
              plugin_version: documentation.metadata?.version || '1.0.0',
              doc_type: 'markdown'
            };
            
            // Store in SQLite
            const docId = this.documentStore.storeDocument(metadata, chunks);
            
            console.log(`📝 SERVER: Stored documentation for '${pluginName}' with ID ${docId} (${chunks.length} chunks)`);
            
            // Generate embeddings for each chunk in the background
            this.generateEmbeddingsForDocument(docId, chunks).catch((err: unknown) => {
              console.error(`Failed to generate embeddings for document ${docId}: ${err instanceof Error ? err.message : String(err)}`);
            });
            
            res.statusCode = 200;
            res.end(JSON.stringify({ 
              status: 'success',
              message: `Documentation for '${pluginName}' stored successfully`,
              document_id: docId,
              chunks: chunks.length
            }));
          } catch (docError) {
            console.error(`📝 SERVER: Error populating documentation: ${docError instanceof Error ? docError.message : String(docError)}`);
            res.statusCode = 500;
            res.end(JSON.stringify({ 
              error: `Failed to populate documentation: ${docError instanceof Error ? docError.message : String(docError)}` 
            }));
          }
        } catch (parseError) {
          console.error(`📝 SERVER: Error parsing request body: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
          res.statusCode = 400;
          res.end(JSON.stringify({ error: 'Invalid JSON in request body' }));
        }
      });
    } else if (url.pathname === '/doc-stats') {
      // Endpoint to get document statistics
      try {
        // Get document counts from the database
        const stats = {
          totalDocuments: 0,
          totalChunks: 0,
          totalEmbeddings: 0,
          pluginCounts: {} as Record<string, number>,
          lastUpdated: new Date().toISOString()
        };
        
        // Get counts from the document store
        stats.totalDocuments = this.documentStore.getDocumentCount();
        stats.totalChunks = this.documentStore.getChunkCount();
        stats.totalEmbeddings = this.documentStore.getEmbeddingCount();
        
        // Get plugin document counts
        const plugins = await this.pluginRegistry.getPlugins();
        for (const pluginName of Object.keys(plugins)) {
          const count = this.documentStore.getPluginDocuments(pluginName).length;
          if (count > 0) {
            stats.pluginCounts[pluginName] = count;
          }
        }
        
        // Calculate total documents from plugin counts
        stats.totalDocuments = Object.values(stats.pluginCounts).reduce((sum, count) => sum + count, 0);
        
        res.setHeader('Content-Type', 'application/json');
        res.statusCode = 200;
        res.end(JSON.stringify(stats));
      } catch (error) {
        console.error(`📝 SERVER: Error getting document stats: ${error instanceof Error ? error.message : String(error)}`);
        res.statusCode = 500;
        res.end(JSON.stringify({ 
          error: `Failed to get document stats: ${error instanceof Error ? error.message : String(error)}` 
        }));
      }
    } else if (url.pathname === '/health') {
      // Health check endpoint
      res.statusCode = 200;
      res.end(JSON.stringify({ status: 'ok' }));
    } else {
      // Not found
      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'Not found' }));
    }
  }

  /**
   * Capitalize the first letter of a string
   */
  private capitalizeFirstLetter(string: string): string {
    if (!string) return '';
    return string.charAt(0).toUpperCase() + string.slice(1);
  }

  private extractPluginNameFromPackage(packageName: string): string {
    // Handle both formats: @elizaos/plugin-name and plugin-name
    const matches = packageName.match(/@elizaos\/(.+)/);
    if (matches && matches[1]) {
      return matches[1];
    }
    return packageName;
  }

  /**
   * Generate embeddings for a document's chunks in the background
   * @param documentId The document ID
   * @param chunks Array of text chunks
   */
  private async generateEmbeddingsForDocument(documentId: number, chunks: string[]): Promise<void> {
    console.log(`📝 SERVER: Generating embeddings for document ${documentId} (${chunks.length} chunks)`);
    
    try {
      // Process each chunk
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        
        // Generate embedding
        const embedding = await this.textEmbeddings.generateEmbedding(chunk);
        
        // Store in database
        const embeddingId = this.documentStore.storeEmbedding(documentId, i, embedding);
        console.log(`Generated and stored embedding ${embeddingId} with ${embedding.size} dimensions`);
        
        // Log progress periodically
        if (i % 10 === 0 || i === chunks.length - 1) {
          console.log(`📝 SERVER: Generated embeddings for ${i + 1}/${chunks.length} chunks of document ${documentId}`);
        }
      }
      
      console.log(`📝 SERVER: Completed generating embeddings for document ${documentId}`);
    } catch (error: unknown) {
      console.error(`📝 SERVER: Error generating embeddings: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }
} 

/**
 * Start an MCP server with the given options and return the server instance
 */
export async function startMcpServer(options: Partial<McpServerOptions> = {}): Promise<McpServer> {
  const server = new McpServer(options);
  await server.start();
  return server;
}