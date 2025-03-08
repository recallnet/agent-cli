import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import fs from 'fs';
import path from 'path';

import { LlmProviderFactory } from '../llm/provider.js';
import { McpClient } from '../mcp/client.js';
import { PluginRegistry } from '../plugins/registry.js';

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
  implementation: string;
  filePath?: string;
}

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
    const pluginRegistry = new PluginRegistry();
    spinner.succeed('Strategy builder initialized');
    
    // Get plugin documentation for relevant plugins
    spinner.start('Fetching plugin documentation...');
    const pluginDocs = [];
    
    if (options.targetPlugins && options.targetPlugins.length > 0) {
      for (const pluginName of options.targetPlugins) {
        try {
          const pluginInfo = await pluginRegistry.getPlugin(pluginName);
          if (pluginInfo) {
            pluginDocs.push({
              name: pluginName,
              description: pluginInfo.description,
              version: pluginInfo.version,
              documentation: pluginInfo.documentation || 'No documentation available'
            });
          }
        } catch (error) {
          console.warn(`Failed to get documentation for plugin ${pluginName}`);
        }
      }
    }
    
    spinner.succeed(`Fetched documentation for ${pluginDocs.length} plugins`);
    
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
      let availableIndicators: string[] = [];
      
      if (pluginDocs.length > 0) {
        // If we have plugin info, suggest indicators based on them
        spinner.start('Analyzing available plugins for indicators...');
        
        const pluginContext = pluginDocs.map(plugin => 
          `Plugin: ${plugin.name}\nDescription: ${plugin.description}\nDocumentation: ${plugin.documentation}`
        ).join('\n\n');
        
        const indicatorPrompt = `
Based on the following plugin documentation, identify relevant technical indicators that could be used in a trading strategy:

${pluginContext}

Extract a list of technical indicators from these plugins. 
Only list indicators that are actually available in these plugins, don't make anything up.
Format your response as a JSON array of strings: ["Indicator1", "Indicator2", ...]`;
        
        try {
          const response = await llmProvider.prompt(indicatorPrompt);
          
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
          console.warn('Failed to extract indicators from plugins');
        }
        
        spinner.succeed('Analyzed plugins for indicators');
      }
      
      // If we couldn't get indicators from plugins, use a default set
      if (availableIndicators.length === 0) {
        availableIndicators = [
          'RSI (Relative Strength Index)',
          'MACD (Moving Average Convergence Divergence)',
          'Bollinger Bands',
          'Moving Average (Simple)',
          'Moving Average (Exponential)',
          'Stochastic Oscillator',
          'Volume',
          'ATR (Average True Range)',
          'Ichimoku Cloud',
          'OBV (On-Balance Volume)'
        ];
      }
      
      // Add option for custom indicator
      availableIndicators.push('Custom (specify your own)');
      
      // Select indicators
      const { selectedIndicators } = await inquirer.prompt([
        {
          type: 'checkbox',
          name: 'selectedIndicators',
          message: 'Select indicators for your strategy:',
          choices: availableIndicators,
          default: options.indicators || availableIndicators.slice(0, 3),
          validate: (input) => input.length > 0 ? true : 'At least one indicator is required',
          pageSize: 15
        }
      ]);
      
      // Handle custom indicators
      let finalIndicators = [...selectedIndicators];
      
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
Create parameters for a trading strategy with the following characteristics:
- Name: ${strategy.name}
- Description: ${strategy.description}
- Timeframes: ${strategy.timeframes.join(', ')}
- Indicators: ${strategy.indicators.join(', ')}

Generate appropriate parameters for this strategy that would allow customization of its behavior.
For each parameter, include:
- Name
- Description
- Default value
- Type (number, boolean, string, etc.)

Format your response as a JSON object:
{
  "paramName1": {
    "description": "Description of parameter 1",
    "default": defaultValue,
    "type": "number"
  },
  "paramName2": {
    "description": "Description of parameter 2",
    "default": defaultValue,
    "type": "boolean"
  }
}

Include at least parameters for:
- Entry and exit conditions
- Risk management settings
- Indicator configuration
`;
      
      try {
        const response = await llmProvider.prompt(paramPrompt);
        
        // Extract JSON from response
        const jsonStart = response.content.indexOf('{');
        const jsonEnd = response.content.lastIndexOf('}') + 1;
        
        if (jsonStart >= 0 && jsonEnd > jsonStart) {
          const jsonString = response.content.substring(jsonStart, jsonEnd);
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
    }
    
    // Generate strategy implementation
    console.log(chalk.cyan('\nGenerating Strategy Implementation'));
    
    spinner.start('Generating strategy code...');
    
    const pluginImports = pluginDocs.map(plugin => plugin.name).join(', ');
    
    const codePrompt = `
Create a TypeScript implementation for a crypto trading strategy with the following specifications:
- Name: ${strategy.name}
- Description: ${strategy.description}
- Timeframes: ${strategy.timeframes.join(', ')}
- Indicators: ${strategy.indicators.join(', ')}
- Parameters: ${JSON.stringify(strategy.parameters, null, 2)}
${pluginDocs.length > 0 ? `- Available Plugins: ${pluginImports}` : ''}

Generate a complete TypeScript file that implements this strategy. 
The strategy should:
1. Import necessary dependencies
2. Define a class that implements the strategy logic
3. Include methods for initialization, processing data, and generating signals
4. Properly use the specified indicators
5. Handle different timeframes
6. Use the defined parameters with their default values
7. Include appropriate comments

For each indicator, implement the calculation logic or use appropriate libraries.
Make the code clean, well-structured, and performant.

Start the file with appropriate imports and end with exports.
`;
    
    let implementation = '';
    try {
      const response = await llmProvider.generateCode(codePrompt, 'typescript');
      implementation = response.content;
    } catch (error) {
      spinner.fail(`Failed to generate code: ${error instanceof Error ? error.message : String(error)}`);
      throw new Error('Strategy generation failed');
    }
    
    spinner.succeed('Strategy implementation generated');
    
    // Save the strategy if output directory is provided
    let filePath: string | undefined;
    
    if (options.outputDir) {
      try {
        // Create output directory if it doesn't exist
        if (!fs.existsSync(options.outputDir)) {
          fs.mkdirSync(options.outputDir, { recursive: true });
        }
        
        // Create safe filename from strategy name
        const safeFileName = strategy.name
          .toLowerCase()
          .replace(/[^a-z0-9]/g, '-')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '');
        
        // Save strategy implementation
        filePath = path.join(options.outputDir, `${safeFileName}.ts`);
        fs.writeFileSync(filePath, implementation);
        
        // Save strategy definition
        const strategyJsonPath = path.join(options.outputDir, `${safeFileName}.json`);
        fs.writeFileSync(strategyJsonPath, JSON.stringify(strategy, null, 2));
        
        // Save session information
        const sessionData = {
          timestamp: new Date().toISOString(),
          strategy,
          options,
          pluginDocs: pluginDocs.map(p => p.name)
        };
        const sessionPath = path.join(options.outputDir, `${safeFileName}-session.json`);
        fs.writeFileSync(sessionPath, JSON.stringify(sessionData, null, 2));
        
        console.log(chalk.green(`\nStrategy saved to: ${filePath}`));
        console.log(chalk.green(`Strategy definition saved to: ${strategyJsonPath}`));
        console.log(chalk.green(`Session information saved to: ${sessionPath}`));
      } catch (error) {
        console.error(`Failed to save strategy: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    
    // Return the result
    return {
      strategy,
      implementation,
      filePath
    };
  } catch (error) {
    console.error(`Strategy building failed: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}
