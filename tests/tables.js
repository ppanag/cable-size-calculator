// Against the standards' tables and published worked examples.
const { run, pageEval, APP } = require('./harness');
let pass = 0, fail = 0;
const check = (name, ok, info) => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (info ? '  — ' + info : '')); };
const num = s => parseFloat(s);
const base = { V:'400', ac:'ac3', L:'1', dU:'10', pf:'1', g:'1', T:'30', m:'E', src:'A', ct:'cable' };

// 3a. IEC 60364-4-43 Table 43A (and IEC 60364-5-54 Table A.54.x) k values: short-circuit mode, t = 1 s,
//     k = Iz(1 s) / S. Sizes up to 300 mm² (the calculator's largest cable).
const K43A = { cu70:115, cu90:143, al70:76, al90:94 };
for(const [key, k] of Object.entries(K43A)){
  const mat = key.slice(0,2), ins = key.slice(2);
  let worst = 0;
  for(const S of [16, 50, 120, 300]){
    // a current that needs exactly S under the short-time rule: just below k·S
    const r = run(APP, { ...base, mat, ins, I: String(Math.floor(k * S * 0.999)), t:'1', dm:'sc' });
    const kApp = num(r.capacity) / num(r.ampSize);
    worst = Math.max(worst, Math.abs(kApp - k) / k);
  }
  check(`Table 43A k ${mat.toUpperCase()}/${ins==='70'?'PVC':'XLPE'} = ${k}`, worst * k < 0.5,   // the table gives k rounded to an integer
        `largest deviation ${(worst*100).toFixed(2)} %`);
}

// 3b. IEC 60949 Table I: K = sqrt(σc (β+20) / ρ20) from the material constants
const T1 = { cu:{sigma:3.45e6, beta:234.5, rho:1.7241e-8, K:226}, al:{sigma:2.5e6, beta:228, rho:2.8264e-8, K:148} };
const ADIA = pageEval(APP, 'ADIA');
for(const m of ['cu','al']){
  const Kc = Math.sqrt(T1[m].sigma * (T1[m].beta + 20) / T1[m].rho) * 1e-6;
  check(`IEC 60949 Table I ${m}: K = ${T1[m].K}, β = ${T1[m].beta}`, ADIA[m].K === T1[m].K && ADIA[m].B === T1[m].beta && Math.abs(Kc - ADIA[m].K) / Kc < 0.01,
        `code K=${ADIA[m].K} β=${ADIA[m].B}; from material constants K=${Kc.toFixed(1)}`);
}

// 3c. Published worked examples (online calculators)
// instrumentationblog.in: 10 kA cleared in 0.4 s, Cu/PVC: S = 10000·√0.4/115 = 55 mm² → use 70 mm²
let r = run(APP, { ...base, mat:'cu', ins:'70', I:'10000', t:'0.4', dm:'sc' });
check('instrumentationblog: 10 kA, 0.4 s, Cu/PVC → 70 mm²', r.ampSize === '70 mm²', 'app: ' + r.ampSize);
// engineercalc / calculatorsconversion: 10 mm² Cu/PVC at 3500 A survives 0.108 s
r = run(APP, { ...base, mat:'cu', ins:'70', I:'3500', t:'0.1079', dm:'sc' });
const r2 = run(APP, { ...base, mat:'cu', ins:'70', I:'3500', t:'0.1081', dm:'sc' });
check('10 mm² Cu/PVC at 3500 A survives (1150/3500)² = 0.10796 s: 0.1079 s → 10 mm², 0.1081 s → 16 mm²', r.ampSize === '10 mm²' && r2.ampSize === '16 mm²', `app: ${r.ampSize}, ${r2.ampSize}`);
// dkienphung/cable_temperature: 70 mm² Cu/XLPE, 9.27 kA for 1 s from 90 °C reaches 250 °C adiabatically
r = run(APP, { ...base, mat:'cu', ins:'90', I:'9270', t:'1', dm:'sc' });
check('cable_temperature: 9.27 kA, 1 s, Cu/XLPE from 90 °C → 70 mm²', r.ampSize === '70 mm²', 'app: ' + r.ampSize + ', Iz ' + r.capacity);
// mepcalculators: A ≥ Ik·√t / 143 (Cu/XLPE 90 → 250 °C); e.g. 25 kA, 1 s → 174.8 mm² → 185 mm²
r = run(APP, { ...base, mat:'cu', ins:'90', I:'25000', t:'1', dm:'sc' });
check('mepcalculators formula: 25 kA, 1 s, Cu/XLPE → 185 mm²', r.ampSize === '185 mm²', 'app: ' + r.ampSize);

// 3d. Steady load: the calculator's IEC 60364-5-52 tables (Cu, PVC, two loaded conductors, 30 °C air / 20 °C ground)
//     against Table B.52.2 (methods A2, B2, C, D1) and B.52.10 (method E)
const B52 = {
  A:[14,18.5,25,32,43,57,75,92,110,139,167,192,219,248,291,334],
  B:[16.5,23,30,38,52,69,90,111,133,168,201,232,258,294,344,394],
  C:[19.5,27,36,46,63,85,112,138,168,213,258,299,344,392,461,530],
  D:[22,29,37,46,60,78,99,119,140,173,204,231,261,292,336,379],   // 2009 edition, soil 2.5 K·m/W
  E:[22,30,40,51,70,94,119,148,180,232,282,328,379,434,514,593],
};
const AMP = pageEval(APP, 'AMP.cu[70][2]');
for(const [m, ref] of Object.entries(B52)){
  const got = AMP[m], bad = ref.map((v,i)=>[v,got[i],i]).filter(([v,g])=>v!==g);
  check(`B.52 Cu/PVC 2-loaded method ${m}`, bad.length === 0, bad.length ? 'diff at ' + bad.map(([v,g,i])=>`${[1.5,2.5,4,6,10,16,25,35,50,70,95,120,150,185,240,300][i]} mm²: table ${v} app ${g}`).join('; ') : '16 sizes');
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
