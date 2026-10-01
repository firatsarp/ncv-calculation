import {
  baselineFromWindowAt, heatBalance, STEAM_MIN, PROCESS_AIR, T_REF,
  PRIMARY_CP_X, SECONDARY_CP_X, PROCESS_CP_X, FG_CP_X,
  FEEDWATER_T, STEAM_T, DRUM_P
} from './ncv.js';

export const HISTORICAL_FIELDS = [
  {key:'throughput', label:'Waste throughput', unit:'t/h', source:'throughput_8h_tph', defaultMode:'percent'},
  {key:'steam_flow', label:'Live steam flow', unit:'t/h', defaultMode:'percent'},
  {key:'steam_temp', label:'Live steam temperature', unit:'°C', defaultMode:'delta'},
  {key:'steam_pressure', label:'Live steam pressure', unit:'bar', defaultMode:'delta', informational:true},
  {key:'feedwater_temp', label:'Feedwater temperature', unit:'°C', defaultMode:'delta'},
  {key:'drum_pressure', label:'Drum pressure', unit:'bar', defaultMode:'delta'},
  {key:'pa_preheater_flow', label:'PA preheater steam', unit:'t/h', defaultMode:'percent'},
  {key:'primary_flow', label:'Primary air flow', unit:'Nm³/h', defaultMode:'percent'},
  {key:'primary_temp', label:'Primary air temperature', unit:'°C', defaultMode:'delta'},
  {key:'secondary_flow', label:'Secondary air flow', unit:'Nm³/h', defaultMode:'percent'},
  {key:'secondary_temp', label:'Secondary air temperature', unit:'°C', defaultMode:'delta'},
  {key:'process_air_flow', label:'Process air flow', unit:'Nm³/h', defaultMode:'percent'},
  {key:'process_temp', label:'Process air temperature', unit:'°C', defaultMode:'delta'},
  {key:'fg_temp', label:'Flue gas temperature', unit:'°C', defaultMode:'delta'},
  {key:'water', label:'Water injection', unit:'m³/h', defaultMode:'percent'}
];

export function defaultAdjustments(){
  return Object.fromEntries(HISTORICAL_FIELDS.map(f=>[f.key,{mode:'none',value:0}]));
}

export function applyAdjustment(value, adjustment){
  const v=Number(value);
  if(!Number.isFinite(v)) return NaN;
  const a=adjustment||{mode:'none',value:0};
  const x=Number(a.value)||0;
  if(a.mode==='percent') return v*(1+x/100);
  if(a.mode==='delta') return v+x;
  return v;
}

function finite(v){return Number.isFinite(Number(v));}
function mean(a){const v=a.map(Number).filter(Number.isFinite);return v.length?v.reduce((s,x)=>s+x,0)/v.length:NaN;}
function median(a){const v=a.map(Number).filter(Number.isFinite).sort((x,y)=>x-y);if(!v.length)return NaN;const m=Math.floor(v.length/2);return v.length%2?v[m]:(v[m-1]+v[m])/2;}
function max(a){const v=a.map(Number).filter(Number.isFinite);return v.length?Math.max(...v):NaN;}

function hourEnds(calc){
  const map=new Map();
  for(const r of calc?.result||[]){
    const d=r.date;
    if(!(d instanceof Date)||Number.isNaN(d.getTime()))continue;
    const key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:00`;
    map.set(key,d);
  }
  return [...map.entries()].map(([hour,end])=>({hour,end}));
}

function baselineValue(b,key){
  if(key==='throughput') return Number(b.throughput_8h_tph);
  if(key==='process_air_flow') return Number.isFinite(Number(b.process_air_flow))?Number(b.process_air_flow):PROCESS_AIR;
  return Number(b[key]);
}

function buildEnvelope(baselines){
  const out={};
  for(const f of HISTORICAL_FIELDS){
    const vals=baselines.map(x=>baselineValue(x.baseline,f.key)).filter(Number.isFinite);
    out[f.key]={min:vals.length?Math.min(...vals):NaN,max:vals.length?Math.max(...vals):NaN};
  }
  return out;
}

function outsideEnvelope(projected,projectedTph,envelope,adjustments){
  const outside=[];
  for(const f of HISTORICAL_FIELDS){
    const adj=adjustments?.[f.key];
    if(!adj||adj.mode==='none'||Number(adj.value)===0) continue;
    const v=f.key==='throughput'?projectedTph:Number(projected[f.key]);
    const e=envelope[f.key];
    if(Number.isFinite(v)&&e&&Number.isFinite(e.min)&&Number.isFinite(e.max)&&(v<e.min||v>e.max)) outside.push(f.key);
  }
  return outside;
}

export function lookupRangeViolations(v){
  const tests=[
    ['primary_air_mean_temp',(Number(v.primary_temp)+T_REF)/2,PRIMARY_CP_X],
    ['secondary_air_mean_temp',(Number(v.secondary_temp)+T_REF)/2,SECONDARY_CP_X],
    ['process_air_mean_temp',(Number(v.process_temp)+T_REF)/2,PROCESS_CP_X],
    ['flue_gas_mean_temp',(Number(v.fg_temp)+T_REF)/2,FG_CP_X],
    ['feedwater_temp',Number(v.feedwater_temp),FEEDWATER_T],
    ['steam_temp',Number(v.steam_temp),STEAM_T],
    ['drum_pressure_abs',Number(v.drum_pressure)+1,DRUM_P]
  ];
  return tests.filter(([,x,r])=>Number.isFinite(x)&&(x<r[0]||x>r[r.length-1])).map(([n])=>n);
}

function statusFor({hb,projected,projectedTph,heatLimit,mechLimit,allowExtrapolation,lookupViolations,outside,error}){
  const flags=[];
  if(error||!hb||!Number.isFinite(projectedTph)||projectedTph<=0) flags.push('INVALID_INPUT');
  if(lookupViolations.length) flags.push('LOOKUP_EXTRAPOLATION');
  if(Number.isFinite(projected?.steam_flow)&&projected.steam_flow<=STEAM_MIN) flags.push('LOW_STEAM');
  if(hb&&Number.isFinite(hb.waste_heat_input_mw)&&hb.waste_heat_input_mw>heatLimit) flags.push('THERMAL_OVERLOAD');
  if(Number.isFinite(projectedTph)&&projectedTph>mechLimit) flags.push('MECHANICAL_OVERLOAD');
  if(outside.length) flags.push('OUTSIDE_HISTORICAL_RANGE');
  if(lookupViolations.length&&!allowExtrapolation&&!flags.includes('INVALID_INPUT')) flags.push('INVALID_INPUT');
  return flags.length?[...new Set(flags)].join('; '):'OK';
}


export function anchoredScenarioCalculation(baseline,projected,projectedTph,allowExtrapolation=false){
  if(!baseline||!projected||!Number.isFinite(Number(projectedTph))||Number(projectedTph)<=0) throw new Error('Projected throughput must be > 0');
  const baseTph=Number(baseline.throughput_8h_tph);
  if(!Number.isFinite(baseTph)||baseTph<=0) throw new Error('Actual 8h throughput is invalid');
  const baseState={...baseline,process_air_flow:Number.isFinite(Number(baseline.process_air_flow))?Number(baseline.process_air_flow):PROCESS_AIR};
  const projectedState={...projected,process_air_flow:Number.isFinite(Number(projected.process_air_flow))?Number(projected.process_air_flow):PROCESS_AIR};
  const baseModel=heatBalance(baseState,baseTph,allowExtrapolation);
  const projectedModel=heatBalance(projectedState,Number(projectedTph),allowExtrapolation);
  const actualHeat=Number(baseline.waste_heat_8h_mw);
  const modelHeatDelta=projectedModel.waste_heat_input_mw-baseModel.waste_heat_input_mw;
  const anchoredHeat=Number.isFinite(actualHeat)?actualHeat+modelHeatDelta:projectedModel.waste_heat_input_mw;
  const anchoredNcv=anchoredHeat*3.6/Number(projectedTph);
  return {
    ...projectedModel,
    waste_heat_input_mw:anchoredHeat,
    ncv_mjkg:anchoredNcv,
    raw_model_waste_heat_mw:projectedModel.waste_heat_input_mw,
    raw_model_ncv_mjkg:projectedModel.ncv_mjkg,
    baseline_raw_model_waste_heat_mw:baseModel.waste_heat_input_mw,
    baseline_raw_model_ncv_mjkg:baseModel.ncv_mjkg,
    model_waste_heat_delta_mw:modelHeatDelta,
    anchor_actual_waste_heat_mw:actualHeat,
    anchored:Number.isFinite(actualHeat)
  };
}

export function historicalSensitivityRows(calc,adjustments,activeLines=3,heatLimit=86.8,mechLimit=46.0,allowExtrapolation=false){
  if(!calc?.result?.length)return [];
  const baselineRows=hourEnds(calc).map(({hour,end})=>({hour,end,baseline:baselineFromWindowAt(calc,end,8)})).filter(x=>x.baseline&&finite(x.baseline.throughput_8h_tph)&&finite(x.baseline.ncv_8h_mjkg)&&finite(x.baseline.waste_heat_8h_mw));
  const envelope=buildEnvelope(baselineRows);
  const out=[];
  for(const item of baselineRows){
    const b=item.baseline;
    const projected={...b,process_air_flow:baselineValue(b,'process_air_flow')};
    const projectedTph=applyAdjustment(b.throughput_8h_tph,adjustments?.throughput);
    for(const f of HISTORICAL_FIELDS){
      if(f.key==='throughput')continue;
      const base=baselineValue(b,f.key);
      if(Number.isFinite(base))projected[f.key]=applyAdjustment(base,adjustments?.[f.key]);
    }
    const lookupViolations=lookupRangeViolations(projected);
    const outside=outsideEnvelope(projected,projectedTph,envelope,adjustments);
    let hb=null,error='';
    try{
      if(!Number.isFinite(projectedTph)||projectedTph<=0)throw new Error('Projected throughput must be > 0');
      hb=anchoredScenarioCalculation(b,projected,projectedTph,allowExtrapolation);
    }catch(e){error=e?.message||String(e);}
    const status=statusFor({hb,projected,projectedTph,heatLimit,mechLimit,allowExtrapolation,lookupViolations,outside,error});
    const projectedNcv=hb?.ncv_mjkg;
    const deltaNcv=Number.isFinite(projectedNcv)&&Number.isFinite(b.ncv_8h_mjkg)?projectedNcv-b.ncv_8h_mjkg:NaN;
    const projectedHeat=hb?.waste_heat_input_mw;
    out.push({
      'Hour':item.hour,
      'Baseline window end':b.window_end instanceof Date?b.window_end.toISOString():'',
      'Actual NCV 8h (MJ/kg)':b.ncv_8h_mjkg,
      'Projected calculated NCV (MJ/kg)':projectedNcv,
      'Delta NCV (MJ/kg)':deltaNcv,
      'Actual waste 8h (t/h)':b.throughput_8h_tph,
      'Projected waste (t/h)':projectedTph,
      'Delta waste (t/h)':projectedTph-b.throughput_8h_tph,
      'Actual plant rate (t/day)':b.throughput_8h_tph*24*activeLines,
      'Projected plant rate (t/day)':projectedTph*24*activeLines,
      'Actual waste heat 8h (MW)':b.waste_heat_8h_mw,
      'Projected waste heat (MW)':projectedHeat,
      'Raw scenario model waste heat (MW)':hb?.raw_model_waste_heat_mw,
      'Model heat-balance delta (MW)':hb?.model_waste_heat_delta_mw,
      'Delta waste heat (MW)':Number.isFinite(projectedHeat)?projectedHeat-b.waste_heat_8h_mw:NaN,
      'Projected thermal load (%)':Number.isFinite(projectedHeat)&&heatLimit>0?projectedHeat/heatLimit*100:NaN,
      'Projected mechanical load (%)':mechLimit>0?projectedTph/mechLimit*100:NaN,
      'Actual steam flow (t/h)':b.steam_flow,
      'Projected steam flow (t/h)':projected.steam_flow,
      'Actual steam temp (C)':b.steam_temp,
      'Projected steam temp (C)':projected.steam_temp,
      'Actual steam pressure (bar)':b.steam_pressure,
      'Projected steam pressure (bar)':projected.steam_pressure,
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
      'Actual process air flow (Nm3/h)':baselineValue(b,'process_air_flow'),
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
      'Lookup range flags':lookupViolations.join(', '),
      'Historical envelope flags':outside.join(', '),
      'Scenario Status':status,
      'Calculation error':error
    });
  }
  return out;
}

export function historicalSummary(rows,activeLines=3,heatLimit=86.8,mechLimit=46.0){
  const valid=rows.filter(r=>Number.isFinite(r['Projected calculated NCV (MJ/kg)']));
  const deltas=valid.map(r=>r['Delta NCV (MJ/kg)']);
  const extraWaste=valid.map(r=>r['Delta waste (t/h)']);
  const summary={
    hours:rows.length,
    valid_hours:valid.length,
    actual_mean_ncv:mean(valid.map(r=>r['Actual NCV 8h (MJ/kg)'])),
    projected_mean_ncv:mean(valid.map(r=>r['Projected calculated NCV (MJ/kg)'])),
    actual_median_ncv:median(valid.map(r=>r['Actual NCV 8h (MJ/kg)'])),
    projected_median_ncv:median(valid.map(r=>r['Projected calculated NCV (MJ/kg)'])),
    ncv_decrease_hours:deltas.filter(v=>v<-1e-6).length,
    ncv_increase_hours:deltas.filter(v=>v>1e-6).length,
    ncv_unchanged_hours:deltas.filter(v=>Math.abs(v)<=1e-6).length,
    average_extra_waste_tph:mean(extraWaste),
    total_extra_waste_t:extraWaste.reduce((s,v)=>s+(Number.isFinite(v)?v:0),0),
    projected_average_thermal_load_pct:mean(valid.map(r=>r['Projected thermal load (%)'])),
    projected_max_thermal_load_pct:max(valid.map(r=>r['Projected thermal load (%)'])),
    hours_over_thermal_limit:valid.filter(r=>r['Projected waste heat (MW)']>heatLimit).length,
    hours_over_mechanical_limit:valid.filter(r=>r['Projected waste (t/h)']>mechLimit).length,
    projected_average_steam_tph:mean(valid.map(r=>r['Projected steam flow (t/h)'])),
    projected_max_steam_tph:max(valid.map(r=>r['Projected steam flow (t/h)']))
  };
  for(const tpd of [3000,3100,3200,3300]){
    const tph=tpd/24/activeLines;
    summary[`hours_achieving_${tpd}_tpd`]=valid.filter(r=>r['Projected waste (t/h)']>=tph&&r['Projected waste heat (MW)']<=heatLimit&&r['Projected waste (t/h)']<=mechLimit&&!String(r['Scenario Status']).includes('INVALID_INPUT')&&!String(r['Scenario Status']).includes('LOW_STEAM')).length;
  }
  return summary;
}

export function dailySummaryRows(rows){
  const groups=new Map();
  for(const r of rows){
    const day=String(r.Hour||'').slice(0,10);if(!day)continue;
    if(!groups.has(day))groups.set(day,[]);groups.get(day).push(r);
  }
  const out=[];
  for(const [day,rs] of groups){
    out.push({
      'Date':day,
      'Hours':rs.length,
      'Actual mean NCV (MJ/kg)':mean(rs.map(r=>r['Actual NCV 8h (MJ/kg)'])),
      'Projected mean NCV (MJ/kg)':mean(rs.map(r=>r['Projected calculated NCV (MJ/kg)'])),
      'Actual mean waste (t/h)':mean(rs.map(r=>r['Actual waste 8h (t/h)'])),
      'Projected mean waste (t/h)':mean(rs.map(r=>r['Projected waste (t/h)'])),
      'Extra waste (t/day-equivalent)':rs.reduce((s,r)=>s+(Number(r['Delta waste (t/h)'])||0),0),
      'Actual mean heat (MW)':mean(rs.map(r=>r['Actual waste heat 8h (MW)'])),
      'Projected mean heat (MW)':mean(rs.map(r=>r['Projected waste heat (MW)'])),
      'Projected mean steam (t/h)':mean(rs.map(r=>r['Projected steam flow (t/h)'])),
      'NCV decrease hours':rs.filter(r=>r['Delta NCV (MJ/kg)']<0).length,
      'Thermal overload hours':rs.filter(r=>String(r['Scenario Status']).includes('THERMAL_OVERLOAD')).length,
      'Mechanical overload hours':rs.filter(r=>String(r['Scenario Status']).includes('MECHANICAL_OVERLOAD')).length,
      'Outside historical range hours':rs.filter(r=>String(r['Scenario Status']).includes('OUTSIDE_HISTORICAL_RANGE')).length
    });
  }
  return out;
}

export function scenarioDistributionRows(rows){
  const total=rows.length||1;
  const categories=[
    ['NCV_DECREASE',r=>Number(r['Delta NCV (MJ/kg)'])<0],
    ['NCV_INCREASE',r=>Number(r['Delta NCV (MJ/kg)'])>0],
    ['NCV_UNCHANGED',r=>Number.isFinite(Number(r['Delta NCV (MJ/kg)']))&&Math.abs(Number(r['Delta NCV (MJ/kg)']))<=1e-6],
    ['OK',r=>r['Scenario Status']==='OK'],
    ['THERMAL_OVERLOAD',r=>String(r['Scenario Status']).includes('THERMAL_OVERLOAD')],
    ['MECHANICAL_OVERLOAD',r=>String(r['Scenario Status']).includes('MECHANICAL_OVERLOAD')],
    ['LOW_STEAM',r=>String(r['Scenario Status']).includes('LOW_STEAM')],
    ['LOOKUP_EXTRAPOLATION',r=>String(r['Scenario Status']).includes('LOOKUP_EXTRAPOLATION')],
    ['OUTSIDE_HISTORICAL_RANGE',r=>String(r['Scenario Status']).includes('OUTSIDE_HISTORICAL_RANGE')],
    ['INVALID_INPUT',r=>String(r['Scenario Status']).includes('INVALID_INPUT')]
  ];
  return categories.map(([category,fn])=>{const count=rows.filter(fn).length;return {Category:category,Hours:count,'Share (%)':count/total*100};});
}

export function historicalActualRows(rows){
  return rows.map(r=>({
    'Hour':r.Hour,
    'Actual NCV 8h (MJ/kg)':r['Actual NCV 8h (MJ/kg)'],
    'Actual waste 8h (t/h)':r['Actual waste 8h (t/h)'],
    'Actual plant rate (t/day)':r['Actual plant rate (t/day)'],
    'Actual waste heat 8h (MW)':r['Actual waste heat 8h (MW)'],
    'Actual steam flow (t/h)':r['Actual steam flow (t/h)'],
    'Actual steam temp (C)':r['Actual steam temp (C)'],
    'Actual steam pressure (bar)':r['Actual steam pressure (bar)'],
    'Actual feedwater temp (C)':r['Actual feedwater temp (C)'],
    'Actual primary air flow (Nm3/h)':r['Actual primary air flow (Nm3/h)'],
    'Actual primary air temp (C)':r['Actual primary air temp (C)'],
    'Actual secondary air flow (Nm3/h)':r['Actual secondary air flow (Nm3/h)'],
    'Actual secondary air temp (C)':r['Actual secondary air temp (C)'],
    'Actual process air flow (Nm3/h)':r['Actual process air flow (Nm3/h)'],
    'Actual process air temp (C)':r['Actual process air temp (C)'],
    'Actual water injection (m3/h)':r['Actual water injection (m3/h)'],
    'Actual drum pressure (bar)':r['Actual drum pressure (bar)'],
    'Actual PA preheater steam (t/h)':r['Actual PA preheater steam (t/h)'],
    'Actual flue gas temp (C)':r['Actual flue gas temp (C)']
  }));
}

export function historicalProjectedRows(rows){
  return rows.map(r=>({
    'Hour':r.Hour,
    'Projected calculated NCV (MJ/kg)':r['Projected calculated NCV (MJ/kg)'],
    'Projected waste (t/h)':r['Projected waste (t/h)'],
    'Projected plant rate (t/day)':r['Projected plant rate (t/day)'],
    'Projected waste heat (MW)':r['Projected waste heat (MW)'],
    'Projected thermal load (%)':r['Projected thermal load (%)'],
    'Projected mechanical load (%)':r['Projected mechanical load (%)'],
    'Projected steam flow (t/h)':r['Projected steam flow (t/h)'],
    'Projected steam temp (C)':r['Projected steam temp (C)'],
    'Projected steam pressure (bar)':r['Projected steam pressure (bar)'],
    'Projected feedwater temp (C)':r['Projected feedwater temp (C)'],
    'Projected primary air flow (Nm3/h)':r['Projected primary air flow (Nm3/h)'],
    'Projected primary air temp (C)':r['Projected primary air temp (C)'],
    'Projected secondary air flow (Nm3/h)':r['Projected secondary air flow (Nm3/h)'],
    'Projected secondary air temp (C)':r['Projected secondary air temp (C)'],
    'Projected process air flow (Nm3/h)':r['Projected process air flow (Nm3/h)'],
    'Projected process air temp (C)':r['Projected process air temp (C)'],
    'Projected water injection (m3/h)':r['Projected water injection (m3/h)'],
    'Projected drum pressure (bar)':r['Projected drum pressure (bar)'],
    'Projected PA preheater steam (t/h)':r['Projected PA preheater steam (t/h)'],
    'Projected flue gas temp (C)':r['Projected flue gas temp (C)'],
    'Scenario Status':r['Scenario Status']
  }));
}

export function sensitivityDecomposition(baseline,scenario,scenarioTph,allowExtrapolation=false){
  if(!baseline||!scenario)return [];
  const baseState={...baseline,process_air_flow:Number.isFinite(Number(baseline.process_air_flow))?Number(baseline.process_air_flow):PROCESS_AIR};
  const baseTph=Number(baseline.throughput_8h_tph);
  const actualReferenceNcv=Number(baseline.ncv_8h_mjkg);
  const actualReferenceHeat=Number(baseline.waste_heat_8h_mw);
  const rows=[];
  const fields=[
    ['Waste throughput','throughput','t/h'],
    ['Primary air flow','primary_flow','Nm³/h'],['Primary air temperature','primary_temp','°C'],
    ['Secondary air flow','secondary_flow','Nm³/h'],['Secondary air temperature','secondary_temp','°C'],
    ['Process air flow','process_air_flow','Nm³/h'],['Process air temperature','process_temp','°C'],
    ['Feedwater temperature','feedwater_temp','°C'],['Water injection','water','m³/h'],
    ['Live steam flow','steam_flow','t/h'],['Live steam temperature','steam_temp','°C'],
    ['Drum pressure','drum_pressure','bar'],['PA preheater steam','pa_preheater_flow','t/h'],['Flue gas temperature','fg_temp','°C']
  ];
  for(const [label,key,unit] of fields){
    const a=key==='throughput'?baseTph:Number(baseState[key]);
    const b=key==='throughput'?Number(scenarioTph):Number(scenario[key]);
    if(!Number.isFinite(a)||!Number.isFinite(b)||Math.abs(a-b)<1e-12)continue;
    const state={...baseState};let tph=baseTph;
    if(key==='throughput')tph=b;else state[key]=b;
    try{
      const c=anchoredScenarioCalculation(baseline,state,tph,allowExtrapolation);
      rows.push({'Sensitivity':'One-at-a-time','Parameter':label,'Baseline':a,'Scenario':b,'Unit':unit,'Standalone NCV delta (MJ/kg)':c.ncv_mjkg-actualReferenceNcv,'Standalone waste heat delta (MW)':c.waste_heat_input_mw-actualReferenceHeat,'Raw model heat delta (MW)':c.model_waste_heat_delta_mw});
    }catch(e){rows.push({'Sensitivity':'One-at-a-time','Parameter':label,'Baseline':a,'Scenario':b,'Unit':unit,'Standalone NCV delta (MJ/kg)':NaN,'Standalone waste heat delta (MW)':NaN,'Note':e.message});}
  }
  try{
    const all=anchoredScenarioCalculation(baseline,{...scenario,process_air_flow:Number.isFinite(Number(scenario.process_air_flow))?Number(scenario.process_air_flow):PROCESS_AIR},Number(scenarioTph),allowExtrapolation);
    rows.push({'Sensitivity':'Combined','Parameter':'All scenario changes combined','Baseline':actualReferenceNcv,'Scenario':all.ncv_mjkg,'Unit':'MJ/kg','Standalone NCV delta (MJ/kg)':all.ncv_mjkg-actualReferenceNcv,'Standalone waste heat delta (MW)':all.waste_heat_input_mw-actualReferenceHeat,'Raw model heat delta (MW)':all.model_waste_heat_delta_mw,'Note':'OAT rows are anchored to the actual HZI 8h point; they are not additive and are not causal attribution.'});
  }catch{}
  return rows;
}
