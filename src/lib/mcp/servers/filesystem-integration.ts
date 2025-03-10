import { McpClient } from '../client.js';
import { FilesystemHandler, EditOperation } from './filesystem.js';

/**
 * FilesystemMcpClient extends McpClient with filesystem operations
 */
export class FilesystemMcpClient extends McpClient {
  private filesystemHandler: FilesystemHandler;
  private originalMcpClient: McpClient | null = null;

  /**
   * Create a new FilesystemMcpClient
   */
  constructor(baseUrl: string, allowedDirectories: string[] = [], originalMcpClient?: McpClient) {
    super({ baseUrl });
    
    // Store the original MCP client if provided
    this.originalMcpClient = originalMcpClient || null;
    
    // Initialize filesystem handler
    this.filesystemHandler = new FilesystemHandler({
      allowedDirectories: allowedDirectories.length > 0 
        ? allowedDirectories
        : [process.cwd()] // Default to current directory if none specified
    });
  }

  /**
   * Set the original MCP client for documentation operations
   */
  setOriginalMcpClient(client: McpClient): void {
    this.originalMcpClient = client;
  }

  /**
   * Override getPluginDocumentation to use original MCP client if available
   */
  async getPluginDocumentation(pluginName: string, context?: string): Promise<any> {
    if (this.originalMcpClient) {
      return this.originalMcpClient.getPluginDocumentation(pluginName, context);
    }
    return super.getPluginDocumentation(pluginName, context);
  }

  /**
   * Override any query operation to use original MCP client if available
   */
  async query(request: any): Promise<any> {
    if (this.originalMcpClient && typeof (this.originalMcpClient as any).query === 'function') {
      return (this.originalMcpClient as any).query(request);
    }
    throw new Error('Query operation not supported without original MCP client');
  }

  /**
   * Read a file
   */
  async readFile(path: string): Promise<string> {
    return await this.filesystemHandler.readFile({ path });
  }

  /**
   * Read multiple files
   */
  async readMultipleFiles(paths: string[]): Promise<string> {
    return await this.filesystemHandler.readMultipleFiles({ paths });
  }

  /**
   * Write a file
   */
  async writeFile(path: string, content: string): Promise<string> {
    return await this.filesystemHandler.writeFile({ path, content });
  }

  /**
   * Edit a file
   */
  async editFile(path: string, edits: EditOperation[], dryRun: boolean = false): Promise<string> {
    return await this.filesystemHandler.editFile({ path, edits, dryRun });
  }

  /**
   * Create a directory
   */
  async createDirectory(path: string): Promise<string> {
    return await this.filesystemHandler.createDirectory({ path });
  }

  /**
   * List a directory
   */
  async listDirectory(path: string): Promise<string> {
    return await this.filesystemHandler.listDirectory({ path });
  }

  /**
   * Get directory tree
   */
  async directoryTree(path: string): Promise<string> {
    return await this.filesystemHandler.directoryTree({ path });
  }

  /**
   * Move a file
   */
  async moveFile(source: string, destination: string): Promise<string> {
    return await this.filesystemHandler.moveFile({ source, destination });
  }

  /**
   * Search files
   */
  async searchFiles(path: string, pattern: string, excludePatterns?: string[]): Promise<string> {
    return await this.filesystemHandler.searchFiles({ path, pattern, excludePatterns });
  }

  /**
   * Get file info
   */
  async getFileInfo(path: string): Promise<string> {
    return await this.filesystemHandler.getFileInfo({ path });
  }

  /**
   * Get allowed directories
   */
  getAllowedDirectories(): string[] {
    return this.filesystemHandler.getDirectories();
  }
}

/**
 * Create a FilesystemMcpClient for a specific project path
 */
export function createFilesystemClient(
  projectPath: string, 
  baseUrl: string = 'http://localhost:3333',
  originalMcpClient?: McpClient
): FilesystemMcpClient {
  return new FilesystemMcpClient(baseUrl, [projectPath], originalMcpClient);
} 