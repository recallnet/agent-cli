# Managed Context Provider (MCP)

## Overview

The Managed Context Provider (MCP) is a core component of the Recall CLI that enhances LLM capabilities by providing dynamic access to documentation, code snippets, and other relevant context. The MCP server acts as a knowledge base for the LLM, allowing it to provide more accurate and contextually relevant responses when assisting users with crypto trading agent development.

With the recent implementation of SQLite-based document storage, the MCP now offers persistent storage, improved retrieval performance, and enhanced search capabilities for documentation.

## Key Features

### 1. Documentation Management

- **Multi-Source Documentation**: Fetches documentation from various sources:
  - Eliza plugin registries
  - GitHub repositories
  - Official documentation websites
  - Local documentation files
- **Automatic Updates**: Refreshes documentation when plugins are updated
- **Version Tracking**: Maintains documentation for multiple versions of the same plugin

### 2. Persistent SQLite Storage

- **Database-Backed Storage**: Uses SQLite for reliable, persistent document storage
- **Efficient Retrieval**: Fast access to documentation without repeated fetching
- **Data Integrity**: ACID-compliant storage ensures documentation reliability
- **Cross-Session Persistence**: Documentation remains available between CLI sessions

### 3. Document Processing

- **Chunking**: Breaks documents into smaller pieces for context window limits
- **Metadata Extraction**: Extracts and stores key metadata about documents
- **Format Normalization**: Converts various documentation formats into a standard structure
- **Content Cleaning**: Removes unnecessary HTML, formatting, and boilerplate

### 4. Search Capabilities

- **Keyword Search**: Basic text search across all stored documentation
- **Plugin-Specific Search**: Search within documentation for a specific plugin
- **Vector Search**: (In development) Semantic search using document embeddings
- **Relevance Ranking**: Orders search results by relevance to the query

## Architecture

The MCP consists of the following key components:

### Server Component

The MCP server runs as a local HTTP server that:
- Listens for documentation and search requests
- Manages the SQLite database
- Provides API endpoints for LLM interaction
- Handles document processing and storage

### DocumentStore Class

The `DocumentStore` class manages all interactions with the SQLite database:
- Initializes and maintains the database schema
- Provides methods for storing, retrieving, and searching documents
- Handles chunking and (future) embedding generation
- Implements caching for performance optimization

### Database Schema

The SQLite database uses the following schema:

```sql
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  plugin_name TEXT,
  plugin_version TEXT,
  title TEXT,
  content TEXT,
  source_url TEXT,
  timestamp INTEGER
);

CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY,
  document_id TEXT,
  content TEXT,
  chunk_index INTEGER,
  FOREIGN KEY (document_id) REFERENCES documents(id)
);

CREATE TABLE IF NOT EXISTS embeddings (
  id TEXT PRIMARY KEY,
  chunk_id TEXT,
  embedding BLOB,
  FOREIGN KEY (chunk_id) REFERENCES chunks(id)
);
```

### Plugin Registry Integration

The MCP integrates with the Plugin Registry to:
- Discover available plugins
- Determine documentation sources for each plugin
- Match plugin versions with appropriate documentation
- Scrape documentation from plugin-related URLs

## API Endpoints

The MCP server exposes the following API endpoints:

### Documentation Endpoints

- `GET /docs/search?query={query}`: Search for documentation matching the query
- `GET /docs/{id}`: Get a specific document by ID
- `GET /docs/plugin/{pluginName}`: Get all documents for a specific plugin
- `POST /docs`: Store a new document in the database

### Prometheus Endpoints (For Monitoring)

- `GET /metrics`: Expose Prometheus metrics for monitoring
- `GET /health`: Health check endpoint

## Usage in the Recall CLI

The MCP is used in various parts of the Recall CLI:

### 1. LLM Context Enhancement

When interacting with the LLM for tasks like:
- Building trading strategies
- Recommending plugins
- Debugging agent issues

The MCP provides relevant documentation to enhance the LLM's understanding.

### 2. Plugin Management

When installing or configuring plugins, the MCP:
- Provides plugin documentation to the LLM
- Helps generate proper configuration based on documentation
- Explains plugin features and usage

### 3. Strategy Development

During interactive strategy development, the MCP:
- Provides documentation about trading indicators
- Explains strategy patterns and best practices
- Offers examples of similar strategies

## Implementation Details

### Document Storage Process

1. When a plugin is encountered, the MCP checks if its documentation exists in the database
2. If not, it scrapes documentation from relevant sources
3. The document is processed and stored in the `documents` table
4. The document is chunked into smaller pieces stored in the `chunks` table
5. (Future) Embeddings are generated for each chunk for vector search

### Search Process

1. User or LLM submits a search query
2. MCP searches across document content and metadata
3. Relevant documents are retrieved and ranked
4. Documents are returned in a format suitable for LLM consumption

### Database File Location

The SQLite database is stored at `db/documentation.db` in the Recall CLI installation directory. This location can be configured using the `MCP_DB_PATH` environment variable.

## Configuration Options

The MCP behavior can be modified with the following environment variables:

- `MCP_PORT`: Port for the MCP server (default: 3335)
- `MCP_DB_PATH`: Path to the SQLite database file
- `MCP_CACHE_TTL`: Time-to-live for cached documents in seconds (default: 3600)
- `MCP_LOG_LEVEL`: Logging verbosity (default: 'info')
- `MCP_CHUNK_SIZE`: Size of document chunks in characters (default: 1000)

## Future Enhancements

1. **Vector Search**: Implementation of vector-based semantic search using embeddings
2. **Auto-Embedded Code Examples**: Automatic extraction and embedding of code examples
3. **Hierarchical Document Structure**: Better representation of document relationships
4. **Context-Aware Relevance**: Improved ranking based on user's current context
5. **Multi-Modal Documentation**: Support for images and diagrams in documentation

## Troubleshooting

### Common Issues

1. **Database Corruption**: In rare cases, the database might get corrupted. Delete the database file to reset.
2. **Port Conflicts**: If port 3335 is already in use, set the `MCP_PORT` environment variable to use a different port.
3. **Storage Issues**: Ensure adequate disk space for the SQLite database, especially for large documentation sets.
4. **Memory Usage**: For very large documentation sets, monitor memory usage of the MCP server.

### Debugging

Set the environment variable `MCP_LOG_LEVEL=debug` to enable detailed logging for troubleshooting. 