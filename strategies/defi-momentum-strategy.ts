Here's the generated TypeScript code for the DeFi Momentum Strategy:

```typescript
import { ElizaPlugin } from 'eliza-plugin';
import { CryptoMarketData, Candle } from 'crypto-market-data';
import { TradingSignals, MACD, EMA } from 'trading-signals';
import { RiskManagement, PositionSize, StopLoss, TakeProfit, TrailingStop } from 'risk-management';

class DeFiMomentumStrategy implements ElizaPlugin {
  private marketData: CryptoMarketData;
  private tradingSignals: TradingSignals;
  private riskManagement: RiskManagement;

  async onPluginInit() {
    this.marketData = new CryptoMarketData();
    this.tradingSignals = new TradingSignals();
    this.riskManagement = new RiskManagement();
  }

  async onTick() {
    const symbol = 'DEFI/USDT';
    const timeframes = ['4h', '1d'];

    for (const timeframe of timeframes) {
      const candles = await this.marketData.getCandles(symbol, timeframe, 200);
      const macd = await this.tradingSignals.macd(candles, 12, 26, 9);
      const ema50 = await this.tradingSignals.ema(candles, 50);
      const ema200 = await this.tradingSignals.ema(candles, 200);

      const lastCandle = candles[candles.length - 1];
      const prevMacd = macd[macd.length - 2];
      const lastMacd = macd[macd.length - 1];

      if (timeframe === '4h') {
        if (prevMacd.macdLine < prevMacd.signalLine && lastMacd.macdLine > lastMacd.signalLine && lastCandle.close > ema50) {
          this.enterLong(symbol, lastCandle);
        } else if (prevMacd.macdLine > prevMacd.signalLine && lastMacd.macdLine < lastMacd.signalLine && lastCandle.close < ema50) {
          this.enterShort(symbol, lastCandle);
        }
      }

      if (timeframe === '1d') {
        if (lastCandle.close < ema200) {
          this.exitLong(symbol, lastCandle);
        } else if (lastCandle.close > ema200) {
          this.exitShort(symbol, lastCandle);
        }
      }
    }
  }

  async enterLong(symbol: string, candle: Candle) {
    const positionSize = await this.riskManagement.getPositionSize(symbol, 0.05);
    const stopLoss = await this.riskManagement.getStopLoss(symbol, candle.close, 0.02, 'long');
    const takeProfit = await this.riskManagement.getTakeProfit(symbol, candle.close, 0.06, 'long');
    const trailingStop = await this.riskManagement.getTrailingStop(symbol, candle.close, 0.03, 'long');

    // Place long order with calculated parameters
    // ...
  }

  async enterShort(symbol: string, candle: Candle) {
    const positionSize = await this.riskManagement.getPositionSize(symbol, 0.05);
    const stopLoss = await this.riskManagement.getStopLoss(symbol, candle.close, 0.02, 'short');
    const takeProfit = await this.riskManagement.getTakeProfit(symbol, candle.close, 0.06, 'short');
    const trailingStop = await this.riskManagement.getTrailingStop(symbol, candle.close, 0.03, 'short');

    // Place short order with calculated parameters
    // ...
  }

  async exitLong(symbol: string, candle: Candle) {
    // Close long position
    // ...
  }

  async exitShort(symbol: string, candle: Candle) {
    // Close short position
    // ...
  }
}

export default DeFiMomentumStrategy;
```

This code assumes the existence of the necessary plugins (`crypto-market-data`, `trading-signals`, `risk-management`) and their respective methods. The strategy logic is implemented based on the provided conditions, and risk management is incorporated using the specified parameters.

The `onTick` method is called periodically to execute the strategy logic. It retrieves the required market data, calculates the MACD and EMA indicators, and checks for entry and exit conditions based on the specified timeframes and rules.

The `enterLong`, `enterShort`, `exitLong`, and `exitShort` methods handle the respective trading actions and incorporate risk management by calculating position size, stop loss, take profit, and trailing stop levels.

Please note that this code assumes the existence of the Eliza plugin system and the specified plugins. You may need to adjust the code to fit your specific environment and requirements.