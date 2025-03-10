import * as semver from 'semver';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import ora from 'ora';
import chalk from 'chalk';
import { PluginRegistry } from '../plugins/registry.js';
import axios from 'axios';
import * as cheerio from 'cheerio';

const execPromise = promisify(exec);

/**
 * Required Node.js version for Eliza OS and plugins (exact version)
 */
export const REQUIRED_NODE_VERSION = '22.11.0';

/**
 * Required pnpm version for Eliza OS and plugins (exact version)
 */
export const REQUIRED_PNPM_VERSION = '9.15.4';

/**
 * Check if the current Node.js version meets requirements
 * @returns Object containing compatibility status and current version
 */
export function checkNodeVersion(): { compatible: boolean; currentVersion: string; requiredVersion: string } {
  const currentVersion = process.version;
  const versionWithoutV = currentVersion.substring(1); // Remove the 'v' prefix
  
  // Use exact version comparison instead of semver.satisfies
  const compatible = versionWithoutV === REQUIRED_NODE_VERSION;
  
  return {
    compatible,
    currentVersion,
    requiredVersion: REQUIRED_NODE_VERSION
  };
}

/**
 * Check if pnpm is installed and meets the version requirement
 * @returns Object containing compatibility status and version info
 */
export async function checkPnpmVersion(): Promise<{ installed: boolean; compatible: boolean; currentVersion?: string; error?: string }> {
  try {
    // Check if pnpm is installed
    const { stdout } = await execPromise('pnpm -v');
    const currentVersion = stdout.trim();
    
    // Check for exact version match
    const compatible = currentVersion === REQUIRED_PNPM_VERSION;
    
    return {
      installed: true,
      compatible,
      currentVersion
    };
  } catch (error) {
    return {
      installed: false,
      compatible: false,
      error: `pnpm is not installed or not available in PATH: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

/**
 * Ensure the correct Node.js and pnpm versions are used
 * This function will exit the process if the versions are incorrect
 */
export function enforceVersionRequirements(): void {
  // Check Node.js version
  const nodeCheck = checkNodeVersion();
  if (!nodeCheck.compatible) {
    console.error(chalk.red('Error: Incorrect Node.js version'));
    console.error(chalk.red(`Required: ${nodeCheck.requiredVersion}, Current: ${nodeCheck.currentVersion}`));
    console.error(chalk.yellow(`Please use Node.js version ${nodeCheck.requiredVersion} to run this application.`));
    console.error(chalk.yellow('If you have nvm installed, you can run:'));
    console.error(chalk.cyan(`  nvm install ${nodeCheck.requiredVersion}`));
    console.error(chalk.cyan(`  nvm use ${nodeCheck.requiredVersion}`));
    
    // Exit with error code
    process.exit(1);
  }
  
  // We don't check pnpm version here since it's async, but we'll check it before any installation
}

// Core plugin interfaces
export interface PluginDependency {
  name: string;
  version: string;
  required: boolean;
}

export interface PluginInfo {
  name: string;
  version: string;
  description: string;
  dependencies: PluginDependency[];
  installCommand: string;
  compatibilityNotes?: string;
  capabilities: string[];
}

export interface PluginCompatibilityResult {
  compatible: boolean;
  plugin: PluginInfo;
  conflicts: {
    plugin: string;
    reason: string;
  }[];
  missingDependencies: PluginDependency[];
  recommendations: string[];
}

export interface PluginInstallResult {
  success: boolean;
  pluginName: string;
  version?: string;
  error?: string;
  installOutput?: string;
}

/**
 * Check if plugin is compatible with currently installed plugins
 */
export async function checkPluginCompatibility(
  pluginName: string,
  installedPlugins: PluginInfo[],
  pluginRegistry: Record<string, PluginInfo>
): Promise<PluginCompatibilityResult> {
  // First check Node.js version
  const nodeVersionCheck = checkNodeVersion();
  
  const plugin = pluginRegistry[pluginName];
  
  if (!plugin) {
    return {
      compatible: false,
      plugin: {
        name: pluginName,
        version: '',
        description: '',
        dependencies: [],
        installCommand: '',
        capabilities: []
      },
      conflicts: [
        {
          plugin: pluginName,
          reason: 'Plugin not found in registry'
        }
      ],
      missingDependencies: [],
      recommendations: ['Check plugin name or update plugin registry']
    };
  }
  
  const conflicts: { plugin: string; reason: string }[] = [];
  const missingDependencies: PluginDependency[] = [];
  const recommendations: string[] = [];
  
  // Add Node.js version conflict if necessary
  if (!nodeVersionCheck.compatible) {
    conflicts.push({
      plugin: 'Node.js',
      reason: `Incorrect Node.js version. Required: ${nodeVersionCheck.requiredVersion}, Current: ${nodeVersionCheck.currentVersion}`
    });
    
    recommendations.push(
      `Use Node.js version ${nodeVersionCheck.requiredVersion} for best compatibility with Eliza OS plugins`
    );
  }
  
  // Check for compatibility with installed plugins
  for (const installedPlugin of installedPlugins) {
    // Check capability conflicts
    const capabilityOverlap = plugin.capabilities.filter(cap => 
      installedPlugin.capabilities.includes(cap)
    );
    
    if (capabilityOverlap.length > 0) {
      conflicts.push({
        plugin: installedPlugin.name,
        reason: `Capability conflict: both provide ${capabilityOverlap.join(', ')}`
      });
      
      recommendations.push(
        `Consider choosing between ${plugin.name} and ${installedPlugin.name} as they have overlapping capabilities`
      );
    }
  }
  
  // Check for missing dependencies
  for (const dependency of plugin.dependencies) {
    const dependencyInstalled = installedPlugins.some(
      p => p.name === dependency.name && 
           (!dependency.version || semver.satisfies(p.version, dependency.version))
    );
    
    if (!dependencyInstalled && dependency.required) {
      missingDependencies.push(dependency);
      recommendations.push(
        `Install required dependency: ${dependency.name}${dependency.version ? ` (${dependency.version})` : ''}`
      );
    }
  }
  
  return {
    compatible: conflicts.length === 0 && missingDependencies.filter(d => d.required).length === 0,
    plugin,
    conflicts,
    missingDependencies,
    recommendations
  };
}

/**
 * Install a plugin into the project
 */
export async function installPlugin(
  pluginName: string,
  projectPath: string,
  version?: string
): Promise<PluginInstallResult> {
  try {
    // First check pnpm version
    const pnpmCheck = await checkPnpmVersion();
    if (!pnpmCheck.installed) {
      return {
        success: false,
        pluginName,
        error: `pnpm is required but not installed. Please install pnpm version ${REQUIRED_PNPM_VERSION}: npm install -g pnpm@${REQUIRED_PNPM_VERSION}`
      };
    }
    if (!pnpmCheck.compatible) {
      return {
        success: false,
        pluginName,
        error: `Incorrect pnpm version. Required: ${REQUIRED_PNPM_VERSION}, Current: ${pnpmCheck.currentVersion}. Please install the correct version: npm install -g pnpm@${REQUIRED_PNPM_VERSION}`
      };
    }
    
    // Format the plugin specification with version if provided
    let pluginSpec = pluginName;
    if (version) {
      pluginSpec = `${pluginName}@${version}`;
    }
    
    console.log(chalk.blue(`Installing package: ${pluginSpec}`));
    console.log(chalk.blue(`Installing in directory: ${projectPath}`));
    
    // Always use pnpm for installation
    const command = `cd "${projectPath}" && pnpm add ${pluginSpec}`;
    
    const spinner = ora('Installing plugin...').start();
    
    try {
      const { stdout } = await execPromise(command);
      spinner.succeed(`Plugin ${pluginName} installed successfully`);
      
      // Check the installed version
      const packageDir = path.join(projectPath, 'node_modules', pluginName);
      let installedVersion = version || 'latest';
      
      try {
        const packageJsonPath = path.join(packageDir, 'package.json');
        if (fs.existsSync(packageJsonPath)) {
          const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
          installedVersion = packageJson.version;
        }
      } catch (error) {
        console.warn(chalk.yellow(`Warning: Could not determine installed version: ${error instanceof Error ? error.message : String(error)}`));
      }
      
      return {
        success: true,
        pluginName,
        version: installedVersion,
        installOutput: stdout
      };
    } catch (error: any) {
      spinner.fail(`Failed to install ${pluginName}`);
      console.error(chalk.red(`Installation error: ${error.message}`));
      if (error.stderr) {
        console.error(chalk.red(error.stderr));
      }
      
      return {
        success: false,
        pluginName,
        error: `Command failed: ${command}\n${error.message}`,
        installOutput: error.stderr
      };
    }
  } catch (error: any) {
    return {
      success: false,
      pluginName,
      error: `Error installing plugin: ${error.message}`
    };
  }
}

/**
 * Analyze package.json to find dependencies that might be Eliza OS plugins
 */
export function analyzePackageJson(packagePath: string): Record<string, string> {
  try {
    if (!fs.existsSync(packagePath)) {
      return {};
    }
    
    const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));
    const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
    
    // Filter for potential Eliza OS plugins (those with @elizaos prefix)
    const pluginDependencies: Record<string, string> = {};
    
    for (const [name, version] of Object.entries(dependencies)) {
      if (name.startsWith('@elizaos/')) {
        pluginDependencies[name] = version as string;
      }
    }
    
    return pluginDependencies;
  } catch (error) {
    console.error(`Error analyzing package.json: ${error}`);
    return {};
  }
}

/**
 * Get list of all installed plugins in the project's node_modules
 * 
 * NOTE: This function discovers ALL plugins installed in node_modules,
 * regardless of whether they've been selected by the user for integration.
 * It's meant for discovery/information purposes only.
 */
export async function getInstalledPlugins(projectPath: string): Promise<PluginInfo[]> {
  const plugins: PluginInfo[] = [];
  const packageJsonPath = path.join(projectPath, 'package.json');
  
  // Extract plugin dependencies from package.json
  const pluginDependencies = analyzePackageJson(packageJsonPath);
  
  // For each potential plugin dependency, try to extract plugin info
  for (const [name, version] of Object.entries(pluginDependencies)) {
    try {
      const pluginDir = path.join(projectPath, 'node_modules', name);
      const pluginPackageJson = path.join(pluginDir, 'package.json');
      
      if (fs.existsSync(pluginPackageJson)) {
        const packageInfo = JSON.parse(fs.readFileSync(pluginPackageJson, 'utf-8'));
        
        // Check if this is actually an Eliza OS plugin by looking for plugin-specific metadata
        if (packageInfo.elizaos || packageInfo.keywords?.includes('elizaos-plugin')) {
          const plugin: PluginInfo = {
            name,
            version: packageInfo.version || version,
            description: packageInfo.description || '',
            dependencies: [],
            installCommand: `npm install ${name}`,
            capabilities: packageInfo.elizaos?.capabilities || []
          };
          
          // Extract plugin dependencies if available
          if (packageInfo.elizaos?.dependencies) {
            for (const [depName, depVersion] of Object.entries(packageInfo.elizaos.dependencies)) {
              plugin.dependencies.push({
                name: depName,
                version: depVersion as string,
                required: true
              });
            }
          }
          
          plugins.push(plugin);
        }
      }
    } catch (error) {
      console.warn(`Error processing potential plugin ${name}: ${error}`);
    }
  }
  
  return plugins;
}

/**
 * Fetches documentation directly from the website
 */
async function fetchPluginDocs(pluginName: string): Promise<string | null> {
  try {
    // Convert the plugin name to the URL segment
    const urlSegment = pluginName.replace('@elizaos/plugin-', '');
    const url = `https://elizaos.github.io/eliza/packages/plugins/${urlSegment}`;
    
    console.log(chalk.blue(`Fetching documentation from URL: ${url}`));
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
    console.error(chalk.red(`Error fetching docs from URL: ${error instanceof Error ? error.message : String(error)}`));
    return null;
  }
}

/**
 * Extracts plugin export information from documentation content
 */
function extractPluginInfo(content: string): { exportName?: string; importType?: 'default' | 'named' } {
  if (!content) return {};
  
  // Look for import statements
  const importRegex = /import\s+\{\s*([A-Za-z0-9_]+)\s*\}\s+from\s+['"]@elizaos\/plugin-[a-z]+['"]/g;
  const defaultImportRegex = /import\s+([A-Za-z0-9_]+)\s+from\s+['"]@elizaos\/plugin-[a-z]+['"]/g;
  
  let match = importRegex.exec(content);
  if (match && match[1]) {
    return { exportName: match[1], importType: 'named' };
  }
  
  match = defaultImportRegex.exec(content);
  if (match && match[1] && !match[1].includes('{')) {
    return { exportName: match[1], importType: 'default' };
  }
  
  // Look for class definitions with "Plugin" in the name
  const classRegex = /class\s+([A-Za-z0-9_]+Plugin)\b/g;
  match = classRegex.exec(content);
  if (match && match[1]) {
    return { exportName: match[1], importType: 'named' }; // Assume named export for classes
  }

  // Look for the plugin name without the prefix in CamelCase
  const pluginPartRegex = /plugin-([a-z]+)/;
  match = pluginPartRegex.exec(content);
  if (match && match[1]) {
    // Convert first character to uppercase and add "Plugin" suffix
    const pluginPart = match[1];
    const camelCaseName = pluginPart.charAt(0).toUpperCase() + pluginPart.slice(1) + 'Plugin';
    if (content.includes(camelCaseName)) {
      return { exportName: camelCaseName, importType: 'named' };
    }
    
    // Also check for lowercase with "Plugin" suffix
    const lowerCaseName = pluginPart.toLowerCase() + 'Plugin';
    if (content.includes(lowerCaseName)) {
      return { exportName: lowerCaseName, importType: 'named' };
    }
  }
  
  return {};
}

/**
 * Try to verify the actual exports from a plugin package
 */
async function verifyPluginExports(projectPath: string, pluginName: string, exportCandidate?: string): Promise<{ exportName?: string; importType?: 'default' | 'named' }> {
  try {
    // Check if the plugin is installed
    const nodeModulesPath = path.join(projectPath, 'node_modules', pluginName);
    if (!fs.existsSync(nodeModulesPath)) {
      // Plugin not installed, can't verify
      return {};
    }
    
    // Try to find dist/index.js or lib/index.js
    const possibleDistPaths = [
      path.join(nodeModulesPath, 'dist', 'index.js'),
      path.join(nodeModulesPath, 'lib', 'index.js'),
      path.join(nodeModulesPath, 'index.js')
    ];
    
    let jsContent = '';
    let foundJsPath = '';
    for (const distPath of possibleDistPaths) {
      if (fs.existsSync(distPath)) {
        jsContent = fs.readFileSync(distPath, 'utf-8');
        foundJsPath = distPath;
        break;
      }
    }
    
    if (!jsContent) {
      return {};
    }
    
    console.log(chalk.gray(`Examining JavaScript in ${foundJsPath} for exports`));
    
    // If we have an export candidate, check for it with different casings
    if (exportCandidate) {
      // Generate additional case variations for better matching
      const variations = [
        exportCandidate, // Exact match
        exportCandidate.charAt(0).toLowerCase() + exportCandidate.slice(1), // First letter lowercase
        exportCandidate.toLowerCase(), // All lowercase
        // Also try removing "Plugin" suffix and using lowercase
        exportCandidate.replace(/Plugin$/, '').toLowerCase() + 'plugin' // lowercase with lowercase "plugin"
      ];
      
      // Log the variations we're checking
      console.log(chalk.gray(`Checking for export variations: ${variations.join(', ')}`));
      
      // Look for direct variable declarations
      for (const variant of variations) {
        // These patterns check for exports and variable declarations
        const patterns = [
          `exports.${variant} =`,
          `"${variant}":`,
          `'${variant}':`,
          `var ${variant} =`,
          `let ${variant} =`,
          `const ${variant} =`,
          `function ${variant}(`,
          `class ${variant}`
        ];
        
        for (const pattern of patterns) {
          if (jsContent.includes(pattern)) {
            console.log(chalk.green(`Found export pattern "${pattern}" in JavaScript`));
            return { exportName: variant, importType: 'named' };
          }
        }
      }
      
      // Wider search: look for the name anywhere in the file
      for (const variant of variations) {
        if (jsContent.includes(variant)) {
          console.log(chalk.yellow(`Found name "${variant}" in JavaScript but not in a clear export pattern`));
          return { exportName: variant, importType: 'named' };
        }
      }
    }
    
    // If we couldn't find the specific export, try to find any plugin-related exports
    console.log(chalk.gray('No specific export found, looking for any plugin exports'));
    
    // Most reliable: get plugin name from the package name
    const pluginNamePart = pluginName.replace('@elizaos/plugin-', '');
    
    // Check common naming patterns for this specific plugin
    const pluginSpecificVariations = [
      // Standard variations
      `${pluginNamePart}Plugin`,
      `${pluginNamePart.charAt(0).toUpperCase() + pluginNamePart.slice(1)}Plugin`,
      // All lowercase version
      `${pluginNamePart.toLowerCase()}plugin`,
      // Just the name without Plugin suffix
      pluginNamePart,
      pluginNamePart.toLowerCase()
    ];
    
    console.log(chalk.gray(`Checking plugin-specific variations: ${pluginSpecificVariations.join(', ')}`));
    
    for (const variant of pluginSpecificVariations) {
      const patterns = [
        `exports.${variant} =`,
        `"${variant}":`,
        `'${variant}':`,
        `var ${variant} =`,
        `let ${variant} =`,
        `const ${variant} =`
      ];
      
      for (const pattern of patterns) {
        if (jsContent.includes(pattern)) {
          console.log(chalk.green(`Found specific plugin export pattern "${pattern}" in JavaScript`));
          return { exportName: variant, importType: 'named' };
        }
      }
      
      // Wider search for the name
      if (jsContent.includes(variant)) {
        console.log(chalk.yellow(`Found plugin name "${variant}" in JavaScript but not in a clear export pattern`));
        return { exportName: variant, importType: 'named' };
      }
    }
    
    // Look for any exports matching *Plugin
    const pluginRegex = /exports\.([a-zA-Z0-9_]+Plugin)\s*=/g;
    const matches = jsContent.match(pluginRegex);
    if (matches && matches.length > 0) {
      const match = matches[0];
      const exportName = match.replace(/exports\./, '').replace(/\s*=.*$/, '');
      console.log(chalk.green(`Found plugin export ${exportName} using regex`));
      return { exportName, importType: 'named' };
    }
    
    return {};
  } catch (error) {
    console.warn(chalk.yellow(`Error verifying plugin exports: ${error instanceof Error ? error.message : String(error)}`));
    return {};
  }
}

/**
 * Finds the correct export name and type from the plugin using documentation
 */
export async function findPluginExportInfo(
  projectPath: string,
  pluginName: string, 
  _registry?: PluginRegistry
): Promise<{ success: boolean; exportName?: string; importType?: 'default' | 'named'; error?: string }> {
  try {
    console.log(chalk.blue(`Finding export info for ${pluginName}...`));
    
    // STEP 1: First try direct website access (most reliable)
    const websiteContent = await fetchPluginDocs(pluginName);
    let documentationExport = undefined;
    
    if (websiteContent) {
      console.log(chalk.green('Successfully fetched documentation from website'));
      
      // Extract plugin information
      const pluginInfo = extractPluginInfo(websiteContent);
      documentationExport = pluginInfo.exportName;
      
      if (pluginInfo.exportName) {
        // IMPORTANT: Before returning, verify the export against the actual package
        const verifiedExport = await verifyPluginExports(projectPath, pluginName, pluginInfo.exportName);
        
        if (verifiedExport.exportName) {
          console.log(chalk.green(`Verified export name: ${verifiedExport.exportName} (${verifiedExport.importType} export)`));
          return {
            success: true,
            exportName: verifiedExport.exportName,
            importType: verifiedExport.importType
          };
        }
        
        console.log(chalk.green(`Found export name from website: ${pluginInfo.exportName} (${pluginInfo.importType} export)`));
        console.log(chalk.yellow('But could not verify it in the installed package. Using documentation value anyway.'));
        return {
          success: true,
          exportName: pluginInfo.exportName,
          importType: pluginInfo.importType
        };
      }
    }
    
    // STEP 2: Try to directly check the package exports
    const directExports = await verifyPluginExports(projectPath, pluginName);
    if (directExports.exportName) {
      console.log(chalk.green(`Found export name directly from package: ${directExports.exportName} (${directExports.importType} export)`));
      return {
        success: true,
        exportName: directExports.exportName,
        importType: directExports.importType
      };
    }
    
    // STEP 3: As a fallback, check for the MCP server if available
    if ((global as any).mcp?.searchDocs) {
      console.log(chalk.yellow('Falling back to MCP server...'));
      
      try {
        // Try to search for plugin documentation
        const searchQuery = pluginName.replace(/^@elizaos\//, ''); // Remove the scope
        console.log(chalk.gray(`Searching for documentation with query: ${searchQuery}`));
        
        const searchResults = await (global as any).mcp.searchDocs({
          query: searchQuery,
          limit: 3
        });
        
        if (searchResults?.results?.length) {
          // Get the actual document content
          const docId = searchResults.results[0].id;
          console.log(chalk.gray(`Retrieving document with ID: ${docId}`));
          
          const doc = await (global as any).mcp.getDocument({ id: docId });
          
          if (doc?.content) {
            console.log(chalk.gray('Successfully retrieved documentation from MCP'));
            
            // Extract plugin information
            const pluginInfo = extractPluginInfo(doc.content);
            
            if (pluginInfo.exportName) {
              // Try to verify the export
              const verifiedExport = await verifyPluginExports(projectPath, pluginName, pluginInfo.exportName);
              
              if (verifiedExport.exportName) {
                console.log(chalk.green(`Verified export name from MCP: ${verifiedExport.exportName} (${verifiedExport.importType} export)`));
                return {
                  success: true,
                  exportName: verifiedExport.exportName,
                  importType: verifiedExport.importType
                };
              }
              
              console.log(chalk.green(`Found export name from MCP: ${pluginInfo.exportName} (${pluginInfo.importType} export)`));
              console.log(chalk.yellow('But could not verify it in the installed package. Using documentation value anyway.'));
              return {
                success: true,
                exportName: pluginInfo.exportName,
                importType: pluginInfo.importType
              };
            }
          }
        }
      } catch (mcpError) {
        console.warn(chalk.yellow(`MCP lookup failed: ${mcpError instanceof Error ? mcpError.message : String(mcpError)}`));
        // Continue to next fallback strategy
      }
    }
    
    // STEP 4: Generate common variations based on plugin name
    const pluginSegment = pluginName.replace('@elizaos/plugin-', '');
    const exportVariations = [
      // CamelCase + Plugin suffix
      pluginSegment.charAt(0).toUpperCase() + pluginSegment.slice(1) + 'Plugin',
      // lowercase + Plugin suffix
      pluginSegment.toLowerCase() + 'Plugin',
      // all lowercase
      pluginSegment.toLowerCase() + 'plugin',
      // just the name (if we found it in documentation but couldn't verify)
      documentationExport
    ].filter(Boolean);
    
    console.log(chalk.yellow(`Could not find export name from documentation. Trying common variations: ${exportVariations.join(', ')}`));
    
    // Return the first variation as our best guess
    return {
      success: true,
      exportName: exportVariations[0],
      importType: 'named'
    };
  } catch (error: any) {
    console.error(chalk.red(`Error finding plugin export info: ${error.message}`));
    return { 
      success: false, 
      error: `Error finding plugin export info: ${error.message}` 
    };
  }
}

/**
 * Directly integrates the plugin into the src/index.ts file
 * This is a more reliable approach than giving the LLM full control
 */
export async function directPluginIntegration(
  projectPath: string,
  plugin: PluginInfo,
  registry?: PluginRegistry
): Promise<{ success: boolean; error?: string }> {
  try {
    console.log(chalk.cyan(`Starting direct integration for ${plugin.name}...`));
    
    // 1. Find the correct export name with proper casing from the plugin
    const exportInfo = await findPluginExportInfo(projectPath, plugin.name, registry);
    if (!exportInfo.success) {
      return { success: false, error: exportInfo.error };
    }
    
    // 2. Update src/index.ts with the import and plugin registration
    const indexTsPath = path.join(projectPath, 'src', 'index.ts');
    if (!fs.existsSync(indexTsPath)) {
      return { success: false, error: 'Cannot find src/index.ts file' };
    }
    
    // Read the file
    const indexTsContent = fs.readFileSync(indexTsPath, 'utf-8');
    
    // Check if plugin is already imported
    if (indexTsContent.includes('import {') && indexTsContent.includes(`} from '${plugin.name}'`)) {
      console.log(chalk.yellow(`Plugin ${plugin.name} is already imported in src/index.ts`));
      return { success: true };
    }
    
    // Make sure we have the required export name
    if (!exportInfo.exportName) {
      return { success: false, error: 'Could not determine export name for plugin' };
    }
    
    // 3. Add import statement
    const updatedContent = addPluginImport(indexTsContent, exportInfo.exportName, plugin.name);
    
    // 4. Add to plugins array in createAgent function
    const finalContent = addPluginToCreateAgent(updatedContent, exportInfo.exportName, exportInfo.importType || 'named');
    
    // 5. Write the updated file back
    fs.writeFileSync(indexTsPath, finalContent, 'utf-8');
    
    console.log(chalk.green(`✓ Successfully integrated ${plugin.name} into src/index.ts`));
    
    return { success: true };
  } catch (error: any) {
    return { success: false, error: `Error integrating plugin: ${error.message}` };
  }
}

/**
 * Adds a plugin import statement to the index.ts file
 */
function addPluginImport(
  fileContent: string,
  exportName: string,
  pluginName: string
): string {
  // Find the last import statement
  const importRegex = /import.*from.*['"]\s*;?\n/g;
  let lastImportMatch: RegExpExecArray | null = null;
  let match: RegExpExecArray | null;
  
  // Find the last import statement position
  while ((match = importRegex.exec(fileContent)) !== null) {
    lastImportMatch = match;
  }
  
  if (!lastImportMatch) {
    // If no imports found, add at the top (unlikely)
    return `import { ${exportName} } from '${pluginName}';\n\n${fileContent}`;
  }
  
  // Split content before and after the last import
  const position = lastImportMatch.index + lastImportMatch[0].length;
  const before = fileContent.substring(0, position);
  const after = fileContent.substring(position);
  
  // Add our import after the last import
  return `${before}import { ${exportName} } from '${pluginName}';\n${after}`;
}

/**
 * Adds the plugin to the createAgent function in the plugins array
 */
function addPluginToCreateAgent(
  fileContent: string,
  exportName: string,
  _importType: 'default' | 'named' = 'named' // Unused parameter prefixed with _
): string {
  // Find the plugins array in the createAgent function
  const pluginsArrayRegex = /plugins\s*:\s*\[([\s\S]*?)\]/;
  const match = pluginsArrayRegex.exec(fileContent);
  
  if (!match) {
    console.warn(chalk.yellow('Could not find plugins array in createAgent function'));
    return fileContent;
  }
  
  // Check if the plugin is already in the array
  const currentPluginsContent = match[1];
  if (currentPluginsContent.includes(exportName)) {
    console.log(chalk.yellow(`Plugin ${exportName} is already in the plugins array`));
    return fileContent;
  }
  
  // Determine if the plugin should be instantiated or not
  // Plugins that end with "Plugin" and use PascalCase should be instantiated
  // Plugins that use camelCase and don't end with "Plugin" should be referenced directly
  
  // Check if exportName follows PascalCase pattern and ends with "Plugin"
  const needsInstantiation = /^[A-Z][a-zA-Z0-9]*Plugin$/.test(exportName);
  
  // Prepare the plugin entry accordingly
  const pluginEntry = needsInstantiation
    ? `\n      new ${exportName}(),`
    : `\n      ${exportName},`;
  
  console.log(chalk.gray(`Adding plugin ${exportName} with ${needsInstantiation ? 'instantiation' : 'direct reference'}`));
  
  // Find the position to insert (before the closing bracket)
  const newPluginsContent = currentPluginsContent + pluginEntry;
  
  // Replace the plugins array content
  return fileContent.replace(pluginsArrayRegex, `plugins: [${newPluginsContent}]`);
}

/**
 * Update the project structure using the direct plugin integration approach
 */
export async function updateProjectStructure(
  projectPath: string,
  installedPlugins: PluginInfo[], // Only user-selected plugins to be integrated
  _llmProvider?: any, // Unused parameter prefixed with _
  _mcpClient?: any // Prefix with _ to indicate this is not used
): Promise<{ success: boolean; updatedFiles: string[]; error?: string }> {
  try {
    // First verify Node.js version
    const nodeVersionCheck = checkNodeVersion();
    if (!nodeVersionCheck.compatible) {
      return {
        success: false,
        updatedFiles: [],
        error: `Incorrect Node.js version. Required: ${nodeVersionCheck.requiredVersion}, Current: ${nodeVersionCheck.currentVersion}. Please use Node.js ${nodeVersionCheck.requiredVersion}.`
      };
    }
    
    // Basic validation
    const srcDir = path.join(projectPath, 'src');
    if (!fs.existsSync(srcDir)) {
      return {
        success: false,
        updatedFiles: [],
        error: 'Project structure is invalid: src directory not found'
      };
    }
    
    const indexTsPath = path.join(projectPath, 'src', 'index.ts');
    if (!fs.existsSync(indexTsPath)) {
      return {
        success: false,
        updatedFiles: [],
        error: 'Project structure is invalid: src/index.ts file not found'
      };
    }
    
    // Create a plugin registry to look up plugin information
    const registry = new PluginRegistry();
    
    // Track updated files
    const updatedFiles: string[] = [];
    let overallSuccess = true;
      
    for (const plugin of installedPlugins) {
      console.log(chalk.cyan(`Integrating plugin ${plugin.name}...`));
      
      // Use direct integration approach with the registry
      const result = await directPluginIntegration(projectPath, plugin, registry);
      
      if (result.success) {
        console.log(chalk.green(`✓ Successfully integrated ${plugin.name}`));
        updatedFiles.push('src/index.ts');
      } else {
        console.error(chalk.red(`× Failed to integrate ${plugin.name}: ${result.error}`));
        overallSuccess = false;
      }
    }
    
    // Run a verification to make sure the project still builds
    try {
      const verificationResult = await runTypeScriptVerification(projectPath);
      
      if (!verificationResult.success) {
        console.warn(chalk.yellow('TypeScript errors after plugin integration:'));
        verificationResult.errors.slice(0, 5).forEach(error => {
          console.warn(chalk.yellow(`  - ${error}`));
        });
        
        console.warn(chalk.yellow('Attempting to fix common issues...'));
        
        // Try to fix the integration by removing duplicates
        const fixedContent = await fixCommonIntegrationIssues(projectPath);
        if (fixedContent) {
          updatedFiles.push('src/index.ts');
          
          // Re-verify
          const reVerificationResult = await runTypeScriptVerification(projectPath);
          if (reVerificationResult.success) {
            console.log(chalk.green('✓ Successfully fixed integration issues'));
          } else {
            console.warn(chalk.yellow('Some TypeScript errors remain after fixes. Manual review may be needed.'));
          }
        }
      } else {
        console.log(chalk.green('✓ TypeScript verification passed after plugin integration'));
      }
    } catch (error) {
      console.warn(chalk.yellow(`Unable to verify TypeScript compilation: ${error}`));
    }
    
    return {
      success: overallSuccess,
      updatedFiles: [...new Set(updatedFiles)]
    };
  } catch (error: any) {
    return {
      success: false,
      updatedFiles: [],
      error: error instanceof Error ? error.message : String(error)
    };
  }
} 

/**
 * Fixes common integration issues like duplicate imports
 */
async function fixCommonIntegrationIssues(projectPath: string): Promise<boolean> {
  const indexTsPath = path.join(projectPath, 'src', 'index.ts');
  if (!fs.existsSync(indexTsPath)) {
    return false;
  }
  
  let content = fs.readFileSync(indexTsPath, 'utf-8');
  let modified = false;
  
  // Fix 1: Remove duplicate imports
  const importRegex = /import\s+{([^}]+)}\s+from\s+['"]([^'"]+)['"]\s*;?/g;
  const imports: Record<string, Set<string>> = {};
  
  // Collect all imports
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    const importNames = match[1].split(',').map(s => s.trim());
    const moduleName = match[2];
    
    if (!imports[moduleName]) {
      imports[moduleName] = new Set();
    }
    
    importNames.forEach(name => imports[moduleName].add(name));
  }
  
  // Replace imports with deduplicated versions
  for (const [moduleName, names] of Object.entries(imports)) {
    if (names.size > 0) {
      const uniqueImports = Array.from(names).join(', ');
      const importRegex = new RegExp(`import\\s+{[^}]+}\\s+from\\s+['"]${moduleName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]\\s*;?`, 'g');
      
      // Count occurrences
      const occurrences = (content.match(importRegex) || []).length;
      
      if (occurrences > 1) {
        // Replace all occurrences with a single import
        content = content.replace(importRegex, '');
        content = `import { ${uniqueImports} } from '${moduleName}';\n${content}`;
        modified = true;
      }
    }
  }
  
  // Fix 2: Deduplicate entries in the plugins array
  const pluginsArrayRegex = /plugins\s*:\s*\[([\s\S]*?)\]\s*\.filter\s*\(\s*Boolean\s*\)/;
  const pluginsMatch = pluginsArrayRegex.exec(content);
  
  if (pluginsMatch) {
    const pluginsContent = pluginsMatch[1];
    const pluginEntries = pluginsContent
      .split(',')
      .map(entry => entry.trim())
      .filter(entry => entry.length > 0);
    
    // Find duplicates
    const uniqueEntries = [...new Set(pluginEntries)];
    
    if (uniqueEntries.length < pluginEntries.length) {
      // There are duplicates, replace with unique entries
      const newPluginsContent = uniqueEntries.join(',\n      ');
      content = content.replace(pluginsArrayRegex, `plugins: [\n      ${newPluginsContent}\n    ].filter(Boolean)`);
      modified = true;
    }
  }
  
  // Save if modified
  if (modified) {
    fs.writeFileSync(indexTsPath, content, 'utf-8');
    return true;
  }
  
  return false;
}

/**
 * Run TypeScript verification for the project
 */
async function runTypeScriptVerification(projectPath: string): Promise<{ success: boolean; errors: string[] }> {
  try {
    const tscPath = path.join(projectPath, 'node_modules', '.bin', 'tsc');
    
    if (!fs.existsSync(tscPath)) {
      return { 
        success: false, 
        errors: ['TypeScript compiler not found in node_modules'] 
      };
    }
    
    const command = `${tscPath} --noEmit`;
    
    const { stderr } = await execPromise(command, { cwd: projectPath });
    
    if (stderr && stderr.length > 0) {
      // Parse errors into a structured format
      const errors = stderr.split('\n').filter((line: string) => line.trim().length > 0);
      
      return {
        success: false,
        errors
      };
    }
    
    return { success: true, errors: [] };
  } catch (error: any) {
    console.warn(chalk.yellow(`Error running TypeScript check: ${error}`));
    return {
      success: false,
      errors: [`Error running TypeScript check: ${error}`]
    };
  }
}
