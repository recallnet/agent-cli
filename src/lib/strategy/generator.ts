import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { LlmProviderFactory } from '../llm/provider.js';

/**
 * Strategy description for trading agents
 */
export interface StrategyDescription {
  name: string;
  description: string;
  indicators: string[];
  conditions: string[];
  timeframes: string[];
  riskParameters: Record<string, string>;
}

/**
 * Strategy code implementation
 */
export interface StrategyImplementation {
  code: string;
  imports: string[];
  functions: string[];
  configuration: Record<string, any>;
}

/**
 * Strategy type enum
 */
export enum StrategyType {
  MOMENTUM = 'momentum',
  MEAN_REVERSION = 'meanReversion',
  ARBITRAGE = 'arbitrage',
  CUSTOM = 'custom'
}

/**
 * Get a basic strategy description based on strategy type
 */
export function getBaseStrategy(type: string, customDescription?: string): StrategyDescription {
  switch (type) {
  case StrategyType.MOMENTUM:
    return {
      name: 'Momentum Strategy',
      description: 'A strategy that follows the trend, buying when prices are rising and selling when they are falling',
      indicators: ['Moving Average Convergence Divergence (MACD)', 'Relative Strength Index (RSI)', 'Volume'],
      conditions: [
        'Enter long when MACD crosses above signal line',
        'Enter short when MACD crosses below signal line',
        'Confirm with RSI above 50 for longs, below 50 for shorts',
        'Ensure sufficient volume to validate the move'
      ],
      timeframes: ['1h', '4h', '1d'],
      riskParameters: {
        'stopLossPercent': '2%',
        'takeProfitPercent': '6%',
        'maxPositionSize': '5%'
      }
    };
      
  case StrategyType.MEAN_REVERSION:
    return {
      name: 'Mean Reversion Strategy',
      description: 'A strategy that assumes prices will revert to their historical mean after deviating significantly',
      indicators: ['Bollinger Bands', 'RSI', 'ATR (Average True Range)'],
      conditions: [
        'Enter long when price touches lower Bollinger Band and RSI is below 30',
        'Enter short when price touches upper Bollinger Band and RSI is above 70',
        'Set stop loss based on ATR multiple',
        'Take profit when price reverts to the mean (middle Bollinger Band)'
      ],
      timeframes: ['15m', '1h', '4h'],
      riskParameters: {
        'stopLossATRMultiple': '3',
        'maxPositionSize': '3%',
        'minRewardRiskRatio': '1.5'
      }
    };
      
  case StrategyType.ARBITRAGE:
    return {
      name: 'Exchange Arbitrage Strategy',
      description: 'A strategy that exploits price differences between different exchanges',
      indicators: ['Price difference', 'Trading volume', 'Transaction costs'],
      conditions: [
        'Enter when price difference between exchanges exceeds transaction costs',
        'Consider exchange withdrawal/deposit times',
        'Validate sufficient liquidity on both exchanges',
        'Exit when the price gap closes or reaches target'
      ],
      timeframes: ['1m', '5m', '15m'],
      riskParameters: {
        'minPriceDifferencePercent': '1%',
        'maxExposure': '10%',
        'maxPositionDuration': '30m'
      }
    };
      
  case StrategyType.CUSTOM:
    return {
      name: 'Custom Strategy',
      description: customDescription || 'A custom trading strategy',
      indicators: [],
      conditions: [],
      timeframes: [],
      riskParameters: {}
    };
      
  default:
    return {
      name: `${type} Strategy`,
      description: customDescription || `A trading strategy based on ${type}`,
      indicators: [],
      conditions: [],
      timeframes: [],
      riskParameters: {}
    };
  }
}

/**
 * Generate a detailed strategy with LLM assistance
 */
export async function generateStrategyWithAI(
  strategyType: string,
  customDescription?: string
): Promise<StrategyDescription> {
  // Get the base strategy
  const baseStrategy = getBaseStrategy(strategyType, customDescription);
  
  // Try to enhance it with AI
  const provider = LlmProviderFactory.createFromConfig();
  
  if (!provider) {
    console.log(chalk.yellow('No LLM provider configured. Using default strategy.'));
    return baseStrategy;
  }
  
  console.log(chalk.yellow('Using AI to enhance trading strategy...'));
  
  const prompt = `I need to create a detailed cryptocurrency trading strategy based on the following:

Strategy Type: ${strategyType}
${customDescription ? `Custom Description: ${customDescription}` : ''}

Base Strategy Information:
- Name: ${baseStrategy.name}
- Description: ${baseStrategy.description}
- Indicators: ${baseStrategy.indicators.join(', ')}
- Conditions: ${baseStrategy.conditions.join(', ')}
- Timeframes: ${baseStrategy.timeframes.join(', ')}

Please enhance this strategy with more specific and detailed information, including:
1. More sophisticated indicators and how they should be used
2. Precise entry and exit conditions
3. Risk management parameters
4. Optimal timeframes for different market conditions
5. Any specific cryptocurrency preferences

Your response should be in JSON format, matching this structure:
{
  "name": "Strategy Name",
  "description": "Detailed strategy description",
  "indicators": ["Indicator1", "Indicator2", "Indicator3"],
  "conditions": ["Detailed condition 1", "Detailed condition 2", "Detailed condition 3"],
  "timeframes": ["Timeframe1", "Timeframe2", "Timeframe3"],
  "riskParameters": {
    "param1": "value1",
    "param2": "value2"
  }
}`;
  
  try {
    const response = await provider.prompt(prompt, { temperature: 0.7 });
    const enhancedStrategy = JSON.parse(response.content);
    
    return {
      name: enhancedStrategy.name || baseStrategy.name,
      description: enhancedStrategy.description || baseStrategy.description,
      indicators: enhancedStrategy.indicators || baseStrategy.indicators,
      conditions: enhancedStrategy.conditions || baseStrategy.conditions,
      timeframes: enhancedStrategy.timeframes || baseStrategy.timeframes,
      riskParameters: enhancedStrategy.riskParameters || baseStrategy.riskParameters
    };
  } catch (error) {
    console.log(chalk.yellow(`AI enhancement failed: ${error instanceof Error ? error.message : String(error)}. Using default strategy.`));
    return baseStrategy;
  }
}

/**
 * Generate code implementation for a strategy
 */
export async function generateStrategyImplementation(
  strategy: StrategyDescription,
  plugins: string[]
): Promise<StrategyImplementation> {
  // Try to generate code with AI
  const provider = LlmProviderFactory.createFromConfig();
  
  if (!provider) {
    console.log(chalk.yellow('No LLM provider configured. Using template strategy implementation.'));
    return getTemplateImplementation(strategy, plugins);
  }
  
  console.log(chalk.yellow('Using AI to generate strategy code...'));
  
  const prompt = `Generate TypeScript code for a cryptocurrency trading strategy with the following characteristics:

Strategy Name: ${strategy.name}
Description: ${strategy.description}
Indicators: ${strategy.indicators.join(', ')}
Entry/Exit Conditions: ${strategy.conditions.join(', ')}
Timeframes: ${strategy.timeframes.join(', ')}
Risk Parameters: ${Object.entries(strategy.riskParameters).map(([k, v]) => `${k}: ${v}`).join(', ')}

Available Plugins: ${plugins.join(', ')}

Please generate complete, functional TypeScript code (in an Eliza plugin format) that:
1. Imports necessary dependencies and plugins
2. Defines the strategy logic based on the conditions
3. Implements risk management based on the parameters
4. Provides a main function that runs the strategy

Your code should work with the Eliza plugin system and be ready to be placed in src/index.ts.`;
  
  try {
    const response = await provider.generateCode(prompt, 'typescript');
    
    return {
      code: response.content,
      imports: extractImports(response.content),
      functions: extractFunctions(response.content),
      configuration: {}
    };
  } catch (error) {
    console.log(chalk.yellow(`AI code generation failed: ${error instanceof Error ? error.message : String(error)}. Using template implementation.`));
    return getTemplateImplementation(strategy, plugins);
  }
}

/**
 * Save a strategy implementation to a file
 */
export function saveStrategyImplementation(
  implementation: StrategyImplementation,
  projectPath: string
): string {
  // Create the src directory if it doesn't exist
  const srcDir = path.join(projectPath, 'src');
  if (!fs.existsSync(srcDir)) {
    fs.mkdirSync(srcDir, { recursive: true });
  }
  
  // Write the strategy file
  const filename = path.join(srcDir, 'index.ts');
  fs.writeFileSync(filename, implementation.code);
  
  return filename;
}

/**
 * Extract imports from code string
 */
function extractImports(code: string): string[] {
  const importRegex = /import\s+.*?from\s+['"].*?['"]/g;
  return code.match(importRegex) || [];
}

/**
 * Extract function names from code string
 */
function extractFunctions(code: string): string[] {
  const functionRegex = /function\s+(\w+)/g;
  const matches = code.matchAll(functionRegex);
  return Array.from(matches, m => m[1]);
}

/**
 * Get a template implementation based on the strategy
 */
function getTemplateImplementation(strategy: StrategyDescription, plugins: string[] = []): StrategyImplementation {
  // Generate dynamic imports based on the selected plugins
  const pluginImports = plugins.map(plugin => {
    // Convert plugin name to a likely class name (camelCase)
    const className = plugin
      .split('-')
      .map((part, i) => i === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1))
      .join('');
    
    return `import { ${className.charAt(0).toUpperCase() + className.slice(1)} } from '@elizaos-plugins/${plugin}';`;
  }).join('\n');

  // Determine strategy type for component generation
  let strategyType = StrategyType.CUSTOM;
  if (strategy.name.toLowerCase().includes('momentum')) {
    strategyType = StrategyType.MOMENTUM;
  } else if (strategy.name.toLowerCase().includes('mean') || strategy.name.toLowerCase().includes('reversion')) {
    strategyType = StrategyType.MEAN_REVERSION;
  } else if (strategy.name.toLowerCase().includes('arbitrage')) {
    strategyType = StrategyType.ARBITRAGE;
  }

  const templateCode = `${pluginImports}${pluginImports ? '\n\n' : ''}/**
 * ${strategy.name}
 * ${strategy.description}
 */
export async function runStrategy() {
  // Initialize strategy components
  console.log('Initializing strategy: ${strategy.name}');
  
  // Your strategy implementation goes here
  // This is a placeholder - it should be customized based on your specific strategy
  
${getStrategyComponentsFromType(strategyType)}
  
  console.log('Strategy execution complete');
  return { success: true };
}

/**
 * Main function - entry point
 */
export async function main() {
  try {
    console.log('Starting trading strategy');
    await runStrategy();
  } catch (error) {
    console.error('Strategy execution failed:', error);
  }
}`;

  return {
    code: templateCode,
    imports: extractImports(templateCode),
    functions: extractFunctions(templateCode),
    configuration: {
      timeframes: strategy.timeframes,
      indicators: strategy.indicators,
      riskParameters: strategy.riskParameters
    }
  };
}

/**
 * Generate a strategy based on competition guidelines
 */
export async function generateStrategyFromCompetition(
  competitionContent: string,
  provider: any
): Promise<StrategyDescription> {
  console.log(chalk.yellow('Using AI to generate strategy from competition guidelines...'));
  
  const prompt = `Analyze the following cryptocurrency trading competition guidelines and create a detailed trading strategy that would perform well according to these rules:

${competitionContent}

Please pay special attention to:
1. The competition timeframe and evaluation periods
2. The available markets/trading pairs
3. Trading rules, especially position sizes, leverage, and frequency limits
4. Performance metrics and how they're weighted
5. Any specific technical requirements
6. Required data sources and API limitations

Based on this analysis, create a detailed and optimized trading strategy. Your response should be in JSON format, matching this structure:
{
  "name": "Strategy Name",
  "description": "Detailed strategy description",
  "indicators": ["Indicator1", "Indicator2", "Indicator3"],
  "conditions": ["Detailed condition 1", "Detailed condition 2", "Detailed condition 3"],
  "timeframes": ["Timeframe1", "Timeframe2", "Timeframe3"],
  "riskParameters": {
    "param1": "value1",
    "param2": "value2"
  }
}

Make sure all aspects of your strategy comply with the competition rules and are optimized for the specified performance metrics.`;
  
  try {
    const response = await provider.prompt(prompt, { temperature: 0.7 });
    let strategyJson: Partial<StrategyDescription> = {
      name: '',
      description: '',
      indicators: [],
      conditions: [],
      timeframes: [],
      riskParameters: {}
    };
    
    try {
      // Try to find the JSON in the response
      const jsonStartIdx = response.content.indexOf('{');
      const jsonEndIdx = response.content.lastIndexOf('}') + 1;
      
      if (jsonStartIdx === -1 || jsonEndIdx <= jsonStartIdx) {
        throw new Error('No valid JSON found in the response');
      }
      
      const jsonStr = response.content.substring(jsonStartIdx, jsonEndIdx);
      strategyJson = JSON.parse(jsonStr);
    } catch (jsonError) {
      console.log(chalk.yellow('Failed to parse JSON from LLM response. Using fallback method.'));
      
      // Fallback: Try to extract the strategy information using regex
      const nameMatch = /["']name["']\s*:\s*["'](.+?)["']/s.exec(response.content);
      const descMatch = /["']description["']\s*:\s*["'](.+?)["']/s.exec(response.content);
      const indicatorsMatch = /["']indicators["']\s*:\s*\[(.*?)\]/s.exec(response.content);
      const conditionsMatch = /["']conditions["']\s*:\s*\[(.*?)\]/s.exec(response.content);
      const timeframesMatch = /["']timeframes["']\s*:\s*\[(.*?)\]/s.exec(response.content);
      
      strategyJson = {
        name: nameMatch ? nameMatch[1] : 'Competition-based Strategy',
        description: descMatch ? descMatch[1] : 'A strategy optimized for the trading competition',
        indicators: indicatorsMatch ? parseJsonArray(indicatorsMatch[1]) : [],
        conditions: conditionsMatch ? parseJsonArray(conditionsMatch[1]) : [],
        timeframes: timeframesMatch ? parseJsonArray(timeframesMatch[1]) : [],
        riskParameters: {}
      };
      
      // Try to extract risk parameters too
      const riskMatch = /["']riskParameters["']\s*:\s*{(.*?)}/s.exec(response.content);
      if (riskMatch) {
        const riskStr = riskMatch[1];
        const paramPairs = riskStr.match(/["'](\w+)["']\s*:\s*["']([^"']+)["']/g) || [];
        
        paramPairs.forEach(pair => {
          const keyMatch = /["'](\w+)["']/.exec(pair);
          const valueMatch = /:\s*["']([^"']+)["']/.exec(pair);
          
          if (keyMatch && valueMatch && strategyJson.riskParameters) {
            strategyJson.riskParameters[keyMatch[1]] = valueMatch[1];
          }
        });
      }
    }
    
    // Validate and ensure all required fields are present
    return {
      name: strategyJson.name || 'Competition-based Strategy',
      description: strategyJson.description || 'A strategy optimized for the trading competition',
      indicators: strategyJson.indicators || [],
      conditions: strategyJson.conditions || [],
      timeframes: strategyJson.timeframes || [],
      riskParameters: strategyJson.riskParameters || {}
    };
  } catch (error) {
    console.log(chalk.yellow(`Strategy generation from competition failed: ${error instanceof Error ? error.message : String(error)}`));
    
    // Return a fallback strategy
    return {
      name: 'Competition-based Strategy',
      description: 'A strategy optimized for the trading competition based on competition guidelines',
      indicators: ['Moving Average (MA)', 'Relative Strength Index (RSI)', 'Volume Analysis'],
      conditions: [
        'Entry on momentum confirmation with risk controls',
        'Exit on predefined targets or stop-loss',
        'Position sizing based on competition rules'
      ],
      timeframes: ['15m', '1h', '4h'],
      riskParameters: {
        'maxPositionSizePercent': '25%',
        'stopLossPercent': '2%',
        'takeProfitPercent': '6%',
        'maxLeverage': '3'
      }
    };
  }
}

/**
 * Parse a JSON array from a string, with fallback for malformed JSON
 */
function parseJsonArray(arrayString: string): string[] {
  try {
    return JSON.parse(`[${arrayString}]`);
  } catch (error) {
    // Fallback: try to extract array items using regex
    const items: string[] = [];
    const itemMatches = arrayString.match(/["']([^"']+)["']/g) || [];
    
    for (const match of itemMatches) {
      items.push(match.replace(/["']/g, ''));
    }
    
    return items;
  }
}

/**
 * Generate strategy component code based on strategy type
 */
function getStrategyComponentsFromType(type: StrategyType): string {
  // Define all strategy components with proper indentation
  const momentumStrategy = `  // Momentum strategy typically uses trend indicators
  // Example pseudo-code:
  // 1. Analyze price momentum using selected indicators
  // 2. Generate buy signals when momentum is positive
  // 3. Generate sell signals when momentum weakens`;
  
  const meanReversionStrategy = `  // Mean reversion strategy looks for price returning to average
  // Example pseudo-code:
  // 1. Calculate moving averages or other reference points
  // 2. Generate buy signals when price is below average
  // 3. Generate sell signals when price is above average`;
  
  const arbitrageStrategy = `  // Arbitrage strategy looks for price differences across markets
  // Example pseudo-code:
  // 1. Compare prices across multiple exchanges
  // 2. Identify arbitrage opportunities
  // 3. Execute trades to capture price differences`;
  
  const customStrategy = `  // Custom strategy implementation
  // Implement your custom logic here based on your strategy description`;
  
  // Return the appropriate strategy code
  switch (type) {
  case StrategyType.MOMENTUM:
    return momentumStrategy;
  case StrategyType.MEAN_REVERSION:
    return meanReversionStrategy;
  case StrategyType.ARBITRAGE:
    return arbitrageStrategy;
  case StrategyType.CUSTOM:
  default:
    return customStrategy;
  }
} 