#!/usr/bin/env node
import { McpClient } from './dist/lib/mcp/client.js';

// Create an instance of the enhanced MCP client
const mcpClient = new McpClient();

// Set a 30-second timeout since GitHub repos can take time to analyze
mcpClient.options.timeout = 30000;

async function testMcpEnhancements() {
  console.log('Testing MCP Server Enhancements with the Movement Plugin...\n');
  
  try {
    // Test 1: Get GitHub repository documentation with context
    console.log('1. Analyzing GitHub repository with context optimization...');
    const repoContext = 'Trading bots that need to implement movement strategies and position management';
    const repoData = await mcpClient.getGithubDocumentation(
      'elizaos-plugins/plugin-movement',
      'README.md',
      'main',
      repoContext
    );
    
    console.log(`\nRepository Documentation (optimized for context):
Source: ${repoData.source}
Content Length: ${repoData.content.length} characters
Metadata Keys: ${Object.keys(repoData.metadata || {}).join(', ')}
Context: "${repoContext}"
Content (first 300 chars): "${repoData.content.substring(0, 300)}..."
`);

    // Test 2: Scan the repository with content extraction
    console.log('\n2. Scanning repository with content extraction...');
    const scanOptions = {
      fileTypes: ['.ts', '.js', '.md'],
      maxDepth: 3,
      maxFiles: 10,
      fetchContent: true
    };
    
    const scanData = await mcpClient.scanGithubRepository(
      'elizaos-plugins/plugin-movement',
      scanOptions,
      'I need to implement a trading bot that manages positions'
    );
    
    console.log(`\nRepository Scan Results:
Files Analyzed: ${scanData.metadata?.filesAnalyzed || 'N/A'}
Content Length: ${scanData.content.length} characters
Structure: ${scanData.metadata?.fileStructure ? 'Available' : 'Not available'}
Content (first 300 chars): "${scanData.content.substring(0, 300)}..."
`);

    // Test 3: Generate usage examples based on repository analysis
    console.log('\n3. Generating usage examples with context...');
    const usageContext = 'I want to implement a momentum-based trading strategy that needs position tracking';
    const usageData = await mcpClient.getPluginUsageExamples(
      'plugin-movement',
      usageContext
    );
    
    console.log(`\nUsage Examples:
Content Length: ${usageData.content.length} characters
Context: "${usageContext}"
Content (first 300 chars): "${usageData.content.substring(0, 300)}..."
`);

    // Test 4: Generate strategy-specific documentation
    console.log('\n4. Getting documentation for a trading strategy...');
    const strategyDescription = {
      name: 'Momentum Cross Strategy',
      description: 'A strategy that tracks momentum using moving averages and manages positions with trailing stops',
      indicators: ['Moving Average', 'MACD', 'Volume Profile'],
      timeframes: ['1h', '4h'],
      tradingPairs: ['BTC/USD', 'ETH/USD']
    };
    
    const strategyDocs = await mcpClient.getDocumentationForStrategy(
      strategyDescription,
      'How can I track positions when implementing this strategy?'
    );
    
    console.log(`\nStrategy Documentation:
Total Documents: ${strategyDocs.length}
Relevant Plugins: ${strategyDocs.filter(doc => doc.source.includes('plugin')).length}
Strategy Type Docs: ${strategyDocs.filter(doc => doc.source.includes('strategy')).length}
Content Sample from First Doc (first 300 chars): "${strategyDocs[0]?.content.substring(0, 300) || 'N/A'}..."
`);

  } catch (error) {
    console.error('Error during MCP test:', error.message);
  }
}

// Run the tests
testMcpEnhancements()
  .then(() => console.log('\nTests completed successfully'))
  .catch(err => console.error('Test failed:', err))
  .finally(() => console.log('Test script finished')); 