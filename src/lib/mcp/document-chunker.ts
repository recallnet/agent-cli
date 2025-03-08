/**
 * Utility for chunking documents into smaller pieces for storage and retrieval
 */
export class DocumentChunker {
  // Default chunk size (characters)
  private defaultChunkSize: number = 1500;
  // Default chunk overlap (characters)
  private defaultChunkOverlap: number = 150;
  
  /**
   * Create a new DocumentChunker
   * @param chunkSize Size of each chunk in characters
   * @param chunkOverlap Overlap between chunks in characters
   */
  constructor(chunkSize?: number, chunkOverlap?: number) {
    this.defaultChunkSize = chunkSize || this.defaultChunkSize;
    this.defaultChunkOverlap = chunkOverlap || this.defaultChunkOverlap;
    
    // Ensure overlap is less than chunk size
    if (this.defaultChunkOverlap >= this.defaultChunkSize) {
      this.defaultChunkOverlap = Math.floor(this.defaultChunkSize / 3);
    }
  }
  
  /**
   * Split text into chunks
   * @param text The text to chunk
   * @param chunkSize Optional chunk size override
   * @param chunkOverlap Optional chunk overlap override
   * @returns Array of text chunks
   */
  chunkText(text: string, chunkSize?: number, chunkOverlap?: number): string[] {
    const size = chunkSize || this.defaultChunkSize;
    const overlap = chunkOverlap || this.defaultChunkOverlap;
    
    // Handle empty or small text
    if (!text || text.length <= size) {
      return [text];
    }
    
    const chunks: string[] = [];
    let start = 0;
    
    while (start < text.length) {
      // Get chunk of appropriate size
      const end = start + size;
      
      // If we're at the end of the text, just take what's left
      if (end >= text.length) {
        chunks.push(text.slice(start));
        break;
      }
      
      // Try to find a good break point (newline, period, comma, space)
      const breakChars = ['\n\n', '\n', '. ', ', ', ' '];
      let breakPoint = -1;
      
      for (const char of breakChars) {
        // Look for the break character within a reasonable range near the end
        const searchStart = Math.max(start + size - 100, start);
        const searchEnd = Math.min(start + size + 100, text.length);
        const searchText = text.slice(searchStart, searchEnd);
        const foundPos = searchText.lastIndexOf(char);
        
        if (foundPos !== -1) {
          breakPoint = searchStart + foundPos + char.length;
          break;
        }
      }
      
      // If no good break found, just break at the chunk size
      if (breakPoint === -1 || breakPoint <= start) {
        breakPoint = end;
      }
      
      // Add the chunk
      chunks.push(text.slice(start, breakPoint));
      
      // Move to next chunk, considering overlap
      start = breakPoint - overlap;
      
      // Ensure we make progress
      if (start <= 0 || start >= text.length - 10) {
        start = breakPoint;
      }
    }
    
    return chunks;
  }
  
  /**
   * Split markdown content into semantic chunks
   * @param markdown The markdown content to chunk
   * @returns Array of markdown chunks split at logical boundaries
   */
  chunkMarkdown(markdown: string): string[] {
    // Split by headers first to preserve document structure
    const sections = this.splitByHeaders(markdown);
    const result: string[] = [];
    
    // Process each section
    for (const section of sections) {
      // If section is small enough, add it directly
      if (section.length <= this.defaultChunkSize) {
        result.push(section);
        continue;
      }
      
      // Otherwise chunk it with standard method
      const chunks = this.chunkText(section);
      result.push(...chunks);
    }
    
    return result;
  }
  
  /**
   * Split a document by its headers
   * @param text The text/markdown to split
   * @returns Array of sections split at header boundaries
   */
  private splitByHeaders(text: string): string[] {
    // Match all levels of markdown headers
    const headerPattern = /^#{1,6}\s+.+$/gm;
    const matches = [...text.matchAll(headerPattern)];
    
    // If no headers, return the whole text
    if (matches.length === 0) {
      return [text];
    }
    
    const sections: string[] = [];
    let lastIndex = 0;
    
    // Process each header match
    for (const match of matches) {
      const index = match.index as number;
      
      // If this is not the first header and there's content before it, add as section
      if (index > lastIndex) {
        sections.push(text.slice(lastIndex, index));
      }
      
      lastIndex = index;
    }
    
    // Add the final section
    if (lastIndex < text.length) {
      sections.push(text.slice(lastIndex));
    }
    
    return sections;
  }
  
  /**
   * Chunk HTML content while preserving structure
   * @param html The HTML content to chunk
   * @returns Array of HTML chunks
   */
  chunkHtml(html: string): string[] {
    // Simplistic approach - convert to text and chunk
    // For a production system, you'd want to use a proper HTML parser
    const textContent = this.htmlToText(html);
    return this.chunkText(textContent);
  }
  
  /**
   * Convert HTML to plain text (simple version)
   * @param html HTML content
   * @returns Plain text
   */
  private htmlToText(html: string): string {
    // Remove scripts and style elements
    let text = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
    
    // Replace common block elements with newlines
    text = text.replace(/<\/(?:div|p|table|tr|h[1-6])>/gi, '$&\n');
    
    // Replace list items with newlines and bullets
    text = text.replace(/<li>/gi, '• ');
    
    // Remove remaining HTML tags
    text = text.replace(/<[^>]+>/g, '');
    
    // Decode HTML entities
    text = text.replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"');
    
    // Normalize whitespace
    text = text.replace(/\s+/g, ' ');
    
    return text.trim();
  }
  
  /**
   * Chunk code with context awareness
   * @param code The source code to chunk
   * @param language The programming language
   * @returns Array of code chunks with context
   */
  chunkCode(code: string, language: string): string[] {
    // Simple approach for common languages
    switch (language.toLowerCase()) {
    case 'javascript':
    case 'typescript':
    case 'js':
    case 'ts':
      return this.chunkJavaScriptLike(code);
        
    case 'python':
    case 'py':
      return this.chunkPythonLike(code);
        
    default:
      // For other languages, fall back to line-based chunking
      return this.chunkByLines(code);
    }
  }
  
  /**
   * Chunk JavaScript/TypeScript code
   * @param code The source code
   * @returns Array of code chunks
   */
  private chunkJavaScriptLike(code: string): string[] {
    // Split by function, class, method definitions
    const chunks: string[] = [];
    const lines = code.split('\n');
    
    let currentChunk: string[] = [];
    let inBlock = false;
    let blockDepth = 0;
    
    for (const line of lines) {
      // Check for function/class/method definitions
      const isDefLine = /^\s*(export\s+)?(async\s+)?(function|class|const\s+\w+\s*=\s*(\(|\s*async\s*\()|[a-zA-Z_$][a-zA-Z0-9_$]*\s*:\s*(\(|\s*async\s*\())/.test(line);
      
      // Track code block depth (for nested functions)
      if (line.includes('{')) {
        blockDepth++;
        inBlock = true;
      }
      
      if (line.includes('}')) {
        blockDepth--;
      }
      
      // Start a new chunk at a definition if we're not in a block
      if (isDefLine && !inBlock && currentChunk.length > 0) {
        chunks.push(currentChunk.join('\n'));
        currentChunk = [];
      }
      
      // Add the line to the current chunk
      currentChunk.push(line);
      
      // When we exit a block and have a substantial chunk, save it
      if (inBlock && blockDepth === 0) {
        inBlock = false;
        
        // If chunk is too big, split it
        const chunkText = currentChunk.join('\n');
        if (chunkText.length > this.defaultChunkSize * 1.5) {
          const subChunks = this.chunkText(chunkText);
          chunks.push(...subChunks);
          currentChunk = [];
        }
      }
      
      // Check if current chunk is getting too large
      if (currentChunk.join('\n').length > this.defaultChunkSize * 2) {
        chunks.push(currentChunk.join('\n'));
        currentChunk = [];
      }
    }
    
    // Add any remaining content
    if (currentChunk.length > 0) {
      chunks.push(currentChunk.join('\n'));
    }
    
    return chunks;
  }
  
  /**
   * Chunk Python-like code
   * @param code The source code
   * @returns Array of code chunks
   */
  private chunkPythonLike(code: string): string[] {
    const chunks: string[] = [];
    const lines = code.split('\n');
    
    let currentChunk: string[] = [];
    let inFunction = false;
    let indentLevel = 0;
    
    for (const line of lines) {
      // Check for function/class definitions
      const isDefLine = /^\s*(def|class)\s+/.test(line);
      const currentIndent = line.search(/\S|$/);
      
      // Start a new chunk at a definition if we're not in a function
      if (isDefLine) {
        if (currentChunk.length > 0) {
          chunks.push(currentChunk.join('\n'));
          currentChunk = [];
        }
        inFunction = true;
        indentLevel = currentIndent;
      }
      
      // Add the line to the current chunk
      currentChunk.push(line);
      
      // Check if we're exiting a function block
      if (inFunction && currentIndent <= indentLevel && /\S/.test(line)) {
        inFunction = false;
      }
      
      // Check if current chunk is getting too large
      if (currentChunk.join('\n').length > this.defaultChunkSize * 1.5) {
        chunks.push(currentChunk.join('\n'));
        currentChunk = [];
      }
    }
    
    // Add any remaining content
    if (currentChunk.length > 0) {
      chunks.push(currentChunk.join('\n'));
    }
    
    return chunks;
  }
  
  /**
   * Simple line-based chunking for generic code
   * @param code The source code
   * @returns Array of code chunks
   */
  private chunkByLines(code: string): string[] {
    const lines = code.split('\n');
    const chunks: string[] = [];
    let currentChunk: string[] = [];
    
    for (const line of lines) {
      currentChunk.push(line);
      
      // Check if we've reached the chunk size
      if (currentChunk.join('\n').length >= this.defaultChunkSize) {
        chunks.push(currentChunk.join('\n'));
        currentChunk = [];
      }
    }
    
    // Add any remaining content
    if (currentChunk.length > 0) {
      chunks.push(currentChunk.join('\n'));
    }
    
    return chunks;
  }
} 