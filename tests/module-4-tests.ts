import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { execSync } from 'child_process';

// Import modules to test
import { 
  checkSystemPrerequisites, 
  validateProjectStructure, 
  canInitializeProject 
} from '../src/lib/agent/prerequisites.js';

import {
  analyzeEnvironment,
  generateEnvFile,
  extractEnvVariablesFromFiles
} from '../src/lib/agent/environment-analyzer.js';

import {
  checkPluginCompatibility,
  getInstalledPlugins,
  updateProjectStructure
} from '../src/lib/agent/plugin-compatibility.js';

// Mock implementations
vi.mock('child_process', () => ({
  exec: vi.fn(),
  execSync: vi.fn()
}));

// Helper to create a temp test directory
function createTempTestDir(suffix = 'test-project'): string {
  const tempDir = path.join(os.tmpdir(), `recall-cli-test-${suffix}-${Date.now()}`);
  fs.mkdirSync(tempDir, { recursive: true });
  return tempDir;
}

// Create test project structure
function createTestProjectStructure(projectPath: string, includeAllFiles = true): void {
  // Create required directories
  const directories = [
    'src',
    'src/actions',
    'src/providers',
    'characters',
    'strategies'
  ];
  
  for (const dir of directories) {
    fs.mkdirSync(path.join(projectPath, dir), { recursive: true });
  }
  
  if (includeAllFiles) {
    // Create required files with minimal content
    const files = {
      'package.json': JSON.stringify({
        name: 'test-project',
        version: '0.1.0',
        dependencies: {
          '@elizaos/core': '^1.0.0',
          '@elizaos/agent': '^1.0.0'
        }
      }),
      'tsconfig.json': JSON.stringify({
        compilerOptions: {
          target: 'ES2020',
          module: 'NodeNext'
        }
      }),
      'src/index.ts': 'console.log("Test project")',
      'src/types.ts': 'export type TestType = string;',
      'src/environment.ts': 'export const config = {};'
    };
    
    for (const [filePath, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(projectPath, filePath), content);
    }
  }
}

// Create test .env file
function createTestEnvFile(projectPath: string, variables: Record<string, string>): void {
  let envContent = '';
  
  for (const [key, value] of Object.entries(variables)) {
    envContent += `${key}=${value}\n`;
  }
  
  fs.writeFileSync(path.join(projectPath, '.env'), envContent);
}

describe('Module 4: Agent Initialization System', () => {
  // Test prerequisites validation
  describe('Prerequisites Validation', () => {
    test('checkSystemPrerequisites should detect installed tools', async () => {
      // Mock successful command executions
      vi.mocked(execSync).mockImplementation((cmd: string) => {
        if (cmd.includes('node --version')) return Buffer.from('v22.0.0');
        if (cmd.includes('pnpm --version')) return Buffer.from('8.0.0');
        if (cmd.includes('git --version')) return Buffer.from('git version 2.30.0');
        throw new Error(`Unexpected command: ${cmd}`);
      });
      
      const result = await checkSystemPrerequisites();
      
      expect(result.allSatisfied).toBe(true);
      expect(result.nodeVersion).toBe('v22.0.0');
      expect(result.pnpmInstalled).toBe(true);
      expect(result.gitInstalled).toBe(true);
    });
    
    test('validateProjectStructure should detect valid structure', () => {
      const testDir = createTempTestDir('valid-structure');
      createTestProjectStructure(testDir);
      
      const result = validateProjectStructure(testDir);
      
      expect(result.valid).toBe(true);
      expect(result.issues.length).toBe(0);
      
      // Clean up
      fs.rmSync(testDir, { recursive: true, force: true });
    });
    
    test('validateProjectStructure should identify missing components', () => {
      const testDir = createTempTestDir('invalid-structure');
      createTestProjectStructure(testDir, false); // Only create directories
      
      const result = validateProjectStructure(testDir);
      
      expect(result.valid).toBe(false);
      expect(result.missingFiles.length).toBeGreaterThan(0);
      
      // Clean up
      fs.rmSync(testDir, { recursive: true, force: true });
    });
    
    test('canInitializeProject should detect if directory can be initialized', () => {
      const emptyDir = createTempTestDir('empty-dir');
      const nonEmptyDir = createTempTestDir('non-empty-dir');
      
      // Create a file in non-empty dir
      fs.writeFileSync(path.join(nonEmptyDir, 'some-file.txt'), 'content');
      
      const emptyResult = canInitializeProject(emptyDir);
      const nonEmptyResult = canInitializeProject(nonEmptyDir);
      
      expect(emptyResult.canInitialize).toBe(true);
      expect(nonEmptyResult.canInitialize).toBe(false);
      
      // Clean up
      fs.rmSync(emptyDir, { recursive: true, force: true });
      fs.rmSync(nonEmptyDir, { recursive: true, force: true });
    });
  });
  
  // Test environment analyzer
  describe('Environment Analyzer', () => {
    let testDir: string;
    
    beforeEach(() => {
      testDir = createTempTestDir('env-analyzer');
      createTestProjectStructure(testDir);
    });
    
    afterEach(() => {
      fs.rmSync(testDir, { recursive: true, force: true });
    });
    
    test('analyzeEnvironment should detect environment variables', () => {
      // Create test .env file
      createTestEnvFile(testDir, {
        'OPENAI_API_KEY': 'test-key-1',
        'RECALL_BUCKET_NAME': 'test-bucket'
      });
      
      // Set process.env for testing
      const originalEnv = process.env;
      process.env = {
        ...originalEnv,
        ANTHROPIC_API_KEY: 'test-key-2'
      };
      
      const result = analyzeEnvironment(testDir, ['@elizaos-plugins/ccxt']);
      
      expect(result.availableVariables.length).toBeGreaterThan(0);
      expect(result.pluginRequirements.length).toBe(1);
      
      // Restore original process.env
      process.env = originalEnv;
    });
    
    test('generateEnvFile should create a valid .env file', () => {
      const variables = [
        {
          name: 'TEST_VAR_1',
          description: 'Test variable 1',
          required: true,
          secret: false,
          value: 'test-value-1',
          source: 'user-input' as const
        },
        {
          name: 'TEST_VAR_2',
          description: 'Test variable 2',
          required: false,
          secret: true,
          value: 'test-value-2',
          source: 'user-input' as const
        }
      ];
      
      const result = generateEnvFile(testDir, variables);
      
      expect(result.success).toBe(true);
      expect(fs.existsSync(result.filePath)).toBe(true);
      
      const fileContent = fs.readFileSync(result.filePath, 'utf8');
      expect(fileContent).toContain('TEST_VAR_1=test-value-1');
      expect(fileContent).toContain('TEST_VAR_2=test-value-2');
    });
    
    test('extractEnvVariablesFromFiles should find environment variables in code', () => {
      // Create a file with environment variables
      const testFilePath = path.join(testDir, 'src', 'test-env.ts');
      const testFileContent = `
        const apiKey = process.env.API_KEY;
        const secret = process.env.API_SECRET;
        if (process.env.DEBUG) {
          console.log('Debug mode');
        }
      `;
      
      fs.writeFileSync(testFilePath, testFileContent);
      
      const result = extractEnvVariablesFromFiles(testDir);
      
      expect(result).toContain('API_KEY');
      expect(result).toContain('API_SECRET');
      expect(result).toContain('DEBUG');
    });
  });
  
  // Test plugin compatibility
  describe('Plugin Compatibility', () => {
    let testDir: string;
    
    beforeEach(() => {
      testDir = createTempTestDir('plugin-compatibility');
      createTestProjectStructure(testDir);
      
      // Create a package.json with plugins
      const packageJson = {
        name: 'test-project',
        version: '0.1.0',
        dependencies: {
          '@elizaos/core': '^1.0.0',
          '@elizaos/agent': '^1.0.0',
          '@elizaos-plugins/ccxt': '^1.0.0'
        }
      };
      
      fs.writeFileSync(
        path.join(testDir, 'package.json'),
        JSON.stringify(packageJson, null, 2)
      );
    });
    
    afterEach(() => {
      fs.rmSync(testDir, { recursive: true, force: true });
    });
    
    test('getInstalledPlugins should detect installed plugins', async () => {
      const plugins = await getInstalledPlugins(testDir);
      
      expect(plugins.length).toBeGreaterThan(0);
      expect(plugins.some(p => p.name === '@elizaos-plugins/ccxt')).toBe(true);
    });
    
    test('checkPluginCompatibility should identify compatible plugins', async () => {
      // Setup plugin registry mock
      const installedPlugins = await getInstalledPlugins(testDir);
      const pluginRegistry = {
        '@elizaos-plugins/binance': {
          name: '@elizaos-plugins/binance',
          version: '1.0.0',
          description: 'Binance plugin',
          dependencies: [],
          installCommand: 'pnpm add @elizaos-plugins/binance',
          capabilities: ['exchange-api']
        }
      };
      
      const result = await checkPluginCompatibility('@elizaos-plugins/binance', installedPlugins, pluginRegistry);
      
      expect(result.compatible).toBe(true);
      expect(result.conflicts.length).toBe(0);
    });
    
    test('updateProjectStructure should update project files', () => {
      // Create test environment.ts
      const environmentTs = `
        export const config = {
          // Existing config
        };
      `;
      
      fs.writeFileSync(path.join(testDir, 'src', 'environment.ts'), environmentTs);
      
      // Create test index.ts
      const indexTs = `
        import { createAgent } from '@elizaos/agent';
        
        async function main() {
          const agent = createAgent();
          
          // Rest of code
        }
        
        main();
      `;
      
      fs.writeFileSync(path.join(testDir, 'src', 'index.ts'), indexTs);
      
      // Test plugins
      const plugins = [
        {
          name: '@elizaos-plugins/ccxt',
          version: '1.0.0',
          description: 'CCXT plugin',
          dependencies: [],
          installCommand: 'pnpm add @elizaos-plugins/ccxt',
          capabilities: []
        },
        {
          name: '@elizaos-plugins/binance',
          version: '1.0.0',
          description: 'Binance plugin',
          dependencies: [],
          installCommand: 'pnpm add @elizaos-plugins/binance',
          capabilities: []
        }
      ];
      
      const result = updateProjectStructure(testDir, plugins);
      
      expect(result.success).toBe(true);
      expect(result.updatedFiles.length).toBeGreaterThan(0);
      
      // Verify updates
      const updatedEnvironmentTs = fs.readFileSync(path.join(testDir, 'src', 'environment.ts'), 'utf8');
      expect(updatedEnvironmentTs).toContain('@elizaos-plugins/ccxt');
      
      const updatedIndexTs = fs.readFileSync(path.join(testDir, 'src', 'index.ts'), 'utf8');
      expect(updatedIndexTs).toContain('@elizaos-plugins/binance');
    });
  });
}); 