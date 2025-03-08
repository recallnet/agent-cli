/**
 * Tests for the embedding functionality in the MCP server
 * 
 * This test suite verifies that:
 * 1. The embedding service works with different providers (OpenAI and Anthropic)
 * 2. The DocumentStore correctly stores and retrieves embeddings
 * 3. Vector search works across different providers
 * 
 * Note: These tests use real API keys if available. Tests will be skipped
 * if the required API keys are not set in the environment.
 */

import * as path from 'path';
import * as fs from 'fs';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DocumentStore } from '../src/lib/mcp/document-store';
import { DocumentMetadata } from '../src/lib/mcp/document-store';

// Direct environment control instead of using config module
const ENV_KEYS = {
  PROVIDER: 'LLM_PROVIDER',
  OPENAI_KEY: 'OPENAI_API_KEY',
  ANTHROPIC_KEY: 'ANTHROPIC_API_KEY'
};

// Temporary directory for test database
const tempDir = path.join('/tmp', 'embedding-test-' + Date.now());
const dbPath = path.join(tempDir, 'test-embeddings.db');

// Save original provider
const originalProvider = process.env[ENV_KEYS.PROVIDER];

// Setup and teardown for tests
beforeAll(() => {
  // Create temporary directory for test database
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
});

afterAll(() => {
  // Clean up test database
  try {
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
    if (fs.existsSync(tempDir)) {
      fs.rmdirSync(tempDir);
    }
  } catch (error) {
    console.error('Error during cleanup:', error);
  }
  
  // Restore original provider
  if (originalProvider) {
    process.env[ENV_KEYS.PROVIDER] = originalProvider;
  } else {
    delete process.env[ENV_KEYS.PROVIDER];
  }
});

// Test document content
const testDoc: DocumentMetadata = {
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

// Helper to check if API keys are available
function hasApiKey(provider: string): boolean {
  const keyEnv = provider === 'openai' ? ENV_KEYS.OPENAI_KEY : ENV_KEYS.ANTHROPIC_KEY;
  const key = process.env[keyEnv];
  return !!key && key.length > 0;
}

describe('Embedding Functionality', () => {
  // Test with OpenAI provider
  describe('With OpenAI Provider', () => {
    let documentStore: DocumentStore;
    let docId: number;
    
    beforeAll(async () => {
      // Skip tests if OpenAI API key is not available
      if (!hasApiKey('openai')) {
        console.log('Skipping OpenAI tests: No API key available');
        return;
      }
      
      // Set provider to OpenAI
      process.env[ENV_KEYS.PROVIDER] = 'openai';
      
      // Create a document store
      documentStore = new DocumentStore(dbPath);
      
      // Store a document with embeddings
      docId = await documentStore.storeDocumentWithEmbeddings(testDoc, testContent, true);
    });
    
    afterAll(() => {
      // Close the document store if it was created
      if (documentStore) {
        documentStore.close();
      }
    });
    
    it('should store a document with OpenAI embeddings', () => {
      // Skip test if OpenAI API key is not available
      if (!hasApiKey('openai')) {
        return;
      }
      
      expect(docId).toBeDefined();
      expect(typeof docId).toBe('number');
    });
    
    it('should retrieve documents using vector search with OpenAI embeddings', async () => {
      // Skip test if OpenAI API key is not available
      if (!hasApiKey('openai')) {
        return;
      }
      
      for (const query of queries) {
        const results = await documentStore.vectorSearch(query, 5, 0.1);
        
        // We should get at least some results for relevant queries
        if (query.includes('cryptocurrency') || query.includes('trend') || query.includes('risk')) {
          expect(results.length).toBeGreaterThan(0);
          if (results.length > 0) {
            expect(results[0].similarity).toBeGreaterThan(0);
            expect(results[0].document).toBeDefined();
            expect(results[0].chunk).toBeDefined();
          }
        }
      }
    });
    
    it('should combine keyword and vector search', async () => {
      // Skip test if OpenAI API key is not available
      if (!hasApiKey('openai')) {
        return;
      }
      
      const results = await documentStore.combinedSearch('cryptocurrency');
      expect(results.length).toBeGreaterThan(0);
      if (results.length > 0) {
        expect(results[0].relevance).toBeGreaterThan(0);
      }
    });
  });
  
  // Test with Anthropic provider
  describe('With Anthropic Provider', () => {
    let documentStore: DocumentStore;
    let docId: number;
    
    beforeAll(async () => {
      // Skip tests if Anthropic API key is not available
      if (!hasApiKey('anthropic')) {
        console.log('Skipping Anthropic tests: No API key available');
        return;
      }
      
      // Set provider to Anthropic
      process.env[ENV_KEYS.PROVIDER] = 'anthropic';
      
      // Create a document store
      documentStore = new DocumentStore(dbPath);
      
      // Store a document with embeddings
      docId = await documentStore.storeDocumentWithEmbeddings(testDoc, testContent, true);
    });
    
    afterAll(() => {
      // Close the document store if it was created
      if (documentStore) {
        documentStore.close();
      }
    });
    
    it('should store a document with Anthropic embeddings', () => {
      // Skip test if Anthropic API key is not available
      if (!hasApiKey('anthropic')) {
        return;
      }
      
      expect(docId).toBeDefined();
      expect(typeof docId).toBe('number');
    });
    
    it('should retrieve documents using vector search with Anthropic embeddings', async () => {
      // Skip test if Anthropic API key is not available
      if (!hasApiKey('anthropic')) {
        return;
      }
      
      for (const query of queries) {
        const results = await documentStore.vectorSearch(query, 5, 0.1);
        
        // We should get at least some results for relevant queries
        if (query.includes('cryptocurrency') || query.includes('trend') || query.includes('risk')) {
          expect(results.length).toBeGreaterThan(0);
          if (results.length > 0) {
            expect(results[0].similarity).toBeGreaterThan(0);
            expect(results[0].document).toBeDefined();
            expect(results[0].chunk).toBeDefined();
          }
        }
      }
    });
    
    it('should combine keyword and vector search', async () => {
      // Skip test if Anthropic API key is not available
      if (!hasApiKey('anthropic')) {
        return;
      }
      
      const results = await documentStore.combinedSearch('cryptocurrency');
      expect(results.length).toBeGreaterThan(0);
      if (results.length > 0) {
        expect(results[0].relevance).toBeGreaterThan(0);
      }
    });
  });
  
  // Test provider switching
  describe('Provider Switching', () => {
    let openAiDocumentStore: DocumentStore | null = null;
    let anthropicDocumentStore: DocumentStore | null = null;
    
    beforeAll(async () => {
      // Skip if either provider's API key is missing
      if (!hasApiKey('openai') || !hasApiKey('anthropic')) {
        console.log('Skipping provider switching test: Missing API keys');
        return;
      }
      
      // Set up with OpenAI
      process.env[ENV_KEYS.PROVIDER] = 'openai';
      openAiDocumentStore = new DocumentStore(dbPath);
      
      // Switch to Anthropic
      process.env[ENV_KEYS.PROVIDER] = 'anthropic';
      anthropicDocumentStore = new DocumentStore(dbPath);
    });
    
    afterAll(() => {
      // Close the document stores if they were created
      if (openAiDocumentStore) {
        openAiDocumentStore.close();
      }
      if (anthropicDocumentStore) {
        anthropicDocumentStore.close();
      }
    });
    
    it('should use the correct provider when switching between them', async () => {
      // Skip test if either provider's API key is missing
      if (!hasApiKey('openai') || !hasApiKey('anthropic') || !openAiDocumentStore || !anthropicDocumentStore) {
        return;
      }
      
      // Store with OpenAI
      process.env[ENV_KEYS.PROVIDER] = 'openai';
      const openAiDocId = await openAiDocumentStore.storeDocumentWithEmbeddings(
        { ...testDoc, title: 'OpenAI Test' },
        'This is an OpenAI test document',
        true
      );
      
      // Store with Anthropic
      process.env[ENV_KEYS.PROVIDER] = 'anthropic';
      const anthropicDocId = await anthropicDocumentStore.storeDocumentWithEmbeddings(
        { ...testDoc, title: 'Anthropic Test' },
        'This is an Anthropic test document',
        true
      );
      
      // Verify IDs were created properly
      expect(openAiDocId).toBeDefined();
      expect(anthropicDocId).toBeDefined();
      expect(typeof openAiDocId).toBe('number');
      expect(typeof anthropicDocId).toBe('number');
      
      // Search with both providers
      process.env[ENV_KEYS.PROVIDER] = 'openai';
      const openAiResults = await openAiDocumentStore.vectorSearch('test document');
      
      process.env[ENV_KEYS.PROVIDER] = 'anthropic';
      const anthropicResults = await anthropicDocumentStore.vectorSearch('test document');
      
      // Both searches should return results
      expect(openAiResults.length).toBeGreaterThan(0);
      expect(anthropicResults.length).toBeGreaterThan(0);
      
      // The embeddings should be different, resulting in different similarity scores
      if (openAiResults.length > 0 && anthropicResults.length > 0) {
        // The results will likely be different because the embeddings are different
        console.log(`OpenAI similarity: ${openAiResults[0].similarity}, Anthropic similarity: ${anthropicResults[0].similarity}`);
      }
    });
  });
}); 