# Competition Integration Guide

## Overview

The Recall CLI now includes a powerful feature that helps you create trading agents specifically optimized for cryptocurrency trading competitions. This integration allows you to:

1. Parse competition rules and guidelines from a URL
2. Generate strategies tailored to the competition requirements
3. Get AI-recommended plugins based on competition needs
4. Create agents with competition-specific parameters
5. Save all competition information for reference

## How It Works

The competition integration leverages the MCP server and LLM capabilities to analyze competition specifications and generate competition-optimized agents.

### Step 1: Parse Competition URL

When you provide a URL to competition guidelines, the system:
- Fetches the content using the MCP server
- Parses the text to identify key competition parameters
- Extracts rules, constraints, metrics, and requirements

### Step 2: Generate Optimized Strategy

Using the extracted information, the LLM:
- Creates a trading strategy aligned with competition goals
- Ensures the strategy complies with competition rules
- Optimizes for the specific performance metrics
- Adapts to competition timeframes and market constraints

### Step 3: Recommend Plugins

Based on the competition requirements, the system:
- Identifies the most appropriate plugins
- Provides confidence scores for each recommendation
- Explains how each plugin helps with competition performance
- Prioritizes plugins based on competition needs

### Step 4: Create Competition-Optimized Agent

The system then creates an agent that:
- Has competition-specific rules and goals
- Is configured according to competition parameters
- Includes optimized character traits
- Uses the recommended plugins

## Usage

### Basic Command

```bash
recall-cli agent create --competition-url <url-to-competition-guidelines>
```

### Example

```bash
recall-cli agent create --competition-url https://example.com/crypto-competition-2024.md
```

### Options

You can combine the competition URL with other options:

```bash
recall-cli agent create --competition-url <url> --name <custom-name> --force
```

## Competition Guidelines Format

The competition guidelines can be in any text format (Markdown recommended) as long as they include information about:

1. **Competition Rules**: Trading constraints, limitations, requirements
2. **Market Coverage**: Available trading pairs and exchanges  
3. **Performance Metrics**: How agents will be evaluated
4. **Time Parameters**: Competition duration and evaluation periods
5. **Technical Requirements**: API limitations, data availability, etc.

## Example Competition Specification

Here's an example format for competition guidelines:

```markdown
# Cryptocurrency Trading Competition

## Overview
[Brief description of the competition]

## Competition Period
- Start Date: [date]
- End Date: [date]
- Evaluation Frequency: [frequency]

## Trading Rules
- Available Pairs: [list of pairs]
- Position Sizing: [rules]
- Risk Limits: [limits]
- Trading Frequency: [constraints]

## Performance Metrics
- Metric 1: [description and weight]
- Metric 2: [description and weight]
- ...

## Technical Requirements
[Technical specifications and constraints]

## Submission Requirements
[What needs to be submitted]

## Prizes
[Prize structure]
```

## Competition-Based Agent Structure

When you create a competition-based agent, the CLI:

1. Creates a standard agent project structure
2. Adds a `competition` directory containing:
   - `info.json`: Competition details and parsed information
   - `guidelines.md`: Original competition guidelines
3. Generates a character file with competition-specific traits
4. Creates a strategy optimized for the competition metrics

## Best Practices

1. **Validate the Strategy**: Always review the generated strategy to ensure it aligns with the competition requirements
2. **Check Plugin Recommendations**: Verify the recommended plugins are appropriate
3. **Review Competition Parameters**: Ensure all competition rules have been properly interpreted
4. **Test Before Submission**: Thoroughly test the agent before submitting to the competition

## Troubleshooting

**Problem**: Competition parsing fails
**Solution**: Ensure the URL is accessible and the document is in a readable format. Try providing the competition rules as a local file.

**Problem**: Generated strategy doesn't align with competition rules
**Solution**: Competition guidelines may be ambiguous. Modify the strategy manually or try rephrasing the competition guidelines.

**Problem**: Recommended plugins don't match competition needs
**Solution**: You can manually select plugins during the interactive process, even if using competition guidelines.

## Limitations

- The system may not perfectly interpret highly complex or ambiguous competition rules
- Some niche competition requirements may need manual adjustment
- Competition guidelines in formats other than text/markdown may not be parsed correctly 