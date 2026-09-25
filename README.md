# Myles Quant v0.5.0

GMX Arbitrum research + scalp terminal + forward-paper execution for the Myles Control Center.

## What changed
- Fixes manual paper orders being blocked by Auto Bot's simultaneous-position slot limit.
- Fixes fresh manual positions being evaluated against price action from before their entry.
- Adds authenticated GMX candle endpoint for the dashboard.
- Adds in-dashboard candlestick chart with 1m / 5m / 15m / 1h / 4h views and EMA 9 / EMA 21.
- Draws the selected paper position entry, stop and target on the chart.
- Adds open-position strip with one-tap paper close.
- Adds Auto Bot performance equity chart.
- Adds `scalp_trend` research strategy alongside trend momentum and mean reversion.
- Live transaction signing remains hard-locked. No private key is read and no live order is submitted.

Paper execution is a staging/safety layer. It is not evidence of future profitability.
