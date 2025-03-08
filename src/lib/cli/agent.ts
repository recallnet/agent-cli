import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import * as simplegit from 'simple-git';

import { PluginRegistry } from '../plugins/registry.js';
import { generateCharacter, saveCharacter } from '../agent/character.js';
import { 
  StrategyType,
  generateStrategyWithAI, 
  generateStrategyImplementation, 
  saveStrategyImplementation,
  generateStrategyFromCompetition
} from '../strategy/generator.js';
import { McpServer } from '../mcp/server.js';
import { McpClient } from '../mcp/client.js';
import { LlmProviderFactory } from '../llm/provider.js';
import { getProjectPath } from '../utils/config-paths.js';

// Initialize plugin registry
const registry = new PluginRegistry();

/**
 * Create a new crypto trading agent
 */
export async function createAgent(options: any) {
  const spinner = ora('Setting up new crypto trading agent').start();
  
  try {
    spinner.stop();
    
    // Process competition URL if provided
    let competitionInfo = null;
    if (options.competitionUrl) {
      spinner.start(`Fetching competition information from ${chalk.cyan(options.competitionUrl)}`);
      
      // Start MCP server
      const mcpServer = new McpServer();
      await mcpServer.start();
      
      // Create MCP client
      const mcpClient = new McpClient();
      
      // Create LLM provider with MCP client
      const llmProvider = LlmProviderFactory.createFromConfig(mcpClient);
      
      if (!llmProvider) {
        spinner.fail('No LLM provider configured. Please run `recall-cli llm setup` first.');
        await mcpServer.stop();
        return;
      }
      
      try {
        // Fetch competition information from URL
        const competitionDoc = await mcpClient.getUrlDocumentation(options.competitionUrl);
        
        // Parse competition guidelines and requirements
        spinner.text = 'Analyzing competition requirements...';
        
        // Generate strategy based on competition
        const strategy = await generateStrategyFromCompetition(competitionDoc.content, llmProvider);
        
        // Get recommended plugins
        const pluginRecommendations = await llmProvider.recommendPluginsForCompetition('custom');
        
        competitionInfo = {
          content: competitionDoc.content,
          strategy,
          recommendedPlugins: pluginRecommendations.map(p => p.name)
        };
        
        spinner.succeed(`Successfully parsed competition from ${chalk.cyan(options.competitionUrl)}`);
        
        // Display summary of competition analysis
        console.log(chalk.cyan('\n🏆 Competition Analysis:'));
        console.log(chalk.white(`Strategy: ${strategy.name}`));
        console.log(chalk.white(`Description: ${strategy.description.substring(0, 150)}...`));
        console.log(chalk.cyan('\nRecommended Plugins:'));
        for (const plugin of pluginRecommendations) {
          const confidenceColor = 
            plugin.confidence > 0.8 ? chalk.green :
              plugin.confidence > 0.5 ? chalk.yellow :
                chalk.red;
            
          console.log(chalk.bold(`- ${plugin.name}`) + confidenceColor(` (Confidence: ${Math.round(plugin.confidence * 100)}%)`));
        }
        console.log();
        
        // Stop MCP server
        await mcpServer.stop();
      } catch (error) {
        spinner.fail(`Failed to parse competition URL: ${error instanceof Error ? error.message : String(error)}`);
        await mcpServer.stop();
        return;
      }
    }
    
    // Start interactive prompts for agent configuration (pre-filled with competition data if available)
    const initialAnswers = await inquirer.prompt([
      {
        type: 'input',
        name: 'name',
        message: 'Agent name:',
        default: options.name || (competitionInfo ? 'competition-trading-agent' : 'crypto-trading-agent')
      }
    ]);
    
    // Determine if we should use competition data or continue with normal flow
    let answers;
    
    if (competitionInfo) {
      // Ask if user wants to use the competition-derived strategy and plugins
      const useCompetitionSettings = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'useCompetition',
          message: 'Use the competition-derived strategy and recommended plugins?',
          default: true
        }
      ]);
      
      if (useCompetitionSettings.useCompetition) {
        // Use competition information
        answers = {
          ...initialAnswers,
          strategy: StrategyType.CUSTOM,
          customStrategy: competitionInfo.strategy.description,
          plugins: competitionInfo.recommendedPlugins,
          useAI: true,
          competitionStrategy: competitionInfo.strategy
        };
      } else {
        // First fetch available plugins
        let pluginChoices: {name: string; value: string; checked: boolean}[] = [];
        try {
          // This is synchronous but requires plugins.json to exist
          const pluginRegistry = new PluginRegistry(); 
          const availablePlugins = await pluginRegistry.getPlugins();
          
          pluginChoices = Object.values(availablePlugins).map(plugin => {
            // Ensure correct namespace
            let normalizedName = plugin.name;
            
            // If name already includes @elizaos-plugins/, replace with @elizaos/
            if (normalizedName.startsWith('@elizaos-plugins/')) {
              normalizedName = normalizedName.replace('@elizaos-plugins/', '@elizaos/');
            }
            // If name doesn't have a namespace, add @elizaos/ namespace
            else if (!normalizedName.startsWith('@')) {
              normalizedName = normalizedName.startsWith('plugin-') 
                ? `@elizaos/${normalizedName}` 
                : `@elizaos/plugin-${normalizedName}`;
            }
            
            return {
              name: `${plugin.name} - ${plugin.description.substring(0, 60)}${plugin.description.length > 60 ? '...' : ''}`,
              value: normalizedName,
              checked: false  // Default to unchecked, user will select what they need
            };
          });
        } catch (error) {
          console.warn(`Failed to fetch plugins from registry: ${error instanceof Error ? error.message : String(error)}`);
          // If we can't load plugins, provide an empty list
          pluginChoices = [];
        }

        // Use the fetched plugins in the prompt
        const strategyAnswers = await inquirer.prompt([
          {
            type: 'list',
            name: 'strategy',
            message: 'Select a trading strategy:',
            choices: [
              { name: 'Competition-derived strategy', value: 'competition' },
              { name: 'Momentum - Based on price trends', value: StrategyType.MOMENTUM },
              { name: 'Mean Reversion - Based on price returning to average', value: StrategyType.MEAN_REVERSION },
              { name: 'Arbitrage - Based on price differences across exchanges', value: StrategyType.ARBITRAGE },
              { name: 'Custom - Define your own strategy', value: StrategyType.CUSTOM }
            ],
            default: 'competition'
          },
          {
            type: 'input',
            name: 'customStrategy',
            message: 'Describe your custom strategy:',
            when: (answers) => answers.strategy === StrategyType.CUSTOM
          },
          {
            type: 'checkbox',
            name: 'plugins',
            message: 'Select required plugins:',
            choices: pluginChoices
          },
          {
            type: 'confirm',
            name: 'useAI',
            message: 'Use AI to refine your strategy?',
            default: true
          }
        ]);
        
        // Combine answers
        answers = {
          ...initialAnswers,
          ...strategyAnswers,
          competitionStrategy: strategyAnswers.strategy === 'competition' ? competitionInfo.strategy : null
        };
      }
    } else {
      // Standard flow without competition data
      
      // Try to get available plugins
      let pluginChoices: {name: string; value: string; checked: boolean}[] = [];
      try {
        // This is synchronous but requires plugins.json to exist
        const pluginRegistry = new PluginRegistry(); 
        const availablePlugins = await pluginRegistry.getPlugins();
        
        pluginChoices = Object.values(availablePlugins).map(plugin => {
          // Ensure correct namespace
          let normalizedName = plugin.name;
          
          // If name already includes @elizaos-plugins/, replace with @elizaos/
          if (normalizedName.startsWith('@elizaos-plugins/')) {
            normalizedName = normalizedName.replace('@elizaos-plugins/', '@elizaos/');
          }
          // If name doesn't have a namespace, add @elizaos/ namespace
          else if (!normalizedName.startsWith('@')) {
            normalizedName = normalizedName.startsWith('plugin-') 
              ? `@elizaos/${normalizedName}` 
              : `@elizaos/plugin-${normalizedName}`;
          }
          
          return {
            name: `${plugin.name} - ${plugin.description.substring(0, 60)}${plugin.description.length > 60 ? '...' : ''}`,
            value: normalizedName,
            checked: false  // Default to unchecked, user will select what they need
          };
        });
      } catch (error) {
        console.warn(`Failed to fetch plugins from registry: ${error instanceof Error ? error.message : String(error)}`);
        // If we can't load plugins, provide an empty list
        pluginChoices = [];
      }
      
      // Use the fetched plugins in the prompt
      const standardAnswers = await inquirer.prompt([
        {
          type: 'list',
          name: 'strategy',
          message: 'Select a trading strategy:',
          choices: [
            { name: 'Momentum - Based on price trends', value: StrategyType.MOMENTUM },
            { name: 'Mean Reversion - Based on price returning to average', value: StrategyType.MEAN_REVERSION },
            { name: 'Arbitrage - Based on price differences across exchanges', value: StrategyType.ARBITRAGE },
            { name: 'Custom - Define your own strategy', value: StrategyType.CUSTOM }
          ],
          default: options.strategy || StrategyType.MOMENTUM
        },
        {
          type: 'input',
          name: 'customStrategy',
          message: 'Describe your custom strategy:',
          when: (answers) => answers.strategy === StrategyType.CUSTOM
        },
        {
          type: 'checkbox',
          name: 'plugins',
          message: 'Select required plugins:',
          choices: pluginChoices
        },
        {
          type: 'confirm',
          name: 'useAI',
          message: 'Use AI to refine your strategy?',
          default: true
        }
      ]);
      
      // Combine answers
      answers = {
        ...initialAnswers,
        ...standardAnswers
      };
    }
    
    // Create agent directory
    const agentDir = path.resolve(process.cwd(), answers.name);
    spinner.start(`Creating agent directory at ${chalk.cyan(agentDir)}`);
    
    if (fs.existsSync(agentDir)) {
      if (!options.force) {
        spinner.fail(`Directory ${chalk.cyan(answers.name)} already exists. Use --force to overwrite.`);
        return;
      }
      spinner.info(`Directory ${chalk.cyan(answers.name)} already exists. Using --force to continue.`);
    } else {
      fs.mkdirSync(agentDir, { recursive: true });
    }
    
    // Create database directory using proper path resolution for this agent
    const agentDbPath = getProjectPath(answers.name, 'db', 'documentation.db');
    
    // If force is enabled and the database exists, delete it to ensure a fresh start
    if (options.force && fs.existsSync(agentDbPath)) {
      fs.unlinkSync(agentDbPath);
      spinner.info('Existing documentation database removed for fresh start.');
    }
    
    // Change to the agent directory
    process.chdir(agentDir);
    
    // Clone the Recall Agent Starter Kit
    spinner.text = 'Cloning Recall Agent Starter Kit';
    const git = simplegit.simpleGit();
    try {
      // Try to clone the repository (we'll use a placeholder URL for now)
      await git.clone('https://github.com/recallnet/recall-agent-starter', '.');
    } catch (error) {
      // If it fails, create basic structure manually
      spinner.warn('Failed to clone starter kit. Creating basic structure manually.');
      
      // Create basic directories
      fs.mkdirSync('src', { recursive: true });
      fs.mkdirSync('characters', { recursive: true });
      
      // Create package.json
      const packageJson = {
        name: answers.name.toLowerCase().replace(/[^a-z0-9]/g, '-'),
        version: '0.1.0',
        description: `A crypto trading agent using the ${answers.strategy} strategy`,
        main: 'src/index.ts',
        type: 'module',
        scripts: {
          build: 'tsc',
          start: 'ts-node --esm src/index.ts'
        },
        dependencies: {},
        devDependencies: {
          'typescript': '^5.3.3',
          'ts-node': '^10.9.2',
          '@types/node': '^20.11.28'
        }
      };
      
      fs.writeFileSync('package.json', JSON.stringify(packageJson, null, 2));
      
      // Create tsconfig.json
      const tsConfig = {
        compilerOptions: {
          target: 'ES2022',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          esModuleInterop: true,
          strict: true,
          outDir: 'dist',
          sourceMap: true
        },
        include: ['src/**/*']
      };
      
      fs.writeFileSync('tsconfig.json', JSON.stringify(tsConfig, null, 2));
    }
    
    // Install selected plugins
    spinner.text = 'Installing selected plugins';
    for (const plugin of answers.plugins) {
      try {
        await registry.installPlugin(plugin, undefined, answers.name);
      } catch (error) {
        spinner.warn(`Failed to install plugin ${plugin}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    
    // Load documentation for the selected plugins in the background
    spinner.text = 'Preparing documentation for selected plugins';
    try {
      // Start the MCP server if not already running, with project-specific database path
      const mcpServer = new McpServer({
        docsBasePath: process.cwd(),
        documentStore: {
          dbPath: agentDbPath
        }
      });
      await mcpServer.start();
      
      // Create an MCP client
      const mcpClient = new McpClient();
      
      // Prepare agent configuration for documentation loading
      const agentConfig = {
        plugins: answers.plugins.map((p: string) => p.replace('@elizaos/', '').replace('@elizaos-plugins/', '')),
        dependencies: answers.plugins.reduce((deps: Record<string, string>, plugin: string) => {
          deps[plugin] = '^1.0.0'; // Version doesn't matter for documentation loading
          return deps;
        }, {})
      };
      
      // Load documentation for the agent's components
      spinner.text = 'Loading documentation for plugins - this may take a moment';
      await mcpClient.populateAgentDocumentation(agentConfig);
      
      spinner.succeed('Plugin documentation loaded successfully');
      
      // Stop the server after documentation is loaded
      await mcpServer.stop();
    } catch (error) {
      spinner.warn(`Failed to load plugin documentation: ${error instanceof Error ? error.message : String(error)}`);
      // Continue with agent creation even if documentation loading fails
    }
    
    // Generate strategy based on the selections
    spinner.text = 'Generating trading strategy';
    let strategy;
    
    if (answers.competitionStrategy) {
      // Use the pre-processed competition strategy
      strategy = answers.competitionStrategy;
    } else {
      // Generate with AI
      strategy = await generateStrategyWithAI(
        answers.strategy,
        answers.customStrategy
      );
    }
    
    // Save competition information if available
    if (competitionInfo) {
      fs.mkdirSync('competition', { recursive: true });
      fs.writeFileSync('competition/info.json', JSON.stringify({
        url: options.competitionUrl,
        content: competitionInfo.content,
        strategy: competitionInfo.strategy,
        recommendedPlugins: competitionInfo.recommendedPlugins
      }, null, 2));
      
      fs.writeFileSync('competition/guidelines.md', competitionInfo.content);
    }
    
    // Generate character file
    spinner.text = 'Generating agent character';
    const character = await generateCharacter({
      name: answers.name,
      strategy: answers.strategy,
      plugins: answers.plugins,
      useAI: answers.useAI,
      competitionBased: !!competitionInfo
    });
    
    // Save character file
    const characterPath = saveCharacter(character, process.cwd());
    
    // Generate and save strategy implementation
    spinner.text = 'Generating strategy implementation';
    const implementation = await generateStrategyImplementation(strategy, answers.plugins);
    const strategyPath = saveStrategyImplementation(implementation, process.cwd());
    
    // Install npm dependencies
    spinner.text = 'Installing dependencies';
    try {
      execSync('npm install', { stdio: 'ignore' });
    } catch (error) {
      spinner.warn(`Failed to install dependencies: ${error instanceof Error ? error.message : String(error)}`);
    }
    
    // Success
    spinner.succeed(`Successfully created ${chalk.green(answers.name)} agent with ${chalk.cyan(answers.strategy)} strategy`);
    
    console.log(`\nFiles created:
  - Character: ${chalk.cyan(characterPath)}
  - Strategy: ${chalk.cyan(strategyPath)}
    ${competitionInfo ? `- Competition Info: ${chalk.cyan('competition/info.json')}\n  - Competition Guidelines: ${chalk.cyan('competition/guidelines.md')}` : ''}
    
To run your agent:
  cd ${answers.name}
  recall-cli agent run --character=${path.basename(characterPath)}`);
    
  } catch (error) {
    spinner.fail(`Failed to create agent: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Run a crypto trading agent
 */
export async function runAgent(options: any) {
  const spinner = ora('Starting crypto trading agent').start();
  
  try {
    // Get character file path
    const characterPath = options.character || 
      (fs.readdirSync('characters')
        .find(file => file.endsWith('.character.json')) || '');
    
    if (!characterPath || !fs.existsSync(path.join('characters', characterPath))) {
      spinner.fail('Character file not found. Please specify with --character option.');
      return;
    }
    
    // Check if package.json and index.ts exist
    if (!fs.existsSync('package.json') || !fs.existsSync('src/index.ts')) {
      spinner.fail('Invalid agent directory. Missing package.json or src/index.ts.');
      return;
    }
    
    // Load the character file to get plugin information
    const characterFile = path.join('characters', characterPath);
    spinner.text = 'Loading agent character';
    const character = JSON.parse(fs.readFileSync(characterFile, 'utf-8'));
    
    // Load the package.json to get dependencies
    spinner.text = 'Analyzing agent dependencies';
    const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
    
    // Load documentation for the agent's plugins in the background
    spinner.text = 'Preparing plugin documentation';
    try {
      // Get the project name from the current directory
      const projectName = path.basename(process.cwd());
      
      // Use the proper project-specific database path
      const agentDbPath = getProjectPath(projectName, 'db', 'documentation.db');
      
      // Start the MCP server if not already running
      spinner.text = 'Starting MCP server';
      const mcpServer = new McpServer({
        docsBasePath: process.cwd(),
        documentStore: {
          dbPath: agentDbPath
        }
      });
      await mcpServer.start();
      
      // Create an MCP client
      const mcpClient = new McpClient();
      
      // Prepare agent configuration for documentation loading
      spinner.text = 'Loading documentation for agent components';
      const agentConfig = {
        // Extract plugins from character
        plugins: character.plugins?.map((p: string) => p.replace('@elizaos/', '').replace('@elizaos-plugins/', '')) || [],
        // Extract dependencies from package.json
        dependencies: packageJson.dependencies || {}
      };
      
      // Load documentation for the agent's components
      await mcpClient.populateAgentDocumentation(agentConfig);
      
      spinner.succeed('Agent documentation loaded successfully');
      
      // Don't stop the server as it will be needed for agent execution
    } catch (error) {
      spinner.warn(`Failed to load agent documentation: ${error instanceof Error ? error.message : String(error)}`);
      // Continue with agent execution even if documentation loading fails
    }
    
    // Start the agent
    spinner.succeed('Agent is ready to run');
    console.log(`${chalk.yellow('Character:')} ${characterPath}`);
    console.log(`${chalk.yellow('Press Ctrl+C to stop the agent')}\n`);
    
    // Run the agent using the character file
    try {
      execSync(`ts-node --esm src/index.ts --characters=characters/${characterPath}`, { 
        stdio: 'inherit'
      });
    } catch (error) {
      // Will catch Ctrl+C or other terminations
      if ((error as any).signal === 'SIGINT') {
        console.log('\nAgent stopped.');
      } else {
        throw error;
      }
    }
    
  } catch (error) {
    spinner.fail(`Failed to run agent: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Register the agent command with the CLI
 */
export function agentCommand(program: Command) {
  const agent = program
    .command('agent')
    .description('Create and manage crypto trading agents');

  agent
    .command('create')
    .description('Create a new crypto trading agent')
    .option('-n, --name <name>', 'Name of the agent')
    .option('-s, --strategy <strategy>', 'Trading strategy to use')
    .option('-f, --force', 'Overwrite existing directories', false)
    .option('-c, --competition-url <url>', 'URL to a competition specification to parse')
    .action(createAgent);

  agent
    .command('run')
    .description('Run a crypto trading agent')
    .option('-c, --character <file>', 'Character file to use')
    .action(runAgent);

  return agent;
} 