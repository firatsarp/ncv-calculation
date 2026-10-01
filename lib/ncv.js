export const T_REF = 18.0;
export const AIR_DENSITY = 1.281;
export const FG_DENSITY = 1.235;
export const AIR_TO_FG = 1.234;
export const PROCESS_AIR = 7464.0;
export const WATER_DENSITY = 999.2;
export const WATER_VAPOR = 1.244;
export const WATER_NCV = -2470.5614;
export const BLOWDOWN = 330.0;
export const BOTTOM_ASH_LOSS = 132.277;
export const FLY_ASH_LOSS = 10.2414;
export const RADIATION_LOSS = 675.0;
export const STEAM_MIN = 76.08;
export const MIN_INSTANT_TPH = 0.1;

export const PRIMARY_CP_X = [12.0,29.3,46.5,63.8,81.0,98.3,115.5,132.8,150.0];
export const PRIMARY_CP_Y = [1.011,1.012,1.013,1.014,1.015,1.016,1.018,1.020,1.023];
export const SECONDARY_CP_X = [12.0,23.0,34.0,45.0,56.0,67.0,78.0,89.0,100.0];
export const SECONDARY_CP_Y = [1.011,1.012,1.012,1.013,1.013,1.014,1.015,1.016,1.017];
export const PROCESS_CP_X = [12.0,16.8,21.5,26.3,31.0,35.8,40.5,45.3,50.0];
export const PROCESS_CP_Y = [1.011,1.011,1.012,1.012,1.012,1.012,1.012,1.013,1.013];
export const FG_CP_X = [0.0,18.8,37.5,56.3,75.0,93.8,112.5,131.3,150.0];
export const FG_CP_Y = [1.096,1.100,1.104,1.108,1.113,1.117,1.122,1.127,1.132];
export const FEEDWATER_T = [95,105,110,115,120,125,130,135,145];
export const FEEDWATER_H = [404.44,446.42,467.46,488.53,509.64,530.79,551.98,573.22,615.85];
export const STEAM_T = [401,411,416,421,426,431,436,441,451];
export const STEAM_H = [3157.90,3184.63,3197.82,3210.91,3223.91,3236.83,3249.66,3262.42,3287.73];
export const DRUM_P = [75,77,78,79,80,81,82,83,85];
export const BLOWDOWN_H = [1292.70,1302.55,1307.42,1312.27,1317.08,1321.86,1326.61,1331.34,1340.70];
export const SAT_STEAM_H = [2765.82,2762.99,2761.55,2760.09,2758.61,2757.12,2755.60,2754.07,2750.96];

const TODAY_COUNTER = {1:'0EAF05EK001XE56',2:'0EAF05EK001XE58',3:'0EAF05EK001XE60'};
const YESTERDAY_COUNTER = {1:'0EAF05EK001XE55',2:'0EAF05EK001XE57',3:'0EAF05EK001XE59'};

export function norm(v){ return String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g,''); }
export function number(v){
  if(v === null || v === undefined || v === '') return NaN;
  if(typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  if(v instanceof Date) return NaN;
  const t = String(v).trim().replace(',','.');
  const u = t.toUpperCase();
  if(['ON','TRUE','YES','RUN','RUNNING','ACTIVE','OPEN'].includes(u)) return 1;
  if(['OFF','FALSE','NO','STOP','STOPPED','INACTIVE','CLOSED'].includes(u)) return 0;
  const m = t.match(/[-+]?\d*\.?\d+/g);
  return m?.length ? Number(m[m.length-1]) : NaN;
}

export function interp(value, xp, fp, extrapolate=false){
  const x = Number(value);
  if(!Number.isFinite(x)) return NaN;
  if(x <= xp[0]){
    if(!extrapolate) return fp[0];
    const s=(fp[1]-fp[0])/(xp[1]-xp[0]); return fp[0]+s*(x-xp[0]);
  }
  if(x >= xp[xp.length-1]){
    if(!extrapolate) return fp[fp.length-1];
    const n=xp.length; const s=(fp[n-1]-fp[n-2])/(xp[n-1]-xp[n-2]); return fp[n-1]+s*(x-xp[n-1]);
  }
  for(let i=1;i<xp.length;i++) if(x <= xp[i]){
    const f=(x-xp[i-1])/(xp[i]-xp[i-1]); return fp[i-1]+f*(fp[i]-fp[i-1]);
  }
  return NaN;
}

export function headerScore(colNorm,candidateNorm){
  if(colNorm===candidateNorm) return 10000+candidateNorm.length;
  if(colNorm.startsWith(candidateNorm)) return 9000+candidateNorm.length;
  if(colNorm.includes(candidateNorm)) return 5000+candidateNorm.length;
  return -1;
}

export function findColumn(headers,candidates,required=true){
  let best=null,bestScore=-1;
  const cols=headers.map(h=>[h,norm(h)]);
  candidates.forEach((c,rank)=>{
    const cn=norm(c); if(!cn) return;
    cols.forEach(([orig,on])=>{
      let s=headerScore(on,cn); if(s<0) return; s-=rank*100;
      if(s>bestScore){best=orig; bestScore=s;}
    });
  });
  if(best===null && required) throw new Error(`Missing column: ${candidates.join(' / ')}`);
  return best;
}

export function findDateTimeColumn(headers){
  try { return findColumn(headers,['Date Time','Datetime','DateTime','Timestamp','Time'],true); }
  catch(e){
    const c=headers.find(h=>{const n=norm(h); return n.includes('DATE')&&n.includes('TIME');});
    if(c) return c; throw e;
  }
}

export function aliasesForLine(line){
  const n=String(line);
  const processTemp = line===2
    ? [`${n}HLA20CT001XZ51`,`${n}HLA10CT001XZ51`,`${n}HLA20CT001`,`${n}HLA10CT001`]
    : [`${n}HLA10CT001XZ51`,`${n}HLA20CT001XZ51`,`${n}HLA10CT001`,`${n}HLA20CT001`];
  return {
    steam_flow:[`${n}LBA10CF901XR01`,`${n}LBA10CF901`],
    steam_temp:[`${n}LBA10CT901XR01`,`${n}LBA10CT901`],
    steam_pressure:[`${n}LBA10CP001XR01`,`${n}LBA10CP001XQ01`,`${n}LBA10CP001`],
    feedwater_temp:[`${n}LAB40CT001XQ01`,`${n}LAB40CT001`],
    drum_pressure:[`${n}HAD10CP004XQ01`,`${n}HAD10CP004`],
    pa_preheater_flow:[`${n}LBG30CF901XR01`,`${n}LBG30CF901`],
    primary_flow:[`${n}HLA10CF901XR01`,`${n}HLA10CF901ZQ01`,`${n}HLA10CF901`],
    primary_temp:[`${n}HLA10CT003XQ01`,`${n}HLA10CT002XQ01`,`${n}HLA10CT003`,`${n}HLA10CT002`],
    secondary_flow:[`${n}HLA20CF901XR01`,`${n}HLA20CF901ZQ01`,`${n}HLA20CF901`],
    secondary_temp:[`${n}HLA20CT003XQ01`,`${n}HLA20CT003`],
    process_temp:processTemp,
    fg_temp:[`${n}HNA10CT901XR01`,`${n}HNA10CT901`],
    water:[`${n}ETN40CF001XQ01`,`${n}ETN40CF001`],
    burner1:[`${n}HJY10EZ302XJ01`,`${n}HJY10EZ302`,`${n}HJY10EK001XE28`],
    burner2:[`${n}HJY20EZ302XJ01`,`${n}HJY20EZ302`,`${n}HJY20EK001XE28`],
    counter:[TODAY_COUNTER[line]],
    counter_yesterday:[YESTERDAY_COUNTER[line]],
  };
}

export function resolveSignals(headers,line){
  const a=aliasesForLine(line), mapping={}, missing=[];
  Object.entries(a).forEach(([k,cands])=>{
    const required=!['counter_yesterday','steam_pressure'].includes(k);
    try{mapping[k]=findColumn(headers,cands,required);}catch{mapping[k]=null;missing.push(k);}
  });
  return {mapping,missing};
}

export function parseDate(v){
  if(v instanceof Date && !isNaN(v)) return v;
  if(typeof v==='number' && v>20000 && v<100000){
    const epoch=Date.UTC(1899,11,30); return new Date(epoch+v*86400000);
  }
  const d=new Date(v); return isNaN(d) ? null : d;
}

export function inferIntervalMinutes(rows){
  const ts=rows.map(r=>r.date?.getTime()).filter(Number.isFinite).sort((a,b)=>a-b);
  const dif=[]; for(let i=1;i<ts.length;i++){const m=(ts[i]-ts[i-1])/60000;if(m>0&&m<180)dif.push(m);}
  if(!dif.length) return 10;
  dif.sort((a,b)=>a-b); const mid=Math.floor(dif.length/2);
  return dif.length%2?dif[mid]:(dif[mid-1]+dif[mid])/2;
}

function rolling(arr,win,mode){
  const out=new Array(arr.length).fill(NaN); let q=[],sum=0,count=0;
  for(let i=0;i<arr.length;i++){
    const v=arr[i], ok=Number.isFinite(v); q.push([v,ok]); if(ok){sum+=v;count++;}
    if(q.length>win){const [ov,ook]=q.shift(); if(ook){sum-=ov;count--;}}
    if(q.length===win && count===win) out[i]=mode==='mean'?sum/win:sum;
  }
  return out;
}
function ffill(arr){let last=NaN;return arr.map(v=>{if(Number.isFinite(v))last=v;return last;});}
function consecutive(mask){let n=0;return mask.map(v=>{n=v?n+1:0;return n;});}

export function buildResolvedRows(data, headers, mapping, dateCol){
  return data.map(obj=>{
    const r={date:parseDate(obj[dateCol])};
    Object.entries(mapping).forEach(([k,c])=>{ if(c) r[k]=number(obj[c]); });
    if(!('counter_yesterday' in r)) r.counter_yesterday=NaN;
    return r;
  }).filter(r=>r.date).sort((a,b)=>a.date-b.date);
}

function counterIntervals(rows){
  const waste=new Array(rows.length).fill(NaN), flag=new Array(rows.length).fill('');
  waste[0]=0;
  for(let i=1;i<rows.length;i++){
    const c=rows[i].counter,p=rows[i-1].counter;
    if(!Number.isFinite(c)||!Number.isFinite(p)){waste[i]=NaN;continue;}
    let d=c-p;
    if(d<0){
      const a=rows[i].date,b=rows[i-1].date;
      const dateChange=a.getFullYear()!=b.getFullYear()||a.getMonth()!=b.getMonth()||a.getDate()!=b.getDate();
      const early=a.getHours()<2;
      if(dateChange||early){d=c;flag[i]=Number.isFinite(rows[i].counter_yesterday)?'DAILY_RESET_YESTERDAY_AVAILABLE':'DAILY_RESET';}
      else {d=NaN;flag[i]='UNEXPECTED_COUNTER_DROP';}
    }
    waste[i]=Number.isFinite(d)?Math.max(0,d):NaN;
  }
  return {waste,flag};
}

export function calculateLine(data,headers,line,dateCol){
  const {mapping,missing}=resolveSignals(headers,line);
  if(missing.length) return {ok:false,line,missing,mapping};
  const rows=buildResolvedRows(data,headers,mapping,dateCol);
  const interval=inferIntervalMinutes(rows);
  const startup=Math.max(1,Math.ceil(15/interval));
  const valid3=Math.max(1,Math.ceil(210/interval));
  const valid8=Math.max(1,Math.ceil(510/interval));
  const dist=Math.max(1,Math.round(30/interval));
  const roll3=Math.max(1,Math.round(180/interval));
  const roll8=Math.max(1,Math.round(480/interval));
  const cond=rows.map(r=>Number.isFinite(r.steam_flow)&&r.steam_flow>STEAM_MIN&&!((r.burner1||0)>0.5||(r.burner2||0)>0.5));
  const initial=consecutive(cond); const active=initial.map(n=>n>=startup); const activeRun=consecutive(active);
  const {waste,flag}=counterIntervals(rows);
  const distributed=waste.map((_,i)=>{
    let s=0;for(let j=Math.max(0,i-dist+1);j<=i;j++)s+=Number.isFinite(waste[j])?waste[j]:0; return s/dist;
  });
  const throughputInstant=distributed.map(v=>v*(60/interval));
  const waste3=rolling(distributed,roll3,'sum'), waste8=rolling(distributed,roll8,'sum');
  const throughput3=waste3.map(v=>v/3), throughput8=waste8.map(v=>v/8);
  const qWaste=[];
  for(let i=0;i<rows.length;i++){
    const r=rows[i];
    const cpPri=interp((r.primary_temp+T_REF)/2,PRIMARY_CP_X,PRIMARY_CP_Y);
    const cpSec=interp((r.secondary_temp+T_REF)/2,SECONDARY_CP_X,SECONDARY_CP_Y);
    const cpPro=interp((r.process_temp+T_REF)/2,PROCESS_CP_X,PROCESS_CP_Y);
    const qPri=r.primary_flow/3600*AIR_DENSITY*cpPri*(r.primary_temp-T_REF);
    const qSec=r.secondary_flow/3600*AIR_DENSITY*cpSec*(r.secondary_temp-T_REF);
    const qPro=PROCESS_AIR/3600*AIR_DENSITY*cpPro*(r.process_temp-T_REF);
    const waterKg=r.water*WATER_DENSITY, qWater=waterKg/3600*WATER_NCV;
    const hFw=interp(r.feedwater_temp,FEEDWATER_T,FEEDWATER_H),hSteam=interp(r.steam_temp,STEAM_T,STEAM_H);
    const pAbs=r.drum_pressure+1,hBd=interp(pAbs,DRUM_P,BLOWDOWN_H),hSat=interp(pAbs,DRUM_P,SAT_STEAM_H);
    const qSteam=r.steam_flow*1000/3600*(hSteam-hFw);
    const qBd=BLOWDOWN/3600*(hBd-hFw);
    const qPa=r.pa_preheater_flow*1000/3600*(hSat-hFw);
    const fgNm3h=(r.primary_flow+r.secondary_flow+PROCESS_AIR)*AIR_TO_FG+waterKg*WATER_VAPOR;
    const cpFg=interp((r.fg_temp+T_REF)/2,FG_CP_X,FG_CP_Y);
    const qFg=fgNm3h*FG_DENSITY/3600*cpFg*(r.fg_temp-T_REF);
    const mb=throughput3[i];
    const qBottom=Number.isFinite(mb)?mb/3.6*BOTTOM_ASH_LOSS:NaN;
    const qFly=Number.isFinite(mb)?mb/3.6*FLY_ASH_LOSS:NaN;
    const qLoss=Number.isFinite(qBottom)?qFg+qBottom+qFly+RADIATION_LOSS:NaN;
    qWaste[i]=Number.isFinite(qLoss)?qSteam+qBd+qPa+qLoss-(qPri+qSec+qPro+qWater):NaN;
  }
  const q3=rolling(qWaste,roll3,'mean'),q8=rolling(qWaste,roll8,'mean');
  const ncvInstant=qWaste.map((q,i)=>active[i]&&throughputInstant[i]>MIN_INSTANT_TPH?q*3.6/throughputInstant[i]/1000:NaN);
  const ncv3=q3.map((q,i)=>active[i]&&activeRun[i]>=valid3&&throughput3[i]>0?q*3.6/throughput3[i]/1000:NaN);
  const ncv8=q8.map((q,i)=>active[i]&&activeRun[i]>=valid8&&throughput8[i]>0?q*3.6/throughput8[i]/1000:NaN);
  const holdI=ffill(ncvInstant),hold3=ffill(ncv3),hold8=ffill(ncv8);
  const result=rows.map((r,i)=>({...r,
    Waste_Interval_t:waste[i],Counter_Flag:flag[i],Waste_30min_Distributed_t:distributed[i],
    Throughput_Instant_tph:throughputInstant[i],Throughput_3h_tph:throughput3[i],Throughput_8h_tph:throughput8[i],
    WasteHeatInput_Instant_MW:qWaste[i]/1000,WasteHeatInput_3h_MW:q3[i]/1000,WasteHeatInput_8h_MW:q8[i]/1000,
    NCV_Active:active[i]?1:0,NCV_3h_Valid:active[i]&&activeRun[i]>=valid3,NCV_8h_Valid:active[i]&&activeRun[i]>=valid8,
    NCV_Instant_DisplayHold:holdI[i],NCV_3h_DisplayHold:hold3[i],NCV_8h_DisplayHold:hold8[i]
  }));
  return {ok:true,line,mapping,missing:[],intervalMinutes:interval,rows,result};
}

function median(vals){const a=vals.filter(Number.isFinite).sort((a,b)=>a-b);if(!a.length)return NaN;const m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2;}
function lastFinite(rows,key){for(let i=rows.length-1;i>=0;i--){const v=rows[i][key];if(Number.isFinite(v))return v;}return NaN;}

export function baselineFromWindowAt(calc,endTime=null,hours=8){
  if(!calc?.rows?.length) return null;
  const requested=endTime ? new Date(endTime) : calc.rows[calc.rows.length-1]?.date;
  if(!(requested instanceof Date) || Number.isNaN(requested.getTime())) return null;
  let end=null;
  for(let i=calc.rows.length-1;i>=0;i--){
    const d=calc.rows[i]?.date;
    if(d instanceof Date && !Number.isNaN(d.getTime()) && d<=requested){end=d;break;}
  }
  if(!end) return null;
  const start=new Date(end.getTime()-hours*3600000);
  const raw=calc.rows.filter(r=>r.date>=start && r.date<=end);
  const res=calc.result.filter(r=>r.date>=start && r.date<=end);
  const keys=['steam_flow','steam_temp','steam_pressure','feedwater_temp','drum_pressure','pa_preheater_flow','primary_flow','primary_temp','secondary_flow','secondary_temp','process_temp','fg_temp','water'];
  const b={}; keys.forEach(k=>b[k]=median(raw.map(r=>r[k])));
  b.process_air_flow=PROCESS_AIR;
  b.throughput_8h_tph=lastFinite(res,'Throughput_8h_tph'); b.ncv_8h_mjkg=lastFinite(res,'NCV_8h_DisplayHold');
  b.throughput_3h_tph=lastFinite(res,'Throughput_3h_tph'); b.ncv_3h_mjkg=lastFinite(res,'NCV_3h_DisplayHold');
  b.ncv_instant_mjkg=lastFinite(res,'NCV_Instant_DisplayHold'); b.waste_heat_8h_mw=lastFinite(res,'WasteHeatInput_8h_MW');
  b.window_start=start; b.window_end=end; b.requested_end=requested; b.window_hours=hours; return b;
}

export function baselineFromWindow(calc,hours=8){
  return baselineFromWindowAt(calc,null,hours);
}

export function heatBalance(v,throughput,allowExtrapolation=false){
  const processAir=Number(v.process_air_flow ?? PROCESS_AIR);
  const checkRange=(x,xp,name)=>{if(!allowExtrapolation&&(x<xp[0]||x>xp[xp.length-1]))throw new Error(`${name} outside lookup range ${xp[0]}..${xp[xp.length-1]}`)};
  const tPriMean=(Number(v.primary_temp)+T_REF)/2,tSecMean=(Number(v.secondary_temp)+T_REF)/2,tProMean=(Number(v.process_temp)+T_REF)/2;
  checkRange(tPriMean,PRIMARY_CP_X,'Primary-air mean temperature');checkRange(tSecMean,SECONDARY_CP_X,'Secondary-air mean temperature');checkRange(tProMean,PROCESS_CP_X,'Process-air mean temperature');
  const cpPri=interp(tPriMean,PRIMARY_CP_X,PRIMARY_CP_Y,allowExtrapolation);
  const cpSec=interp(tSecMean,SECONDARY_CP_X,SECONDARY_CP_Y,allowExtrapolation);
  const cpPro=interp(tProMean,PROCESS_CP_X,PROCESS_CP_Y,allowExtrapolation);
  const qPri=Number(v.primary_flow)/3600*AIR_DENSITY*cpPri*(Number(v.primary_temp)-T_REF);
  const qSec=Number(v.secondary_flow)/3600*AIR_DENSITY*cpSec*(Number(v.secondary_temp)-T_REF);
  const qPro=processAir/3600*AIR_DENSITY*cpPro*(Number(v.process_temp)-T_REF);
  const waterKg=Number(v.water)*WATER_DENSITY,qWater=waterKg/3600*WATER_NCV;
  checkRange(Number(v.feedwater_temp),FEEDWATER_T,'Feedwater temperature');checkRange(Number(v.steam_temp),STEAM_T,'Steam temperature');checkRange(Number(v.drum_pressure)+1,DRUM_P,'Drum pressure + 1 bar');
  const hFw=interp(Number(v.feedwater_temp),FEEDWATER_T,FEEDWATER_H,allowExtrapolation);
  const hSteam=interp(Number(v.steam_temp),STEAM_T,STEAM_H,allowExtrapolation);
  const pAbs=Number(v.drum_pressure)+1,hBd=interp(pAbs,DRUM_P,BLOWDOWN_H,allowExtrapolation),hSat=interp(pAbs,DRUM_P,SAT_STEAM_H,allowExtrapolation);
  const qSteam=Number(v.steam_flow)*1000/3600*(hSteam-hFw),qBd=BLOWDOWN/3600*(hBd-hFw),qPa=Number(v.pa_preheater_flow)*1000/3600*(hSat-hFw);
  const qUseful=qSteam+qBd+qPa;
  const fgNm3h=(Number(v.primary_flow)+Number(v.secondary_flow)+processAir)*AIR_TO_FG+waterKg*WATER_VAPOR;
  const tFgMean=(Number(v.fg_temp)+T_REF)/2;checkRange(tFgMean,FG_CP_X,'Flue-gas mean temperature');
  const cpFg=interp(tFgMean,FG_CP_X,FG_CP_Y,allowExtrapolation);
  const qFg=fgNm3h*FG_DENSITY/3600*cpFg*(Number(v.fg_temp)-T_REF);
  const qBottom=throughput/3.6*BOTTOM_ASH_LOSS,qFly=throughput/3.6*FLY_ASH_LOSS,qLoss=qFg+qBottom+qFly+RADIATION_LOSS;
  const qWaste=qUseful+qLoss-(qPri+qSec+qPro+qWater);
  return {waste_heat_input_mw:qWaste/1000,ncv_mjkg:qWaste*3.6/throughput/1000,q_primary_mw:qPri/1000,q_secondary_mw:qSec/1000,q_process_mw:qPro/1000,q_water_mw:qWater/1000,q_useful_mw:qUseful/1000,q_steam_mw:qSteam/1000,q_blowdown_mw:qBd/1000,q_pa_preheater_mw:qPa/1000,q_fg_loss_mw:qFg/1000,q_bottom_loss_mw:qBottom/1000,q_fly_loss_mw:qFly/1000,q_radiation_loss_mw:RADIATION_LOSS/1000,q_losses_mw:qLoss/1000};
}

export function projectedCapacity(ncv,heatLimit,mechLimit){if(!Number.isFinite(ncv)||ncv<=0)return NaN;return Math.min(heatLimit*3.6/ncv,mechLimit);}
export function targetRows(heatLimit,activeLines,mechLimit){return [3000,3100,3200,3300].map(tpd=>{const tph=tpd/24/activeLines;return {tpd,tph,requiredNcv:heatLimit*3.6/tph,mechanical:tph<=mechLimit?'OK':'Above limit'};});}

export function hourlyRows(calc, activeLines=3){
  const groups=new Map();
  for(const r of calc.result){
    const d=r.date; const key=new Date(d.getFullYear(),d.getMonth(),d.getDate(),d.getHours()).toISOString();
    if(!groups.has(key))groups.set(key,[]); groups.get(key).push(r);
  }
  const avgKeys=['steam_flow','steam_temp','steam_pressure','feedwater_temp','drum_pressure','pa_preheater_flow','primary_flow','primary_temp','secondary_flow','secondary_temp','process_temp','fg_temp','water'];
  const lastKeys=['Throughput_3h_tph','Throughput_8h_tph','WasteHeatInput_3h_MW','WasteHeatInput_8h_MW','NCV_3h_DisplayHold','NCV_8h_DisplayHold'];
  const out=[];
  for(const [hour,rs] of groups){
    const o={Hour:hour};
    o['Waste burned this hour (t)']=rs.reduce((s,r)=>s+(Number.isFinite(r.Waste_Interval_t)?r.Waste_Interval_t:0),0);
    avgKeys.forEach(k=>o[k]=median(rs.map(r=>r[k])));
    lastKeys.forEach(k=>{for(let i=rs.length-1;i>=0;i--){if(Number.isFinite(rs[i][k])){o[k]=rs[i][k];break;}}});
    o['Equivalent plant rate (t/day)']=o['Waste burned this hour (t)']*24*activeLines; out.push(o);
  }
  return out;
}


export function hourlyProjectionRows(calc, selectedBaseline, scenario, scenarioTph, activeLines=3, heatLimit=86.8, mechLimit=46.0, allowExtrapolation=false, manualFutureNcv=null){
  if(!calc?.result?.length || !selectedBaseline || !scenario) return [];
  const groups=new Map();
  for(const r of calc.result){
    const d=r.date; if(!(d instanceof Date) || Number.isNaN(d.getTime())) continue;
    const key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:00`;
    if(!groups.has(key))groups.set(key,[]); groups.get(key).push(r);
  }
  const keys=['steam_flow','steam_temp','feedwater_temp','drum_pressure','pa_preheater_flow','primary_flow','primary_temp','secondary_flow','secondary_temp','process_temp','fg_temp','water','process_air_flow'];
  const deltas={};
  for(const k of keys){
    const a=Number(selectedBaseline[k] ?? (k==='process_air_flow'?PROCESS_AIR:NaN));
    const b=Number(scenario[k] ?? (k==='process_air_flow'?PROCESS_AIR:NaN));
    deltas[k]=Number.isFinite(a)&&Number.isFinite(b)?b-a:0;
  }
  const throughputDelta=Number(scenarioTph)-Number(selectedBaseline.throughput_8h_tph);
  const out=[];
  for(const [hour,rs] of groups){
    const hourEnd=rs[rs.length-1]?.date; const b=baselineFromWindowAt(calc,hourEnd,8); if(!b) continue;
    const projected={...b,process_air_flow:PROCESS_AIR};
    for(const k of keys){
      const av=Number(projected[k] ?? (k==='process_air_flow'?PROCESS_AIR:NaN));
      if(Number.isFinite(av)) projected[k]=av+deltas[k];
    }
    const projectedTph=Number(b.throughput_8h_tph)+throughputDelta;
    let hb=null,error='';
    try{
      if(Number.isFinite(projectedTph)&&projectedTph>0) hb=heatBalance(projected,projectedTph,allowExtrapolation);
      else error='Projected throughput <= 0';
    }catch(e){error=e.message||String(e);}
    const futureNcv=Number.isFinite(Number(manualFutureNcv))&&Number(manualFutureNcv)>0?Number(manualFutureNcv):hb?.ncv_mjkg;
    const expectedHeat=Number.isFinite(projectedTph)&&Number.isFinite(futureNcv)?projectedTph*futureNcv/3.6:NaN;
    const balanceGap=hb&&Number.isFinite(expectedHeat)?expectedHeat-hb.waste_heat_input_mw:NaN;
    const headroom=Number.isFinite(expectedHeat)?heatLimit-expectedHeat:NaN;
    const cap=Number.isFinite(futureNcv)?projectedCapacity(futureNcv,heatLimit,mechLimit):NaN;
    out.push({
      'Hour':hour,
      'Baseline window end':b.window_end instanceof Date?b.window_end.toISOString():'',
      'Actual NCV 8h (MJ/kg)':b.ncv_8h_mjkg,
      'Projected NCV (MJ/kg)':futureNcv,
      'Heat-balance equivalent NCV (MJ/kg)':hb?.ncv_mjkg,
      'Manual future waste NCV used':Number.isFinite(Number(manualFutureNcv))&&Number(manualFutureNcv)>0?'YES':'NO',
      'Delta NCV (MJ/kg)':Number.isFinite(futureNcv)?futureNcv-b.ncv_8h_mjkg:NaN,
      'Actual waste 8h (t/h)':b.throughput_8h_tph,
      'Projected waste (t/h)':projectedTph,
      'Projected plant waste (t/day)':projectedTph*24*activeLines,
      'Actual waste heat 8h (MW)':b.waste_heat_8h_mw,
      'Projected waste heat (MW)':hb?.waste_heat_input_mw,
      'Expected waste heat (MW)':expectedHeat,
      'Heat surplus / deficit vs balance need (MW)':balanceGap,
      'Thermal headroom vs limit (MW)':headroom,
      'Projected capacity / line (t/h)':cap,
      'Projected plant capacity (t/day)':cap*24*activeLines,
      'Actual steam flow (t/h)':b.steam_flow,
      'Projected steam flow (t/h)':projected.steam_flow,
      'Actual steam temp (C)':b.steam_temp,
      'Projected steam temp (C)':projected.steam_temp,
      'Actual feedwater temp (C)':b.feedwater_temp,
      'Projected feedwater temp (C)':projected.feedwater_temp,
      'Actual primary air flow (Nm3/h)':b.primary_flow,
      'Projected primary air flow (Nm3/h)':projected.primary_flow,
      'Actual primary air temp (C)':b.primary_temp,
      'Projected primary air temp (C)':projected.primary_temp,
      'Actual secondary air flow (Nm3/h)':b.secondary_flow,
      'Projected secondary air flow (Nm3/h)':projected.secondary_flow,
      'Actual secondary air temp (C)':b.secondary_temp,
      'Projected secondary air temp (C)':projected.secondary_temp,
      'Actual process air flow (Nm3/h)':b.process_air_flow,
      'Projected process air flow (Nm3/h)':projected.process_air_flow,
      'Actual process air temp (C)':b.process_temp,
      'Projected process air temp (C)':projected.process_temp,
      'Actual water injection (m3/h)':b.water,
      'Projected water injection (m3/h)':projected.water,
      'Actual drum pressure (bar)':b.drum_pressure,
      'Projected drum pressure (bar)':projected.drum_pressure,
      'Actual PA preheater steam (t/h)':b.pa_preheater_flow,
      'Projected PA preheater steam (t/h)':projected.pa_preheater_flow,
      'Actual flue gas temp (C)':b.fg_temp,
      'Projected flue gas temp (C)':projected.fg_temp,
      'Projection status':error||'OK'
    });
  }
  return out;
}
