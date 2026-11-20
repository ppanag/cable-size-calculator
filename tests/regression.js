// Regression: with no duration set (steady load), the working copy must give exactly the same results
// as a baseline version — every result field, the verdict text and which criterion sets the size.
//
//   node regression.js [N] [--ref <git ref> | --live]
//     N       random cases (default 20000); fixed edge cases are always added
//     --ref   baseline from git (default HEAD = the last commit; run this before committing)
//     --live  baseline = the page currently served on GitHub Pages
//
// A second pass sets the short-time cause to 'short circuit' with the duration empty: it must change nothing.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { run, APP } = require('./harness');

const args = process.argv.slice(2);
const N = +(args.find(a => /^\d+$/.test(a)) || 20000);
const live = args.includes('--live');
const ref = args.includes('--ref') ? args[args.indexOf('--ref') + 1] : 'HEAD';
fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });
const BASE = path.join(__dirname, 'out', 'baseline.html');

async function main(){
  if(live){
    const res = await fetch('https://ppanag.github.io/cable-size-calculator/?nc=' + Date.now());
    fs.writeFileSync(BASE, await res.text());
  } else {
    fs.writeFileSync(BASE, execFileSync('git', ['show', ref + ':index.html'], { cwd: path.join(__dirname, '..') }));
  }
  console.log(`baseline: ${live ? 'live site' : 'git ' + ref}; working copy: index.html`);

  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const pick = a => a[Math.floor(rnd() * a.length)];
  const cases = [{}, {ct:'bar'}, {ac:'dc'}, {ac:'ac3', I:'400'}, {T:'61'}, {T:'85', ins:'90'}, {m:'D', T:'45'}, {I:'0'}, {L:''}];
  for(let i = 0; i < N; i++){
    const realistic = i % 2 === 0;           // half realistic installations, half extreme values
    const p = {
      ac: pick(['dc','ac','ac3']), ct: rnd() < 0.2 ? 'bar' : 'cable',
      V: realistic ? pick(['230','400','690','48']) : pick(['12','24','48','230','400','690']),
      L: realistic ? pick(['2','5','10','20','45','80']) : pick(['0.5','2','10','45','120','400']),
      dU: pick(['1','3','5','8']), m: pick(['A','B','C','E','D']), mat: pick(['cu','al']),
      ins: pick(['70','90']), T: pick(['5','10','20','25','30','35','40','47','55','60','65','80']),
      g: pick(['1','2','3','4','5','6']), pf: pick(['1','0.95','0.8','0.5']),
      bi: pick(['air','enc']), bf: pick(['0.8','0.6','1']),
    };
    if(rnd() < 0.75){ p.src = 'A'; p.I = String(1 + Math.floor(Math.pow(rnd(), 2) * (realistic ? 300 : 3000))); }
    else { p.src = 'kW'; p.P = (Math.round(rnd() * 5000) / 10).toFixed(1); }
    cases.push(p);
  }

  let failed = false;
  for(const [label, extra] of [['steady load', {}], ['cause = short circuit, no duration', { dm:'sc', t:'' }]]){
    let diffs = 0, errs = 0, sized = 0;
    for(const p of cases){
      const a = run(BASE, p), b = run(APP, { ...p, ...extra });
      if(a.errors || b.errors){ errs++; if(errs <= 5) console.log('JS ERROR', JSON.stringify(p), a.errors, b.errors); }
      if(!b.verdict) sized++;
      if(JSON.stringify(a) !== JSON.stringify(b)){
        diffs++;
        if(diffs <= 10) console.log('DIFF', JSON.stringify(p), '\n  baseline', JSON.stringify(a), '\n  new     ', JSON.stringify(b));
      }
    }
    console.log(`${label}: ${cases.length} cases (${sized} with a size), differences ${diffs}, JS errors ${errs}`);
    if(diffs || errs) failed = true;
  }
  process.exit(failed ? 1 : 0);
}
main();
