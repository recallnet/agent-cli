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
  async getPluginDocumentation(pluginName: string, context?: string): Promise<DocResponse> {
    return this.getDocumentation({
      type: DocSourceType.PLUGIN,
      query: pluginName,
      params: context ? { context } : undefined
    });
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
      
      // Create a context that combines plugin info with user's context
      const enhancedContext = context ? 
        `Plugin: ${pluginName}. ${pluginInfo.description}. ${context}` :
        `Plugin: ${pluginName}. ${pluginInfo.description}. How to use this plugin, its main features, and integration examples.`;
      
      // Scan the repository
      return this.scanGithubRepository(repoPath, {
        branch: 'main',
        fileTypes: ['.ts', '.js', '.json', '.md'],
        maxDepth: 3,
        maxFiles: 20,
        fetchContent: true,
        includeDependencies: true,
        ...options,
      }, enhancedContext);
    } catch (error) {
      console.error(`Failed to scan plugin repository for ${pluginName}: ${error instanceof Error ? error.message : String(error)}`);
      throw new Error(`MCP client scan error: ${error instanceof Error ? error.message : String(error)}`);
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
// Import the plugin
${pluginDoc.metadata?.importStatement || `import { PluginName } from '@elizaos-plugins/plugin-${pluginName}';`}

// Initialize the plugin
// (Add specific initialization based on plugin type)

// Use the plugin functionality
// (Add specific usage examples based on plugin purpose)
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
      const response = await axios.get(`${this.options.baseUrl}/plugins`, {
        timeout: this.options.timeout,
      });
      
      return response.data.plugins || {};
    } catch (error) {
      console.error(`Failed to list plugins: ${error instanceof Error ? error.message : String(error)}`);
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
        const indicatorPlugins = this.mapIndicatorsToPlugins(strategy.indicators);
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
  private mapIndicatorsToPlugins(indicators: string[]): string[] {
    const pluginMap: Record<string, string[]> = {
      'macd': ['trading-signals', 'technical-indicators'],
      'rsi': ['trading-signals', 'technical-indicators'],
      'moving average': ['trading-signals', 'technical-indicators'],
      'bollinger': ['trading-signals', 'technical-indicators'],
      'volume': ['crypto-market-data', 'market-volume-analyzer'],
      'price': ['crypto-market-data', 'price-feed'],
      'order book': ['order-book-analyzer', 'exchange-connector'],
      'candle': ['crypto-market-data', 'candlestick-patterns']
    };
    
    const plugins = new Set<string>();
    
    // Default plugins that are almost always useful
    plugins.add('crypto-market-data');
    plugins.add('trading-signals');
    
    // Add plugins based on indicators
    for (const indicator of indicators) {
      const lowerIndicator = indicator.toLowerCase();
      
      for (const [key, pluginsForIndicator] of Object.entries(pluginMap)) {
        if (lowerIndicator.includes(key)) {
          for (const plugin of pluginsForIndicator) {
            plugins.add(plugin);
          }
        }
      }
    }
    
    return Array.from(plugins);
  }
} 