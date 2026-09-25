# Myles Quant v0.4.0

GMX market research, Auto Bot forward-paper trading, and manual paper trade controls for the Myles Control Center.

- Markets: BTC/USD, ETH/USD, SOL/USD, XRP/USD, TAO/USD.
- Manual paper ticket: asset, long/short, simulated margin, leverage, stop-loss and take-profit.
- Auto Bot: per-market on/off + strategy, master auto toggle, risk limits and validation.
- Manual orders are rejected when they exceed the same paper risk/allocation caps used by the bot.
- Manual positions are not closed by strategy flips; they close only via stop, target, owner close, or account emergency/risk halt.
- Real-money signing remains hard-locked. No wallet/private key is created by this release.
- Funding UI describes the future Arbitrum/USDC flow but will not invent a deposit address.
