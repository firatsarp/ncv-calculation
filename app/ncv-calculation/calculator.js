'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import * as XLSX from 'xlsx';
import { calculateLine, findDateTimeColumn } from '../../lib/ncv';
import { readHistorianFile, displayDateTime } from '../../lib/historian';

const BUILD='2026.09.30-vercel-r2';
const OWNER='Fırat SARP & Adem Şenocak';
const fmt=(v,d=3)=>Number.isFinite(Number(v))?Number(v).toLocaleString(undefined,{minimumFractionDigits:d,maximumFractionDigits:d}):'—';

function finiteValues(rows,key){return rows.map(r=>Number(r[key])).filter(Number.isFinite);}
function mean(values){return values.length?values.reduce((a,b)=>a+b,0)/values.length:NaN;}
function median(values){
  if(!values.length)return NaN;
  const a=[...values].sort((x,y)=>x-y),m=Math.floor(a.length/2);
  return a.length%2?a[m]:(a[m-1]+a[m])/2;
}
function lastFinite(rows,key){
  for(let i=rows.length-1;i>=0;i--){const v=Number(rows[i][key]);if(Number.isFinite(v))return v;}
  return NaN;
}
function latestDate(calc){return calc?.result?.[calc.result.length-1]?.date ?? null;}
function firstDate(calc){return calc?.result?.[0]?.date ?? null;}

function summaryForLine(line,calc){
  const r=calc.result||[];
  const n10=finiteValues(r,'NCV_Instant_DisplayHold');
  const n3=finiteValues(r,'NCV_3h_DisplayHold');
  const n8=finiteValues(r,'NCV_8h_DisplayHold');
  return {
    line,
    start:firstDate(calc),end:latestDate(calc),rows:r.length,interval:calc.intervalMinutes,
    latest10:lastFinite(r,'NCV_Instant_DisplayHold'),latest3:lastFinite(r,'NCV_3h_DisplayHold'),latest8:lastFinite(r,'NCV_8h_DisplayHold'),
    latestT10:lastFinite(r,'Throughput_Instant_tph'),latestT3:lastFinite(r,'Throughput_3h_tph'),latestT8:lastFinite(r,'Throughput_8h_tph'),
    latestH10:lastFinite(r,'WasteHeatInput_Instant_MW'),latestH3:lastFinite(r,'WasteHeatInput_3h_MW'),latestH8:lastFinite(r,'WasteHeatInput_8h_MW'),
    mean10:mean(n10),mean3:mean(n3),mean8:mean(n8),median10:median(n10),median3:median(n3),median8:median(n8)
  };
}

function excelRows(calc){
  return (calc.result||[]).map(r=>({
    'Date Time':r.date instanceof Date?r.date.toISOString().replace('T',' ').slice(0,19):r.date,
    'Waste Interval (t)':r.Waste_Interval_t,
    'Waste 30min Distributed (t)':r.Waste_30min_Distributed_t,
    'Throughput 10min (t/h)':r.Throughput_Instant_tph,
    'Throughput 3h (t/h)':r.Throughput_3h_tph,
    'Throughput 8h (t/h)':r.Throughput_8h_tph,
    'Waste Heat Input 10min (MW)':r.WasteHeatInput_Instant_MW,
    'Waste Heat Input 3h (MW)':r.WasteHeatInput_3h_MW,
    'Waste Heat Input 8h (MW)':r.WasteHeatInput_8h_MW,
    'NCV 10min Engineering (MJ/kg)':r.NCV_Instant_DisplayHold,
    'NCV 3h (MJ/kg)':r.NCV_3h_DisplayHold,
    'NCV 8h (MJ/kg)':r.NCV_8h_DisplayHold,
    'NCV Active':r.NCV_Active,
    'NCV 3h Valid':r.NCV_3h_Valid,
    'NCV 8h Valid':r.NCV_8h_Valid,
    'Counter Flag':r.Counter_Flag||''
  }));
}

function Kpi({label,value,sub,tone}){return <div className={`kpi ${tone||''}`}><span>{label}</span><strong>{value}</strong>{sub&&<small>{sub}</small>}</div>}

export default function NcvCalculation(){
  const [fileName,setFileName]=useState('');
  const [status,setStatus]=useState('Upload a historian .xls or .xlsx file.');
  const [lines,setLines]=useState({});
  const [selectedLine,setSelectedLine]=useState(1);
  const calc=lines[selectedLine];

  async function loadFile(file){
    if(!file)return;
    setFileName(file.name);setStatus('Reading historian file and calculating NCV…');
    try{
      const {headers,rows,headerRow}=await readHistorianFile(file);
      const dateCol=findDateTimeColumn(headers);
      const found={};const skipped=[];
      for(const line of [1,2,3]){
        const c=calculateLine(rows,headers,line,dateCol);
        if(c.ok)found[line]=c;else skipped.push(`L${line}: ${c.missing.join(', ')}`);
      }
      const avail=Object.keys(found).map(Number);
      if(!avail.length)throw new Error('No line could be calculated. Required historian signals or TODAY waste counter are missing.');
      setLines(found);setSelectedLine(avail[0]);
      setStatus(`Historian loaded: ${rows.length.toLocaleString()} rows • header row ${headerRow+1} • available lines ${avail.join(', ')}${skipped.length?` • skipped ${skipped.join(' | ')}`:''}`);
    }catch(e){console.error(e);setLines({});setStatus(`Error: ${e.message}`);}
  }

  const summaries=useMemo(()=>Object.entries(lines).map(([line,c])=>summaryForLine(Number(line),c)),[lines]);
  const current=useMemo(()=>calc?summaryForLine(selectedLine,calc):null,[calc,selectedLine]);
  const preview=useMemo(()=>calc?(calc.result||[]).slice(-144):[],[calc]);

  function exportExcel(){
    if(!Object.keys(lines).length)return;
    const wb=XLSX.utils.book_new();
    const summary=[
      ['Waste NCV Calculation','HZI 90101284 Rev. 3.1'],['Build',`${BUILD} ${OWNER}`],['Historian file',fileName],[],
      ['Line','Start','End','Rows','Interval min','Latest NCV 10min','Latest NCV 3h','Latest NCV 8h','Latest Throughput 10min','Latest Throughput 3h','Latest Throughput 8h','Mean NCV 10min','Mean NCV 3h','Mean NCV 8h','Median NCV 10min','Median NCV 3h','Median NCV 8h']
    ];
    summaries.forEach(s=>summary.push([
      `Line ${s.line}`,displayDateTime(s.start),displayDateTime(s.end),s.rows,s.interval,
      s.latest10,s.latest3,s.latest8,s.latestT10,s.latestT3,s.latestT8,
      s.mean10,s.mean3,s.mean8,s.median10,s.median3,s.median8
    ]));
    XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(summary),'Summary');
    for(const [line,c] of Object.entries(lines)){
      XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(excelRows(c)),`Line${line}_10min_3h_8h`);
      XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(Object.entries(c.mapping).map(([k,v])=>({Signal:k,'Resolved historian column':v||''}))),`Line${line}_Tags`);
    }
    XLSX.writeFile(wb,`NCV_Calculation_${fileName.replace(/\.[^.]+$/,'')||'Historian'}.xlsx`);
  }

  return <main>
    <nav className="topNav"><Link href="/">Home</Link><span>NCV Calculation</span><Link href="/scenario">Scenario</Link></nav>
    <header><div><p className="eyebrow">Istanbul WtE • Historian calculation</p><h1>Waste NCV Calculation</h1><p className="sub">10-minute engineering estimate + HZI 3-hour and 8-hour NCV calculations</p></div><div className="build">Build {BUILD} {OWNER}</div></header>

    <section className="upload card">
      <div><h2>Historian input</h2><p>{status}</p></div>
      <label className="fileBtn">Choose XLS / XLSX<input type="file" accept=".xls,.xlsx" onChange={e=>loadFile(e.target.files?.[0])}/></label>
    </section>

    {Object.keys(lines).length>0&&<>
      <div className="lineTabs">{Object.keys(lines).map(k=><button className={Number(k)===selectedLine?'active':''} key={k} onClick={()=>setSelectedLine(Number(k))}>Line {k}</button>)}</div>

      <section className="card calcSummaryHead">
        <div><h2>Calculated period</h2><p>{displayDateTime(current?.start)} → {displayDateTime(current?.end)} • {current?.rows?.toLocaleString()} historian rows • {fmt(current?.interval,0)} min interval</p></div>
        <button className="export" onClick={exportExcel}>Export calculation Excel</button>
      </section>

      <section className="kpis calcKpis">
        <Kpi label="Latest NCV 10 min" value={`${fmt(current?.latest10,3)} MJ/kg`} sub="Engineering estimate"/>
        <Kpi label="Latest NCV 3 h" value={`${fmt(current?.latest3,3)} MJ/kg`} sub={`${fmt(current?.latestT3,2)} t/h`} tone="teal"/>
        <Kpi label="Latest NCV 8 h" value={`${fmt(current?.latest8,3)} MJ/kg`} sub={`${fmt(current?.latestT8,2)} t/h`} tone="teal"/>
        <Kpi label="Waste heat 10 min" value={`${fmt(current?.latestH10,2)} MW`} sub={`${fmt(current?.latestT10,2)} t/h`}/>
        <Kpi label="Waste heat 3 h" value={`${fmt(current?.latestH3,2)} MW`} sub={`Mean NCV ${fmt(current?.mean3,3)}`}/>
        <Kpi label="Waste heat 8 h" value={`${fmt(current?.latestH8,2)} MW`} sub={`Mean NCV ${fmt(current?.mean8,3)}`}/>
      </section>

      <section className="card calcStats">
        <div className="cardTitle"><div><h2>Period statistics</h2><p>Display-hold NCV values over the loaded historian period.</p></div></div>
        <table><thead><tr><th>Window</th><th>Latest NCV</th><th>Mean NCV</th><th>Median NCV</th><th>Latest throughput</th></tr></thead><tbody>
          <tr><td>10 min engineering</td><td>{fmt(current?.latest10)}</td><td>{fmt(current?.mean10)}</td><td>{fmt(current?.median10)}</td><td>{fmt(current?.latestT10,2)} t/h</td></tr>
          <tr><td>3 h</td><td>{fmt(current?.latest3)}</td><td>{fmt(current?.mean3)}</td><td>{fmt(current?.median3)}</td><td>{fmt(current?.latestT3,2)} t/h</td></tr>
          <tr><td>8 h</td><td>{fmt(current?.latest8)}</td><td>{fmt(current?.mean8)}</td><td>{fmt(current?.median8)}</td><td>{fmt(current?.latestT8,2)} t/h</td></tr>
        </tbody></table>
      </section>

      <section className="card calcTable">
        <div className="cardTitle"><div><h2>Latest 24-hour preview</h2><p>10-minute historian rows. The Excel export contains the full loaded period for every available line.</p></div></div>
        <div className="tableScroll"><table><thead><tr><th>Date Time</th><th>NCV 10min</th><th>NCV 3h</th><th>NCV 8h</th><th>Waste 10min</th><th>Waste 3h</th><th>Waste 8h</th><th>Heat 10min</th><th>Heat 3h</th><th>Heat 8h</th></tr></thead><tbody>
          {preview.map((r,i)=><tr key={`${r.date?.getTime?.()||i}-${i}`}><td>{displayDateTime(r.date)}</td><td>{fmt(r.NCV_Instant_DisplayHold)}</td><td>{fmt(r.NCV_3h_DisplayHold)}</td><td>{fmt(r.NCV_8h_DisplayHold)}</td><td>{fmt(r.Throughput_Instant_tph,2)}</td><td>{fmt(r.Throughput_3h_tph,2)}</td><td>{fmt(r.Throughput_8h_tph,2)}</td><td>{fmt(r.WasteHeatInput_Instant_MW,2)}</td><td>{fmt(r.WasteHeatInput_3h_MW,2)}</td><td>{fmt(r.WasteHeatInput_8h_MW,2)}</td></tr>)}
        </tbody></table></div>
      </section>

      <div className="note"><strong>Method note:</strong> the 3-hour and 8-hour outputs follow the HZI Rev. 3.1 calculation logic. The 10-minute value is an additional engineering estimate for operational trending and should not be treated as an official HZI future-NCV prediction.</div>
    </>}
  </main>;
}
