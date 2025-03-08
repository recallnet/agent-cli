#!/usr/bin/env node
import { McpClient } from './dist/lib/mcp/client.js';

// Create an instance of the enhanced MCP client
const mcpClient = new McpClient();

// Set a 30-second timeout
mcpClient.options.timeout = 30000;

async function testMcpEnhancements() {
  console.log('Testing MCP Server Basic Functionality with the Movement Plugin...\n');
  
  try {
    // Test 1: Get GitHub README with context optimization
    console.log('1. Fetching GitHub README with context optimization...');
    const repoContext = 'Trading bots that need to implement movement strategies and position management';
    const repoData = await mcpClient.getGithubDocumentation(
      'elizaos-plugins/plugin-movement',
      'README.md',
      'main',
      repoContext
    );
    
    console.log(`\nRepository Documentation:
Source: ${repoData.source}
Content Length: ${repoData.content.length} characters
Optimized: ${repoData.metadata?.optimized ? 'Yes' : 'No'}
Context: "${repoContext}"
Content: 
-------------------------------------
${repoData.content}
-------------------------------------
`);

    // Test 2: Get plugin documentation with different context
    console.log('\n2. Fetching plugin information with different context...');
    const pluginContext = 'I want to track blockchain transactions on Movement Network';
    try {
      const pluginData = await mcpClient.getPluginDocumentation(
        'plugin-movement',
        pluginContext
      );
      
      console.log(`\nPlugin Documentation:
Source: ${pluginData.source}
Content Length: ${pluginData.content.length} characters
Context: "${pluginContext}"
Content (excerpt):
-------------------------------------
${pluginData.content.substring(0, 500)}...
-------------------------------------
`);
    } catch (err) {
      console.log(`Plugin documentation not available: ${err.message}`);
    }

    // Test 3: Get documentation for a strategy mentioning movement
    console.log('\n3. Getting documentation for a trading strategy mentioning movement...');
    const strategyContext = generateContext({
      strategy: 'A strategy for tracking token movements and transaction history',
      tradingPairs: ['MOVE/USD'],
      questionOrTask: 'How can I implement this on the Movement Network?'
    });
    
    console.log(`Generated Context: "${strategyContext}"`);

  } catch (error) {
    console.error('Error during MCP test:', error.message);
  }
}

// Simplified version of the context generation function 
function generateContext(options) {
  const contextParts = [];
  
  if (options.strategy) {
    contextParts.push(`Strategy: ${options.strategy}`);
  }
  
  if (options.tradingPairs && options.tradingPairs.length > 0) {
    contextParts.push(`Trading pairs: ${options.tradingPairs.join(', ')}`);
  }
  
  if (options.questionOrTask) {
    contextParts.push(`Question/Task: ${options.questionOrTask}`);
  }
  
  return contextParts.join('. ');
}

// Run the tests
testMcpEnhancements()
  .then(() => console.log('\nTests completed successfully'))
  .catch(err => console.error('Test failed:', err))
  .finally(() => console.log('Test script finished')); 