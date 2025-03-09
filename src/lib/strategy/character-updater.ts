import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { McpClient } from '../mcp/client.js';

export interface TradingStrategy {
  name: string;
  type: string;
  assets: string[];
  timeframes: string[];
  riskProfile: string;
  indicators: string[];
  description?: string;
}

/**
 * Update the character file with trading strategy expertise
 */
export async function updateCharacterWithStrategy(
  projectPath: string,
  strategy: any,
  _mcpClient: McpClient
): Promise<boolean> {
  try {
    console.log(chalk.blue('🧠 Updating character with trading expertise...'));
    
    // 1. Construct file path for the character file
    const characterPath = path.join(projectPath, 'characters', 'eliza.character.json');
    console.log(chalk.gray(`Reading character file from ${characterPath}`));
    
    // 2. Read the character file using direct file access
    let characterData;
    try {
      const fileContent = fs.readFileSync(characterPath, 'utf8');
      characterData = JSON.parse(fileContent);
      console.log(chalk.gray('Successfully read character file'));
    } catch (error) {
      console.error(chalk.red(`Error reading character file: ${error instanceof Error ? error.message : String(error)}`));
      return false;
    }
    
    // 3. Generate the updated character data with trading expertise
    const updatedCharacterData = enhanceCharacterData(characterData, strategy);
    
    // 4. Write the updated character file using direct file access
    try {
      fs.writeFileSync(characterPath, JSON.stringify(updatedCharacterData, null, 2));
    } catch (error) {
      console.error(chalk.red(`Error writing character file: ${error instanceof Error ? error.message : String(error)}`));
      return false;
    }
    
    console.log(chalk.green('✅ Character successfully updated with trading expertise'));
    
    // Print a summary of the changes made
    logUpdates(characterData, updatedCharacterData);
    
    return true;
  } catch (error) {
    console.error(chalk.red(`Error updating character with strategy: ${error instanceof Error ? error.message : String(error)}`));
    return false;
  }
}

/**
 * Enhance the character data with trading expertise
 */
function enhanceCharacterData(characterData: any, strategy: any): any {
  // Create a deep copy of the character data to avoid modifying the original
  const updatedCharacter = JSON.parse(JSON.stringify(characterData));
  
  // Add trading-related topics if they don't exist
  if (!updatedCharacter.topics) {
    updatedCharacter.topics = [];
  }
  
  const tradingTopics = ['Trading', 'Cryptocurrency', 'Technical Analysis'];
  
  for (const topic of tradingTopics) {
    if (!updatedCharacter.topics.includes(topic)) {
      updatedCharacter.topics.push(topic);
    }
  }
  
  // Add trading capabilities to the system prompt
  if (updatedCharacter.system) {
    const tradingCapability = 'I can analyze cryptocurrency markets and provide trading signals based on technical indicators like ' + strategy.indicators.join(', ') + '.';
    
    if (!updatedCharacter.system.includes('trading signals')) {
      updatedCharacter.system += ' ' + tradingCapability;
    }
  }
  
  // Add trading knowledge to bio if it exists
  if (Array.isArray(updatedCharacter.bio)) {
    const tradingBio = 'I have experience with cryptocurrency trading strategies using technical analysis.';
    
    // Check if bio already contains trading-related text
    let hasTradingBio = false;
    for (const bio of updatedCharacter.bio) {
      if (typeof bio === 'string' && (bio.includes('trading') || bio.includes('cryptocurrency'))) {
        hasTradingBio = true;
        break;
      }
    }
    
    if (!hasTradingBio) {
      updatedCharacter.bio.push(tradingBio);
    }
  }
  
  return updatedCharacter;
}

/**
 * Log the updates made to the character
 */
function logUpdates(original: any, updated: any): void {
  console.log(chalk.gray('Updates made to character:'));
  
  // Check for added topics
  if (updated.topics && original.topics) {
    const newTopics = updated.topics.filter((topic: string) => !original.topics.includes(topic));
    if (newTopics.length > 0) {
      console.log(chalk.gray('- Added trading-related topics: ' + newTopics.join(', ')));
    }
  }
  
  // Check for system prompt changes
  if (original.system !== updated.system) {
    console.log(chalk.gray('- Enhanced system prompt with trading capabilities'));
  }
  
  // Check for bio changes
  if (updated.bio && original.bio && updated.bio.length > original.bio.length) {
    console.log(chalk.gray('- Added trading experience to bio'));
  }
} 