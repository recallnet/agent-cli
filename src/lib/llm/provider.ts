import { OpenAI } from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import Conf from 'conf';
import { McpClient } from '../mcp/client.js';

// Config store for API keys
const config = new Conf({
  projectName: 'recall-cli'
});

/**
 * Response from an LLM provider
 */
export interface LlmResponse {
  content: string;
  tokenUsage?: {
    input: number;
    output: number;
    total: number;
  };
}

/**
 * Plugin recommendation from an LLM
 */
export interface PluginRecommendation {
  name: string;
  reasoning: string;
  confidence: number; // 0-1
}

/**
 * Base class for LLM providers
 */
export abstract class LlmProvider {
  protected apiKey: string;
  protected mcpClient: McpClient | null = null;

  constructor(apiKey: string, mcpClient?: McpClient) {
    this.apiKey = apiKey;
    this.mcpClient = mcpClient || null;
  }

  /**
   * Set the MCP client for this provider
   */
  setMcpClient(mcpClient: McpClient): void {
    this.mcpClient = mcpClient;
  }

  /**
   * Check if the API key is valid
   */
  abstract validateApiKey(): Promise<boolean>;

  /**
   * Send a prompt to the LLM
   */
  abstract prompt(prompt: string, options?: Record<string, any>): Promise<LlmResponse>;

  /**
   * Generate code based on a description
   */
  abstract generateCode(description: string, language: string): Promise<LlmResponse>;

  /**
   * Suggest improvements to a strategy
   */
  abstract suggestStrategyImprovements(strategy: string): Promise<LlmResponse>;

  /**
   * Recommend plugins based on a strategy description
   */
  abstract recommendPluginsForStrategy(strategy: string): Promise<PluginRecommendation[]>;

  /**
   * Recommend plugins based on competition guidelines
   */
  abstract recommendPluginsForCompetition(competitionId: string): Promise<PluginRecommendation[]>;

  /**
   * Generate a strategy based on competition guidelines
   */
  abstract generateStrategyForCompetition(competitionId: string): Promise<LlmResponse>;

  /**
   * Analyze and provide insights about a plugin
   */
  abstract analyzePlugin(pluginName: string): Promise<LlmResponse>;
  
  /**
   * Explain plugin implementation and provide integration guidance
   */
  abstract explainPluginImplementation(pluginName: string): Promise<LlmResponse>;
  
  /**
   * Generate usage examples for a plugin
   */
  abstract generatePluginUsageExamples(pluginName: string): Promise<LlmResponse>;
  
  /**
   * Analyze code and suggest improvements
   */
  abstract analyzeAndImproveCode(code: string, language: string): Promise<LlmResponse>;
}

/**
 * OpenAI LLM provider
 */
export class OpenAIProvider extends LlmProvider {
  private client: OpenAI;

  constructor(apiKey: string, mcpClient?: McpClient) {
    super(apiKey, mcpClient);
    this.client = new OpenAI({ apiKey });
  }

  /**
   * Check if the API key is valid
   */
  async validateApiKey(): Promise<boolean> {
    try {
      // Make a simple models list call to validate the key
      await this.client.models.list();
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Send a prompt to the LLM
   */
  async prompt(prompt: string, options: Record<string, any> = {}): Promise<LlmResponse> {
    const model = options.model || 'gpt-4';
    const temperature = options.temperature || 0.7;

    try {
      const response = await this.client.chat.completions.create({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature,
      });

      return {
        content: response.choices[0]?.message?.content || '',
        tokenUsage: {
          input: response.usage?.prompt_tokens || 0,
          output: response.usage?.completion_tokens || 0,
          total: response.usage?.total_tokens || 0,
        },
      };
    } catch (error) {
      throw new Error(`OpenAI API error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Generate code based on a description
   */
  async generateCode(description: string, language: string): Promise<LlmResponse> {
    const prompt = `Generate code in ${language} based on this description: ${description}
    
Please provide only the code without any explanations or markdown formatting.`;

    return this.prompt(prompt, { temperature: 0.2 });
  }

  /**
   * Suggest improvements to a strategy
   */
  async suggestStrategyImprovements(strategy: string): Promise<LlmResponse> {
    const prompt = `I have a cryptocurrency trading strategy:

${strategy}

Please analyze this strategy and suggest improvements in the following areas:
1. Risk management
2. Signal accuracy
3. Market conditions adaptation
4. Technical indicators
5. Implementation efficiency

For each suggestion, provide a brief explanation of why it would improve the strategy.`;

    return this.prompt(prompt, { temperature: 0.7 });
  }

  /**
   * Recommend plugins based on a strategy description
   */
  async recommendPluginsForStrategy(strategy: string): Promise<PluginRecommendation[]> {
    if (!this.mcpClient) {
      throw new Error('MCP client not initialized. Unable to fetch plugin information.');
    }

    try {
      // Get available plugins from MCP server
      const plugins = await this.mcpClient.listPlugins();
      
      // Extract plugin descriptions and documentation
      const pluginDescriptions = Object.values(plugins).map((plugin: any) => {
        return {
          name: plugin.name,
          description: plugin.description,
          requiredEnv: plugin.requiredEnv,
          dependencies: plugin.dependencies
        };
      });

      const prompt = `Given the following cryptocurrency trading strategy:

${strategy}

And the following available plugins:

${pluginDescriptions.map((p: any) => `- ${p.name}: ${p.description}`).join('\n')}

Recommend which plugins would be most useful for implementing this strategy. For each recommended plugin, explain why it would be helpful and rate your confidence in the recommendation from 0 to 1.

Return your recommendations in the following JSON format:
[
  {
    "name": "plugin-name",
    "reasoning": "Detailed explanation of why this plugin is recommended",
    "confidence": 0.95
  }
]

Sort the recommendations by confidence (highest first).`;

      const response = await this.prompt(prompt, {
        model: 'gpt-4-turbo', 
        temperature: 0.3,
      });

      // Parse JSON from response content
      try {
        const jsonStart = response.content.indexOf('[');
        const jsonEnd = response.content.lastIndexOf(']') + 1;
        
        if (jsonStart === -1 || jsonEnd === 0) {
          throw new Error('JSON not found in response');
        }
        
        const jsonString = response.content.substring(jsonStart, jsonEnd);
        return JSON.parse(jsonString) as PluginRecommendation[];
      } catch (jsonError) {
        console.error('Failed to parse recommendations JSON:', jsonError);
        throw new Error('Failed to parse plugin recommendations');
      }
    } catch (error) {
      console.error('Error while recommending plugins:', error);
      throw new Error(`Failed to recommend plugins: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Recommend plugins based on competition guidelines
   */
  async recommendPluginsForCompetition(competitionId: string): Promise<PluginRecommendation[]> {
    if (!this.mcpClient) {
      throw new Error('MCP client not initialized. Unable to fetch competition information.');
    }

    try {
      // Get competition guidelines
      const competitionDoc = await this.mcpClient.getCompetitionDocumentation(competitionId);
      
      // Get available plugins
      const plugins = await this.mcpClient.listPlugins();
      
      // Extract plugin descriptions
      const pluginDescriptions = Object.values(plugins).map((plugin: any) => {
        return {
          name: plugin.name,
          description: plugin.description,
          requiredEnv: plugin.requiredEnv,
          dependencies: plugin.dependencies
        };
      });

      const prompt = `Given the following cryptocurrency trading competition guidelines:

${competitionDoc.content}

And the following available plugins:

${pluginDescriptions.map((p: any) => `- ${p.name}: ${p.description}`).join('\n')}

Recommend which plugins would be most appropriate for building an agent for this competition. For each recommended plugin, explain why it would be helpful and rate your confidence in the recommendation from 0 to 1.

Return your recommendations in the following JSON format:
[
  {
    "name": "plugin-name",
    "reasoning": "Detailed explanation of why this plugin is recommended",
    "confidence": 0.95
  }
]

Sort the recommendations by confidence (highest first).`;

      const response = await this.prompt(prompt, {
        model: 'gpt-4-turbo',
        temperature: 0.3,
      });

      // Parse JSON from response content
      try {
        const jsonStart = response.content.indexOf('[');
        const jsonEnd = response.content.lastIndexOf(']') + 1;
        
        if (jsonStart === -1 || jsonEnd === 0) {
          throw new Error('JSON not found in response');
        }
        
        const jsonString = response.content.substring(jsonStart, jsonEnd);
        return JSON.parse(jsonString) as PluginRecommendation[];
      } catch (jsonError) {
        console.error('Failed to parse recommendations JSON:', jsonError);
        throw new Error('Failed to parse plugin recommendations');
      }
    } catch (error) {
      console.error('Error while recommending plugins for competition:', error);
      throw new Error(`Failed to recommend plugins: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Generate a strategy based on competition guidelines
   */
  async generateStrategyForCompetition(competitionId: string): Promise<LlmResponse> {
    if (!this.mcpClient) {
      throw new Error('MCP client not initialized. Unable to fetch competition information.');
    }

    try {
      // Get competition guidelines
      const competitionDoc = await this.mcpClient.getCompetitionDocumentation(competitionId);

      const prompt = `Given the following cryptocurrency trading competition guidelines:

${competitionDoc.content}

Generate a detailed trading strategy that would perform well in this competition. The strategy should include:

1. A clear description of the approach
2. The specific indicators or signals to use
3. Entry and exit conditions
4. Risk management rules
5. Any special considerations based on the competition rules

Be specific and detailed in your response.`;

      return this.prompt(prompt, {
        model: 'gpt-4-turbo',
        temperature: 0.7,
      });
    } catch (error) {
      console.error('Error generating strategy:', error);
      throw new Error(`Failed to generate strategy: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Analyze and provide insights about a plugin
   */
  async analyzePlugin(pluginName: string): Promise<LlmResponse> {
    if (!this.mcpClient) {
      throw new Error('MCP client not initialized. Unable to fetch plugin information.');
    }

    try {
      // Get plugin documentation
      const pluginDoc = await this.mcpClient.getPluginDocumentation(pluginName);

      const prompt = `The following is documentation for the cryptocurrency trading plugin "${pluginName}":

${pluginDoc.content}

Please analyze this plugin and provide:

1. A summary of what the plugin does
2. The key use cases for this plugin in a trading strategy
3. Examples of how to effectively use this plugin
4. Potential limitations or considerations when using this plugin
5. Types of trading strategies this plugin would be most valuable for

Be specific and detailed in your analysis.`;

      return this.prompt(prompt, {
        model: 'gpt-4',
        temperature: 0.5,
      });
    } catch (error) {
      console.error('Error analyzing plugin:', error);
      throw new Error(`Failed to analyze plugin: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Explain plugin implementation and provide integration guidance
   */
  async explainPluginImplementation(pluginName: string): Promise<LlmResponse> {
    if (!this.mcpClient) {
      throw new Error('MCP client not initialized. Unable to fetch plugin information.');
    }

    try {
      // Scan the plugin's repository to understand its implementation
      const repoScan = await this.mcpClient.scanPluginRepository(pluginName);
      
      // Get standard plugin documentation
      const pluginDoc = await this.mcpClient.getPluginDocumentation(pluginName);
      
      const prompt = `I need to understand how to implement and integrate the "${pluginName}" plugin into a crypto trading signal agent.

Please analyze the following plugin information:

## Plugin Documentation
${pluginDoc.content}

## Repository Analysis
${repoScan.content}

Based on this information, please provide:

1. A clear explanation of what this plugin does and its main features
2. The core classes/functions provided by the plugin and what each one does
3. Step-by-step instructions for integrating this plugin into a Recall agent
4. Code examples showing proper initialization and common usage patterns
5. Any configuration options or environment variables required
6. Error handling best practices when using this plugin
7. Performance considerations and optimization tips

Focus on practical integration guidance that would help a developer implement this plugin correctly.`;

      return this.prompt(prompt, {
        model: 'gpt-4-turbo',
        temperature: 0.3,
      });
    } catch (error) {
      console.error('Error explaining plugin implementation:', error);
      throw new Error(`Failed to explain plugin implementation: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Generate usage examples for a plugin
   */
  async generatePluginUsageExamples(pluginName: string): Promise<LlmResponse> {
    if (!this.mcpClient) {
      throw new Error('MCP client not initialized. Unable to fetch plugin information.');
    }

    try {
      // Get usage examples from MCP
      const usageExamples = await this.mcpClient.getPluginUsageExamples(pluginName);
      
      const prompt = `Based on the following information about the "${pluginName}" plugin, please generate detailed and practical usage examples.

${usageExamples.content}

Please create:

1. A simple standalone example showing basic usage
2. A more complex example showing integration with other plugins
3. A complete Recall agent implementation using this plugin
4. Examples of handling common error cases
5. Usage patterns for different trading scenarios

The examples should be realistic, following best practices, and include proper error handling. Include comments to explain key parts of the code.`;

      return this.prompt(prompt, {
        model: 'gpt-4-turbo',
        temperature: 0.3,
      });
    } catch (error) {
      console.error('Error generating plugin usage examples:', error);
      throw new Error(`Failed to generate plugin usage examples: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Analyze code and suggest improvements
   */
  async analyzeAndImproveCode(code: string, language: string): Promise<LlmResponse> {
    if (!this.mcpClient) {
      throw new Error('MCP client not initialized. Unable to analyze code.');
    }

    try {
      // Use MCP to analyze the code
      const analysis = await this.mcpClient.analyzeCode(code, {
        language,
        fileName: 'code.' + language,
      });
      
      const prompt = `Please analyze the following code and provide an explanation of what it does, potential issues, and suggestions for improvements:

\`\`\`${language}
${code}
\`\`\`

## Code Analysis
${analysis.content}

Based on this analysis, please provide:

1. A clear explanation of what this code does and its main components
2. Any potential bugs, edge cases, or performance issues
3. Suggestions for improving code quality, readability, and maintainability
4. Any security concerns or best practices that should be applied
5. An improved version of the code with your suggested changes

Focus on practical improvements that would make this code more robust and efficient.`;

      return this.prompt(prompt, {
        model: 'gpt-4-turbo',
        temperature: 0.2,
      });
    } catch (error) {
      console.error('Error analyzing and improving code:', error);
      throw new Error(`Failed to analyze and improve code: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

/**
 * Anthropic LLM provider
 */
export class AnthropicProvider extends LlmProvider {
  private client: Anthropic;
  
  constructor(apiKey: string, mcpClient?: McpClient) {
    super(apiKey, mcpClient);
    this.client = new Anthropic({ apiKey });
  }

  /**
   * Check if the API key is valid
   */
  async validateApiKey(): Promise<boolean> {
    try {
      // Make a simple completion call with minimal tokens to validate the key
      await this.client.messages.create({
        model: 'claude-3-haiku-20240307',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Hello' }],
      });
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Send a prompt to the LLM
   */
  async prompt(prompt: string, options: Record<string, any> = {}): Promise<LlmResponse> {
    // Map options to Anthropic parameters
    const model = options.model || 'claude-3-opus-20240229';
    const temperature = options.temperature || 0.7;
    const maxTokens = options.maxTokens || 4000;
    
    try {
      const response = await this.client.messages.create({
        model,
        max_tokens: maxTokens,
        temperature,
        messages: [{ role: 'user', content: prompt }],
      });
      
      return {
        content: response.content[0]?.text || '',
        tokenUsage: {
          input: response.usage.input_tokens,
          output: response.usage.output_tokens,
          total: response.usage.input_tokens + response.usage.output_tokens,
        },
      };
    } catch (error) {
      throw new Error(`Anthropic API error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Generate code based on a description
   */
  async generateCode(description: string, language: string): Promise<LlmResponse> {
    const prompt = `Generate code in ${language} based on this description: ${description}

Please provide only the code without any explanations or markdown formatting.`;

    return this.prompt(prompt, { 
      temperature: 0.2,
      model: 'claude-3-opus-20240229', // Using Opus for code generation
    });
  }

  /**
   * Suggest improvements to a strategy
   */
  async suggestStrategyImprovements(strategy: string): Promise<LlmResponse> {
    const prompt = `I have a cryptocurrency trading strategy:

${strategy}

Please analyze this strategy and suggest improvements in the following areas:
1. Risk management
2. Signal accuracy
3. Market conditions adaptation
4. Technical indicators
5. Implementation efficiency

For each suggestion, provide a brief explanation of why it would improve the strategy.`;

    return this.prompt(prompt, { temperature: 0.7 });
  }

  /**
   * Recommend plugins based on a strategy description
   */
  async recommendPluginsForStrategy(strategy: string): Promise<PluginRecommendation[]> {
    if (!this.mcpClient) {
      throw new Error('MCP client not initialized. Unable to fetch plugin information.');
    }

    try {
      // Get available plugins from MCP server
      const plugins = await this.mcpClient.listPlugins();
      
      // Extract plugin descriptions and documentation
      const pluginDescriptions = Object.values(plugins).map((plugin: any) => {
        return {
          name: plugin.name,
          description: plugin.description,
          requiredEnv: plugin.requiredEnv,
          dependencies: plugin.dependencies
        };
      });

      const prompt = `Given the following cryptocurrency trading strategy:

${strategy}

And the following available plugins:

${pluginDescriptions.map((p: any) => `- ${p.name}: ${p.description}`).join('\n')}

Recommend which plugins would be most useful for implementing this strategy. For each recommended plugin, explain why it would be helpful and rate your confidence in the recommendation from 0 to 1.

Return your recommendations in the following JSON format:
[
  {
    "name": "plugin-name",
    "reasoning": "Detailed explanation of why this plugin is recommended",
    "confidence": 0.95
  }
]

Sort the recommendations by confidence (highest first).`;

      const response = await this.prompt(prompt, {
        model: 'claude-3-opus-20240229', 
        temperature: 0.3,
      });

      // Parse JSON from response content
      try {
        const jsonStart = response.content.indexOf('[');
        const jsonEnd = response.content.lastIndexOf(']') + 1;
        
        if (jsonStart === -1 || jsonEnd === 0) {
          throw new Error('JSON not found in response');
        }
        
        const jsonString = response.content.substring(jsonStart, jsonEnd);
        return JSON.parse(jsonString) as PluginRecommendation[];
      } catch (jsonError) {
        console.error('Failed to parse recommendations JSON:', jsonError);
        throw new Error('Failed to parse plugin recommendations');
      }
    } catch (error) {
      console.error('Error while recommending plugins:', error);
      throw new Error(`Failed to recommend plugins: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Recommend plugins based on competition guidelines
   */
  async recommendPluginsForCompetition(competitionId: string): Promise<PluginRecommendation[]> {
    if (!this.mcpClient) {
      throw new Error('MCP client not initialized. Unable to fetch competition information.');
    }

    try {
      // Get competition guidelines
      const competitionDoc = await this.mcpClient.getCompetitionDocumentation(competitionId);
      
      // Get available plugins
      const plugins = await this.mcpClient.listPlugins();
      
      // Extract plugin descriptions
      const pluginDescriptions = Object.values(plugins).map((plugin: any) => {
        return {
          name: plugin.name,
          description: plugin.description,
          requiredEnv: plugin.requiredEnv,
          dependencies: plugin.dependencies
        };
      });

      const prompt = `Given the following cryptocurrency trading competition guidelines:

${competitionDoc.content}

And the following available plugins:

${pluginDescriptions.map((p: any) => `- ${p.name}: ${p.description}`).join('\n')}

Recommend which plugins would be most appropriate for building an agent for this competition. For each recommended plugin, explain why it would be helpful and rate your confidence in the recommendation from 0 to 1.

Return your recommendations in the following JSON format:
[
  {
    "name": "plugin-name",
    "reasoning": "Detailed explanation of why this plugin is recommended",
    "confidence": 0.95
  }
]

Sort the recommendations by confidence (highest first).`;

      const response = await this.prompt(prompt, {
        model: 'claude-3-opus-20240229',
        temperature: 0.3,
      });

      // Parse JSON from response content
      try {
        const jsonStart = response.content.indexOf('[');
        const jsonEnd = response.content.lastIndexOf(']') + 1;
        
        if (jsonStart === -1 || jsonEnd === 0) {
          throw new Error('JSON not found in response');
        }
        
        const jsonString = response.content.substring(jsonStart, jsonEnd);
        return JSON.parse(jsonString) as PluginRecommendation[];
      } catch (jsonError) {
        console.error('Failed to parse recommendations JSON:', jsonError);
        throw new Error('Failed to parse plugin recommendations');
      }
    } catch (error) {
      console.error('Error while recommending plugins for competition:', error);
      throw new Error(`Failed to recommend plugins: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Generate a strategy based on competition guidelines
   */
  async generateStrategyForCompetition(competitionId: string): Promise<LlmResponse> {
    if (!this.mcpClient) {
      throw new Error('MCP client not initialized. Unable to fetch competition information.');
    }

    try {
      // Get competition guidelines
      const competitionDoc = await this.mcpClient.getCompetitionDocumentation(competitionId);

      const prompt = `Given the following cryptocurrency trading competition guidelines:

${competitionDoc.content}

Generate a detailed trading strategy that would perform well in this competition. The strategy should include:

1. A clear description of the approach
2. The specific indicators or signals to use
3. Entry and exit conditions
4. Risk management rules
5. Any special considerations based on the competition rules

Be specific and detailed in your response.`;

      return this.prompt(prompt, {
        model: 'claude-3-opus-20240229',
        temperature: 0.7,
      });
    } catch (error) {
      console.error('Error generating strategy:', error);
      throw new Error(`Failed to generate strategy: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Analyze and provide insights about a plugin
   */
  async analyzePlugin(pluginName: string): Promise<LlmResponse> {
    if (!this.mcpClient) {
      throw new Error('MCP client not initialized. Unable to fetch plugin information.');
    }

    try {
      // Get plugin documentation
      const pluginDoc = await this.mcpClient.getPluginDocumentation(pluginName);

      const prompt = `The following is documentation for the cryptocurrency trading plugin "${pluginName}":

${pluginDoc.content}

Please analyze this plugin and provide:

1. A summary of what the plugin does
2. The key use cases for this plugin in a trading strategy
3. Examples of how to effectively use this plugin
4. Potential limitations or considerations when using this plugin
5. Types of trading strategies this plugin would be most valuable for

Be specific and detailed in your analysis.`;

      return this.prompt(prompt, {
        model: 'claude-3-opus-20240229',
        temperature: 0.5,
      });
    } catch (error) {
      console.error('Error analyzing plugin:', error);
      throw new Error(`Failed to analyze plugin: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Explain plugin implementation and provide integration guidance
   */
  async explainPluginImplementation(pluginName: string): Promise<LlmResponse> {
    if (!this.mcpClient) {
      throw new Error('MCP client not initialized. Unable to fetch plugin information.');
    }

    try {
      // Scan the plugin's repository to understand its implementation
      const repoScan = await this.mcpClient.scanPluginRepository(pluginName);
      
      // Get standard plugin documentation
      const pluginDoc = await this.mcpClient.getPluginDocumentation(pluginName);
      
      const prompt = `I need to understand how to implement and integrate the "${pluginName}" plugin into a crypto trading signal agent.

Please analyze the following plugin information:

## Plugin Documentation
${pluginDoc.content}

## Repository Analysis
${repoScan.content}

Based on this information, please provide:

1. A clear explanation of what this plugin does and its main features
2. The core classes/functions provided by the plugin and what each one does
3. Step-by-step instructions for integrating this plugin into a Recall agent
4. Code examples showing proper initialization and common usage patterns
5. Any configuration options or environment variables required
6. Error handling best practices when using this plugin
7. Performance considerations and optimization tips

Focus on practical integration guidance that would help a developer implement this plugin correctly.`;

      return this.prompt(prompt, {
        model: 'claude-3-opus-20240229',
        temperature: 0.3,
      });
    } catch (error) {
      console.error('Error explaining plugin implementation:', error);
      throw new Error(`Failed to explain plugin implementation: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Generate usage examples for a plugin
   */
  async generatePluginUsageExamples(pluginName: string): Promise<LlmResponse> {
    if (!this.mcpClient) {
      throw new Error('MCP client not initialized. Unable to fetch plugin information.');
    }

    try {
      // Get usage examples from MCP
      const usageExamples = await this.mcpClient.getPluginUsageExamples(pluginName);
      
      const prompt = `Based on the following information about the "${pluginName}" plugin, please generate detailed and practical usage examples.

${usageExamples.content}

Please create:

1. A simple standalone example showing basic usage
2. A more complex example showing integration with other plugins
3. A complete Recall agent implementation using this plugin
4. Examples of handling common error cases
5. Usage patterns for different trading scenarios

The examples should be realistic, following best practices, and include proper error handling. Include comments to explain key parts of the code.`;

      return this.prompt(prompt, {
        model: 'claude-3-opus-20240229',
        temperature: 0.3,
      });
    } catch (error) {
      console.error('Error generating plugin usage examples:', error);
      throw new Error(`Failed to generate plugin usage examples: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Analyze code and suggest improvements
   */
  async analyzeAndImproveCode(code: string, language: string): Promise<LlmResponse> {
    if (!this.mcpClient) {
      throw new Error('MCP client not initialized. Unable to analyze code.');
    }

    try {
      // Use MCP to analyze the code
      const analysis = await this.mcpClient.analyzeCode(code, {
        language,
        fileName: 'code.' + language,
      });
      
      const prompt = `Please analyze the following code and provide an explanation of what it does, potential issues, and suggestions for improvements:

\`\`\`${language}
${code}
\`\`\`

## Code Analysis
${analysis.content}

Based on this analysis, please provide:

1. A clear explanation of what this code does and its main components
2. Any potential bugs, edge cases, or performance issues
3. Suggestions for improving code quality, readability, and maintainability
4. Any security concerns or best practices that should be applied
5. An improved version of the code with your suggested changes

Focus on practical improvements that would make this code more robust and efficient.`;

      return this.prompt(prompt, {
        model: 'claude-3-opus-20240229',
        temperature: 0.2,
      });
    } catch (error) {
      console.error('Error analyzing and improving code:', error);
      throw new Error(`Failed to analyze and improve code: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

/**
 * Factory for creating LLM providers
 */
export class LlmProviderFactory {
  /**
   * Create an LLM provider based on the given provider name and API key
   */
  static createProvider(provider: string, apiKey: string, mcpClient?: McpClient): LlmProvider {
    switch (provider.toLowerCase()) {
    case 'openai':
      return new OpenAIProvider(apiKey, mcpClient);
    case 'anthropic':
      return new AnthropicProvider(apiKey, mcpClient);
    default:
      throw new Error(`Unsupported LLM provider: ${provider}`);
    }
  }

  /**
   * Create an LLM provider from the configured provider and API key
   */
  static createFromConfig(mcpClient?: McpClient): LlmProvider | null {
    const provider = config.get('llm.provider') as string;
    const apiKey = config.get('llm.apiKey') as string;

    if (!provider || !apiKey) {
      return null;
    }

    return this.createProvider(provider, apiKey, mcpClient);
  }
} 