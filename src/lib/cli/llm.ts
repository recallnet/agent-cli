import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import Conf from 'conf';
import { LlmProviderFactory } from '../llm/provider.js';

// Create config store
const config = new Conf({
  projectName: 'recall-cli',
  schema: {
    llm: {
      type: 'object',
      properties: {
        provider: { type: 'string' },
        apiKey: { type: 'string' }
      }
    }
  }
});

/**
 * Set LLM API key
 */
export async function setApiKey(provider: string | undefined, _options: any) {
  // If provider not provided, prompt for it
  if (!provider) {
    const { selectedProvider } = await inquirer.prompt([
      {
        type: 'list',
        name: 'selectedProvider',
        message: 'Select LLM provider:',
        choices: [
          { name: 'OpenAI', value: 'openai' },
          { name: 'Anthropic', value: 'anthropic' }
        ]
      }
    ]);
    provider = selectedProvider;
  }
  
  // Prompt for API key
  const { apiKey } = await inquirer.prompt([
    {
      type: 'password',
      name: 'apiKey',
      message: `Enter your ${provider} API key:`,
      validate: (input) => input.length > 0 ? true : 'API key is required'
    }
  ]);
  
  // Validate API key
  const spinner = ora(`Validating ${provider} API key`).start();
  
  try {
    // Create a provider to validate the key
    const llmProvider = LlmProviderFactory.createProvider(provider as string, apiKey);
    const isValid = await llmProvider.validateApiKey();
    
    if (!isValid) {
      spinner.fail(`Invalid API key for ${provider}`);
      return;
    }
    
    // Save API key securely
    config.set('llm.provider', provider);
    config.set('llm.apiKey', apiKey);
    
    spinner.succeed(`Successfully set ${chalk.green(provider)} API key`);
  } catch (error) {
    spinner.fail(`Failed to validate API key: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Test LLM connection
 */
export async function testLlm(_options: any) {
  const provider = config.get('llm.provider') as string;
  const apiKey = config.get('llm.apiKey') as string;
  
  if (!provider || !apiKey) {
    console.log(chalk.red('No LLM provider configured. Please run:'));
    console.log('  recall-cli llm set-key');
    return;
  }
  
  const spinner = ora(`Testing connection to ${provider}`).start();
  
  try {
    // Create a provider
    const llmProvider = LlmProviderFactory.createProvider(provider, apiKey);
    
    // Send a simple test prompt
    const response = await llmProvider.prompt('Hello, can you respond with a short greeting?', {
      temperature: 0.5,
    });
    
    spinner.succeed(`Successfully connected to ${chalk.green(provider)}`);
    console.log(`Response: ${chalk.cyan(response.content)}`);
    
    if (response.tokenUsage) {
      console.log(`Token usage: ${chalk.yellow(response.tokenUsage.total)} total tokens`);
    }
    
  } catch (error) {
    spinner.fail(`Failed to connect to LLM: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Generate sample code using the LLM
 */
export async function generateCode(description: string, options: any) {
  const provider = config.get('llm.provider') as string;
  const apiKey = config.get('llm.apiKey') as string;
  
  if (!provider || !apiKey) {
    console.log(chalk.red('No LLM provider configured. Please run:'));
    console.log('  recall-cli llm set-key');
    return;
  }
  
  const language = options.language || 'typescript';
  const spinner = ora(`Generating ${language} code using ${provider}`).start();
  
  try {
    // Create a provider
    const llmProvider = LlmProviderFactory.createProvider(provider, apiKey);
    
    // Generate code
    const response = await llmProvider.generateCode(description, language);
    
    spinner.succeed(`Successfully generated ${chalk.green(language)} code`);
    console.log(`\n${chalk.cyan(response.content)}\n`);
    
    if (response.tokenUsage) {
      console.log(`Token usage: ${chalk.yellow(response.tokenUsage.total)} total tokens`);
    }
    
  } catch (error) {
    spinner.fail(`Failed to generate code: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Register the LLM command with the CLI
 */
export function llmCommand(program: Command) {
  const llm = program
    .command('llm')
    .description('Manage LLM provider integration');
    
  llm
    .command('set-key')
    .description('Set LLM provider API key')
    .argument('[provider]', 'LLM provider (openai, anthropic)')
    .option('-f, --force', 'Force overwrite existing key', false)
    .action(setApiKey);
    
  llm
    .command('test')
    .description('Test LLM connection')
    .action(testLlm);
    
  llm
    .command('generate-code')
    .description('Generate code using the LLM')
    .argument('<description>', 'Description of the code to generate')
    .option('-l, --language <language>', 'Programming language', 'typescript')
    .action(generateCode);
} 