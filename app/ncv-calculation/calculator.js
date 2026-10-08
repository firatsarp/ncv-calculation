'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import * as XLSX from 'xlsx';
import { calculateLine, findDateTimeColumn } from '../../lib/ncv';
import { readHistorianFile, displayDateTime } from '../../lib/historian';

const BUILD='2026.09.30-vercel-r2';
const OWNER='FÄ±rat SARP & Adem Åženocak';
const fmt=(v,d=3)=>Number.isFinite(Number(v))?Number(v).toLocaleString(undefined,{minimumFractionDigits:d,maximumFractionDigits:d}):'â€”';

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
    latest10:lastFinite(r,'NCV_Instant_Displ¶»§q«^