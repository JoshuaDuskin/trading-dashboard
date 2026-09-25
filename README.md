# Myles Quant v0.2.2

GMX Arbitrum research + backtest + paper-trading telemetry for the Myles Control Center.

- Real market data: GMX Oracle API candlesticks on Arbitrum via `/prices/candles`.
- Backtests: trend-momentum and mean-reversion.
- Walk-forward windows, configurable fee/slippage stress assumptions, drawdown and risk gates.
- Paper state persists to `%LOCALAPPDATA%\MylesAI\data\quant_paper_state.json`.
- Dashboard telemetry is written to `%LOCALAPPDATA%\MylesAI\data\trading_status.json`.
- Live transaction signing is hard-locked in this release. No private key is read and no order is submitted.

Commands:

```powershell
npm install
npm run self-test
npm run once
npm start
```
