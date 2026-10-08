import { requireSession } from '../lib/auth';
import AuthControls from './auth-controls';
export const dynamic = 'force-dynamic';
import Link from 'next/link';

const BUILD='2026.09.30-vercel-r2';
const OWNER='FÄ±rat SARP & Adem Åženocak';

export default async function Home(){
  await requireSession();
  return <main className="homeMain"><AuthControls />
    <header className="homeHeader">
      <div>
        <p className="eyebrow">Istanbul WtE â€¢ Waste NCV Engineering Tools</p>
        <h1>NCV Calculation & Scenario Platform</h1>
        <p className="sub">Two workflows using the same HZI 90101284 Rev. 3.1 calculation engine.</p>
      </div>
      <div className="build">Build {BUILD} {OWNER}</div>
    </header>

    <section className="homeIntro card">
      <h2>Select a function</h2>
      <p>Use the calculation module to reproduce historian NCV results, or the scenario module to test process and throughput changes against a selected Actual baseline.</p>
    </section>

    <section className="functionGrid">
      <Link href="/ncv-calculation" className="functionCard card">
        <div className="functionNo">01</div>
        <div>
          <p className="eyebrow">Historian calculation</p>
          <h2>NCV Calculation</h2>
          <p>Upload historian XLS/XLSX data and calculate the 10-minute engineering estimate, 3-hour NCV and 8-hour NCV for each available line.</p>
          <div className="featureTags"><span>10 min</span><span>3 h</span><span>8 h</span><span>Excel ¶»§q«^