# Interactive Strategy Builder Guide

## Overview

The Interactive Strategy Builder is a core feature of the Recall CLI that guides users through creating sophisticated trading strategies through a conversation with an LLM. This approach combines the expertise of AI with the user's trading goals to generate effective, customized strategies.

## Key Features

- **Guided Conversation**: An LLM-powered conversation flow that asks targeted questions to understand your trading goals and preferences
- **Strategy Templates**: Support for various strategy types, including trend-following, mean-reversion, momentum, and more
- **Code Generation**: Automatic generation of implementation code based on your specifications
- **Plugin Integration**: Recommends appropriate plugins and integrates them into your strategy
- **Starter Kit Compatibility**: Creates strategies compatible with the Recall Agent Starter Kit
- **Documentation Generation**: Produces clear documentation for your strategy's approach and parameters

## Usage

### Basic Usage

To start building a strategy interactively:

```bash
recall-cli strategy build
```

This will launch the interactive builder with default settings.

### Advanced Options

```bash
# Build with specific output directory
recall-cli strategy build --output ./my-strategies

# Build with specific plugins
recall-cli strategy build --plugins ccxt,trading-signals

# Build a strategy compatible with the Recall Starter Kit
recall-cli strategy build --starter-kit

# Build with a specific LLM provider
recall-cli strategy build --provider anthropic
```

## The Strategy Building Process

### 1. Strategy Type Selection

The process begins by asking you to select a general strategy type:
- Trend-following strategies
- Mean-reversion strategies
- Momentum strategies
- Breakout strategies
- Pattern recognition strategies
- Volatility-based strategies
- Custom strategy approach

### 2. Guided Conversation

The LLM will engage in a conversation to understand:
- Your specific trading goals
- Asset preferences (cryptocurrencies, pairs)
- Timeframe preferences
- Risk tolerance
- Technical indicators you're interested in
- Any specific market conditions you want to target

### 3. Strategy Generation

Based on your inputs, the LLM will:
- Design a strategy that meets your requirements
- Recommend appropriate indicators and parameters
- Explain the reasoning behind the strategy
- Discuss potential strengths and weaknesses

### 4. Code Generation

The system will generate:
- Implementation code for your strategy
- Entry and exit logic
- Signal generation functions
- Position sizing recommendations
- Risk management approaches

### 5. Integration with Agent Creation

Once your strategy is generated, you can:
- Save it to a file for later use
- Directly integrate it with the agent creation process
- Modify and refine it further

## Example: Building a Simple Moving Average Crossover Strategy

Here's an example of building a simple moving average crossover strategy:

1. **Initial Prompt**: "I want to build a strategy for Bitcoin that uses moving average crossovers"

2. **LLM Response**: The LLM will ask clarifying questions:
   - "What timeframe would you like to trade on?"
   - "Would you prefer traditional SMAs or exponential EMAs?"
   - "What periods would you like to use for your moving averages?"
   - "How would you like to handle risk management?"

3. **User Responses**: You provide your preferences through the conversation.

4. **Strategy Summary**: The LLM summarizes the strategy:
   ```
   Moving Average Crossover Strategy for BTC/USD
   - Timeframe: 4-hour candles
   - Short EMA: 9 periods
   - Long EMA: 21 periods
   - Entry: Buy when short EMA crosses above long EMA
   - Exit: Sell when short EMA crosses below long EMA
   - Position Sizing: 5% of available capital per trade
   - Stop Loss: 2% below entry price
   ```

5. **Code Generation**: The system generates the implementation code:
   ```javascript
   // Example code snippet
   class MovingAverageCrossoverStrategy {
     constructor(shortPeriod = 9, longPeriod = 21) {
       this.shortPeriod = shortPeriod;
       this.longPeriod = longPeriod;
       this.previousCrossState = null;
     }
     
     async analyze(marketData) {
       const closes = marketData.map(candle => candle.close);
       
       // Calculate EMAs
       const shortEMA = calculateEMA(closes, this.shortPeriod);
       const longEMA = calculateEMA(closes, this.longPeriod);
       
       // Determine current cross state
       const currentCrossState = shortEMA[shortEMA.length - 1] > longEMA[longEMA.length - 1];
       
       // Generate signals
       let signal = null;
       if (this.previousCrossState !== null) {
         if (!this.previousCrossState && currentCrossState) {
           signal = 'buy';
         } else if (this.previousCrossState && !currentCrossState) {
           signal = 'sell';
         }
       }
       
       // Update state
       this.previousCrossState = currentCrossState;
       
       return {
         signal,
         metadata: {
           shortEMA: shortEMA[shortEMA.length - 1],
           longEMA: longEMA[longEMA.length - 1],
           crossState: currentCrossState
         }
       };
     }
   }
   ```

6. **Integration**: The strategy can then be integrated with your agent.

## Best Practices

- **Be Specific**: The more specific you are about your goals and preferences, the better the generated strategy
- **Ask Questions**: Feel free to ask the LLM to explain aspects of the strategy you don't understand
- **Iterate**: Don't be afraid to restart the process if you want to explore different approaches
- **Review the Code**: Always review the generated code and understand how it works before deploying
- **Consider Testing**: Before using the strategy with real funds, test it with historical data or in a paper trading environment

## Limitations

- The interactive builder is designed to create initial strategies that may require further refinement
- Complex strategies may need manual adjustment after generation
- The quality of the generated strategy depends on the clarity of your inputs
- Generated strategies should be thoroughly tested before use with real funds

## Technical Implementation

The Interactive Strategy Builder leverages:
- The MCP server for contextual information about trading strategies and indicators
- LLM models for conversation and code generation
- Template-based code generation for consistent output
- Plugin compatibility validation for recommended plugins

## Future Enhancements

Planned enhancements for the interactive strategy builder include:
- Integration with backtesting tools for immediate strategy validation
- More advanced strategy templates for complex approaches
- Visual representation of strategy logic and expected behavior
- Collaborative strategy building with multiple users 