import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import fs from 'fs';
import path from 'path';
import { PluginRegistry } from '../plugins/registry.js';
import { McpClient } from '../mcp/client.js';
import { LlmProviderFactory } from '../llm/provider.js';
import { McpServer } from '../mcp/server.js';

// Create a singleton plugin registry
const registry = new PluginRegistry();

/**
 * List available plugins from the Eliza Plugin Registry
 */
export async function listPlugins(options: any) {
  const spinner = ora('Fetching available plugins').start();
  
  try {
    // Get plugins from the registry
    const plugins = await registry.getPlugins();
    
    // Filter plugins by category if requested
    const filteredPlugins = options.category 
      ? Object.values(plugins).filter(p => p.name.includes(options.category) || p.description.includes(options.category))
      : Object.values(plugins);
    
    spinner.succeed(`Found ${filteredPlugins.length} plugins${options.category ? ` matching "${options.category}"` : ''}`);
    
    if (filteredPlugins.length === 0) {
      console.log(chalk.yellow('No plugins found matching your criteria.'));
      return;
    }
    
    // Display plugins in a table-like format
    console.log();
    filteredPlugins.forEach(plugin => {
      console.log(`${chalk.green(plugin.name.padEnd(25))}${plugin.description}`);
    });
    
  } catch (error) {
    spinner.fail(`Failed to fetch plugins: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Install a plugin to the current project
 */
export async function installPlugin(pluginName: string, options: any) {
  // First check if we're in a valid project directory
  if (!isValidProjectDirectory()) {
    console.log(chalk.red('Not a valid project directory.'));
    console.log(`Run ${chalk.cyan('recall-cli init <project-name>')} to create a new project first.`);
    return;
  }
  
  const spinner = ora(`Installing plugin ${chalk.cyan(pluginName)}`).start();
  
  try {
    // Check if the plugin exists first
    const plugin = await registry.getPlugin(pluginName);
    
    if (!plugin) {
      spinner.fail(`Plugin ${chalk.cyan(pluginName)} not found in the registry.`);
      
      // Suggest similar plugins
      const allPlugins = await registry.getPlugins();
      const similarPlugins = Object.values(allPlugins)
        .filter(p => p.name.includes(pluginName) || pluginName.includes(p.name))
        .map(p => p.name);
      
      if (similarPlugins.length > 0) {
        console.log(chalk.yellow('Did you mean one of these?'));
        similarPlugins.forEach(name => {
          console.log(`  ${chalk.cyan(name)}`);
        });
      }
      
      return;
    }
    
    // Check for required environment variables
    if (plugin.requiredEnv.length > 0) {
      spinner.info(`Plugin ${chalk.cyan(pluginName)} requires the following environment variables:`);
      plugin.requiredEnv.forEach(env => {
        console.log(`  ${chalk.yellow(env)}`);
      });
      spinner.start();
    }
    
    // If a specific version is requested, validate it
    if (options.version) {
      // TODO: Implement version validation against the registry
      spinner.info(`Installing version ${chalk.cyan(options.version)} of ${chalk.cyan(pluginName)}`);
    }
    
    // Install the plugin
    const success = await registry.installPlugin(pluginName, options.version);
    
    if (success) {
      spinner.succeed(`Successfully installed plugin ${chalk.green(pluginName)}`);
      
      // Update package.json if needed
      updatePackageJson(pluginName, plugin);
    } else {
      spinner.fail(`Failed to install plugin ${chalk.red(pluginName)}`);
    }
  } catch (error) {
    spinner.fail(`Failed to install plugin: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Show detailed information about a plugin
 */
export async function showPluginInfo(pluginName: string) {
  const spinner = ora(`Fetching information for plugin ${chalk.cyan(pluginName)}`).start();
  
  try {
    // Get plugin information
    const plugin = await registry.getPlugin(pluginName);
    
    if (!plugin) {
      spinner.fail(`Plugin ${chalk.cyan(pluginName)} not found`);
      return;
    }
    
    spinner.succeed(`Plugin details for ${chalk.green(pluginName)}:`);
    
    console.log(`
${chalk.bold('Name:')} ${plugin.name}
${chalk.bold('Description:')} ${plugin.description}
${chalk.bold('Version:')} ${plugin.version}
${chalk.bold('Author:')} ${plugin.author}
${chalk.bold('License:')} ${plugin.license}
${chalk.bold('Required ENV vars:')} ${plugin.requiredEnv.length > 0 ? plugin.requiredEnv.join(', ') : 'None'}

${chalk.bold('Dependencies:')}
${Object.entries(plugin.dependencies)
    .map(([dep, ver]) => `  ${dep}: ${ver}`)
    .join('\n')}

${chalk.bold('Installation:')}
  $ recall-cli plugin install ${plugin.name}

${chalk.bold('Usage:')}
  ${plugin.importStatement}
    `);
    
  } catch (error) {
    spinner.fail(`Failed to fetch plugin information: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Visualize plugin dependencies
 */
export async function visualizeDependencies(pluginName: string) {
  const spinner = ora(`Analyzing dependencies for plugin ${chalk.cyan(pluginName)}`).start();
  
  try {
    // Get plugin information
    const plugin = await registry.getPlugin(pluginName);
    
    if (!plugin) {
      spinner.fail(`Plugin ${chalk.cyan(pluginName)} not found`);
      return;
    }
    
    spinner.succeed(`Dependency tree for ${chalk.green(pluginName)}:`);
    
    // Get all plugins to resolve dependencies
    const allPlugins = await registry.getPlugins();
    
    // Generate and display the dependency tree
    console.log();
    await printDependencyTree(plugin, allPlugins, '');
    
  } catch (error) {
    spinner.fail(`Failed to analyze dependencies: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Update plugins to their latest versions
 */
export async function updatePlugins() {
  // Check if we're in a valid project directory
  if (!isValidProjectDirectory()) {
    console.log(chalk.red('Not a valid project directory.'));
    console.log(`Run ${chalk.cyan('recall-cli init <project-name>')} to create a new project first.`);
    return;
  }
  
  const spinner = ora('Checking for plugin updates').start();
  
  try {
    // Read package.json to find installed plugins
    const packageJsonPath = path.join(process.cwd(), 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const dependencies = packageJson.dependencies || {};
    
    // Find Eliza plugins
    const elizaPlugins = Object.keys(dependencies)
      .filter(dep => dep.startsWith('@elizaos-plugins/plugin-'))
      .map(dep => dep.replace('@elizaos-plugins/plugin-', ''));
    
    if (elizaPlugins.length === 0) {
      spinner.info('No Eliza plugins found in this project.');
      return;
    }
    
    spinner.succeed(`Found ${elizaPlugins.length} Eliza plugins`);
    
    // Check each plugin for updates
    for (const pluginName of elizaPlugins) {
      const updateSpinner = ora(`Checking ${chalk.cyan(pluginName)} for updates`).start();
      
      try {
        const plugin = await registry.getPlugin(pluginName);
        
        if (!plugin) {
          updateSpinner.warn(`Plugin ${chalk.cyan(pluginName)} not found in registry`);
          continue;
        }
        
        const installedVersion = dependencies[`@elizaos-plugins/plugin-${pluginName}`].replace('^', '');
        const latestVersion = plugin.version;
        
        if (installedVersion !== latestVersion) {
          updateSpinner.info(`Update available for ${chalk.cyan(pluginName)}: ${chalk.yellow(installedVersion)} → ${chalk.green(latestVersion)}`);
          
          // Prompt to update
          const { update } = await inquirer.prompt([
            {
              type: 'confirm',
              name: 'update',
              message: `Update ${pluginName} to version ${latestVersion}?`,
              default: true
            }
          ]);
          
          if (update) {
            updateSpinner.start(`Updating ${chalk.cyan(pluginName)}`);
            await registry.installPlugin(pluginName, latestVersion);
            updateSpinner.succeed(`Updated ${chalk.green(pluginName)} to version ${chalk.green(latestVersion)}`);
          } else {
            updateSpinner.info(`Skipped update for ${chalk.cyan(pluginName)}`);
          }
        } else {
          updateSpinner.succeed(`${chalk.green(pluginName)} is already at the latest version (${chalk.green(latestVersion)})`);
        }
      } catch (error) {
        updateSpinner.fail(`Failed to check/update ${chalk.red(pluginName)}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } catch (error) {
    spinner.fail(`Failed to check for updates: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Register the plugin command with the CLI
 */
export function registerPluginCommand(program: Command): Command {
  const pluginCommand = program.command('plugin')
    .description('Manage Eliza plugins');
  
  pluginCommand
    .command('list')
    .description('List available plugins')
    .option('--category <category>', 'Filter plugins by category')
    .action(listPlugins);
    
  pluginCommand
    .command('install')
    .description('Install a plugin')
    .argument('<name>', 'Name of the plugin to install')
    .option('-v, --version <version>', 'Specific version to install')
    .action(installPlugin);
    
  pluginCommand
    .command('info')
    .description('Show detailed information about a plugin')
    .argument('<name>', 'Name of the plugin')
    .action(showPluginInfo);
    
  pluginCommand
    .command('deps')
    .description('Visualize plugin dependencies')
    .argument('<name>', 'Name of the plugin')
    .action(visualizeDependencies);
    
  pluginCommand
    .command('update')
    .description('Update installed plugins to their latest versions')
    .action(updatePlugins);

  // Add recommend subcommand
  pluginCommand.command('recommend')
    .description('Get plugin recommendations based on strategy or competition')
    .option('-s, --strategy <file>', 'Path to a file containing strategy description')
    .option('-c, --competition <id>', 'Competition ID to base recommendations on')
    .option('-i, --interactive', 'Use interactive mode to describe your strategy', false)
    .action(async (options) => {
      try {
        // Start MCP server if not running
        const mcpServer = new McpServer();
        const spinner = ora('Starting MCP server...').start();
        await mcpServer.start();
        spinner.succeed('MCP server started');

        // Create MCP client
        const mcpClient = new McpClient();

        // Create LLM provider with MCP client
        const llmProvider = LlmProviderFactory.createFromConfig(mcpClient);
        
        if (!llmProvider) {
          console.error(chalk.red('No LLM provider configured. Please run `recall-cli llm setup` first.'));
          await mcpServer.stop();
          return;
        }

        let strategyDescription = '';
        
        if (options.interactive) {
          // Interactive mode: prompt user for strategy description
          const answers = await inquirer.prompt([
            {
              type: 'editor',
              name: 'strategy',
              message: 'Describe your trading strategy in detail:',
              default: `# Trading Strategy

Describe your strategy here. Include:
- The assets you're trading
- The timeframes you're using
- The indicators or signals you're looking for
- Your entry and exit conditions
- Your risk management approach
- Any specific market conditions you're targeting`,
            },
          ]);
          
          strategyDescription = answers.strategy;
        } else if (options.strategy) {
          // Read strategy from file
          try {
            const filePath = path.isAbsolute(options.strategy) 
              ? options.strategy
              : path.join(process.cwd(), options.strategy);
            
            strategyDescription = fs.readFileSync(filePath, 'utf-8');
          } catch (error) {
            console.error(chalk.red(`Failed to read strategy file: ${error instanceof Error ? error.message : String(error)}`));
            await mcpServer.stop();
            return;
          }
        } else if (options.competition) {
          // Use competition ID
          try {
            spinner.start('Generating strategy based on competition guidelines...');
            const strategyResponse = await llmProvider.generateStrategyForCompetition(options.competition);
            strategyDescription = strategyResponse.content;
            spinner.succeed('Generated strategy based on competition guidelines');
            
            // Display the generated strategy
            console.log(chalk.cyan('\n📊 Generated Strategy:'));
            console.log(chalk.white(strategyDescription));
            console.log();
          } catch (error) {
            spinner.fail(`Failed to generate strategy: ${error instanceof Error ? error.message : String(error)}`);
            await mcpServer.stop();
            return;
          }
        } else {
          console.error(chalk.red('Please provide a strategy file, competition ID, or use interactive mode.'));
          await mcpServer.stop();
          return;
        }
        
        // Get recommendations
        spinner.start('Analyzing strategy and recommending plugins...');
        
        try {
          let recommendations;
          
          if (options.competition) {
            recommendations = await llmProvider.recommendPluginsForCompetition(options.competition);
          } else {
            recommendations = await llmProvider.recommendPluginsForStrategy(strategyDescription);
          }
          
          spinner.succeed('Analysis complete');
          
          // Display recommendations
          console.log(chalk.cyan('\n🔌 Recommended Plugins:'));
          
          for (const rec of recommendations) {
            const confidenceColor = 
              rec.confidence > 0.8 ? chalk.green :
              rec.confidence > 0.5 ? chalk.yellow :
              chalk.red;
              
            console.log(chalk.bold(`\n${rec.name}`) + confidenceColor(` (Confidence: ${Math.round(rec.confidence * 100)}%)`));
            console.log(chalk.white(rec.reasoning));
            console.log(chalk.dim(`\nInstall with: ${chalk.white(`recall-cli plugin install ${rec.name}`)}`));
          }
          
        } catch (error) {
          spinner.fail(`Failed to analyze and recommend plugins: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
          // Stop MCP server
          await mcpServer.stop();
        }
      } catch (error) {
        console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      }
    });

  // Add understand subcommand
  pluginCommand.command('understand')
    .description('Understand a plugin\'s implementation and get integration guidance')
    .argument('<plugin>', 'Plugin name')
    .action(async (pluginName) => {
      try {
        // Start MCP server if not running
        const mcpServer = new McpServer();
        const spinner = ora('Starting MCP server...').start();
        await mcpServer.start();
        spinner.succeed('MCP server started');
        
        // Create MCP client
        const mcpClient = new McpClient();
        
        // Create LLM provider with MCP client
        const llmProvider = LlmProviderFactory.createFromConfig(mcpClient);
        
        if (!llmProvider) {
          console.error(chalk.red('No LLM provider configured. Please run `recall-cli llm setup` first.'));
          await mcpServer.stop();
          return;
        }
        
        // Get plugin implementation details
        spinner.start(`Analyzing ${pluginName} implementation...`);
        
        try {
          const implementationAnalysis = await llmProvider.explainPluginImplementation(pluginName);
          spinner.succeed(`Analysis of ${pluginName} complete`);
          
          // Display analysis
          console.log(chalk.cyan('\n🧩 Plugin Implementation Analysis:'));
          console.log(chalk.white(implementationAnalysis.content));
          
        } catch (error) {
          spinner.fail(`Failed to analyze plugin implementation: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
          // Stop MCP server
          await mcpServer.stop();
        }
      } catch (error) {
        console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      }
    });
    
  // Add examples subcommand
  pluginCommand.command('examples')
    .description('Generate usage examples for a plugin')
    .argument('<plugin>', 'Plugin name')
    .action(async (pluginName) => {
      try {
        // Start MCP server if not running
        const mcpServer = new McpServer();
        const spinner = ora('Starting MCP server...').start();
        await mcpServer.start();
        spinner.succeed('MCP server started');
        
        // Create MCP client
        const mcpClient = new McpClient();
        
        // Create LLM provider with MCP client
        const llmProvider = LlmProviderFactory.createFromConfig(mcpClient);
        
        if (!llmProvider) {
          console.error(chalk.red('No LLM provider configured. Please run `recall-cli llm setup` first.'));
          await mcpServer.stop();
          return;
        }
        
        // Generate usage examples
        spinner.start(`Generating usage examples for ${pluginName}...`);
        
        try {
          const usageExamples = await llmProvider.generatePluginUsageExamples(pluginName);
          spinner.succeed(`Generated usage examples for ${pluginName}`);
          
          // Display examples
          console.log(chalk.cyan('\n📋 Plugin Usage Examples:'));
          console.log(chalk.white(usageExamples.content));
          
        } catch (error) {
          spinner.fail(`Failed to generate usage examples: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
          // Stop MCP server
          await mcpServer.stop();
        }
      } catch (error) {
        console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      }
    });
    
  // Add analyze-code subcommand
  pluginCommand.command('analyze-code')
    .description('Analyze and suggest improvements for plugin-related code')
    .option('-f, --file <file>', 'Path to a file containing code to analyze')
    .option('-l, --language <language>', 'Programming language of the code', 'typescript')
    .option('-i, --interactive', 'Use interactive mode to input code', false)
    .action(async (options) => {
      try {
        // Start MCP server if not running
        const mcpServer = new McpServer();
        const spinner = ora('Starting MCP server...').start();
        await mcpServer.start();
        spinner.succeed('MCP server started');
        
        // Create MCP client
        const mcpClient = new McpClient();
        
        // Create LLM provider with MCP client
        const llmProvider = LlmProviderFactory.createFromConfig(mcpClient);
        
        if (!llmProvider) {
          console.error(chalk.red('No LLM provider configured. Please run `recall-cli llm setup` first.'));
          await mcpServer.stop();
          return;
        }
        
        let code = '';
        let language = options.language || 'typescript';
        
        if (options.interactive) {
          // Interactive mode: prompt user for code
          const answers = await inquirer.prompt([
            {
              type: 'editor',
              name: 'code',
              message: 'Enter the code you want to analyze:',
            },
            {
              type: 'list',
              name: 'language',
              message: 'Select the programming language:',
              choices: ['typescript', 'javascript', 'python', 'java', 'rust', 'go', 'other'],
              default: 'typescript',
            },
          ]);
          
          code = answers.code;
          language = answers.language;
          
          if (language === 'other') {
            const langAnswer = await inquirer.prompt([
              {
                type: 'input',
                name: 'customLang',
                message: 'Enter the language name:',
              },
            ]);
            
            language = langAnswer.customLang;
          }
        } else if (options.file) {
          // Read code from file
          try {
            const filePath = path.isAbsolute(options.file) 
              ? options.file
              : path.join(process.cwd(), options.file);
            
            code = fs.readFileSync(filePath, 'utf-8');
            
            // Try to determine language from file extension if not specified
            if (!options.language) {
              const ext = path.extname(filePath).toLowerCase();
              
              const extMap: Record<string, string> = {
                '.ts': 'typescript',
                '.tsx': 'typescript',
                '.js': 'javascript',
                '.jsx': 'javascript',
                '.py': 'python',
                '.java': 'java',
                '.rs': 'rust',
                '.go': 'go',
              };
              
              language = extMap[ext] || language;
            }
          } catch (error) {
            console.error(chalk.red(`Failed to read file: ${error instanceof Error ? error.message : String(error)}`));
            await mcpServer.stop();
            return;
          }
        } else {
          console.error(chalk.red('Please provide a file path or use interactive mode.'));
          await mcpServer.stop();
          return;
        }
        
        if (!code.trim()) {
          console.error(chalk.red('No code provided for analysis.'));
          await mcpServer.stop();
          return;
        }
        
        // Analyze code
        spinner.start(`Analyzing code...`);
        
        try {
          const codeAnalysis = await llmProvider.analyzeAndImproveCode(code, language);
          spinner.succeed('Code analysis complete');
          
          // Display analysis
          console.log(chalk.cyan('\n🔍 Code Analysis:'));
          console.log(chalk.white(codeAnalysis.content));
          
        } catch (error) {
          spinner.fail(`Failed to analyze code: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
          // Stop MCP server
          await mcpServer.stop();
        }
      } catch (error) {
        console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      }
    });

  // Return command for chaining
  return pluginCommand;
}

/**
 * Check if current directory is a valid project directory
 */
function isValidProjectDirectory(): boolean {
  return fs.existsSync(path.join(process.cwd(), 'package.json'));
}

/**
 * Update package.json with plugin information
 */
function updatePackageJson(pluginName: string, plugin: any): void {
  try {
    const packageJsonPath = path.join(process.cwd(), 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    
    // Add to dependencies if not already there
    if (!packageJson.dependencies) {
      packageJson.dependencies = {};
    }
    
    // Make sure the plugin is in the dependencies
    packageJson.dependencies[`@elizaos-plugins/plugin-${pluginName}`] = `^${plugin.version}`;
    
    // Write back to package.json
    fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
  } catch (error) {
    console.warn(`Failed to update package.json: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Print a dependency tree recursively
 */
async function printDependencyTree(plugin: any, allPlugins: Record<string, any>, prefix: string): Promise<void> {
  console.log(`${prefix}${prefix ? '└─ ' : ''}${chalk.green(plugin.name)} (${chalk.yellow(plugin.version)})`);
  
  // Find Eliza plugin dependencies
  const elizaDeps = Object.keys(plugin.dependencies)
    .filter(dep => dep.startsWith('@elizaos-plugins/plugin-'))
    .map(dep => dep.replace('@elizaos-plugins/plugin-', ''));
  
  for (const [index, depName] of elizaDeps.entries()) {
    const depPlugin = allPlugins[depName];
    
    if (depPlugin) {
      const newPrefix = prefix + (index < elizaDeps.length - 1 ? '│  ' : '   ');
      await printDependencyTree(depPlugin, allPlugins, newPrefix);
    } else {
      console.log(`${prefix}${index < elizaDeps.length - 1 ? '├─ ' : '└─ '}${chalk.red(depName)} (not found)`);
    }
  }
} 