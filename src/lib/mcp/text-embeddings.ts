/**
 * Text embedding generator for document retrieval
 * Uses cross-encoder techniques for similarity measuring
 */
import { createHash } from 'crypto';
import axios from 'axios';
import { logger } from '../utils/logger.js';

// Simple interface for vector embeddings
export interface Embedding {
  vector: number[];
  size: number;
}

export class TextEmbeddings {
  // OpenAI embedding model to use
  private model = 'text-embedding-3-small';
  // API key loaded from environment
  private apiKey: string | null = null;
  // Whether we have access to OpenAI 
  private hasOpenAi = false;
  // Cache of document hash to embedding
  private cache: Map<string, Embedding> = new Map();
  
  /**
   * Create a new text embeddings generator
   */
  constructor() {
    // Try to load API key from environment
    this.apiKey = process.env.OPENAI_API_KEY || null;
    this.hasOpenAi = !!this.apiKey;
    
    if (!this.hasOpenAi) {
      logger.warn('No OpenAI API key found. Vector search will use simple fallback method.');
    }
  }
  
  /**
   * Generate an embedding for text using OpenAI API
   * @param text The text to embed
   * @returns Embedding vector
   */
  async generateEmbedding(text: string): Promise<Embedding> {
    if (!text || text.trim().length === 0) {
      return { vector: [], size: 0 };
    }
    
    // Generate a hash of the text for caching
    const textHash = this.hashText(text);
    
    // Check if we have this in the cache
    if (this.cache.has(textHash)) {
      return this.cache.get(textHash)!;
    }
    
    // If we have the OpenAI API key, use that
    if (this.hasOpenAi) {
      try {
        const embedding = await this.callOpenAiEmbedding(text);
        this.cache.set(textHash, embedding);
        return embedding;
      } catch (error) {
        logger.error('Error generating OpenAI embedding:', error);
        // Fall back to simpler method
      }
    }
    
    // Fallback to a simpler embedding method
    return this.generateSimpleEmbedding(text);
  }
  
  /**
   * Call OpenAI API to generate embeddings
   * @param text The text to embed
   * @returns Embedding vector
   */
  private async callOpenAiEmbedding(text: string): Promise<Embedding> {
    try {
      const response = await axios.post(
        'https://api.openai.com/v1/embeddings',
        {
          input: text,
          model: this.model
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      if (response.data && response.data.data && response.data.data[0] && response.data.data[0].embedding) {
        const vector = response.data.data[0].embedding;
        return {
          vector,
          size: vector.length
        };
      } else {
        throw new Error('Invalid response format from OpenAI API');
      }
    } catch (error) {
      logger.error('OpenAI API error:', error);
      throw error;
    }
  }
  
  /**
   * Generate a simpler embedding for fallback
   * This is a much more primitive approach, but works without external APIs
   * @param text Text to embed
   * @returns Simple embedding vector
   */
  private generateSimpleEmbedding(text: string): Embedding {
    // Normalize the text
    const normalizedText = text.toLowerCase().trim();
    
    // Create a bag of words representation
    const words = normalizedText.split(/\s+/).filter(w => w.length > 0);
    const wordCounts = new Map<string, number>();
    
    for (const word of words) {
      const count = wordCounts.get(word) || 0;
      wordCounts.set(word, count + 1);
    }
    
    // Convert to a frequency vector (using a fixed size for consistency)
    // In a real implementation, you would use a more sophisticated approach
    const commonWords = [
      'the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'i',
      'it', 'for', 'not', 'on', 'with', 'he', 'as', 'you', 'do', 'at',
      'this', 'but', 'his', 'by', 'from', 'they', 'we', 'say', 'her', 'she',
      'or', 'an', 'will', 'my', 'one', 'all', 'would', 'there', 'their', 'what',
      'so', 'up', 'out', 'if', 'about', 'who', 'get', 'which', 'go', 'me',
      // Add some technical terms that might be relevant
      'function', 'class', 'method', 'api', 'data', 'code', 'object', 'file',
      'system', 'return', 'value', 'type', 'interface', 'string', 'number',
      'array', 'set', 'map', 'import', 'export', 'async', 'await', 'promise',
      'module', 'component', 'library', 'framework', 'plugin', 'adapter',
      'client', 'server', 'database', 'query', 'schema', 'model', 'view',
      'controller', 'event', 'listener', 'handler', 'callback', 'error',
      'exception', 'try', 'catch', 'finally', 'throw', 'log', 'debug', 'warn'
    ];
    
    // Generate a vector of word frequencies
    const vector = commonWords.map(word => (wordCounts.get(word) || 0) / words.length);
    
    // Cache and return the result
    const embedding = { vector, size: vector.length };
    this.cache.set(this.hashText(text), embedding);
    
    return embedding;
  }
  
  /**
   * Calculate cosine similarity between two embeddings
   * @param embedding1 First embedding
   * @param embedding2 Second embedding
   * @returns Similarity score between 0 and 1
   */
  calculateSimilarity(embedding1: Embedding, embedding2: Embedding): number {
    if (embedding1.size === 0 || embedding2.size === 0) {
      return 0;
    }
    
    if (embedding1.size !== embedding2.size) {
      throw new Error('Embeddings must have the same dimensions');
    }
    
    // Calculate dot product
    let dotProduct = 0;
    let magnitude1 = 0;
    let magnitude2 = 0;
    
    for (let i = 0; i < embedding1.size; i++) {
      dotProduct += embedding1.vector[i] * embedding2.vector[i];
      magnitude1 += embedding1.vector[i] * embedding1.vector[i];
      magnitude2 += embedding2.vector[i] * embedding2.vector[i];
    }
    
    magnitude1 = Math.sqrt(magnitude1);
    magnitude2 = Math.sqrt(magnitude2);
    
    if (magnitude1 === 0 || magnitude2 === 0) {
      return 0;
    }
    
    return dotProduct / (magnitude1 * magnitude2);
  }
  
  /**
   * Find the most similar text from a list of candidates
   * @param query The query text
   * @param candidates Array of candidate texts to match against
   * @param limit Maximum number of results to return
   * @returns Array of ranked matches with scores
   */
  async findSimilarTexts(
    query: string,
    candidates: string[],
    limit: number = 5
  ): Promise<Array<{ text: string; score: number }>> {
    if (!query || candidates.length === 0) {
      return [];
    }
    
    // Generate the query embedding
    const queryEmbedding = await this.generateEmbedding(query);
    
    // Score each candidate
    const scores = await Promise.all(
      candidates.map(async text => {
        const embedding = await this.generateEmbedding(text);
        const score = this.calculateSimilarity(queryEmbedding, embedding);
        return { text, score };
      })
    );
    
    // Sort by score descending and limit results
    return scores
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
  
  /**
   * Generate a hash for text to use as a cache key
   * @param text The text to hash
   * @returns MD5 hash of the text
   */
  private hashText(text: string): string {
    return createHash('md5').update(text).digest('hex');
  }
  
  /**
   * Clear the embedding cache
   */
  clearCache(): void {
    this.cache.clear();
  }
} 