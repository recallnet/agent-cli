/**
 * Filesystem MCP Server integration
 * 
 * This module provides integration with the Filesystem MCP Server for direct file operations
 */

import { spawn, ChildProcess } from 'child_process';
import axios from 'axios';
import { McpClient } from '../client.js';

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