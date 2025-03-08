/**
 * MarketDataFetcher class for retrieving crypto market data
 */
export class MarketDataFetcher {
  private apiKey: string;
  private baseUrl: string;
  
  /**
   * Initialize with API credentials
   */
  constructor(apiKey: string, baseUrl = 'https://api.exchange.com') {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }
  
  /**
   * Fetch current price for a cryptocurrency
   */
  async getPrice(symbol: string): Promise<number> {
    // In a real implementation, this would make an API call
    console.log(`Fetching price for ${symbol} from ${this.baseUrl}`);
    
    // Simulate API call
    return new Promise((resolve) => {
      setTimeout(() => {
        // Generate random price for demo
        const price = Math.random() * 10000;
        resolve(price);
      }, 100);
    });
  }
  
  /**
   * Get historical prices for a symbol
   */
  async getHistoricalPrices(symbol: string, days = 7): Promise<number[]> {
    console.log(`Fetching ${days} days of historical data for ${symbol}`);
    
    const prices: number[] = [];
    const basePrice = Math.random() * 10000;
    
    // Generate random historical prices
    for (let i = 0; i < days; i++) {
      const randomFactor = 0.98 + Math.random() * 0.04; // ±2% variation
      prices.push(basePrice * randomFactor);
    }
    
    return prices;
  }
  
  /**
   * Calculate moving average
   */
  calculateMovingAverage(prices: number[], period = 7): number {
    if (prices.length < period) {
      throw new Error(`Not enough price data for ${period}-day moving average`);
    }
    
    // Get last n prices
    const relevantPrices = prices.slice(prices.length - period);
    
    // Calculate average
    const sum = relevantPrices.reduce((total, price) => total + price, 0);
    return sum / period;
  }
} 