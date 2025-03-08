#!/usr/bin/env node
import { Command } from 'commander';
import { config } from 'dotenv';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';

// Import commands
import { initCommand } from './lib/cli/init.js';
import { registerPluginCommand } from './lib/cli/plugin.js';
import { agentCommand } from './lib/cli/agent.js';
import { llmCommand } from './lib/cli/llm.js';
import { McpServer } from './lib/mcp/server.js';
import { strategyCommand } from './lib/cli/strategy.js';
import { setupCommand } from './lib/cli/setup.js';
import { startCommand } from './lib/cli/start.js';

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
startCommand(program);
initCommand(program);
registerPluginCommand(program);
agentCommand(program);
llmCommand(program);
strategyCommand(program);
setupCommand(program);

// Add help information
program.addHelpText('after', `
${chalk.bold('Examples:')}
  $ recall-cli start my-trading-agent                   ${chalk.gray('# All-in-one setup workflow')}
  $ recall-cli start                                    ${chalk.gray('# Use current directory')}
  $ recall-cli init my-trading-agent
  $ recall-cli plugin list
  $ recall-cli plugin recommend --interactive
  $ recall-cli strategy build
  $ recall-cli agent create --strategy momentum
  $ recall-cli setup

${chalk.bold('Features:')}
  • ${chalk.bold('Complete all-in-one setup workflow')} (use ${chalk.cyan('recall-cli start')})
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

// Test command for development purposes
program
  .command('test-docs')
  .description('Test documentation fetching for plugins')
  .argument('<plugin-name>', 'The name of the plugin to fetch documentation for')
  .action(async (pluginName) => {
    const { McpClient } = await import('./lib/mcp/client.js');
    const { startMcpServer } = await import('./lib/mcp/server.js');
    
    console.log('🧪 Starting MCP documentation test');
    
    // Start MCP server
    const port = 3100;
    await startMcpServer({ port, cacheTtl: 0 }); // Use cacheTtl 0 to force fresh data
    console.log(`🧪 MCP server started on port ${port}`);
    
    // Create client
    const mcp = new McpClient({
      baseUrl: `http://localhost:${port}`
    });
    
    try {
      // Wait for the server to be ready (small delay)
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Test fetching plugin documentation
      await mcp.testFetchPluginDocumentation(pluginName);
      
    } catch (error) {
      console.error(`❌ Error testing plugin documentation: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      // Don't stop the server to allow examining logs
      console.log('✅ Test complete - MCP server left running for debugging');
    }
  });

// Test fallback documentation command
program
  .command('test-fallback')
  .description('Test fallback documentation generation for plugins')
  .argument('<plugin-name>', 'The name of the plugin to fetch fallback documentation for')
  .action(async (pluginName) => {
    const { startMcpServer } = await import('./lib/mcp/server.js');
    
    console.log('🧪 Starting MCP fallback documentation test');
    
    // Start MCP server
    const port = 3100;
    await startMcpServer({ port, cacheTtl: 0 }); // Use cacheTtl 0 to force fresh data
    console.log(`🧪 MCP server started on port ${port}`);
    
    try {
      // Wait for the server to be ready (small delay)
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Direct fallback test
      console.log(`🧪 TEST: Fetching fallback documentation for plugin ${pluginName}`);
      const response = await axios.post(`http://localhost:${port}/query`, {
        type: 'plugin',
        query: pluginName,
        params: {
          useFallback: 'true'
        }
      });
      
      if (response.status === 200) {
        console.log(`✅ SUCCESS: Got fallback documentation for ${pluginName}`);
        console.log(`Source: ${response.data.source}`);
        console.log(`Content length: ${response.data.content.length} characters`);
        console.log(`First 150 chars: ${response.data.content.substring(0, 150)}...`);
      } else {
        console.error(`❌ ERROR: Failed to fetch fallback documentation - Status: ${response.status}`);
      }
      
    } catch (error) {
      console.error(`❌ Error testing fallback documentation: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      // Don't stop the server to allow examining logs
      console.log('✅ Test complete - MCP server left running for debugging');
    }
  });

// Parse arguments
program.parse();

// If no arguments, show help
if (!process.argv.slice(2).length) {
  program.outputHelp();
} 