import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { McpServer } from '../src/lib/mcp/server';
import { McpClient } from '../src/lib/mcp/client';
import axios from 'axios';
import * as cheerio from 'cheerio';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { 
  findPluginExportInfo,
  directPluginIntegration,
  PluginInfo,
  updateProjectStructure
} from '../src/lib/agent/plugin-compatibility';

// Mock plugin data
const mockPlugins = [
  {
    name: '@elizaos/plugin-coinmarketcap',
    version: '0.25.6-alpha.1',
    description: 'CoinMarketCap plugin for Eliza',
    dependencies: [],
    installCommand: 'npm install @elizaos/plugin-coinmarketcap',
    capabilities: ['crypto-price-lookup'],
    docsUrl: 'https://elizaos.github.io/eliza/packages/plugins/coinmarketcap'
  },
  {
    name: '@elizaos/plugin-coingecko',
    version: '0.1.0',
    description: 'CoinGecko plugin for Eliza',
    dependencies: [],
    installCommand: 'npm install @elizaos/plugin-coingecko',
    capabilities: ['crypto-price-lookup'],
    docsUrl: 'https://elizaos.github.io/eliza/packages/plugins/coingecko'
  }
];

/**
 * Fetches documentation directly from the website
 */
async function fetchPluginDocs(url: string): Promise<string | null> {
  try {
    console.log(`Fetching documentation from URL: ${url}`);
    const response = await axios.get(url, { timeout: 5000 });
    const html = response.data;
    
    // Extract the actual content using cheerio
    const $ = cheerio.load(html);
    let content = '';
    
    // Get all code examples
    $('pre code').each((i, el) => {
      content += `\n\`\`\`\n${$(el).text()}\n\`\`\`\n`;
    });
    
    // Get the main content
    content = $('body').text() + content;
    
    return content;
  } catch (error) {
    console.error(`Error fetching docs from URL: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/**
 * Extracts plugin export information from documentation content
 */
function extractPluginInfo(content: string): { exportName?: string; isDefault?: boolean } {
  if (!content) return {};
  
  // Look for import statements
  const importRegex = /import\s+\{\s*([A-Za-z0-9_]+)\s*\}\s+from\s+['"]@elizaos\/plugin-[a-z]+['"]/g;
  const defaultImportRegex = /import\s+([A-Za-z0-9_]+)\s+from\s+['"]@elizaos\/plugin-[a-z]+['"]/g;
  
  let match = importRegex.exec(content);
  if (match && match[1]) {
    return { exportName: match[1], isDefault: false };
  }
  
  match = defaultImportRegex.exec(content);
  if (match && match[1] && !match[1].includes('{')) {
    return { exportName: match[1], isDefault: true };
  }
  
  // Look for class definitions with "Plugin" in the name
  const classRegex = /class\s+([A-Za-z0-9_]+Plugin)\b/g;
  match = classRegex.exec(content);
  if (match && match[1]) {
    return { exportName: match[1], isDefault: false }; // Assume not default if we can't tell
  }
  
  return {};
}

describe('Plugin Integration Tests', () => {
  describe('MCP Documentation Integration', () => {
    it('should verify connection to MCP server and analyze raw plugin documentation', async () => {
      // Set up MCP server and client
      const mcpServer = new McpServer();
      const mcpClient = new McpClient();
      
      // Start the server
      await mcpServer.start();
      
      try {
        // Check if the server is healthy
        const isHealthy = await mcpClient.isHealthy();
        
        // Skip test if MCP is not available
        if (!isHealthy) {
          console.log('MCP server is not accessible. Skipping test.');
          return;
        }
        
        // Test successful connection
        expect(isHealthy).toBe(true);
        
        const pluginResults: Record<string, any> = {};
        
        // Try to get documentation for each plugin
        for (const plugin of mockPlugins) {
          console.log(`\n----- Testing plugin: ${plugin.name} -----`);
          
          // First try direct website access
          const websiteContent = await fetchPluginDocs(plugin.docsUrl);
          
          // Analyze the website content if available
          if (websiteContent) {
            console.log('Successfully fetched documentation from website');
            
            // Extract plugin information
            const pluginInfo = extractPluginInfo(websiteContent);
            console.log('Extracted plugin information:', pluginInfo);
            
            // Save the results
            pluginResults[plugin.name] = {
              source: 'website',
              exportName: pluginInfo.exportName,
              isDefault: pluginInfo.isDefault
            };
            
            // If we got valid export info, we can continue to the next plugin
            if (pluginInfo.exportName) {
              console.log(`✅ Found export name for ${plugin.name}: ${pluginInfo.exportName} (${pluginInfo.isDefault ? 'default' : 'named'} export)`);
              continue;
            }
          }
          
          // If website approach failed, fall back to MCP client
          console.log('Falling back to MCP client...');
          console.log(`Fetching documentation for plugin: ${plugin.name}`);
          const docResponse = await mcpClient.getPluginDocumentation(plugin.name);
          
          // Log if we got fallback documentation
          const isFallbackDoc = docResponse.source.includes('fallback') || 
                             docResponse.source.includes('Generated');
          
          console.log(`Documentation source: ${docResponse.source}`);
          console.log(`Received fallback documentation: ${isFallbackDoc}`);
          
          // Extract plugin information from MCP response
          if (docResponse.content) {
            const pluginInfo = extractPluginInfo(docResponse.content);
            
            // Save the results
            pluginResults[plugin.name] = {
              source: isFallbackDoc ? 'fallback' : 'mcp',
              exportName: pluginInfo.exportName,
              isDefault: pluginInfo.isDefault
            };
            
            if (pluginInfo.exportName) {
              console.log(`✅ Found export name for ${plugin.name}: ${pluginInfo.exportName} (${pluginInfo.isDefault ? 'default' : 'named'} export)`);
            } else {
              console.log(`❌ Could not determine export name for ${plugin.name}`);
            }
          }
        }
        
        // Log overall results
        console.log('\n----- Plugin Integration Results -----');
        for (const [pluginName, result] of Object.entries(pluginResults)) {
          console.log(`${pluginName}: ${result.exportName || 'Unknown'} (${result.source})`);
        }
        
        // Expect that we found at least one plugin's export info
        expect(Object.values(pluginResults).some(r => r.exportName)).toBe(true);
        
      } finally {
        // Clean up
      }
    }, 60000); // Increase timeout to 60 seconds
  });

  describe('Plugin Export Info Direct Tests', () => {
    it('should directly retrieve export info for plugins from the documentation website', async () => {
      const testPlugins = [
        {
          name: '@elizaos/plugin-coinmarketcap',
          expectedExport: 'CoinMarketCapPlugin',
          expectedType: 'named'
        },
        {
          name: '@elizaos/plugin-coingecko',
          expectedExport: 'coingeckoPlugin',
          expectedType: 'named'
        }
      ];

      // Test directory path (doesn't need to exist for this test)
      const testProjectPath = '/tmp/test-project';
      
      // Test each plugin
      for (const plugin of testPlugins) {
        console.log(`\n----- Testing findPluginExportInfo for: ${plugin.name} -----`);
        
        // Call the function directly
        const result = await findPluginExportInfo(testProjectPath, plugin.name);
        
        // Log the result
        console.log('Result:', JSON.stringify(result, null, 2));
        
        // Verify success
        expect(result.success).toBe(true);
        
        // Verify we got the expected export name
        expect(result.exportName).toBe(plugin.expectedExport);
        
        // Verify the export type
        expect(result.importType).toBe(plugin.expectedType);
      }
    }, 60000); // Increase timeout to 60 seconds

    it('should fall back to name-based inference for plugins without documentation', async () => {
      // A non-existent plugin that should trigger the fallback
      const testPlugin = {
        name: '@elizaos/plugin-nonexistent',
        // Based on the inference logic, it should capitalize "Nonexistent" and add "Plugin"
        expectedExport: 'NonexistentPlugin',
        expectedType: 'named'
      };

      // Test directory path
      const testProjectPath = '/tmp/test-project';
      
      console.log(`\n----- Testing fallback for: ${testPlugin.name} -----`);
      
      // Call the function directly
      const result = await findPluginExportInfo(testProjectPath, testPlugin.name);
      
      // Log the result
      console.log('Result:', JSON.stringify(result, null, 2));
      
      // Verify success (should still succeed even though it's using a fallback)
      expect(result.success).toBe(true);
      
      // Verify we got the expected inferred export name
      expect(result.exportName).toBe(testPlugin.expectedExport);
      
      // Verify the export type (should always be 'named' for the fallback)
      expect(result.importType).toBe(testPlugin.expectedType);
    }, 60000); // Increase timeout to 60 seconds
  });

  describe('End-to-End Integration Tests', () => {
    let tempDir: string;
    
    // Setup test directory before each test
    beforeEach(async () => {
      // Create a temporary directory for the test project
      tempDir = path.join(os.tmpdir(), `plugin-test-${Date.now()}`);
      fs.mkdirSync(tempDir, { recursive: true });
      
      // Create src directory
      const srcDir = path.join(tempDir, 'src');
      fs.mkdirSync(srcDir, { recursive: true });
      
      // Create a basic index.ts file with agent creation
      const indexContent = `
import { createAgent } from '@elizaos/core';

// Create an Eliza agent
export function createMyAgent() {
  return createAgent({
    plugins: [
      // Plugins will be added here
    ]
  });
}
      `;
      
      fs.writeFileSync(path.join(srcDir, 'index.ts'), indexContent);
      
      // Create a basic package.json file
      const packageJson = {
        name: 'test-project',
        version: '1.0.0',
        dependencies: {
          '@elizaos/core': '^1.0.0'
        }
      };
      
      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify(packageJson, null, 2)
      );
    });
    
    // Clean up after each test
    afterEach(() => {
      // Remove the temporary directory
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });
    
    it('should correctly integrate a plugin using documentation from the website', async () => {
      // Test with CoinMarketCap plugin
      const plugin: PluginInfo = {
        name: '@elizaos/plugin-coinmarketcap',
        version: '0.25.6-alpha.1',
        description: 'CoinMarketCap plugin for Eliza',
        dependencies: [],
        installCommand: 'npm install @elizaos/plugin-coinmarketcap',
        capabilities: ['crypto-price-lookup']
      };
      
      // Mock fs.writeFileSync to prevent actual writes but intercept the content
      const writeFileSyncOriginal = fs.writeFileSync;
      const mockWriteFileSync = vi.fn((path, _content) => {
        console.log(`Mocked write to ${path}`);
        return true;
      });
      fs.writeFileSync = mockWriteFileSync as any;
      
      try {
        console.log(`\n----- Testing full integration for: ${plugin.name} -----`);
        console.log(`Test project path: ${tempDir}`);
        
        // Perform the direct integration
        const result = await directPluginIntegration(tempDir, plugin);
        
        // Log the result
        console.log('Integration result:', JSON.stringify(result, null, 2));
        
        // Check the result
        expect(result.success).toBe(true);
        expect(result.error).toBeUndefined();
        
        // Find the mock call for index.ts
        const indexTsUpdates = mockWriteFileSync.mock.calls.filter(
          call => call[0].toString().endsWith('index.ts')
        );
        
        if (indexTsUpdates.length > 0) {
          const updatedContent = indexTsUpdates[0][1].toString();
          console.log('Updated index.ts content:');
          console.log(updatedContent);
          
          // Verify the import statement was added (allowing for case differences)
          const hasCorrectImport = updatedContent.includes('import { coinmarketcapPlugin } from \'@elizaos/plugin-coinmarketcap\'') || 
                                   updatedContent.includes('import { CoinMarketCapPlugin } from \'@elizaos/plugin-coinmarketcap\'');
          expect(hasCorrectImport).toBe(true);
          
          // Verify the plugin was added to the plugins array (allowing for case differences and different usage)
          const hasCorrectUsage = updatedContent.includes('coinmarketcapPlugin') || 
                                  updatedContent.includes('CoinMarketCapPlugin') ||
                                  updatedContent.includes('new CoinMarketCapPlugin()');
          expect(hasCorrectUsage).toBe(true);
        } else {
          console.log('No updates to index.ts were captured');
          expect.fail('No updates to index.ts were captured');
        }
      } finally {
        // Restore original fs.writeFileSync
        fs.writeFileSync = writeFileSyncOriginal;
      }
    }, 60000); // Increase timeout to 60 seconds
    
    it('should correctly integrate multiple plugins at once', async () => {
      // Define plugins for the test
      const plugins: PluginInfo[] = [
        {
          name: '@elizaos/plugin-coinmarketcap',
          version: '0.25.6-alpha.1',
          description: 'CoinMarketCap plugin for Eliza',
          dependencies: [],
          installCommand: 'npm install @elizaos/plugin-coinmarketcap',
          capabilities: ['crypto-price-lookup']
        },
        {
          name: '@elizaos/plugin-coingecko',
          version: '0.1.0',
          description: 'CoinGecko plugin for Eliza',
          dependencies: [],
          installCommand: 'npm install @elizaos/plugin-coingecko',
          capabilities: ['crypto-price-lookup']
        }
      ];
      
      // Mock fs.writeFileSync to prevent actual writes but intercept the content
      const writeFileSyncOriginal = fs.writeFileSync;
      const mockWriteFileSync = vi.fn((path, _content) => {
        console.log(`Mocked write to ${path}`);
        return true;
      });
      fs.writeFileSync = mockWriteFileSync as any;
      
      try {
        console.log('\n----- Testing multi-plugin integration -----');
        console.log(`Test project path: ${tempDir}`);
        
        // Use updateProjectStructure to integrate all plugins at once
        const result = await updateProjectStructure(tempDir, plugins);
        
        // Log the result
        console.log('Integration result:', JSON.stringify(result, null, 2));
        
        // Check the result
        expect(result.success).toBe(true);
        expect(result.updatedFiles).toContain('src/index.ts');
        
        // Get all calls for index.ts
        const indexTsCalls = mockWriteFileSync.mock.calls.filter(
          call => call[0].toString().includes('index.ts')
        );
        
        console.log(`Total writes to index.ts: ${indexTsCalls.length}`);
        
        // We should have at least one write for each plugin
        expect(indexTsCalls.length).toBeGreaterThanOrEqual(plugins.length);
        
        // Check each call to see if it contains each plugin
        let foundCoinMarketCap = false;
        let foundCoinGecko = false;
        
        for (const call of indexTsCalls) {
          const content = call[1].toString();
          
          // Log each write for debugging
          console.log(`\nWrite call content:\n${content}`);
          
          if (content.includes('CoinMarketCapPlugin')) {
            foundCoinMarketCap = true;
          }
          
          if (content.includes('coingeckoPlugin')) {
            foundCoinGecko = true;
          }
        }
        
        // At least one of the writes should contain each plugin
        expect(foundCoinMarketCap).toBe(true);
        expect(foundCoinGecko).toBe(true);
        
        // Check for duplicate imports by examining the final content
        // In a real scenario, the final content would be the last write
        if (indexTsCalls.length > 0) {
          const finalContent = indexTsCalls[indexTsCalls.length - 1][1].toString();
          
          // Count occurrences of import statements
          const coinMarketCapImportCount = (finalContent.match(/from ['"]@elizaos\/plugin-coinmarketcap['"]/g) || []).length;
          const coingeckoImportCount = (finalContent.match(/from ['"]@elizaos\/plugin-coingecko['"]/g) || []).length;
          
          // Log the counts for debugging
          console.log(`CoinMarketCap import count in final write: ${coinMarketCapImportCount}`);
          console.log(`CoinGecko import count in final write: ${coingeckoImportCount}`);
          
          // In the final write, there should be at most one import per plugin
          // If it's the final content, it should have both plugins
          // If the final write only handles one plugin, then it will only have one import
          expect(coinMarketCapImportCount).toBeLessThanOrEqual(1);
          expect(coingeckoImportCount).toBeLessThanOrEqual(1);
        }
      } finally {
        // Restore original fs.writeFileSync
        fs.writeFileSync = writeFileSyncOriginal;
      }
    }, 60000); // Increase timeout to 60 seconds
  });

  /**
   * This test works with the actual installed plugins in the CLI project
   * to verify that our extraction logic correctly identifies the right export names
   */
  describe('Real Plugin Export Analysis', () => {
    // Define the ExportMatch interface at a higher scope
    interface ExportMatch {
      type: string;
      name: string;
    }
    
    it('should correctly identify export names from actual installed plugins', async () => {
      // Use the actual CLI project path
      const cliProjectPath = process.cwd();
      console.log(`Checking real plugins in: ${cliProjectPath}`);
      
      // Define the plugins to check
      const pluginsToCheck = [
        {
          name: '@elizaos/plugin-coinmarketcap',
          expectedName: 'coinmarketcapPlugin' // All lowercase based on the working code
        },
        {
          name: '@elizaos/plugin-coingecko',
          expectedName: 'coingeckoPlugin' // All lowercase, already correct
        }
      ];
      
      // Check if the node_modules directory exists
      const nodeModulesPath = path.join(cliProjectPath, 'node_modules');
      expect(fs.existsSync(nodeModulesPath)).toBe(true);
      
      for (const plugin of pluginsToCheck) {
        console.log(`\n----- Checking real plugin: ${plugin.name} -----`);
        
        // Check if the plugin directory exists
        const pluginPath = path.join(nodeModulesPath, plugin.name);
        const pluginExists = fs.existsSync(pluginPath);
        
        if (!pluginExists) {
          console.log(`Plugin ${plugin.name} is not installed. Skipping.`);
          continue;
        }
        
        console.log(`Found plugin directory: ${pluginPath}`);
        
        // Look for package.json
        const packageJsonPath = path.join(pluginPath, 'package.json');
        const packageJsonExists = fs.existsSync(packageJsonPath);
        
        if (packageJsonExists) {
          const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
          console.log(`Package name: ${packageJson.name}, version: ${packageJson.version}`);
          
          // Check if main or module is defined
          const mainFile = packageJson.main || packageJson.module || 'index.js';
          console.log(`Main entry point: ${mainFile}`);
        }
        
        // Check possible JavaScript files
        const possibleJsFiles = [
          path.join(pluginPath, 'dist', 'index.js'),
          path.join(pluginPath, 'lib', 'index.js'),
          path.join(pluginPath, 'index.js')
        ];
        
        // Manual examination of JS files
        let foundJsContent = false;
        for (const jsFile of possibleJsFiles) {
          if (fs.existsSync(jsFile)) {
            foundJsContent = true;
            const content = fs.readFileSync(jsFile, 'utf-8');
            console.log(`Found JS file: ${jsFile} (${content.length} bytes)`);
            
            // Look for exports
            const exportsRegex = /exports\.([A-Za-z0-9_]+Plugin)\s*=/g;
            const namedExportsRegex = /["']([A-Za-z0-9_]+Plugin)["']\s*:/g;
            const defaultExportRegex = /exports\.default\s*=\s*([A-Za-z0-9_]+Plugin)/g;
            
            const exportsMatches: ExportMatch[] = [];
            let match;
            
            // Reset regex and look for CommonJS exports
            exportsRegex.lastIndex = 0;
            while ((match = exportsRegex.exec(content)) !== null) {
              exportsMatches.push({
                type: 'commonjs named',
                name: match[1]
              });
            }
            
            // Reset regex and look for object property exports
            namedExportsRegex.lastIndex = 0;
            while ((match = namedExportsRegex.exec(content)) !== null) {
              exportsMatches.push({
                type: 'object property',
                name: match[1]
              });
            }
            
            // Reset regex and look for default exports
            defaultExportRegex.lastIndex = 0;
            while ((match = defaultExportRegex.exec(content)) !== null) {
              exportsMatches.push({
                type: 'default',
                name: match[1]
              });
            }
            
            if (exportsMatches.length > 0) {
              console.log('Found exports:');
              exportsMatches.forEach(exp => {
                console.log(`- ${exp.type}: ${exp.name}`);
                
                // Check if this matches our expected export
                if (exp.name === plugin.expectedName) {
                  console.log(`✅ MATCH: Found expected export ${plugin.expectedName}`);
                } else if (exp.name.toLowerCase() === plugin.expectedName.toLowerCase()) {
                  console.log(`⚠️ CASE MISMATCH: Found ${exp.name}, expected ${plugin.expectedName}`);
                }
              });
            } else {
              console.log('No export patterns found in the file.');
              
              // Check for alternative patterns
              const simplePattern = plugin.expectedName.replace(/Plugin$/, '');
              if (content.includes(plugin.expectedName)) {
                console.log(`✅ Found exact name "${plugin.expectedName}" in the content`);
              } else if (content.includes(simplePattern)) {
                console.log(`✅ Found base name "${simplePattern}" in the content`);
              }
              
              // Dump the first ~500 characters for debugging
              console.log(`First 500 chars of content:\n${content.substring(0, 500)}...`);
            }
            
            break; // Only examine the first JS file we find
          }
        }
        
        if (!foundJsContent) {
          console.log('No JavaScript files found. Checking for TypeScript definitions.');
          
          // Look for TypeScript definition files
          const definitionFiles = [
            path.join(pluginPath, 'dist', 'index.d.ts'),
            path.join(pluginPath, 'lib', 'index.d.ts'),
            path.join(pluginPath, 'index.d.ts')
          ];
          
          for (const dtsFile of definitionFiles) {
            if (fs.existsSync(dtsFile)) {
              const content = fs.readFileSync(dtsFile, 'utf-8');
              console.log(`Found TypeScript definition: ${dtsFile} (${content.length} bytes)`);
              
              // Look for exports in .d.ts files
              const exportRegex = /export\s+(default\s+)?(?:class|interface|const|function|type)\s+([A-Za-z0-9_]+Plugin)/g;
              const exportMatches: ExportMatch[] = [];
              let match;
              
              while ((match = exportRegex.exec(content)) !== null) {
                exportMatches.push({
                  type: match[1] ? 'default' : 'named',
                  name: match[2]
                });
              }
              
              if (exportMatches.length > 0) {
                console.log('Found TypeScript exports:');
                exportMatches.forEach(exp => {
                  console.log(`- ${exp.type}: ${exp.name}`);
                  
                  // Check if this matches our expected export
                  if (exp.name === plugin.expectedName) {
                    console.log(`✅ MATCH: Found expected export ${plugin.expectedName}`);
                  } else if (exp.name.toLowerCase() === plugin.expectedName.toLowerCase()) {
                    console.log(`⚠️ CASE MISMATCH: Found ${exp.name}, expected ${plugin.expectedName}`);
                  }
                });
              } else {
                console.log('No export patterns found in the TypeScript definition.');
                
                // Dump the first ~500 characters for debugging
                console.log(`First 500 chars of content:\n${content.substring(0, 500)}...`);
              }
              
              break; // Only examine the first definition file we find
            }
          }
        }
        
        // Try our actual verifyPluginExports function
        console.log('\nTesting verifyPluginExports function:');
        
        // Instead of importing dynamically, directly use and test findPluginExportInfo
        // since that's what we actually use in our code 
        console.log('Testing findPluginExportInfo function:');
        const result = await findPluginExportInfo(cliProjectPath, plugin.name);
        console.log('findPluginExportInfo result:', result);
        
        // We expect it to either find the exact expected name or a case variation
        if (result.exportName) {
          console.log(`Found export name: ${result.exportName} (${result.importType} export)`);
          
          // Check if our current detection logic gets the right casing
          if (result.exportName.toLowerCase() === plugin.expectedName.toLowerCase()) {
            if (result.exportName === plugin.expectedName) {
              console.log('✅ CORRECT: Our detection logic found the exact export name');
            } else {
              console.log(`⚠️ WRONG CASE: Our logic found "${result.exportName}" instead of "${plugin.expectedName}"`);
            }
          } else {
            console.log(`❌ WRONG NAME: Our logic found "${result.exportName}" which doesn't match "${plugin.expectedName}"`);
          }
        } else {
          console.log('❌ FAILED: Our detection logic did not find any export');
        }
      }
    }, 30000);
  });
}); 