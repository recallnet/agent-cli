import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import path from 'path';
import fs from 'fs';
import * as simpleGit from 'simple-git';

// Import utilities
import { validateEnvironment } from '../utils/validation.js';
import { configureEnvironment } from '../utils/config.js';

/**
 * Initialize a new crypto trading agent project
 * @param projectName Name for the new project
 * @param options Command options
 */
export async function initializeProject(projectName: string, options: any) {
  const spinner = ora('Initializing new crypto trading agent project').start();
  
  try {
    // Create project directory
    const projectPath = path.resolve(process.cwd(), projectName);
    
    // Check if directory already exists
    if (fs.existsSync(projectPath)) {
      if (!options.force) {
        spinner.fail(`Directory ${chalk.cyan(projectName)} already exists. Use --force to overwrite.`);
        return;
      }
      spinner.info(`Directory ${chalk.cyan(projectName)} already exists. Using --force to continue.`);
    } else {
      fs.mkdirSync(projectPath, { recursive: true });
    }

    // Switch to project directory
    process.chdir(projectPath);
    
    // Clone Recall Agent Starter Kit
    spinner.text = 'Cloning Recall Agent Starter Kit';
    const git = simpleGit.simpleGit();
    await git.clone('https://github.com/recallnet/recall-agent-starter', '.');
    
    // Validate environment
    spinner.text = 'Validating environment';
    await validateEnvironment();
    
    // Configure environment
    spinner.text = 'Configuring environment';
    await configureEnvironment(options);
    
    // Success
    spinner.succeed(`Successfully initialized project ${chalk.green(projectName)}`);
    console.log(`\nNext steps:
    1. cd ${projectName}
    2. recall-cli llm set-key
    3. recall-cli plugin list
    4. recall-cli agent create`);
    
  } catch (error) {
    spinner.fail(`Failed to initialize project: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Register the init command with the CLI
 */
export function initCommand(program: Command) {
  program
    .command('init')
    .description('Initialize a new crypto trading agent project')
    .argument('<project-name>', 'Name of the project to create')
    .option('-f, --force', 'Force overwrite if project directory exists', false)
    .option('--template <template>', 'Template to use (basic, advanced)', 'basic')
    .option('--competition <url>', 'Competition specification URL')
    .action(initializeProject);
} 