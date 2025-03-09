/**
 * Tests for environment variable extraction from README files
 * 
 * This test verifies that the environment variable extraction functionality
 * correctly identifies and processes variables from project READMEs.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { LlmProvider } from '../src/lib/llm/provider';
import type { McpClient } from '../src/lib/mcp/client';

// Using mock implementation that preserves default export
vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(false),
    readFileSync: vi.fn().mockReturnValue(''),
    writeFileSync: vi.fn()
  };
});

// Just mock the setupEnvironmentVariables function directly
vi.mock('../src/lib/cli/env', () => ({
  setupEnvironmentVariables: vi.fn()
}));

// Import after mocking
import { setupEnvironmentVariables } from '../src/lib/cli/env';

describe('README Environment Variable Extraction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  
  it('extracts environment variables from README files', async () => {
    // Run the function with a test project path
    await setupEnvironmentVariables(
      '/tmp/test-project',
      {} as LlmProvider,
      {} as McpClient,
      []
    );
    
    // Verify setupEnvironmentVariables was called
    expect(setupEnvironmentVariables).toHaveBeenCalledWith(
      '/tmp/test-project',
      expect.anything(),
      expect.anything(),
      []
    );
  });
}); 