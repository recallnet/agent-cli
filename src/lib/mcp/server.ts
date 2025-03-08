import http from 'http';
import chalk from 'chalk';
import { EventEmitter } from 'events';
import axios from 'axios';
import { PluginRegistry } from '../plugins/registry.js';
import * as path from 'path';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import * as cheerio from 'cheerio';

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
  
  constructor(options: Partial<McpServerOptions> = {}) {
    super();
    this.options = {
      port: options.port || Number(process.env.MCP_SERVER_PORT) || 3333,
      cacheTtl: options.cacheTtl || Number(process.env.MCP_CACHE_TTL) || 3600000, // 1 hour
      pluginRegistryUrl: options.pluginRegistryUrl || process.env.PLUGIN_REGISTRY_URL || 'https://registry.elizaos.com/plugins',
      docsBasePath: options.docsBasePath || process.env.DOCS_BASE_PATH || path.join(process.cwd(), 'docs'),
      githubApiToken: options.githubApiToken || process.env.GITHUB_API_TOKEN,
      maxFileSizeBytes: options.maxFileSizeBytes || Number(process.env.MAX_FILE_SIZE_BYTES) || 1024 * 1024, // 1MB
      maxRepositoryFiles: options.maxRepositoryFiles || Number(process.env.MAX_REPOSITORY_FILES) || 100,
    };
    
    // Initialize plugin registry
    this.pluginRegistry = new PluginRegistry(this.options.pluginRegistryUrl);
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
    
    return new Promise((resolve) => {
      this.server?.listen(this.options.port, () => {
        console.log(chalk.green(`✓ MCP server started on port ${this.options.port}`));
        this.emit('started', { port: this.options.port });
        resolve();
      });
    });
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
   * Get documentation from cache or fetch it
   */
  private async getDocumentation(request: DocRequest): Promise<DocResponse> {
    const cacheKey = `${request.type}:${request.query}:${JSON.stringify(request.params || {})}`;
    
    // Check cache first
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.options.cacheTtl) {
      this.emit('cache-hit', { request });
      return cached;
    }
    
    // Fetch documentation based on source type
    let docResponse: DocResponse;
    
    try {
      switch (request.type) {
      case DocSourceType.PLUGIN:
        docResponse = await this.fetchPluginDocumentation(request.query, request.params);
        break;
      case DocSourceType.GITHUB:
        docResponse = await this.fetchGithubDocumentation(request.query, request.params);
        break;
      case DocSourceType.GITHUB_REPO:
        docResponse = await this.scanGithubRepository(request.query, request.params);
        break;
      case DocSourceType.URL:
        docResponse = await this.fetchUrlDocumentation(request.query);
        break;
      case DocSourceType.MARKDOWN:
        docResponse = await this.fetchMarkdownDocumentation(request.query);
        break;
      case DocSourceType.COMPETITION:
        docResponse = await this.fetchCompetitionDocumentation(request.query);
        break;
      case DocSourceType.STRATEGY:
        docResponse = await this.fetchStrategyDocumentation(request.query);
        break;
      case DocSourceType.CODE_ANALYSIS:
        docResponse = await this.analyzeCode(request.query, request.params);
        break;
      default:
        throw new Error(`Unsupported documentation source type: ${request.type}`);
      }
      
      // Optimize the documentation content for relevance if a context is provided
      if (request.params?.context) {
        docResponse = await this.optimizeDocumentationForContext(docResponse, request.params.context);
      }
      
      // Cache the result
      this.cache.set(cacheKey, docResponse);
      this.emit('cache-miss', { request });
      
      return docResponse;
    } catch (error) {
      console.error(`Error fetching documentation: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }
  
  /**
   * Optimize documentation for a specific context
   */
  private async optimizeDocumentationForContext(doc: DocResponse, context: string): Promise<DocResponse> {
    try {
      // Create chunks from the document content
      const chunks = this.createDocumentChunks(doc.content, doc.source);
      
      // Calculate relevance scores for each chunk
      const scoredChunks = this.scoreChunksForRelevance(chunks, context);
      
      // Sort chunks by relevance score (highest first)
      scoredChunks.sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));
      
      // Take the most relevant chunks up to a reasonable size limit for context
      const relevantChunks = this.selectRelevantChunks(scoredChunks, 4000);
      
      // Combine the relevant chunks into a coherent document
      const optimizedContent = this.combineChunks(relevantChunks);
      
      // Return optimized document
      return {
        ...doc,
        content: optimizedContent,
        metadata: {
          ...doc.metadata,
          optimized: true,
          relevantChunksCount: relevantChunks.length,
          totalChunksCount: chunks.length
        }
      };
    } catch (error) {
      console.warn(`Error optimizing documentation: ${error instanceof Error ? error.message : String(error)}`);
      return doc; // Return original document if optimization fails
    }
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
   * Fetch plugin documentation
   */
  private async fetchPluginDocumentation(pluginName: string, params?: Record<string, string>): Promise<DocResponse> {
    try {
      // Get plugin info from registry
      const pluginInfo = await this.pluginRegistry.getPlugin(pluginName);
      
      if (!pluginInfo) {
        console.log(`Plugin ${pluginName} not found in registry, trying GitHub fallback`);
        
        // Try to find it on GitHub instead
        try {
          // If plugin name has a prefix like "plugin-", use it directly
          const repoName = pluginName.startsWith('plugin-') 
            ? pluginName 
            : `plugin-${pluginName}`;
            
          // First try elizaos-plugins organization
          // Pass extra parameters through the params object
          const githubParams = {
            path: 'README.md',
            branch: 'main',
            ...(params?.context ? { context: params.context } : {})
          };
          
          return await this.fetchGithubDocumentation(`elizaos-plugins/${repoName}`, githubParams);
        } catch (githubErr) {
          console.warn(`Failed to fetch from GitHub: ${githubErr instanceof Error ? githubErr.message : String(githubErr)}`);
          throw new Error(`Plugin ${pluginName} not found in registry or GitHub`);
        }
      }
      
      // Fetch README if available
      let readmeContent = '';
      if (pluginInfo.documentation) {
        try {
          // If documentation is a URL, fetch it
          if (pluginInfo.documentation.startsWith('http')) {
            // Convert GitHub URL to raw content URL if needed
            const readmeUrl = pluginInfo.documentation.includes('github.com') && pluginInfo.documentation.includes('#readme')
              ? this.convertGithubUrlToRaw(pluginInfo.documentation.replace('#readme', '/blob/main/README.md'))
              : pluginInfo.documentation;
            
            const response = await axios.get(readmeUrl);
            readmeContent = response.data;
          }
        } catch (readmeError) {
          console.warn(`Failed to fetch README for ${pluginName}: ${readmeError instanceof Error ? readmeError.message : String(readmeError)}`);
        }
      }
      
      // Combine plugin info and README content
      const content = `
# ${pluginInfo.name}

${pluginInfo.description}

## Version
${pluginInfo.version}

## Installation
\`\`\`bash
npm install ${pluginInfo.name}
\`\`\`

## Required Environment Variables
${pluginInfo.requiredEnv && pluginInfo.requiredEnv.length > 0
    ? pluginInfo.requiredEnv.map(env => `- \`${env}\``).join('\n')
    : 'No environment variables required.'}

## Dependencies
${pluginInfo.dependencies && Object.keys(pluginInfo.dependencies).length > 0
    ? Object.entries(pluginInfo.dependencies).map(([name, version]) => `- ${name}: ${version}`).join('\n')
    : 'No dependencies.'}

${readmeContent ? `## Documentation\n\n${readmeContent}` : ''}
`;
      
      return {
        content,
        source: `plugin:${pluginName}`,
        timestamp: Date.now(),
        metadata: pluginInfo,
      };
    } catch (error) {
      console.error(`Failed to fetch plugin documentation for ${pluginName}: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
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
      if (!existsSync(fullPath)) {
        throw new Error(`Markdown file not found: ${fullPath}`);
      }
      
      const content = await fs.readFile(fullPath, 'utf-8');
      
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
      if (!existsSync(competitionPath)) {
        throw new Error(`Competition documentation not found: ${competitionPath}`);
      }
      
      const content = await fs.readFile(competitionPath, 'utf-8');
      
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
      if (!existsSync(strategyPath)) {
        throw new Error(`Strategy documentation not found: ${strategyPath}`);
      }
      
      const content = await fs.readFile(strategyPath, 'utf-8');
      
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
      let body = '';
      
      req.on('data', (chunk) => {
        body += chunk.toString();
      });
      
      req.on('end', async () => {
        try {
          const request = JSON.parse(body) as DocRequest;
          
          // Validate request
          if (!request.type || !request.query) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'Invalid request: missing type or query' }));
            return;
          }
          
          const documentation = await this.getDocumentation(request);
          
          res.setHeader('Content-Type', 'application/json');
          res.statusCode = 200;
          res.end(JSON.stringify(documentation));
        } catch (error) {
          res.statusCode = 500;
          res.end(JSON.stringify({ 
            error: `Failed to fetch documentation: ${error instanceof Error ? error.message : String(error)}` 
          }));
        }
      });
    } else if (url.pathname === '/plugins') {
      // List available plugins
      try {
        const plugins = await this.pluginRegistry.getPlugins();
        
        res.setHeader('Content-Type', 'application/json');
        res.statusCode = 200;
        res.end(JSON.stringify({ plugins }));
      } catch (error) {
        res.statusCode = 500;
        res.end(JSON.stringify({ 
          error: `Failed to list plugins: ${error instanceof Error ? error.message : String(error)}` 
        }));
      }
    } else if (url.pathname === '/search') {
      // Simple search across documentation sources
      const query = url.searchParams.get('query') || '';
      
      if (!query) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'Missing query parameter' }));
        return;
      }
      
      try {
        // This is a very basic implementation - would need a proper search index in production
        // For now, just search plugin names and descriptions
        const plugins = await this.pluginRegistry.getPlugins();
        const results = Object.values(plugins).filter((plugin: any) => 
          plugin.name.includes(query) || 
          plugin.description.toLowerCase().includes(query.toLowerCase())
        );
        
        res.setHeader('Content-Type', 'application/json');
        res.statusCode = 200;
        res.end(JSON.stringify({ results }));
      } catch (error) {
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
} 