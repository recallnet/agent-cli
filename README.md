# Recall CLI

A command-line tool for creating and managing crypto trading signal detection agents using the Recall Agent Starter Kit and the Eliza Plugin ecosystem.

## Features

- 🚀 **Quick Setup**: Initialize trading agent projects with a single command
- 🔌 **Plugin Management**: Easily discover, install, and manage Eliza plugins for crypto trading
- 🧠 **LLM Integration**: Leverage OpenAI or Anthropic models for strategy refinement
- 🤝 **Smart Recommendations**: Get AI-powered plugin recommendations based on your strategy
- 📚 **Documentation Context**: Access contextual documentation via the MCP server
- 📝 **Code Understanding**: Explore plugin codebases and get integration guidance
- 🤖 **Agent Creation**: Interactive agent configuration with LLM-assisted strategy implementation
- 📊 **Monitoring**: Track and visualize agent performance
- 🔍 **Strategy-Aware Plugin Selection**: Automatically recommend and select plugins based on your trading strategy

## Implementation Status

- ✅ Complete LLM integration with both OpenAI and Anthropic
- ✅ Complete Plugin Management System with dependency resolution
- ✅ Basic CLI framework
- ✅ Character and strategy generators with LLM assistance
- ✅ Agent creation and execution commands
- ✅ MCP server for documentation retrieval
- ✅ LLM-assisted plugin recommendations
- ✅ Code exploration and understanding
- ⏳ Agent Strategy Optimization (TODO)
- ⏳ Testing and distribution (TODO)

## Installation

### Prerequisites

- Node.js v22+
- pnpm package manager

### Install from NPM

```bash
npm install -g recall-cli
```

### Install from Source

```bash
# Clone this repository
git clone https://github.com/yourusername/recall-cli.git

# Navigate to the project directory
cd recall-cli

# Install dependencies
npm install

# Build the project
npm run build

# Link for local development
npm link
```

## Usage

### Initialize a New Project

```bash
recall-cli init my-trading-agent
```

This command creates a new project directory and sets up the Recall Agent Starter Kit.

### Configure LLM Provider

```bash
recall-cli llm set-key
```

Follow the interactive prompts to set up your OpenAI or Anthropic API key.

You can also directly specify your preferred provider:

```bash
recall-cli llm set-key openai
# or
recall-cli llm set-key anthropic
```

### Test LLM Connection

```bash
recall-cli llm test
```

Test your configured LLM provider with a simple prompt.

### Generate Code with LLM

```bash
recall-cli llm generate-code "A function that fetches cryptocurrency prices"
```

Generate code snippets using the configured LLM.

### Plugin Management

Explore available plugins:

```bash
recall-cli plugin list
```

Filter plugins by category:

```bash
recall-cli plugin list --category trading
```

View detailed plugin information:

```bash
recall-cli plugin info crypto-market-data
```

Install a plugin:

```bash
recall-cli plugin install crypto-market-data
```

Visualize plugin dependencies:

```bash
recall-cli plugin deps crypto-market-data
```

Update all installed plugins:

```bash
recall-cli plugin update
```

### Get AI-Powered Plugin Recommendations

Get plugin recommendations based on your trading strategy:

```bash
# Interactive mode - describe your strategy in an editor
recall-cli plugin recommend --interactive

# From a strategy file
recall-cli plugin recommend --strategy path/to/strategy.md

# Based on competition guidelines
recall-cli plugin recommend --competition crypto-volatility
```

This feature uses the LLM to analyze your strategy and recommend appropriate plugins, including detailed reasoning for each recommendation.

### Plugin Implementation Understanding

Get detailed guidance on how to implement and integrate a plugin:

```bash
recall-cli plugin understand crypto-market-data
```

This provides:
- Explanation of what the plugin does and its main features
- Core classes/functions and their purposes
- Step-by-step integration instructions
- Implementation examples and best practices

### Plugin Usage Examples

Generate practical usage examples for a plugin:

```bash
recall-cli plugin examples exchange-connector
```

This provides:
- Simple standalone examples
- Integration examples with other plugins
- Complete agent implementation examples
- Error handling patterns
- Usage patterns for different scenarios

### Analyze and Improve Plugin-Related Code

Get insights and improvement suggestions for your code:

```bash
# From a file
recall-cli plugin analyze-code --file path/to/code.ts

# Interactive mode
recall-cli plugin analyze-code --interactive

# Specify language
recall-cli plugin analyze-code --file path/to/code.py --language python
```

This provides:
- Code explanation
- Potential issues and edge cases
- Improvement suggestions
- Best practices
- Enhanced code versions

### Managed Context Provider (MCP) Server

The MCP server provides documentation and context to the LLM:

```bash
# Start the MCP server
recall-cli mcp --start

# Start on a specific port
recall-cli mcp --start --port 4444

# Stop the MCP server
recall-cli mcp --stop
```

The MCP server automatically starts when needed for features that use it, such as plugin recommendations.

### Create an Agent

```bash
recall-cli agent create
```

Follow the interactive prompts to configure your trading agent strategy.

### Run an Agent

```bash
recall-cli agent run
```

Start your trading agent to begin monitoring market conditions and detecting trading signals.

### Build a Trading Strategy

Create a trading strategy with AI assistance:

```bash
recall-cli strategy build
```

This interactive process:
1. Guides you through strategy development with targeted questions
2. Uses the LLM to refine and optimize your strategy
3. Automatically recommends plugins based on your strategy's requirements
4. Generates implementation code using the selected plugins
5. Creates all necessary strategy files

You can also specify plugins manually if preferred:

```bash
recall-cli strategy build --plugins crypto-market-data,trading-signals,risk-management
```

Export a strategy to Starter Kit format:

```bash
recall-cli strategy export path/to/strategy.json
```

## Next Steps

1. **Enhance Agent Initialization**: Improve integration with actual Recall Agent Starter Kit
2. **Competition Analysis**: Add capability to analyze competition requirements automatically
3. **Agent Execution & Monitoring**: Add performance metrics and visualization
4. **Testing Framework**: Add comprehensive tests for all components
5. **Documentation Improvement**: Add more detailed docs for each command and feature

## Plugin Ecosystem

Recall CLI integrates with the Eliza Plugin ecosystem to provide powerful capabilities for crypto trading agents:

- **crypto-market-data**: Real-time cryptocurrency market data
- **trading-signals**: Generate trading signals based on market conditions
- **risk-management**: Trading risk and position sizing management
- **exchange-connector**: Connect to various cryptocurrency exchanges
- **strategy-backtest**: Backtest strategies with historical data

## Documentation

For detailed documentation, see the [docs](./docs) directory:

- [Project Overview](./docs/project-overview.md)
- [Development Plan](./docs/dev-plan.md)
- [Instructions](./docs/instructions.md)
- [Implementation Summary](./docs/implementation-summary.md)

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