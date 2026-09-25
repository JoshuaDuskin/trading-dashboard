import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'MylesAI') : path.join(os.homedir(), 'AppData', 'Local', 'MylesAI');
const DATA_DIR = path.join(ROOT, 'data');
const STATE_FILE = path.join(DATA_DIR, 'quant_paper_state_v3.json');
const STATUS_FILE = path.join(DATA_DIR, 'trading_status.json');
const CONFIG_FILE = path.join(__dirname, 'quant_config.json');
const VERSION = '0.3.0';
const VALID_PERIODS = new Set(['1m','5m','15m','1h','4h','1d']);
const SUPPORTED_RESEARCH_MARKETS = ['BTC/USD','ETH/USD','SOL/USD','XRP/USD','TAO/USD'];

const DEFAULT_CONFIG = {
  schema_version: 3,
  venue: 'GMX',
  chain_id: 42161,
  timeframe: '1h',
  history_limit: 3000,
  poll_seconds: 60,
  starting_equity: 10000,
  market_settings: {
    'BTC/USD': { enabled: true, paper_strategy: 'trend_momentum' },
    'ETH/USD': { enabled: true, paper_strategy: 'trend_momentum' },
    'SOL/USD': { enabled: true, paper_strategy: 'trend_momentum' },
    'XRP/USD': { enabled: true, paper_strategy: 'trend_momentum' },
    'TAO/USD': { enabled: true, paper_strategy: 'trend_momentum' },
  },
  strategies: {
    trend_momentum: { enabled: true },
    mean_reversion: { enabled: true },
  },
  paper: { enabled: true, emergency_stop: false },
  risk: {
    max_risk_per_trade_pct: 0.50,
    max_notional_leverage: 1.50,
    stop_loss_pct: 1.50,
    take_profit_pct: 3.00,
    max_daily_loss_pct: 2.00,
    max_drawdown_pct: 8.00,
    max_concurrent_positions: 2,
    max_market_allocation_pct: 35.0,
  },
  research_costs: {
    position_fee_bps_per_side: 6,
    slippage_bps_per_side: 5,
    impact_bps_per_side: 20,
    holding_cost_bps_per_day: 5,
  },
  validation: {
    min_trades: 12,
    max_drawdown_pct: 12,
    min_walk_forward_positive_pct: 50,
    min_base_return_pct: 0,
    min_stress_return_pct: -3,
    stress_cost_multiplier: 2.5,
  },
  live_execution: {
    enabled: false,
    signing_enabled: false,
    reason: 'Live execution remains hard-locked until owner review, forward-paper validation, and a dedicated execution wallet are complete.'
  }
};

function iso(){ return new Date().toISOString(); }
function n(v,f=0){ const x=Number(v); return Number.isFinite(x)?x:f; }
function clamp(v,lo,hi){ return Math.max(lo,Math.min(hi,v)); }
function round(v,d=6){ const m=10**d; return Math.round(v*m)/m; }
function readJson(file,fallback){ try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return fallback;} }
function writeJsonAtomic(file,value){ fs.mkdirSync(path.dirname(file),{recursive:true}); const tmp=`${file}.tmp-${process.pid}`; fs.writeFileSync(tmp,JSON.stringify(value,null,2),'utf8'); fs.renameSync(tmp,file); }
function deepMerge(base,extra){
  if(!extra || typeof extra!=='object' || Array.isArray(extra)) return structuredClone(base);
  const out=structuredClone(base);
  for(const [k,v] of Object.entries(extra)){
    if(v && typeof v==='object' && !Array.isArray(v) && out[k] && typeof out[k]==='object' && !Array.isArray(out[k])) out[k]=deepMerge(out[k],v);
    else out[k]=v;
  }
  return out;
}
function normalizeConfig(raw){
  const cfg=deepMerge(DEFAULT_CONFIG,raw||{});
  cfg.schema_version=3;
  cfg.chain_id=42161;
  cfg.venue='GMX';
  cfg.timeframe=VALID_PERIODS.has(String(cfg.timeframe))?String(cfg.timeframe):'1h';
  cfg.history_limit=Math.round(clamp(n(cfg.history_limit,3000),300,10000));
  cfg.poll_seconds=Math.round(clamp(n(cfg.poll_seconds,60),30,900));
  cfg.starting_equity=clamp(n(cfg.starting_equity,10000),100,10000000);
  cfg.market_settings=cfg.market_settings||{};
  for(const sym of SUPPORTED_RESEARCH_MARKETS){
    const row=cfg.market_settings[sym]||{};
    cfg.market_settings[sym]={enabled:row.enabled!==false,paper_strategy:['trend_momentum','mean_reversion'].includes(row.paper_strategy)?row.paper_strategy:'trend_momentum'};
  }
  for(const key of Object.keys(cfg.market_settings)) if(!SUPPORTED_RESEARCH_MARKETS.includes(key)) delete cfg.market_settings[key];
  cfg.risk.max_risk_per_trade_pct=clamp(n(cfg.risk.max_risk_per_trade_pct,.5),.05,5);
  cfg.risk.max_notional_leverage=clamp(n(cfg.risk.max_notional_leverage,1.5),.1,5);
  cfg.risk.stop_loss_pct=clamp(n(cfg.risk.stop_loss_pct,1.5),.25,15);
  cfg.risk.take_profit_pct=clamp(n(cfg.risk.take_profit_pct,3),.25,40);
  cfg.risk.max_daily_loss_pct=clamp(n(cfg.risk.max_daily_loss_pct,2),.25,20);
  cfg.risk.max_drawdown_pct=clamp(n(cfg.risk.max_drawdown_pct,8),.5,40);
  cfg.risk.max_concurrent_positions=Math.round(clamp(n(cfg.risk.max_concurrent_positions,2),1,5));
  cfg.risk.max_market_allocation_pct=clamp(n(cfg.risk.max_market_allocation_pct,35),5,100);
  cfg.research_costs.position_fee_bps_per_side=clamp(n(cfg.research_costs.position_fee_bps_per_side,6),0,100);
  cfg.research_costs.slippage_bps_per_side=clamp(n(cfg.research_costs.slippage_bps_per_side,5),0,300);
  cfg.research_costs.impact_bps_per_side=clamp(n(cfg.research_costs.impact_bps_per_side,20),0,1000);
  cfg.research_costs.holding_cost_bps_per_day=clamp(n(cfg.research_costs.holding_cost_bps_per_day,5),0,300);
  cfg.validation.min_trades=Math.round(clamp(n(cfg.validation.min_trades,12),1,500));
  cfg.validation.max_drawdown_pct=clamp(n(cfg.validation.max_drawdown_pct,12),1,60);
  cfg.validation.min_walk_forward_positive_pct=clamp(n(cfg.validation.min_walk_forward_positive_pct,50),0,100);
  cfg.validation.min_base_return_pct=clamp(n(cfg.validation.min_base_return_pct,0),-100,500);
  cfg.validation.min_stress_return_pct=clamp(n(cfg.validation.min_stress_return_pct,-3),-100,500);
  cfg.validation.stress_cost_multiplier=clamp(n(cfg.validation.stress_cost_multiplier,2.5),1,10);
  cfg.paper.enabled=cfg.paper.enabled!==false;
  cfg.paper.emergency_stop=!!cfg.paper.emergency_stop;
  cfg.live_execution={enabled:false,signing_enabled:false,reason:DEFAULT_CONFIG.live_execution.reason};
  return cfg;
}
function loadConfig(){ const cfg=normalizeConfig(readJson(CONFIG_FILE,DEFAULT_CONFIG)); writeJsonAtomic(CONFIG_FILE,cfg); return cfg; }

export function sma(values,period){ if(!Array.isArray(values)||period<1||values.length<period)return null; let sum=0; for(let i=values.length-period;i<values.length;i++)sum+=values[i]; return sum/period; }
export function emaSeries(values,period){ if(!Array.isArray(values)||!values.length||period<1)return[]; const k=2/(period+1),out=[]; let prev=values[0]; out.push(prev); for(let i=1;i<values.length;i++){prev=values[i]*k+prev*(1-k);out.push(prev);} return out; }
export function rsiSeries(values,period=14){ const out=Array(values.length).fill(null); if(values.length<=period)return out; let gain=0,loss=0; for(let i=1;i<=period;i++){const d=values[i]-values[i-1];if(d>=0)gain+=d;else loss-=d;} gain/=period;loss/=period;out[period]=loss===0?100:100-100/(1+gain/loss); for(let i=period+1;i<values.length;i++){const d=values[i]-values[i-1],g=Math.max(0,d),l=Math.max(0,-d);gain=(gain*(period-1)+g)/period;loss=(loss*(period-1)+l)/period;out[i]=loss===0?100:100-100/(1+gain/loss);} return out; }
export function maxDrawdown(equity){ let peak=-Infinity,worst=0; for(const v of equity){peak=Math.max(peak,v);if(peak>0)worst=Math.max(worst,(peak-v)/peak);} return worst*100; }
export function signalTrendMomentum(candles,index){ if(index<60)return 0; const closes=candles.slice(0,index+1).map(c=>c.close),fast=emaSeries(closes,20).at(-1),slow=emaSeries(closes,50).at(-1),rsi=rsiSeries(closes,14).at(-1); if(fast==null||slow==null||rsi==null)return 0; if(fast>slow&&rsi>=52&&rsi<=74)return 1; if(fast<slow&&rsi<=48&&rsi>=26)return-1; return 0; }
export function signalMeanReversion(candles,index){ if(index<40)return 0; const closes=candles.slice(0,index+1).map(c=>c.close),ma=sma(closes,30),rsi=rsiSeries(closes,14).at(-1),price=closes.at(-1); if(!ma||rsi==null)return 0; const deviation=(price-ma)/ma; if(deviation<-.025&&rsi<35)return 1; if(deviation>.025&&rsi>65)return-1; return 0; }
function strategySignal(name,candles,index){ return name==='mean_reversion'?signalMeanReversion(candles,index):signalTrendMomentum(candles,index); }

function normalizeCandles(raw){ const rows=Array.isArray(raw)?raw:raw?.candles; if(!Array.isArray(rows))return[]; const out=rows.map(c=>Array.isArray(c)?{timestamp:n(c[0]),open:n(c[1]),high:n(c[2]),low:n(c[3]),close:n(c[4])}:{timestamp:n(c.timestamp),open:n(c.open),high:n(c.high),low:n(c.low),close:n(c.close)}).filter(c=>c.timestamp>0&&c.open>0&&c.high>0&&c.low>0&&c.close>0); out.sort((a,b)=>a.timestamp-b.timestamp); return out; }
const GMX_ORACLE_BASES={42161:'https://arbitrum-api.gmxinfra.io'};
async function fetchJsonUrl(url,label){ const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),15000);try{const r=await fetch(url,{headers:{accept:'application/json','user-agent':`MylesQuant/${VERSION}`},signal:controller.signal});const text=await r.text();if(!r.ok)throw new Error(`${label}: HTTP ${r.status} ${r.statusText} - ${text.replace(/\s+/g,' ').slice(0,400)}`);return JSON.parse(text);}finally{clearTimeout(timer);} }
async function fetchGmxCandles(chainId,symbol,timeframe,limit){ const base=GMX_ORACLE_BASES[Number(chainId)]; if(!base)throw new Error(`Unsupported chain ${chainId}`); const tokenSymbol=String(symbol).split('/')[0].toUpperCase();const url=new URL(`${base}/prices/candles`);url.searchParams.set('tokenSymbol',tokenSymbol);url.searchParams.set('period',timeframe);url.searchParams.set('limit',String(Math.max(1,Math.min(10000,Math.trunc(n(limit,1000))))));const raw=await fetchJsonUrl(url,`GMX ${tokenSymbol}/${timeframe}`);const candles=normalizeCandles(raw);if(candles.length<Math.min(80,Number(limit)))throw new Error(`GMX returned only ${candles.length} usable ${timeframe} candles for ${tokenSymbol}`);return candles; }
async function fetchLatestPrice(chainId,symbol){ const c=await fetchGmxCandles(chainId,symbol,'1m',2);const last=c.at(-1);return {price:last.close,timestamp:last.timestamp}; }

function costs(config,mult=1){ return {fee:n(config.research_costs.position_fee_bps_per_side,6)/10000*mult,slip:n(config.research_costs.slippage_bps_per_side,5)/10000*mult,impact:n(config.research_costs.impact_bps_per_side,20)/10000*mult,holding:n(config.research_costs.holding_cost_bps_per_day,5)/10000*mult}; }
function entryFill(mark,direction,cost){ return mark*(1+direction*(cost.slip+cost.impact)); }
function exitFill(mark,direction,cost){ return mark*(1-direction*(cost.slip+cost.impact)); }
function positionSize(equity,config,entry){ const riskPct=n(config.risk.max_risk_per_trade_pct,.5)/100,stopPct=n(config.risk.stop_loss_pct,1.5)/100,lev=n(config.risk.max_notional_leverage,1.5),alloc=n(config.risk.max_market_allocation_pct,35)/100; const riskBudget=equity*riskPct;const byRisk=riskBudget/Math.max(.0001,stopPct);const notional=Math.min(equity*lev,equity*alloc,byRisk);return {notional,units:notional/entry,risk_budget:riskBudget}; }
function stopTarget(entry,direction,config){const s=n(config.risk.stop_loss_pct,1.5)/100,t=n(config.risk.take_profit_pct,3)/100;return{stop:entry*(1-direction*s),target:entry*(1+direction*t)};}
function intrabarExit(position,candle){ if(position.direction>0){const stopHit=candle.low<=position.stop,targetHit=candle.high>=position.target;if(stopHit)return{reason:targetHit?'stop_and_target_same_candle_conservative_stop':'stop_loss',raw:position.stop};if(targetHit)return{reason:'take_profit',raw:position.target};}else{const stopHit=candle.high>=position.stop,targetHit=candle.low<=position.target;if(stopHit)return{reason:targetHit?'stop_and_target_same_candle_conservative_stop':'stop_loss',raw:position.stop};if(targetHit)return{reason:'take_profit',raw:position.target};}return null; }
function holdingCost(position,exitTs,cost){const days=Math.max(0,(exitTs-position.opened_ts)/86400);return position.notional*cost.holding*days;}
function closeCalc(position,rawExit,exitTs,cost){const exit=exitFill(rawExit,position.direction,cost),gross=position.direction*position.units*(exit-position.entry),exitFee=Math.abs(position.units*exit)*cost.fee,hold=holdingCost(position,exitTs,cost),net=gross-position.entry_fee-exitFee-hold;return{exit,gross,exit_fee:exitFee,holding_cost:hold,net};}

export function backtest(candles,strategyName,config,{costMultiplier=1}={}){
  const start=n(config.starting_equity,10000),cost=costs(config,costMultiplier);let cash=start,position=null,wins=0,losses=0;const trades=[],curve=[];
  for(let i=60;i<candles.length;i++){
    const c=candles[i],signal=strategySignal(strategyName,candles,i);
    let exitedThisCandle=false;
    if(position){let ex=intrabarExit(position,c);if(!ex&&signal!==position.direction)ex={reason:'signal_exit',raw:c.close};if(ex){const calc=closeCalc(position,ex.raw,c.timestamp,cost);cash+=calc.gross-calc.exit_fee-calc.holding_cost;const pnl=calc.net;trades.push({entry_time:new Date(position.opened_ts*1000).toISOString(),exit_time:new Date(c.timestamp*1000).toISOString(),side:position.direction>0?'long':'short',entry:round(position.entry,4),exit:round(calc.exit,4),pnl:round(pnl,2),return_pct:round(pnl/Math.max(1,position.notional)*100,3),reason:ex.reason});if(pnl>0)wins++;else losses++;position=null;exitedThisCandle=true;}
    }
    if(!position&&!exitedThisCandle&&signal!==0){const entry=entryFill(c.close,signal,cost),sz=positionSize(cash,config,entry),st=stopTarget(entry,signal,config),entryFee=Math.abs(sz.notional)*cost.fee;cash-=entryFee;position={direction:signal,entry,units:sz.units,notional:sz.notional,entry_fee:entryFee,stop:st.stop,target:st.target,opened_ts:c.timestamp};}
    const unreal=position?position.direction*position.units*(c.close-position.entry):0;curve.push({timestamp:c.timestamp,equity:round(cash+unreal,2)});
  }
  if(position&&candles.length){const c=candles.at(-1),calc=closeCalc(position,c.close,c.timestamp,cost);cash+=calc.gross-calc.exit_fee-calc.holding_cost;const pnl=calc.net;trades.push({entry_time:new Date(position.opened_ts*1000).toISOString(),exit_time:new Date(c.timestamp*1000).toISOString(),side:position.direction>0?'long':'short',entry:round(position.entry,4),exit:round(calc.exit,4),pnl:round(pnl,2),return_pct:round(pnl/Math.max(1,position.notional)*100,3),reason:'end_of_test'});if(pnl>0)wins++;else losses++;curve.push({timestamp:c.timestamp,equity:round(cash,2)});}
  return{strategy:strategyName,starting_equity:start,ending_equity:round(cash,2),pnl:round(cash-start,2),return_pct:round((cash/start-1)*100,3),win_rate:trades.length?round(wins/trades.length*100,2):0,trades:trades.length,max_drawdown:round(maxDrawdown(curve.map(x=>x.equity)),3),equity_curve:curve,recent_trades:trades.slice(-30),cost_multiplier:costMultiplier};
}
export function walkForward(candles,strategyName,config){if(candles.length<420)return{strategy:strategyName,status:'insufficient_history',windows:[]};const windows=[],train=240,test=120,step=120;for(let start=0;start+train+test<=candles.length;start+=step){const seg=candles.slice(Math.max(0,start+train-60),start+train+test),r=backtest(seg,strategyName,config);windows.push({start:new Date(candles[start+train].timestamp*1000).toISOString(),end:new Date(candles[start+train+test-1].timestamp*1000).toISOString(),return_pct:r.return_pct,win_rate:r.win_rate,max_drawdown:r.max_drawdown,trades:r.trades});}return{strategy:strategyName,status:'complete',windows,positive_windows:windows.filter(w=>w.return_pct>0).length,total_windows:windows.length};}
function validationFor(base,stress,wf,config){const v=config.validation,total=Math.max(1,wf.total_windows||0),positivePct=(wf.positive_windows||0)/total*100;const checks={min_trades:base.trades>=n(v.min_trades,12),base_return:base.return_pct>=n(v.min_base_return_pct,0),stress_return:stress.return_pct>=n(v.min_stress_return_pct,-3),max_drawdown:base.max_drawdown<=n(v.max_drawdown_pct,12),walk_forward_positive_pct:wf.status==='complete'&&positivePct>=n(v.min_walk_forward_positive_pct,50)};return{pass:Object.values(checks).every(Boolean),checks,walk_forward_positive_pct:round(positivePct,1)};}

function createPaperState(config){const e=n(config.starting_equity,10000);return{version:3,created_at:iso(),starting_equity:e,cash:e,realized_pnl:0,positions:{},wins:0,losses:0,trades:[],equity_curve:[],day_key:new Date().toISOString().slice(0,10),day_start_equity:e,peak_equity:e,halted:false,halt_reason:null,last_candle_ts:{}};}
function stateEquity(state,latest){let eq=n(state.cash,0);for(const [symbol,p] of Object.entries(state.positions||{})){const mark=n(latest[symbol]?.price,p.mark||p.entry);p.mark=mark;p.unrealized_pnl=round(p.direction*p.units*(mark-p.entry),2);eq+=p.unrealized_pnl;}return eq;}
function closePaperPosition(state,symbol,rawExit,ts,cost,reason){const p=state.positions[symbol];if(!p)return;const calc=closeCalc(p,rawExit,ts,cost);state.cash+=calc.gross-calc.exit_fee-calc.holding_cost;state.realized_pnl+=calc.net;state.trades.push({symbol,side:p.direction>0?'long':'short',entry:round(p.entry,4),exit:round(calc.exit,4),pnl:round(calc.net,2),opened_at:new Date(p.opened_ts*1000).toISOString(),closed_at:new Date(ts*1000).toISOString(),reason});if(calc.net>0)state.wins++;else state.losses++;delete state.positions[symbol];}
function updatePaper(state,candlesBySymbol,latest,config){const cost=costs(config,1);state.positions=state.positions||{};state.last_candle_ts=state.last_candle_ts||{};const enabled=Object.entries(config.market_settings).filter(([,v])=>v.enabled).map(([s])=>s);const newestTs=Math.max(...enabled.map(s=>candlesBySymbol[s]?.at(-1)?.timestamp||0),0),dayKey=new Date(newestTs*1000||Date.now()).toISOString().slice(0,10);let eq=stateEquity(state,latest);if(dayKey!==state.day_key){state.day_key=dayKey;state.day_start_equity=eq;state.halted=false;state.halt_reason=null;}
  const dailyLoss=(state.day_start_equity-eq)/Math.max(1,state.day_start_equity)*100,dd=(state.peak_equity-eq)/Math.max(1,state.peak_equity)*100;
  if(config.paper.emergency_stop){state.halted=true;state.halt_reason='owner_emergency_stop';}
  else if(dailyLoss>=n(config.risk.max_daily_loss_pct,2)){state.halted=true;state.halt_reason='daily_loss_limit';}
  else if(dd>=n(config.risk.max_drawdown_pct,8)){state.halted=true;state.halt_reason='max_drawdown_limit';}
  if(state.halted){for(const symbol of Object.keys(state.positions)){const c=candlesBySymbol[symbol]?.at(-1);if(c)closePaperPosition(state,symbol,c.close,c.timestamp,cost,state.halt_reason);}}
  for(const symbol of enabled){const candles=candlesBySymbol[symbol],c=candles?.at(-1);if(!c||state.last_candle_ts[symbol]>=c.timestamp)continue;const strategy=config.market_settings[symbol]?.paper_strategy||'trend_momentum',signal=strategySignal(strategy,candles,candles.length-1),p=state.positions[symbol];let exitedThisCandle=false;if(p){let ex=intrabarExit(p,c);if(!ex&&signal!==p.direction)ex={reason:'signal_exit',raw:c.close};if(ex){closePaperPosition(state,symbol,ex.raw,c.timestamp,cost,ex.reason);exitedThisCandle=true;}}
    eq=stateEquity(state,latest);const openCount=Object.keys(state.positions).length;if(!state.positions[symbol]&&!exitedThisCandle&&!state.halted&&signal!==0&&openCount<n(config.risk.max_concurrent_positions,2)){const entry=entryFill(c.close,signal,cost),sz=positionSize(eq,config,entry),st=stopTarget(entry,signal,config),entryFee=sz.notional*cost.fee;state.cash-=entryFee;state.positions[symbol]={symbol,direction:signal,side:signal>0?'long':'short',entry:round(entry,6),units:sz.units,notional:round(sz.notional,2),entry_fee:entryFee,stop:round(st.stop,6),target:round(st.target,6),opened_ts:c.timestamp,mark:c.close,unrealized_pnl:0,strategy};}
    state.last_candle_ts[symbol]=c.timestamp;
  }
  eq=stateEquity(state,latest);state.peak_equity=Math.max(state.peak_equity,eq);state.equity_curve.push({timestamp:newestTs||Math.floor(Date.now()/1000),equity:round(eq,2)});state.equity_curve=state.equity_curve.slice(-2000);state.trades=state.trades.slice(-500);return state;
}

function mathSelfTest(){const cfg=normalizeConfig(DEFAULT_CONFIG),cost={fee:0,slip:0,impact:0,holding:0};const p={direction:1,entry:100,units:10,notional:1000,entry_fee:0,opened_ts:0,stop:98.5,target:103};const c=closeCalc(p,102,3600,cost);const both=intrabarExit(p,{low:98,high:104});const size=positionSize(10000,cfg,100);const checks={long_pnl_exact:Math.abs(c.net-20)<1e-9,conservative_same_candle_stop:both?.reason==='stop_and_target_same_candle_conservative_stop',risk_size_respects_leverage:size.notional<=15000.0001,risk_size_respects_allocation:size.notional<=3500.0001,live_hard_locked:cfg.live_execution.enabled===false&&cfg.live_execution.signing_enabled===false,valid_stop_target:p.stop<p.entry&&p.target>p.entry};return{pass:Object.values(checks).every(Boolean),checks};}

function telemetry(config,candlesBySymbol,latest,results,paper,errors){const eq=stateEquity(paper,latest),start=n(paper.starting_equity,config.starting_equity),pnl=eq-start,allTrades=paper.trades||[],wins=paper.wins||0,positions=Object.values(paper.positions||{}).map(p=>({symbol:p.symbol,side:p.side,size_usd:p.notional,entry_price:p.entry,mark_price:p.mark,unrealized_pnl:p.unrealized_pnl,stop_loss:p.stop,take_profit:p.target,strategy:p.strategy,status:'SIMULATED PAPER'}));const strategyRows=results.map(r=>({name:r.strategy,status:r.validation.pass?'validated_candidate':'research',symbol:r.symbol,timeframe:config.timeframe,return_pct:r.base.return_pct,stress_return_pct:r.stress.return_pct,win_rate:r.base.win_rate,max_drawdown:r.base.max_drawdown,trades:r.base.trades,walk_forward_positive_windows:r.walk_forward.positive_windows??0,walk_forward_total_windows:r.walk_forward.total_windows??0,validation_pass:r.validation.pass,validation_checks:r.validation.checks}));const passCount=strategyRows.filter(r=>r.validation_pass).length;return{schema_version:3,generated_at:iso(),engine:{name:'Myles Quant',version:VERSION,status:'running',venue:config.venue,chain_id:config.chain_id,data_source:'GMX Oracle candles + 1m market marks'},account_type:'SIMULATED PAPER',mode:'paper',execution_locked:true,live_execution:config.live_execution,balance:round(eq,2),equity:round(eq,2),starting_equity:round(start,2),total_pnl:round(pnl,2),pnl_pct:round(pnl/Math.max(1,start)*100,3),win_rate:allTrades.length?round(wins/allTrades.length*100,2):0,max_drawdown:round(maxDrawdown((paper.equity_curve||[]).map(x=>x.equity)),3),positions,equity_curve:paper.equity_curve||[],markets:Object.entries(latest).map(([symbol,x])=>({symbol,price:round(x.price,8),timestamp:x.timestamp,source:'GMX 1m candle'})),market_errors:errors,strategies:strategyRows,backtests:results.map(r=>({strategy:r.strategy,market:r.symbol,period:`${candlesBySymbol[r.symbol]?.length||0} × ${config.timeframe}`,return_pct:r.base.return_pct,stress_return_pct:r.stress.return_pct,win_rate:r.base.win_rate,max_drawdown:r.base.max_drawdown,trades:r.base.trades,status:r.validation.pass?'PASS':'RESEARCH',walk_forward_positive_pct:r.validation.walk_forward_positive_pct})),recent_trades:allTrades.slice(-30),risk:{...config.risk,halted:!!paper.halted,halt_reason:paper.halt_reason,emergency_stop:!!config.paper.emergency_stop},assumptions:{...config.research_costs,stress_cost_multiplier:config.validation.stress_cost_multiplier,note:'Research assumptions; live GMX position fees, funding, borrowing, execution fee and net price impact vary with market state.'},configuration:{timeframe:config.timeframe,history_limit:config.history_limit,poll_seconds:config.poll_seconds,market_settings:config.market_settings},validation:{math:mathSelfTest(),candidate_pass_count:passCount,candidate_total:strategyRows.length,live_ready:false,live_ready_reasons:['Live execution adapter is not installed','Dedicated trading wallet is not configured','Forward-paper observation period and owner approval are still required']}};}

async function cycle({backtestOnly=false}={}){const config=loadConfig(),candlesBySymbol={},latest={},errors={};const enabled=Object.entries(config.market_settings).filter(([,v])=>v.enabled).map(([s])=>s);for(const symbol of enabled){try{candlesBySymbol[symbol]=await fetchGmxCandles(config.chain_id,symbol,config.timeframe,config.history_limit);latest[symbol]=await fetchLatestPrice(config.chain_id,symbol);}catch(e){errors[symbol]=String(e?.message||e);}}
  const results=[];for(const symbol of enabled){const candles=candlesBySymbol[symbol];if(!candles)continue;for(const strategy of ['trend_momentum','mean_reversion']){if(config.strategies[strategy]?.enabled===false)continue;const base=backtest(candles,strategy,config),stress=backtest(candles,strategy,config,{costMultiplier:n(config.validation.stress_cost_multiplier,2.5)}),wf=walkForward(candles,strategy,config),val=validationFor(base,stress,wf,config);results.push({symbol,strategy,base,stress,walk_forward:wf,validation:val});}}
  let paper=readJson(STATE_FILE,null);if(!paper||paper.version!==3)paper=createPaperState(config);if(!backtestOnly&&config.paper.enabled)paper=updatePaper(paper,candlesBySymbol,latest,config);writeJsonAtomic(STATE_FILE,paper);const status=telemetry(config,candlesBySymbol,latest,results,paper,errors);writeJsonAtomic(STATUS_FILE,status);return status;}

export function selfTest(){const math=mathSelfTest(),candles=[];let price=100;for(let i=0;i<900;i++){price*=1+(Math.sin(i/17)*.002)+(i<450?.0004:-.00015);candles.push({timestamp:1700000000+i*3600,open:price*.998,high:price*1.006,low:price*.994,close:price});}const cfg=normalizeConfig(DEFAULT_CONFIG),a=backtest(candles,'trend_momentum',cfg),b=backtest(candles,'mean_reversion',cfg),wf=walkForward(candles,'trend_momentum',cfg);const checks={math:math.pass,trend:Number.isFinite(a.ending_equity),mean:Number.isFinite(b.ending_equity),walk_forward:(wf.total_windows||0)>0,live_locked:true};return{pass:Object.values(checks).every(Boolean),checks,math,sample:{trend:{return_pct:a.return_pct,trades:a.trades,max_drawdown:a.max_drawdown},mean:{return_pct:b.return_pct,trades:b.trades,max_drawdown:b.max_drawdown},walk_forward:wf}};}

async function main(){const args=new Set(process.argv.slice(2));if(args.has('--print-default-config')){console.log(JSON.stringify(DEFAULT_CONFIG,null,2));return;}if(args.has('--self-test')){const r=selfTest();console.log(JSON.stringify(r,null,2));process.exit(r.pass?0:1);}const once=args.has('--once')||args.has('--backtest-only');do{try{const s=await cycle({backtestOnly:args.has('--backtest-only')});console.log(JSON.stringify({ok:true,generated_at:s.generated_at,equity:s.equity,pnl:s.total_pnl,positions:s.positions.length,backtests:s.backtests.length,markets:s.markets.map(m=>m.symbol),errors:s.market_errors}));}catch(err){const failure={schema_version:3,generated_at:iso(),engine:{name:'Myles Quant',version:VERSION,status:'error'},mode:'paper',execution_locked:true,error:String(err?.stack||err)};writeJsonAtomic(STATUS_FILE,failure);console.error(failure.error);if(once)process.exit(1);}if(once)break;const cfg=loadConfig();await new Promise(r=>setTimeout(r,cfg.poll_seconds*1000));}while(true);}
if(import.meta.url===`file://${process.argv[1]?.replaceAll('\\','/')}`||path.resolve(process.argv[1]||'')===path.resolve(fileURLToPath(import.meta.url))){main();}
