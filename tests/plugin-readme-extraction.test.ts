/**
 * Tests for direct plugin README environment variable extraction
 * 
 * This test suite verifies that:
 * 1. We can directly extract environment variables from plugin README files
 * 2. The extraction works on various README formats
 * 3. The system handles missing README files gracefully
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { LlmProvider } from '../src/lib/llm/provider';
import * as path from 'path';
import * as fs from 'fs';
import { extractEnvVarsFromPluginReadme } from '../src/lib/cli/env';

// Sample README content with environment variables
const coingeckoReadme = `
# Plugin CoinGecko

A plugin for fetching cryptocurrency price data from the CoinGecko API.

## Overview

The Plugin CoinGecko provides a simple interface to get real-time cryptocurrency data. It integrates with CoinGecko's API to fetch current prices, market data, trending coins, and top gainers/losers for various cryptocurrencies in different fiat currencies.

This plugin uses the [CoinGecko Pro API](https://docs.coingecko.com/reference/introduction). Please refer to their documentation for detailed information about rate limits, available endpoints, and response formats.

## Installation

\`\`\`bash
pnpm add @elizaos/plugin-coingecko
\`\`\`

## Configuration

Set up your environment with the required CoinGecko API key:

| Variable Name       | Description            |
| ------------------- | ---------------------- |
| \`COINGECKO_API_KEY\` | Your CoinGecko Pro API key |
| \`COINGECKO_PRO_API_KEY\` | Your CoinGecko Pro API key |
`;

// Use mock implementation that preserves default export
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof fs>('fs');
  return {
    ...actual,
    existsSync: vi.fn().mockImplementation((filePath) => {
      // Return true for the CoinGecko README path
      if (typeof filePath === 'string' && filePath.includes('plugin-coingecko') && filePath.endsWith('README.md')) {
        return true;
      }
      // Return false for other README paths
      if (typeof filePath === 'string' && filePath.includes('plugin-missing') && filePath.endsWith('README.md')) {
        return false;
      }
      // Default to the actual implementation for other paths
      return (actual as any).existsSync(filePath);
    }),
    readFileSync: vi.fn().mockImplementation((filePath, _encoding) => {
      // Return the mock README content for CoinGecko
      if (typeof filePath === 'string' && filePath.includes('plugin-coingecko') && filePath.endsWith('README.md')) {
        return coingeckoReadme;
      }
      // Return empty string for other files
      return '';
    }),
    writeFileSync: vi.fn()
  };
});

// Create a mock for the LLM Provider
const mockLlmProvider = {
  prompt: vi.fn().mockImplementation(async (prompt, _options) => {
    // If prompt includes coingecko, return environment variables
    if (prompt.includes('COINGECKO_API_KEY')) {
      return {
        content: JSON.stringify({
          variables: [
            {
              key: 'COINGECKO_API_KEY',
              description: 'Your CoinGecko Pro API key',
              required: true,
              default: null,
              secret: true
            },
            {
              key: 'COINGECKO_PRO_API_KEY',
              description: 'Your CoinGecko Pro API key',
              required: true,
              default: null,
              secret: true
            }
          ]
        })
      };
    }
    
    // Default response for other plugins or content
    return {
      content: JSON.stringify({
        variables: []
      })
    };
  })
} as unknown as LlmProvider;

describe('Direct Plugin README Environment Variable Extraction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  
  it('extracts environment variables directly from plugin README', async () => {
    // Test extraction from CoinGecko README
    const variables = await extractEnvVarsFromPluginReadme('/tmp/test-project', '@elizaos/plugin-coingecko', mockLlmProvider);
    
    // Verify the extraction
    expect(variables).toHaveLength(2);
    expect(variables[0].key).toBe('COINGECKO_API_KEY');
    expect(variables[0].required).toBe(true);
    expect(variables[0].secret).toBe(true);
    expect(variables[1].key).toBe('COINGECKO_PRO_API_KEY');
    
    // Verify ReadFileSync was called with the correct path
    expect(vi.mocked(fs.readFileSync)).toHaveBeenCalledWith(
      expect.stringContaining(path.join('node_modules', '@elizaos', 'plugin-coingecko', 'README.md')),
      expect.anything()
    );
  });
  
  it('handles missing README files gracefully', async () => {
    // Test with a plugin that has no README
    const variables = await extractEnvVarsFromPluginReadme('/tmp/test-project', '@elizaos/plugin-missing', mockLlmProvider);
    
    // Verify the result is an empty array
    expect(variables).toHaveLength(0);
    
    // Verify existsSync was called to check for the README
    expect(vi.mocked(fs.existsSync)).toHaveBeenCalledWith(
      expect.stringContaining(path.join('node_modules', '@elizaos', 'plugin-missing', 'README.md'))
    );
  });
}); 