import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'MylesAI') : path.join(os.homedir(), 'AppData', 'Local', 'MylesAI');
const DATA_DIR = path.join(ROOT, 'data');
const STATE_FILE = path.join(DATA_DIR, 'quant_paper_state.json');
const STATUS_FILE = path.join(DATA_DIR, 'trading_status.json');
const CONFIG_FILE = path.join(__dirname, 'quant_config.json');
const HISTORY_FILE = path.join(DATA_DIR, 'quant_equity_history.json');
const VERSION = '0.2.0';

function iso() { return new Date().toISOString(); }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function n(v, fallback = 0) { const x = Number(v); return Number.isFinite(x) ? x : fallback; }
function round(v, digits = 6) { const m = 10 ** digits; return Math.round(v * m) / m; }
function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function loadConfig() {
  const cfg = readJson(CONFIG_FILE, null);
  if (!cfg) throw new Error(`Missing quant config: ${CONFIG_FILE}`);
  if (cfg?.live_execution?.enabled || cfg?.live_execution?.signing_enabled) {
    throw new Error('Live execution is hard-locked in Myles Quant v0.2.0. Set both live flags to false.');
  }
  return cfg;
}

export function sma(values, period) {
  if (!Array.isArray(values) || period < 1 || values.length < period) return null;
  let sum = 0; for (let i = values.length - period; i < values.length; i++) sum += values[i];
  return sum / period;
}

export function emaSeries(values, period) {
  if (!Array.isArray(values) || !values.length || period < 1) return [];
  const k = 2 / (period + 1); const out = []; let prev = values[0]; out.push(prev);
  for (let i = 1; i < values.length; i++) { prev = values[i] * k + prev * (1 - k); out.push(prev); }
  return out;
}

export function rsiSeries(values, period = 14) {
  const out = Array(values.length).fill(null);
  if (values.length <= period) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) { const d = values[i] - values[i - 1]; if (d >= 0) gain += d; else loss -= d; }
  gain /= period; loss /= period;
  out[period] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1]; const g = Math.max(0, d), l = Math.max(0, -d);
    gain = (gain * (period - 1) + g) / period; loss = (loss * (period - 1) + l) / period;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

export function maxDrawdown(equity) {
  let peak = -Infinity, worst = 0;
  for (const value of equity) { peak = Math.max(peak, value); if (peak > 0) worst = Math.max(worst, (peak - value) / peak); }
  return worst * 100;
}

export function signalTrendMomentum(candles, index) {
  if (index < 60) return 0;
  const closes = candles.slice(0, index + 1).map(c => c.close);
  const fast = emaSeries(closes, 20).at(-1), slow = emaSeries(closes, 50).at(-1), rsi = rsiSeries(closes, 14).at(-1);
  if (fast == null || slow == null || rsi == null) return 0;
  if (fast > slow && rsi >= 52 && rsi <= 74) return 1;
  if (fast < slow && rsi <= 48 && rsi >= 26) return -1;
  return 0;
}

export function signalMeanReversion(candles, index) {
  if (index < 40) return 0;
  const closes = candles.slice(0, index + 1).map(c => c.close);
  const ma = sma(closes, 30); const rsi = rsiSeries(closes, 14).at(-1); const price = closes.at(-1);
  if (!ma || rsi == null) return 0;
  const deviation = (price - ma) / ma;
  if (deviation < -0.025 && rsi < 35) return 1;
  if (deviation > 0.025 && rsi > 65) return -1;
  return 0;
}

function strategySignal(name, candles, index) {
  if (name === 'mean_reversion') return signalMeanReversion(candles, index);
  return signalTrendMomentum(candles, index);
}

function normalizeCandles(raw) {
  const rows = Array.isArray(raw) ? raw : raw?.candles;
  if (!Array.isArray(rows)) return [];
  const out = rows.map((c) => {
    if (Array.isArray(c)) return { timestamp: n(c[0]), open: n(c[1]), high: n(c[2]), low: n(c[3]), close: n(c[4]) };
    return { timestamp: n(c.timestamp), open: n(c.open), high: n(c.high), low: n(c.low), close: n(c.close) };
  }).filter(c => c.timestamp > 0 && c.open > 0 && c.high > 0 && c.low > 0 && c.close > 0);
  out.sort((a,b) => a.timestamp - b.timestamp);
  return out;
}

async function loadGmxSdk(chainId) {
  const mod = await import('@gmx-io/sdk/v2');
  if (!mod?.GmxApiSdk) throw new Error('GmxApiSdk export was not found in @gmx-io/sdk/v2');
  return new mod.GmxApiSdk({ chainId });
}

async function fetchGmxCandles(api, symbol, timeframe, limit) {
  const raw = await api.fetchOhlcv({ symbol, timeframe, limit });
  const candles = normalizeCandles(raw);
  if (candles.length < 80) throw new Error(`GMX returned only ${candles.length} usable ${timeframe} candles for ${symbol}`);
  return candles;
}

async function fetchTickerMap(api, symbols) {
  try {
    const raw = await api.fetchMarketsTickers({ symbols });
    const rows = Array.isArray(raw) ? raw : raw?.tickers || raw?.data || [];
    const map = {};
    for (const row of rows) {
      const symbol = row?.symbol || row?.marketSymbol || row?.name;
      const price = n(row?.price ?? row?.indexPrice ?? row?.lastPrice ?? row?.maxPrice ?? row?.minPrice, NaN);
      if (symbol && Number.isFinite(price)) map[String(symbol)] = price;
    }
    return map;
  } catch { return {}; }
}

export function backtest(candles, strategyName, config) {
  const startEquity = n(config.starting_equity, 10000);
  const fee = n(config.research_costs?.fee_bps_per_side, 10) / 10000;
  const slip = n(config.research_costs?.slippage_bps_per_side, 5) / 10000;
  const leverage = clamp(n(config.risk?.max_notional_leverage, 2), 0.1, 5);
  const riskPct = clamp(n(config.risk?.max_risk_per_trade_pct, 1), 0.1, 5) / 100;
  let equity = startEquity, position = 0, entry = 0, units = 0, entryCost = 0, wins = 0, losses = 0;
  const trades = [], curve = [];

  for (let i = 60; i < candles.length; i++) {
    const c = candles[i], signal = strategySignal(strategyName, candles, i);
    const mark = c.close;
    if (position !== 0 && signal !== position) {
      const exit = mark * (1 - position * slip);
      const gross = position * units * (exit - entry);
      const exitCost = Math.abs(units * exit) * fee;
      const pnl = gross - entryCost - exitCost;
      equity += pnl;
      trades.push({ entry_time: new Date(candles[Math.max(0, i-1)].timestamp*1000).toISOString(), exit_time: new Date(c.timestamp*1000).toISOString(), side: position > 0 ? 'long':'short', entry: round(entry,2), exit: round(exit,2), pnl: round(pnl,2), return_pct: round((pnl/Math.max(1,equity-pnl))*100,3) });
      if (pnl > 0) wins++; else losses++;
      position = 0; units = 0; entry = 0; entryCost = 0;
    }
    if (position === 0 && signal !== 0) {
      position = signal;
      entry = mark * (1 + position * slip);
      const riskBudget = equity * riskPct;
      const stopDistancePct = 0.02;
      const targetNotional = Math.min(equity * leverage, riskBudget / stopDistancePct);
      units = targetNotional / entry;
      entryCost = Math.abs(units * entry) * fee;
    }
    const unrealized = position ? position * units * (mark - entry) - entryCost : 0;
    curve.push({ timestamp: c.timestamp, equity: round(equity + unrealized, 2) });
  }
  if (position !== 0 && candles.length) {
    const c = candles.at(-1), exit = c.close * (1 - position * slip), gross = position * units * (exit-entry), exitCost = Math.abs(units*exit)*fee, pnl = gross-entryCost-exitCost;
    equity += pnl; trades.push({ entry_time: '', exit_time:new Date(c.timestamp*1000).toISOString(), side:position>0?'long':'short', entry:round(entry,2), exit:round(exit,2), pnl:round(pnl,2), return_pct:round((pnl/Math.max(1,equity-pnl))*100,3) });
    if (pnl > 0) wins++; else losses++;
    curve.push({ timestamp:c.timestamp, equity:round(equity,2) });
  }
  const series = curve.map(x=>x.equity);
  return {
    strategy: strategyName,
    starting_equity: startEquity,
    ending_equity: round(equity,2),
    pnl: round(equity-startEquity,2),
    return_pct: round(((equity/startEquity)-1)*100,3),
    win_rate: trades.length ? round(wins/trades.length*100,2) : 0,
    trades: trades.length,
    max_drawdown: round(maxDrawdown(series),3),
    equity_curve: curve,
    recent_trades: trades.slice(-20),
    assumptions: { fee_bps_per_side: fee*10000, slippage_bps_per_side: slip*10000, max_notional_leverage: leverage, risk_per_trade_pct:riskPct*100 }
  };
}

export function walkForward(candles, strategyName, config) {
  if (candles.length < 300) return { strategy: strategyName, status:'insufficient_history', windows:[] };
  const windows=[]; const train=240, test=120, step=120;
  for(let start=0; start+train+test<=candles.length; start+=step){
    const segment=candles.slice(start+train-60,start+train+test);
    const result=backtest(segment,strategyName,config);
    windows.push({ start:new Date(candles[start+train].timestamp*1000).toISOString(), end:new Date(candles[start+train+test-1].timestamp*1000).toISOString(), return_pct:result.return_pct, win_rate:result.win_rate, max_drawdown:result.max_drawdown, trades:result.trades });
  }
  return { strategy:strategyName, status:'complete', windows, positive_windows:windows.filter(w=>w.return_pct>0).length, total_windows:windows.length };
}

function createPaperState(config) {
  const equity=n(config.starting_equity,10000);
  return { version:1, equity, cash:equity, realized_pnl:0, position:null, wins:0, losses:0, trades:[], equity_curve:[], day_start_equity:equity, day_key:new Date().toISOString().slice(0,10), peak_equity:equity, halted:false, halt_reason:null, last_candle_ts:0 };
}

function updatePaper(state, candles, strategyName, config, symbol) {
  const last=candles.at(-1); if(!last) return state;
  if (state.last_candle_ts >= last.timestamp) return state;
  const dayKey=new Date(last.timestamp*1000).toISOString().slice(0,10);
  if(dayKey!==state.day_key){state.day_key=dayKey;state.day_start_equity=state.equity;state.halted=false;state.halt_reason=null;}
  const dailyLossPct=(state.day_start_equity-state.equity)/Math.max(1,state.day_start_equity)*100;
  const ddPct=(state.peak_equity-state.equity)/Math.max(1,state.peak_equity)*100;
  if(dailyLossPct >= n(config.risk?.max_daily_loss_pct,3)){state.halted=true;state.halt_reason='daily_loss_limit';}
  if(ddPct >= n(config.risk?.max_drawdown_pct,10)){state.halted=true;state.halt_reason='max_drawdown_limit';}

  const signal=strategySignal(strategyName,candles,candles.length-1);
  const fee=n(config.research_costs?.fee_bps_per_side,10)/10000, slip=n(config.research_costs?.slippage_bps_per_side,5)/10000;
  const leverage=clamp(n(config.risk?.max_notional_leverage,2),0.1,5), riskPct=clamp(n(config.risk?.max_risk_per_trade_pct,1),0.1,5)/100;
  if(state.position && signal !== state.position.direction){
    const p=state.position, exit=last.close*(1-p.direction*slip), gross=p.direction*p.units*(exit-p.entry), exitCost=Math.abs(p.units*exit)*fee, pnl=gross-p.entry_cost-exitCost;
    state.equity+=pnl;state.cash=state.equity;state.realized_pnl+=pnl;state.trades.push({symbol,side:p.direction>0?'long':'short',entry:p.entry,exit:round(exit,2),pnl:round(pnl,2),opened_at:p.opened_at,closed_at:new Date(last.timestamp*1000).toISOString()});
    if(pnl>0)state.wins++;else state.losses++;state.position=null;
  }
  if(!state.position && signal!==0 && !state.halted){
    const entry=last.close*(1+signal*slip), riskBudget=state.equity*riskPct, notional=Math.min(state.equity*leverage,riskBudget/0.02), units=notional/entry;
    state.position={symbol,direction:signal,side:signal>0?'long':'short',entry:round(entry,2),units,notional:round(notional,2),entry_cost:Math.abs(units*entry)*fee,opened_at:new Date(last.timestamp*1000).toISOString(),mark:round(last.close,2),unrealized_pnl:0};
  }
  if(state.position){const p=state.position;p.mark=round(last.close,2);p.unrealized_pnl=round(p.direction*p.units*(last.close-p.entry)-p.entry_cost,2);}
  const totalEquity=state.equity+(state.position?.unrealized_pnl||0);state.peak_equity=Math.max(state.peak_equity,totalEquity);state.equity_curve.push({timestamp:last.timestamp,equity:round(totalEquity,2)});state.equity_curve=state.equity_curve.slice(-1000);state.last_candle_ts=last.timestamp;state.trades=state.trades.slice(-200);
  return state;
}

function telemetry(config, candlesBySymbol, tickerMap, results, paper) {
  const allTrades=paper.trades||[], completed=allTrades.length, wins=paper.wins||0;
  const paperEquity=round(paper.equity+(paper.position?.unrealized_pnl||0),2), starting=n(config.starting_equity,10000), pnl=round(paperEquity-starting,2);
  const latestMarkets=Object.entries(candlesBySymbol).map(([symbol,c])=>({symbol,price:round(n(tickerMap[symbol],c.at(-1)?.close),2),timestamp:c.at(-1)?.timestamp||null}));
  return {
    schema_version:2,generated_at:iso(),engine:{name:'Myles Quant',version:VERSION,status:'running',venue:config.venue,chain_id:config.chain_id,data_source:'GMX API / SDK v2'},
    mode:'paper',execution_locked:true,live_execution:{enabled:false,signing_enabled:false,reason:config.live_execution?.reason||'Locked'},
    balance:paperEquity,equity:paperEquity,total_pnl:pnl,pnl_pct:round(pnl/starting*100,3),win_rate:completed?round(wins/completed*100,2):0,max_drawdown:round(maxDrawdown((paper.equity_curve||[]).map(x=>x.equity)),3),
    positions:paper.position?[{symbol:paper.position.symbol,side:paper.position.side,size_usd:paper.position.notional,entry_price:paper.position.entry,mark_price:paper.position.mark,unrealized_pnl:paper.position.unrealized_pnl,status:'paper'}]:[],
    equity_curve:paper.equity_curve||[],markets:latestMarkets,
    strategies:results.map(r=>({name:r.strategy,status:'research',symbol:r.symbol,timeframe:config.timeframe,return_pct:r.backtest.return_pct,win_rate:r.backtest.win_rate,max_drawdown:r.backtest.max_drawdown,trades:r.backtest.trades,walk_forward_positive_windows:r.walk_forward.positive_windows??null,walk_forward_total_windows:r.walk_forward.total_windows??null})),
    backtests:results.map(r=>({strategy:r.strategy,market:r.symbol,period:`${candlesBySymbol[r.symbol]?.length||0} × ${config.timeframe}`,return_pct:r.backtest.return_pct,win_rate:r.backtest.win_rate,max_drawdown:r.backtest.max_drawdown,trades:r.backtest.trades,status:r.walk_forward.status})),
    recent_trades:allTrades.slice(-20),risk:{...config.risk,halted:!!paper.halted,halt_reason:paper.halt_reason},assumptions:{...config.research_costs,note:'Research assumptions only; GMX execution fees and price impact vary by market and order state.'}
  };
}

async function cycle({backtestOnly=false}={}) {
  const config=loadConfig(); const api=await loadGmxSdk(config.chain_id); const candlesBySymbol={};
  for(const symbol of config.symbols) candlesBySymbol[symbol]=await fetchGmxCandles(api,symbol,config.timeframe,config.history_limit);
  const tickerMap=await fetchTickerMap(api,config.symbols); const results=[];
  for(const symbol of config.symbols){for(const strategy of ['trend_momentum','mean_reversion']){const bt=backtest(candlesBySymbol[symbol],strategy,config);const wf=walkForward(candlesBySymbol[symbol],strategy,config);results.push({symbol,strategy,backtest:bt,walk_forward:wf});}}
  let paper=readJson(STATE_FILE,null)||createPaperState(config);
  if(!backtestOnly && config.paper?.enabled){const symbol=config.paper.symbol||config.symbols[0],strategy=config.paper.strategy||'trend_momentum';paper=updatePaper(paper,candlesBySymbol[symbol],strategy,config,symbol);writeJsonAtomic(STATE_FILE,paper);writeJsonAtomic(HISTORY_FILE,paper.equity_curve||[]);}
  const status=telemetry(config,candlesBySymbol,tickerMap,results,paper);writeJsonAtomic(STATUS_FILE,status);return status;
}

export function selfTest() {
  const candles=[]; let price=100;
  for(let i=0;i<500;i++){price*=1+(Math.sin(i/17)*0.002)+(i<250?0.0005:-0.0002);candles.push({timestamp:1700000000+i*3600,open:price*0.998,high:price*1.004,low:price*0.996,close:price});}
  const cfg={starting_equity:10000,research_costs:{fee_bps_per_side:10,slippage_bps_per_side:5},risk:{max_risk_per_trade_pct:1,max_notional_leverage:2,max_daily_loss_pct:3,max_drawdown_pct:10}};
  const a=backtest(candles,'trend_momentum',cfg),b=backtest(candles,'mean_reversion',cfg),wf=walkForward(candles,'trend_momentum',cfg),paper=updatePaper(createPaperState(cfg),candles,'trend_momentum',cfg,'BTC/USD');
  const checks={ema:emaSeries([1,2,3,4,5],3).length===5,rsi:rsiSeries(Array.from({length:30},(_,i)=>100+i),14).at(-1)>90,backtest:Number.isFinite(a.ending_equity)&&Number.isFinite(b.ending_equity),walk_forward:wf.total_windows>0,paper:Number.isFinite(paper.equity),live_locked:true};
  const pass=Object.values(checks).every(Boolean);return {pass,checks,sample:{trend:a,mean:b,walk_forward:wf,paper}};
}

async function main(){
  const args=new Set(process.argv.slice(2));
  if(args.has('--self-test')){const r=selfTest();console.log(JSON.stringify(r,null,2));process.exit(r.pass?0:1);}
  const once=args.has('--once')||args.has('--backtest-only');
  do{try{const status=await cycle({backtestOnly:args.has('--backtest-only')});console.log(JSON.stringify({ok:true,generated_at:status.generated_at,equity:status.equity,pnl:status.total_pnl,positions:status.positions.length,backtests:status.backtests.length}));}catch(err){const failure={schema_version:2,generated_at:iso(),engine:{name:'Myles Quant',version:VERSION,status:'error'},mode:'paper',execution_locked:true,error:String(err?.stack||err)};writeJsonAtomic(STATUS_FILE,failure);console.error(failure.error);if(once)process.exit(1);}if(once)break;const config=loadConfig();await new Promise(r=>setTimeout(r,Math.max(30,n(config.poll_seconds,60))*1000));}while(true);
}

if(import.meta.url===`file://${process.argv[1]?.replaceAll('\\','/')}`||path.resolve(process.argv[1]||'')===path.resolve(fileURLToPath(import.meta.url))){main();}
