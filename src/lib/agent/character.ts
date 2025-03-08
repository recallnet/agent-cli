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
      'Monitor market conditions continuously',
      'Log all trading signals with confidence levels',
      'Report potential issues or anomalies'
    ],
    goals: [
      'Identify profitable trading opportunities',
      'Minimize risk while maximizing returns',
      'Adapt to changing market conditions',
      'Continuously improve trading strategy'
    ],
    clients: ['direct'],
    plugins: options.plugins
  };
  
  // If competition-based, add competition info
  if (options.competitionBased) {
    character.description = `A crypto trading agent optimized for competition performance, using the ${options.strategy} strategy`;
    character.competition = {
      name: 'Trading Competition',
      rules: [
        'Adhere to competition rules and guidelines',
        'Optimize for the competition\'s scoring metrics',
        'Stay within allowed position sizes and leverage limits',
        'Respect trading frequency limitations'
      ],
      metrics: {
        'totalReturn': 'Primary metric',
        'sharpeRatio': 'Secondary metric',
        'maxDrawdown': 'Risk control metric'
      }
    };
    
    // Add competition-specific goals and rules
    character.goals.push('Maximize performance according to competition metrics');
    character.goals.push('Outperform other competitors');
    character.rules.push('Never exceed competition position size limits');
    character.rules.push('Maintain trading frequency within competition guidelines');
  }
  
  // If useAI is true, enhance the character using LLM
  if (options.useAI) {
    const provider = LlmProviderFactory.createFromConfig();
    
    if (provider) {
      console.log(chalk.yellow('Using AI to enhance character...'));
      
      const prompt = `Create a character profile for a crypto trading agent with the following details:
- Name: ${options.name}
- Trading strategy: ${options.strategy}
- Using plugins: ${options.plugins.join(', ')}
${options.competitionBased ? '- Optimized for a trading competition' : ''}

Enhance the following with more specific and detailed content related to crypto trading:
- Instructions (what the agent does)
- Characteristics (personality traits)
- Rules (constraints to follow)
- Goals (objectives to achieve)
${options.competitionBased ? '- Competition-specific rules and performance metrics' : ''}

Your response should be in JSON format, matching this structure:
{
  "instructions": "detailed instructions",
  "characteristics": ["trait1", "trait2", "trait3", "trait4"],
  "rules": ["rule1", "rule2", "rule3", "rule4"],
  "goals": ["goal1", "goal2", "goal3", "goal4"]${options.competitionBased ? ',\n  "competition": {\n    "rules": ["comp-rule1", "comp-rule2"],\n    "metrics": {\n      "metric1": "description1",\n      "metric2": "description2"\n    }\n  }' : ''}
}`;
      
      try {
        const response = await provider.prompt(prompt, { temperature: 0.7 });
        const enhancedCharacter = JSON.parse(response.content);
        
        // Update character with AI enhancements
        character.instructions = enhancedCharacter.instructions || character.instructions;
        character.characteristics = enhancedCharacter.characteristics || character.characteristics;
        character.rules = enhancedCharacter.rules || character.rules;
        character.goals = enhancedCharacter.goals || character.goals;
        
        // Update competition information if available
        if (options.competitionBased && enhancedCharacter.competition) {
          character.competition = {
            ...character.competition,
            ...enhancedCharacter.competition,
            rules: enhancedCharacter.competition.rules || character.competition?.rules,
            metrics: enhancedCharacter.competition.metrics || character.competition?.metrics
          };
        }
      } catch (error) {
        console.log(chalk.yellow(`AI enhancement failed: ${error instanceof Error ? error.message : String(error)}. Using default character.`));
      }
    } else {
      console.log(chalk.yellow('No LLM provider configured. Using default character.'));
    }
  }
  
  return character;
}

/**
 * Save a character to a file
 */
export function saveCharacter(character: Character, projectPath: string): string {
  // Create the characters directory if it doesn't exist
  const charactersDir = path.join(projectPath, 'characters');
  if (!fs.existsSync(charactersDir)) {
    fs.mkdirSync(charactersDir, { recursive: true });
  }
  
  // Generate a safe filename
  const safeName = character.name.toLowerCase().replace(/[^a-z0-9]/g, '-');
  const filename = path.join(charactersDir, `${safeName}.character.json`);
  
  // Write the character file
  fs.writeFileSync(filename, JSON.stringify(character, null, 2));
  
  return filename;
} 