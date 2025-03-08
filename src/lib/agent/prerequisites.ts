import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface PrerequisiteCheckResult {
  name: string;
  satisfied: boolean;
  version?: string;
  requiredVersion?: string;
  message?: string;
  installCommand?: string;
}

export interface SystemPrerequisites {
  nodeVersion: string;
  pnpmInstalled: boolean;
  pnpmVersion?: string;
  gitInstalled: boolean;
  gitVersion?: string;
  allSatisfied: boolean;
  results: PrerequisiteCheckResult[];
}

/**
 * Check system prerequisites for setting up a Recall agent
 */
export async function checkSystemPrerequisites(): Promise<SystemPrerequisites> {
  const results: PrerequisiteCheckResult[] = [];
  let nodeVersion = '';
  let pnpmInstalled = false;
  let pnpmVersion = '';
  let gitInstalled = false;
  let gitVersion = '';

  // Check Node.js version
  try {
    const { stdout } = await execAsync('node --version');
    nodeVersion = stdout.trim();
    const versionNumber = nodeVersion.replace('v', '');
    const major = parseInt(versionNumber.split('.')[0], 10);
    
    results.push({
      name: 'Node.js',
      satisfied: major >= 22,
      version: versionNumber,
      requiredVersion: '22.0.0+',
      message: major >= 22 
        ? `Node.js ${versionNumber} is installed and meets requirements` 
        : `Node.js ${versionNumber} is installed but version 22+ is required`,
      installCommand: 'Visit https://nodejs.org to install or upgrade Node.js'
    });
  } catch (error) {
    results.push({
      name: 'Node.js',
      satisfied: false,
      message: 'Node.js is not installed or not in PATH',
      installCommand: 'Visit https://nodejs.org to install Node.js'
    });
  }

  // Check pnpm
  try {
    const { stdout } = await execAsync('pnpm --version');
    pnpmInstalled = true;
    pnpmVersion = stdout.trim();
    
    results.push({
      name: 'pnpm',
      satisfied: true,
      version: pnpmVersion,
      message: `pnpm ${pnpmVersion} is installed`,
    });
  } catch (error) {
    pnpmInstalled = false;
    results.push({
      name: 'pnpm',
      satisfied: false,
      message: 'pnpm is not installed or not in PATH',
      installCommand: 'npm install -g pnpm'
    });
  }

  // Check git
  try {
    const { stdout } = await execAsync('git --version');
    gitInstalled = true;
    gitVersion = stdout.trim().replace('git version ', '');
    
    results.push({
      name: 'Git',
      satisfied: true,
      version: gitVersion,
      message: `Git ${gitVersion} is installed`,
    });
  } catch (error) {
    gitInstalled = false;
    results.push({
      name: 'Git',
      satisfied: false,
      message: 'Git is not installed or not in PATH',
      installCommand: 'Visit https://git-scm.com/downloads to install Git'
    });
  }

  const allSatisfied = results.every(result => result.satisfied);

  return {
    nodeVersion,
    pnpmInstalled,
    pnpmVersion,
    gitInstalled,
    gitVersion,
    allSatisfied,
    results
  };
}

/**
 * Validate project structure for a Recall agent
 */
export function validateProjectStructure(projectPath: string): { 
  valid: boolean; 
  issues: string[];
  requiredDirectories: string[];
  requiredFiles: string[];
  missingDirectories: string[];
  missingFiles: string[];
} {
  const issues: string[] = [];
  
  // Expected structure based on Recall Agent Starter Kit
  const requiredDirectories = [
    'src',
    'src/actions',
    'src/providers',
    'characters',
    'strategies'
  ];
  
  const requiredFiles = [
    'package.json',
    'tsconfig.json',
    'src/index.ts',
    'src/types.ts',
    'src/environment.ts'
  ];

  const missingDirectories: string[] = [];
  const missingFiles: string[] = [];

  // Check if project directory exists
  if (!fs.existsSync(projectPath)) {
    issues.push(`Project directory ${projectPath} does not exist`);
    return { 
      valid: false, 
      issues, 
      requiredDirectories,
      requiredFiles,
      missingDirectories: requiredDirectories,
      missingFiles: requiredFiles
    };
  }

  // Check required directories
  for (const dir of requiredDirectories) {
    const dirPath = path.join(projectPath, dir);
    if (!fs.existsSync(dirPath)) {
      issues.push(`Required directory ${dir} is missing`);
      missingDirectories.push(dir);
    }
  }

  // Check required files
  for (const file of requiredFiles) {
    const filePath = path.join(projectPath, file);
    if (!fs.existsSync(filePath)) {
      issues.push(`Required file ${file} is missing`);
      missingFiles.push(file);
    }
  }

  // Validate package.json if it exists
  const packageJsonPath = path.join(projectPath, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    try {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      
      // Check for essential properties
      if (!packageJson.name) {
        issues.push('package.json is missing "name" property');
      }
      
      if (!packageJson.version) {
        issues.push('package.json is missing "version" property');
      }
      
      if (!packageJson.dependencies) {
        issues.push('package.json is missing "dependencies" section');
      } else {
        // Check for essential dependencies
        const essentialDeps = ['@elizaos/core', '@elizaos/agent'];
        for (const dep of essentialDeps) {
          if (!packageJson.dependencies[dep]) {
            issues.push(`package.json is missing dependency "${dep}"`);
          }
        }
      }
    } catch (error) {
      issues.push('package.json exists but is not valid JSON');
    }
  }

  const valid = issues.length === 0;
  
  return { 
    valid, 
    issues,
    requiredDirectories,
    requiredFiles,
    missingDirectories,
    missingFiles
  };
}

/**
 * Check if a project directory can be initialized as a Recall agent
 */
export function canInitializeProject(projectPath: string): { 
  canInitialize: boolean; 
  exists: boolean;
  isEmpty: boolean;
  hasGit: boolean;
  issues: string[] 
} {
  const issues: string[] = [];
  let exists = false;
  let isEmpty = false;
  let hasGit = false;

  // Check if directory exists
  if (fs.existsSync(projectPath)) {
    exists = true;
    
    // Check if directory has content
    const files = fs.readdirSync(projectPath);
    isEmpty = files.length === 0;
    
    if (!isEmpty) {
      // Check if it's a git repository
      hasGit = fs.existsSync(path.join(projectPath, '.git'));
      
      // Check for conflicts with Recall structure
      const potentialConflicts = ['src', 'package.json', 'tsconfig.json'];
      for (const item of potentialConflicts) {
        if (fs.existsSync(path.join(projectPath, item))) {
          issues.push(`Directory contains "${item}" which may conflict with Recall agent structure`);
        }
      }
    }
  } else {
    // Check if parent directory exists for creation
    const parentDir = path.dirname(projectPath);
    if (!fs.existsSync(parentDir)) {
      issues.push(`Parent directory ${parentDir} does not exist`);
    }
  }

  const canInitialize = (exists && isEmpty) || !exists;
  
  if (!canInitialize && exists && !isEmpty) {
    issues.push('Directory exists and is not empty. Please use an empty directory or create a new one.');
  }

  return { canInitialize, exists, isEmpty, hasGit, issues };
} 