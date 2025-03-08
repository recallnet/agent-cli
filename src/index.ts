#!/usr/bin/env node
import { Command } from 'commander';
import { config } from 'dotenv';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Import commands
import { initCommand } from './lib/cli/init.js';
import { registerPluginCommand } from './lib/cli/plugin.js';
import { agentCommand } from './lib/cli/agent.js';
import { llmCommand } from './lib/cli/llm.js';
import { McpServer } from './lib/mcp/server.js';
import { strategyCommand } from './lib/cli/strategy.js';
import { setupCommand } from './lib/cli/setup.js';

// Initialize environment variables
config();

// Get package version
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packagePath = path.join(__dirname, '..', 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const version = packageJson.version;

// Create program
const program = new Command();

// Set up CLI
program
  .name('recall-cli')
  .description('CLI tool for creating and managing crypto trading signal detection agents')
  .version(version);

// Register commands
initCommand(program);
registerPluginCommand(program);
agentCommand(program);
llmCommand(program);
strategyCommand(program);
setupCommand(program);

// Add help information
program.addHelpText('after', `
${chalk.bold('Examples:')}
  $ recall-cli init my-trading-agent
  $ recall-cli plugin list
  $ recall-cli plugin recommend --interactive
  $ recall-cli strategy build
  $ recall-cli agent create --strategy momentum
  $ recall-cli setup

${chalk.bold('Features:')}
  • Interactive strategy building with LLM assistance
  • Automatic plugin recommendations based on your strategy
  • Competition-aware strategy generation
  • Multi-provider LLM integration (OpenAI, Anthropic)
  • Comprehensive plugin management
`);

// Initialize MCP server command
program
  .command('mcp')
  .description('Manage the Managed Context Provider server')
  .option('-s, --start', 'Start the MCP server')
  .option('-k, --stop', 'Stop the MCP server')
  .option('-p, --port <port>', 'Port to run the server on')
  .action(async (options) => {
    const mcpServer = new McpServer({
      port: options.port ? Number(options.port) : undefined,
    });
    
    if (options.start) {
      try {
        await mcpServer.start();
        console.log(chalk.green('MCP server started'));
        
        // Keep the server running until interrupted
        console.log(chalk.yellow('Press Ctrl+C to stop the server'));
        process.on('SIGINT', async () => {
          await mcpServer.stop();
          process.exit(0);
        });
      } catch (error) {
        console.error(chalk.red(`Failed to start MCP server: ${error instanceof Error ? error.message : String(error)}`));
      }
    } else if (options.stop) {
      try {
        await mcpServer.stop();
        console.log(chalk.green('MCP server stopped'));
      } catch (error) {
        console.error(chalk.red(`Failed to stop MCP server: ${error instanceof Error ? error.message : String(error)}`));
      }
    } else {
      console.log(chalk.yellow('Please specify --start or --stop'));
    }
  });

// Parse arguments
program.parse();

// If no arguments, show help
if (!process.argv.slice(2).length) {
  program.outputHelp();
} 