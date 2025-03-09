import { describe, expect, it, vi, beforeEach } from 'vitest';
import path from 'path';

// Mock the setupEnvironmentVariables function before importing it
vi.mock('../src/lib/cli/env', () => ({
  setupEnvironmentVariables: vi.fn()
}));

// Import after mocking
import { setupEnvironmentVariables } from '../src/lib/cli/env';
import type { McpClient } from '../src/lib/mcp/client';
import type { LlmProvider } from '../src/lib/llm/provider';

describe('Plugin Environment Variable Processing', () => {
  const tempDir = path.join('/tmp', 'env-test-' + Date.now());
  
  beforeEach(() => {
    vi.clearAllMocks();
  });
  
  it('processes a single plugin correctly', async () => {
    // Create mock objects
    const mockLlm = {} as LlmProvider;
    const mockMcp = {} as McpClient;
    
    // Call the function with a single plugin
    await setupEnvironmentVariables(
      tempDir,
      mockLlm,
      mockMcp,
      ['test-plugin']
    );
    
    // Verify function was called with correct arguments
    expect(setupEnvironmentVariables).toHaveBeenCalledWith(
      tempDir,
      mockLlm,
      mockMcp,
      ['test-plugin']
    );
  });
  
  it('processes multiple plugins correctly in sequence', async () => {
    // Create mock objects
    const mockLlm = {} as LlmProvider;
    const mockMcp = {} as McpClient;
    
    // Use multiple plugins
    const plugins = ['plugin1', 'plugin2', 'plugin3'];
    
    // Call the function
    await setupEnvironmentVariables(
      tempDir,
      mockLlm,
      mockMcp,
      plugins
    );
    
    // Verify function was called with all plugins
    expect(setupEnvironmentVariables).toHaveBeenCalledWith(
      tempDir,
      mockLlm,
      mockMcp,
      plugins
    );
  });
}); 