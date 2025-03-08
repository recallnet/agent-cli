#!/usr/bin/env node

/**
 * Script to test the vector search functionality with different providers
 * 
 * This script creates mock implementations of both OpenAI and Anthropic providers
 * and tests that the vector search works correctly with both.
 * 
 * Usage:
 *   node test-vector-search.js
 */

// Import required modules
import * as path from 'path';
import * as fs from 'fs';
// import { fileURLToPath } from 'url'; // Not used
import { EmbeddingProviderFactory } from '../dist/lib/mcp/embedding-service.js';
import { DocumentStore } from '../dist/lib/mcp/document-store.js';

// Get current file directory with ES modules (not currently used)
// const __filename = fileURLToPath(import.meta.url);
// const __dirname = path.dirname(__filename);

// Create temp directory for test database
const tempDir = path.join('/tmp', 'vector-search-test-' + Date.now());
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}
const dbPath = path.join(tempDir, 'test-embeddings.db');

// Mock environment for testing
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'mock-openai-key';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'mock-anthropic-key';

// Override the embedding generation to use deterministic test vectors
const originalCreateProvider = EmbeddingProviderFactory.createProvider;
EmbeddingProviderFactory.createProvider = function(provider, _apiKey) {
  console.log(`Creating mock ${provider} provider`);
  
  return {
    generateEmbedding: async (text) => {
      console.log(`Generating mock embedding for: "${text.substring(0, 30)}..." using ${provider}`);
      // Generate deterministic mock embeddings with different dimensions for each provider
      const dimensions = provider.toLowerCase() === 'openai' ? 1536 : 1024;
      const vector = Array(dimensions).fill(0).map((_, i) => 
        (text.charCodeAt(i % text.length) || 0) / 255);
      
      return { vector, dimensions };
    },
    
    generateEmbeddings: async (texts) => {
      console.log(`Generating batch of ${texts.length} embeddings using ${provider}`);
      return Promise.all(texts.map(text => ({
        vector: Array(provider.toLowerCase() === 'openai' ? 1536 : 1024).fill(0).map((_, i) => 
          (text.charCodeAt(i % text.length) || 0) / 255),
        dimensions: provider.toLowerCase() === 'openai' ? 1536 : 1024
      })));
    }
  };
};

// Also override the createFromConfig method to always return our mock providers
const originalCreateFromConfig = EmbeddingProviderFactory.createFromConfig;
EmbeddingProviderFactory.createFromConfig = function() {
  // Get the current provider from environment or default to 'openai'
  const provider = process.env.LLM_PROVIDER || 'openai';
  return EmbeddingProviderFactory.createProvider(provider, 'mock-api-key');
};

// Test document content
const testDoc = {
  title: 'Cryptocurrency Trading Strategies',
  source: 'test',
  url: 'https://example.com/crypto-strategies',
  timestamp: Date.now(),
  doc_type: 'test'
};

const testContent = `
# Introduction to Cryptocurrency Trading Strategies

This document discusses various cryptocurrency trading strategies including:

## Trend Following Strategies
- Moving Average Crossover
- Relative Strength Index (RSI)
- MACD Indicator

## Mean Reversion Strategies
- Bollinger Bands
- Stochastic Oscillator

## Risk Management
It's important to use proper risk management when trading cryptocurrencies.
Always set stop losses and don't risk more than 1-2% of your capital on a single trade.

## Backtesting
Before using any strategy with real money, backtest it with historical data.
`;

// Test search queries
const queries = [
  'cryptocurrency trading strategies',
  'trend following',
  'risk management',
  'bollinger bands',
  'unrelated query about cats and dogs'
];

// Test both providers
async function runTest() {
  console.log('\n=== VECTOR SEARCH TEST ===');
  console.log('Testing vector search with both OpenAI and Anthropic providers\n');
  
  try {
    // Test with each provider
    for (const provider of ['openai', 'anthropic']) {
      console.log(`\n--- Testing with ${provider.toUpperCase()} Provider ---`);
      
      // Create document store
      const documentStore = new DocumentStore(dbPath);
      console.log(`Created document store with database at: ${dbPath}`);
      
      // Override the config to use our test provider
      process.env.LLM_PROVIDER = provider;
      
      // Store document with embeddings
      console.log('Storing test document with embeddings...');
      const docId = await documentStore.storeDocumentWithEmbeddings(testDoc, testContent, true);
      console.log(`Document stored with ID: ${docId}`);
      
      // Test vector search
      for (const query of queries) {
        console.log(`\nSearching for: "${query}"`);
        
        const startTime = Date.now();
        const results = await documentStore.vectorSearch(query, 3, 0.1);
        const duration = Date.now() - startTime;
        
        console.log(`Found ${results.length} results in ${duration}ms`);
        
        if (results.length > 0) {
          console.log(`Top result (similarity: ${results[0].similarity.toFixed(4)}):`);
          const snippet = results[0].chunk.content.substring(0, 100) + '...';
          console.log(`- ${snippet}`);
        } else {
          console.log('No results found.');
        }
      }
      
      // Test combined search
      console.log('\nTesting combined search (keyword + vector):');
      const combinedResults = await documentStore.combinedSearch('cryptocurrency risk management');
      console.log(`Found ${combinedResults.length} results with combined search`);
      
      if (combinedResults.length > 0) {
        console.log(`Top result (relevance: ${combinedResults[0].relevance.toFixed(4)}):`);
        const snippet = combinedResults[0].chunk.content.substring(0, 100) + '...';
        console.log(`- ${snippet}`);
      }
      
      // Close database
      documentStore.close();
    }
    
    console.log('\n✅ TEST COMPLETED SUCCESSFULLY');
    
  } catch (error) {
    console.error('\n❌ TEST FAILED:', error);
  } finally {
    // Clean up
    console.log('\nCleaning up...');
    try {
      if (fs.existsSync(dbPath)) {
        fs.unlinkSync(dbPath);
      }
      if (fs.existsSync(tempDir)) {
        fs.rmdirSync(tempDir);
      }
    } catch (e) {
      console.warn('Clean up warning (non-fatal):', e.message);
    }
    
    // Restore original implementation
    EmbeddingProviderFactory.createProvider = originalCreateProvider;
    EmbeddingProviderFactory.createFromConfig = originalCreateFromConfig;
  }
}

// Run the test
runTest().catch(console.error); 