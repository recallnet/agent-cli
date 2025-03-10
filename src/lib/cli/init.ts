import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import path from 'path';
import fs from 'fs';
import * as simpleGit from 'simple-git';
import { LlmProviderFactory } from '../llm/provider.js';
import { McpClient } from '../mcp/client.js';
import { AgentSetup } from '../agent/setup.js';

/**
 * Initialize a new crypto trading agent project
 */
export async function initializeProject(name: string, options: { force?: boolean, template?: string, competition?: string, interactive?: boolean } = {}) {
  const spinner = ora('Initializing project').start();
  
  try {
    const projectDir = path.resolve(process.cwd(), name);
    
    // Check if directory already exists
    if (fs.existsSync(projectDir)) {
      if (!options.force) {
        spinner.fail(`Directory ${chalk.cyan(name)} already exists, use --force to overwrite`);
        return;
      }
      spinner.info(`Directory ${chalk.cyan(name)} exists, continuing with force option`);
    }
    
    // Create directory if it doesn't exist
    if (!fs.existsSync(projectDir)) {
      fs.mkdirSync(projectDir, { recursive: true });
    }
    
    spinner.text = `Cloning Recall Agent Starter Kit to ${chalk.cyan(name)}`;
    
    // Clone starter kit with simple-git
    const git = simpleGit.simpleGit();
    await git.clone('https://github.com/recallnet/recall-agent-starter', projectDir, ['--depth', '1']);
    
    // Remove .git directory
    fs.rmSync(path.join(projectDir, '.git'), { recursive: true, force: true });
    
    // Update package.json with project name
    const packageJsonPath = path.join(projectDir, 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    packageJson.name = name.toLowerCase().replace(/\s+/g, '-');
    fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
    
    spinner.succeed(`Project initialized in ${chalk.cyan(name)}`);
    
    // If interactive mode is enabled, launch the setup assistant
    if (options.interactive) {
      console.log(chalk.cyan('\nLaunching interactive setup assistant...\n'));
      
      // Create LLM provider and MCP client for the setup
      try {
        const llmProvider = LlmProviderFactory.createFromConfig();
        if (!llmProvider) {
          console.log(chalk.yellow('No LLM provider configured. Running in limited mode.'));
          console.log(chalk.yellow('To configure an LLM provider, run:'));
          console.log(chalk.yellow('  recall-cli llm config --provider openai --api-key your-api-key'));
          return;
        }
        
        const mcpClient = new McpClient();
        
        // Create and start the setup assistant
        const setup = new AgentSetup(llmProvider, mcpClient, projectDir);
        await setup.start();
        
        console.log(chalk.green('\n✅ Setup completed successfully!'));
        console.log(chalk.cyan('\nNext steps:'));
        console.log(chalk.white(`1. cd ${name}`));
        console.log(chalk.white('2. pnpm install'));
        console.log(chalk.white('3. pnpm start'));
        console.log();
        console.log(chalk.cyan('Note:'), chalk.white('This project requires Node.js v22.11.0 and pnpm 9.15.4'));
      } catch (error) {
        console.error(chalk.red(`Setup failed: ${error instanceof Error ? error.message : String(error)}`));
        console.log(chalk.yellow('\nYou can still use the project manually.'));
      }
    } else {
      // Display basic next steps
      console.log(chalk.cyan('\nNext steps:'));
      console.log(chalk.white(`1. cd ${name}`));
      console.log(chalk.white(`2. pnpm install`));
      console.log(chalk.white('3. Edit configuration in config.js'));
      console.log(chalk.white('4. pnpm start'));
      console.log();
      console.log(chalk.cyan('Note:'), chalk.white('This project requires Node.js v22.11.0 and pnpm 9.15.4'));
      console.log(chalk.cyan('Tip:'), chalk.white('Run with --interactive flag for a guided setup experience.'));
    }
  } catch (error) {
    spinner.fail(`Failed to initialize project: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Register the init command
 */
export function initCommand(program: Command) {
  program
    .command('init')
    .argument('<name>', 'Name of the project')
    .option('--force', 'Overwrite existing directory')
    .option('--template <template>', 'Template to use (default: basic)')
    .option('--competition <url>', 'URL of competition guidelines')
    .option('--interactive', 'Launch interactive setup assistant', false)
    .description('Initialize a new crypto trading agent project')
    .action((name, options) => {
      initializeProject(name, options);
    });
} 