# AI Model Task: Build an Automated CLI for Crypto Trading Signal Agents

You are an AI assistant specializing in automation, agent development, and structured data generation. Your task is to create a fully automated CLI tool for crypto trading opportunity detection agents using the Recall Agent Starter Kit and the Eliza Plugin ecosystem.

## IMPORTANT: Core Design Principles

### Dynamic Configuration - NEVER Hardcode

The CLI **MUST ALWAYS** be designed to work with fully dynamic configuration:

1. **NO HARDCODED PLUGINS OR ENVIRONMENT VARIABLES**
   - The system must never contain hardcoded lists of plugins, environment variables, or configuration values
   - All plugin detection must happen dynamically through registry queries, not predefined lists
   - All environment variable discovery must come from documentation analysis, not predefined mappings
   - The system must adapt to new plugins being added to the ecosystem without code changes

2. **Dynamic Documentation Discovery**
   - Documentation must be fetched dynamically from repositories, registries, and documentation sites
   - No documentation content should be embedded in the code
   - The system should use the MCP server to intelligently retrieve and process documentation

3. **User-Selected Components Only**
   - Only process and configure plugins explicitly selected by the user during the setup process
   - Base components that are part of the starter kit should not be analyzed unless specifically needed

4. **Fully Adaptable Workflow**
   - The CLI must work with any project name or directory structure
   - All paths should be resolved dynamically relative to the chosen project directory
   - No assumptions should be made about specific file locations or naming conventions beyond what's in the starter kit

These principles ensure the CLI remains maintainable, scalable, and adaptable to changes in the plugin ecosystem without requiring code updates.

## LLM Integration & MCP Server

The CLI tool will integrate with LLM providers (OpenAI or Anthropic) to assist users throughout the setup process:

1. **API Key Authentication**
   - Prompt the user to input either their OpenAI or Anthropic API key
   - Validate the key before proceeding
   - Store securely for use during the setup process

2. **MCP Server Creation**
   - Automatically set up a Managed Context Provider (MCP) server to assist the LLM
   - The MCP server will dynamically fetch relevant documentation from:
     - Recall Agent Starter Kit repository
     - Eliza Plugin registry documentation
     - Plugin-specific documentation
     - Crypto trading APIs and related tooling
   - Feed this contextual information to the LLM during user interactions to provide more accurate assistance
   - Cache frequently accessed documentation to reduce latency

3. **Competition Specification**
   - Ask if the user is building for a specific agent competition
   - If yes, prompt for the competition specification URL
   - Fetch and parse the specification to understand requirements
   - Use the competition details to guide plugin selection and agent configuration

## Step 1: Plugin Metadata Extraction & Versioning
The system will analyze all available Eliza plugins from the Eliza Plugin Registry and generate a structured plugins.json file containing the following information for each plugin:

- Plugin Name & Description
- Installation Instructions (how to install it within a Recall-based agent)
- Import Methods (how to correctly import the plugin into an agent)
- Available Functions (method signatures, expected inputs/outputs)
- API Specifications (if the plugin has an API, extract and consolidate its available calls)
- Compatible Versions (ensure that all function signatures are tied to the correct version of the plugin)
- Update Mechanism (script to check for new versions and refresh plugins.json accordingly)
- Required ENV vars

This information should be kept up to date with a script that can periodically scan for new versions and update plugins.json accordingly.

## Step 2: Automated Setup for a Crypto Trading Signal Detection Agent
Once the plugin metadata is structured, the CLI tool should enable users to launch a crypto trading signals agent using a guided, interactive process:

1. **Clone & Initialize the Recall Agent Starter Kit**
   - Clone https://github.com/recallnet/recall-agent-starter using SSH into a new project folder
   - Check prerequisites:
     - Node.js v22+
     - pnpm package manager
     - Any additional dependencies required by selected plugins

2. **Interactive Environment Configuration**
   - Prompt the user for necessary environment variables, including:
     - AI Model API Keys (OpenAI, Anthropic, etc.)
     - Wallet Private Key (for crypto funding)
     - Recall Network Credentials (private key, bucket name)
   - Guide the user through funding their wallet via a crypto faucet
   - A root dir .env, if present, may provide default env vars for the user to reuse

3. **LLM-Assisted Plugin Selection & Installation**
   - Use the integrated LLM to recommend plugins based on:
     - User's stated trading goals
     - Competition requirements (if applicable)
     - Available plugins from plugins.json
   - Allow the user to select trading-relevant plugins
   - Install and correctly configure those plugins in the new agent's npm packages
   - The standard way of doing this is: `npx elizaos plugins add @elizaos-plugins/plugin-NAME` (adapt for pnpm)
   - Ensure that the plugin version matches what's stored in plugins.json or update plugins.json
   - Create scaffolding that matches the Eliza project structure

4. **Agent Character Configuration**
   - Prompt the user to define the agent's name, purpose, and personality in a character JSON file
   - The character should be stored in the characters/ directory of the project
   - Provide good defaults for the user
   - Use the LLM to suggest improvements to the character based on trading strategy

5. **LLM-Assisted Strategy Implementation**
   - Use the LLM to help the user define their trading strategy through interactive prompts
   - Convert the strategy description into executable agent logic
   - Implement agent logic for crypto trading signals that:
     - Uses installed Eliza plugins to pull relevant market feeds
     - Matches incoming data to the user's specified trading strategy
     - Detects and logs high-value trading opportunities
     - Stores insights as structured JSON objects in the Recall bucket
     - Displays alerts via logs for real-time monitoring
   - Update appropriate files in the project structure:
     ```
     ├── src/
     │   ├── index.ts # Main plugin entry and agent logic
     │   ├── actions/ # Custom actions
     │   ├── providers/ # Data providers
     │   ├── types.ts # Type definitions
     │   └── environment.ts # Configuration
     ```
   - Reuse the import method for recall from the included directory without modifying the custom recall methods

6. **Running & Managing the Agent**
   - Launch the agent using the correct command from index.ts
   - If the setup script is re-run, it should:
     - Prompt the user to create a new agent OR update an existing one
   - Provide visualization of agent performance and alerts

## Step 3: LLM-Powered Strategy Refinement

The CLI will use the provided API key to assist in refining and optimizing the trading strategy:

1. **Strategy Definition**
   - Use an interactive dialogue to help the user describe their alpha detection method
   - The LLM will ask clarifying questions to refine the strategy

2. **Code Generation**
   - Convert the user's strategy prompt into executable agent logic
   - Use templates for skills and functions
   - Generate code that integrates seamlessly into index.ts
   - Present the generated code to the user for review and approval

3. **Optimization Suggestions**
   - Analyze the strategy for potential improvements
   - Suggest optimizations based on best practices
   - Provide backtesting scenarios when possible

## Expected Outputs

- **plugins.json** – A structured reference of all Eliza plugins, including install instructions, function signatures, API specs, and version tracking
- **cli-tool** – A fully featured CLI that guides users through the setup process, leveraging LLM assistance
- **mcp-server** – A context provider that enhances LLM capabilities by fetching relevant documentation
- **agent-environment** – A complete agent environment configured according to user preferences and competition requirements
- **monitoring-dashboard** – Tools for visualizing agent performance and alerts

## Final Considerations

- The CLI should provide a no-code experience for users while leveraging code generation behind the scenes
- All LLM interactions should be seamless and contextually aware
- The MCP server should intelligently cache documentation to reduce API costs
- The setup should be modular, allowing users to easily extend or customize their agents
- The script should handle error cases gracefully, providing clear guidance on missing dependencies or misconfigurations
- Ensure compatibility with macOS and Linux (Windows support optional)