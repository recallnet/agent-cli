import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import chalk from 'chalk';
import ora from 'ora';
import { LlmProvider, PluginRecommendation } from '../llm/provider.js';
import { PluginRegistry } from '../plugins/registry.js';
import { EnvVariable } from './environment-analyzer.js';

const execAsync = promisify(exec);

/**
 * Plugin integration result
 */
export interface PluginIntegrationResult {
  success: boolean;
  installedPlugins: string[];
  failedPlugins: string[];
  message?: string;
  errors: Record<string, string>;
  requiredEnv: Record<string, EnvVariable[]>;
}

/**
 * Plugin dependency
 */
export interface PluginDependency {
  name: string;
  version: string;
  optional: boolean;
}

/**
 * Plugin installation options
 */
export interface PluginInstallOptions {
  projectPath: string;
  plugins: string[];
  spinner?: ReturnType<typeof ora>;
  skipDependencyCheck?: boolean;
  forceReinstall?: boolean;
  packageManager?: 'pnpm' | 'npm' | 'yarn';
}

/**
 * Install and integrate plugins into a project
 */
export async function integratePlugins(
  options: PluginInstallOptions,
  llmProvider?: LlmProvider
): Promise<PluginIntegrationResult> {
  const result: PluginIntegrationResult = {
    success: true,
    installedPlugins: [],
    failedPlugins: [],
    errors: {},
    requiredEnv: {}
  };

  const spinner = options.spinner || ora('Integrating plugins');
  const packageManager = options.packageManager || 'pnpm';
  const pluginRegistry = new PluginRegistry();
  
  try {
    // Fetch plugin metadata for all plugins
    spinner.text = 'Fetching plugin metadata';
    if (typeof pluginRegistry.getPlugins === 'function') {
      await pluginRegistry.getPlugins();
    }
    
    // Resolve plugin dependencies and create an installation plan
    spinner.text = 'Analyzing plugin dependencies';
    const installationPlan = await createInstallationPlan(
      options.plugins, 
      pluginRegistry,
      options.skipDependencyCheck || false
    );
    
    if (installationPlan.plugins.length === 0) {
      spinner.info('No plugins to install');
      return {
        ...result,
        message: 'No plugins were selected for installation'
      };
    }
    
    // Install each plugin
    for (const plugin of installationPlan.plugins) {
      try {
        spinner.text = `Installing plugin: ${chalk.cyan(plugin.name)}`;
        
        // Check if plugin package exists
        const pluginPackage = `@elizaos/plugin-${plugin.name}`;
        
        // Install the plugin
        const installCmd = `${packageManager} add ${pluginPackage}@${plugin.version || 'latest'}`;
        await execAsync(installCmd, { cwd: options.projectPath });
        
        // Collect required environment variables
        if (plugin.requiredEnv && plugin.requiredEnv.length > 0) {
          result.requiredEnv[plugin.name] = plugin.requiredEnv.map((envVarName: string) => ({
            name: envVarName,
            description: `Required for plugin: ${plugin.name}`,
            required: true,
            secret: envVarName.includes('KEY') || envVarName.includes('SECRET') || envVarName.includes('PASSWORD'),
          }));
        }
        
        // Create plugin configuration if needed
        await createPluginConfig(options.projectPath, plugin.name, plugin, llmProvider);
        
        // Update project imports to include the plugin
        await updateProjectImports(options.projectPath, plugin.name, pluginPackage, plugin);
        
        result.installedPlugins.push(plugin.name);
        spinner.succeed(`Installed plugin: ${chalk.green(plugin.name)}`);
      } catch (error) {
        result.success = false;
        result.failedPlugins.push(plugin.name);
        result.errors[plugin.name] = error instanceof Error ? error.message : String(error);
        spinner.fail(`Failed to install plugin: ${chalk.red(plugin.name)}`);
        console.error(chalk.red(`  Error: ${result.errors[plugin.name]}`));
      }
    }
    
    // Update project configuration to include all plugins
    if (result.installedPlugins.length > 0) {
      spinner.text = 'Updating project configuration';
      await updateProjectConfiguration(options.projectPath, result.installedPlugins);
      spinner.succeed('Updated project configuration');
    }
    
    return result;
  } catch (error) {
    result.success = false;
    result.message = error instanceof Error ? error.message : String(error);
    spinner.fail(`Plugin integration failed: ${chalk.red(result.message)}`);
    return result;
  }
}

/**
 * Create an installation plan for the plugins
 */
async function createInstallationPlan(
  pluginNames: string[],
  registry: PluginRegistry,
  skipDependencyCheck: boolean
): Promise<{ plugins: any[] }> {
  const plugins: any[] = [];
  const processed = new Set<string>();
  
  // Process each plugin
  for (const name of pluginNames) {
    if (processed.has(name)) continue;
    processed.add(name);
    
    const plugin = await registry.getPlugin(name);
    if (!plugin) {
      console.warn(chalk.yellow(`Warning: Plugin "${name}" not found in registry`));
      continue;
    }
    
    plugins.push(plugin);
    
    // Add dependencies if dependency check is enabled
    if (!skipDependencyCheck && plugin.dependencies) {
      for (const depName of Object.keys(plugin.dependencies)) {
        // Only add @elizaos dependencies
        if (depName.startsWith('@elizaos/')) {
          const pluginName = depName.replace('@elizaos/plugin-', '');
          if (!processed.has(pluginName)) {
            processed.add(pluginName);
            
            const depPlugin = await registry.getPlugin(pluginName);
            if (depPlugin) {
              plugins.push(depPlugin);
            }
          }
        }
      }
    }
  }
  
  return { plugins };
}

/**
 * Create configuration for a plugin if needed
 */
async function createPluginConfig(
  projectPath: string,
  pluginName: string,
  pluginData: any,
  llmProvider?: LlmProvider
): Promise<void> {
  // Check if plugin requires configuration
  if (!pluginData.requiresConfig) {
    return;
  }
  
  const configDir = path.join(projectPath, 'config');
  
  // Create config directory if it doesn't exist
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  
  // Create plugin config file
  const configFile = path.join(configDir, `${pluginName}.config.ts`);
  
  // If LLM provider is available, use it to generate a more intelligent config
  let configContent = '';
  
  if (llmProvider) {
    try {
      const response = await llmProvider.prompt(
        `Generate a TypeScript configuration file for a plugin named "${pluginName}".
        Here's information about the plugin:
        ${JSON.stringify(pluginData, null, 2)}
        
        The configuration should be a TypeScript file that exports a default configuration object.
        Include reasonable defaults and comments explaining each option.
        Don't include any imports that don't exist.`,
        { temperature: 0.3 }
      );
      
      configContent = response.content;
    } catch (error) {
      console.warn(chalk.yellow(`Could not generate config using LLM: ${error instanceof Error ? error.message : String(error)}`));
      // Fall back to generic config
      configContent = generateGenericConfig(pluginName, pluginData);
    }
  } else {
    // No LLM provider, use generic config
    configContent = generateGenericConfig(pluginName, pluginData);
  }
  
  // Write config file
  fs.writeFileSync(configFile, configContent, { encoding: 'utf8' });
}

/**
 * Generate a generic configuration file for a plugin
 */
function generateGenericConfig(pluginName: string, _pluginData: any): string {
  return `/**
 * Configuration for ${pluginName} plugin
 */
export default {
  // Add plugin-specific configuration here
  enabled: true,
  
  // Plugin options
  options: {
    // Add plugin options here
  }
};
`;
}

/**
 * Update project imports to include the plugin
 */
async function updateProjectImports(
  projectPath: string,
  pluginName: string,
  packageName: string,
  pluginData: any
): Promise<void> {
  const indexPath = path.join(projectPath, 'src', 'index.ts');
  
  // Check if index.ts exists
  if (!fs.existsSync(indexPath)) {
    return;
  }
  
  // Read index.ts
  let content = fs.readFileSync(indexPath, 'utf8');
  
  // Check if plugin is already imported
  if (content.includes(packageName)) {
    return;
  }
  
  // Find import section
  const importSection = content.match(/import.+from.+;\n/g);
  if (importSection) {
    // Add import after the last import
    const lastImport = importSection[importSection.length - 1];
    const importStatement = `import ${pluginData?.importStatement || `{ ${generateImportNameFromPlugin(pluginName)} }`} from '${packageName}';\n`;
    
    content = content.replace(
      lastImport,
      `${lastImport}${importStatement}`
    );
    
    // Write updated content
    fs.writeFileSync(indexPath, content, { encoding: 'utf8' });
  }
}

/**
 * Update project configuration to include all plugins
 */
async function updateProjectConfiguration(
  projectPath: string,
  installedPlugins: string[]
): Promise<void> {
  const envPath = path.join(projectPath, 'src', 'environment.ts');
  
  // Check if environment.ts exists
  if (!fs.existsSync(envPath)) {
    return;
  }
  
  // Read environment.ts
  let content = fs.readFileSync(envPath, 'utf8');
  
  // Update plugins list if it exists
  const pluginsRegex = /plugins\s*:\s*\[([\s\S]*?)\]/;
  const match = content.match(pluginsRegex);
  
  if (match) {
    // Extract existing plugins
    const existingPlugins = match[1]
      .split(',')
      .map(p => p.trim())
      .filter(p => p && !p.includes('//'));
    
    // Add new plugins
    const newPlugins = installedPlugins
      .filter(p => !existingPlugins.some(ep => ep.includes(p)))
      .map(p => `    '${p}'`);
    
    if (newPlugins.length > 0) {
      // Replace plugins array
      const updatedPluginsList = [...existingPlugins, ...newPlugins].join(',\n');
      content = content.replace(
        pluginsRegex,
        `plugins: [\n${updatedPluginsList}\n  ]`
      );
      
      // Write updated content
      fs.writeFileSync(envPath, content, { encoding: 'utf8' });
    }
  }
}

/**
 * Get LLM recommendations for plugins based on a strategy
 */
export async function recommendPluginsForStrategy(
  strategy: string,
  llmProvider: LlmProvider
): Promise<PluginRecommendation[]> {
  // No fallback - let errors propagate
  return await llmProvider.recommendPluginsForStrategy(strategy);
}

/**
 * Generate an import name from a plugin name, converting kebab-case to PascalCase
 */
function generateImportNameFromPlugin(pluginName: string): string {
  return pluginName
    .split('-')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
} 