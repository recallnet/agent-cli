import chalk from 'chalk';
import inquirer from 'inquirer';
import { StrategyDescription, StrategyImplementation, StrategyType, getBaseStrategy, generateStrategyImplementation } from './generator.js';
import { LlmProviderFactory } from '../llm/provider.js';
import { McpServer } from '../mcp/server.js';
import { McpClient } from '../mcp/client.js';
import ora from 'ora';

/**
 * Strategy conversation step
 */
export interface StrategyConversationStep {
  id: string;
  type: 'question' | 'feedback' | 'suggestion' | 'template';
  content: string;
  response?: string;
  metadata?: Record<string, any>;
  timestamp?: number;
}

/**
 * Strategy building session
 */
export interface StrategyBuildingSession {
  sessionId: string;
  startedAt: number;
  lastUpdatedAt: number;
  steps: StrategyConversationStep[];
  currentStrategy: StrategyDescription;
  environmentSettings?: Record<string, any>;
  starterKitParams?: Record<string, any>;
}

/**
 * Strategy builder options
 */
export interface StrategyBuilderOptions {
  initialStrategy?: StrategyDescription;
  competitionData?: any;
  outputFormat?: 'starter-kit' | 'standard';
  environmentParams?: Record<string, any>;
  interactive?: boolean;
  targetPlugins?: string[];
}

/**
 * Strategy builder result
 */
export interface StrategyBuilderResult {
  strategy: StrategyDescription;
  implementation: StrategyImplementation;
  session: StrategyBuildingSession;
  starterKitConfig?: Record<string, any>;
}

/**
 * Build a trading strategy interactively with LLM assistance
 */
export async function buildStrategyInteractively(options: StrategyBuilderOptions = {}): Promise<StrategyBuilderResult> {
  // Initialize the session
  const session: StrategyBuildingSession = {
    sessionId: `strategy-${Date.now()}`,
    startedAt: Date.now(),
    lastUpdatedAt: Date.now(),
    steps: [],
    currentStrategy: options.initialStrategy || getBaseStrategy(StrategyType.CUSTOM),
    environmentSettings: options.environmentParams || {},
    starterKitParams: {}
  };

  console.log(chalk.cyan('📊 Interactive Strategy Builder'));
  console.log(chalk.gray('Let\'s create an optimized trading strategy with AI assistance.\n'));

  // Start the MCP server for context
  const spinner = ora('Starting MCP server...').start();
  const mcpServer = new McpServer();
  await mcpServer.start();

  // Create MCP client
  const mcpClient = new McpClient();

  // Create LLM provider with MCP client
  const llmProvider = LlmProviderFactory.createFromConfig(mcpClient);

  if (!llmProvider) {
    spinner.fail('No LLM provider configured. Please run `recall-cli llm setup` first.');
    await mcpServer.stop();
    throw new Error('No LLM provider configured');
  }

  spinner.succeed('Ready to build your strategy');

  try {
    // Step 1: Get the basic strategy type
    if (!options.initialStrategy) {
      const strategyTypeAnswer = await inquirer.prompt([
        {
          type: 'list',
          name: 'strategyType',
          message: 'What type of trading strategy would you like to build?',
          choices: [
            { name: 'Momentum - Based on price trends', value: StrategyType.MOMENTUM },
            { name: 'Mean Reversion - Based on price returning to average', value: StrategyType.MEAN_REVERSION },
            { name: 'Arbitrage - Based on price differences across exchanges', value: StrategyType.ARBITRAGE },
            { name: 'Custom - Define your own strategy', value: StrategyType.CUSTOM }
          ]
        }
      ]);

      // Record this step
      session.steps.push({
        id: 'strategy-type',
        type: 'question',
        content: 'What type of trading strategy would you like to build?',
        response: strategyTypeAnswer.strategyType,
        timestamp: Date.now()
      });

      // If custom, get description
      if (strategyTypeAnswer.strategyType === StrategyType.CUSTOM) {
        const customDescriptionAnswer = await inquirer.prompt([
          {
            type: 'editor',
            name: 'customDescription',
            message: 'Describe your custom strategy:',
            default: 'A trading strategy that...'
          }
        ]);

        // Record this step
        session.steps.push({
          id: 'custom-description',
          type: 'question',
          content: 'Describe your custom strategy:',
          response: customDescriptionAnswer.customDescription,
          timestamp: Date.now()
        });

        // Update the current strategy
        session.currentStrategy = getBaseStrategy(
          strategyTypeAnswer.strategyType, 
          customDescriptionAnswer.customDescription
        );
      } else {
        // Use the selected strategy type
        session.currentStrategy = getBaseStrategy(strategyTypeAnswer.strategyType);
      }
    }

    // Step 2: Get detailed parameters through a guided conversation
    const currentStrategy = session.currentStrategy;
    
    // Start the conversation with the LLM
    spinner.start('Starting strategy refinement conversation...');
    
    // Initial LLM prompt to begin the conversation
    const initialPrompt = `You are an expert cryptocurrency trading strategy developer. You're helping me refine a trading strategy with the following initial parameters:

Name: ${currentStrategy.name}
Description: ${currentStrategy.description}
Indicators: ${currentStrategy.indicators.join(', ')}
Conditions: ${currentStrategy.conditions.join(', ')}
Timeframes: ${currentStrategy.timeframes.join(', ')}
Risk Parameters: ${Object.entries(currentStrategy.riskParameters).map(([k, v]) => `${k}: ${v}`).join(', ')}

I'd like you to ask me a series of questions to help refine this strategy. For each question, provide:
1. A clear, specific question about an aspect of the strategy
2. Some context about why this aspect is important
3. 2-3 example answers to guide my thinking

Ask one question at a time. After each question, wait for my response before asking the next question.
Start with the most important aspects first, like target markets, specific indicators, and risk parameters.

Your first question:`;

    const response = await llmProvider.prompt(initialPrompt);
    spinner.succeed('Strategy conversation started');
    
    // Record this step
    session.steps.push({
      id: 'llm-initial-question',
      type: 'question',
      content: response.content,
      timestamp: Date.now()
    });
    
    // Show the first question
    console.log(chalk.cyan('\n🤔 ' + response.content));

    // Start the conversation loop
    let conversationActive = true;
    let questionCount = 0;
    const maxQuestions = 8; // Limit to prevent too long conversations
    
    while (conversationActive && questionCount < maxQuestions) {
      // Get user response
      const userAnswer = await inquirer.prompt([
        {
          type: 'input',
          name: 'response',
          message: 'Your answer:',
          validate: (input) => input.trim().length > 0 ? true : 'Please provide a response'
        }
      ]);
      
      // Record user response
      session.steps[session.steps.length - 1].response = userAnswer.response;
      
      // Ask if user wants to continue
      if (questionCount >= 2) {
        const continueAnswer = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'continue',
            message: 'Would you like more questions to refine your strategy?',
            default: questionCount < 5 // Default to yes for first few questions
          }
        ]);
        
        if (!continueAnswer.continue) {
          conversationActive = false;
          break;
        }
      }
      
      questionCount++;
      
      // Generate next question based on conversation history
      spinner.start('Processing your response...');
      
      // Create the conversation history for the LLM
      const conversationHistory = session.steps
        .filter(step => step.type === 'question')
        .map(step => `Q: ${step.content}\nA: ${step.response || '[No response yet]'}`)
        .join('\n\n');
      
      const nextQuestionPrompt = `Based on our conversation so far about refining the trading strategy:

${conversationHistory}

Based on this information, ask me the next most important question to further refine the strategy. Remember to:
1. Focus on a specific aspect that hasn't been covered
2. Provide context on why this aspect is important
3. Give 2-3 example answers

Your next question:`;

      const nextQuestionResponse = await llmProvider.prompt(nextQuestionPrompt);
      spinner.succeed('Next question ready');
      
      // Record this step
      session.steps.push({
        id: `llm-question-${questionCount}`,
        type: 'question',
        content: nextQuestionResponse.content,
        timestamp: Date.now()
      });
      
      // Show the next question
      console.log(chalk.cyan('\n🤔 ' + nextQuestionResponse.content));
    }
    
    // Step 3: Generate the final strategy based on the conversation
    spinner.start('Generating optimized strategy based on our conversation...');
    
    // Create the conversation history for the LLM
    const fullConversationHistory = session.steps
      .filter(step => step.type === 'question')
      .map(step => `Q: ${step.content}\nA: ${step.response || '[No response yet]'}`)
      .join('\n\n');
    
    const finalStrategyPrompt = `Based on our conversation about refining the trading strategy:

${fullConversationHistory}

Please generate a complete, optimized trading strategy based on this conversation. The strategy should include:

1. A clear name and description
2. Specific indicators to be used
3. Precise entry and exit conditions
4. Appropriate timeframes
5. Risk management parameters

Return the strategy in this JSON format:
{
  "name": "Strategy Name",
  "description": "Detailed strategy description",
  "indicators": ["Indicator1", "Indicator2", "Indicator3"],
  "conditions": ["Detailed condition 1", "Detailed condition 2", "Detailed condition 3", "Detailed condition 4"],
  "timeframes": ["Timeframe1", "Timeframe2"],
  "riskParameters": {
    "maxPositionSize": "X% of total portfolio value",
    "stopLossPercent": "X% below entry price for long positions, X% above entry price for short positions",
    "takeProfitPercent": "X% above entry price for long positions, X% below entry price for short positions",
    "trailingStopPercent": "Activate trailing stop loss at X% in the direction of the trade"
  }
}`;

    const finalStrategyResponse = await llmProvider.prompt(finalStrategyPrompt);
    
    // Parse the JSON response
    try {
      const jsonStart = finalStrategyResponse.content.indexOf('{');
      const jsonEnd = finalStrategyResponse.content.lastIndexOf('}') + 1;
      
      if (jsonStart === -1 || jsonEnd === 0) {
        throw new Error('JSON not found in response');
      }
      
      const jsonString = finalStrategyResponse.content.substring(jsonStart, jsonEnd);
      session.currentStrategy = JSON.parse(jsonString);
      
      spinner.succeed('Strategy generated successfully');
    } catch (error) {
      spinner.fail(`Failed to parse strategy JSON: ${error instanceof Error ? error.message : String(error)}`);
      console.log(chalk.yellow('Using partially refined strategy instead.'));
    }
    
    // Step 4: Recommend plugins based on the strategy
    spinner.start('Analyzing strategy to recommend plugins...');
    
    try {
      // Convert strategy to string format for the LLM
      const strategyDescription = `
Strategy Name: ${session.currentStrategy.name}
Description: ${session.currentStrategy.description}
Indicators: ${session.currentStrategy.indicators.join(', ')}
Conditions: ${session.currentStrategy.conditions.join(', ')}
Timeframes: ${session.currentStrategy.timeframes.join(', ')}
Risk Parameters: ${Object.entries(session.currentStrategy.riskParameters).map(([k, v]) => `${k}: ${v}`).join(', ')}
`;

      // Get plugin recommendations
      const recommendations = await llmProvider.recommendPluginsForStrategy(strategyDescription);
      
      spinner.succeed('Plugin recommendations ready');
      
      // Display recommendations
      console.log(chalk.cyan('\n🔌 Recommended Plugins:'));
      
      const pluginChoices = recommendations.map(rec => {
        const confidencePercent = Math.round(rec.confidence * 100);
        return {
          name: `${rec.name} (${confidencePercent}% confidence) - ${rec.reasoning.substring(0, 100)}...`,
          value: rec.name,
          short: rec.name
        };
      });
      
      // Add "None" option
      pluginChoices.push({
        name: 'None - I\'ll select plugins manually later',
        value: 'none',
        short: 'None'
      });
      
      // Ask user to select plugins
      const pluginSelectionAnswer = await inquirer.prompt([
        {
          type: 'checkbox',
          name: 'selectedPlugins',
          message: 'Select plugins to include with your strategy:',
          choices: pluginChoices,
          pageSize: 10
        }
      ]);
      
      // Filter out "None" option if selected with other plugins
      let selectedPlugins = pluginSelectionAnswer.selectedPlugins;
      if (selectedPlugins.includes('none') && selectedPlugins.length > 1) {
        selectedPlugins = selectedPlugins.filter((p: string) => p !== 'none');
      }
      
      // Store selected plugins in session
      if (selectedPlugins.length > 0 && !selectedPlugins.includes('none')) {
        if (!session.environmentSettings) {
          session.environmentSettings = {};
        }
        session.environmentSettings.plugins = selectedPlugins;
      }
      
    } catch (error) {
      spinner.warn(`Plugin recommendation failed: ${error instanceof Error ? error.message : String(error)}`);
      console.log(chalk.yellow('Continuing without plugin recommendations.'));
    }
    
    // Step 5: Generate the implementation code
    spinner.start('Generating strategy implementation code...');
    
    // Determine which plugins to use
    let targetPlugins: string[] = [];
    
    // Use plugins selected during recommendation step if available
    if (session.environmentSettings?.plugins && session.environmentSettings.plugins.length > 0) {
      targetPlugins = session.environmentSettings.plugins;
    } 
    // Otherwise use plugins from options if provided
    else if (options.targetPlugins && options.targetPlugins.length > 0) {
      targetPlugins = options.targetPlugins;
    } 
    // Default to common plugins if none specified
    else {
      targetPlugins = ['crypto-market-data', 'trading-signals', 'risk-management'];
    }
    
    // Generate the implementation
    const implementation = await generateStrategyImplementation(session.currentStrategy, targetPlugins);
    
    spinner.succeed('Strategy implementation generated');
    
    // Step 6: Generate Starter Kit configuration if needed
    let starterKitConfig: Record<string, any> | undefined;
    
    if (options.outputFormat === 'starter-kit') {
      spinner.start('Generating Recall Starter Kit configuration...');
      
      // This is a placeholder for future Starter Kit integration
      // We'll generate a basic config structure that can be extended later
      starterKitConfig = {
        strategy: {
          name: session.currentStrategy.name,
          type: getStrategyTypeFromName(session.currentStrategy.name),
          config: {
            indicators: session.currentStrategy.indicators,
            timeframes: session.currentStrategy.timeframes,
            riskParams: session.currentStrategy.riskParameters
          }
        },
        environment: {
          ...session.environmentSettings
        },
        plugins: targetPlugins,
        execution: {
          mode: 'continuous',
          interval: getDefaultIntervalFromTimeframes(session.currentStrategy.timeframes)
        }
      };
      
      spinner.succeed('Starter Kit configuration generated');
    }
    
    // Display the final strategy summary
    console.log(chalk.green('\n✅ Strategy Building Complete\n'));
    console.log(chalk.bold(session.currentStrategy.name));
    console.log(chalk.gray(session.currentStrategy.description));
    console.log(chalk.cyan('\nIndicators:'));
    session.currentStrategy.indicators.forEach(indicator => console.log(`- ${indicator}`));
    console.log(chalk.cyan('\nEntry/Exit Conditions:'));
    session.currentStrategy.conditions.forEach(condition => console.log(`- ${condition}`));
    console.log(chalk.cyan('\nTimeframes:'));
    session.currentStrategy.timeframes.forEach(timeframe => console.log(`- ${timeframe}`));
    console.log(chalk.cyan('\nRisk Parameters:'));
    Object.entries(session.currentStrategy.riskParameters).forEach(([key, value]) => {
      console.log(`- ${key}: ${value}`);
    });
    
    // Create result
    const result: StrategyBuilderResult = {
      strategy: session.currentStrategy,
      implementation,
      session,
      starterKitConfig
    };
    
    return result;
  } catch (error) {
    console.error(chalk.red(`Error building strategy: ${error instanceof Error ? error.message : String(error)}`));
    throw error;
  } finally {
    // Clean up
    await mcpServer.stop();
  }
}

/**
 * Get strategy type from strategy name
 */
function getStrategyTypeFromName(name: string): string {
  const lowercaseName = name.toLowerCase();
  
  if (lowercaseName.includes('momentum') || lowercaseName.includes('trend')) {
    return StrategyType.MOMENTUM;
  } else if (lowercaseName.includes('reversion') || lowercaseName.includes('mean')) {
    return StrategyType.MEAN_REVERSION;
  } else if (lowercaseName.includes('arbitrage')) {
    return StrategyType.ARBITRAGE;
  } else {
    return StrategyType.CUSTOM;
  }
}

/**
 * Get default execution interval from timeframes
 */
function getDefaultIntervalFromTimeframes(timeframes: string[]): number {
  // Find the smallest timeframe
  const timeframeMap: Record<string, number> = {
    '1m': 60,
    '5m': 300,
    '15m': 900,
    '30m': 1800,
    '1h': 3600,
    '4h': 14400,
    '1d': 86400,
  };
  
  let smallestInterval = 86400; // Default to 1 day
  
  for (const timeframe of timeframes) {
    const normalizedTimeframe = timeframe.toLowerCase().replace(' ', '');
    const seconds = timeframeMap[normalizedTimeframe];
    
    if (seconds && seconds < smallestInterval) {
      smallestInterval = seconds;
    }
  }
  
  return smallestInterval;
} 