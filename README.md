# Recall CLI

A fully automated Command Line Interface (CLI) tool for creating and managing crypto trading signal detection agents. This tool leverages the Recall Agent Starter Kit and the Eliza Plugin ecosystem to provide a streamlined experience for users who want to create automated trading agents.

## Features

- **All-in-One Setup Workflow**: Single command to handle everything from LLM configuration to agent setup
- **Interactive Agent Setup**: Guided workflow for setting up crypto trading agents
- **LLM Integration**: OpenAI and Anthropic support for intelligent assistance
- **Managed Context Provider (MCP)**: Dynamic documentation fetching for enhanced LLM capabilities
- **Plugin Management**: Discover, recommend, and install plugins based on your strategy
- **Strategy Builder**: Create and refine trading strategies with LLM guidance
- **Environment Configuration**: Automatically set up and validate your environment

## Prerequisites

- Node.js v22+
- pnpm package manager
- Git

## Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/recall-cli.git
cd recall-cli

# Install dependencies
pnpm install

# Build the CLI
pnpm build

# Create a symlink to use the CLI globally
pnpm link --global
```

## Getting Started

### Unified Setup Workflow (Recommended)

The easiest way to get started is with our all-in-one setup command:

```bash
recall-cli start my-trading-agent
```

This single command will:
1. Guide you through LLM provider configuration (OpenAI or Anthropic)
2. Initialize a new project with the Recall Agent Starter Kit
3. Launch the interactive setup assistant
4. Help you define your trading strategy
5. Recommend and install appropriate plugins
6. Configure your agent's character and environment

If you want to set up an agent in an existing directory, just run:

```bash
cd existing-project
recall-cli start
```

### Alternative: Step-by-Step Setup

If you prefer to go through the steps individually:

#### 1. Configure LLM Provider

First, configure your preferred LLM provider:

```bash
recall-cli llm config --provider openai --api-key your-api-key
```

Or:

```bash
recall-cli llm config --provider anthropic --api-key your-api-key
```

#### 2. Initialize a New Project

Create a new agent project:

```bash
recall-cli init my-crypto-agent
```

#### 3. Run Interactive Setup

Then run the setup assistant:

```bash
cd my-crypto-agent
recall-cli setup
```

### Plugin Management

List available plugins:

```bash
recall-cli plugin list
```

Get recommendations based on strategy:

```bash
recall-cli plugin recommend --interactive
```

### Strategy Building

Build a trading strategy interactively:

```bash
recall-cli strategy build
```

## End-to-End Example

```bash
# All-in-one setup workflow (recommended)
recall-cli start btc-momentum-agent

# Follow the interactive prompts to:
# 1. Configure your LLM provider (OpenAI or Anthropic)
# 2. Define your trading goals (e.g., "I want to build a momentum strategy for Bitcoin")
# 3. Select recommended plugins
# 4. Configure your agent character
# 5. Set up environment variables

# Move to the created project
cd btc-momentum-agent

# Install dependencies
pnpm install

# Start your agent
pnpm start
```

## Development

### Project Structure

```
recall-cli/
├── src/                 # Source code
│   ├── index.ts         # CLI entry point
│   └── lib/             # Core modules
│       ├── agent/       # Agent setup and management
│       ├── cli/         # CLI commands
│       ├── llm/         # LLM provider integrations
│       ├── mcp/         # Managed Context Provider
│       ├── plugins/     # Plugin management
│       ├── strategy/    # Strategy implementation
│       └── utils/       # Utility functions
├── scripts/             # Development scripts
├── dist/                # Compiled output
├── docs/                # Documentation
├── test/                # Unit tests
└── tests/               # Integration tests
```

### Running Tests

```bash
# Run unit tests
pnpm test

# Run integration tests
pnpm test:integration

# Test the setup workflow
pnpm test:setup
```

## Recent Improvements

### 1. All-in-One Setup Workflow

We've added a new unified setup workflow with a single command:
- Configure LLM provider and project setup in one flow
- Streamlined user experience with fewer commands
- Improved guidance throughout the entire process
- Support for both new projects and existing directories

### 2. Enhanced Plugin Integration

We've improved the plugin integration system to:
- Automatically resolve plugin dependencies
- Generate intelligent plugin configurations using LLM
- Update project imports and configuration automatically
- Provide better error handling and recovery

### 3. Improved Agent Setup Workflow

The agent setup workflow now:
- Provides a more interactive and user-friendly experience
- Offers better recommendations based on trading goals
- Handles environment configuration more robustly
- Integrates seamlessly with the plugin system

### 4. End-to-End Testing

Added comprehensive testing for the entire setup workflow to ensure reliability.

## License

MIT 

# Competition Integration

The CLI now supports creating agents optimized for specific trading competitions:

```bash
# Create an agent based on competition specifications from a URL
recall-cli agent create --competition-url https://example.com/competition-spec.md
```

This will:
1. Fetch and analyze the competition specifications
2. Generate an optimized trading strategy based on the competition rules
3. Recommend the most appropriate plugins for the competition
4. Create an agent with competition-specific parameters
5. Save the competition guidelines for reference

The system leverages the MCP server and LLM to:
- Understand competition-specific rules and constraints
- Generate strategies tailored to the competition metrics
- Select plugins that align with the competition needs
- Create agents optimized for competition performance

This feature streamlines the process of creating competitive trading agents for specific competitions.

# Interactive Strategy Development

The CLI now includes an interactive strategy development feature that guides you through creating sophisticated trading strategies:

```bash
# Build a trading strategy interactively
recall-cli strategy build

# Build with specific options
recall-cli strategy build --output ./my-strategies --plugins crypto-market-data,trading-signals

# Build a strategy compatible with the Recall Starter Kit
recall-cli strategy build --starter-kit
```

This feature provides:

1. **Guided Conversation**: An LLM-powered conversation that asks targeted questions to refine your strategy
2. **Strategic Refinement**: Expert recommendations tailored to your trading goals and preferences
3. **Code Generation**: Complete implementation code for your strategy
4. **Starter Kit Compatibility**: Optional Recall Starter Kit configuration generation

The interactive strategy builder is designed to work for users of all experience levels:
- **Beginners**: Get expert guidance on building effective strategies
- **Intermediate**: Refine your existing strategies with AI assistance
- **Advanced**: Quickly prototype new ideas with detailed implementation

This feature uses the MCP server to provide rich context about trading strategies, indicators, and best practices. 