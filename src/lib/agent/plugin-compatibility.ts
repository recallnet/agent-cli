import * as semver from 'semver';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import ora from 'ora';

const execAsync = promisify(exec);

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
 * Check if a plugin is compatible with already installed plugins
 */
export async function checkPluginCompatibility(
  pluginName: string,
  installedPlugins: PluginInfo[],
  pluginRegistry: Record<string, PluginInfo>
): Promise<PluginCompatibilityResult> {
  // Get plugin info
  const plugin = pluginRegistry[pluginName];
  
  if (!plugin) {
    return {
      compatible: false,
      plugin: {
        name: pluginName,
        version: 'unknown',
        description: 'Unknown plugin',
        dependencies: [],
        installCommand: '',
        capabilities: []
      },
      conflicts: [{
        plugin: 'unknown',
        reason: 'Plugin not found in registry'
      }],
      missingDependencies: [],
      recommendations: ['Check the plugin name and try again']
    };
  }
  
  const conflicts: { plugin: string; reason: string }[] = [];
  const missingDependencies: PluginDependency[] = [];
  const recommendations: string[] = [];
  
  // Check for conflicts with installed plugins
  for (const installedPlugin of installedPlugins) {
    // Check for duplicate functionality
    const overlappingCapabilities = plugin.capabilities.filter(cap => 
      installedPlugin.capabilities.includes(cap)
    );
    
    if (overlappingCapabilities.length > 0) {
      conflicts.push({
        plugin: installedPlugin.name,
        reason: `Overlapping capabilities: ${overlappingCapabilities.join(', ')}`
      });
      
      recommendations.push(
        `Consider removing ${installedPlugin.name} before installing ${pluginName}`
      );
    }
    
    // Check for version conflicts with dependencies
    for (const dep of plugin.dependencies) {
      if (dep.name === installedPlugin.name) {
        if (!semver.satisfies(installedPlugin.version, dep.version)) {
          conflicts.push({
            plugin: installedPlugin.name,
            reason: `Requires version ${dep.version}, but ${installedPlugin.version} is installed`
          });
          
          recommendations.push(
            `Update ${installedPlugin.name} to a compatible version (${dep.version})`
          );
        }
      }
    }
  }
  
  // Check for missing dependencies
  for (const dep of plugin.dependencies) {
    if (dep.required) {
      const installed = installedPlugins.find(p => p.name === dep.name);
      
      if (!installed) {
        missingDependencies.push(dep);
        recommendations.push(
          `Install required dependency: ${dep.name}@${dep.version}`
        );
      }
    }
  }
  
  return {
    compatible: conflicts.length === 0,
    plugin,
    conflicts,
    missingDependencies,
    recommendations
  };
}

/**
 * Install a plugin to a project
 */
export async function installPlugin(
  pluginName: string,
  projectPath: string,
  version?: string
): Promise<PluginInstallResult> {
  const spinner = ora(`Installing plugin ${pluginName}...`).start();
  
  try {
    // Construct install command
    const versionStr = version ? `@${version}` : '';
    const command = `cd "${projectPath}" && pnpm add ${pluginName}${versionStr}`;
    
    // Execute install command
    const { stdout, stderr } = await execAsync(command);
    
    // Check if installation was successful
    if (stderr && stderr.includes('ERR!')) {
      spinner.fail(`Failed to install ${pluginName}`);
      return {
        success: false,
        pluginName,
        error: stderr,
        installOutput: stdout
      };
    }
    
    // Try to determine installed version
    const packageJsonPath = path.join(projectPath, 'package.json');
    let installedVersion: string | undefined;
    
    if (fs.existsSync(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
        const dependencies = {
          ...packageJson.dependencies,
          ...packageJson.devDependencies
        };
        
        installedVersion = dependencies[pluginName];
      } catch (error) {
        // Ignore errors in package.json parsing
      }
    }
    
    spinner.succeed(`Successfully installed ${pluginName}${installedVersion ? ` (${installedVersion})` : ''}`);
    
    return {
      success: true,
      pluginName,
      version: installedVersion,
      installOutput: stdout
    };
  } catch (error) {
    spinner.fail(`Failed to install ${pluginName}`);
    
    return {
      success: false,
      pluginName,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Get installed plugins in a project
 */
export async function getInstalledPlugins(projectPath: string): Promise<PluginInfo[]> {
  const packageJsonPath = path.join(projectPath, 'package.json');
  
  if (!fs.existsSync(packageJsonPath)) {
    return [];
  }
  
  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const dependencies = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies
    };
    
    // Filter for Eliza plugins
    const elizaPlugins = Object.keys(dependencies).filter(dep => 
      dep.startsWith('@elizaos-plugins/') || dep.includes('elizaos')
    );
    
    // Create basic plugin info
    return elizaPlugins.map(name => ({
      name,
      version: dependencies[name],
      description: '',
      dependencies: [],
      installCommand: `pnpm add ${name}@${dependencies[name]}`,
      capabilities: []
    }));
  } catch (error) {
    console.error(`Error reading package.json: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

/**
 * Update project structure for installed plugins
 */
export function updateProjectStructure(
  projectPath: string,
  installedPlugins: PluginInfo[]
): { success: boolean; updatedFiles: string[]; error?: string } {
  const updatedFiles: string[] = [];
  
  try {
    // Check if project has the expected structure
    const srcDir = path.join(projectPath, 'src');
    if (!fs.existsSync(srcDir)) {
      return {
        success: false,
        updatedFiles: [],
        error: 'Project structure is invalid: src directory not found'
      };
    }
    
    // Update environment.ts to include plugin imports
    const environmentPath = path.join(srcDir, 'environment.ts');
    if (fs.existsSync(environmentPath)) {
      let content = fs.readFileSync(environmentPath, 'utf8');
      
      // Add imports
      let importStatements = '';
      let configStatements = '';
      
      for (const plugin of installedPlugins) {
        const pluginName = plugin.name.replace('@elizaos-plugins/', '');
        const variableName = `${pluginName}Config`;
        
        importStatements += `import { config as ${variableName} } from '${plugin.name}';\n`;
        configStatements += `  // Initialize ${pluginName} plugin\n`;
        configStatements += `  ${variableName},\n`;
      }
      
      // Update the file content
      if (importStatements) {
        const importSection = content.includes('import {') 
          ? content.replace(/import {/, `${importStatements}import {`) 
          : `${importStatements}\n${content}`;
        
        if (configStatements && content.includes('export const config = {')) {
          content = importSection.replace(/export const config = {/, `export const config = {\n${configStatements}`);
        } else {
          content = importSection;
        }
        
        fs.writeFileSync(environmentPath, content);
        updatedFiles.push(environmentPath);
      }
    }
    
    // Update index.ts to register plugins
    const indexPath = path.join(srcDir, 'index.ts');
    if (fs.existsSync(indexPath)) {
      let content = fs.readFileSync(indexPath, 'utf8');
      
      // Add imports and plugin registration
      let importStatements = '';
      let registerStatements = '';
      
      for (const plugin of installedPlugins) {
        const pluginName = plugin.name.replace('@elizaos-plugins/', '');
        const variableName = `${pluginName}Plugin`;
        
        importStatements += `import { plugin as ${variableName} } from '${plugin.name}';\n`;
        registerStatements += `  // Register ${pluginName} plugin\n`;
        registerStatements += `  agent.registerPlugin(${variableName});\n`;
      }
      
      // Update the file content
      if (importStatements) {
        const importSection = content.includes('import {') 
          ? content.replace(/import {/, `${importStatements}import {`) 
          : `${importStatements}\n${content}`;
        
        if (registerStatements && content.includes('async function main()')) {
          content = importSection.replace(
            /async function main\(\)[^{]*{/,
            `async function main() {\n${registerStatements}`
          );
        } else {
          content = importSection;
        }
        
        fs.writeFileSync(indexPath, content);
        updatedFiles.push(indexPath);
      }
    }
    
    return {
      success: true,
      updatedFiles
    };
  } catch (error) {
    return {
      success: false,
      updatedFiles,
      error: error instanceof Error ? error.message : String(error)
    };
  }
} 