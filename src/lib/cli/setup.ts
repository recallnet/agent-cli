import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import path from 'path';
import { LlmProviderFactory } from '../llm/provider.js';
import { McpClient } from '../mcp/client.js';
import { AgentSetup } from '../agent/setup.js';

/**
 * Setup an existing trading agent project
 */
export async function setupProject(options: { directory?: string } = {}) {
  const spinner = ora('Initializing setup').start();
  
  try {
    // Determine project directory
    const projectDir = options.directory ? path.resolve(process.cwd(), options.directory) : process.cwd();
    
    // Create LLM provider and MCP client for the setup
    const llmProvider = LlmProviderFactory.createFromConfig();
    if (!llmProvider) {
      spinner.fail('No LLM provider configured. Please configure an LLM provider first.');
      console.log(chalk.yellow('To configure an LLM provider, run:'));
      console.log(chalk.yellow('  recall-cli llm config --provider openai --api-key your-api-key'));
      return;
    }
    
    const mcpClient = new McpClient();
    spinner.succeed('Setup initialized');
    
    console.log(chalk.cyan('\n📊 Interactive Trading Agent Setup\n'));
    console.log(chalk.gray('This assistant will guide you through setting up your trading agent.\n'));
    
    // Create and start the setup assistant
    const setup = new AgentSetup(llmProvider, mcpClient, projectDir);
    await setup.start();
    
    console.log(chalk.green('\n✅ Setup completed successfully!'));
  } catch (error) {
    spinner.fail(`Setup failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Register the setup command
 */
export function setupCommand(program: Command) {
  program
    .command('setup')
    .description('Interactive setup for a trading agent project')
    .option('-d, --directory <directory>', 'Directory of the project (defaults to current directory)')
    .action((options) => {
      setupProject(options);
    });
} 