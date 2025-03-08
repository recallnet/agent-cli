/**
 * Platform-specific path resolution for configuration, cache, and data files
 * Following XDG Base Directory Specification and platform conventions
 */
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

// Application name used for directory names
const APP_NAME = 'recall-cli';

/**
 * Get the base configuration directory based on platform
 */
function getBaseConfigDir(): string {
  const platform = process.platform;
  
  // Determine base directory based on platform
  if (platform === 'darwin') {
    // macOS: ~/Library/Application Support/recall-cli
    return path.join(os.homedir(), 'Library', 'Application Support', APP_NAME);
  } else if (platform === 'win32') {
    // Windows: %APPDATA%\recall-cli
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), APP_NAME);
  } else {
    // Linux/Unix: ~/.config/recall-cli (following XDG Base Directory Specification)
    return path.join(os.homedir(), '.config', APP_NAME);
  }
}

/**
 * Get the base cache directory based on platform
 */
function getBaseCacheDir(): string {
  const platform = process.platform;
  
  if (platform === 'darwin') {
    // macOS: ~/Library/Caches/recall-cli
    return path.join(os.homedir(), 'Library', 'Caches', APP_NAME);
  } else if (platform === 'win32') {
    // Windows: %LOCALAPPDATA%\recall-cli\Cache
    return path.join(
      process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 
      APP_NAME, 
      'Cache'
    );
  } else {
    // Linux/Unix: ~/.cache/recall-cli (following XDG Base Directory Specification)
    return path.join(os.homedir(), '.cache', APP_NAME);
  }
}

/**
 * Get the base data directory based on platform
 */
function getBaseDataDir(): string {
  const platform = process.platform;
  
  if (platform === 'darwin') {
    // macOS: ~/Library/Application Support/recall-cli (same as config)
    return getBaseConfigDir();
  } else if (platform === 'win32') {
    // Windows: %LOCALAPPDATA%\recall-cli\Data
    return path.join(
      process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 
      APP_NAME, 
      'Data'
    );
  } else {
    // Linux/Unix: ~/.local/share/recall-cli (following XDG Base Directory Specification)
    return path.join(os.homedir(), '.local', 'share', APP_NAME);
  }
}

/**
 * Ensure a directory exists
 * @param dirPath Directory path to ensure
 */
function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Get a path in the config directory
 * @param segments Path segments to join to the config directory
 * @returns Absolute path to the requested config location
 */
export function getConfigPath(...segments: string[]): string {
  const configDir = getBaseConfigDir();
  ensureDir(configDir);
  return path.join(configDir, ...segments);
}

/**
 * Get a path in the cache directory
 * @param segments Path segments to join to the cache directory
 * @returns Absolute path to the requested cache location
 */
export function getCachePath(...segments: string[]): string {
  const cacheDir = getBaseCacheDir();
  ensureDir(cacheDir);
  return path.join(cacheDir, ...segments);
}

/**
 * Get a path in the data directory
 * @param segments Path segments to join to the data directory
 * @returns Absolute path to the requested data location
 */
export function getDataPath(...segments: string[]): string {
  const dataDir = getBaseDataDir();
  ensureDir(dataDir);
  return path.join(dataDir, ...segments);
}

/**
 * Get paths for a specific project, stored in the user's data directory
 * @param projectName Name of the project for organization
 * @param segments Additional path segments
 * @returns Absolute path to the project-specific location
 */
export function getProjectPath(projectName: string, ...segments: string[]): string {
  const projectDir = path.join(getDataPath('projects'), projectName);
  ensureDir(projectDir);
  return path.join(projectDir, ...segments);
}

/**
 * Get the SQLite database path
 * @param projectName Optional project name for project-specific database
 * @returns Path to the SQLite database
 */
export function getDbPath(projectName?: string): string {
  if (projectName) {
    return getProjectPath(projectName, 'db', 'documentation.db');
  }
  return getDataPath('db', 'documentation.db');
}

/**
 * Get path to plugins.json
 * @returns Path to the plugins.json file
 */
export function getPluginsJsonPath(): string {
  return getDataPath('plugins.json');
}

/**
 * Get path to the LLM credentials file
 * @returns Path to the credentials file
 */
export function getCredentialsPath(): string {
  return getConfigPath('credentials.json');
}

/**
 * Get temp directory for transient files
 * @param segments Path segments to join
 * @returns Path in the temporary directory
 */
export function getTempPath(...segments: string[]): string {
  const tempDir = path.join(os.tmpdir(), APP_NAME);
  ensureDir(tempDir);
  return path.join(tempDir, ...segments);
} 