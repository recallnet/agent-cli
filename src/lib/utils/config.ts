import fs from 'fs';
import path from 'path';
import inquirer from 'inquirer';
import chalk from 'chalk';
import Conf from 'conf';

// Create config store
const config = new Conf({
  projectName: 'recall-cli'
});

/**
 * Configure environment for the project
 */
export async function configureEnvironment(options: any): Promise<void> {
  // Check if .env file exists
  const envPath = path.join(process.cwd(), '.env');
  const envExamplePath = path.join(process.cwd(), '.env.example');
  
  if (!fs.existsSync(envExamplePath)) {
    throw new Error('.env.example file not found. Project initialization may have failed.');
  }
  
  // If .env doesn't exist or force option is used, create/update it
  if (!fs.existsSync(envPath) || options.force) {
    // Read .env.example
    const envExample = fs.readFileSync(envExamplePath, 'utf8');
    
    // Parse example variables to prompt for them
    const envVars = envExample
      .split('\n')
      .filter(line => line.includes('='))
      .map(line => {
        const [key, defaultValue] = line.split('=');
        return { key: key.trim(), defaultValue: defaultValue?.trim() || '' };
      });
    
    // Prompt for required variables
    const answers = await inquirer.prompt(
      envVars.map(({ key, defaultValue }) => ({
        type: key.includes('KEY') || key.includes('SECRET') ? 'password' : 'input',
        name: key,
        message: `Enter value for ${chalk.cyan(key)}:`,
        default: defaultValue || undefined,
        when: key !== 'OPENAI_API_KEY' && key !== 'ANTHROPIC_API_KEY' // These are handled separately
      }))
    );
    
    // Create .env file
    const envContent = envVars
      .map(({ key }) => `${key}=${answers[key] || ''}`)
      .join('\n');
    
    fs.writeFileSync(envPath, envContent);
    console.log(chalk.green('✓ Environment configuration created at .env'));
  } else {
    console.log(chalk.yellow('ℹ .env file already exists. Use --force to overwrite.'));
  }
  
  return Promise.resolve();
} 