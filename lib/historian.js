import * as XLSX from 'xlsx';
import { norm } from './ncv';

export function headerRowScore(row){
  const vals=(row||[]).filter(v=>v!==null&&v!==undefined&&v!=='').map(norm);
  if(!vals.length) return -1;
  let score=0;
  if(vals.includes('DATETIME')) score+=100000;
  if(vals.some(v=>v.includes('DATE')&&v.includes('TIME'))) score+=50000;
  if(vals.some(v=>/^[123]LBA10CF901/.test(v))) score+=20000;
  const tokens=['LBA','LAB','HAD','LBG','HLA','HNA','ETN','HJY','EAF'];
  score+=Math.min(60,vals.filter(v=>tokens.some(t=>v.includes(t))).length)*250;
  return score;
}

export function workbookToData(wb){
  const ws=wb.Sheets[wb.SheetNames[0]];
  const raw=XLSX.utils.sheet_to_json(ws,{header:1,defval:null,raw:true});
  let best=0,score=-1;
  for(let i=0;i<Math.min(300,raw.length);i++){
    const s=headerRowScore(raw[i]);
    if(s>score){score=s;best=i;}
  }
  const headers=(raw[best]||[]).map((h,i)=>String(h??`Column_${i+1}`).trim());
  const rows=[];
  for(let r=best+1;r<raw.length;r++){
    const arr=raw[r]||[];
    if(!arr.some(v=>v!==null&&v!==undefined&&v!=='')) continue;
    const obj={};
    headers.forEach((h,i)=>obj[h]=arr[i]);
    rows.push(obj);
  }
  return {headers,rows,headerRow:best};
}

export function padOle(buffer){
  const u=new Uint8Array(buffer);
  const sig=[0xD0,0xCF,0x11,0xE0,0xA1,0xB1,0x1A,0xE1];
  const isOle=sig.every((b,i)=>u[i]===b);
  if(!isOle || u.length%512===0) return buffer;
  const out=new Uint8Array(u.length+(512-u.length%512));
  out.set(u);
  return out.buffer;
}

export async function readHistorianFile(file){
  let buffer=await file.arrayBuffer();
  if(file.name.toLowerCase().endsWith('.xls')) buffer=padOle(buffer);
  const wb=XLSX.read(buffer,{type:'array',cellDates:true,dense:false});
  return workbookToData(wb);
}

export function displayDateTime(d){
  if(!(d instanceof Date)||Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined,{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
}

export function toDateTimeLocal(d){
  if(!(d instanceof Date)||Number.isNaN(d.getTime())) return '';
  const p=n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
