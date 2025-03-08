import { execSync } from 'child_process';
import chalk from 'chalk';

/**
 * Validate that the required environment is set up for the CLI tool
 */
export async function validateEnvironment(): Promise<void> {
  // Check Node.js version
  const nodeVersion = process.versions.node;
  const major = parseInt(nodeVersion.split('.')[0], 10);
  
  if (major < 22) {
    throw new Error(`Node.js v22+ is required, but you have v${nodeVersion}`);
  }
  
  // Check pnpm
  try {
    execSync('pnpm --version', { stdio: 'ignore' });
  } catch (error) {
    throw new Error('pnpm is required but not installed. Please install pnpm: https://pnpm.io/installation');
  }
  
  console.log(chalk.green('✓ Environment validation passed'));
  return Promise.resolve();
} 