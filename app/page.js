import Link from 'next/link';

const BUILD='2026.09.30-vercel-r2';
const OWNER='Fırat SARP';

export default function Home(){
  return <main className="homeMain">
    <header className="homeHeader">
      <div>
        <p className="eyebrow">Istanbul WtE • Waste NCV Engineering Tools</p>
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
          <div className="featureTags"><span>10 min</span><span>3 h</span><span>8 h</span><span>Excel export</span></div>
        </div>
        <div className="openArrow">→</div>
      </Link>

      <Link href="/scenario" className="functionCard card">
        <div className="functionNo">02</div>
        <div>
          <p className="eyebrow">What-if engineering model</p>
          <h2>NCV & Throughput Scenario</h2>
          <p>Select an Actual date/time, change waste and process conditions, compare projected NCV / heat input / capacity, and export hourly projections.</p>
          <div className="featureTags"><span>Actual date/time</span><span>What-if</span><span>Hourly projection</span><span>Excel export</span></div>
        </div>
        <div className="openArrow">→</div>
      </Link>
    </section>

    <div className="note homeNote"><strong>Method note:</strong> HZI Rev. 3.1 formally defines the 3-hour and 8-hour NCV outputs. The 10-minute value is retained as an engineering estimate for operational trending.</div>
  </main>;
}
