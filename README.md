# Recall CLI

A command-line interface (CLI) tool for creating and managing crypto trading signal detection agents. This tool leverages the Recall Agent Starter Kit and the Eliza Plugin ecosystem to provide a streamlined experience for users who want to create automated trading agents.

## Features

- **Agent Creation & Management**: Create, configure, and run crypto trading agents
- **LLM Integration**: Support for OpenAI and Anthropic models for intelligent assistance
- **Managed Context Provider (MCP)**: Dynamic documentation and context management for enhanced LLM capabilities
- **Interactive Strategy Builder**: Create and refine trading strategies through guided conversations
- **Plugin Management**: Discover, install, and manage plugins from the Eliza ecosystem
- **Environment Configuration**: Automatically detect and configure required environment variables
- **Competition Integration**: Create agents optimized for specific trading competitions

## Installation

### Prerequisites

- Node.js v18+
- npm or pnpm package manager
- Git (for cloning repositories)

### Setup

```bash
# Clone the repository
git clone https://github.com/yourusername/recall-cli.git
cd recall-cli

# Install dependencies
npm install
# or with pnpm
pnpm install

# Build the CLI
npm run build
# or with pnpm
pnpm build

# Link for global usage (optional)
npm link
# or with pnpm
pnpm link --global
```

## Usage

### Agent Creation

Create a new trading agent:

Ensure that you `cd` back to your machine's root directory or outside of this CLI directory before testing creating a project.

```bash
recall-cli start project-name
```

This interactive command will guide you through:
- Selecting a trading strategy
- Choosing required plugins
- Configuring agent parameters
- Setting up the environment

### Interactive Strategy Building

Build a trading strategy through a guided conversation:

```bash
recall-cli strategy build
```

### LLM Configuration

Configure your preferred LLM provider:

```bash
recall-cli llm setup
```

## Project Structure

```
recall-cli/
├── src/                   # Source code
│   ├── index.ts           # Main entry point
│   └── lib/               # Core libraries
│       ├── agent/         # Agent setup and management
│       ├── cli/           # CLI commands implementation
│       ├── llm/           # LLM provider integrations
│       ├── mcp/           # Managed Context Provider
│       ├── plugins/       # Plugin management
│       ├── strategy/      # Strategy generation
│       └── utils/         # Utility functions
├── dist/                  # Compiled output
├── docs/                  # Documentation
└── test/                  # Tests
```

## Key Components

### 1. Managed Context Provider (MCP)

The MCP server provides context management for LLMs to improve their capabilities:
- Fetches and indexes relevant documentation
- Stores documents in a SQLite database for persistence
- Provides vector search capabilities
- Optimizes documentation retrieval for specific contexts

### 2. LLM Integration

The LLM integration system provides a unified interface for different LLM providers:
- Abstraction layer for multiple providers (OpenAI, Anthropic)
- Secure credential management
- Optimized prompt construction
- Context-aware responses

### 3. Plugin Management

The plugin management system integrates with the Eliza ecosystem:
- Registry integration
- Dependency resolution
- Version management
- Environment configuration

### 4. Agent Management

The agent management system handles the creation and execution of trading agents:
- Project initialization
- Character generation
- Strategy implementation
- Environment configuration

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License 