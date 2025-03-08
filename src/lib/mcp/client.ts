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
 * Context generation options
 */
export interface ContextGenerationOptions {
  strategy?: string; // Strategy description
  competitionId?: string; // Competition ID
  tradingPairs?: string[]; // Trading pairs
  pluginNames?: string[]; // Plugin names
  timeframe?: string; // Timeframe
  questionOrTask?: string; // User's specific question or task
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
      console.log(`🌎 CLIENT: Sending documentation request to server for ${request.type} - ${request.query}`);
      console.log(`🌎 CLIENT: Request URL: ${this.options.baseUrl}/documentation`);
      console.log('🌎 CLIENT: Request params:', request.params);
      
      const response = await axios.post(`${this.options.baseUrl}/documentation`, request, {
        timeout: this.options.timeout,
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      console.log(`🌎 CLIENT: Received documentation response with status: ${response.status}`);
      return response.data as DocResponse;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response) {
        console.error(`🌎 CLIENT: Documentation request failed with status: ${error.response.status}`);
        console.error('🌎 CLIENT: Server response:', error.response.data);
      }
      console.error(`🌎 CLIENT: Failed to fetch documentation: ${error instanceof Error ? error.message : String(error)}`);
      throw new Error(`MCP client error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Get plugin documentation
   */
  async getPluginDocumentation(pluginName: string, context?: string): Promise<DocResponse> {
    // Ensure we're using the correct namespace format
    // If it already starts with @, assume it's already in the right format
    // Otherwise, add the correct namespace
    const formattedPluginName = pluginName.startsWith('@') 
      ? pluginName 
      : pluginName.startsWith('plugin-')
        ? `@elizaos/${pluginName}`
        : `@elizaos/plugin-${pluginName}`;
    
    console.log(`🔌 CLIENT: Requesting documentation for plugin: ${formattedPluginName}`);
    
    try {
      const response = await this.getDocumentation({
        type: DocSourceType.PLUGIN,
        query: formattedPluginName,
        ...(context ? { context } : {})
      });
      
      console.log(`✅ CLIENT: Successfully received documentation for ${formattedPluginName}`);
      return response;
    } catch (error) {
      console.error(`❌ CLIENT: Failed to get documentation for plugin ${formattedPluginName}: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }
  
  /**
   * Get documentation from a GitHub repository
   */
  async getGithubDocumentation(repo: string, path = 'README.md', branch = 'main', context?: string): Promise<DocResponse> {
    return this.getDocumentation({
      type: DocSourceType.GITHUB,
      query: repo,
      params: {
        path,
        branch,
        ...(context ? { context } : {})
      },
    });
  }
  
  /**
   * Scan a GitHub repository to understand its structure and code
   */
  async scanGithubRepository(repo: string, options: GithubScanOptions = {}, context?: string): Promise<DocResponse> {
    const params: Record<string, string> = {
      ...options.branch && { branch: options.branch },
      ...options.fileTypes && { fileTypes: options.fileTypes.join(',') },
      ...options.maxDepth !== undefined && { maxDepth: options.maxDepth.toString() },
      ...options.maxFiles !== undefined && { maxFiles: options.maxFiles.toString() },
      ...options.includePatterns && { includePatterns: options.includePatterns.join(',') },
      ...options.excludePatterns && { excludePatterns: options.excludePatterns.join(',') },
      ...options.fetchContent !== undefined && { fetchContent: options.fetchContent.toString() },
      ...options.includeDependencies !== undefined && { includeDependencies: options.includeDependencies.toString() },
      ...(context ? { context } : {})
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
  async getUrlDocumentation(url: string, context?: string): Promise<DocResponse> {
    return this.getDocumentation({
      type: DocSourceType.URL,
      query: url,
      params: context ? { context } : undefined
    });
  }
  
  /**
   * Get documentation from a local markdown file
   */
  async getMarkdownDocumentation(filePath: string, context?: string): Promise<DocResponse> {
    return this.getDocumentation({
      type: DocSourceType.MARKDOWN,
      query: filePath,
      params: context ? { context } : undefined
    });
  }
  
  /**
   * Get competition documentation
   */
  async getCompetitionDocumentation(competitionId: string, context?: string): Promise<DocResponse> {
    return this.getDocumentation({
      type: DocSourceType.COMPETITION,
      query: competitionId,
      params: context ? { context } : undefined
    });
  }
  
  /**
   * Get strategy documentation
   */
  async getStrategyDocumentation(strategyType: string, context?: string): Promise<DocResponse> {
    return this.getDocumentation({
      type: DocSourceType.STRATEGY,
      query: strategyType,
      params: context ? { context } : undefined
    });
  }
  
  /**
   * Analyze code to provide insights about its structure and usage
   */
  async analyzeCode(code: string, options: CodeAnalysisOptions = {}, context?: string): Promise<DocResponse> {
    try {
      const params = {
        ...options,
        ...(context ? { context } : {})
      };
      
      const response = await axios.post(`${this.options.baseUrl}/analyze-code`, {
        code,
        params
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
  async scanPluginRepository(pluginName: string, options: GithubScanOptions = {}, context?: string): Promise<DocResponse> {
    try {
      // Prepare the repository path (assuming GitHub organization by default)
      let repoPath: string;
      
      // Handle if the plugin name is the full package name (with @elizaos/)
      if (pluginName.startsWith('@elizaos/')) {
        const pluginNameWithoutPrefix = pluginName.replace('@elizaos/', '');
        repoPath = `elizaos/${pluginNameWithoutPrefix}`;
      } 
      // Handle if the plugin name is already a full GitHub path
      else if (pluginName.includes('/') && !pluginName.startsWith('@')) {
        repoPath = pluginName;
      } 
      // Default case: convert plugin name to GitHub repo path
      else {
        const repoName = pluginName.startsWith('plugin-') ? pluginName : `plugin-${pluginName}`;
        repoPath = `elizaos/${repoName}`;
      }
      
      console.log(`Scanning repository: ${repoPath}`);
      
      return await this.scanGithubRepository(repoPath, options, context);
    } catch (error) {
      console.error(`Error scanning plugin repository: ${error instanceof Error ? error.message : String(error)}`);
      return {
        content: `Error scanning plugin repository: ${error instanceof Error ? error.message : String(error)}`,
        source: `plugin:${pluginName}`,
        timestamp: Date.now()
      };
    }
  }
  
  /**
   * Get plugin usage examples based on repository code scan and analysis
   */
  async getPluginUsageExamples(pluginName: string, context?: string): Promise<DocResponse> {
    try {
      // Create specific context for usage examples
      const usageContext = context ? 
        `${context} Code examples, usage patterns, and implementation samples.` :
        `Examples of how to use ${pluginName} plugin. Code samples, integration patterns, and best practices.`;
      
      // First, scan the plugin repository to understand its structure
      const scanResult = await this.scanPluginRepository(pluginName, {
        maxFiles: 10, // Limit to fewer files for faster processing
        includePatterns: ['src', 'examples', 'docs'],
      }, usageContext);
      
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
${pluginDoc.metadata?.importStatement || `import { PluginName } from '@elizaos/plugin-${pluginName}';`}

async function exampleUsage() {
  // Example usage of the plugin
  const plugin = new PluginName({
    // Configuration options
    apiKey: 'your-api-key',
    secret: 'your-secret'
  });
  
  // Example method calls
  const result = await plugin.someMethod();
  console.log(result);
}
\`\`\`
`;
      
      return {
        content,
        source: `plugin-examples:${pluginName}`,
        timestamp: Date.now(),
        metadata: {
          plugin: pluginName,
          repository: scanResult.metadata?.repository
        }
      };
    } catch (error) {
      console.error(`Failed to get plugin usage examples for ${pluginName}: ${error instanceof Error ? error.message : String(error)}`);
      throw new Error(`MCP client examples error: ${error instanceof Error ? error.message : String(error)}`);
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
      console.log(`MCP Client: Requesting plugins from ${this.options.baseUrl}/plugins`);
      const response = await axios.get(`${this.options.baseUrl}/plugins`, {
        timeout: this.options.timeout,
      });
      
      // Add more validation
      if (!response.data || !response.data.plugins) {
        console.warn('MCP Client: Received invalid response format from server');
        return {};
      }
      
      return response.data.plugins || {};
    } catch (error) {
      console.error(`MCP Client: Failed to list plugins: ${error instanceof Error ? error.message : String(error)}`);
      // More detailed error message
      if (axios.isAxiosError(error) && error.response) {
        console.error(`Status: ${error.response.status}, Data:`, error.response.data);
      }
      throw new Error(`MCP client error: ${error instanceof Error ? error.message : String(error)}`);
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
  
  /**
   * Generate context for documentation retrieval
   * Creates a rich context to help filter and optimize retrieved documentation
   */
  generateContext(options: ContextGenerationOptions): string {
    const contextParts: string[] = [];
    
    // Add strategy if available
    if (options.strategy) {
      contextParts.push(`Strategy: ${options.strategy}`);
    }
    
    // Add competition if available
    if (options.competitionId) {
      contextParts.push(`Competition: ${options.competitionId}`);
    }
    
    // Add trading pairs if available
    if (options.tradingPairs && options.tradingPairs.length > 0) {
      contextParts.push(`Trading pairs: ${options.tradingPairs.join(', ')}`);
    }
    
    // Add plugins if available
    if (options.pluginNames && options.pluginNames.length > 0) {
      contextParts.push(`Plugins: ${options.pluginNames.join(', ')}`);
    }
    
    // Add timeframe if available
    if (options.timeframe) {
      contextParts.push(`Timeframe: ${options.timeframe}`);
    }
    
    // Add user's question or task
    if (options.questionOrTask) {
      contextParts.push(`Question/Task: ${options.questionOrTask}`);
    }
    
    // If no options were provided, return a general context
    if (contextParts.length === 0) {
      return 'Cryptocurrency trading, trading signals, technical analysis, strategy development, risk management, and automated trading with the Eliza Plugin ecosystem.';
    }
    
    return contextParts.join('. ');
  }
  
  /**
   * Get documentation for a trading strategy
   * Automatically optimizes the search based on strategy information
   */
  async getDocumentationForStrategy(strategy: any, questionOrTask?: string): Promise<DocResponse[]> {
    try {
      const strategyDescription = typeof strategy === 'string' ? strategy : 
        `${strategy.name}: ${strategy.description}. Indicators: ${strategy.indicators?.join(', ')}. Timeframes: ${strategy.timeframes?.join(', ')}.`;
      
      // Create context from strategy
      const context = this.generateContext({
        strategy: strategyDescription,
        tradingPairs: strategy.tradingPairs,
        timeframe: Array.isArray(strategy.timeframes) ? strategy.timeframes.join(', ') : strategy.timeframes,
        questionOrTask
      });
      
      // Gather documentation from relevant sources
      const docs: DocResponse[] = [];
      
      // Get relevant strategy docs
      const strategyType = this.detectStrategyType(strategyDescription);
      if (strategyType) {
        const strategyDocs = await this.getStrategyDocumentation(strategyType, context);
        docs.push(strategyDocs);
      }
      
      // Get plugin docs for indicators mentioned in the strategy
      if (strategy.indicators && Array.isArray(strategy.indicators)) {
        const indicatorPlugins = await this.mapIndicatorsToPlugins(strategy.indicators);
        for (const plugin of indicatorPlugins) {
          try {
            const pluginDocs = await this.getPluginDocumentation(plugin, context);
            docs.push(pluginDocs);
          } catch (error) {
            console.warn(`Could not get docs for plugin ${plugin}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }
      
      return docs;
    } catch (error) {
      console.error(`Failed to get documentation for strategy: ${error instanceof Error ? error.message : String(error)}`);
      throw new Error(`MCP client strategy docs error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Detect strategy type from description
   */
  private detectStrategyType(description: string): string | null {
    const lowerDesc = description.toLowerCase();
    
    if (lowerDesc.includes('momentum') || lowerDesc.includes('trend') || lowerDesc.includes('following')) {
      return 'momentum';
    } else if (lowerDesc.includes('reversion') || lowerDesc.includes('mean') || lowerDesc.includes('oscillation')) {
      return 'mean-reversion';
    } else if (lowerDesc.includes('arbitrage')) {
      return 'arbitrage';
    } else if (lowerDesc.includes('grid')) {
      return 'grid';
    } else if (lowerDesc.includes('statistical') || lowerDesc.includes('stat arb')) {
      return 'statistical-arbitrage';
    } else {
      return null;
    }
  }
  
  /**
   * Map indicators to likely plugin names
   */
  private async mapIndicatorsToPlugins(indicators: string[]): Promise<string[]> {
    try {
      // Get all available plugins
      const plugins = await this.listPlugins();
      
      // Create a set to store matching plugins
      const matchingPlugins = new Set<string>();
      
      // Check each indicator against each plugin's description
      for (const indicator of indicators) {
        const lowerIndicator = indicator.toLowerCase();
        
        for (const [pluginName, pluginInfo] of Object.entries(plugins)) {
          // If the plugin description or name contains the indicator, consider it a match
          if (
            pluginInfo.description?.toLowerCase().includes(lowerIndicator) || 
            pluginName.toLowerCase().includes(lowerIndicator)
          ) {
            matchingPlugins.add(pluginName);
          }
        }
      }
      
      // If we found matches, return them
      if (matchingPlugins.size > 0) {
        return Array.from(matchingPlugins);
      }
      
      // Otherwise, return an empty array
      return [];
    } catch (error) {
      console.warn(`Failed to map indicators to plugins: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }
  
  /**
   * Test method to fetch documentation for a specific plugin
   * @param pluginName The name of the plugin to fetch documentation for
   */
  public async testFetchPluginDocumentation(pluginName: string): Promise<void> {
    console.log(`🧪 TEST: Fetching documentation for plugin ${pluginName}`);
    
    try {
      const response = await axios.post(`${this.options.baseUrl}/query`, {
        type: 'plugin',
        query: pluginName
      });
      
      if (response.status === 200) {
        console.log(`✅ SUCCESS: Got documentation for ${pluginName}`);
        console.log(`Source: ${response.data.source}`);
        console.log(`Content length: ${response.data.content.length} characters`);
        console.log(`First 150 chars: ${response.data.content.substring(0, 150)}...`);
      } else {
        console.error(`❌ ERROR: Failed to fetch documentation for ${pluginName} - Status: ${response.status}`);
      }
    } catch (error) {
      if (axios.isAxiosError(error) && error.response) {
        console.error(`❌ ERROR: Failed to fetch documentation for ${pluginName} - Status: ${error.response.status}`);
        
        // Retry with fallback option
        console.log('🔄 Retrying with fallback option...');
        try {
          const fallbackResponse = await axios.post(`${this.options.baseUrl}/query`, {
            type: 'plugin',
            query: pluginName,
            params: {
              useFallback: 'true'
            }
          });
          
          if (fallbackResponse.status === 200) {
            console.log(`✅ SUCCESS (fallback): Got documentation for ${pluginName}`);
            console.log(`Source: ${fallbackResponse.data.source}`);
            console.log(`Content length: ${fallbackResponse.data.content.length} characters`);
            console.log(`First 150 chars: ${fallbackResponse.data.content.substring(0, 150)}...`);
            return;
          }
        } catch (fallbackError) {
          console.error(`❌ ERROR: Fallback also failed: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`);
        }
      }
      
      console.error(`❌ ERROR: Failed to fetch documentation for ${pluginName}`);
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
} 