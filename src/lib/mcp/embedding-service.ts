/**
 * Embedding Service for MCP
 * 
 * Provides a provider-agnostic interface for generating text embeddings
 * with implementations for OpenAI and Anthropic
 */

import axios from 'axios';
import Conf from 'conf';
// Remove unused import
// import { v4 as uuidv4 } from 'uuid';

// Create config store
const config = new Conf({
  projectName: 'recall-cli'
});

/**
 * Interface for embedding vector
 */
export interface Embedding {
  vector: number[];
  dimensions: number;
}

/**
 * Abstract base class for embedding providers
 */
export abstract class EmbeddingProvider {
  protected apiKey: string;
  
  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }
  
  /**
   * Generate an embedding for the given text
   */
  abstract generateEmbedding(text: string): Promise<Embedding>;
  
  /**
   * Generate embeddings for multiple texts in batch
   */
  async generateEmbeddings(texts: string[]): Promise<Embedding[]> {
    // Default implementation processes one at a time
    // Providers can override for more efficient batch processing
    const embeddings: Embedding[] = [];
    
    for (const text of texts) {
      const embedding = await this.generateEmbedding(text);
      embeddings.push(embedding);
    }
    
    return embeddings;
  }
}

/**
 * OpenAI embedding provider
 */
export class OpenAIEmbeddingProvider extends EmbeddingProvider {
  private model: string;
  private baseUrl: string;
  
  constructor(apiKey: string, model: string = 'text-embedding-3-small') {
    super(apiKey);
    this.model = model;
    this.baseUrl = 'https://api.openai.com/v1/embeddings';
  }
  
  async generateEmbedding(text: string): Promise<Embedding> {
    try {
      const response = await axios.post(
        this.baseUrl,
        {
          model: this.model,
          input: text,
          encoding_format: 'float'
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      const data = response.data;
      return {
        vector: data.data[0].embedding,
        dimensions: data.data[0].embedding.length
      };
    } catch (error: unknown) {
      console.error('Error generating OpenAI embedding:', error);
      throw new Error(`Failed to generate embedding: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  async generateEmbeddings(texts: string[]): Promise<Embedding[]> {
    try {
      const response = await axios.post(
        this.baseUrl,
        {
          model: this.model,
          input: texts,
          encoding_format: 'float'
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      const data = response.data;
      return data.data.map((item: any) => ({
        vector: item.embedding,
        dimensions: item.embedding.length
      }));
    } catch (error: unknown) {
      console.error('Error generating OpenAI embeddings in batch:', error);
      // Fall back to individual processing
      return super.generateEmbeddings(texts);
    }
  }
}

/**
 * Anthropic embedding provider
 */
export class AnthropicEmbeddingProvider extends EmbeddingProvider {
  private model: string;
  private baseUrl: string;
  
  constructor(apiKey: string, model: string = 'claude-3-haiku-20240307') {
    super(apiKey);
    this.model = model;
    this.baseUrl = 'https://api.anthropic.com/v1/embeddings';
  }
  
  async generateEmbedding(text: string): Promise<Embedding> {
    try {
      const response = await axios.post(
        this.baseUrl,
        {
          model: this.model,
          input: text
        },
        {
          headers: {
            'x-api-key': this.apiKey,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json'
          }
        }
      );
      
      const data = response.data;
      return {
        vector: data.embedding,
        dimensions: data.embedding.length
      };
    } catch (error: unknown) {
      console.error('Error generating Anthropic embedding:', error);
      throw new Error(`Failed to generate embedding: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

/**
 * Factory for creating embedding providers
 */
export class EmbeddingProviderFactory {
  /**
   * Create an embedding provider based on the configured LLM provider
   */
  static createFromConfig(): EmbeddingProvider {
    const provider = config.get('llm.provider') as string;
    const apiKey = config.get(`llm.${provider}.apiKey`) as string;
    
    if (!apiKey) {
      throw new Error(`API key not found for provider: ${provider}`);
    }
    
    return this.createProvider(provider, apiKey);
  }
  
  /**
   * Create an embedding provider for the specified provider and API key
   */
  static createProvider(provider: string, apiKey: string): EmbeddingProvider {
    switch (provider.toLowerCase()) {
    case 'openai':
      return new OpenAIEmbeddingProvider(apiKey);
    case 'anthropic':
      return new AnthropicEmbeddingProvider(apiKey);
    default:
      throw new Error(`Unsupported embedding provider: ${provider}`);
    }
  }
}

/**
 * Embedding service for document chunks
 */
export class EmbeddingService {
  private provider: EmbeddingProvider;
  
  constructor(provider?: EmbeddingProvider) {
    this.provider = provider || EmbeddingProviderFactory.createFromConfig();
  }
  
  /**
   * Generate an embedding for a single text
   */
  async generateEmbedding(text: string): Promise<Embedding> {
    return this.provider.generateEmbedding(text);
  }
  
  /**
   * Generate embeddings for multiple texts
   */
  async generateEmbeddings(texts: string[]): Promise<Embedding[]> {
    return this.provider.generateEmbeddings(texts);
  }
  
  /**
   * Calculate cosine similarity between two vectors
   */
  calculateCosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error('Vectors must have the same dimensions');
    }
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    
    normA = Math.sqrt(normA);
    normB = Math.sqrt(normB);
    
    if (normA === 0 || normB === 0) {
      return 0;
    }
    
    return dotProduct / (normA * normB);
  }
} 