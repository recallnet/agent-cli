import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

import { LlmProvider } from '../llm/provider.js';
import { McpClient } from '../mcp/client.js';
import { PluginRegistry } from '../plugins/registry.js';
import { buildStrategyInteractively } from '../strategy/interactive-builder.js';
import { generateCharacter, CharacterConfig, saveCharacter } from './character.js';
import { DocResponse } from '../mcp/server.js';

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
  competitionUrl?: string;
  competitionInfo?: any;
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
  private spinner: ora.Ora;
  
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
          id: 'environment-configuration',
          name: 'Environment Configuration',
          description: 'Setting up environment variables',
          status: 'pending'
        },
        {
          id: 'agent-finalization',
          name: 'Agent Finalization',
          description: 'Finalizing your trading agent',
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
      
      // Step 6: Strategy Creation
      await this.createStrategy();
      
      // Step 7: Character Creation
      await this.createCharacter();
      
      // Step 8: Environment Configuration
      await this.configureEnvironment();
      
      // Step 9: Agent Finalization
      await this.finalizeAgent();
      
      // Set status to completed
      this.session.status = 'completed';
      this.saveSession();
      
      return this.session;
    } catch (error) {
      this.session.status = 'failed';
      this.saveSession();
      throw error;
    }
  }
  
  /**
   * Step 1: Validate project structure and environment
   */
  private async validateProject(): Promise<void> {
    this.startStep('project-validation');
    
    try {
      // Check for package.json
      const packageJsonPath = path.join(this.session.projectPath, 'package.json');
      if (!fs.existsSync(packageJsonPath)) {
        throw new Error('Invalid project: package.json not found. Make sure you are in a valid project directory.');
      }
      
      // Check for Node.js and npm/pnpm
      try {
        execSync('node --version', { stdio: 'ignore' });
        // Try pnpm first, fall back to npm
        try {
          execSync('pnpm --version', { stdio: 'ignore' });
        } catch (error) {
          execSync('npm --version', { stdio: 'ignore' });
        }
      } catch (error) {
        throw new Error('Required tools not found. Please make sure Node.js and npm/pnpm are installed.');
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
      
      // Prompt for trading goals
      const { tradingGoals } = await inquirer.prompt([
        {
          type: 'editor',
          name: 'tradingGoals',
          message: 'Please describe your trading goals and strategy preferences:',
          default: 
`Here you can describe:
- What assets you want to trade (e.g., BTC, ETH, or specific tokens)
- Your preferred timeframes (e.g., 1h, 4h, daily)
- Risk tolerance (e.g., conservative, moderate, aggressive)
- Any specific indicators or strategies you're interested in
- Any other preferences or constraints`,
        }
      ]);
      
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
      
      // Get confirmation
      const { confirmed } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirmed',
          message: 'Does this analysis accurately reflect your trading goals?',
          default: true
        }
      ]);
      
      if (!confirmed) {
        console.log(chalk.yellow('\nLet\'s refine your trading goals.'));
        return await this.understandTradingGoals();
      }
      
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
      
      const pluginRecommendations = await this.llmProvider.recommendPluginsForStrategy(strategyDescription);
      
      this.spinner.succeed(`Found ${pluginRecommendations.length} recommended plugins`);
      
      // Display the recommendations
      console.log(chalk.cyan('\n🔌 Recommended Plugins:\n'));
      
      const pluginChoices = pluginRecommendations.map(plugin => ({
        name: `${plugin.name} (${Math.round(plugin.confidence * 100)}% confidence) - ${plugin.reasoning.substring(0, 100)}...`,
        value: plugin.name,
        short: plugin.name,
        confidence: plugin.confidence
      }));
      
      // Always ensure basic plugins are available
      const essentialPlugins = ['crypto-market-data', 'trading-signals', 'risk-management'];
      
      for (const plugin of essentialPlugins) {
        if (!pluginChoices.some(p => p.value === plugin)) {
          pluginChoices.push({
            name: `${plugin} (Essential plugin)`,
            value: plugin,
            short: plugin,
            confidence: 1
          });
        }
      }
      
      // Sort by confidence
      pluginChoices.sort((a, b) => b.confidence - a.confidence);
      
      // Display and select plugins
      const { selectedPlugins } = await inquirer.prompt([
        {
          type: 'checkbox',
          name: 'selectedPlugins',
          message: 'Select plugins to install:',
          choices: pluginChoices,
          default: pluginChoices
            .filter(p => p.confidence > 0.7 || essentialPlugins.includes(p.value))
            .map(p => p.value),
          pageSize: 10
        }
      ]);
      
      // Store selected plugins
      this.session.selectedPlugins = selectedPlugins;
      this.saveSession();
      
      this.completeStep('plugin-recommendation');
    } catch (error) {
      this.failStep('plugin-recommendation', error instanceof Error ? error.message : String(error));
      console.warn(`Plugin recommendation failed: ${error instanceof Error ? error.message : String(error)}`);
      console.log(chalk.yellow('Using default plugins instead...'));
      
      // Use default plugins if recommendation fails
      this.session.selectedPlugins = ['crypto-market-data', 'trading-signals', 'risk-management'];
      this.saveSession();
    }
  }
  
  /**
   * Step 5: Install selected plugins
   */
  private async installPlugins(): Promise<void> {
    this.startStep('plugin-installation');
    
    try {
      if (!this.session.selectedPlugins || this.session.selectedPlugins.length === 0) {
        this.skipStep('plugin-installation');
        return;
      }
      
      console.log(chalk.cyan('\n📦 Installing Plugins\n'));
      
      for (const plugin of this.session.selectedPlugins) {
        try {
          this.spinner.start(`Installing ${chalk.cyan(plugin)}...`);
          
          // Get plugin info
          const pluginInfo = await this.pluginRegistry.getPlugin(plugin);
          
          if (!pluginInfo) {
            this.spinner.warn(`Plugin ${chalk.yellow(plugin)} not found in registry. Skipping.`);
            continue;
          }
          
          // Install the plugin
          await this.pluginRegistry.installPlugin(plugin);
          
          this.spinner.succeed(`Installed ${chalk.green(plugin)}`);
          
          // Add to installed plugins
          this.session.installedPlugins.push(plugin);
          
          // Check for required environment variables
          if (pluginInfo.requiredEnv && pluginInfo.requiredEnv.length > 0) {
            console.log(chalk.yellow(`\nPlugin ${plugin} requires the following environment variables:`));
            
            for (const env of pluginInfo.requiredEnv) {
              console.log(chalk.yellow(`  - ${env}`));
              
              // Store for later environment configuration
              if (!this.session.requiredEnvironmentVars) {
                this.session.requiredEnvironmentVars = {};
              }
              
              if (!this.session.requiredEnvironmentVars[plugin]) {
                this.session.requiredEnvironmentVars[plugin] = [];
              }
              
              this.session.requiredEnvironmentVars[plugin].push(env);
            }
            
            console.log(''); // Add a blank line
          }
        } catch (error) {
          this.spinner.fail(`Failed to install ${chalk.red(plugin)}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      
      this.saveSession();
      this.completeStep('plugin-installation');
    } catch (error) {
      this.failStep('plugin-installation', error instanceof Error ? error.message : String(error));
      console.warn(`Plugin installation failed: ${error instanceof Error ? error.message : String(error)}`);
      console.log(chalk.yellow('Continuing without installing plugins...'));
    }
  }
  
  /**
   * Step 6: Create trading strategy
   */
  private async createStrategy(): Promise<void> {
    this.startStep('strategy-creation');
    
    try {
      console.log(chalk.cyan('\n📈 Building Your Trading Strategy\n'));
      
      // Collect information for the strategy builder
      const builderOptions = {
        outputFormat: 'standard' as const,
        interactive: true,
        targetPlugins: this.session.installedPlugins || []
      };
      
      // Launch the interactive strategy builder
      console.log(chalk.gray('Starting the interactive strategy builder...\n'));
      
      const result = await buildStrategyInteractively(builderOptions);
      
      // Store the strategy
      this.session.strategy = result.strategy;
      this.session.strategyImplementation = result.implementation;
      
      // Save the session
      this.saveSession();
      
      this.completeStep('strategy-creation');
    } catch (error) {
      this.failStep('strategy-creation', error instanceof Error ? error.message : String(error));
      throw error;
    }
  }
  
  /**
   * Step 7: Create agent character
   */
  private async createCharacter(): Promise<void> {
    this.startStep('character-creation');
    
    try {
      console.log(chalk.cyan('\n👤 Creating Your Agent Character\n'));
      
      // Base character on strategy
      const strategyInfo = this.session.strategy ? 
        `Strategy: ${this.session.strategy.name}\nDescription: ${this.session.strategy.description}` :
        'A trading strategy agent';
      
      // Create a character generation context
      const context = `
Trading Goals: ${this.session.tradingGoals || 'Not specified'}

${strategyInfo}

Installed Plugins: ${this.session.installedPlugins?.join(', ') || 'None'}
`;
      
      this.spinner.start('Generating character suggestion...');
      
      // Generate character
      const character = await generateCharacter(context, this.llmProvider);
      
      this.spinner.succeed('Character generated');
      
      // Customize the character if desired
      console.log(chalk.cyan('\nSuggested Character:\n'));
      console.log(chalk.white(`Name: ${character.name}`));
      console.log(chalk.white(`Role: ${character.role}`));
      console.log(chalk.white(`Description: ${character.description}`));
      console.log(chalk.white(`Persona: ${character.persona}`));
      
      // Allow for editing
      const { customize } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'customize',
          message: 'Would you like to customize this character?',
          default: false
        }
      ]);
      
      if (customize) {
        const { name, role, description, persona } = await inquirer.prompt([
          {
            type: 'input',
            name: 'name',
            message: 'Character name:',
            default: character.name
          },
          {
            type: 'input',
            name: 'role',
            message: 'Character role:',
            default: character.role
          },
          {
            type: 'input',
            name: 'description',
            message: 'Character description:',
            default: character.description
          },
          {
            type: 'editor',
            name: 'persona',
            message: 'Character persona:',
            default: character.persona
          }
        ]);
        
        character.name = name;
        character.role = role;
        character.description = description;
        character.persona = persona;
      }
      
      // Add installed plugins
      character.plugins = this.session.installedPlugins || [];
      
      // Store the character
      this.session.character = character;
      
      // Save the character
      const characterPath = path.join(this.session.projectPath, 'characters');
      if (!fs.existsSync(characterPath)) {
        fs.mkdirSync(characterPath, { recursive: true });
      }
      
      const safeName = character.name.toLowerCase().replace(/[^a-z0-9]/g, '-');
      const characterFile = path.join(characterPath, `${safeName}.json`);
      
      await saveCharacter(character, characterFile);
      
      console.log(chalk.green(`\nCharacter saved to ${characterFile}`));
      
      // Save the session
      this.saveSession();
      
      this.completeStep('character-creation');
    } catch (error) {
      this.failStep('character-creation', error instanceof Error ? error.message : String(error));
      throw error;
    }
  }
  
  /**
   * Step 8: Configure environment variables
   */
  private async configureEnvironment(): Promise<void> {
    this.startStep('environment-configuration');
    
    try {
      console.log(chalk.cyan('\n🔧 Environment Configuration\n'));
      
      // Check for required environment variables
      if (!this.session.requiredEnvironmentVars || Object.keys(this.session.requiredEnvironmentVars).length === 0) {
        console.log(chalk.gray('No required environment variables identified.'));
        this.skipStep('environment-configuration');
        return;
      }
      
      console.log(chalk.white('The following environment variables are required for your plugins:'));
      
      const envVars: Record<string, string> = {};
      
      // Collect all required environment variables
      for (const [plugin, vars] of Object.entries(this.session.requiredEnvironmentVars)) {
        console.log(chalk.cyan(`\n${plugin}:`));
        
        for (const env of vars) {
          console.log(chalk.white(`  - ${env}`));
          
          // Ask for value
          const { value } = await inquirer.prompt([
            {
              type: 'input',
              name: 'value',
              message: `Enter value for ${env}:`,
              validate: (input) => input.trim().length > 0 ? true : 'This value is required'
            }
          ]);
          
          envVars[env] = value;
        }
      }
      
      // Save to .env file
      const envPath = path.join(this.session.projectPath, '.env');
      let envContent = '';
      
      // Read existing .env if it exists
      if (fs.existsSync(envPath)) {
        envContent = fs.readFileSync(envPath, 'utf8');
      }
      
      // Add new variables
      for (const [key, value] of Object.entries(envVars)) {
        const envLine = `${key}=${value}`;
        
        // Check if already exists
        const regex = new RegExp(`^${key}=.*$`, 'm');
        if (regex.test(envContent)) {
          // Replace existing line
          envContent = envContent.replace(regex, envLine);
        } else {
          // Add new line
          envContent += `\n${envLine}`;
        }
      }
      
      // Write to .env file
      fs.writeFileSync(envPath, envContent.trim() + '\n');
      
      console.log(chalk.green('\nEnvironment variables saved to .env file'));
      
      // Store in session
      this.session.environment = envVars;
      this.saveSession();
      
      this.completeStep('environment-configuration');
    } catch (error) {
      this.failStep('environment-configuration', error instanceof Error ? error.message : String(error));
      console.warn(`Environment configuration failed: ${error instanceof Error ? error.message : String(error)}`);
      console.log(chalk.yellow('Continuing without environment configuration...'));
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