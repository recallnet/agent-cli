import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import path from 'path';
import fs from 'fs';
import Conf from 'conf';
import * as simpleGit from 'simple-git';
import { LlmProviderFactory } from '../llm/provider.js';
import { McpClient } from '../mcp/client.js';
import { McpServer } from '../mcp/server.js';
import { AgentSetup } from '../agent/setup.js';
import { setApiKey } from './llm.js';
import { getDataPath } from '../utils/config-paths.js';

// Create config store
const config = new Conf({
  projectName: 'recall-cli'
});

/**
 * Start the complete workflow: configure LLM and set up a project
 */
export async function startWorkflow(projectName: string, options: { force?: boolean } = {}) {
  console.log(chalk.cyan('\n📊 Welcome to Recall CLI - Crypto Trading Agent Setup\n'));
  console.log(chalk.gray('This assistant will guide you through the complete setup process.\n'));
  
  // Step 1: Configure LLM Provider
  console.log(chalk.cyan('\n🧠 Step 1: Configure LLM Provider\n'));
  
  let provider = config.get('llm.provider') as string;
  let apiKey = config.get('llm.apiKey') as string;
  
  // Check if LLM is already configured
  if (provider && apiKey) {
    const { useExisting } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'useExisting',
        message: `Found existing ${provider} configuration. Do you want to use it?`,
        default: true
      }
    ]);
    
    if (!useExisting) {
      // User wants to set a new provider
      await setApiKey(undefined, {});
      
      // Get the new values
      provider = config.get('llm.provider') as string;
      apiKey = config.get('llm.apiKey') as string;
    }
  } else {
    // No existing configuration, set up a new one
    await setApiKey(undefined, {});
    
    // Get the new values
    provider = config.get('llm.provider') as string;
    apiKey = config.get('llm.apiKey') as string;
  }
  
  // Check if configuration was successful
  if (!provider || !apiKey) {
    console.log(chalk.red('\nLLM configuration is required to continue. Please try again.'));
    return;
  }
  
  console.log(chalk.green(`\n✓ LLM Provider configured: ${provider}`));
  
  // Step 1.5: Initialize MCP Server
  console.log(chalk.cyan('\n🔄 Initializing Managed Context Provider...\n'));
  
  const mcpSpinner = ora('Starting MCP server').start();
  
  // Create and start MCP server
  const mcpServer = new McpServer({
    port: 3333, // Use default port
    cacheTtl: 3600000, // 1 hour cache
    pluginRegistryUrl: 'https://raw.githubusercontent.com/elizaos/registry/main/index.json', // Use GitHub registry for production
    // Use proper data path for documentation database
    documentStore: {
      dbPath: getDataPath('db', 'documentation.db')
    }
  });
  
  try {
    // Start the MCP server
    await mcpServer.start();
    mcpSpinner.succeed('MCP server started successfully');
    
    // Register shutdown handler
    process.on('exit', async () => {
      try {
        await mcpServer.stop();
        console.log(chalk.gray('MCP server stopped.'));
      } catch (error) {
        // Ignore errors on exit
      }
    });
  } catch (error) {
    mcpSpinner.warn(`MCP server could not be started: ${error instanceof Error ? error.message : String(error)}`);
    console.log(chalk.yellow('Continuing without MCP server. Some features may be limited.'));
  }
  
  // Step 2: Initialize project (if name is provided)
  console.log(chalk.cyan('\n📁 Step 2: Initialize Project\n'));
  
  const projectDir = projectName ? path.resolve(process.cwd(), projectName) : '';
  
  if (projectName) {
    const spinner = ora('Initializing project').start();
    
    try {
      // Check if directory already exists
      if (fs.existsSync(projectDir)) {
        if (!options.force) {
          spinner.fail(`Directory ${chalk.cyan(projectName)} already exists, use --force to overwrite`);
          return;
        }
        spinner.info(`Directory ${chalk.cyan(projectName)} exists, continuing with force option`);
      }
      
      // Create directory if it doesn't exist
      if (!fs.existsSync(projectDir)) {
        fs.mkdirSync(projectDir, { recursive: true });
      }
      
      spinner.text = `Cloning Recall Agent Starter Kit to ${chalk.cyan(projectName)}`;
      
      // Clone starter kit with simple-git
      const git = simpleGit.simpleGit();
      await git.clone('https://github.com/recallnet/recall-agent-starter', projectDir, ['--depth', '1']);
      
      // Remove .git directory
      fs.rmSync(path.join(projectDir, '.git'), { recursive: true, force: true });
      
      // Update package.json with project name
      const packageJsonPath = path.join(projectDir, 'package.json');
      if (fs.existsSync(packageJsonPath)) {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
        packageJson.name = projectName.toLowerCase().replace(/\s+/g, '-');
        fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
      }
      
      spinner.succeed(`Project initialized in ${chalk.cyan(projectName)}`);
    } catch (error) {
      spinner.fail(`Failed to initialize project: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
  } else {
    // Ask if user wants to create a new project or use the current directory
    const { projectChoice } = await inquirer.prompt([
      {
        type: 'list',
        name: 'projectChoice',
        message: 'How do you want to set up your project?',
        choices: [
          { name: 'Create a new project', value: 'new' },
          { name: 'Use current directory', value: 'current' }
        ]
      }
    ]);
    
    if (projectChoice === 'new') {
      const { newProjectName } = await inquirer.prompt([
        {
          type: 'input',
          name: 'newProjectName',
          message: 'Enter a name for your new project:',
          validate: (input) => input.length > 0 ? true : 'Project name is required'
        }
      ]);
      
      // Restart with the new project name
      console.log(chalk.yellow('Restarting with new project name...'));
      await startWorkflow(newProjectName, options);
      return;
    } else {
      // Use current directory
      console.log(chalk.yellow('Using current directory for setup.'));
      const currentDirName = path.basename(process.cwd());
      console.log(chalk.green(`\n✓ Project location: ${chalk.cyan(currentDirName)} (current directory)`));
    }
  }
  
  // Step 3: Set up the interactive assistant
  console.log(chalk.cyan('\n🔧 Step 3: Interactive Setup\n'));
  
  try {
    // Create LLM provider
    const llmProvider = LlmProviderFactory.createFromConfig();
    if (!llmProvider) {
      console.log(chalk.red('Failed to create LLM provider. Please check your configuration.'));
      return;
    }
    
    // Create MCP client
    const mcpClient = new McpClient({ baseUrl: 'http://localhost:3333' });
    
    // Set the MCP client for the LLM provider
    llmProvider.setMcpClient(mcpClient);
    
    // Verify MCP health before proceeding
    try {
      const isHealthy = await mcpClient.isHealthy();
      if (!isHealthy) {
        console.log(chalk.yellow('Warning: MCP server is not responding. Some features may be limited.'));
      } else {
        console.log(chalk.green('✓ MCP server is healthy and responding'));
      }
    } catch (error) {
      console.log(chalk.yellow('Warning: Could not verify MCP server health. Some features may be limited.'));
    }
    
    // Determine project directory (use current directory if no project name was provided)
    const setupDir = projectDir || process.cwd();
    
    // Create and start the setup assistant
    const setup = new AgentSetup(llmProvider, mcpClient, setupDir);
    await setup.start();
    
    console.log(chalk.green('\n✅ Setup completed successfully!'));
    console.log(chalk.cyan('\nNext steps:'));
    
    if (projectName) {
      console.log(chalk.white(`1. cd ${projectName}`));
    }
    
    console.log(chalk.white('2. pnpm install'));
    console.log(chalk.white('3. Edit any configuration if needed'));
    console.log(chalk.white('4. pnpm start'));
    
    // Stop the MCP server
    try {
      await mcpServer.stop();
      console.log(chalk.gray('MCP server stopped.'));
    } catch (error) {
      // Ignore errors on shutdown
    }
  } catch (error) {
    console.error(chalk.red(`Setup failed: ${error instanceof Error ? error.message : String(error)}`));
    console.log(chalk.yellow('\nYou can still use the project manually.'));
    
    // Stop the MCP server on error
    try {
      await mcpServer.stop();
    } catch (mcpError) {
      // Ignore errors on shutdown
    }
  }
}

/**
 * Register the start command
 */
export function startCommand(program: Command) {
  program
    .command('start')
    .description('Start the complete workflow: configure LLM and set up a project')
    .argument('[name]', 'Name of the project to create (optional)')
    .option('--force', 'Overwrite existing directory')
    .action((name, options) => {
      startWorkflow(name, options);
    });
} 