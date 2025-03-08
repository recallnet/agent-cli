import http from 'http';
import chalk from 'chalk';
import { EventEmitter } from 'events';
import axios from 'axios';
import { PluginRegistry } from '../plugins/registry.js';
import * as path from 'path';
import fs from 'fs/promises';
import { existsSync } from 'fs';

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
   * Fetch plugin documentation
   */
  private async fetchPluginDocumentation(pluginName: string, _params?: Record<string, string>): Promise<DocResponse> {
    try {
      // Get plugin info from registry
      const pluginInfo = await this.pluginRegistry.getPlugin(pluginName);
      
      if (!pluginInfo) {
        throw new Error(`Plugin ${pluginName} not found`);
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

## Author
${pluginInfo.author}

## License
${pluginInfo.license}

## Required Environment Variables
${pluginInfo.requiredEnv && pluginInfo.requiredEnv.length > 0 
    ? pluginInfo.requiredEnv.map((env: string) => `- ${env}`).join('\n')
    : 'None'}

## Dependencies
${Object.entries(pluginInfo.dependencies || {})
    .map(([dep, version]) => `- ${dep}: ${version}`)
    .join('\n')}

## Usage
\`\`\`typescript
${pluginInfo.importStatement}
\`\`\`

## Documentation
${readmeContent}
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
      const response = await axios.get(url);
      const content = response.data;
      
      return {
        content,
        source: `url:${url}`,
        timestamp: Date.now(),
      };
    } catch (error) {
      console.error(`Failed to fetch URL documentation: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
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
      // Parse repository parameters
      const branch = params?.branch || 'main';
      const options: GithubScanOptions = {
        branch,
        fileTypes: params?.fileTypes?.split(',') || ['.ts', '.js', '.json', '.md'],
        maxDepth: params?.maxDepth ? Number(params.maxDepth) : 3,
        maxFiles: params?.maxFiles ? Number(params.maxFiles) : this.options.maxRepositoryFiles,
        includePatterns: params?.includePatterns?.split(','),
        excludePatterns: params?.excludePatterns?.split(','),
        fetchContent: params?.fetchContent !== 'false',
        includeDependencies: params?.includeDependencies === 'true',
      };
      
      // Set up GitHub API headers
      const headers: Record<string, string> = {
        'Accept': 'application/vnd.github.v3+json',
      };
      
      if (this.options.githubApiToken) {
        headers['Authorization'] = `token ${this.options.githubApiToken}`;
      }
      
      // First, fetch the repository contents
      const apiUrl = `https://api.github.com/repos/${repoPath}/contents?ref=${branch}`;
      const response = await axios.get(apiUrl, { headers });
      
      if (!Array.isArray(response.data)) {
        throw new Error(`Expected array of files, got: ${typeof response.data}`);
      }
      
      // Get list of files to fetch
      const filesToFetch = await this.listRepositoryFiles(repoPath, branch, options, headers);
      console.log(`Found ${filesToFetch.length} files to scan in ${repoPath}`);
      
      // Fetch file contents if needed
      const fileContents: Record<string, string> = {};
      const fileStructure: Record<string, any> = {};
      
      if (options.fetchContent) {
        const maxFiles = Math.min(filesToFetch.length, options.maxFiles || this.options.maxRepositoryFiles || 100);
        
        for (let i = 0; i < maxFiles; i++) {
          const file = filesToFetch[i];
          
          if (file.type === 'file' && file.download_url) {
            try {
              // Only fetch files that are not too large
              if (!file.size || file.size <= (this.options.maxFileSizeBytes || 1024 * 1024)) {
                const contentResponse = await axios.get(file.download_url);
                fileContents[file.path] = contentResponse.data;
                
                // Add to file structure
                this.addToFileStructure(fileStructure, file.path, {
                  type: 'file',
                  size: file.size,
                  url: file.url,
                  download_url: file.download_url,
                });
              } else {
                console.warn(`Skipping large file: ${file.path} (${file.size} bytes)`);
                
                // Add to file structure but mark as too large
                this.addToFileStructure(fileStructure, file.path, {
                  type: 'file',
                  size: file.size,
                  url: file.url,
                  download_url: file.download_url,
                  skipped: 'File too large'
                });
              }
            } catch (error) {
              console.error(`Failed to fetch content for ${file.path}: ${error instanceof Error ? error.message : String(error)}`);
            }
          } else if (file.type === 'dir') {
            // Add directory to structure
            this.addToFileStructure(fileStructure, file.path, {
              type: 'dir',
              url: file.url
            });
          }
        }
      }
      
      // If this is a plugin repository, try to find package.json
      let packageJson = null;
      if (fileContents['package.json']) {
        try {
          packageJson = JSON.parse(fileContents['package.json']);
        } catch (error) {
          console.error(`Failed to parse package.json: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      
      // Generate summary of the repository
      const summary = this.generateRepositorySummary(repoPath, fileStructure, packageJson);
      
      // Generate code documentation
      const codeDocumentation = this.generateCodeDocumentation(fileContents);
      
      // Build response content
      const content = `
# GitHub Repository: ${repoPath}

## Repository Summary
${summary}

## File Structure
\`\`\`
${this.renderFileStructure(fileStructure)}
\`\`\`

## Code Documentation
${codeDocumentation}

## Package Information
${packageJson ? `
- **Name**: ${packageJson.name || 'N/A'}
- **Version**: ${packageJson.version || 'N/A'}
- **Description**: ${packageJson.description || 'N/A'}
- **Main**: ${packageJson.main || 'N/A'}
- **Author**: ${packageJson.author || 'N/A'}
- **License**: ${packageJson.license || 'N/A'}
- **Dependencies**: ${Object.keys(packageJson.dependencies || {}).length} dependencies
- **Dev Dependencies**: ${Object.keys(packageJson.devDependencies || {}).length} dev dependencies
` : 'No package.json found'}

## Files
${Object.keys(fileContents).map(filePath => `
### ${filePath}
\`\`\`${this.getLanguageFromPath(filePath)}
${fileContents[filePath]}
\`\`\`
`).join('\n')}
`;

      return {
        content,
        source: `github_repo:${repoPath}`,
        timestamp: Date.now(),
        metadata: {
          repository: `https://github.com/${repoPath}`,
          branch,
          fileCount: Object.keys(fileContents).length,
          fileStructure,
          packageJson
        },
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
   * Generate a summary of the repository
   */
  private generateRepositorySummary(repoPath: string, fileStructure: Record<string, any>, packageJson: any): string {
    // Count files by type
    const fileTypes: Record<string, number> = {};
    const countFilesByType = (structure: Record<string, any>) => {
      for (const key in structure) {
        const item = structure[key];
        if (item.type === 'file') {
          const ext = item.name.substring(item.name.lastIndexOf('.')).toLowerCase() || 'unknown';
          fileTypes[ext] = (fileTypes[ext] || 0) + 1;
        } else if (typeof item === 'object') {
          countFilesByType(item);
        }
      }
    };
    
    countFilesByType(fileStructure);
    
    // Generate file type stats
    const fileTypeList = Object.entries(fileTypes)
      .map(([ext, count]) => `- **${ext || 'No extension'}**: ${count} files`)
      .join('\n');
    
    return `
This is a GitHub repository located at https://github.com/${repoPath}.

${packageJson ? `
The repository appears to be a ${packageJson.description ? `${packageJson.description}` : 'JavaScript/TypeScript package'}.
` : ''}

### File Types:
${fileTypeList || 'No files found'}
`;
  }
  
  /**
   * Generate documentation from code files
   */
  private generateCodeDocumentation(fileContents: Record<string, string>): string {
    // Extract exported types, classes, functions from TypeScript files
    const typeScriptFiles = Object.entries(fileContents)
      .filter(([filePath]) => filePath.endsWith('.ts') || filePath.endsWith('.tsx'));
    
    if (typeScriptFiles.length === 0) {
      return 'No TypeScript files found to document.';
    }
    
    let documentation = '';
    
    for (const [filePath, content] of typeScriptFiles) {
      const exported = this.extractExports(content);
      if (exported.length > 0) {
        documentation += `\n### Exports from ${filePath}\n`;
        documentation += exported.map(exp => `- \`${exp.type}\` **${exp.name}**${exp.description ? `: ${exp.description}` : ''}`).join('\n');
        documentation += '\n';
      }
    }
    
    return documentation || 'No significant code exports found.';
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