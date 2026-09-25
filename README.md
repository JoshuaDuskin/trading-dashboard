# Myles Quant v0.3.0

Research + simulated forward-paper trading for GMX markets on Arbitrum.

Current owner-selectable research markets: BTC/USD, ETH/USD, SOL/USD, XRP/USD, TAO/USD.

Key changes from v0.2.2:
- research/backtests separated from forward-paper account state
- multi-market paper positions
- explicit stop-loss and take-profit exits
- total-equity daily-loss and drawdown guardrails
- base + stressed-cost validation and walk-forward checks
- GMX 1m candles for near-live market marks
- authenticated dashboard configuration through the local Myles bridge
- live signing remains hard locked; no private key is read and no live order is submitted

The engine includes research assumptions for fees, slippage, price impact and holding costs. Those are deliberately visible/configurable and are not represented as exact future GMX execution costs.
