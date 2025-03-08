# Bitcoin Price Volatility Trading Competition

## Overview
Welcome to the Bitcoin Price Volatility Trading Competition 2024! This competition challenges participants to develop algorithmic trading bots that can effectively capitalize on Bitcoin's price volatility while managing risk appropriately. The competition will run in a simulated environment with real historical and live market data.

## Competition Period
- **Start Date:** July 1, 2024
- **End Date:** September 30, 2024
- **Evaluation Frequency:** Weekly performance metrics with final rankings based on cumulative performance

## Trading Environment
- **Available Trading Pairs:** BTC/USDT only
- **Starting Capital:** 100,000 USDT (virtual)
- **Exchange Fees:** 0.1% maker/taker fees
- **Data Resolution:** 1-minute candlestick data
- **API Rate Limits:** Maximum 5 requests per second, 5000 requests per day

## Trading Rules and Constraints
1. **Position Sizing:**
   - Maximum position size: 25% of current portfolio value
   - Minimum position size: 100 USDT

2. **Risk Management:**
   - Maximum drawdown allowed: 15% (exceeding this will result in disqualification)
   - Maximum leverage: 2x

3. **Trading Frequency:**
   - Minimum holding period: 5 minutes between trades
   - Maximum trades per day: 50

4. **Market Conditions:**
   - Trading is suspended during major Bitcoin news events (participants will be notified)
   - Trading must account for market hours and liquidity conditions

## Performance Evaluation Metrics
Participants will be ranked based on the following criteria:
1. **Total Return (35%):** Net profit as a percentage of initial capital
2. **Sharpe Ratio (25%):** Risk-adjusted return (using risk-free rate of 2%)
3. **Maximum Drawdown (20%):** The maximum observed loss from a peak to a trough
4. **Win Rate (10%):** Percentage of profitable trades
5. **Strategy Innovation (10%):** Uniqueness and sophistication of approach

## Technical Requirements
1. **API Integration:**
   - All bots must use our provided API for simulated trading
   - Authentication must be performed using the provided API keys
   - All API responses must be properly handled with appropriate error management

2. **Data Usage:**
   - Historical data will be provided for backtesting (2020-2023)
   - Live data will be streamed during the competition period
   - External data sources are permitted but must be disclosed

3. **Deployment:**
   - Bots must be deployed on our virtual environment
   - Code must be submitted in Python, Node.js, or Go
   - Maximum resource allocation: 2 CPU cores, 4GB RAM

## Submission Requirements
Participants must submit:
1. Complete source code with documentation
2. Strategy explanation document (max 5 pages)
3. Backtest results showing expected performance
4. Configuration parameters for the trading bot

## Prizes
- 1st Place: $50,000 + Investment opportunity
- 2nd Place: $25,000
- 3rd Place: $10,000
- Most Innovative Strategy: $5,000
- Best Risk-Adjusted Return: $5,000

For questions and support, contact competition@bitcointrading.example.com

Good luck to all participants! 