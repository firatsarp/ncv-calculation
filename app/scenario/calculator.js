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
const OWNER='FÄ±rat SARP & Adem Åženocak';
const fmt=(v,d=2)=>Number.isFinite(Number(v))?Number(v).toLocaleString(undefined,{minimumFractionDigits:d,maximumFractionDigits:d}):'â€”';

function Input({label,value,onChange,step='any',unit,disabled=false,note}){
  return <label className={`inputRow ${disabled?'disabledRow':''}`}><span>{label}{note&&<small className="rowNote">{note}</small>}</span><div><input disabled={disabled} type="number" step={step} value={Number.isFinite(Number(value))?value:''} onChange={e=>onChange(Number(e.target.value))}/><em>{unit}</em></div></label>;
}
function Kpi({label,valu¶»§q«^