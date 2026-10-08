'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import * as XLSX from 'xlsx';
import {
  findDateTimeColumn, calculateLine, baselineFromWindowAt, heatBalance,
  projectedCapacity, targetRows,
  PRIMARY_CP_X, PRIMARY_CP_Y, SECONDARY_CP_X, SECONDARY_CP_Y, PROCESS_CP_X, PROCESS_CP_Y,
  FG_CP_X, FG_CP_Y, FEEDWATER_T, FEEDWATER_H, STEAM_T, STEAM_H, DRUM_P, BLOWDOWN_H, SAT_STEAM_H,
  PROCESS_AIR, STEAM_MIN
} from '../../lib/ncv';
import {
  HISTORICAL_FIELDS, defaultAdjustments, historicalSensitivityRows, historicalSummary,
  dailySummaryRows, scenarioDistributionRows, historicalActualRows, historicalProjectedRows,
  sensitivityDecomposition, lookupRangeViolations, anchoredScenarioCalculation
} from '../../lib/scenario';
import { readHistorianFile, displayDateTime, toDateTimeLocal } from '../../lib/historian';

const BUILD='2026.10.01-vercel-r6';
const OWNER='Fırat SARP & Adem Şenocak';
const fmt=(v,d=2)=>Number.isFinite(Number(v))?Number(v).toLocaleString(undefined,{minimumFractionDigits:d,maximumFractionDigits:d}):'—';

function Input({label,value,onChange,step='any',unit,disabled=false,note}){
  return <label className={`inputRow ${disabled?'disabledRow':''}`}><span>{label}{note&&<small className="rowNote">{note}</small>}</span><div><input disabled={disabled} type="number" step={step} value={Number.isFinite(Number(value))?value:''} onChange={e=>onChange(Number(e.target.value))}/><em>{unit}</em></div></label>;
}
function Kpi({label,value,sub,tone}){return <div className={`kpi ${tone||''}`}><span>{label}</span><strong>{value}</strong>{sub&&<small>{sub}</small>}</div>}
function AdjustmentRow({field,adjustment,onChange,available=true}){
  const mode=adjustment?.mode||'none';
  const unit=mode==='percent'?'%':field.unit;
  return <div className={`adjustRow ${!available?'disabledRow':''}`}>
    <div className="adjustLabel"><strong>{field.label}</strong>{field.informational&&<small>context only; not used by current table-based steam enthalpy</small>}</div>
    <select disabled={!available} value={mode} onChange={e=>onChange({...adjustment,mode:e.target.value})}>
      <option value="none">No change</option><option value="percent">% Relative</option><option value="delta">Absolute Δ</option>
    </select>
    <div className="adjustValue"><input disabled={!available||mode==='none'} type="number" step="any" value={Number(adjustment?.value)||0} onChange={e=>onChange({...adjustment,value:Number(e.target.value)})}/><em>{unit}</em></div>
  </div>;
}

function appendSheet(wb,name,ws,widths){
  if(widths)ws['!cols']=widths.map(w=>({wch:w}));
  XLSX.utils.book_append_sheet(wb,ws,name);
}
function aoa(rows){return XLSX.utils.aoa_to_sheet(rows);}
function json(rows){return XLSX.utils.json_to_sheet(rows.length?rows:[{'No data':'—'}]);}
function mean(values){const v=values.map(Number).filter(Number.isFinite);return v.length?v.reduce((a,b)=>a+b,0)/v.length:NaN;}
function median(values){const v=values.map(Number).filter(Number.isFinite).sort((a,b)=>a-b);if(!v.length)return NaN;const m=Math.floor(v.length/2);return v.length%2?v[m]:(v[m-1]+v[m])/2;}

export default function ScenarioPage(){
  const [fileName,setFileName]=useState('');
  const [status,setStatus]=useState('Upload a historian .xls or .xlsx file.');
  const [lines,setLines]=useState({});
  const [selectedLine,setSelectedLine]=useState(1);
  const [mode,setMode]=useState('specific');
  const [baseline,setBaseline]=useState(null);
  const [baselineEnd,setBaselineEnd]=useState('');
  const [scenario,setScenario]=useState(null);
  const [activeLines,setActiveLines]=useState(3);
  const [heatLimit,setHeatLimit]=useState(86.8);
  const [mechLimit,setMechLimit]=useState(46.0);
  const [scenarioTph,setScenarioTph]=useState(41.67);
  const [manualWasteNcvEnabled,setManualWasteNcvEnabled]=useState(false);
  const [manualWasteNcv,setManualWasteNcv]=useState(NaN);
  const [forecastDateTime,setForecastDateTime]=useState('');
  const [allowExtrap,setAllowExtrap]=useState(false);
  const [adjustments,setAdjustments]=useState(()=>defaultAdjustments());
  const calc=lines[selectedLine];

  function applyBaseline(c,endTime){
    const b=baselineFromWindowAt(c,endTime,8);
    if(!b)return false;
    setBaseline(b);setBaselineEnd(toDateTimeLocal(b.window_end));setScenario({...b,process_air_flow:PROCESS_AIR});
    if(Number.isFinite(b.throughput_8h_tph))setScenarioTph(b.throughput_8h_tph);
    if(Number.isFinite(b.ncv_8h_mjkg))setManualWasteNcv(b.ncv_8h_mjkg);
    setForecastDateTime(toDateTimeLocal(new Date(b.window_end.getTime()+7*24*3600000)));
    return true;
  }

  async function loadFile(file){
    if(!file)return;setStatus('Reading historian file…');setFileName(file.name);
    try{
      const {headers,rows,headerRow}=await readHistorianFile(file);const dateCol=findDateTimeColumn(headers);const found={};const skipped=[];
      for(const line of [1,2,3]){const c=calculateLine(rows,headers,line,dateCol);if(c.ok)found[line]=c;else skipped.push(`L${line}: ${c.missing.join(', ')}`);}
      const avail=Object.keys(found).map(Number);if(!avail.length)throw new Error('No line could be calculated. Required historian signals or TODAY waste counter are missing.');
      setLines(found);const first=avail[0];setSelectedLine(first);applyBaseline(found[first],found[first].rows.at(-1)?.date);setAdjustments(defaultAdjustments());
      setStatus(`Historian loaded: ${rows.length.toLocaleString()} rows • header row ${headerRow+1} • available lines ${avail.join(', ')}${skipped.length?` • skipped ${skipped.join(' | ')}`:''}`);
    }catch(e){console.error(e);setLines({});setBaseline(null);setScenario(null);setStatus(`Error: ${e.message}`);}
  }
  function chooseLine(line){setSelectedLine(line);const c=lines[line];if(c)applyBaseline(c,c.rows.at(-1)?.date);}
  function chooseBaselineDateTime(v){if(!calc||!v)return;const requested=new Date(v);if(Number.isNaN(requested.getTime()))return;if(!applyBaseline(calc,requested))setStatus('Could not create an 8-hour baseline at the selected date/time.');}
  function setSc(k,v){setScenario(s=>({...s,[k]:v}));}
  function setAdj(k,v){setAdjustments(a=>({...a,[k]:v}));}

  const scenarioCalc=useMemo(()=>{if(!scenario||!baseline||!Number.isFinite(scenarioTph)||scenarioTph<=0)return null;try{return {ok:true,...anchoredScenarioCalculation(baseline,scenario,scenarioTph,allowExtrap)}}catch(e){return {ok:false,error:e.message}}},[baseline,scenario,scenarioTph,allowExtrap]);
  const baselineCalc=useMemo(()=>{if(!baseline)return null;try{return {ok:true,...heatBalance({...baseline,process_air_flow:PROCESS_AIR},baseline.throughput_8h_tph,allowExtrap)}}catch(e){return {ok:false,error:e.message}}},[baseline,allowExtrap]);
  const targets=targetRows(heatLimit,activeLines,mechLimit);
  const futureWasteNcv=manualWasteNcvEnabled&&Number.isFinite(manualWasteNcv)&&manualWasteNcv>0?manualWasteNcv:NaN;
  const expectedWasteHeat=Number.isFinite(futureWasteNcv)&&Number.isFinite(scenarioTph)?scenarioTph*futureWasteNcv/3.6:NaN;
  const capacity=Number.isFinite(futureWasteNcv)?projectedCapacity(futureWasteNcv,heatLimit,mechLimit):NaN;
  const plantTpd=scenarioTph*24*activeLines;
  const specificLookupFlags=useMemo(()=>scenario?lookupRangeViolations(scenario):[],[scenario]);
  const specificStatus=useMemo(()=>{
    const flags=[];if(!scenarioCalc?.ok)flags.push('INVALID_INPUT');if(specificLookupFlags.length)flags.push('LOOKUP_EXTRAPOLATION');
    if(Number(scenario?.steam_flow)<=STEAM_MIN)flags.push('LOW_STEAM');if(scenarioCalc?.waste_heat_input_mw>heatLimit)flags.push('THERMAL_OVERLOAD');if(scenarioTph>mechLimit)flags.push('MECHANICAL_OVERLOAD');return flags.length?flags.join('; '):'OK';
  },[scenarioCalc,specificLookupFlags,scenario,scenarioTph,heatLimit,mechLimit]);

  const historicalRows=useMemo(()=>calc?historicalSensitivityRows(calc,adjustments,activeLines,heatLimit,mechLimit,allowExtrap):[],[calc,adjustments,activeLines,heatLimit,mechLimit,allowExtrap]);
  const histSummary=useMemo(()=>historicalSummary(historicalRows,activeLines,heatLimit,mechLimit),[historicalRows,activeLines,heatLimit,mechLimit]);
  const dailyRows=useMemo(()=>dailySummaryRows(historicalRows),[historicalRows]);
  const distributionRows=useMemo(()=>scenarioDistributionRows(historicalRows),[historicalRows]);
  const sensitivityRows=useMemo(()=>baseline&&scenario?sensitivityDecomposition(baseline,scenario,scenarioTph,allowExtrap):[],[baseline,scenario,scenarioTph,allowExtrap]);

  const minDate=calc?.rows?.[0]?.date?toDateTimeLocal(calc.rows[0].date):'';
  const maxDate=calc?.rows?.length?toDateTimeLocal(calc.rows.at(-1).date):'';
  const historicalPreview=historicalRows.slice(-12);

  function exportExcel(){
    if(!calc||!baseline||!scenarioCalc?.ok)return;
    const wb=XLSX.utils.book_new();
    const execRows=[
      ['NCV Scenario Analysis','HZI 90101284 Rev. 3.1'],['Build',`${BUILD} ${OWNER}`],['Historian file',fileName],['Line',selectedLine],[],
      ['SPECIFIC 8H SCENARIO'],['Baseline end',displayDateTime(baseline.window_end)],['Baseline start',displayDateTime(baseline.window_start)],['Specific scenario status',specificStatus],
      ['Actual HZI NCV 8h (MJ/kg)',baseline.ncv_8h_mjkg],['Scenario calculated NCV (MJ/kg)',scenarioCalc.ncv_mjkg],['NCV delta (MJ/kg)',scenarioCalc.ncv_mjkg-baseline.ncv_8h_mjkg],['Actual waste (t/h)',baseline.throughput_8h_tph],['Scenario waste (t/h)',scenarioTph],['Actual waste heat 8h (MW)',baseline.waste_heat_8h_mw],['Scenario calculated waste heat (MW)',scenarioCalc.waste_heat_input_mw],[],
      ['HISTORICAL RELATIVE SENSITIVITY'],['Hourly 8h operating points',histSummary.hours],['Valid projected hours',histSummary.valid_hours],['Actual mean NCV (MJ/kg)',histSummary.actual_mean_ncv],['Projected mean NCV (MJ/kg)',histSummary.projected_mean_ncv],['Actual median NCV (MJ/kg)',histSummary.actual_median_ncv],['Projected median NCV (MJ/kg)',histSummary.projected_median_ncv],['NCV decrease hours',histSummary.ncv_decrease_hours],['NCV increase hours',histSummary.ncv_increase_hours],['Average extra waste (t/h)',histSummary.average_extra_waste_tph],['Total extra waste across hourly points (t)',histSummary.total_extra_waste_t],['Average projected thermal load (%)',histSummary.projected_average_thermal_load_pct],['Maximum projected thermal load (%)',histSummary.projected_max_thermal_load_pct],['Hours above thermal limit',histSummary.hours_over_thermal_limit],['Hours above mechanical limit',histSummary.hours_over_mechanical_limit],['Projected average steam (t/h)',histSummary.projected_average_steam_tph],['Projected max steam (t/h)',histSummary.projected_max_steam_tph],['Hours achieving 3000 t/day',histSummary.hours_achieving_3000_tpd],['Hours achieving 3100 t/day',histSummary.hours_achieving_3100_tpd],['Hours achieving 3200 t/day',histSummary.hours_achieving_3200_tpd],['Hours achieving 3300 t/day',histSummary.hours_achieving_3300_tpd]
    ];
    appendSheet(wb,'Executive_Summary',aoa(execRows),[38,24]);

    const settings=[['Scenario settings'],['Build',`${BUILD} ${OWNER}`],['Line',selectedLine],['Active lines',activeLines],['Thermal limit MW/line',heatLimit],['Mechanical limit t/h/line',mechLimit],['Allow lookup extrapolation',allowExtrap?'YES':'NO'],[],['Specific 8h absolute inputs','Actual','Scenario','Delta','Unit']];
    const specificFields=[
      ['Waste throughput',baseline.throughput_8h_tph,scenarioTph,'t/h'],['Live steam flow',baseline.steam_flow,scenario.steam_flow,'t/h'],['Live steam temperature',baseline.steam_temp,scenario.steam_temp,'°C'],['Live steam pressure',baseline.steam_pressure,scenario.steam_pressure,'bar'],['Feedwater temperature',baseline.feedwater_temp,scenario.feedwater_temp,'°C'],['Drum pressure',baseline.drum_pressure,scenario.drum_pressure,'bar'],['PA preheater steam',baseline.pa_preheater_flow,scenario.pa_preheater_flow,'t/h'],['Primary air flow',baseline.primary_flow,scenario.primary_flow,'Nm3/h'],['Primary air temperature',baseline.primary_temp,scenario.primary_temp,'°C'],['Secondary air flow',baseline.secondary_flow,scenario.secondary_flow,'Nm3/h'],['Secondary air temperature',baseline.secondary_temp,scenario.secondary_temp,'°C'],['Process air flow',PROCESS_AIR,scenario.process_air_flow,'Nm3/h'],['Process air temperature',baseline.process_temp,scenario.process_temp,'°C'],['Flue gas temperature',baseline.fg_temp,scenario.fg_temp,'°C'],['Water injection',baseline.water,scenario.water,'m3/h']
    ];
    specificFields.forEach(([n,a,s,u])=>settings.push([n,a,s,Number.isFinite(Number(a))&&Number.isFinite(Number(s))?Number(s)-Number(a):'',u]));
    settings.push([],['Manual future waste quality enabled',manualWasteNcvEnabled?'YES':'NO'],['Expected future waste NCV (MJ/kg)',manualWasteNcvEnabled?manualWasteNcv:''],['Forecast date/time',forecastDateTime],[],['Historical sensitivity adjustments','Mode','Value','Unit','Note']);
    HISTORICAL_FIELDS.forEach(f=>{const a=adjustments[f.key]||{mode:'none',value:0};settings.push([f.label,a.mode,a.value,a.mode==='percent'?'%':f.unit,f.informational?'Context only; not used in current table-based steam enthalpy':'']);});
    appendSheet(wb,'Scenario_Settings',aoa(settings),[34,20,18,16,60]);

    const specificRows=[['Parameter','Actual 8h','Specific scenario','Delta','Unit'],...specificFields.map(([n,a,s,u])=>[n,a,s,Number.isFinite(Number(a))&&Number.isFinite(Number(s))?Number(s)-Number(a):'',u]),['HZI NCV 8h',baseline.ncv_8h_mjkg,scenarioCalc.ncv_mjkg,scenarioCalc.ncv_mjkg-baseline.ncv_8h_mjkg,'MJ/kg'],['Waste heat input',baseline.waste_heat_8h_mw,scenarioCalc.waste_heat_input_mw,scenarioCalc.waste_heat_input_mw-baseline.waste_heat_8h_mw,'MW'],['Plant-equivalent waste',baseline.throughput_8h_tph*24*activeLines,plantTpd,plantTpd-baseline.throughput_8h_tph*24*activeLines,'t/day'],['Scenario status','',specificStatus,'','']];
    appendSheet(wb,'Specific_8h',aoa(specificRows),[34,20,20,18,14]);

    const hbRows=[['Heat-balance component','Actual model baseline','Specific scenario','Delta'],['Primary air heat (MW)',baselineCalc?.q_primary_mw,scenarioCalc.q_primary_mw,scenarioCalc.q_primary_mw-baselineCalc?.q_primary_mw],['Secondary air heat (MW)',baselineCalc?.q_secondary_mw,scenarioCalc.q_secondary_mw,scenarioCalc.q_secondary_mw-baselineCalc?.q_secondary_mw],['Process air heat (MW)',baselineCalc?.q_process_mw,scenarioCalc.q_process_mw,scenarioCalc.q_process_mw-baselineCalc?.q_process_mw],['Water term (MW)',baselineCalc?.q_water_mw,scenarioCalc.q_water_mw,scenarioCalc.q_water_mw-baselineCalc?.q_water_mw],['Steam heat (MW)',baselineCalc?.q_steam_mw,scenarioCalc.q_steam_mw,scenarioCalc.q_steam_mw-baselineCalc?.q_steam_mw],['Blowdown heat (MW)',baselineCalc?.q_blowdown_mw,scenarioCalc.q_blowdown_mw,scenarioCalc.q_blowdown_mw-baselineCalc?.q_blowdown_mw],['PA preheater heat (MW)',baselineCalc?.q_pa_preheater_mw,scenarioCalc.q_pa_preheater_mw,scenarioCalc.q_pa_preheater_mw-baselineCalc?.q_pa_preheater_mw],['Useful heat (MW)',baselineCalc?.q_useful_mw,scenarioCalc.q_useful_mw,scenarioCalc.q_useful_mw-baselineCalc?.q_useful_mw],['Flue gas loss (MW)',baselineCalc?.q_fg_loss_mw,scenarioCalc.q_fg_loss_mw,scenarioCalc.q_fg_loss_mw-baselineCalc?.q_fg_loss_mw],['Bottom ash loss (MW)',baselineCalc?.q_bottom_loss_mw,scenarioCalc.q_bottom_loss_mw,scenarioCalc.q_bottom_loss_mw-baselineCalc?.q_bottom_loss_mw],['Fly ash loss (MW)',baselineCalc?.q_fly_loss_mw,scenarioCalc.q_fly_loss_mw,scenarioCalc.q_fly_loss_mw-baselineCalc?.q_fly_loss_mw],['Radiation loss (MW)',baselineCalc?.q_radiation_loss_mw,scenarioCalc.q_radiation_loss_mw,scenarioCalc.q_radiation_loss_mw-baselineCalc?.q_radiation_loss_mw],['Total losses (MW)',baselineCalc?.q_losses_mw,scenarioCalc.q_losses_mw,scenarioCalc.q_losses_mw-baselineCalc?.q_losses_mw],['Raw model waste heat (MW)',baselineCalc?.waste_heat_input_mw,scenarioCalc.raw_model_waste_heat_mw,scenarioCalc.raw_model_waste_heat_mw-baselineCalc?.waste_heat_input_mw],['Model heat-balance delta (MW)',0,scenarioCalc.model_waste_heat_delta_mw,scenarioCalc.model_waste_heat_delta_mw],['Anchored waste heat (MW)',baseline.waste_heat_8h_mw,scenarioCalc.waste_heat_input_mw,scenarioCalc.waste_heat_input_mw-baseline.waste_heat_8h_mw],['Calculated NCV (MJ/kg)',baseline.ncv_8h_mjkg,scenarioCalc.ncv_mjkg,scenarioCalc.ncv_mjkg-baseline.ncv_8h_mjkg],[],['Note','Scenario projections are anchored to the actual HZI 8h waste-heat point; the physics model contributes the scenario heat-balance delta. This makes a zero-change scenario reproduce Actual.'],['Note','Live steam pressure is exported as operating context. Current HZI table-based steam enthalpy implementation uses steam temperature; no invented pressure correction has been added.']];
    appendSheet(wb,'Specific_Heat_Balance',aoa(hbRows),[38,20,20,18]);
    appendSheet(wb,'NCV_Sensitivity',json(sensitivityRows),[20,34,16,16,14,24,28,56]);

    appendSheet(wb,'Historical_8h_Actual',json(historicalActualRows(historicalRows)),new Array(20).fill(18));
    appendSheet(wb,'Historical_8h_Projected',json(historicalProjectedRows(historicalRows)),new Array(24).fill(19));
    appendSheet(wb,'Historical_Comparison',json(historicalRows),new Array(44).fill(19));
    appendSheet(wb,'Daily_Summary',json(dailyRows),new Array(14).fill(20));
    appendSheet(wb,'Scenario_Distribution',json(distributionRows),[32,14,16]);

    const targetOut=targets.map(r=>({'Target total t/day':r.tpd,'Per-line t/h':r.tph,'Maximum NCV @ thermal limit (MJ/kg)':r.requiredNcv,'Mechanical status':r.mechanical,'Historical projected hours achieving target':histSummary[`hours_achieving_${r.tpd}_tpd`]||0}));
    appendSheet(wb,'Target_3000_3300',json(targetOut),[22,18,34,22,38]);
    const constraints=[['Constraint / check','Value','Unit','Interpretation'],['Thermal limit',heatLimit,'MW/line','Projected waste heat above this is THERMAL_OVERLOAD'],['Mechanical limit',mechLimit,'t/h/line','Projected throughput above this is MECHANICAL_OVERLOAD'],['Minimum steam for NCV active',STEAM_MIN,'t/h','At/below this is LOW_STEAM'],['Specific lookup range flags',specificLookupFlags.join(', ')||'None','','HZI lookup/table operating range check'],['Specific scenario status',specificStatus,'','Composite engineering status'],['Historical OUTSIDE_HISTORICAL_RANGE','','','Triggered when an adjusted variable moves outside the loaded historian envelope'],['Steam pressure treatment','','','Operating context only in this build; current table-based steam enthalpy uses steam temperature.']];
    appendSheet(wb,'Constraints',aoa(constraints),[34,24,18,72]);
    appendSheet(wb,'Source_Tags',json(Object.entries(calc.mapping).map(([k,v])=>({Signal:k,'Resolved historian column':v||''}))),[28,70]);
    const look=[['Table','X','Y']];[["Primary Cp",PRIMARY_CP_X,PRIMARY_CP_Y],["Secondary Cp",SECONDARY_CP_X,SECONDARY_CP_Y],["Process Cp",PROCESS_CP_X,PROCESS_CP_Y],["Flue gas Cp",FG_CP_X,FG_CP_Y],["Feedwater h",FEEDWATER_T,FEEDWATER_H],["Steam h",STEAM_T,STEAM_H],["Blowdown h",DRUM_P,BLOWDOWN_H],["Sat steam h",DRUM_P,SAT_STEAM_H]].forEach(([name,x,y])=>x.forEach((v,i)=>look.push([name,v,y[i]])));
    appendSheet(wb,'Lookup_Tables',aoa(look),[22,18,18]);
    XLSX.writeFile(wb,`NCV_Scenario_R6_Line${selectedLine}_${baselineEnd.replace(/[:T]/g,'-')}.xlsx`);
  }

  return <main>
    <nav className="topNav"><Link href="/">Home</Link><Link href="/ncv-calculation">NCV Calculation</Link><span>Scenario</span></nav>
    <header><div><p className="eyebrow">Istanbul WtE • Engineering decision support</p><h1>Waste NCV & Throughput Scenario Simulator</h1><p className="sub">Specific 8h absolute scenario + historical relative sensitivity • HZI 90101284 Rev. 3.1 heat balance</p></div><div className="build">Build {BUILD} {OWNER}</div></header>
    <section className="upload card"><div><h2>Historian input</h2><p>{status}</p></div><label className="fileBtn">Choose XLS / XLSX<input type="file" accept=".xls,.xlsx" onChange={e=>loadFile(e.target.files?.[0])}/></label></section>

    {Object.keys(lines).length>0&&<>
      <div className="lineTabs">{Object.keys(lines).map(k=><button className={Number(k)===selectedLine?'active':''} key={k} onClick={()=>chooseLine(Number(k))}>Line {k}</button>)}</div>
      <section className="card baselinePicker"><div><h2>Actual baseline date & time</h2><p>Specific Manual uses the selected 8-hour operating point. Historical Relative uses every historian hour with its own rolling 8-hour Actual baseline.</p></div><div className="baselinePickerControls"><input type="datetime-local" value={baselineEnd} min={minDate} max={maxDate} step="600" onChange={e=>chooseBaselineDateTime(e.target.value)}/><div className="baselineWindow"><strong>{displayDateTime(baseline?.window_end)}</strong><span>8h window: {displayDateTime(baseline?.window_start)} → {displayDateTime(baseline?.window_end)}</span></div></div></section>
      <div className="scenarioModeTabs"><button className={mode==='specific'?'active':''} onClick={()=>setMode('specific')}>Specific Manual • absolute values</button><button className={mode==='historical'?'active':''} onClick={()=>setMode('historical')}>Historical Relative • % / Δ</button></div>

      <div className="layout">
        <aside className="card controls">
          {mode==='specific'?<>
            <h2>Specific 8h scenario</h2><p className="controlHint">Absolute values apply only to the selected 8-hour baseline. No automatic process response is assumed.</p>
            <Input label="Waste throughput" value={scenarioTph} onChange={setScenarioTph} step="0.1" unit="t/h"/>
            <Input label="Primary air flow" value={scenario?.primary_flow} onChange={v=>setSc('primary_flow',v)} step="100" unit="Nm³/h"/><Input label="Primary air temp" value={scenario?.primary_temp} onChange={v=>setSc('primary_temp',v)} step="0.5" unit="°C"/>
            <Input label="Secondary air flow" value={scenario?.secondary_flow} onChange={v=>setSc('secondary_flow',v)} step="100" unit="Nm³/h"/><Input label="Secondary air temp" value={scenario?.secondary_temp} onChange={v=>setSc('secondary_temp',v)} step="0.5" unit="°C"/>
            <Input label="Process air flow" value={scenario?.process_air_flow} onChange={v=>setSc('process_air_flow',v)} step="100" unit="Nm³/h"/><Input label="Process air temp" value={scenario?.process_temp} onChange={v=>setSc('process_temp',v)} step="0.5" unit="°C"/>
            <Input label="Feedwater temp" value={scenario?.feedwater_temp} onChange={v=>setSc('feedwater_temp',v)} step="0.5" unit="°C"/><Input label="Water injection" value={scenario?.water} onChange={v=>setSc('water',v)} step="0.1" unit="m³/h"/>
            <Input label="Live steam flow" value={scenario?.steam_flow} onChange={v=>setSc('steam_flow',v)} step="0.1" unit="t/h"/><Input label="Live steam temp" value={scenario?.steam_temp} onChange={v=>setSc('steam_temp',v)} step="0.5" unit="°C"/>
            {Number.isFinite(Number(baseline?.steam_pressure))&&<Input label="Live steam pressure" value={scenario?.steam_pressure} onChange={v=>setSc('steam_pressure',v)} step="0.1" unit="bar" note="context only"/>}
            <Input label="Drum pressure" value={scenario?.drum_pressure} onChange={v=>setSc('drum_pressure',v)} step="0.1" unit="bar"/><Input label="PA preheater steam" value={scenario?.pa_preheater_flow} onChange={v=>setSc('pa_preheater_flow',v)} step="0.1" unit="t/h"/><Input label="Flue gas temp" value={scenario?.fg_temp} onChange={v=>setSc('fg_temp',v)} step="0.5" unit="°C"/>
            <hr/><h3>External future waste quality • optional</h3><p className="controlHint">Planning assumption only. It does not replace the HZI calculated NCV.</p><label className="check futureQualityToggle"><input type="checkbox" checked={manualWasteNcvEnabled} onChange={e=>setManualWasteNcvEnabled(e.target.checked)}/> Use manual future waste NCV</label>{manualWasteNcvEnabled&&<><Input label="Expected future waste NCV" value={manualWasteNcv} onChange={setManualWasteNcv} step="0.05" unit="MJ/kg"/><label className="dateInputRow"><span>Forecast date/time</span><input type="datetime-local" value={forecastDateTime} step="600" onChange={e=>setForecastDateTime(e.target.value)}/></label></>}
          </>:<>
            <h2>Historical Relative</h2><p className="controlHint">Each historian hour keeps its own 8-hour Actual baseline. Apply No change, % Relative or Absolute Δ. This avoids copying one specific 8h value over the whole dataset.</p>
            <div className="adjustments">{HISTORICAL_FIELDS.map(f=><AdjustmentRow key={f.key} field={f} adjustment={adjustments[f.key]} available={f.key!=='steam_pressure'||Number.isFinite(Number(baseline?.steam_pressure))} onChange={v=>setAdj(f.key,v)}/>)}</div>
            <button className="resetBtn" onClick={()=>setAdjustments(defaultAdjustments())}>Reset all historical adjustments</button>
          </>}
          <hr/><h3>Plant constraints</h3><Input label="Active lines" value={activeLines} onChange={setActiveLines} step="1" unit="lines"/><Input label="Thermal limit" value={heatLimit} onChange={setHeatLimit} step="0.1" unit="MW/line"/><Input label="Mechanical limit" value={mechLimit} onChange={setMechLimit} step="0.1" unit="t/h/line"/><label className="check"><input type="checkbox" checked={allowExtrap} onChange={e=>setAllowExtrap(e.target.checked)}/> Allow lookup extrapolation</label>
        </aside>

        <section className="content">
          <div className="card modeExplainer"><strong>{mode==='specific'?'Specific Manual':'Historical Relative'}</strong><span>{mode==='specific'?'Tests one selected 8h operating point with absolute values.':'Tests one relative operating strategy over all hourly 8h baselines.'}</span><button className="export" onClick={exportExcel}>Export full analysis Excel</button></div>
          {mode==='specific'?<>
            {!scenarioCalc?.ok&&<div className="alert">{scenarioCalc?.error||'Scenario cannot be calculated.'}</div>}
            <div className="kpis"><Kpi label="Actual HZI NCV 8h" value={`${fmt(baseline?.ncv_8h_mjkg,3)} MJ/kg`} sub={`${fmt(baseline?.throughput_8h_tph,2)} t/h`}/><Kpi label="Scenario calculated NCV" value={`${fmt(scenarioCalc?.ncv_mjkg,3)} MJ/kg`} sub={`Δ ${fmt(scenarioCalc?.ncv_mjkg-baseline?.ncv_8h_mjkg,3)}`} tone="teal"/><Kpi label="Scenario waste heat" value={`${fmt(scenarioCalc?.waste_heat_input_mw,2)} MW`} sub={`${fmt(scenarioCalc?.waste_heat_input_mw/heatLimit*100,1)}% thermal load`}/><Kpi label="Plant-equivalent waste" value={`${fmt(plantTpd,0)} t/day`} sub={`${fmt(scenarioTph,2)} t/h × ${activeLines} lines`} tone="teal"/><Kpi label="Live steam" value={`${fmt(scenario?.steam_flow,1)} t/h`} sub={`Δ ${fmt(scenario?.steam_flow-baseline?.steam_flow,1)} t/h`}/><Kpi label="Scenario status" value={specificStatus} sub={specificLookupFlags.length?`Lookup: ${specificLookupFlags.join(', ')}`:'Within configured lookup ranges'} tone={specificStatus==='OK'?'teal':''}/></div>
            {manualWasteNcvEnabled&&<div className="card compare"><h2>External future waste quality check</h2><table><tbody><tr><td>Expected future waste NCV</td><td>{fmt(futureWasteNcv,3)} MJ/kg</td></tr><tr><td>Expected waste heat at scenario throughput</td><td>{fmt(expectedWasteHeat,2)} MW</td></tr><tr><td>Thermal headroom vs {fmt(heatLimit,1)} MW</td><td className={(heatLimit-expectedWasteHeat)<0?'down':'up'}>{fmt(heatLimit-expectedWasteHeat,2)} MW</td></tr><tr><td>Capacity at external NCV</td><td>{fmt(capacity*24*activeLines,0)} t/day</td></tr></tbody></table></div>}
            <div className="card compare"><div className="cardTitle"><div><h2>Actual → Specific 8h scenario</h2><p>Only this selected 8-hour operating point is changed.</p></div></div><table><thead><tr><th>Parameter</th><th>Actual</th><th>Scenario</th><th>Delta</th></tr></thead><tbody>{[
              ['Waste throughput',baseline?.throughput_8h_tph,scenarioTph,'t/h'],['Calculated NCV',baseline?.ncv_8h_mjkg,scenarioCalc?.ncv_mjkg,'MJ/kg'],['Waste heat input',baseline?.waste_heat_8h_mw,scenarioCalc?.waste_heat_input_mw,'MW'],['Steam flow',baseline?.steam_flow,scenario?.steam_flow,'t/h'],['Steam temperature',baseline?.steam_temp,scenario?.steam_temp,'°C'],['Primary air flow',baseline?.primary_flow,scenario?.primary_flow,'Nm³/h'],['Primary air temp',baseline?.primary_temp,scenario?.primary_temp,'°C'],['Secondary air flow',baseline?.secondary_flow,scenario?.secondary_flow,'Nm³/h'],['Secondary air temp',baseline?.secondary_temp,scenario?.secondary_temp,'°C'],['Feedwater temp',baseline?.feedwater_temp,scenario?.feedwater_temp,'°C'],['Flue gas temp',baseline?.fg_temp,scenario?.fg_temp,'°C']].map(([l,a,s,u])=><tr key={l}><td>{l}</td><td>{fmt(a,2)} {u}</td><td>{fmt(s,2)} {u}</td><td className={(s-a)<0?'down':'up'}>{fmt(s-a,2)}</td></tr>)}</tbody></table></div>
            <div className="card"><h2>Why did calculated NCV change? • one-at-a-time sensitivity</h2><p className="controlHint">Each row changes one parameter from the model baseline while holding the others constant. Rows are not additive and are not causal attribution.</p><div className="tableScroll compactTable"><table><thead><tr><th>Parameter</th><th>Baseline</th><th>Scenario</th><th>NCV Δ</th><th>Waste heat Δ</th></tr></thead><tbody>{sensitivityRows.filter(r=>r.Sensitivity==='One-at-a-time').map((r,i)=><tr key={`${r.Parameter}-${i}`}><td>{r.Parameter}</td><td>{fmt(r.Baseline,2)} {r.Unit}</td><td>{fmt(r.Scenario,2)} {r.Unit}</td><td className={r['Standalone NCV delta (MJ/kg)']<0?'down':'up'}>{fmt(r['Standalone NCV delta (MJ/kg)'],3)}</td><td>{fmt(r['Standalone waste heat delta (MW)'],2)} MW</td></tr>)}</tbody></table></div></div>
          </>:<>
            <div className="kpis"><Kpi label="Actual mean NCV" value={`${fmt(histSummary.actual_mean_ncv,3)} MJ/kg`} sub={`median ${fmt(histSummary.actual_median_ncv,3)}`}/><Kpi label="Projected mean NCV" value={`${fmt(histSummary.projected_mean_ncv,3)} MJ/kg`} sub={`median ${fmt(histSummary.projected_median_ncv,3)}`} tone="teal"/><Kpi label="NCV decrease hours" value={`${histSummary.ncv_decrease_hours||0}`} sub={`increase ${histSummary.ncv_increase_hours||0} h`}/><Kpi label="Average extra waste" value={`${fmt(histSummary.average_extra_waste_tph,2)} t/h`} sub={`Σ hourly Δ ${fmt(histSummary.total_extra_waste_t,1)} t`} tone="teal"/><Kpi label="Projected thermal load" value={`${fmt(histSummary.projected_average_thermal_load_pct,1)}%`} sub={`max ${fmt(histSummary.projected_max_thermal_load_pct,1)}%`}/><Kpi label="Projected steam" value={`${fmt(histSummary.projected_average_steam_tph,1)} t/h`} sub={`max ${fmt(histSummary.projected_max_steam_tph,1)} t/h`}/></div>
            <div className="card"><div className="cardTitle"><div><h2>Historical 8h sensitivity preview</h2><p>Each row starts from its own Actual 8h baseline; the same relative/Δ strategy is then applied.</p></div></div><div className="tableScroll"><table><thead><tr><th>Hour</th><th>Actual NCV</th><th>Projected NCV</th><th>Actual waste</th><th>Projected waste</th><th>Projected heat</th><th>Steam</th><th>Status</th></tr></thead><tbody>{historicalPreview.map((r,i)=><tr key={`${r.Hour}-${i}`}><td>{r.Hour}</td><td>{fmt(r['Actual NCV 8h (MJ/kg)'],3)}</td><td>{fmt(r['Projected calculated NCV (MJ/kg)'],3)}</td><td>{fmt(r['Actual waste 8h (t/h)'],2)}</td><td>{fmt(r['Projected waste (t/h)'],2)}</td><td>{fmt(r['Projected waste heat (MW)'],2)} MW</td><td>{fmt(r['Projected steam flow (t/h)'],1)}</td><td><span className={r['Scenario Status']==='OK'?'pill ok':'pill bad'}>{r['Scenario Status']}</span></td></tr>)}</tbody></table></div></div>
            <div className="card"><h2>3000–3300 t/day target coverage</h2><table><thead><tr><th>Target</th><th>Per line</th><th>Max NCV @ {fmt(heatLimit,1)} MW</th><th>Historical projected hours achieving</th><th>Mechanical</th></tr></thead><tbody>{targets.map(r=><tr key={r.tpd}><td>{r.tpd} t/day</td><td>{fmt(r.tph,2)} t/h</td><td>{fmt(r.requiredNcv,2)} MJ/kg</td><td>{histSummary[`hours_achieving_${r.tpd}_tpd`]||0} h</td><td><span className={r.mechanical==='OK'?'pill ok':'pill bad'}>{r.mechanical}</span></td></tr>)}</tbody></table></div>
          </>}
          <div className="note"><strong>Model interpretation:</strong> Specific Manual is an absolute one-point what-if. Historical Relative is a dataset-wide sensitivity study using each hour's own rolling 8h baseline. Projections are anchored to the actual HZI 8h waste-heat point and use the physics model for the scenario heat-balance change, so a zero-change scenario reproduces Actual. A waste increase does not automatically imply a physical NCV decrease; calculated NCV changes according to the complete heat balance and the process variables you hold constant or adjust. Live steam pressure is retained as operating context when present, but this build does not invent a pressure correction for the current HZI temperature-table steam enthalpy.</div>
        </section>
      </div>
    </>}
  </main>;
}
