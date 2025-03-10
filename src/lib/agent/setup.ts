import path from 'path';
import fs from 'fs';
import ora from 'ora';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { LlmProvider } from '../llm/provider.js';
import { McpClient } from '../mcp/client.js';
import { PluginRegistry } from '../plugins/registry.js';
import { buildStrategyInteractively } from '../strategy/interactive-builder.js';
import { CharacterConfig, generateCharacterForSetup } from './character.js';
import { DocResponse } from '../mcp/server.js';
import { checkSystemPrerequisites, validateProjectStructure } from './prerequisites.js';
import { getInstalledPlugins, checkPluginCompatibility, installPlugin, PluginInfo, updateProjectStructure } from './plugin-compatibility.js';
import { spawn, ChildProcess } from 'child_process';
import readline from 'readline';
import { createFilesystemClient } from '../mcp/servers/filesystem-integration.js';
import { execPromise } from '../utils/exec-promise.js';

/**
 * Setup session for tracking progress
 */
export interface SetupSession {
  id: string;
  projectPath: string;
  startTime: Date;
  status: 'in-progress' | 'completed' | 'failed';
  steps: SetupStep[];
  currentStep: number;
  environment: Record<string, string>;
  installedPlugins: string[];
  character?: CharacterConfig;
  strategy?: any;
  strategyImplementation?: string;
  competitionUrl?: string;
  competitionInfo?: any;
  tradingGoals?: string;
  tradingGoalsAnalysis?: {
    assets: string[];
    timeframes: string[];
    riskProfile: string;
    strategyType: string;
    indicators: string[];
    specialRequirements: string[];
  };
  competitionAnalysis?: {
    assets: string[];
    timeframes: string[];
    evaluationMetrics: string[];
    constraints: string[];
    strategyRecommendations: string[];
  };
  selectedPlugins?: string[];
  requiredEnvironmentVars?: Record<string, string[]>;
}

/**
 * Setup step
 */
export interface SetupStep {
  id: string;
  name: string;
  description: string;
  status: 'pending' | 'in-progress' | 'completed' | 'skipped' | 'failed';
  startTime?: Date;
  endTime?: Date;
  error?: string;
}

/**
 * Interactive agent setup
 */
export class AgentSetup {
  private llmProvider: LlmProvider;
  private mcpClient: McpClient;
  private pluginRegistry: PluginRegistry;
  private session: SetupSession;
  private spinner: ReturnType<typeof ora>;
  
  constructor(llmProvider: LlmProvider, mcpClient: McpClient, projectPath: string) {
    this.llmProvider = llmProvider;
    this.mcpClient = mcpClient;
    this.pluginRegistry = new PluginRegistry();
    this.spinner = ora();
    
    // Initialize session
    this.session = {
      id: `setup-${Date.now()}`,
      projectPath,
      startTime: new Date(),
      status: 'in-progress',
      steps: [
        {
          id: 'project-validation',
          name: 'Project Validation',
          description: 'Validating project structure and environment',
          status: 'pending'
        },
        {
          id: 'trading-goals',
          name: 'Trading Goals',
          description: 'Understanding your trading objectives',
          status: 'pending'
        },
        {
          id: 'competition-analysis',
          name: 'Competition Analysis',
          description: 'Analyzing competition requirements (if applicable)',
          status: 'pending'
        },
        {
          id: 'plugin-recommendation',
          name: 'Plugin Recommendation',
          description: 'Recommending plugins based on your trading goals',
          status: 'pending'
        },
        {
          id: 'plugin-installation',
          name: 'Plugin Installation',
          description: 'Installing selected plugins',
          status: 'pending'
        },
        {
          id: 'environment-configuration',
          name: 'Environment Configuration',
          description: 'Setting up environment variables',
          status: 'pending'
        },
        {
          id: 'strategy-creation',
          name: 'Strategy Creation',
          description: 'Building your trading strategy',
          status: 'pending'
        },
        {
          id: 'character-creation',
          name: 'Character Creation',
          description: 'Creating your agent character',
          status: 'pending'
        },
        {
          id: 'agent-finalization',
          name: 'Agent Finalization',
          description: 'Finalizing your trading agent',
          status: 'pending'
        },
        {
          id: 'agent-interaction',
          name: 'Agent Interaction',
          description: 'Starting your trading agent',
          status: 'pending'
        }
      ],
      currentStep: 0,
      environment: {},
      installedPlugins: []
    };
    
    // Save session file
    this.saveSession();
  }
  
  /**
   * Start the interactive setup process
   */
  async start(): Promise<SetupSession> {
    try {
      console.log(chalk.cyan('\n📊 Interactive Trading Agent Setup\n'));
      console.log(chalk.gray('This assistant will guide you through setting up your trading agent.\n'));
      
      // Step 1: Project Validation
      await this.validateProject();
      
      // Step 2: Understand Trading Goals
      await this.understandTradingGoals();
      
      // Step 3: Competition Analysis (if applicable)
      await this.analyzeCompetition();
      
      // Step 4: Plugin Recommendation
      await this.recommendPlugins();
      
      // Step 5: Plugin Installation
      await this.installPlugins();
      
      // Step 6: Environment Configuration
      await this.configureEnvironment();
      
      // Step 7: Strategy Creation
      await this.createStrategy();
      
      // Step 8: Character Creation
      await this.createCharacter();
      
      // Step 9: Agent Finalization
      await this.finalizeAgent();
      
      // Step 10: Start Agent Interaction
      await this.startAgentInteraction();
      
      return this.session;
    } catch (error) {
      this.spinner.fail(`Setup failed: ${error instanceof Error ? error.message : String(error)}`);
      console.error(chalk.red(`\n${error instanceof Error ? error.message : String(error)}`));
      console.log(chalk.yellow('\nYou can still use the project manually.'));
      return this.session;
    }
  }
  
  /**
   * Step 1: Validate project structure and environment
   */
  private async validateProject(): Promise<void> {
    this.startStep('project-validation');
    
    try {
      // Check system prerequisites
      const spinner = ora('Checking system prerequisites...').start();
      const prerequisites = await checkSystemPrerequisites();
      
      if (!prerequisites.allSatisfied) {
        spinner.fail('System prerequisites check failed');
        
        console.log(chalk.yellow('\nThe following system requirements need to be addressed:'));
        for (const result of prerequisites.results.filter(r => !r.satisfied)) {
          console.log(chalk.red(`• ${result.name}: ${result.message}`));
          if (result.installCommand) {
            console.log(chalk.gray(`  To install or update, run: ${result.installCommand}`));
          }
        }
        
        // Ask user if they want to continue anyway
        const { continueDespitePrerequisites } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'continueDespitePrerequisites',
            message: 'Do you want to continue anyway? (Some features may not work correctly)',
            default: false
          }
        ]);
        
        if (!continueDespitePrerequisites) {
          throw new Error('Setup aborted: system prerequisites not satisfied');
        }
      } else {
        spinner.succeed('System prerequisites satisfied');
        
        console.log(chalk.green('\nDetected:'));
        for (const result of prerequisites.results) {
          console.log(chalk.green(`• ${result.name}: ${result.version || 'Installed'}`));
        }
      }
      
      // Validate project structure
      spinner.text = 'Validating project structure...';
      spinner.start();
      
      const structureResult = validateProjectStructure(this.session.projectPath);
      
      if (!structureResult.valid) {
        spinner.fail('Project structure validation failed');
        
        console.log(chalk.yellow('\nThe following issues were found in your project structure:'));
        for (const issue of structureResult.issues) {
          console.log(chalk.red(`• ${issue}`));
        }
        
        // If there are missing directories or files, offer to create them
        if (structureResult.missingDirectories.length > 0 || structureResult.missingFiles.length > 0) {
          const { fixStructure } = await inquirer.prompt([
            {
              type: 'confirm',
              name: 'fixStructure',
              message: 'Do you want to fix the project structure by creating missing directories and files?',
              default: true
            }
          ]);
          
          if (fixStructure) {
            spinner.text = 'Fixing project structure...';
            spinner.start();
            
            // Create missing directories
            for (const dir of structureResult.missingDirectories) {
              const dirPath = path.join(this.session.projectPath, dir);
              fs.mkdirSync(dirPath, { recursive: true });
            }
            
            // Create missing files (with minimal content)
            for (const file of structureResult.missingFiles) {
              const filePath = path.join(this.session.projectPath, file);
              
              // Create parent directory if it doesn't exist
              const directory = path.dirname(filePath);
              if (!fs.existsSync(directory)) {
                fs.mkdirSync(directory, { recursive: true });
              }
              
              // Create empty files or with minimal content based on file type
              if (file === 'package.json' && !fs.existsSync(filePath)) {
                const projectName = path.basename(this.session.projectPath);
                const packageJson = {
                  name: projectName,
                  version: '0.1.0',
                  description: 'Recall trading agent',
                  main: 'dist/index.js',
                  type: 'module',
                  scripts: {
                    build: 'tsc',
                    start: 'node dist/index.js'
                  },
                  dependencies: {
                    '@elizaos/core': 'latest',
                    '@elizaos/agent': 'latest'
                  }
                };
                fs.writeFileSync(filePath, JSON.stringify(packageJson, null, 2));
              } else if (file === 'tsconfig.json' && !fs.existsSync(filePath)) {
                const tsconfig = {
                  compilerOptions: {
                    target: 'ES2020',
                    module: 'NodeNext',
                    moduleResolution: 'NodeNext',
                    esModuleInterop: true,
                    outDir: './dist',
                    strict: true
                  },
                  include: ['src/**/*']
                };
                fs.writeFileSync(filePath, JSON.stringify(tsconfig, null, 2));
              } else if (!fs.existsSync(filePath)) {
                // Create empty file
                fs.writeFileSync(filePath, '');
              }
            }
            
            spinner.succeed('Project structure fixed');
          } else {
            throw new Error('Setup aborted: project structure issues not fixed');
          }
        } else {
          throw new Error('Setup aborted: invalid project structure');
        }
      } else {
        spinner.succeed('Project structure is valid');
      }
      
      // Get installed plugins to enhance setup context
      spinner.text = 'Analyzing existing plugins...';
      spinner.start();
      
      const installedPlugins = await getInstalledPlugins(this.session.projectPath);
      if (installedPlugins.length > 0) {
        spinner.succeed(`Found ${installedPlugins.length} installed plugins`);
        this.session.installedPlugins = installedPlugins.map(p => p.name);
        
        console.log(chalk.cyan('\nInstalled plugins:'));
        for (const plugin of installedPlugins) {
          console.log(chalk.green(`• ${plugin.name} (${plugin.version})`));
        }
      } else {
        spinner.succeed('No existing plugins found');
        this.session.installedPlugins = [];
      }
      
      this.completeStep('project-validation');
    } catch (error) {
      this.failStep('project-validation', error instanceof Error ? error.message : String(error));
      throw error;
    }
  }
  
  /**
   * Step 2: Understand the user's trading goals
   */
  private async understandTradingGoals(): Promise<void> {
    this.startStep('trading-goals');
    
    try {
      console.log(chalk.cyan('\n📈 Understanding Your Trading Goals\n'));
      
      // Provide guidance about what to include
      console.log(chalk.gray('Please provide information about:'));
      console.log(chalk.gray('- What assets you want to trade (e.g., BTC, ETH, or specific tokens)'));
      console.log(chalk.gray('- Your preferred timeframes (e.g., 1h, 4h, daily)'));
      console.log(chalk.gray('- Risk tolerance (e.g., conservative, moderate, aggressive)'));
      console.log(chalk.gray('- Any specific indicators or strategies you\'re interested in'));
      console.log(chalk.gray('- Any other preferences or constraints\n'));
      
      // Use a series of simple inputs instead of an editor
      const { assets } = await inquirer.prompt([
        {
          type: 'input',
          name: 'assets',
          message: 'What assets would you like to trade?',
          default: 'BTC, ETH',
        }
      ]);
      
      const { timeframes } = await inquirer.prompt([
        {
          type: 'input',
          name: 'timeframes',
          message: 'What timeframes are you interested in?',
          default: '1h, 4h, daily',
        }
      ]);
      
      const { riskTolerance } = await inquirer.prompt([
        {
          type: 'list',
          name: 'riskTolerance',
          message: 'What is your risk tolerance?',
          choices: ['Conservative', 'Moderate', 'Aggressive'],
          default: 'Moderate',
        }
      ]);
      
      const { indicators } = await inquirer.prompt([
        {
          type: 'input',
          name: 'indicators',
          message: 'Any specific indicators or strategies you\'re interested in?',
          default: 'Moving averages, RSI, MACD',
        }
      ]);
      
      const { otherPreferences } = await inquirer.prompt([
        {
          type: 'input',
          name: 'otherPreferences',
          message: 'Any other preferences or constraints?',
          default: '',
        }
      ]);
      
      // Combine the inputs into a single trading goals string
      const tradingGoals = `
Assets: ${assets}
Timeframes: ${timeframes}
Risk Tolerance: ${riskTolerance}
Indicators/Strategies: ${indicators}
${otherPreferences ? `Other Preferences: ${otherPreferences}` : ''}
`.trim();
      
      // Display the combined trading goals
      console.log(chalk.cyan('\nYour Trading Goals Summary:'));
      console.log(chalk.white(tradingGoals));
      
      const { confirmGoals } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirmGoals',
          message: 'Does this summary accurately reflect your trading goals?',
          default: true,
        }
      ]);
      
      if (!confirmGoals) {
        console.log(chalk.yellow('\nLet\'s try again.'));
        return await this.understandTradingGoals();
      }
      
      // Store the trading goals
      this.session.tradingGoals = tradingGoals;
      
      // Use the LLM to analyze the goals
      this.spinner.start('Analyzing your trading goals...');
      
      const prompt = `
Analyze the following trading goals and extract key information for a crypto trading signal agent:

${tradingGoals}

Please provide a structured analysis with the following:
1. Assets/Markets: What cryptocurrencies or assets they want to trade
2. Timeframes: What timeframes they prefer for trading
3. Risk Profile: Their risk tolerance (conservative, moderate, aggressive)
4. Strategy Type: What kind of strategy would suit them (momentum, mean reversion, etc.)
5. Indicators: Any specific indicators they mentioned or that would suit their goals
6. Special Requirements: Any other constraints or preferences

Format your response as JSON: {
  "assets": ["asset1", "asset2"],
  "timeframes": ["timeframe1", "timeframe2"],
  "riskProfile": "profile",
  "strategyType": "type",
  "indicators": ["indicator1", "indicator2"],
  "specialRequirements": ["requirement1"]
}`;
      
      const response = await this.llmProvider.prompt(prompt);
      
      try {
        // Extract JSON from response
        const jsonStart = response.content.indexOf('{');
        const jsonEnd = response.content.lastIndexOf('}') + 1;
        
        if (jsonStart >= 0 && jsonEnd > jsonStart) {
          const jsonString = response.content.substring(jsonStart, jsonEnd);
          this.session.tradingGoalsAnalysis = JSON.parse(jsonString);
        } else {
          throw new Error('Could not parse JSON from response');
        }
      } catch (error) {
        console.warn(`Failed to parse trading goals analysis: ${error instanceof Error ? error.message : String(error)}`);
        // Create a simple analysis as fallback
        this.session.tradingGoalsAnalysis = {
          assets: ['BTC', 'ETH'],
          timeframes: ['1h', '4h'],
          riskProfile: 'moderate',
          strategyType: 'momentum',
          indicators: ['Moving Average', 'RSI'],
          specialRequirements: []
        };
      }
      
      this.spinner.succeed('Trading goals analyzed successfully');
      
      // Save the session
      this.saveSession();
      
      // Display the analysis
      console.log(chalk.cyan('\n📊 Trading Goals Analysis:\n'));
      
      if (this.session.tradingGoalsAnalysis) {
        const analysis = this.session.tradingGoalsAnalysis;
        console.log(chalk.white(`Assets: ${analysis.assets.join(', ')}`));
        console.log(chalk.white(`Timeframes: ${analysis.timeframes.join(', ')}`));
        console.log(chalk.white(`Risk Profile: ${analysis.riskProfile}`));
        console.log(chalk.white(`Strategy Type: ${analysis.strategyType}`));
        console.log(chalk.white(`Indicators: ${analysis.indicators.join(', ')}`));
        
        if (analysis.specialRequirements && analysis.specialRequirements.length > 0) {
          console.log(chalk.white(`Special Requirements: ${analysis.specialRequirements.join(', ')}`));
        }
      }
      
      // Replace the confirmation prompt with just an informational message
      console.log(chalk.gray('\nThis analysis will be used to recommend plugins and build your strategy.\n'));
      
      this.completeStep('trading-goals');
    } catch (error) {
      this.failStep('trading-goals', error instanceof Error ? error.message : String(error));
      throw error;
    }
  }
  
  /**
   * Step 3: Analyze competition if a URL is provided
   */
  private async analyzeCompetition(): Promise<void> {
    this.startStep('competition-analysis');
    
    try {
      // Ask if user is building for a competition
      const { hasCompetition } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'hasCompetition',
          message: 'Are you building this agent for a specific trading competition?',
          default: false
        }
      ]);
      
      if (!hasCompetition) {
        this.skipStep('competition-analysis');
        return;
      }
      
      // Get competition URL
      const { competitionUrl } = await inquirer.prompt([
        {
          type: 'input',
          name: 'competitionUrl',
          message: 'Please enter the URL of the competition guidelines:',
          validate: (input) => input.trim().length > 0 ? true : 'Please enter a valid URL'
        }
      ]);
      
      this.session.competitionUrl = competitionUrl;
      this.saveSession();
      
      // Fetch and analyze competition guidelines
      this.spinner.start('Fetching competition guidelines...');
      let competitionDoc: DocResponse;
      
      try {
        competitionDoc = await this.mcpClient.getUrlDocumentation(competitionUrl);
      } catch (error) {
        this.spinner.warn('Failed to fetch competition URL. Please enter the guidelines manually.');
        
        // Ask for manual input
        const { competitionGuidelines } = await inquirer.prompt([
          {
            type: 'editor',
            name: 'competitionGuidelines',
            message: 'Please paste the competition guidelines:',
          }
        ]);
        
        competitionDoc = {
          content: competitionGuidelines,
          source: 'manual',
          timestamp: Date.now()
        };
      }
      
      this.spinner.succeed('Competition guidelines fetched');
      
      // Analyze the competition with LLM
      this.spinner.start('Analyzing competition requirements...');
      
      const prompt = `
Analyze the following trading competition guidelines and extract key requirements for building a trading agent:

${competitionDoc.content}

Please extract:
1. Assets/Markets: What cryptocurrencies or assets are involved
2. Timeframes: What timeframes are relevant
3. Evaluation Metrics: How success will be measured
4. Constraints: Any limitations or rules
5. Strategy Recommendations: What type of strategy might work well

Format your response as JSON: {
  "assets": ["asset1", "asset2"],
  "timeframes": ["timeframe1", "timeframe2"],
  "evaluationMetrics": ["metric1", "metric2"],
  "constraints": ["constraint1", "constraint2"],
  "strategyRecommendations": ["recommendation1", "recommendation2"]
}`;
      
      const response = await this.llmProvider.prompt(prompt);
      
      try {
        // Extract JSON from response
        const jsonStart = response.content.indexOf('{');
        const jsonEnd = response.content.lastIndexOf('}') + 1;
        
        if (jsonStart >= 0 && jsonEnd > jsonStart) {
          const jsonString = response.content.substring(jsonStart, jsonEnd);
          this.session.competitionAnalysis = JSON.parse(jsonString);
        } else {
          throw new Error('Could not parse JSON from response');
        }
      } catch (error) {
        console.warn(`Failed to parse competition analysis: ${error instanceof Error ? error.message : String(error)}`);
        // Create a simple analysis as fallback
        this.session.competitionAnalysis = {
          assets: ['BTC', 'ETH'],
          timeframes: ['1h', '4h'],
          evaluationMetrics: ['ROI', 'Sharpe Ratio'],
          constraints: ['Limited number of trades'],
          strategyRecommendations: ['Momentum-based strategy']
        };
      }
      
      this.spinner.succeed('Competition requirements analyzed');
      
      // Display the analysis
      console.log(chalk.cyan('\n🏆 Competition Analysis:\n'));
      
      if (this.session.competitionAnalysis) {
        const analysis = this.session.competitionAnalysis;
        console.log(chalk.white(`Assets: ${analysis.assets.join(', ')}`));
        console.log(chalk.white(`Timeframes: ${analysis.timeframes.join(', ')}`));
        console.log(chalk.white(`Evaluation Metrics: ${analysis.evaluationMetrics.join(', ')}`));
        console.log(chalk.white(`Constraints: ${analysis.constraints.join(', ')}`));
        console.log(chalk.white(`Strategy Recommendations: ${analysis.strategyRecommendations.join(', ')}`));
      }
      
      // Save the session
      this.saveSession();
      
      this.completeStep('competition-analysis');
    } catch (error) {
      this.failStep('competition-analysis', error instanceof Error ? error.message : String(error));
      console.warn(`Competition analysis failed: ${error instanceof Error ? error.message : String(error)}`);
      console.log(chalk.yellow('Continuing without competition analysis...'));
    }
  }
  
  /**
   * Step 4: Recommend plugins based on trading goals
   */
  private async recommendPlugins(): Promise<void> {
    this.startStep('plugin-recommendation');
    
    try {
      console.log(chalk.cyan('\n🔌 Plugin Recommendations\n'));
      
      // Generate context for plugin recommendation
      let context = '';
      
      if (this.session.tradingGoalsAnalysis) {
        const analysis = this.session.tradingGoalsAnalysis;
        context += `Trading Goals: Looking to trade ${analysis.assets.join(', ')} on ${analysis.timeframes.join(', ')} timeframes. `;
        context += `Risk profile: ${analysis.riskProfile}. Strategy type: ${analysis.strategyType}. `;
        context += `Interested in indicators: ${analysis.indicators.join(', ')}. `;
        
        if (analysis.specialRequirements && analysis.specialRequirements.length > 0) {
          context += `Special requirements: ${analysis.specialRequirements.join(', ')}. `;
        }
      }
      
      if (this.session.competitionAnalysis) {
        const analysis = this.session.competitionAnalysis;
        context += `Competition involves trading ${analysis.assets.join(', ')} on ${analysis.timeframes.join(', ')} timeframes. `;
        context += `Performance will be evaluated on ${analysis.evaluationMetrics.join(', ')}. `;
        context += `Constraints: ${analysis.constraints.join(', ')}. `;
      }
      
      // Use LLM to generate strategy description
      this.spinner.start('Generating strategy description for plugin recommendations...');
      
      const strategyPrompt = `
Based on the following information, generate a concise strategy description for a crypto trading agent:

${context}

Keep it clear and detailed but concise (less than 300 words).`;
      
      const strategyResponse = await this.llmProvider.prompt(strategyPrompt);
      const strategyDescription = strategyResponse.content;
      
      this.spinner.succeed('Strategy description generated');
      
      // Use the strategy to recommend plugins
      this.spinner.start('Finding plugins to match your strategy...');
      
      // No fallback - if this fails, we'll let the error propagate
      const pluginRecommendations = await this.llmProvider.recommendPluginsForStrategy(strategyDescription);
      
      this.spinner.succeed(`Found ${pluginRecommendations.length} recommended plugins`);
      
      // Display the recommendations
      console.log(chalk.cyan('\n🔌 Recommended Plugins:\n'));
      
      const pluginChoices = pluginRecommendations.map(plugin => {
        // Ensure correct namespace
        let normalizedName = plugin.name;
        
        // If name already includes @elizaos-plugins/, replace with @elizaos/
        if (normalizedName.startsWith('@elizaos-plugins/')) {
          normalizedName = normalizedName.replace('@elizaos-plugins/', '@elizaos/');
        }
        // If name doesn't have a namespace, add @elizaos/ namespace
        else if (!normalizedName.startsWith('@')) {
          normalizedName = normalizedName.startsWith('plugin-') 
            ? `@elizaos/${normalizedName}` 
            : `@elizaos/plugin-${normalizedName}`;
        }
        
        return {
          name: `${plugin.name} (${Math.round(plugin.confidence * 100)}% confidence) - ${plugin.reasoning.substring(0, 100)}...`,
          value: normalizedName,
          short: normalizedName,
          confidence: plugin.confidence
        };
      });
      
      // Sort by confidence
      pluginChoices.sort((a, b) => b.confidence - a.confidence);
      
      // Allow user to select plugins
      const { selectedPlugins } = await inquirer.prompt([
        {
          type: 'checkbox',
          name: 'selectedPlugins',
          message: 'Select plugins to install:',
          choices: pluginChoices,
          default: pluginChoices.filter(p => p.confidence > 0.7).map(p => p.value)
        }
      ]);
      
      this.session.selectedPlugins = selectedPlugins;
      this.saveSession();
      
      this.completeStep('plugin-recommendation');
    } catch (error) {
      this.spinner.fail(`Failed to recommend plugins: ${error instanceof Error ? error.message : String(error)}`);
      this.failStep('plugin-recommendation', error instanceof Error ? error.message : String(error));
      throw new Error(`Plugin recommendation failed. Please check your connection to the plugin registry: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Step 5: Install selected plugins
   */
  private async installPlugins(): Promise<void> {
    this.startStep('plugin-installation');
    
    try {
      if (!this.session.selectedPlugins || this.session.selectedPlugins.length === 0) {
        console.log(chalk.gray('No plugins selected for installation.'));
        this.skipStep('plugin-installation');
        return;
      }
      
      console.log(chalk.cyan('\n📦 Installing Plugins\n'));
      console.log(chalk.white(`Installing ${this.session.selectedPlugins.length} plugins...`));
      
      // Get plugin registry data (plugins already installed and plugin definitions)
      const spinner = ora('Checking plugin compatibility...').start();
      
      // Create a dummy plugin registry for compatibility checks
      const installedPlugins: PluginInfo[] = await getInstalledPlugins(this.session.projectPath);
      
      // Convert to pluginInfo map for compatibility check
      const pluginRegistry: Record<string, PluginInfo> = {};
      
      // Get plugin information from registry (this would come from a real plugin registry in production)
      for (const pluginName of this.session.selectedPlugins) {
        pluginRegistry[pluginName] = {
          name: pluginName,
          version: 'latest',
          description: 'Plugin for crypto trading',
          dependencies: [],
          installCommand: `pnpm add ${pluginName}`,
          capabilities: []
        };
      }
      
      // Check compatibility for each plugin
      const compatibilityResults = await Promise.all(
        this.session.selectedPlugins.map(pluginName => 
          checkPluginCompatibility(pluginName, installedPlugins, pluginRegistry)
        )
      );
      
      // Check for any conflicts
      const conflicts = compatibilityResults.filter(result => !result.compatible);
      
      if (conflicts.length > 0) {
        spinner.fail('Plugin compatibility issues detected');
        
        console.log(chalk.yellow('\nThe following plugins have compatibility issues:'));
        for (const conflict of conflicts) {
          console.log(chalk.red(`\n• ${conflict.plugin.name}:`));
          for (const issue of conflict.conflicts) {
            console.log(chalk.red(`  - Conflict with ${issue.plugin}: ${issue.reason}`));
          }
          
          if (conflict.recommendations.length > 0) {
            console.log(chalk.cyan('\n  Recommendations:'));
            for (const recommendation of conflict.recommendations) {
              console.log(chalk.cyan(`  - ${recommendation}`));
            }
          }
        }
        
        // Ask if they want to continue anyway
        const { continueWithConflicts } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'continueWithConflicts',
            message: 'Do you want to continue with installation despite compatibility issues?',
            default: false
          }
        ]);
        
        if (!continueWithConflicts) {
          throw new Error('Plugin installation aborted due to compatibility issues');
        }
        
        console.log(chalk.yellow('\nContinuing with installation despite compatibility issues...'));
      } else {
        spinner.succeed('All plugins are compatible');
      }
      
      // Install plugins one by one
      const installedPluginNames: string[] = [];
      const failedPlugins: { name: string; error: string }[] = [];
      
      for (const pluginName of this.session.selectedPlugins) {
        const result = await installPlugin(pluginName, this.session.projectPath);
        
        if (result.success) {
          installedPluginNames.push(pluginName);
        } else {
          failedPlugins.push({
            name: pluginName,
            error: result.error || 'Unknown error'
          });
        }
      }
      
      // Update project structure based on installed plugins
      if (installedPluginNames.length > 0) {
        spinner.text = 'Updating project structure...';
        spinner.start();
        
        // Create a FilesystemMcpClient with access to the project directory
        const filesystemMcpClient = createFilesystemClient(
          this.session.projectPath, 
          this.mcpClient.getBaseUrl(),
          this.mcpClient // Pass the original MCP client
        );
        
        // Get ONLY the newly installed plugins info
        const newlyInstalledPluginsInfo = await Promise.all(
          installedPluginNames.map(async pluginName => {
            try {
              // Try to get accurate plugin info for the newly installed plugin
              const allPlugins = await getInstalledPlugins(this.session.projectPath);
              const pluginInfo = allPlugins.find(p => p.name === pluginName);
              
              if (pluginInfo) {
                return pluginInfo;
              }
              
              // Fallback if plugin info not found
              return {
                name: pluginName,
                version: 'latest',
                description: 'Recently installed plugin',
                dependencies: [],
                installCommand: `pnpm add ${pluginName}`,
                capabilities: []
              };
            } catch (error) {
              // Fallback if there's an error
              return {
                name: pluginName,
                version: 'latest',
                description: 'Recently installed plugin',
                dependencies: [],
                installCommand: `pnpm add ${pluginName}`,
                capabilities: []
              };
            }
          })
        );
        
        // Update project structure with LLM and MCP support - ONLY for newly installed plugins
        const structureResult = await updateProjectStructure(
          this.session.projectPath, 
          newlyInstalledPluginsInfo,
          this.llmProvider,
          filesystemMcpClient // Use combined filesystem client with documentation access
        );
        
        if (structureResult.success) {
          spinner.succeed(`Updated project structure for plugins (${structureResult.updatedFiles.length} files modified)`);
          
          if (structureResult.updatedFiles.length > 0) {
            console.log(chalk.gray('\nUpdated files:'));
            for (const file of structureResult.updatedFiles) {
              console.log(chalk.gray(`• ${file}`));
            }
          }
        } else {
          spinner.fail(`Failed to update project structure: ${structureResult.error}`);
          console.log(chalk.yellow('You may need to manually integrate plugins into your project structure'));
        }
      }
      
      // Show installation summary
      console.log(chalk.green(`\n✅ Successfully installed ${installedPluginNames.length} plugins`));
      
      if (failedPlugins.length > 0) {
        console.log(chalk.red(`\n⚠️ Failed to install ${failedPlugins.length} plugins:`));
        for (const failed of failedPlugins) {
          console.log(chalk.red(`• ${failed.name}: ${failed.error}`));
        }
      }
      
      // Update session
      this.session.installedPlugins = [...(this.session.installedPlugins || []), ...installedPluginNames];
      this.saveSession();
      
      this.completeStep('plugin-installation');
    } catch (error) {
      this.failStep('plugin-installation', error instanceof Error ? error.message : String(error));
      throw error;
    }
  }
  
  /**
   * Step 6: Configure environment
   */
  private async configureEnvironment(): Promise<void> {
    this.startStep('environment-configuration');
    
    try {
      console.log(chalk.cyan('\n🌐 Configuring Environment\n'));
      
      // Import our environment setup module
      const { setupEnvironmentVariables } = await import('../cli/env.js');
      
      // Only pass the plugins that were specifically selected by the user during setup
      // This ensures we're not trying to configure everything in node_modules
      const selectedPlugins = this.session.selectedPlugins || [];
      
      console.log(chalk.yellow('Starting interactive environment configuration...\n'));
      console.log(chalk.gray(`Configuring environment for ${selectedPlugins.length} selected plugins\n`));
      
      // Ensure we're ONLY processing the user-selected plugins and not all installed plugins
      // Filter out any non-user selected plugins to avoid processing plugins that came with the starter kit
      const userPluginsOnly = [...selectedPlugins]; // Create a new array to avoid mutation
      
      console.log(chalk.gray(`Processing only these plugins: ${userPluginsOnly.join(', ')}\n`));
      
      await setupEnvironmentVariables(
        this.session.projectPath,
        this.llmProvider,
        this.mcpClient,
        userPluginsOnly
      );
      
      // Load environment variables from the created .env file
      const envPath = path.join(this.session.projectPath, '.env');
      if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf-8');
        const envLines = envContent.split('\n');
        
        const envVars: Record<string, string> = {};
        for (const line of envLines) {
          const match = line.match(/^([^=]+)=(.*)$/);
          if (match && match.length >= 3) {
            const key = match[1].trim();
            const value = match[2].trim();
            if (key && value) {
              envVars[key] = value;
            }
          }
        }
        
        this.session.environment = envVars;
        this.saveSession();
      }
      
      console.log(chalk.green('\n✅ Environment configuration complete!\n'));
      
      this.completeStep('environment-configuration');
    } catch (error) {
      this.failStep('environment-configuration', error instanceof Error ? error.message : String(error));
      throw error;
    }
  }
  
  /**
   * Step 7: Create trading strategy
   */
  private async createStrategy(): Promise<void> {
    this.startStep('strategy-creation');
    
    try {
      console.log(chalk.cyan('\n🚀 Building Your Trading Strategy\n'));
      
      // Generate strategy based on trading goals
      this.spinner.start('Generating trading strategy...');
      
      // Temporarily pause the spinner during character enhancement to prevent console conflicts
      this.spinner.stop();
      
      const strategy = await buildStrategyInteractively({
        outputFormat: 'standard',
        interactive: false,
        strategyName: this.session.tradingGoalsAnalysis?.strategyType || 'Trading Strategy',
        description: this.session.tradingGoals || 'A trading strategy for crypto markets',
        timeframes: this.session.tradingGoalsAnalysis?.timeframes || [],
        indicators: this.session.tradingGoalsAnalysis?.indicators || [],
        targetPlugins: this.session.selectedPlugins || [],
        outputDir: path.join(this.session.projectPath, 'strategies')
      });
      
      // Restart the spinner after character enhancement
      this.spinner.start('Finalizing strategy generation...');
      
      this.spinner.succeed('Trading strategy generated');
      
      // Save the strategy
      this.session.strategy = strategy.strategy;
      // Strategy implementation is now optional, so we set it to a placeholder if it's undefined
      this.session.strategyImplementation = strategy.implementation || 
        '// Strategy implementation is not generated. Configure your strategy in code as needed.';
      this.saveSession();
      
      this.completeStep('strategy-creation');
    } catch (error) {
      this.failStep('strategy-creation', error instanceof Error ? error.message : String(error));
      throw error;
    }
  }
  
  /**
   * Step 8: Create character
   */
  private async createCharacter(): Promise<void> {
    this.startStep('character-creation');
    
    try {
      console.log(chalk.cyan('\n👤 Creating Your Agent Character\n'));
      
      // Generate character based on trading strategy and trading goals
      this.spinner.start('Generating character description...');
      
      const tradingGoalsContext = this.session.tradingGoals || 'Trading cryptocurrencies based on market signals';
      const character = await generateCharacterForSetup(tradingGoalsContext, this.llmProvider);
      
      this.spinner.succeed('Character description generated');
      
      // Save the character
      this.session.character = character;
      this.saveSession();
      
      this.completeStep('character-creation');
    } catch (error) {
      this.failStep('character-creation', error instanceof Error ? error.message : String(error));
      throw error;
    }
  }
  
  /**
   * Step 9: Finalize the agent
   */
  private async finalizeAgent(): Promise<void> {
    this.startStep('agent-finalization');
    
    try {
      console.log(chalk.cyan('\n🚀 Finalizing Your Trading Agent\n'));
      
      // Generate finalization instructions with LLM
      this.spinner.start('Generating finalization instructions...');
      
      const prompt = `
Create a set of concise instructions for finalizing a crypto trading agent with the following components:

- Name: ${this.session.character?.name || 'Trading Agent'}
- Strategy: ${this.session.strategy?.name || 'Custom Strategy'}
- Plugins: ${this.session.installedPlugins?.join(', ') || 'None'}

Instructions should include:
1. How to test the agent
2. How to run the agent
3. How to monitor the agent
4. Next steps for customization or improvement

Keep it concise but informative.`;
      
      const response = await this.llmProvider.prompt(prompt);
      this.spinner.succeed('Finalization instructions generated');
      
      // Display instructions
      console.log(chalk.white('\n' + response.content));
      
      // Create a README.md file with setup instructions
      const readmePath = path.join(this.session.projectPath, 'README.md');
      
      let readmeContent = '';
      if (fs.existsSync(readmePath)) {
        readmeContent = fs.readFileSync(readmePath, 'utf8');
        readmeContent += '\n\n';
      }
      
      readmeContent += `
# ${this.session.character?.name || 'Trading Agent'}

${this.session.character?.description || 'A crypto trading agent'}

## Strategy

${this.session.strategy?.name || 'Custom Strategy'}: ${this.session.strategy?.description || 'A custom trading strategy'}

### Indicators
${this.session.strategy?.indicators?.map((i: string) => `- ${i}`).join('\n') || '- Custom indicators'}

### Timeframes
${this.session.strategy?.timeframes?.map((t: string) => `- ${t}`).join('\n') || '- Custom timeframes'}

## Installed Plugins
${this.session.installedPlugins?.map(p => `- ${p}`).join('\n') || '- No plugins installed'}

## Setup Instructions

1. Ensure all environment variables are set in .env file
2. Run the agent with: \`pnpm start\`

## Getting Started

${response.content}

---
Generated with Recall CLI
`;
      
      fs.writeFileSync(readmePath, readmeContent);
      
      console.log(chalk.green('\nREADME.md file updated with agent details'));
      
      // Save the session
      this.saveSession();
      
      this.completeStep('agent-finalization');
    } catch (error) {
      this.failStep('agent-finalization', error instanceof Error ? error.message : String(error));
      console.warn(`Agent finalization failed: ${error instanceof Error ? error.message : String(error)}`);
      console.log(chalk.yellow('Setup completed with warnings.'));
    }
  }
  
  /**
   * Step 10: Start agent interaction
   * Runs the agent and enables the CLI to act as a meta-agent
   */
  private async startAgentInteraction(): Promise<void> {
    this.startStep('agent-interaction');
    
    try {
      console.log(chalk.cyan('\n🤖 Starting agent to test your configuration...\n'));
      
      // Create a spinner for the agent startup
      this.spinner.start('Preparing agent...');
      
      // Check if character file exists
      const characterPath = path.join(this.session.projectPath, 'characters', 'eliza.character.json');
      
      if (!fs.existsSync(characterPath)) {
        throw new Error(`Character file not found at ${characterPath}`);
      }
      
      this.spinner.succeed('Agent configuration verified');
      
      // Check Node.js version
      try {
        const { stdout: nodeVersionOutput } = await execPromise('node --version');
        const nodeVersionWithoutV = nodeVersionOutput.trim().startsWith('v') ? 
          nodeVersionOutput.trim().substring(1) : nodeVersionOutput.trim();
        
        if (nodeVersionWithoutV !== '22.11.0') {
          console.error(chalk.red(`Error: Incorrect Node.js version detected. Required: v22.11.0, Current: ${nodeVersionOutput.trim()}`));
          console.error(chalk.yellow('Please use the correct Node.js version, for example with nvm:'));
          console.error(chalk.yellow('  nvm install 22.11.0'));
          console.error(chalk.yellow('  nvm use 22.11.0'));
          throw new Error(`Incorrect Node.js version. Required: 22.11.0, Current: ${nodeVersionWithoutV}`);
        }
        
        // Check pnpm version
        const { stdout: pnpmVersionOutput } = await execPromise('pnpm --version');
        const pnpmVersion = pnpmVersionOutput.trim();
        
        if (pnpmVersion !== '9.15.4') {
          console.error(chalk.red(`Error: Incorrect pnpm version detected. Required: 9.15.4, Current: ${pnpmVersion}`));
          console.error(chalk.yellow('Please install the correct version: npm install -g pnpm@9.15.4'));
          throw new Error(`Incorrect pnpm version. Required: 9.15.4, Current: ${pnpmVersion}`);
        }
        
        console.log(chalk.green(`✓ Using Node.js v${nodeVersionWithoutV} and pnpm ${pnpmVersion}`));
      } catch (error) {
        if (error instanceof Error && error.message.includes('Command failed')) {
          console.error(chalk.red('Error: Could not determine Node.js or pnpm version'));
          console.error(chalk.yellow('Please ensure Node.js v22.11.0 and pnpm 9.15.4 are installed and available in your PATH'));
          throw new Error('Failed to verify Node.js and pnpm versions');
        }
        throw error;
      }
      
      // Prepare command with colored output for visibility
      console.log(chalk.gray('Starting agent with command:'));
      console.log(chalk.cyan('pnpm start --characters=\'characters/eliza.character.json\''));
      console.log(chalk.gray('Working directory:'));
      console.log(chalk.cyan(this.session.projectPath));
      console.log(chalk.gray('\nPlease wait while the agent initializes...\n'));
      
      // Start the agent process
      const agentProcess = spawn('pnpm', ['start', '--characters=characters/eliza.character.json'], {
        cwd: this.session.projectPath,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true,
        env: { ...process.env, FORCE_COLOR: 'true' }
      });
      
      // Collect agent responses for context
      let agentResponseBuffer = '';
      
      // Process startup phase
      let agentStarted = false;
      const startupTimeout = setTimeout(() => {
        if (!agentStarted) {
          console.log(chalk.yellow('\nAgent startup is taking longer than expected. This might be normal for the first run.'));
          console.log(chalk.yellow('Please be patient while I continue monitoring...\n'));
        }
      }, 5000);
      
      // Handle agent output
      agentProcess.stdout.on('data', (data) => {
        const output = data.toString();
        process.stdout.write(output);
        
        // Add to response buffer for context
        agentResponseBuffer += output;
        
        // Keep buffer at a reasonable size
        if (agentResponseBuffer.length > 10000) {
          agentResponseBuffer = agentResponseBuffer.slice(-5000);
        }
        
        // Detect when agent is ready
        if (!agentStarted && (output.includes('Agent ready') || output.includes('started successfully'))) {
          agentStarted = true;
          clearTimeout(startupTimeout);
          
          // Once agent is started, begin meta-agent operation
          console.log(chalk.green('\n✅ Agent started successfully!\n'));
          console.log(chalk.cyan('🧠 I\'m now operating as the primary controller for your agent.'));
          console.log(chalk.cyan('I\'ll use my knowledge of your setup to work with the agent automatically.'));
          console.log(chalk.cyan('You can observe our interaction, and type "exit" at any time to stop.\n'));
          
          // Start the autonomous operation
          this.beginAutonomousOperation(agentProcess, agentResponseBuffer);
          
          // Complete the setup step
          this.completeStep('agent-interaction');
        }
      });
      
      // Handle agent errors
      agentProcess.stderr.on('data', (data) => {
        const error = data.toString();
        process.stderr.write(chalk.red(error));
        agentResponseBuffer += `ERROR: ${error}`;
      });
      
      // Handle agent exit
      agentProcess.on('close', (code) => {
        if (code !== 0) {
          console.log(chalk.red(`\nAgent process exited with code ${code}`));
          this.failStep('agent-interaction', `Agent process exited with code ${code}`);
        } else {
          console.log(chalk.gray('\nAgent process has ended.'));
          this.completeStep('agent-interaction');
        }
      });
      
      // Set up minimal user control
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });
      
      rl.on('line', (line) => {
        if (line.trim().toLowerCase() === 'exit' || line.trim().toLowerCase() === 'quit') {
          console.log(chalk.gray('\nExiting meta-agent operation. Shutting down agent process...'));
          agentProcess.kill();
          rl.close();
          process.exit(0);
        }
      });
      
      // Extend session lifetime to keep the process running
      process.stdin.resume();
      
    } catch (error) {
      this.failStep('agent-interaction', error instanceof Error ? error.message : String(error));
      console.warn(`Agent interaction failed: ${error instanceof Error ? error.message : String(error)}`);
      console.log(chalk.yellow('You can still start the agent manually using:'));
      console.log(chalk.yellow(`cd ${this.session.projectPath} && pnpm start --characters="characters/eliza.character.json"`));
    }
  }
  
  /**
   * Begin autonomous operation as the meta-agent
   * This method handles the continuous interaction with the agent
   */
  private async beginAutonomousOperation(agentProcess: ChildProcess, responseBuffer: string): Promise<void> {
    // Initial context information
    const pluginsInfo = this.session.installedPlugins?.join(', ') || 'Standard plugins';
    const strategyName = this.session.strategy?.name || 'Custom Trading Strategy'; 
    const tradingGoals = this.session.tradingGoals || 'Crypto trading and analysis';
    
    // Initial operation
    setTimeout(async () => {
      await this.performAgentOperation(agentProcess, responseBuffer, {
        operation: 'initialize',
        pluginsInfo,
        strategyName,
        tradingGoals
      });
    }, 2000);
  }
  
  /**
   * Perform a single agent operation cycle
   */
  private async performAgentOperation(
    agentProcess: ChildProcess, 
    responseBuffer: string, 
    context: {
      operation: string,
      pluginsInfo: string,
      strategyName: string,
      tradingGoals: string
    }
  ): Promise<void> {
    try {
      // Generate the next command based on context
      const basePrompt = 'You are acting as the primary operator of a crypto trading agent that has just been set up.\n\n';
      
      const contextInfo = 'CONTEXT:\n' +
        `- The agent uses these plugins: ${context.pluginsInfo}\n` +
        `- The agent implements a strategy called: ${context.strategyName}\n` +
        `- The trading goals are: ${context.tradingGoals}\n\n`;
      
      const recentOutput = responseBuffer ? 
        `RECENT AGENT OUTPUT:\n${responseBuffer.slice(-2000)}\n\n` : 
        '\n';
      
      const operationInfo = `CURRENT OPERATION: ${context.operation}\n\n`;
      
      const initializePrompt = 'As the first operation, introduce yourself to the agent and ask it about its ' +
        'capabilities related to the strategy and plugins. Ask it to describe what data it can provide for your strategy.';
      
      const continuePrompt = 'Based on the recent agent output, decide what operation to perform next that would ' +
        'showcase the agent\'s capabilities or extract useful information about markets or the strategy.';
      
      const operationDirective = context.operation === 'initialize' ? initializePrompt : continuePrompt;
      
      const finalInstructions = '\n\nRespond with ONLY the exact text to send to the agent. ' +
        'Do not include explanations, markdown, or any other text that shouldn\'t be sent directly to the agent.';
      
      // Combine all parts to create the full prompt
      const promptText = basePrompt + contextInfo + recentOutput + operationInfo + operationDirective + finalInstructions;
      
      // Get the next command from the LLM
      const response = await this.llmProvider.prompt(promptText, { maxTokens: 250 });
      const command = response.content.trim();
      
      // Display meta-agent action
      console.log(chalk.cyan('\n🧠 Meta-Agent Action: ') + chalk.white(command));
      
      // Send command to the agent
      if (agentProcess.stdin && agentProcess.stdin.writable) {
        agentProcess.stdin.write(command + '\n');
        
        // Schedule next operation after a delay
        setTimeout(() => {
          this.performAgentOperation(agentProcess, responseBuffer, {
            ...context,
            operation: 'continue' // Future operations are continuations
          });
        }, 20000); // 20 seconds between operations
      }
    } catch (error) {
      console.error(chalk.red(`Error during meta-agent operation: ${error instanceof Error ? error.message : String(error)}`));
      
      // Try again after a delay
      setTimeout(() => {
        this.performAgentOperation(agentProcess, responseBuffer, context);
      }, 30000);
    }
  }
  
  /**
   * Start a step
   */
  private startStep(stepId: string): void {
    const step = this.session.steps.find(s => s.id === stepId);
    if (step) {
      step.status = 'in-progress';
      step.startTime = new Date();
      this.session.currentStep = this.session.steps.indexOf(step);
      this.saveSession();
      
      console.log(chalk.cyan(`\n[${this.session.currentStep + 1}/${this.session.steps.length}] ${step.name}`));
      console.log(chalk.gray(step.description));
    }
  }
  
  /**
   * Complete a step
   */
  private completeStep(stepId: string): void {
    const step = this.session.steps.find(s => s.id === stepId);
    if (step) {
      step.status = 'completed';
      step.endTime = new Date();
      this.saveSession();
    }
  }
  
  /**
   * Skip a step
   */
  private skipStep(stepId: string): void {
    const step = this.session.steps.find(s => s.id === stepId);
    if (step) {
      step.status = 'skipped';
      step.endTime = new Date();
      this.saveSession();
      
      console.log(chalk.gray(`Skipping ${step.name}...`));
    }
  }
  
  /**
   * Fail a step
   */
  private failStep(stepId: string, error: string): void {
    const step = this.session.steps.find(s => s.id === stepId);
    if (step) {
      step.status = 'failed';
      step.endTime = new Date();
      step.error = error;
      this.saveSession();
    }
  }
  
  /**
   * Save the session to a file
   */
  private saveSession(): void {
    try {
      const sessionDir = path.join(this.session.projectPath, '.recall-cli');
      if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir, { recursive: true });
      }
      
      const sessionPath = path.join(sessionDir, 'setup-session.json');
      fs.writeFileSync(sessionPath, JSON.stringify(this.session, null, 2));
    } catch (error) {
      console.warn(`Failed to save session: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
} 