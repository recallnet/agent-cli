# Crypto Volatility Trading Competition

## Overview
This competition challenges participants to create trading agents that can effectively profit from cryptocurrency market volatility while maintaining robust risk management. The goal is to develop strategies that can adapt to rapidly changing market conditions and capture profits during high-volatility periods.

## Competition Timeframe
* Start Date: July 1, 2023
* End Date: September 30, 2023
* Evaluation Period: Weekly performance assessments

## Market Coverage
Participants can trade the following cryptocurrency pairs:
* BTC/USDT
* ETH/USDT
* SOL/USDT
* XRP/USDT
* ADA/USDT
* DOGE/USDT

## Trading Rules
1. Initial capital: $100,000 (virtual)
2. Maximum position size: 25% of portfolio value
3. Maximum leverage: 3x
4. Trade frequency: Minimum 5-minute intervals between trades
5. No trading during significant news events (pre-announced by organizers)
6. Maximum drawdown allowed: 20% (exceeding will disqualify the agent)

## Performance Metrics
Agents will be evaluated based on the following criteria:
1. Total return (40%)
2. Sharpe ratio (25%)
3. Maximum drawdown (20%)
4. Win rate (10%)
5. Strategy sophistication and originality (5%)

## Technical Requirements
1. All trading agents must use the provided API for placing trades
2. Strategies must be fully automated with no manual intervention
3. Maximum API call rate: 60 calls per minute
4. Historical data will be provided for backtesting
5. Agents must handle connection interruptions gracefully

## Strategy Guidelines
Participants are encouraged to develop strategies that:
1. Identify volatility patterns across different timeframes
2. Incorporate market sentiment analysis
3. Include smart risk management and position sizing
4. Can adapt to changing market conditions
5. Implement effective stop-loss and take-profit mechanisms

## Data Sources
The following data will be available for all participants:
1. OHLCV data for all supported pairs (1-minute, 5-minute, 15-minute, 1-hour, 4-hour, and daily timeframes)
2. Order book depth (10 levels)
3. Recent trades data
4. Funding rates for futures
5. Basic social sentiment indicators

## Submission Requirements
Participants must submit:
1. Source code for their trading agent
2. Documentation explaining the strategy
3. Backtest results with performance metrics
4. Requirements for execution environment

## Prizes
1. First Place: $50,000
2. Second Place: $25,000
3. Third Place: $10,000
4. Most Innovative Strategy: $5,000
5. Best Risk-Adjusted Returns: $5,000 