'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import * as XLSX from 'xlsx';
import {
  findDateTimeColumn, calculateLine, baselineFromWindowAt, heatBalance,
  projectedCapacity, targetRows, hourlyRows, hourlyProjectionRows,
  PRIMARY_CP_X, PRIMARY_CP_Y, SECONDARY_CP_X, SECONDARY_CP_Y, PROCESS_CP_X, PROCESS_CP_Y,
  FG_CP_X, FG_CP_Y, FEEDWATER_T, FEEDWATER_H, STEAM_T, STEAM_H, DRUM_P, BLOWDOWN_H, SAT_STEAM_H,
  PROCESS_AIR
} from '../../lib/ncv';

import { readHistorianFile, displayDateTime, toDateTimeLocal } from '../../lib/historian';

const BUILD='2026.09.30-vercel-r2';
const OWNER='Fırat SARP';
const fmt=(v,d=2)=>Number.isFinite(Number(v))?Number(v).toLocaleString(undefined,{minimumFractionDigits:d,maximumFractionDigits:d}):'—';

function Input({label,value,onChange,step='any',unit}){
  return <label className="inputRow"><span>{label}</span><div><input type="number" step={step} value={Number.isFinite(Number(value))?value:''} onChange={e=>onChange(Number(e.target.value))}/><em>{unit}</em></div></label>;
}
function Kpi({label,value,sub,tone}){return <div className={`kpi ${tone||''}`}><span>{label}</span><strong>{value}</strong>{sub&&<small>{sub}</small>}</div>}

export default function Home(){
  const [fileName,setFileName]=useState('');
  const [status,setStatus]=useState('Upload a historian .xls or .xlsx file.');
  const [lines,setLines]=useState({});
  const [selectedLine,setSelectedLine]=useState(1);
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
  const calc=lines[selectedLine];

  function applyBaseline(c,endTime){
    const b=baselineFromWindowAt(c,endTime,8);
    if(!b) return false;
    setBaseline(b);
    setBaselineEnd(toDateTimeLocal(b.window_end));
    setScenario({...b,process_air_flow:PROCESS_AIR});
    if(Number.isFinite(b.throughput_8h_tph))setScenarioTph(b.throughput_8h_tph);
    if(Number.isFinite(b.ncv_8h_mjkg))setManualWasteNcv(b.ncv_8h_mjkg);
    const future=new Date(b.window_end.getTime()+7*24*3600000);
    setForecastDateTime(toDateTimeLocal(future));
    return true;
  }

  async function loadFile(file){
    if(!file)return; setStatus('Reading historian file…'); setFileName(file.name);
    try{
      const {headers,rows,headerRow}=await readHistorianFile(file);
      const dateCol=findDateTimeColumn(headers);
      const found={};
      for(const line of [1,2,3]){
        const c=calculateLine(rows,headers,line,dateCol);
        if(c.ok)found[line]=c;
      }
      const avail=Object.keys(found).map(Number); if(!avail.length)throw new Error('No line could be calculated. Required historian signals or TODAY waste counter are missing.');
      setLines(found); const first=avail[0];setSelectedLine(first);
      const latest=found[first].rows[found[first].rows.length-1]?.date;
      applyBaseline(found[first],latest);
      setStatus(`Historian loaded: ${rows.length.toLocaleString()} rows • header row ${headerRow+1} • available lines ${avail.join(', ')}`);
    }catch(e){console.error(e);setLines({});setBaseline(null);setScenario(null);setStatus(`Error: ${e.message}`);}
  }

  function chooseLine(line){
    setSelectedLine(line); const c=lines[line]; if(c){const latest=c.rows[c.rows.length-1]?.date;applyBaseline(c,latest);}
  }
  function chooseBaselineDateTime(v){
    if(!calc||!v)return;
    const requested=new Date(v);
    if(Number.isNaN(requested.getTime()))return;
    if(!applyBaseline(calc,requested))setStatus('Could not create an 8-hour baseline at the selected date/time.');
  }

  const scenarioCalc=useMemo(()=>{
    if(!scenario||!Number.isFinite(scenarioTph)||scenarioTph<=0)return null;
    try{return {ok:true,...heatBalance(scenario,scenarioTph,allowExtrap)}}catch(e){return {ok:false,error:e.message}}
  },[scenario,scenarioTph,allowExtrap]);
  const targets=targetRows(heatLimit,activeLines,mechLimit);
  const futureWasteNcv=manualWasteNcvEnabled&&Number.isFinite(manualWasteNcv)&&manualWasteNcv>0?manualWasteNcv:scenarioCalc?.ncv_mjkg;
  const requiredHeatInput=scenarioCalc?.ok?scenarioCalc.waste_heat_input_mw:NaN;
  const expectedWasteHeat=Number.isFinite(futureWasteNcv)&&Number.isFinite(scenarioTph)?scenarioTph*futureWasteNcv/3.6:NaN;
  const heatBalanceGap=Number.isFinite(expectedWasteHeat)&&Number.isFinite(requiredHeatInput)?expectedWasteHeat-requiredHeatInput:NaN;
  const thermalHeadroom=Number.isFinite(expectedWasteHeat)?heatLimit-expectedWasteHeat:NaN;
  const capacity=Number.isFinite(futureWasteNcv)?projectedCapacity(futureWasteNcv,heatLimit,mechLimit):NaN;
  const plantTpd=scenarioTph*24*activeLines;
  const hourlyProjection=useMemo(()=>{
    if(!calc||!baseline||!scenario)return [];
    const futureNcv=manualWasteNcvEnabled&&Number.isFinite(manualWasteNcv)&&manualWasteNcv>0?manualWasteNcv:null;
    return hourlyProjectionRows(calc,baseline,scenario,scenarioTph,activeLines,heatLimit,mechLimit,allowExtrap,futureNcv);
  },[calc,baseline,scenario,scenarioTph,activeLines,heatLimit,mechLimit,allowExtrap,manualWasteNcvEnabled,manualWasteNcv]);

  function setSc(k,v){setScenario(s=>({...s,[k]:v}));}

  function exportExcel(){
    if(!calc||!baseline||!scenarioCalc?.ok)return;
    const wb=XLSX.utils.book_new();
    const output=[
      ['Waste NCV & Throughput Scenario','Vercel Web'],['Build',`${BUILD} ${OWNER}`],['Historian file',fileName],['Line',selectedLine],['Forecast date/time',forecastDateTime||''],
      ['Actual baseline end',displayDateTime(baseline.window_end)],['Actual baseline start',displayDateTime(baseline.window_start)],['Baseline window','8 hours'],[],
      ['Metric','Actual','Scenario','Delta'],
      ['Waste throughput (t/h)',baseline.throughput_8h_tph,scenarioTph,scenarioTph-baseline.throughput_8h_tph],
      ['Heat-balance equivalent NCV (MJ/kg)',baseline.ncv_8h_mjkg,scenarioCalc.ncv_mjkg,scenarioCalc.ncv_mjkg-baseline.ncv_8h_mjkg],
      ['Future waste NCV (MJ/kg)',baseline.ncv_8h_mjkg,futureWasteNcv,futureWasteNcv-baseline.ncv_8h_mjkg],
      ['Manual future waste quality enabled','',manualWasteNcvEnabled?'YES':'NO',''],
      ['Heat-balance required waste heat (MW)',baseline.waste_heat_8h_mw,requiredHeatInput,requiredHeatInput-baseline.waste_heat_8h_mw],
      ['Expected waste heat from future NCV (MW)',baseline.waste_heat_8h_mw,expectedWasteHeat,expectedWasteHeat-baseline.waste_heat_8h_mw],
      ['Heat surplus / deficit vs balance need (MW)','',heatBalanceGap,''],
      ['Thermal headroom vs line limit (MW)','',thermalHeadroom,''],
      ['Steam flow (t/h)',baseline.steam_flow,scenario.steam_flow,scenario.steam_flow-baseline.steam_flow],
      ['Equivalent plant waste (t/day)',baseline.throughput_8h_tph*24*activeLines,plantTpd,plantTpd-baseline.throughput_8h_tph*24*activeLines],
      ['Projected capacity / line (t/h)','',capacity,''],['Projected plant capacity (t/day)','',capacity*24*activeLines,'']
    ];
    XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(output),'Scenario_Output');
    const inputRows=[['Parameter','Actual at selected baseline','Scenario','Delta','Unit'],
      ['Primary air flow',baseline.primary_flow,scenario.primary_flow,scenario.primary_flow-baseline.primary_flow,'Nm3/h'],['Primary air temperature',baseline.primary_temp,scenario.primary_temp,scenario.primary_temp-baseline.primary_temp,'C'],
      ['Secondary air flow',baseline.secondary_flow,scenario.secondary_flow,scenario.secondary_flow-baseline.secondary_flow,'Nm3/h'],['Secondary air temperature',baseline.secondary_temp,scenario.secondary_temp,scenario.secondary_temp-baseline.secondary_temp,'C'],
      ['Process air flow',PROCESS_AIR,scenario.process_air_flow,scenario.process_air_flow-PROCESS_AIR,'Nm3/h'],['Process air temperature',baseline.process_temp,scenario.process_temp,scenario.process_temp-baseline.process_temp,'C'],
      ['Feedwater temperature',baseline.feedwater_temp,scenario.feedwater_temp,scenario.feedwater_temp-baseline.feedwater_temp,'C'],['Water injection',baseline.water,scenario.water,scenario.water-baseline.water,'m3/h'],
      ['Live steam flow',baseline.steam_flow,scenario.steam_flow,scenario.steam_flow-baseline.steam_flow,'t/h'],['Live steam temperature',baseline.steam_temp,scenario.steam_temp,scenario.steam_temp-baseline.steam_temp,'C'],
      ['Drum pressure',baseline.drum_pressure,scenario.drum_pressure,scenario.drum_pressure-baseline.drum_pressure,'bar'],['PA preheater steam flow',baseline.pa_preheater_flow,scenario.pa_preheater_flow,scenario.pa_preheater_flow-baseline.pa_preheater_flow,'t/h'],
      ['Flue gas temperature',baseline.fg_temp,scenario.fg_temp,scenario.fg_temp-baseline.fg_temp,'C'],['Waste throughput',baseline.throughput_8h_tph,scenarioTph,scenarioTph-baseline.throughput_8h_tph,'t/h'],
      ['Future waste NCV',baseline.ncv_8h_mjkg,futureWasteNcv,futureWasteNcv-baseline.ncv_8h_mjkg,'MJ/kg'],
      ['Manual future waste quality','',''+(manualWasteNcvEnabled?'YES':'NO'),'',''],
      ['Forecast date/time','',forecastDateTime||'','','']
    ];
    XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(inputRows),'Inputs');
    const calcRows=[['Heat-balance component','Scenario value'],['Primary air heat (MW)',scenarioCalc.q_primary_mw],['Secondary air heat (MW)',scenarioCalc.q_secondary_mw],['Process air heat (MW)',scenarioCalc.q_process_mw],['Water term (MW)',scenarioCalc.q_water_mw],['Useful heat (MW)',scenarioCalc.q_useful_mw],['Steam heat (MW)',scenarioCalc.q_steam_mw],['Blowdown heat (MW)',scenarioCalc.q_blowdown_mw],['PA preheater heat (MW)',scenarioCalc.q_pa_preheater_mw],['Flue gas loss (MW)',scenarioCalc.q_fg_loss_mw],['Bottom ash loss (MW)',scenarioCalc.q_bottom_loss_mw],['Fly ash loss (MW)',scenarioCalc.q_fly_loss_mw],['Radiation loss (MW)',scenarioCalc.q_radiation_loss_mw],['Total losses (MW)',scenarioCalc.q_losses_mw],['Heat-balance required waste heat (MW)',requiredHeatInput],['Heat-balance equivalent NCV (MJ/kg)',scenarioCalc.ncv_mjkg],['Future waste NCV used (MJ/kg)',futureWasteNcv],['Expected waste heat from future NCV (MW)',expectedWasteHeat],['Heat surplus / deficit vs balance need (MW)',heatBalanceGap],['Thermal headroom vs line limit (MW)',thermalHeadroom]];
    XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(calcRows),'Calculation');
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(targets.map(r=>({'Target total t/day':r.tpd,'Per-line t/h':r.tph,'Max NCV @ thermal limit (MJ/kg)':r.requiredNcv,'Future waste NCV (MJ/kg)':futureWasteNcv,'Thermal check':Number.isFinite(futureWasteNcv)?(futureWasteNcv<=r.requiredNcv?'OK':'Above thermal limit'):'—','Mechanical limit':r.mechanical}))),'Target_3000_3300');
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(hourlyProjection),'Hourly_Projection');
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(hourlyRows(calc,activeLines)),'Hourly_Actual');
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(Object.entries(calc.mapping).map(([k,v])=>({Signal:k,'Resolved historian column':v||''}))),'Source_Tags');
    const look=[['Table','X','Y']];[["Primary Cp",PRIMARY_CP_X,PRIMARY_CP_Y],["Secondary Cp",SECONDARY_CP_X,SECONDARY_CP_Y],["Process Cp",PROCESS_CP_X,PROCESS_CP_Y],["Flue gas Cp",FG_CP_X,FG_CP_Y],["Feedwater h",FEEDWATER_T,FEEDWATER_H],["Steam h",STEAM_T,STEAM_H],["Blowdown h",DRUM_P,BLOWDOWN_H],["Sat steam h",DRUM_P,SAT_STEAM_H]].forEach(([name,x,y])=>x.forEach((v,i)=>look.push([name,v,y[i]])));
    XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(look),'Lookup_Tables');
    XLSX.writeFile(wb,`NCV_Scenario_Line${selectedLine}_${baselineEnd.replace(/[:T]/g,'-')}.xlsx`);
  }

  const minDate=calc?.rows?.[0]?.date ? toDateTimeLocal(calc.rows[0].date) : '';
  const maxDate=calc?.rows?.length ? toDateTimeLocal(calc.rows[calc.rows.length-1].date) : '';
  const recentProjection=hourlyProjection.filter(r=>r['Hour']<=baselineEnd.replace('T',' ').slice(0,13)+':00').slice(-8);

  return <main>
    <nav className="topNav"><Link href="/">Home</Link><Link href="/ncv-calculation">NCV Calculation</Link><span>Scenario</span></nav>
    <header><div><p className="eyebrow">Istanbul WtE • Engineering decision support</p><h1>Waste NCV & Throughput Scenario Simulator</h1><p className="sub">Historian baseline + HZI 90101284 Rev. 3.1 heat-balance what-if model</p></div><div className="build">Build {BUILD} {OWNER}</div></header>

    <section className="upload card">
      <div><h2>Historian input</h2><p>{status}</p></div>
      <label className="fileBtn">Choose XLS / XLSX<input type="file" accept=".xls,.xlsx" onChange={e=>loadFile(e.target.files?.[0])}/></label>
    </section>

    {Object.keys(lines).length>0 && <>
      <div className="lineTabs">{Object.keys(lines).map(k=><button className={Number(k)===selectedLine?'active':''} key={k} onClick={()=>chooseLine(Number(k))}>Line {k}</button>)}</div>
      <section className="card baselinePicker">
        <div><h2>Actual baseline date & time</h2><p>Select the historian moment to use as Actual. The model uses the 8-hour window ending at the nearest available historian timestamp.</p></div>
        <div className="baselinePickerControls">
          <input type="datetime-local" value={baselineEnd} min={minDate} max={maxDate} step="600" onChange={e=>chooseBaselineDateTime(e.target.value)}/>
          <div className="baselineWindow"><strong>{displayDateTime(baseline?.window_end)}</strong><span>8h window: {displayDateTime(baseline?.window_start)} → {displayDateTime(baseline?.window_end)}</span></div>
        </div>
      </section>

      <div className="layout">
        <aside className="card controls">
          <h2>Scenario inputs</h2>
          <p className="controlHint">Inputs start from the selected Actual baseline. The difference (Scenario − Actual) is also applied hour-by-hour in the Excel projection.</p>
          <Input label="Waste throughput" value={scenarioTph} onChange={setScenarioTph} step="0.1" unit="t/h"/>
          <Input label="Primary air flow" value={scenario?.primary_flow} onChange={v=>setSc('primary_flow',v)} step="100" unit="Nm³/h"/>
          <Input label="Primary air temp" value={scenario?.primary_temp} onChange={v=>setSc('primary_temp',v)} step="0.5" unit="°C"/>
          <Input label="Secondary air flow" value={scenario?.secondary_flow} onChange={v=>setSc('secondary_flow',v)} step="100" unit="Nm³/h"/>
          <Input label="Secondary air temp" value={scenario?.secondary_temp} onChange={v=>setSc('secondary_temp',v)} step="0.5" unit="°C"/>
          <Input label="Process air flow" value={scenario?.process_air_flow} onChange={v=>setSc('process_air_flow',v)} step="100" unit="Nm³/h"/>
          <Input label="Process air temp" value={scenario?.process_temp} onChange={v=>setSc('process_temp',v)} step="0.5" unit="°C"/>
          <Input label="Feedwater temp" value={scenario?.feedwater_temp} onChange={v=>setSc('feedwater_temp',v)} step="0.5" unit="°C"/>
          <Input label="Water injection" value={scenario?.water} onChange={v=>setSc('water',v)} step="0.1" unit="m³/h"/>
          <Input label="Live steam flow" value={scenario?.steam_flow} onChange={v=>setSc('steam_flow',v)} step="0.1" unit="t/h"/>
          <Input label="Live steam temp" value={scenario?.steam_temp} onChange={v=>setSc('steam_temp',v)} step="0.5" unit="°C"/>
          <Input label="Drum pressure" value={scenario?.drum_pressure} onChange={v=>setSc('drum_pressure',v)} step="0.1" unit="bar"/>
          <Input label="PA preheater steam" value={scenario?.pa_preheater_flow} onChange={v=>setSc('pa_preheater_flow',v)} step="0.1" unit="t/h"/>
          <Input label="Flue gas temp" value={scenario?.fg_temp} onChange={v=>setSc('fg_temp',v)} step="0.5" unit="°C"/>
          <hr/><h3>Future waste quality</h3>
          <p className="controlHint">Use this when future waste quality is known from blending, source information or sampling. It overrides the future waste NCV assumption without changing the heat-balance calculation.</p>
          <label className="check futureQualityToggle"><input type="checkbox" checked={manualWasteNcvEnabled} onChange={e=>setManualWasteNcvEnabled(e.target.checked)}/> Use manual future waste NCV</label>
          {manualWasteNcvEnabled && <>
            <Input label="Expected future waste NCV" value={manualWasteNcv} onChange={setManualWasteNcv} step="0.05" unit="MJ/kg"/>
            <label className="dateInputRow"><span>Forecast date/time</span><input type="datetime-local" value={forecastDateTime} step="600" onChange={e=>setForecastDateTime(e.target.value)}/></label>
          </>}
          <hr/><h3>Plant constraints</h3>
          <Input label="Active lines" value={activeLines} onChange={setActiveLines} step="1" unit="lines"/>
          <Input label="Thermal limit" value={heatLimit} onChange={setHeatLimit} step="0.1" unit="MW/line"/>
          <Input label="Mechanical limit" value={mechLimit} onChange={setMechLimit} step="0.1" unit="t/h/line"/>
          <label className="check"><input type="checkbox" checked={allowExtrap} onChange={e=>setAllowExtrap(e.target.checked)}/> Allow lookup extrapolation</label>
        </aside>

        <section className="content">
          {!scenarioCalc?.ok && <div className="alert">{scenarioCalc?.error||'Scenario cannot be calculated.'}</div>}
          <div className="kpis">
            <Kpi label="Actual NCV 8h" value={`${fmt(baseline?.ncv_8h_mjkg,3)} MJ/kg`} sub={`${fmt(baseline?.throughput_8h_tph,2)} t/h • ${displayDateTime(baseline?.window_end)}`}/>
            <Kpi label={manualWasteNcvEnabled?'Expected future waste NCV':'Projected NCV'} value={`${fmt(futureWasteNcv,3)} MJ/kg`} sub={manualWasteNcvEnabled?`manual input • Δ ${fmt(futureWasteNcv-baseline?.ncv_8h_mjkg,3)}`:`heat-balance • Δ ${fmt(futureWasteNcv-baseline?.ncv_8h_mjkg,3)}`} tone="teal"/>
            <Kpi label="Heat-balance required input" value={`${fmt(requiredHeatInput,2)} MW`} sub={`equiv. NCV ${fmt(scenarioCalc?.ncv_mjkg,3)} MJ/kg`}/>
            <Kpi label={manualWasteNcvEnabled?'Expected waste heat':'Projected heat input'} value={`${fmt(expectedWasteHeat,2)} MW`} sub={`thermal headroom ${fmt(thermalHeadroom,2)} MW`} tone={thermalHeadroom<0?'':'teal'}/>
            <Kpi label="Plant-equivalent waste" value={`${fmt(plantTpd,0)} t/day`} sub={`${fmt(scenarioTph,2)} t/h × ${activeLines} lines`} tone="teal"/>
            <Kpi label="Projected capacity" value={`${fmt(capacity*24*activeLines,0)} t/day`} sub={`${fmt(capacity,2)} t/h/line`}/>
            <Kpi label="Steam flow" value={`${fmt(scenario?.steam_flow,1)} t/h`} sub={`Δ ${fmt(scenario?.steam_flow-baseline?.steam_flow,1)} t/h`}/>
          </div>

          <div className="card compare"><div className="cardTitle"><div><h2>Actual → Scenario</h2><p>Actual is the selected 8-hour baseline ending at {displayDateTime(baseline?.window_end)}.</p></div><button className="export" onClick={exportExcel}>Export Excel</button></div>
            <table><thead><tr><th>Parameter</th><th>Actual</th><th>Scenario</th><th>Delta</th></tr></thead><tbody>
              {[
                ['Waste throughput',baseline?.throughput_8h_tph,scenarioTph,'t/h'],['Heat-balance equivalent NCV',baseline?.ncv_8h_mjkg,scenarioCalc?.ncv_mjkg,'MJ/kg'],['Future waste NCV',baseline?.ncv_8h_mjkg,futureWasteNcv,'MJ/kg'],['Heat-balance required waste heat',baseline?.waste_heat_8h_mw,requiredHeatInput,'MW'],['Expected waste heat',baseline?.waste_heat_8h_mw,expectedWasteHeat,'MW'],
                ['Primary air flow',baseline?.primary_flow,scenario?.primary_flow,'Nm³/h'],['Primary air temp',baseline?.primary_temp,scenario?.primary_temp,'°C'],['Secondary air flow',baseline?.secondary_flow,scenario?.secondary_flow,'Nm³/h'],['Secondary air temp',baseline?.secondary_temp,scenario?.secondary_temp,'°C'],['Feedwater temp',baseline?.feedwater_temp,scenario?.feedwater_temp,'°C'],['Flue gas temp',baseline?.fg_temp,scenario?.fg_temp,'°C'],['Steam flow',baseline?.steam_flow,scenario?.steam_flow,'t/h']
              ].map(([l,a,s,u])=><tr key={l}><td>{l}</td><td>{fmt(a,2)} {u}</td><td>{fmt(s,2)} {u}</td><td className={(s-a)<0?'down':'up'}>{fmt(s-a,2)}</td></tr>)}
            </tbody></table>
          </div>

          <div className="card"><div className="cardTitle"><div><h2>Hourly projection preview</h2><p>Each hour uses its own 8-hour Actual baseline. Your scenario is applied as the same change (delta) versus the selected Actual.</p></div></div>
            <table><thead><tr><th>Hour</th><th>Actual NCV</th><th>{manualWasteNcvEnabled?'Future NCV':'Projected NCV'}</th><th>Actual waste</th><th>Projected waste</th><th>Expected heat</th><th>Headroom</th></tr></thead><tbody>
              {recentProjection.map((r,i)=><tr key={`${r.Hour}-${i}`}><td>{r.Hour}</td><td>{fmt(r['Actual NCV 8h (MJ/kg)'],3)}</td><td>{fmt(r['Projected NCV (MJ/kg)'],3)}</td><td>{fmt(r['Actual waste 8h (t/h)'],2)}</td><td>{fmt(r['Projected waste (t/h)'],2)}</td><td>{fmt(r['Expected waste heat (MW)'],2)} MW</td><td className={r['Thermal headroom vs limit (MW)']<0?'down':'up'}>{fmt(r['Thermal headroom vs limit (MW)'],2)} MW</td></tr>)}
            </tbody></table>
            <p className="tableFoot">The Excel export contains the complete <strong>Hourly_Projection</strong> sheet for every available historian hour.</p>
          </div>

          <div className="card"><h2>3000–3300 t/day target envelope</h2><table><thead><tr><th>Total target</th><th>Per line</th><th>Max NCV at {fmt(heatLimit,1)} MW</th>{manualWasteNcvEnabled&&<><th>Future NCV</th><th>Thermal</th></>}<th>Mechanical</th></tr></thead><tbody>{targets.map(r=><tr key={r.tpd}><td>{r.tpd} t/day</td><td>{fmt(r.tph,2)} t/h</td><td>{fmt(r.requiredNcv,2)} MJ/kg</td>{manualWasteNcvEnabled&&<><td>{fmt(futureWasteNcv,2)} MJ/kg</td><td><span className={futureWasteNcv<=r.requiredNcv?'pill ok':'pill bad'}>{futureWasteNcv<=r.requiredNcv?'OK':'Above limit'}</span></td></>}<td><span className={r.mechanical==='OK'?'pill ok':'pill bad'}>{r.mechanical}</span></td></tr>)}</tbody></table></div>

          <div className="note"><strong>Engineering note:</strong> changing air, feedwater or flue-gas conditions changes the heat-balance calculated equivalent NCV / required waste heat; it does not change the chemical NCV of the incoming waste. When <strong>manual future waste NCV</strong> is enabled, that value is an external forecast assumption (for example known higher-quality waste or a planned blend). The software then calculates the expected thermal load and capacity from that NCV while keeping the HZI heat-balance requirement visible separately. Hourly projections remain engineering what-if calculations, not official HZI future-NCV predictions.</div>
        </section>
      </div>
    </>}
  </main>
}
