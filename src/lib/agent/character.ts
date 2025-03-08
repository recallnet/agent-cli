import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { LlmProviderFactory } from '../llm/provider.js';

/**
 * Character file interface for Eliza agents
 */
export interface Character {
  name: string;
  description: string;
  instructions: string;
  characteristics: string[];
  rules: string[];
  goals: string[];
  clients: string[];
  plugins: string[];
  // Competition information if applicable
  competition?: {
    name?: string;
    rules?: string[];
    metrics?: Record<string, string>;
  };
  // Allow any additional fields
  [key: string]: any;
}

/**
 * Character configuration for agent setup
 */
export interface CharacterConfig {
  name: string;
  role: string;
  description: string;
  persona: string;
  plugins: string[];
}

/**
 * Generate a character file for a crypto trading agent
 */
export async function generateCharacter(options: {
  name: string;
  strategy: string;
  plugins: string[];
  useAI?: boolean;
  competitionBased?: boolean;
}): Promise<Character> {
  // Generate a basic character
  const character: Character = {
    name: options.name,
    description: `A crypto trading agent that specializes in the ${options.strategy} strategy`,
    instructions: `You are ${options.name}, a crypto trading bot that uses the ${options.strategy} strategy to identify high-value trading opportunities.`,
    characteristics: [
      'Analytical and data-driven',
      'Risk-aware and cautious',
      'Decisive when opportunities arise',
      'Always monitors market conditions'
    ],
    rules: [
      'Always analyze risk before suggesting a trade',
      'Provide clear rationale for all trading decisions',
      'Monitor positions and suggest adjustments when needed',
      'Keep emotions out of trading decisions'
    ],
    goals: [
      'Generate consistent positive returns',
      'Minimize drawdowns and manage risk',
      'Identify high-probability trading opportunities',
      'Continuously improve strategy performance'
    ],
    clients: [],
    plugins: options.plugins
  };

  // If using AI and not competition-based, enhance with AI
  if (options.useAI && !options.competitionBased) {
    try {
      const provider = LlmProviderFactory.createFromConfig();
      if (provider) {
        console.log(chalk.cyan('Enhancing character with AI...'));
        
        const prompt = `
You are an expert in creating personas for crypto trading bots. Create an enhanced character file for a bot with the following information:

Name: ${options.name}
Strategy: ${options.strategy}
Plugins: ${options.plugins.join(', ')}

I need:
1. A more detailed description (1-2 sentences)
2. Specialized instructions that fit this trading strategy (2-3 sentences)
3. Five distinctive characteristics that make this bot unique
4. Five specific rules the bot should follow when making trading decisions
5. Five clear goals the bot should aim to achieve

Be specific to the strategy type and make it sound like a professional trading system. Format as JSON.`;

        const response = await provider.prompt(prompt);
        
        try {
          // Extract JSON from the response (find the first { and last })
          const jsonStart = response.content.indexOf('{');
          const jsonEnd = response.content.lastIndexOf('}') + 1;
          
          if (jsonStart >= 0 && jsonEnd > jsonStart) {
            const jsonString = response.content.substring(jsonStart, jsonEnd);
            const enhancedCharacter = JSON.parse(jsonString);
            
            // Merge with existing character (if valid properties are present)
            if (enhancedCharacter.description) {
              character.description = enhancedCharacter.description;
            }
            
            if (enhancedCharacter.instructions) {
              character.instructions = enhancedCharacter.instructions;
            }
            
            if (enhancedCharacter.characteristics && Array.isArray(enhancedCharacter.characteristics) && enhancedCharacter.characteristics.length > 0) {
              character.characteristics = enhancedCharacter.characteristics.slice(0, 5);
            }
            
            if (enhancedCharacter.rules && Array.isArray(enhancedCharacter.rules) && enhancedCharacter.rules.length > 0) {
              character.rules = enhancedCharacter.rules.slice(0, 5);
            }
            
            if (enhancedCharacter.goals && Array.isArray(enhancedCharacter.goals) && enhancedCharacter.goals.length > 0) {
              character.goals = enhancedCharacter.goals.slice(0, 5);
            }
          }
        } catch (error) {
          console.warn(`Failed to parse enhanced character: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    } catch (error) {
      console.warn(`Failed to enhance character with AI: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Add competition-specific content if needed
  if (options.competitionBased) {
    character.competition = {
      name: 'Crypto Trading Competition',
      rules: [
        'Follow all competition guidelines',
        'Submit signals within the required timeframe',
        'Trade only the allowed pairs'
      ],
      metrics: {
        'Total Return': 'Primary performance metric',
        'Sharpe Ratio': 'Risk-adjusted return metric',
        'Max Drawdown': 'Risk metric to minimize',
        'Win Rate': 'Percentage of profitable trades'
      }
    };
  }

  return character;
}

/**
 * Generate a character based on context from the interactive setup
 * @param context Context information from the interactive setup
 * @param llmProvider LLM provider for generating the character
 * @returns Character configuration
 */
export async function generateCharacterForSetup(context: string, llmProvider?: any): Promise<CharacterConfig> {
  // Use provided LLM provider or create a new one
  const provider = llmProvider || LlmProviderFactory.createFromConfig();
  
  if (!provider) {
    throw new Error('Failed to create LLM provider. Please configure your LLM provider first.');
  }
  
  const prompt = `
Generate a trading agent character based on the following context:

${context}

Create a detailed persona for this trading agent that includes:
1. A distinctive name that reflects the agent's purpose
2. A clear role description (e.g., "Technical Analysis Specialist")
3. A concise but informative description (2-3 sentences)
4. A detailed persona description (3-5 paragraphs) that explains the agent's background, expertise, methodology, and philosophy toward trading

The character should be engaging, distinctive, and aligned with the trading goals and strategy described.

Format your response as JSON:
{
  "name": "Character Name",
  "role": "Character Role",
  "description": "Brief description of the character",
  "persona": "Detailed persona description in multiple paragraphs"
}
`;

  try {
    const response = await provider.prompt(prompt);
    
    // Extract JSON from response
    const jsonStart = response.content.indexOf('{');
    const jsonEnd = response.content.lastIndexOf('}') + 1;
    
    if (jsonStart >= 0 && jsonEnd > jsonStart) {
      const jsonString = response.content.substring(jsonStart, jsonEnd);
      const character = JSON.parse(jsonString);
      
      // Add empty plugins array (will be populated later)
      character.plugins = [];
      
      return character;
    } else {
      throw new Error('Failed to parse character from LLM response');
    }
  } catch (error) {
    console.warn(`Failed to generate character: ${error instanceof Error ? error.message : String(error)}`);
    
    // Return default character
    return {
      name: 'TradingBot Alpha',
      role: 'Crypto Trading Specialist',
      description: 'An advanced trading agent specialized in crypto markets analysis and signal generation.',
      persona: 'TradingBot Alpha is a meticulous and data-driven trading agent with expertise in technical analysis and market psychology. It prioritizes risk management while seeking optimal entry and exit points. The agent continuously analyzes market conditions across multiple timeframes to identify high-probability trading opportunities while maintaining a disciplined approach to capital preservation.',
      plugins: []
    };
  }
}

/**
 * Save generated character to a file
 */
export function saveCharacter(character: Character, projectPath: string): string {
  try {
    const projectRoot = path.resolve(projectPath);
    const charactersDir = path.join(projectRoot, 'characters');
    
    // Create characters directory if it doesn't exist
    if (!fs.existsSync(charactersDir)) {
      fs.mkdirSync(charactersDir, { recursive: true });
    }
    
    // Create a safe filename from character name
    const safeName = character.name.toLowerCase().replace(/[^a-z0-9]/g, '-');
    const filename = path.join(charactersDir, `${safeName}.json`);
    
    // Save character file
    fs.writeFileSync(filename, JSON.stringify(character, null, 2));
    
    return filename;
  } catch (error) {
    throw new Error(`Failed to save character file: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Save character config to a file
 * @param character Character configuration
 * @param filePath Path to save the character file
 * @returns Path to the saved file
 */
export async function saveCharacterConfig(character: CharacterConfig, filePath: string): Promise<string> {
  fs.writeFileSync(filePath, JSON.stringify(character, null, 2));
  return filePath;
} 