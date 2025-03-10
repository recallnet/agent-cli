/**
 * Filesystem MCP Server integration
 * 
 * This module provides integration with the Filesystem MCP Server for direct file operations
 */

import { spawn, ChildProcess } from 'child_process';
import axios from 'axios';
import { McpClient } from '../client.js';
import * as fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { createTwoFilesPatch } from 'diff';
import { minimatch } from 'minimatch';

// Default port for the filesystem MCP server
const DEFAULT_PORT = 3456;

interface FilesystemServerOptions {
  port?: number;
  allowedDirectories: string[];
  debug?: boolean;
}

/**
 * Class to manage the Filesystem MCP Server
 */
export class FilesystemServer {
  private process: ChildProcess | null = null;
  private port: number;
  private allowedDirectories: string[];
  private debug: boolean;
  private baseUrl: string;
  private ready: boolean = false;
  private client: McpClient | null = null;

  constructor(options: FilesystemServerOptions) {
    this.port = options.port || DEFAULT_PORT;
    this.allowedDirectories = options.allowedDirectories;
    this.debug = options.debug || false;
    this.baseUrl = `http://localhost:${this.port}`;
  }

  /**
   * Start the filesystem MCP server
   */
  async start(): Promise<void> {
    if (this.process) {
      throw new Error('Server is already running');
    }

    // Check if npx is available
    try {
      const check = spawn('npx', ['--version']);
      await new Promise<void>((resolve, reject) => {
        check.on('close', (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error('npx is not available. Please install Node.js with npm.'));
          }
        });
      });
    } catch (error) {
      throw new Error('Failed to check for npx: ' + error);
    }

    // Start the server using npx
    const serverProcess = spawn('npx', [
      '-y',
      '@modelcontextprotocol/server-filesystem',
      ...this.allowedDirectories,
      '--port',
      this.port.toString()
    ], {
      stdio: this.debug ? 'inherit' : 'pipe'
    });

    this.process = serverProcess;

    // Log process output if debug is enabled
    if (this.debug && serverProcess.stdout && serverProcess.stderr) {
      serverProcess.stdout.on('data', (data) => {
        console.log(`[Filesystem Server] ${data.toString().trim()}`);
      });
      
      serverProcess.stderr.on('data', (data) => {
        console.error(`[Filesystem Server Error] ${data.toString().trim()}`);
      });
    }

    // Wait for the server to start
    let attempts = 0;
    const maxAttempts = 10;
    
    while (attempts < maxAttempts) {
      try {
        await axios.get(`${this.baseUrl}/health`);
        this.ready = true;
        console.log(`Filesystem MCP Server started on port ${this.port}`);
        
        // Create a McpClient for this server
        this.client = new McpClient({
          baseUrl: this.baseUrl
        });
        
        return;
      } catch (error) {
        attempts++;
        if (attempts >= maxAttempts) {
          this.stop();
          throw new Error('Failed to start Filesystem MCP Server: Server did not respond to health check');
        }
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
  }

  /**
   * Stop the filesystem MCP server
   */
  stop(): void {
    if (this.process) {
      this.process.kill();
      this.process = null;
      this.ready = false;
      this.client = null;
      console.log('Filesystem MCP Server stopped');
    }
  }

  /**
   * Check if the server is ready
   */
  isReady(): boolean {
    return this.ready;
  }

  /**
   * Get the McpClient for this server
   */
  getClient(): McpClient {
    if (!this.ready || !this.client) {
      throw new Error('Filesystem MCP Server is not ready');
    }
    return this.client;
  }

  /**
   * Read a file using the filesystem MCP server
   */
  async readFile(filePath: string): Promise<string> {
    if (!this.ready || !this.client) {
      throw new Error('Filesystem MCP Server is not ready');
    }

    try {
      const response = await axios.post(`${this.baseUrl}/call-tool`, {
        resourceName: 'file://system',
        toolName: 'read_file',
        arguments: {
          path: filePath
        }
      });

      if (response.data.isError) {
        throw new Error(`Failed to read file: ${response.data.content}`);
      }

      return response.data.content || '';
    } catch (error) {
      throw new Error(`Error reading file: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Write a file using the filesystem MCP server
   */
  async writeFile(filePath: string, content: string): Promise<void> {
    if (!this.ready || !this.client) {
      throw new Error('Filesystem MCP Server is not ready');
    }

    try {
      const response = await axios.post(`${this.baseUrl}/call-tool`, {
        resourceName: 'file://system',
        toolName: 'write_file',
        arguments: {
          path: filePath,
          content
        }
      });

      if (response.data.isError) {
        throw new Error(`Failed to write file: ${response.data.content}`);
      }
    } catch (error) {
      throw new Error(`Error writing file: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Edit a file using the filesystem MCP server's edit_file tool
   */
  async editFile(filePath: string, edits: Array<{oldText: string, newText: string}>, dryRun?: boolean): Promise<string> {
    if (!this.ready || !this.client) {
      throw new Error('Filesystem MCP Server is not ready');
    }

    try {
      const response = await axios.post(`${this.baseUrl}/call-tool`, {
        resourceName: 'file://system',
        toolName: 'edit_file',
        arguments: {
          path: filePath,
          edits,
          dryRun: dryRun || false
        }
      });

      if (response.data.isError) {
        throw new Error(`Failed to edit file: ${response.data.content}`);
      }

      return response.data.content || '';
    } catch (error) {
      throw new Error(`Error editing file: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

// Singleton instance for global usage
let globalInstance: FilesystemServer | null = null;

/**
 * Initialize the global filesystem server instance
 * @param options Server configuration options
 */
export async function initializeFilesystemServer(options: FilesystemServerOptions): Promise<FilesystemServer> {
  if (globalInstance) {
    await globalInstance.stop();
  }
  
  globalInstance = new FilesystemServer(options);
  await globalInstance.start();
  return globalInstance;
}

/**
 * Get the global filesystem server instance
 * @returns The global filesystem server instance
 */
export function getFilesystemServer(): FilesystemServer {
  if (!globalInstance) {
    throw new Error('Filesystem MCP Server has not been initialized');
  }
  return globalInstance;
}

/**
 * Stop the global filesystem server instance
 */
export function stopFilesystemServer(): void {
  if (globalInstance) {
    globalInstance.stop();
    globalInstance = null;
  }
}

/**
 * FileSystem handler options
 */
export interface FilesystemHandlerOptions {
  allowedDirectories: string[];
}

/**
 * Filesystem read file arguments
 */
export interface ReadFileArgs {
  path: string;
}

/**
 * Filesystem read multiple files arguments
 */
export interface ReadMultipleFilesArgs {
  paths: string[];
}

/**
 * Filesystem write file arguments
 */
export interface WriteFileArgs {
  path: string;
  content: string;
}

/**
 * Edit operation
 */
export interface EditOperation {
  oldText: string;
  newText: string;
}

/**
 * Filesystem edit file arguments
 */
export interface EditFileArgs {
  path: string;
  edits: EditOperation[];
  dryRun?: boolean;
}

/**
 * Filesystem create directory arguments
 */
export interface CreateDirectoryArgs {
  path: string;
}

/**
 * Filesystem list directory arguments
 */
export interface ListDirectoryArgs {
  path: string;
}

/**
 * Filesystem directory tree arguments
 */
export interface DirectoryTreeArgs {
  path: string;
}

/**
 * Filesystem move file arguments
 */
export interface MoveFileArgs {
  source: string;
  destination: string;
}

/**
 * Filesystem search files arguments
 */
export interface SearchFilesArgs {
  path: string;
  pattern: string;
  excludePatterns?: string[];
}

/**
 * Filesystem get file info arguments
 */
export interface GetFileInfoArgs {
  path: string;
}

/**
 * File info
 */
export interface FileInfo {
  size: number;
  created: Date;
  modified: Date;
  accessed: Date;
  isDirectory: boolean;
  isFile: boolean;
  permissions: string;
}

/**
 * Directory tree entry
 */
export interface TreeEntry {
  name: string;
  type: 'file' | 'directory';
  children?: TreeEntry[];
}

/**
 * FilesystemHandler provides secure access to the filesystem
 * with strict path validation to ensure security
 */
export class FilesystemHandler {
  private allowedDirectories: string[];

  /**
   * Create a new FilesystemHandler
   */
  constructor(options: FilesystemHandlerOptions) {
    // Store allowed directories in normalized form
    this.allowedDirectories = options.allowedDirectories.map(dir =>
      this.normalizePath(path.resolve(this.expandHome(dir)))
    );
  }

  /**
   * Normalize path
   */
  private normalizePath(p: string): string {
    return path.normalize(p);
  }

  /**
   * Expand home directory
   */
  private expandHome(filepath: string): string {
    if (filepath.startsWith('~/') || filepath === '~') {
      return path.join(os.homedir(), filepath.slice(1));
    }
    return filepath;
  }

  /**
   * Validate path
   */
  private async validatePath(requestedPath: string): Promise<string> {
    const expandedPath = this.expandHome(requestedPath);
    const absolute = path.isAbsolute(expandedPath)
      ? path.resolve(expandedPath)
      : path.resolve(process.cwd(), expandedPath);

    const normalizedRequested = this.normalizePath(absolute);

    // Check if path is within allowed directories
    const isAllowed = this.allowedDirectories.some(dir => normalizedRequested.startsWith(dir));
    if (!isAllowed) {
      throw new Error(`Access denied - path outside allowed directories: ${absolute} not in ${this.allowedDirectories.join(', ')}`);
    }

    // Handle symlinks by checking their real path
    try {
      const realPath = await fs.realpath(absolute);
      const normalizedReal = this.normalizePath(realPath);
      const isRealPathAllowed = this.allowedDirectories.some(dir => normalizedReal.startsWith(dir));
      if (!isRealPathAllowed) {
        throw new Error('Access denied - symlink target outside allowed directories');
      }
      return realPath;
    } catch (error) {
      // For new files that don't exist yet, verify parent directory
      const parentDir = path.dirname(absolute);
      try {
        const realParentPath = await fs.realpath(parentDir);
        const normalizedParent = this.normalizePath(realParentPath);
        const isParentAllowed = this.allowedDirectories.some(dir => normalizedParent.startsWith(dir));
        if (!isParentAllowed) {
          throw new Error('Access denied - parent directory outside allowed directories');
        }
        return absolute;
      } catch {
        throw new Error(`Parent directory does not exist: ${parentDir}`);
      }
    }
  }

  /**
   * Read a file
   */
  async readFile(args: ReadFileArgs): Promise<string> {
    const validPath = await this.validatePath(args.path);
    return await fs.readFile(validPath, 'utf-8');
  }

  /**
   * Read multiple files
   */
  async readMultipleFiles(args: ReadMultipleFilesArgs): Promise<string> {
    const results = await Promise.all(
      args.paths.map(async (filePath: string) => {
        try {
          const validPath = await this.validatePath(filePath);
          const content = await fs.readFile(validPath, 'utf-8');
          return `${filePath}:\n${content}\n`;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          return `${filePath}: Error - ${errorMessage}`;
        }
      }),
    );
    return results.join('\n---\n');
  }

  /**
   * Write a file
   */
  async writeFile(args: WriteFileArgs): Promise<string> {
    const validPath = await this.validatePath(args.path);
    await fs.writeFile(validPath, args.content, 'utf-8');
    return `Successfully wrote to ${args.path}`;
  }

  /**
   * Normalize line endings
   */
  private normalizeLineEndings(text: string): string {
    return text.replace(/\r\n/g, '\n');
  }

  /**
   * Create unified diff
   */
  private createUnifiedDiff(originalContent: string, newContent: string, filepath: string = 'file'): string {
    // Ensure consistent line endings for diff
    const normalizedOriginal = this.normalizeLineEndings(originalContent);
    const normalizedNew = this.normalizeLineEndings(newContent);

    return createTwoFilesPatch(
      filepath,
      filepath,
      normalizedOriginal,
      normalizedNew,
      'original',
      'modified'
    );
  }

  /**
   * Edit a file
   */
  async editFile(args: EditFileArgs): Promise<string> {
    const validPath = await this.validatePath(args.path);
    const dryRun = args.dryRun || false;
    
    // Read file content and normalize line endings
    const content = this.normalizeLineEndings(await fs.readFile(validPath, 'utf-8'));

    // Apply edits sequentially
    let modifiedContent = content;
    for (const edit of args.edits) {
      const normalizedOld = this.normalizeLineEndings(edit.oldText);
      const normalizedNew = this.normalizeLineEndings(edit.newText);

      // If exact match exists, use it
      if (modifiedContent.includes(normalizedOld)) {
        modifiedContent = modifiedContent.replace(normalizedOld, normalizedNew);
        continue;
      }

      // Otherwise, try line-by-line matching with flexibility for whitespace
      const oldLines = normalizedOld.split('\n');
      const contentLines = modifiedContent.split('\n');
      let matchFound = false;

      for (let i = 0; i <= contentLines.length - oldLines.length; i++) {
        const potentialMatch = contentLines.slice(i, i + oldLines.length);

        // Compare lines with normalized whitespace
        const isMatch = oldLines.every((oldLine, j) => {
          const contentLine = potentialMatch[j];
          return oldLine.trim() === contentLine.trim();
        });

        if (isMatch) {
          // Preserve original indentation of first line
          const originalIndent = contentLines[i].match(/^\s*/)?.[0] || '';
          const newLines = normalizedNew.split('\n').map((line, j) => {
            if (j === 0) return originalIndent + line.trimStart();
            // For subsequent lines, try to preserve relative indentation
            const oldIndent = oldLines[j]?.match(/^\s*/)?.[0] || '';
            const newIndent = line.match(/^\s*/)?.[0] || '';
            if (oldIndent && newIndent) {
              const relativeIndent = newIndent.length - oldIndent.length;
              return originalIndent + ' '.repeat(Math.max(0, relativeIndent)) + line.trimStart();
            }
            return line;
          });

          contentLines.splice(i, oldLines.length, ...newLines);
          modifiedContent = contentLines.join('\n');
          matchFound = true;
          break;
        }
      }

      if (!matchFound) {
        throw new Error(`Could not find exact match for edit:\n${edit.oldText}`);
      }
    }

    // Create unified diff
    const diff = this.createUnifiedDiff(content, modifiedContent, validPath);

    // Format diff with appropriate number of backticks
    let numBackticks = 3;
    while (diff.includes('`'.repeat(numBackticks))) {
      numBackticks++;
    }
    const formattedDiff = `${'`'.repeat(numBackticks)}diff\n${diff}${'`'.repeat(numBackticks)}\n\n`;

    if (!dryRun) {
      await fs.writeFile(validPath, modifiedContent, 'utf-8');
    }

    return formattedDiff;
  }

  /**
   * Create a directory
   */
  async createDirectory(args: CreateDirectoryArgs): Promise<string> {
    const validPath = await this.validatePath(args.path);
    await fs.mkdir(validPath, { recursive: true });
    return `Successfully created directory ${args.path}`;
  }

  /**
   * List a directory
   */
  async listDirectory(args: ListDirectoryArgs): Promise<string> {
    const validPath = await this.validatePath(args.path);
    const entries = await fs.readdir(validPath, { withFileTypes: true });
    return entries
      .map((entry) => `${entry.isDirectory() ? '[DIR]' : '[FILE]'} ${entry.name}`)
      .join('\n');
  }

  /**
   * Get directory tree
   */
  async directoryTree(args: DirectoryTreeArgs): Promise<string> {
    const validPath = await this.validatePath(args.path);
    const treeData = await this.buildDirectoryTree(validPath);
    return JSON.stringify(treeData, null, 2);
  }

  /**
   * Build directory tree
   */
  private async buildDirectoryTree(currentPath: string): Promise<TreeEntry[]> {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });
    const result: TreeEntry[] = [];

    for (const entry of entries) {
      const entryData: TreeEntry = {
        name: entry.name,
        type: entry.isDirectory() ? 'directory' : 'file'
      };

      if (entry.isDirectory()) {
        const subPath = path.join(currentPath, entry.name);
        entryData.children = await this.buildDirectoryTree(subPath);
      }

      result.push(entryData);
    }

    return result;
  }

  /**
   * Move a file
   */
  async moveFile(args: MoveFileArgs): Promise<string> {
    const validSourcePath = await this.validatePath(args.source);
    const validDestPath = await this.validatePath(args.destination);
    await fs.rename(validSourcePath, validDestPath);
    return `Successfully moved ${args.source} to ${args.destination}`;
  }

  /**
   * Search files
   */
  async searchFiles(args: SearchFilesArgs): Promise<string> {
    const validPath = await this.validatePath(args.path);
    const results = await this.findFiles(validPath, args.pattern, args.excludePatterns || []);
    return results.length > 0 ? results.join('\n') : 'No matches found';
  }

  /**
   * Find files
   */
  private async findFiles(
    rootPath: string,
    pattern: string,
    excludePatterns: string[] = []
  ): Promise<string[]> {
    const results: string[] = [];

    async function search(currentPath: string) {
      try {
        const entries = await fs.readdir(currentPath, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(currentPath, entry.name);

          try {
            // Check if path matches any exclude pattern
            const relativePath = path.relative(rootPath, fullPath);
            const shouldExclude = excludePatterns.some(pattern => {
              const globPattern = pattern.includes('*') ? pattern : `**/${pattern}/**`;
              return minimatch(relativePath, globPattern, { dot: true });
            });

            if (shouldExclude) {
              continue;
            }

            if (entry.name.toLowerCase().includes(pattern.toLowerCase())) {
              results.push(fullPath);
            }

            if (entry.isDirectory()) {
              await search(fullPath);
            }
          } catch (error) {
            // Skip invalid paths during search
            continue;
          }
        }
      } catch (error) {
        // Skip directories we can't read
      }
    }

    await search(rootPath);
    return results;
  }

  /**
   * Get file info
   */
  async getFileInfo(args: GetFileInfoArgs): Promise<string> {
    const validPath = await this.validatePath(args.path);
    const info = await this.getFileStats(validPath);
    return Object.entries(info)
      .map(([key, value]) => `${key}: ${value}`)
      .join('\n');
  }

  /**
   * Get file stats
   */
  private async getFileStats(filePath: string): Promise<FileInfo> {
    const stats = await fs.stat(filePath);
    return {
      size: stats.size,
      created: stats.birthtime,
      modified: stats.mtime,
      accessed: stats.atime,
      isDirectory: stats.isDirectory(),
      isFile: stats.isFile(),
      permissions: stats.mode.toString(8).slice(-3),
    };
  }

  /**
   * List allowed directories
   */
  getDirectories(): string[] {
    return [...this.allowedDirectories];
  }
} 