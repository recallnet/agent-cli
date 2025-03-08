import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import path from 'path';
import fs from 'fs';
import { buildStrategyInteractively } from '../strategy/interactive-builder.js';
import { StrategyType } from '../strategy/generator.js';

/**
 * Build a strategy with interactive assistance
 */
export async function buildStrategy(options: any) {
  try {
    // Default output path if not specified
    const outputPath = options.output || process.cwd();
    
    // Set up options for the strategy builder
    const builderOptions = {
      outputFormat: options.starterKit ? 'starter-kit' as const : 'standard' as const,
      interactive: true,
      targetPlugins: options.plugins ? options.plugins.split(',') : undefined
    };
    
    // Run the interactive strategy builder
    const result = await buildStrategyInteractively(builderOptions);
    
    // Save the strategy in the specified format
    const spinner = ora('Saving strategy...').start();
    
    // Create strategy directory if it doesn't exist
    const strategyDir = path.join(outputPath, 'strategies');
    if (!fs.existsSync(strategyDir)) {
      fs.mkdirSync(strategyDir, { recursive: true });
    }
    
    // Generate safe filename from strategy name
    const safeName = result.strategy.name.toLowerCase().replace(/[^a-z0-9]/g, '-');
    
    // Save the strategy JSON
    const strategyJsonPath = path.join(strategyDir, `${safeName}.json`);
    fs.writeFileSync(strategyJsonPath, JSON.stringify(result.strategy, null, 2));
    
    // Save the strategy implementation
    const strategyCodePath = path.join(strategyDir, `${safeName}.ts`);
    fs.writeFileSync(strategyCodePath, result.implementation.code);
    
    // Save the session history for future reference
    const sessionHistoryPath = path.join(strategyDir, `${safeName}-session.json`);
    fs.writeFileSync(sessionHistoryPath, JSON.stringify(result.session, null, 2));
    
    // If starter kit format, save the config
    if (result.starterKitConfig) {
      const configPath = path.join(strategyDir, `${safeName}-config.json`);
      fs.writeFileSync(configPath, JSON.stringify(result.starterKitConfig, null, 2));
    }
    
    spinner.succeed('Strategy saved successfully');
    
    console.log(chalk.green('\nStrategy files created:'));
    console.log(chalk.cyan(`- Strategy JSON: ${strategyJsonPath}`));
    console.log(chalk.cyan(`- Strategy Code: ${strategyCodePath}`));
    console.log(chalk.cyan(`- Session History: ${sessionHistoryPath}`));
    if (result.starterKitConfig) {
      console.log(chalk.cyan(`- Starter Kit Config: ${path.join(strategyDir, `${safeName}-config.json`)}`));
    }
    
    console.log(chalk.green('\nNext steps:'));
    console.log(chalk.white('1. Review and edit the strategy code if needed'));
    console.log(chalk.white('2. Create an agent with this strategy:'));
    console.log(chalk.gray(`   recall-cli agent create --strategy ${path.join(strategyDir, `${safeName}.json`)}`));
    
  } catch (error) {
    console.error(chalk.red(`Error building strategy: ${error instanceof Error ? error.message : String(error)}`));
  }
}

/**
 * Export a strategy to a different format
 */
export async function exportStrategy(strategyPath: string, options: any) {
  const spinner = ora('Exporting strategy...').start();
  
  try {
    // Check if the strategy file exists
    if (!fs.existsSync(strategyPath)) {
      spinner.fail(`Strategy file not found: ${strategyPath}`);
      return;
    }
    
    // Load the strategy
    const strategy = JSON.parse(fs.readFileSync(strategyPath, 'utf-8'));
    
    // Determine export format
    const format = options.format || 'starter-kit';
    
    // Determine output path
    const outputPath = options.output || path.dirname(strategyPath);
    
    // Generate filename based on strategy name
    const safeName = strategy.name.toLowerCase().replace(/[^a-z0-9]/g, '-');
    
    if (format === 'starter-kit') {
      // Create a starter kit compatible configuration
      const starterKitConfig = {
        strategy: {
          name: strategy.name,
          type: getStrategyTypeFromName(strategy.name),
          config: {
            indicators: strategy.indicators,
            timeframes: strategy.timeframes,
            riskParams: strategy.riskParameters
          }
        },
        plugins: [
          'crypto-market-data',
          'trading-signals',
          'risk-management'
        ],
        execution: {
          mode: 'continuous',
          interval: getDefaultIntervalFromTimeframes(strategy.timeframes)
        }
      };
      
      // Save the config
      const configPath = path.join(outputPath, `${safeName}-starter-kit-config.json`);
      fs.writeFileSync(configPath, JSON.stringify(starterKitConfig, null, 2));
      
      spinner.succeed(`Strategy exported to Starter Kit format: ${configPath}`);
    } else {
      spinner.fail(`Unsupported export format: ${format}`);
    }
  } catch (error) {
    spinner.fail(`Failed to export strategy: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Get strategy type from name
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

/**
 * Register strategy commands with the CLI
 */
export function strategyCommand(program: Command): Command {
  const strategy = program
    .command('strategy')
    .description('Create and manage trading strategies');
  
  strategy
    .command('build')
    .description('Build a trading strategy with AI assistance')
    .option('-o, --output <dir>', 'Output directory for the strategy files')
    .option('-p, --plugins <plugins>', 'Comma-separated list of plugins to include (overrides AI recommendations)')
    .option('-s, --starter-kit', 'Create a Starter Kit compatible strategy', false)
    .action(buildStrategy);
  
  strategy
    .command('export <path>')
    .description('Export a strategy to a different format')
    .option('-f, --format <format>', 'Export format (starter-kit)', 'starter-kit')
    .option('-o, --output <dir>', 'Output directory for exported strategy')
    .action(exportStrategy);
  
  return strategy;
} 