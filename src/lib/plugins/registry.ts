import axios from 'axios';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

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
    this.registryUrl = registryUrl || process.env.ELIZA_PLUGIN_REGISTRY_URL || 'https://github.com/elizaos-plugins/registry/blob/main/index.json';
    this.pluginsJsonPath = path.join(process.cwd(), 'plugins.json');
    
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
    try {
      // Get the raw registry URL for API access
      const apiUrl = this.convertGithubUrlToRaw(this.registryUrl);
      
      // Fetch the registry index
      const response = await axios.get(apiUrl);
      const registryData = response.data;
      
      if (typeof registryData !== 'object' || !registryData.plugins) {
        throw new Error('Invalid registry data format');
      }
      
      // Process registry data
      this.plugins = {};
      
      // For each plugin in the registry
      for (const [name, info] of Object.entries(registryData.plugins)) {
        if (typeof info !== 'object') continue;
        
        // Fetch detailed plugin information from its repository
        try {
          const pluginInfo = await this.fetchPluginDetails(name, info as any);
          this.plugins[name] = pluginInfo;
        } catch (error) {
          console.warn(`Failed to fetch details for plugin ${name}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      
      // Save to plugins.json
      fs.writeFileSync(this.pluginsJsonPath, JSON.stringify(this.plugins, null, 2));
      
      return this.plugins;
    } catch (error) {
      // If we fail to fetch from the registry, use mock data for now
      if (Object.keys(this.plugins).length === 0) {
        console.warn(`Failed to fetch from registry: ${error instanceof Error ? error.message : String(error)}. Using mock data.`);
        return this.getMockPlugins();
      }
      throw new Error(`Failed to fetch plugins: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Fetch detailed information about a plugin from its repository
   */
  private async fetchPluginDetails(name: string, info: any): Promise<PluginInfo> {
    // If info already has all the fields we need, just return it
    if (this.isCompletePluginInfo(info)) {
      return info as PluginInfo;
    }
    
    // Otherwise, try to fetch more details from the plugin's repository
    try {
      const repoUrl = info.repository || `https://github.com/elizaos-plugins/plugin-${name}`;
      const pkgJsonUrl = this.convertGithubUrlToRaw(repoUrl + '/blob/main/package.json');
      
      const response = await axios.get(pkgJsonUrl);
      const pkgData = response.data;
      
      // Extract plugin information from package.json
      return {
        name: name,
        description: pkgData.description || info.description || '',
        version: pkgData.version || info.version || '0.1.0',
        author: pkgData.author || info.author || '',
        license: pkgData.license || info.license || '',
        repository: repoUrl,
        dependencies: pkgData.dependencies || info.dependencies || {},
        requiredEnv: pkgData.requiredEnv || info.requiredEnv || [],
        documentation: pkgData.documentation || info.documentation || repoUrl + '#readme',
        importStatement: info.importStatement || `import { ${this.capitalizeFirstLetter(name.replace(/-./g, x => x[1].toUpperCase()))} } from '@elizaos-plugins/plugin-${name}';`
      };
    } catch (error) {
      console.warn(`Failed to fetch package.json for ${name}: ${error instanceof Error ? error.message : String(error)}`);
      
      // Return with minimal information
      return {
        name: name,
        description: info.description || 'No description available',
        version: info.version || '0.1.0',
        author: info.author || 'Unknown',
        license: info.license || 'MIT',
        repository: info.repository || `https://github.com/elizaos-plugins/plugin-${name}`,
        dependencies: info.dependencies || {},
        requiredEnv: info.requiredEnv || [],
        documentation: info.documentation || `https://github.com/elizaos-plugins/plugin-${name}#readme`,
        importStatement: info.importStatement || `import { ${this.capitalizeFirstLetter(name.replace(/-./g, x => x[1].toUpperCase()))} } from '@elizaos-plugins/plugin-${name}';`
      };
    }
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
   * Convert a GitHub URL to its raw content URL
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
   * Get a specific plugin by name
   */
  async getPlugin(name: string): Promise<PluginInfo | null> {
    if (Object.keys(this.plugins).length === 0) {
      await this.fetchPlugins();
    }
    
    return this.plugins[name] || null;
  }
  
  /**
   * Install a plugin
   */
  async installPlugin(name: string, version?: string): Promise<boolean> {
    try {
      // First, check if the plugin exists
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
          await this.installSinglePlugin(dependency);
        }
      }
      
      // Finally, install the requested plugin
      return await this.installSinglePlugin(name, version);
    } catch (error) {
      throw new Error(`Failed to install plugin: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Install a single plugin without resolving dependencies
   */
  private async installSinglePlugin(name: string, version?: string): Promise<boolean> {
    // Build the installation command
    const versionFlag = version ? `@${version}` : '';
    const packageName = `@elizaos-plugins/plugin-${name}${versionFlag}`;
    
    try {
      // Check if we have pnpm
      try {
        execSync('pnpm --version', { stdio: 'ignore' });
        
        // Install using pnpm
        execSync(`pnpm add ${packageName}`, { stdio: 'ignore' });
      } catch (error) {
        // Fallback to npm
        execSync(`npm install ${packageName}`, { stdio: 'ignore' });
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
      const elizaDeps = Object.keys(pluginInfo.dependencies)
        .filter(dep => dep.startsWith('@elizaos-plugins/plugin-'))
        .map(dep => dep.replace('@elizaos-plugins/plugin-', ''));
      
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
  
  /**
   * Get mock plugin data (used as fallback)
   */
  private getMockPlugins(): Record<string, PluginInfo> {
    return {
      'crypto-market-data': {
        name: 'crypto-market-data',
        description: 'Fetch real-time cryptocurrency market data',
        version: '1.0.0',
        author: 'Eliza Team',
        license: 'MIT',
        repository: 'https://github.com/elizaos-plugins/plugin-crypto-market-data',
        dependencies: {
          'axios': '^1.0.0',
          'websocket': '^1.0.34'
        },
        requiredEnv: ['API_KEY', 'EXCHANGE_API_SECRET'],
        documentation: 'https://github.com/elizaos-plugins/plugin-crypto-market-data#readme',
        importStatement: 'import { MarketData } from \'@elizaos-plugins/plugin-crypto-market-data\';'
      },
      'trading-signals': {
        name: 'trading-signals',
        description: 'Generate trading signals based on market data',
        version: '1.1.0',
        author: 'Eliza Team',
        license: 'MIT',
        repository: 'https://github.com/elizaos-plugins/plugin-trading-signals',
        dependencies: {
          'technicalindicators': '^3.1.0',
          'lodash': '^4.17.21'
        },
        requiredEnv: [],
        documentation: 'https://github.com/elizaos-plugins/plugin-trading-signals#readme',
        importStatement: 'import { SignalGenerator } from \'@elizaos-plugins/plugin-trading-signals\';'
      },
      'risk-management': {
        name: 'risk-management',
        description: 'Manage trading risk and position sizing',
        version: '0.9.0',
        author: 'Eliza Team',
        license: 'MIT',
        repository: 'https://github.com/elizaos-plugins/plugin-risk-management',
        dependencies: {
          'mathjs': '^10.0.0'
        },
        requiredEnv: ['MAX_RISK_PERCENTAGE'],
        documentation: 'https://github.com/elizaos-plugins/plugin-risk-management#readme',
        importStatement: 'import { RiskManager } from \'@elizaos-plugins/plugin-risk-management\';'
      },
      'exchange-connector': {
        name: 'exchange-connector',
        description: 'Connect to cryptocurrency exchanges',
        version: '1.2.0',
        author: 'Eliza Team',
        license: 'MIT',
        repository: 'https://github.com/elizaos-plugins/plugin-exchange-connector',
        dependencies: {
          'ccxt': '^1.90.0'
        },
        requiredEnv: ['EXCHANGE_API_KEY', 'EXCHANGE_API_SECRET'],
        documentation: 'https://github.com/elizaos-plugins/plugin-exchange-connector#readme',
        importStatement: 'import { ExchangeConnector } from \'@elizaos-plugins/plugin-exchange-connector\';'
      },
      'strategy-backtest': {
        name: 'strategy-backtest',
        description: 'Backtest trading strategies with historical data',
        version: '0.8.0',
        author: 'Eliza Team',
        license: 'MIT',
        repository: 'https://github.com/elizaos-plugins/plugin-strategy-backtest',
        dependencies: {
          'csv-parser': '^3.0.0',
          'mathjs': '^10.0.0',
          'plotly': '^1.0.0'
        },
        requiredEnv: ['HISTORICAL_DATA_PATH'],
        documentation: 'https://github.com/elizaos-plugins/plugin-strategy-backtest#readme',
        importStatement: 'import { Backtester } from \'@elizaos-plugins/plugin-strategy-backtest\';'
      }
    };
  }
} 