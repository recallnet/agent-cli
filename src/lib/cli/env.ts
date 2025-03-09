import fs from 'fs';
import path from 'path';
import readline from 'readline';
import chalk from 'chalk';
import { LlmProvider } from '../llm/provider.js';
import { McpClient } from '../mcp/client.js';

// Custom interface for environment variables with descriptions
interface EnvVariable {
  key: string;
  description: string;
  required: boolean;
  default?: string;
  secret?: boolean; 
  source: string; // Where this variable came from (README, plugin name, etc.)
}

/**
 * Prompts the user for input with the given message
 */
function prompt(rl: readline.Interface, message: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(message, (answer) => {
      resolve(answer);
    });
  });
}

/**
 * Extract environment variables from README.md file
 */
async function extractEnvVarsFromReadme(
  projectPath: string,
  llmProvider: LlmProvider
): Promise<EnvVariable[]> {
  const readmePath = path.join(projectPath, 'README.md');
  
  if (!fs.existsSync(readmePath)) {
    console.log('No README.md file found in project directory.');
    return [];
  }
  
  console.log(`Reading README from ${readmePath}...`);
  const readmeContent = fs.readFileSync(readmePath, 'utf8');
  console.log(`README length: ${readmeContent.length} characters`);
  
  return await analyzeContentForEnvVars(readmeContent, llmProvider, 'README');
}

/**
 * Extract environment variables from plugin README files
 */
export async function extractEnvVarsFromPluginReadme(
  projectPath: string,
  pluginName: string, 
  llmProvider: LlmProvider
): Promise<EnvVariable[]> {
  // Normalize plugin name to find in node_modules
  // Handle both formats: @elizaos/plugin-name and plugin-name
  const normalizedName = pluginName.includes('/') ? pluginName : `@elizaos/${pluginName}`;
  
  // Construct path to the plugin's README file
  const pluginPath = path.join(projectPath, 'node_modules', normalizedName);
  const readmePath = path.join(pluginPath, 'README.md');
  
  // Also try lowercase readme.md as a fallback
  const lowercaseReadmePath = path.join(pluginPath, 'readme.md');
  
  let readmeExists = fs.existsSync(readmePath);
  let finalReadmePath = readmePath;
  
  if (!readmeExists) {
    readmeExists = fs.existsSync(lowercaseReadmePath);
    finalReadmePath = lowercaseReadmePath;
  }
  
  if (!readmeExists) {
    console.log(chalk.yellow(`No README.md file found for plugin ${pluginName} in ${pluginPath}`));
    return [];
  }
  
  console.log(chalk.gray(`Reading README from ${finalReadmePath}...`));
  const readmeContent = fs.readFileSync(finalReadmePath, 'utf8');
  console.log(chalk.gray(`Plugin README length: ${readmeContent.length} characters`));
  
  return await analyzeContentForEnvVars(readmeContent, llmProvider, pluginName);
}

/**
 * Analyze content (README or documentation) for environment variables
 */
export async function analyzeContentForEnvVars(
  content: string,
  llmProvider: LlmProvider,
  source: string
): Promise<EnvVariable[]> {
  // Use LLM to extract environment variables
  const prompt = `
You are an assistant helping to set up a project. Your task is to extract ALL environment variables mentioned in the documentation without any preconceptions about what should be there.

DOCUMENTATION CONTENT:
${content}

Analyze the documentation carefully and identify ALL environment variables that would go in a .env file. Look for:
- Variables mentioned in setup/installation instructions
- Variables in code examples, especially those related to configuration
- Any mention of API keys, tokens, secrets, or configuration parameters
- Sections that explicitly discuss environment variables or .env files
- Command-line examples that use environment variables
- Configuration tables that list environment variables

For each environment variable you find, extract:
1. The exact variable name 
2. A description of its purpose
3. Whether it's required or optional
4. Any default value mentioned
5. Whether it contains sensitive information

Pay special attention to:
- Configuration sections that might contain tables with env var names
- Code examples that show configuration with API keys or tokens
- Text that mentions "required environment variables" or similar phrases

Format your response as a valid JSON object with a "variables" array. Each item should have these properties:
- key: The environment variable name
- description: What the variable is for
- required: Boolean indicating if it's required
- default: Any default value mentioned (or null if none)
- secret: Boolean indicating if it contains sensitive data

Your response must be valid JSON with no comments or explanations outside the JSON.

If you find no environment variables, return: {"variables": []}`;

  console.log(chalk.gray('Analyzing documentation with LLM...'));
  
  try {
    const response = await llmProvider.prompt(prompt, {
      temperature: 0,
      maxTokens: 2000
    });
    
    // Log a snippet of the response to debug
    console.log(chalk.gray(`Response snippet: ${response.content.substring(0, 100)}...`));
    
    const parsedContent = response.content.trim();
    
    // Try to parse the LLM response
    try {
      // Fix common JSON parsing issues
      let fixedContent = parsedContent;
      if (!fixedContent.startsWith('{')) {
        const jsonStart = fixedContent.indexOf('{');
        if (jsonStart >= 0) {
          fixedContent = fixedContent.substring(jsonStart);
        }
      }
      
      // Remove any trailing commas in arrays or objects
      fixedContent = fixedContent.replace(/,\s*([\]}])/g, '$1');
      
      const parsed = JSON.parse(fixedContent);
      
      if (parsed && parsed.variables && Array.isArray(parsed.variables)) {
        const variables = parsed.variables.map((variable: any) => ({
          key: variable.key,
          description: variable.description || `Environment variable from ${source}`,
          required: variable.required === true,
          default: variable.default || undefined,
          secret: variable.secret === true,
          source: source
        }));
        
        if (variables.length > 0) {
          console.log(chalk.green(`✅ Successfully extracted ${variables.length} environment variables from ${source}`));
          variables.forEach((v: EnvVariable) => console.log(chalk.gray(`  - ${v.key}: ${v.description} (${v.required ? 'Required' : 'Optional'})`)));
        } else {
          console.log(chalk.yellow(`No environment variables found in ${source}`));
        }
        
        return variables;
      }
    } catch (error) {
      console.error(chalk.red(`Error parsing environment variables from ${source}: ${error}`));
    }
  } catch (error) {
    console.error(chalk.red(`Error analyzing ${source} for environment variables: ${error}`));
  }
  
  return [];
}

/**
 * Parse an .env file content into key-value pairs
 */
function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  
  // Split the content by lines and parse each line
  const lines = content.split('\n');
  
  for (const line of lines) {
    // Skip empty lines and comments
    if (!line.trim() || line.startsWith('#')) {
      continue;
    }
    
    // Look for key=value format
    const match = line.match(/^\s*([^=]+)\s*=\s*(.*)$/);
    if (match) {
      const [, key, value] = match;
      result[key.trim()] = value.trim();
    }
  }
  
  return result;
}

/**
 * Setup environment variables for the project
 */
export async function setupEnvironmentVariables(
  projectPath: string, 
  llmProvider: LlmProvider,
  mcpClient: McpClient,
  installedPlugins: string[] = []
): Promise<void> {
  console.log(`🔧 Setting up environment variables for your project in ${projectPath}...\n`);
  
  // Create readline interface for user input
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  try {
    // Placeholder for the updated environment variables
    let updatedEnv: Record<string, string> = {};
    
    // Load existing .env file if it exists
    const envPath = path.join(projectPath, '.env');
    if (fs.existsSync(envPath)) {
      // Read and parse the .env file
      const envContent = fs.readFileSync(envPath, 'utf-8');
      updatedEnv = parseEnvFile(envContent);
      console.log(`Found existing .env file with ${Object.keys(updatedEnv).length} variables`);
    }
    
    // STEP 1: Get environment variables from README
    console.log(chalk.blue('📄 STEP 1: Core Application Environment Variables'));
    console.log(chalk.gray('Analyzing project README for required environment variables...'));
    const readmeVars = await extractEnvVarsFromReadme(projectPath, llmProvider);
    
    if (readmeVars.length > 0) {
      console.log(chalk.green(`Found ${readmeVars.length} environment variables in the core application README\n`));
      
      console.log(chalk.yellow('Please configure the following core environment variables:'));
      
      // Process README variables
      for (const variable of readmeVars) {
        // Check if the variable is already set
        const existingValue = updatedEnv[variable.key];
        
        // Describe the variable
        console.log('\n' + chalk.cyan(`${variable.key}`) + chalk.gray(` (${variable.required ? 'Required' : 'Optional'})`));
        console.log(chalk.white(`  Description: ${variable.description}`));
        
        if (variable.default) {
          console.log(chalk.gray(`  Default: ${variable.default}`));
        }
        
        // Prompt for the value (showing the existing value if available)
        let message = existingValue 
          ? `  Current value: ${existingValue}\n  Enter new value or press Enter to keep current: ` 
          : `  Enter value${variable.default ? ' or press Enter to use default' : ''}: `;
        
        // For sensitive data, indicate it's sensitive
        if (variable.secret) {
          message += chalk.yellow(' (sensitive data)');
        }
        
        const input = await prompt(rl, message);
        
        // If the user entered a value, use it; otherwise check for existing/default values
        if (input.trim()) {
          updatedEnv[variable.key] = input.trim();
          console.log(chalk.green(`  ✓ Value set for ${variable.key}`));
        } else if (existingValue) {
          console.log(chalk.green(`  ✓ Kept existing value for ${variable.key}`));
        } else if (variable.default) {
          // Use default value if available and no input provided
          updatedEnv[variable.key] = variable.default;
          console.log(chalk.green(`  ✓ Using default value for ${variable.key}: ${variable.default}`));
        } else if (variable.required) {
          // Only prompt again if required AND no default is available
          console.log(chalk.yellow(`  ⚠️ Warning: No value provided for required variable ${variable.key}`));
          
          // Ask again
          console.log(chalk.red('  This variable is required. Please provide a value.'));
          const secondInput = await prompt(rl, '  Enter value: ');
          
          if (secondInput.trim()) {
            updatedEnv[variable.key] = secondInput.trim();
            console.log(chalk.green(`  ✓ Value set for ${variable.key}`));
          } else {
            console.log(chalk.yellow(`  ⚠️ Continuing without a value for ${variable.key}. You may need to set this later.`));
          }
        }
      }
    }
    
    // STEP 2: Process each plugin individually
    console.log(chalk.blue('\n📄 STEP 2: Plugin Environment Variables'));
    console.log(chalk.gray(`Found ${installedPlugins.length} plugins to analyze for environment variables`));
    
    // Track all plugin variables for reporting purposes
    const allPluginVars: EnvVariable[] = [];
    
    // Process each plugin one at a time
    for (const plugin of installedPlugins) {
      console.log(chalk.cyan(`\n🔌 Processing plugin: ${plugin}`));
      
      try {
        // Read directly from the plugin's README file instead of using MCP server
        const pluginVars = await extractEnvVarsFromPluginReadme(projectPath, plugin, llmProvider);
        
        // Add to overall tracking
        allPluginVars.push(...pluginVars);
        
        console.log(chalk.green(`✅ Found ${pluginVars.length} environment variables for ${plugin}`));
        
        // Process this plugin's variables if any were found
        if (pluginVars.length > 0) {
          console.log(chalk.yellow(`\nPlease configure the environment variables for ${plugin}:`));
          
          // Process plugin variables one by one
          for (const variable of pluginVars) {
            // Check if the variable is already set
            const existingValue = updatedEnv[variable.key];
            
            // Describe the variable
            console.log('\n' + chalk.cyan(`${variable.key}`) + chalk.gray(` (${variable.required ? 'Required' : 'Optional'})`));
            console.log(chalk.white(`  Description: ${variable.description}`));
            
            if (variable.default) {
              console.log(chalk.gray(`  Default: ${variable.default}`));
            }
            
            // Prompt for the value (showing the existing value if available)
            let message = existingValue 
              ? `  Current value: ${existingValue}\n  Enter new value or press Enter to keep current: ` 
              : `  Enter value${variable.default ? ' or press Enter to use default' : ''}: `;
            
            // For sensitive data, indicate it's sensitive
            if (variable.secret) {
              message += chalk.yellow(' (sensitive data)');
            }
            
            const input = await prompt(rl, message);
            
            // If the user entered a value, use it; otherwise check for existing/default values
            if (input.trim()) {
              updatedEnv[variable.key] = input.trim();
              console.log(chalk.green(`  ✓ Value set for ${variable.key}`));
            } else if (existingValue) {
              console.log(chalk.green(`  ✓ Kept existing value for ${variable.key}`));
            } else if (variable.default) {
              // Use default value if available and no input provided
              updatedEnv[variable.key] = variable.default;
              console.log(chalk.green(`  ✓ Using default value for ${variable.key}: ${variable.default}`));
            } else if (variable.required) {
              // Only prompt again if required AND no default is available
              console.log(chalk.yellow(`  ⚠️ Warning: No value provided for required variable ${variable.key}`));
              
              // Ask again
              console.log(chalk.red('  This variable is required. Please provide a value.'));
              const secondInput = await prompt(rl, '  Enter value: ');
              
              if (secondInput.trim()) {
                updatedEnv[variable.key] = secondInput.trim();
                console.log(chalk.green(`  ✓ Value set for ${variable.key}`));
              } else {
                console.log(chalk.yellow(`  ⚠️ Continuing without a value for ${variable.key}. You may need to set this later.`));
              }
            }
          }
        } else {
          console.log(chalk.yellow(`No environment variables found for ${plugin}`));
        }
      } catch (error) {
        console.error(chalk.red(`Error processing plugin ${plugin}: ${error instanceof Error ? error.message : String(error)}`));
      }
      
      // Save the environment file after each plugin to ensure progress isn't lost
      const envContent = Object.entries(updatedEnv)
        .map(([key, value]) => `${key}=${value}`)
        .join('\n');
      
      fs.writeFileSync(envPath, envContent);
      
      // Add a separator between plugins for readability
      console.log(chalk.gray('\n------------------------'));
      
      // Pause and prompt for continuation unless this is the last plugin
      if (installedPlugins.indexOf(plugin) < installedPlugins.length - 1) {
        const nextPlugin = installedPlugins[installedPlugins.indexOf(plugin) + 1];
        console.log(chalk.blue(`\nNext plugin to process: ${chalk.cyan(nextPlugin)}`));
        await prompt(rl, chalk.yellow('Press Enter to continue to the next plugin...'));
      }
    }
    
    // Final summary and save
    console.log(chalk.blue('\n📝 Environment Configuration Summary'));
    console.log(chalk.green(`✅ Processed ${installedPlugins.length} plugins`));
    console.log(chalk.green(`✅ Found ${allPluginVars.length} total plugin environment variables`));
    console.log(chalk.green(`✅ Final .env file has ${Object.keys(updatedEnv).length} variables`));
    
    // Final save (in case there were any unsaved changes)
    const finalEnvContent = Object.entries(updatedEnv)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');
    
    fs.writeFileSync(envPath, finalEnvContent);
    console.log(chalk.green(`✅ Environment variables saved to ${envPath}\n`));
    
    console.log(chalk.green('✅ Environment configuration complete!\n'));
  } catch (error) {
    console.error(chalk.red(`Error setting up environment variables: ${error instanceof Error ? error.message : String(error)}`));
  } finally {
    // Close the readline interface
    rl.close();
  }
}