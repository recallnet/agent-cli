import * as fs from 'fs';
import axios from 'axios';
import chalk from 'chalk';
import { execSync } from 'child_process';
import { getPluginsJsonPath } from '../utils/config-paths.js';

/**
 * Plugin information interface
 */
export interface PluginInfo {
  name: string;
  description: string;
  version: string;
  author: string;
  license: string;
  repository: string;
  dependencies: Record<string, string>;
  requiredEnv: string[];
  documentation: string;
  importStatement: string;
}

/**
 * Plugin registry for managing Eliza plugins
 */
export class PluginRegistry {
  private registryUrl: string;
  private pluginsJsonPath: string;
  private plugins: Record<string, PluginInfo> = {};
  
  constructor(registryUrl?: string) {
    // Using the same registry URL as the MCP server
    this.registryUrl = registryUrl || 
                      process.env.ELIZA_PLUGIN_REGISTRY_URL || 
                      process.env.PLUGIN_REGISTRY_URL ||
                      'https://raw.githubusercontent.com/elizaos/registry/main/index.json';
    
    // Use the platform-specific path for plugins.json, not in the current directory
    this.pluginsJsonPath = getPluginsJsonPath();
    
    // Load plugins from plugins.json if it exists
    if (fs.existsSync(this.pluginsJsonPath)) {
      try {
        this.plugins = JSON.parse(fs.readFileSync(this.pluginsJsonPath, 'utf8'));
      } catch (error) {
        console.error(`Failed to parse plugins.json: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  
  /**
   * Fetch plugins from the registry
   */
  async fetchPlugins(): Promise<Record<string, PluginInfo>> {
    console.log(`🌐 REGISTRY: Fetching plugins from ${this.registryUrl}`);
    try {
      // Try to fetch from registry URL
      const response = await axios.get(this.registryUrl);
      console.log(`🌐 REGISTRY: Received response (${response.status}) with ${Object.keys(response.data).length} plugins`);
      
      // Process the response
      const rawPluginEntries: Record<string, string> = response.data;
      
      // Process registry data
      this.plugins = {};
      
      // Transform the raw entries to our plugin format
      for (const [rawName, repoLink] of Object.entries(rawPluginEntries)) {
        try {
          // Convert the name from @elizaos-plugins/* to @elizaos/*
          const normalizedName = rawName.replace('@elizaos-plugins/', '@elizaos/');
          console.log(`🔍 REGISTRY: Processing plugin ${rawName} → ${normalizedName}`);
          
          // Create minimal plugin info
          const plugin = await this.fetchPluginDetails(normalizedName, {
            name: normalizedName,
            repository: typeof repoLink === 'string' && repoLink.startsWith('github:') 
              ? `https://github.com/${repoLink.replace('github:', '')}`
              : `https://github.com/elizaos/${normalizedName.split('/')[1]}`
          });
          
          // Store the plugin under both the original and normalized names
          this.plugins[rawName] = { ...plugin, name: rawName };
          this.plugins[normalizedName] = plugin;
          
          // Also store variant names
          const baseName = normalizedName.split('/')[1];
          if (baseName.startsWith('adapter-')) {
            this.plugins[baseName] = { ...plugin, name: baseName };
            this.plugins[baseName.replace('adapter-', '')] = { ...plugin, name: baseName.replace('adapter-', '') };
          } else if (baseName.startsWith('client-')) {
            this.plugins[baseName] = { ...plugin, name: baseName };
            this.plugins[baseName.replace('client-', '')] = { ...plugin, name: baseName.replace('client-', '') };
          } else if (baseName.startsWith('plugin-')) {
            this.plugins[baseName] = { ...plugin, name: baseName };
            this.plugins[baseName.replace('plugin-', '')] = { ...plugin, name: baseName.replace('plugin-', '') };
          }
        } catch (error) {
          console.warn(`Failed to process plugin ${rawName}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      
      console.log(`🔍 REGISTRY: Processed ${Object.keys(this.plugins).length} unique plugin names`);
      
      // Save to local file for caching
      try {
        fs.writeFileSync(this.pluginsJsonPath, JSON.stringify(this.plugins, null, 2));
      } catch (saveError) {
        console.warn(`Failed to save plugins cache: ${saveError instanceof Error ? saveError.message : String(saveError)}`);
      }
      
      return this.plugins;
    } catch (error) {
      console.error(`Error fetching plugins: ${error instanceof Error ? error.message : String(error)}`);
      
      // Try to use the cached version if available
      if (fs.existsSync(this.pluginsJsonPath)) {
        try {
          console.log('Loading plugins from local cache');
          const cache = JSON.parse(fs.readFileSync(this.pluginsJsonPath, 'utf8'));
          this.plugins = cache;
          return cache;
        } catch (cacheError) {
          console.error(`Failed to load cached plugins: ${cacheError instanceof Error ? cacheError.message : String(cacheError)}`);
        }
      }
      
      // Return empty registry if all else fails
      return {};
    }
  }
  
  /**
   * Fetch detailed information about a plugin from its repository
   */
  private async fetchPluginDetails(name: string, info: any): Promise<PluginInfo> {
    console.log(`🔍 REGISTRY: Processing plugin details for ${name}`);
    
    // For normalized name extraction (remove scope)
    const normalizedName = name.startsWith('@') ? name.split('/')[1] : name;
    
    // Handle different plugin types
    let packageType = 'plugin';
    let baseName = normalizedName;
    
    if (normalizedName.startsWith('adapter-')) {
      packageType = 'adapter';
      baseName = normalizedName.replace(/^adapter-/, '');
    } else if (normalizedName.startsWith('client-')) {
      packageType = 'client';
      baseName = normalizedName.replace(/^client-/, '');
    } else if (normalizedName.startsWith('plugin-')) {
      baseName = normalizedName.replace(/^plugin-/, '');
    }
    
    // Generate default repository and documentation URLs based on the package type
    const defaultRepo = `https://github.com/elizaos/${normalizedName}`;
    let defaultDocs = 'https://elizaos.github.io/eliza/packages/';
    
    if (packageType === 'adapter') {
      defaultDocs += `adapters/${baseName}/`;
    } else if (packageType === 'client') {
      defaultDocs += `clients/${baseName}/`;
    } else {
      // For plugins
      defaultDocs += `${normalizedName}/`;
    }
    
    // Default import statement based on package type
    const capitalizedBaseName = this.capitalizeFirstLetter(baseName.replace(/-./g, x => x[1].toUpperCase()));
    const defaultImport = `import { ${capitalizedBaseName} } from '@elizaos/${normalizedName}';`;
    
    return {
      name: name,
      description: info.description || `${this.capitalizeFirstLetter(packageType)} for ${baseName}`,
      version: info.version || '0.1.0',
      author: info.author || 'Eliza',
      license: info.license || 'MIT',
      repository: info.repository || defaultRepo,
      dependencies: info.dependencies || {},
      requiredEnv: info.requiredEnv || [],
      documentation: info.documentation || defaultDocs,
      importStatement: info.importStatement || defaultImport
    };
  }
  
  /**
   * Check if a plugin info object has all required fields
   */
  private isCompletePluginInfo(info: any): boolean {
    const requiredFields = [
      'name', 'description', 'version', 'author', 'license',
      'repository', 'dependencies', 'requiredEnv', 'documentation', 'importStatement'
    ];
    
    return requiredFields.every(field => field in info);
  }
  
  /**
   * Convert GitHub URL to raw content URL
   */
  private convertGithubUrlToRaw(url: string): string {
    // Check if it's a GitHub URL
    if (url.includes('github.com') && url.includes('/blob/')) {
      // Convert to raw.githubusercontent.com
      return url.replace('github.com', 'raw.githubusercontent.com').replace('/blob/', '/');
    }
    return url;
  }
  
  /**
   * Capitalize the first letter of a string
   */
  private capitalizeFirstLetter(string: string): string {
    return string.charAt(0).toUpperCase() + string.slice(1);
  }
  
  /**
   * Get all plugins
   */
  async getPlugins(): Promise<Record<string, PluginInfo>> {
    if (Object.keys(this.plugins).length === 0) {
      await this.fetchPlugins();
    }
    
    return this.plugins;
  }
  
  /**
   * Get detailed information about a specific plugin
   * @param name The name of the plugin
   * @returns The plugin information, or null if not found
   */
  async getPlugin(name: string): Promise<PluginInfo | null> {
    // First check if we already have this plugin in our cache
    if (this.plugins[name]) {
      console.log(`✅ REGISTRY: Found exact match for ${name} in cache`);
      return this.plugins[name];
    }
    
    // If cache is not empty, check for normalized versions too
    if (Object.keys(this.plugins).length > 0) {
      // Try normalized names if the exact name isn't available
      const possibleFormats = this.getNormalizedPluginNames(name);
      console.log(`🔍 REGISTRY: Checking cache for plugin ${name} in possible formats:`, possibleFormats);
      
      // Try each possible format
      for (const format of possibleFormats) {
        if (this.plugins[format]) {
          console.log(`✅ REGISTRY: Found plugin ${name} as ${format} in cache`);
          return this.plugins[format];
        }
      }
    }
    
    // If we're here, we didn't find it in the cache
    // Instead of loading all plugins, just try to fetch this single plugin
    try {
      console.log(`🔍 REGISTRY: Fetching specific plugin: ${name}`);
      
      // Get the possible formats/names
      const possibleFormats = this.getNormalizedPluginNames(name);
      console.log(`🔍 REGISTRY: Possible formats: ${possibleFormats.join(', ')}`);
      
      // Create minimal plugin info for just this plugin
      const normalizedName = possibleFormats[0]; // Use the first format
      const plugin = await this.fetchPluginDetails(normalizedName, {
        name: normalizedName,
        repository: `https://github.com/elizaos/${normalizedName.split('/')[1]}`
      });
      
      // Cache this plugin for future use
      if (plugin) {
        this.plugins[normalizedName] = plugin;
        console.log(`✅ REGISTRY: Successfully fetched plugin ${name}`);
        return plugin;
      }
      
      // If we couldn't get details for the plugin, generate fallback info
      console.log(`🔄 REGISTRY: Generating fallback info for ${name}`);
      const fallbackPlugin: PluginInfo = {
        name: normalizedName,
        description: `${normalizedName} plugin`,
        version: 'latest',
        repository: `https://github.com/elizaos/${normalizedName.split('/')[1]}`,
        author: 'Eliza',
        license: 'MIT',
        dependencies: {},
        requiredEnv: [],
        documentation: `https://elizaos.github.io/eliza/packages/plugins/${normalizedName.split('/')[1]}/`,
        importStatement: `import { ${this.capitalizeFirstLetter(normalizedName.split('/')[1].replace(/-./g, x => x[1].toUpperCase()))} } from '${normalizedName}';`
      };
      
      this.plugins[normalizedName] = fallbackPlugin;
      return fallbackPlugin;
    } catch (error) {
      console.log(`❌ REGISTRY: Error fetching specific plugin ${name}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }
  
  /**
   * Get all possible normalized forms of a plugin name
   */
  private getNormalizedPluginNames(name: string): string[] {
    // Handle both formats
    const possibleNames = [name]; // Original name
    
    // Convert between @elizaos/ and @elizaos-plugins/ formats
    if (name.startsWith('@elizaos/')) {
      const originalName = name;
      const pluginsName = name.replace('@elizaos/', '@elizaos-plugins/');
      possibleNames.push(pluginsName);
      console.log(`🔍 REGISTRY: Converting name ${originalName} → ${pluginsName}`);
    } else if (name.startsWith('@elizaos-plugins/')) {
      const originalName = name;
      const elizaosName = name.replace('@elizaos-plugins/', '@elizaos/');
      possibleNames.push(elizaosName);
      console.log(`🔍 REGISTRY: Converting name ${originalName} → ${elizaosName}`);
    }
    
    // Remove @ prefix and package path if present
    const baseName = name.startsWith('@') 
      ? name.split('/')[1] 
      : name;
    
    // Add base name without scope
    possibleNames.push(baseName);
    
    // Handle different types
    if (baseName.startsWith('adapter-')) {
      const adapterBaseName = baseName.replace('adapter-', '');
      // Add adapter variations
      possibleNames.push(adapterBaseName);
      possibleNames.push(`@elizaos/adapter-${adapterBaseName}`);
      possibleNames.push(`@elizaos-plugins/adapter-${adapterBaseName}`);
      possibleNames.push(`adapter-${adapterBaseName}`);
    } else if (baseName.startsWith('client-')) {
      const clientBaseName = baseName.replace('client-', '');
      // Add client variations
      possibleNames.push(clientBaseName);
      possibleNames.push(`@elizaos/client-${clientBaseName}`);
      possibleNames.push(`@elizaos-plugins/client-${clientBaseName}`);
      possibleNames.push(`client-${clientBaseName}`);
    } else if (baseName.startsWith('plugin-')) {
      const pluginBaseName = baseName.replace('plugin-', '');
      // Add plugin variations
      possibleNames.push(pluginBaseName);
      possibleNames.push(`@elizaos/plugin-${pluginBaseName}`);
      possibleNames.push(`@elizaos-plugins/plugin-${pluginBaseName}`);
      possibleNames.push(`plugin-${pluginBaseName}`);
    } else {
      // If no clear type, try all
      possibleNames.push(`@elizaos/${baseName}`);
      possibleNames.push(`@elizaos-plugins/${baseName}`);
      possibleNames.push(`@elizaos/plugin-${baseName}`);
      possibleNames.push(`@elizaos-plugins/plugin-${baseName}`);
    }
    
    // Return unique names
    return [...new Set(possibleNames)];
  }
  
  /**
   * Install a plugin and its dependencies
   */
  public async installPlugin(
    name: string, 
    version?: string, 
    projectPath?: string
  ): Promise<boolean> {
    try {
      const plugin = await this.getPlugin(name);
      
      if (!plugin) {
        throw new Error(`Plugin ${name} not found in the registry`);
      }
      
      // Resolve dependencies
      const dependencies = await this.resolveDependencies(plugin);
      
      // Install each dependency first
      for (const dependency of dependencies) {
        if (dependency !== name) {
          console.log(chalk.yellow(`Installing dependency: ${dependency}`));
          await this.installSinglePlugin(dependency, undefined, projectPath);
        }
      }
      
      // Finally, install the requested plugin
      return await this.installSinglePlugin(name, version, projectPath);
    } catch (error) {
      throw new Error(`Failed to install plugin: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Install a single plugin without resolving dependencies
   */
  private async installSinglePlugin(
    name: string, 
    version?: string, 
    projectPath?: string
  ): Promise<boolean> {
    // Build the installation command
    const versionFlag = version ? `@${version}` : '';
    
    // Handle both formats with or without the "plugin-" prefix
    // If the name already starts with "plugin-", don't add it again
    const baseName = name.startsWith('plugin-') ? name : `plugin-${name}`;
    
    // Use the correct namespace (based on actual package names)
    const packageName = `@elizaos/${baseName}${versionFlag}`;
    
    console.log(chalk.gray(`Installing package: ${packageName}`));
    
    try {
      // Determine the directory to run the command in
      const installDir = projectPath || process.cwd();
      console.log(chalk.gray(`Installing in directory: ${installDir}`));
      
      // Check for the required pnpm version (9.15.4)
      try {
        const pnpmVersionOutput = execSync('pnpm --version', { encoding: 'utf8' }).trim();
        
        // Compare with required version
        if (pnpmVersionOutput !== '9.15.4') {
          console.error(chalk.red(`Error: Incorrect pnpm version detected. Required: 9.15.4, Current: ${pnpmVersionOutput}`));
          console.error(chalk.yellow('Please install the correct version: npm install -g pnpm@9.15.4'));
          return false;
        }
        
        // Also check Node.js version
        const nodeVersionOutput = execSync('node --version', { encoding: 'utf8' }).trim();
        // Remove 'v' prefix for comparison
        const nodeVersionWithoutV = nodeVersionOutput.startsWith('v') ? nodeVersionOutput.substring(1) : nodeVersionOutput;
        
        if (nodeVersionWithoutV !== '22.11.0') {
          console.error(chalk.red(`Error: Incorrect Node.js version detected. Required: v22.11.0, Current: ${nodeVersionOutput}`));
          console.error(chalk.yellow('Please use the correct Node.js version, for example with nvm:'));
          console.error(chalk.yellow('  nvm install 22.11.0'));
          console.error(chalk.yellow('  nvm use 22.11.0'));
          return false;
        }
        
        // Install using pnpm with the correct directory
        console.log(chalk.blue(`Using pnpm ${pnpmVersionOutput} to install ${packageName}`));
        execSync(`cd "${installDir}" && pnpm add ${packageName}`, { stdio: 'inherit' });
      } catch (error) {
        if (error instanceof Error && error.message.includes('pnpm --version')) {
          console.error(chalk.red('Error: pnpm is not installed or not available in PATH'));
          console.error(chalk.yellow('Please install pnpm version 9.15.4: npm install -g pnpm@9.15.4'));
          return false;
        }
        throw error; // Re-throw for other errors
      }
      
      return true;
    } catch (error) {
      console.error(`Failed to install ${name}: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }
  
  /**
   * Resolve dependencies for a plugin
   * @returns Array of plugin names in order they should be installed
   */
  private async resolveDependencies(plugin: PluginInfo): Promise<string[]> {
    const visited = new Set<string>();
    const result: string[] = [];
    
    // Depth-first traversal of dependencies
    const visit = async (pluginName: string) => {
      if (visited.has(pluginName)) return;
      visited.add(pluginName);
      
      const pluginInfo = await this.getPlugin(pluginName);
      if (!pluginInfo) return;
      
      // Check for Eliza plugin dependencies
      // Support both @elizaos-plugins/ and @elizaos/ namespaces
      const elizaDeps = Object.keys(pluginInfo.dependencies)
        .filter(dep => 
          dep.startsWith('@elizaos/plugin-') || 
          dep.startsWith('@elizaos-plugins/plugin-')
        )
        .map(dep => {
          if (dep.startsWith('@elizaos/plugin-')) {
            return dep.replace('@elizaos/plugin-', '');
          }
          return dep.replace('@elizaos-plugins/plugin-', '');
        });
      
      // Visit all dependencies first
      for (const dep of elizaDeps) {
        await visit(dep);
      }
      
      // Add this plugin after its dependencies
      result.push(pluginName);
    };
    
    await visit(plugin.name);
    return result;
  }
} 