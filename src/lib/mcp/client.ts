import axios from 'axios';
import { DocRequest, DocResponse, DocSourceType } from './server.js';

/**
 * MCP Client options
 */
export interface McpClientOptions {
  baseUrl: string;
  timeout?: number;
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
 * Code analysis options
 */
export interface CodeAnalysisOptions {
  language?: string;
  fileName?: string;
}

/**
 * MCP Client for retrieving documentation from the MCP server
 */
export class McpClient {
  private options: McpClientOptions;
  
  constructor(options: Partial<McpClientOptions> = {}) {
    this.options = {
      baseUrl: options.baseUrl || process.env.MCP_SERVER_URL || 'http://localhost:3333',
      timeout: options.timeout || Number(process.env.MCP_CLIENT_TIMEOUT) || 10000, // 10 seconds
    };
  }
  
  /**
   * Get documentation from the MCP server
   */
  async getDocumentation(request: DocRequest): Promise<DocResponse> {
    try {
      const response = await axios.post(`${this.options.baseUrl}/documentation`, request, {
        timeout: this.options.timeout,
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      return response.data as DocResponse;
    } catch (error) {
      console.error(`Failed to fetch documentation: ${error instanceof Error ? error.message : String(error)}`);
      throw new Error(`MCP client error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Get plugin documentation
   */
  async getPluginDocumentation(pluginName: string): Promise<DocResponse> {
    return this.getDocumentation({
      type: DocSourceType.PLUGIN,
      query: pluginName,
    });
  }
  
  /**
   * Get documentation from a GitHub repository
   */
  async getGithubDocumentation(repo: string, path = 'README.md', branch = 'main'): Promise<DocResponse> {
    return this.getDocumentation({
      type: DocSourceType.GITHUB,
      query: repo,
      params: {
        path,
        branch,
      },
    });
  }
  
  /**
   * Scan a GitHub repository to understand its structure and code
   */
  async scanGithubRepository(repo: string, options: GithubScanOptions = {}): Promise<DocResponse> {
    const params: Record<string, string> = {
      ...options.branch && { branch: options.branch },
      ...options.fileTypes && { fileTypes: options.fileTypes.join(',') },
      ...options.maxDepth !== undefined && { maxDepth: options.maxDepth.toString() },
      ...options.maxFiles !== undefined && { maxFiles: options.maxFiles.toString() },
      ...options.includePatterns && { includePatterns: options.includePatterns.join(',') },
      ...options.excludePatterns && { excludePatterns: options.excludePatterns.join(',') },
      ...options.fetchContent !== undefined && { fetchContent: options.fetchContent.toString() },
      ...options.includeDependencies !== undefined && { includeDependencies: options.includeDependencies.toString() },
    };
    
    return this.getDocumentation({
      type: DocSourceType.GITHUB_REPO,
      query: repo,
      params,
    });
  }
  
  /**
   * Get documentation from a URL
   */
  async getUrlDocumentation(url: string): Promise<DocResponse> {
    return this.getDocumentation({
      type: DocSourceType.URL,
      query: url,
    });
  }
  
  /**
   * Get documentation from a local markdown file
   */
  async getMarkdownDocumentation(filePath: string): Promise<DocResponse> {
    return this.getDocumentation({
      type: DocSourceType.MARKDOWN,
      query: filePath,
    });
  }
  
  /**
   * Get competition documentation
   */
  async getCompetitionDocumentation(competitionId: string): Promise<DocResponse> {
    return this.getDocumentation({
      type: DocSourceType.COMPETITION,
      query: competitionId,
    });
  }
  
  /**
   * Get strategy documentation
   */
  async getStrategyDocumentation(strategyType: string): Promise<DocResponse> {
    return this.getDocumentation({
      type: DocSourceType.STRATEGY,
      query: strategyType,
    });
  }
  
  /**
   * Analyze code to provide insights about its structure and usage
   */
  async analyzeCode(code: string, options: CodeAnalysisOptions = {}): Promise<DocResponse> {
    try {
      const response = await axios.post(`${this.options.baseUrl}/analyze-code`, {
        code,
        params: options,
      }, {
        timeout: this.options.timeout,
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      return response.data as DocResponse;
    } catch (error) {
      console.error(`Failed to analyze code: ${error instanceof Error ? error.message : String(error)}`);
      throw new Error(`MCP client analyze error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Scan a plugin's GitHub repository to help understand how to use it
   */
  async scanPluginRepository(pluginName: string, options: GithubScanOptions = {}): Promise<DocResponse> {
    try {
      // First, get the plugin info to locate the repository
      const pluginDoc = await this.getPluginDocumentation(pluginName);
      const pluginInfo = pluginDoc.metadata;
      
      if (!pluginInfo || !pluginInfo.repository) {
        throw new Error(`Could not find repository information for plugin ${pluginName}`);
      }
      
      // Extract GitHub repository path from URL
      // e.g., "https://github.com/elizaos-plugins/plugin-crypto-market-data" -> "elizaos-plugins/plugin-crypto-market-data"
      const repoUrl = pluginInfo.repository;
      const repoMatch = repoUrl.match(/github\.com\/([^/]+\/[^/]+)/);
      
      if (!repoMatch) {
        throw new Error(`Could not parse GitHub repository URL: ${repoUrl}`);
      }
      
      const repoPath = repoMatch[1];
      
      // Scan the repository
      return this.scanGithubRepository(repoPath, {
        branch: 'main',
        fileTypes: ['.ts', '.js', '.json', '.md'],
        maxDepth: 3,
        maxFiles: 20,
        fetchContent: true,
        includeDependencies: true,
        ...options,
      });
    } catch (error) {
      console.error(`Failed to scan plugin repository for ${pluginName}: ${error instanceof Error ? error.message : String(error)}`);
      throw new Error(`MCP client scan error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Get plugin usage examples based on repository code scan and analysis
   */
  async getPluginUsageExamples(pluginName: string): Promise<DocResponse> {
    try {
      // First, scan the plugin repository to understand its structure
      const scanResult = await this.scanPluginRepository(pluginName, {
        maxFiles: 10, // Limit to fewer files for faster processing
        includePatterns: ['src', 'examples', 'docs'],
      });
      
      // Get plugin documentation
      const pluginDoc = await this.getPluginDocumentation(pluginName);
      
      // Combine information to create targeted examples
      const content = `
# ${pluginName} Usage Examples

## Plugin Documentation
${pluginDoc.content}

## Repository Analysis
${scanResult.content}

## Code Examples

### Basic Usage
\`\`\`typescript
// Import the plugin
${pluginDoc.metadata?.importStatement || `import { PluginName } from '@elizaos-plugins/plugin-${pluginName}';`}

// Initialize the plugin
// (Add specific initialization based on plugin type)

// Use the plugin functionality
// (Add specific usage examples based on plugin purpose)
\`\`\`

### Integration with Recall Agent
\`\`\`typescript
// In your agent implementation
import { RecallAgent } from '@elizaos/recall-agent';
${pluginDoc.metadata?.importStatement || `import { PluginName } from '@elizaos-plugins/plugin-${pluginName}';`}

class MyTradingAgent extends RecallAgent {
  private plugin: any; // Replace with actual plugin type
  
  constructor() {
    super();
    // Initialize the plugin
    this.plugin = new ${pluginName.replace(/-./g, x => x[1].toUpperCase())}();
  }
  
  async run() {
    // Use the plugin in your trading logic
    // (Add specific usage examples based on plugin purpose)
  }
}
\`\`\`
`;
      
      return {
        content,
        source: `plugin_usage:${pluginName}`,
        timestamp: Date.now(),
        metadata: {
          pluginName,
          pluginInfo: pluginDoc.metadata,
          scanResult: scanResult.metadata,
        },
      };
    } catch (error) {
      console.error(`Failed to get plugin usage examples for ${pluginName}: ${error instanceof Error ? error.message : String(error)}`);
      throw new Error(`MCP client usage error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Search for plugins matching a query
   */
  async searchPlugins(query: string): Promise<any[]> {
    try {
      const response = await axios.get(`${this.options.baseUrl}/search`, {
        params: { query },
        timeout: this.options.timeout,
      });
      
      return response.data.results || [];
    } catch (error) {
      console.error(`Failed to search plugins: ${error instanceof Error ? error.message : String(error)}`);
      throw new Error(`MCP client search error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * List all available plugins
   */
  async listPlugins(): Promise<Record<string, any>> {
    try {
      const response = await axios.get(`${this.options.baseUrl}/plugins`, {
        timeout: this.options.timeout,
      });
      
      return response.data.plugins || {};
    } catch (error) {
      console.error(`Failed to list plugins: ${error instanceof Error ? error.message : String(error)}`);
      throw new Error(`MCP client list error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Check if the MCP server is healthy
   */
  async isHealthy(): Promise<boolean> {
    try {
      const response = await axios.get(`${this.options.baseUrl}/health`, {
        timeout: this.options.timeout,
      });
      
      return response.data.status === 'ok';
    } catch (error) {
      return false;
    }
  }
} 