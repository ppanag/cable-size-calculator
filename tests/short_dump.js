// Short-time feature: runs a grid of cases (each also without a duration) and writes out/short_results.json
// with the results plus the size list and which sizes are tabulated per material / insulation / method.
// Checked by short_check.py (and optionally short_packages.py).
const fs = require('fs');
const path = require('path');
const { run, pageEval, APP } = require('./harness');

const out = { cases: [] };
const mats = ['cu','al'], ins = ['70','90'], Ts = ['10','30','45'], durs = ['0.05','0.2','1','5'];
const modes = ['load','sc'], methods = ['B','E','D'], Is = ['16','63','250','1000','8000','30000'];
for(const mat of mats) for(const i of ins) for(const T of Ts) for(const t of durs) for(const dm of modes)
for(const m of methods) for(const I of Is) for(const ct of ['cable','bar']){
  if(ct === 'bar' && (i !== '70' || m !== 'B')) continue;      // bars ignore insulation and method
  // short line and a generous drop, so the voltage-drop size rarely hides the capacity size
  const p = { V:'400', ac:'ac3', L:'1', dU:'10', pf:'1', g:'1', mat, ins:i, T, m, I, src:'A', ct, t, dm };
  const r = run(APP, p), r0 = run(APP, { ...p, t:'' });
  if(r.errors) throw new Error(r.errors.join('\n'));
  out.cases.push({ p, r, steady: r0 });
}
out.SIZES = pageEval(APP, 'SIZES');
out.AL_MIN = pageEval(APP, 'AL_MIN');
out.tabulated = pageEval(APP, `(()=>{ const o={}; for(const mat of ['cu','al']) for(const ins of [70,90]) for(const m of ['A','B','C','E','D'])
  o[mat+ins+m] = SIZES.map((s,i)=>AMP[mat][ins][3][m][i]!=null); return o; })()`);
fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'out', 'short_results.json'), JSON.stringify(out));
console.log('short-time grid:', out.cases.length, 'cases written to out/short_results.json');
