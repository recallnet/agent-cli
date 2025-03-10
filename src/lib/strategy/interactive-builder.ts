import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import path from 'path';

import { LlmProviderFactory } from '../llm/provider.js';
import { McpClient } from '../mcp/client.js';
import { PluginInfo, PluginRegistry } from '../plugins/registry.js';
import { LlmProvider } from '../llm/provider.js';
import { updateCharacterWithStrategy } from './character-updater.js';

/**
 * Extract a JSON string from text that may contain additional content
 */
function extractJsonFromText(text: string): string | null {
  const jsonStart = text.indexOf('{');
  const jsonEnd = text.lastIndexOf('}') + 1;
  
  if (jsonStart >= 0 && jsonEnd > jsonStart) {
    return text.substring(jsonStart, jsonEnd);
  }
  
  return null;
}

/**
 * Options for building a strategy interactively
 */
export interface InteractiveBuilderOptions {
  outputFormat: 'standard' | 'json' | 'typescript';
  interactive: boolean;
  strategyName?: string;
  description?: string;
  timeframes?: string[];
  indicators?: string[];
  targetPlugins?: string[];
  outputDir?: string;
}

/**
 * Result of the interactive builder
 */
export interface InteractiveBuilderResult {
  strategy: {
    name: string;
    description: string;
    timeframes: string[];
    indicators: string[];
    parameters: Record<string, any>;
  };
  implementation?: string;
  filePath?: string;
}

/**
 * Enhance the trading character with strategy details
 */
async function enhanceCharacterForTrading(
  projectPath: string, 
  strategy: any, 
  _llmProvider: LlmProvider
): Promise<void> {
  console.log(chalk.blue('🧠 Updating character with trading expertise...'));
  
  // Convert our strategy object to match the expected TradingStrategy interface
  const tradingStrategy = {
    name: strategy.name,
    type: 'technical', // Default to technical if not provided
    assets: strategy.assets || ['BTC', 'ETH'], // Default to common crypto assets
    timeframes: strategy.timeframes || [],
    riskProfile: strategy.riskProfile || 'moderate', // Default risk profile
    indicators: strategy.indicators || [],
    description: strategy.description
  };
  
  // Get McpClient for passing to updateCharacterWithStrategy
  const mcpClient = new McpClient();
  
  // Update the character file with trading expertise
  const success = await updateCharacterWithStrategy(
    projectPath,
    tradingStrategy,
    mcpClient
  );
  
  if (!success) {
    console.log(chalk.yellow('⚠️ Character enhancement was not fully completed. You may need to manually update the character file.'));
  }
}

// Modified to only process the selected plugins
const getAllPluginInfo = async (targetPluginNames: string[]): Promise<PluginInfo[]> => {
  const registry = new PluginRegistry();
  
  // If no plugins were specified, return an empty array
  if (!targetPluginNames || targetPluginNames.length === 0) {
    return [];
  }
  
  console.log(`🔍 Processing ${targetPluginNames.length} selected plugins`);
  
  // Only process the plugins that were explicitly selected
  const plugins = await Promise.all(
    targetPluginNames.map(async (name) => {
      try {
        return await registry.getPlugin(name);
      } catch (e) {
        console.error(`Error loading plugin ${name}:`, e);
        return null;
      }
    })
  );

  return plugins.filter(Boolean) as PluginInfo[];
};

/**
 * Build a trading strategy interactively with LLM assistance
 */
export async function buildStrategyInteractively(options: InteractiveBuilderOptions): Promise<InteractiveBuilderResult> {
  const spinner = ora();
  
  try {
    // Create LLM provider and MCP client
    spinner.start('Initializing strategy builder...');
    const mcpClient = new McpClient();
    const llmProvider = LlmProviderFactory.createFromConfig(mcpClient);
    if (!llmProvider) {
      throw new Error('Failed to create LLM provider. Please configure your LLM provider first.');
    }
    spinner.succeed('Strategy builder initialized');
    
    // First, let's modify the plugin documentation fetching to only get basic info
    spinner.start('Fetching basic plugin information...');
    const plugins = await getAllPluginInfo(options.targetPlugins || []);
    console.log(`✔ Identified ${plugins.length} selected plugins for integration`);
    
    // Now let's modify the indicator extraction to be more lightweight
    let availableIndicators: string[] = [];
    
    if (plugins.length > 0) {
      // Create a simple list of plugin names and descriptions
      const pluginList = plugins.map(plugin => 
        `${plugin.name}: ${plugin.description}`
      ).join('\n');
      
      const indicatorPrompt = `
You are creating a crypto trading strategy for cryptocurrency trading.
The user wants to use these technical indicators: ${options.indicators?.join(', ') || 'RSI, MACD, Moving Averages'}.
The strategy should focus on common timeframes like ${options.timeframes?.join(', ') || '1h, 4h, daily'}.

The strategy will need to work with these plugins:
${pluginList}

Based on this information, list 5-10 relevant technical indicators that would work well in this strategy.
Format your response ONLY as a JSON array of strings: ["Indicator1", "Indicator2", ...]`;
      
      try {
        // Add a timeout to prevent hanging
        const timeoutMs = 30000; // 30 seconds
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Indicator extraction timed out')), timeoutMs)
        );
        
        const responsePromise = llmProvider.prompt(indicatorPrompt, {
          temperature: 0.3,
          maxTokens: 1000
        });
        
        // Race the response against the timeout
        const response = await Promise.race([responsePromise, timeoutPromise]) as any;
        
        // Extract JSON array from response
        const jsonStart = response.content.indexOf('[');
        const jsonEnd = response.content.lastIndexOf(']') + 1;
        
        if (jsonStart >= 0 && jsonEnd > jsonStart) {
          const jsonString = response.content.substring(jsonStart, jsonEnd);
          const extractedIndicators = JSON.parse(jsonString);
          
          if (Array.isArray(extractedIndicators) && extractedIndicators.length > 0) {
            availableIndicators = extractedIndicators;
          }
        }
      } catch (error) {
        console.warn('Could not extract indicators automatically - using defaults');
        // Use default indicators if extraction fails
        availableIndicators = ['RSI', 'MACD', 'Moving Average', 'Bollinger Bands', 'Stochastic Oscillator'];
      }
    }
    
    // Define strategy base from options or interactive prompts
    let strategy: InteractiveBuilderResult['strategy'];
    
    if (options.interactive) {
      console.log(chalk.cyan('\n📈 Interactive Strategy Builder\n'));
      console.log(chalk.gray('Let\'s build your trading strategy step by step.\n'));
      
      // Get strategy name
      const { strategyName } = await inquirer.prompt([
        {
          type: 'input',
          name: 'strategyName',
          message: 'Enter a name for your trading strategy:',
          default: options.strategyName || 'CustomTradingStrategy',
          validate: (input) => input.trim().length > 0 ? true : 'Strategy name is required'
        }
      ]);
      
      // Get strategy description
      const { description } = await inquirer.prompt([
        {
          type: 'editor',
          name: 'description',
          message: 'Describe your trading strategy:',
          default: options.description || 'A customized trading strategy for cryptocurrency markets.'
        }
      ]);
      
      // Timeframes selection
      const availableTimeframes = ['1m', '5m', '15m', '30m', '1h', '4h', '6h', '12h', '1d', '3d', '1w', '1M'];
      
      const { timeframes } = await inquirer.prompt([
        {
          type: 'checkbox',
          name: 'timeframes',
          message: 'Select timeframes for your strategy:',
          choices: availableTimeframes,
          default: options.timeframes || ['1h', '4h', '1d'],
          validate: (input) => input.length > 0 ? true : 'At least one timeframe is required'
        }
      ]);
      
      // Get indicators based on available plugins or let user input
      let finalIndicators = [...availableIndicators];
      
      // Add option for custom indicator
      finalIndicators.push('Custom (specify your own)');
      
      // Select indicators
      const { selectedIndicators } = await inquirer.prompt([
        {
          type: 'checkbox',
          name: 'selectedIndicators',
          message: 'Select indicators for your strategy:',
          choices: finalIndicators,
          default: options.indicators || finalIndicators.slice(0, 3),
          validate: (input) => input.length > 0 ? true : 'At least one indicator is required',
          pageSize: 15
        }
      ]);
      
      // Handle custom indicators
      if (selectedIndicators.includes('Custom (specify your own)')) {
        const { customIndicators } = await inquirer.prompt([
          {
            type: 'input',
            name: 'customIndicators',
            message: 'Enter your custom indicators (comma-separated):',
            validate: (input) => input.trim().length > 0 ? true : 'At least one custom indicator is required'
          }
        ]);
        
        // Remove the "Custom" option and add the actual custom indicators
        finalIndicators = finalIndicators.filter(i => i !== 'Custom (specify your own)');
        finalIndicators = [...finalIndicators, ...customIndicators.split(',').map((i: string) => i.trim())];
      }
      
      // Store the strategy base
      strategy = {
        name: strategyName,
        description,
        timeframes,
        indicators: finalIndicators,
        parameters: {} // Will be populated later
      };
      
      // Get strategy parameters based on the selected indicators
      console.log(chalk.cyan('\nDefining Strategy Parameters'));
      
      spinner.start('Generating parameters based on your selections...');
      
      const paramPrompt = `
Create parameters for a ${strategy.name} trading strategy.

The strategy has these characteristics:
- Timeframes: ${strategy.timeframes.join(', ')}
- Indicators: ${strategy.indicators.join(', ')}
- Description: ${strategy.description}

Generate appropriate trading parameters for this strategy, formatted as a valid JSON object where each key is a parameter name and the value is an object with:
- description: A concise description of what the parameter does
- default: A reasonable default value (number, string, or boolean)
- type: The parameter type ("number", "string", or "boolean")

Example format:
{
  "parameterName": {
    "description": "What this parameter does",
    "default": 50,
    "type": "number"
  },
  "anotherParameter": {
    "description": "Purpose of this parameter",
    "default": true,
    "type": "boolean"
  }
}

Include 4-6 parameters that would be most useful for this specific strategy, such as thresholds, periods, or multipliers.
`;
      
      try {
        // Add a timeout to prevent hanging
        const paramTimeoutMs = 30000; // 30 seconds
        const paramTimeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Parameter generation timed out')), paramTimeoutMs)
        );
        
        const paramResponsePromise = llmProvider.prompt(paramPrompt, {
          temperature: 0.3,
          maxTokens: 1200
        });
        
        // Race the response against the timeout
        const response = await Promise.race([paramResponsePromise, paramTimeoutPromise]) as any;
        
        // Parse the JSON response
        const jsonString = extractJsonFromText(response.content);
        if (jsonString) {
          strategy.parameters = JSON.parse(jsonString);
        } else {
          throw new Error('Failed to parse parameters from LLM response');
        }
      } catch (error) {
        console.warn(`Failed to generate parameters: ${error instanceof Error ? error.message : String(error)}`);
        
        // Use default parameters if failed to generate
        strategy.parameters = {
          entryThreshold: {
            description: 'Threshold for entry signals',
            default: 70,
            type: 'number'
          },
          exitThreshold: {
            description: 'Threshold for exit signals',
            default: 30,
            type: 'number'
          },
          stopLossPercentage: {
            description: 'Stop loss as percentage of entry price',
            default: 5,
            type: 'number'
          },
          takeProfitPercentage: {
            description: 'Take profit as percentage of entry price',
            default: 10,
            type: 'number'
          }
        };
      }
      
      spinner.succeed('Strategy parameters generated');
      
      // Allow user to customize parameters
      console.log(chalk.cyan('\nCustomize Strategy Parameters'));
      
      // Display generated parameters
      console.log(chalk.gray('\nGenerated parameters:'));
      for (const [paramName, paramConfig] of Object.entries(strategy.parameters)) {
        console.log(chalk.white(`- ${paramName}: ${paramConfig.description} (Default: ${paramConfig.default})`));
      }
      
      // Ask if user wants to customize
      const { customizeParams } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'customizeParams',
          message: 'Do you want to customize any parameters?',
          default: false
        }
      ]);
      
      if (customizeParams) {
        const paramChoices = Object.keys(strategy.parameters).map(param => ({
          name: `${param}: ${strategy.parameters[param].description}`,
          value: param
        }));
        
        const { paramsToCustomize } = await inquirer.prompt([
          {
            type: 'checkbox',
            name: 'paramsToCustomize',
            message: 'Select parameters to customize:',
            choices: paramChoices
          }
        ]);
        
        for (const param of paramsToCustomize) {
          const paramConfig = strategy.parameters[param];
          const defaultValue = paramConfig.default;
          
          let promptType: string;
          switch (paramConfig.type) {
          case 'number':
            promptType = 'number';
            break;
          case 'boolean':
            promptType = 'confirm';
            break;
          default:
            promptType = 'input';
          }
          
          const { value } = await inquirer.prompt([
            {
              type: promptType,
              name: 'value',
              message: `Enter value for ${param} (${paramConfig.description}):`,
              default: defaultValue
            }
          ]);
          
          // Update the parameter value
          paramConfig.default = value;
        }
      }
    } else {
      // Non-interactive mode, use provided options
      strategy = {
        name: options.strategyName || 'DefaultStrategy',
        description: options.description || 'A default trading strategy',
        timeframes: options.timeframes || ['1h', '4h'],
        indicators: options.indicators || ['RSI', 'Moving Average'],
        parameters: {}
      };
      
      // Generate parameters for non-interactive mode
      spinner.start('Generating strategy parameters...');
      
      try {
        const paramPrompt = `
Create parameters for a ${strategy.name} trading strategy.

The strategy has these characteristics:
- Timeframes: ${strategy.timeframes.join(', ')}
- Indicators: ${strategy.indicators.join(', ')}
- Description: ${strategy.description}

Generate appropriate trading parameters for this strategy, formatted as a valid JSON object where each key is a parameter name and the value is an object with:
- description: A concise description of what the parameter does
- default: A reasonable default value (number, string, or boolean)
- type: The parameter type ("number", "string", or "boolean")

Include 4-6 parameters that would be most useful for this specific strategy, such as thresholds, periods, or multipliers.
`;

        // Add a timeout to prevent hanging
        const paramTimeoutMs = 30000; // 30 seconds
        const paramTimeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Parameter generation timed out')), paramTimeoutMs)
        );

        const paramResponsePromise = llmProvider.prompt(paramPrompt, {
          temperature: 0.2,
          max_tokens: 1000
        });

        // Race the response against the timeout
        const response = await Promise.race([paramResponsePromise, paramTimeoutPromise]) as any;

        // Parse the JSON response
        const jsonString = extractJsonFromText(response.content);
        if (jsonString) {
          strategy.parameters = JSON.parse(jsonString);
          spinner.succeed('Strategy parameters generated');
        } else {
          throw new Error('Failed to parse parameters from LLM response');
        }
      } catch (error) {
        console.warn(`Failed to generate parameters: ${error instanceof Error ? error.message : String(error)}`);
        spinner.warn('Using default parameters');
        
        // Use default parameters if failed to generate
        strategy.parameters = {
          entryThreshold: {
            description: 'Threshold for entry signals',
            default: 70,
            type: 'number'
          },
          exitThreshold: {
            description: 'Threshold for exit signals',
            default: 30,
            type: 'number'
          },
          stopLossPercentage: {
            description: 'Stop loss as percentage of entry price',
            default: 5,
            type: 'number'
          },
          takeProfitPercentage: {
            description: 'Take profit as percentage of entry price',
            default: 10,
            type: 'number'
          }
        };
      }
    }
    
    // After the strategy has been defined but before generating code
    await enhanceCharacterForTrading(
      // Extract the base project path from outputDir by removing '/strategies'
      options.outputDir ? path.dirname(options.outputDir) : process.cwd(),
      strategy, 
      llmProvider
    );
    
    // Skip code implementation generation
    spinner.info('Skipping code implementation generation');
    
    // Return the strategy without implementation
    return {
      strategy: {
        name: strategy.name,
        description: strategy.description,
        timeframes: strategy.timeframes,
        indicators: strategy.indicators,
        parameters: strategy.parameters
      }
      // No implementation field
    };
  } catch (error) {
    spinner.fail(`Strategy generation failed: ${error instanceof Error ? error.message : String(error)}`);
    throw new Error('Strategy generation failed');
  }
}
