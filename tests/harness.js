// Drives a version of the calculator in jsdom, the way a user does.
// One page per file. For each case: restore the default inputs, set the given ones (keys as in the
// page's shareable URL), fire an 'input' event on the load field the user "typed" (this sets the
// current / power source and runs calc), then read the result fields.
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const APP = path.join(__dirname, '..', 'index.html');
const OUT = ['verdict','vdropSize','ampSize','capacity','util','loss','res','react','actualDrop','loadV','ampIb'];
const KEYS = {bi:'barinst', bf:'barfac', ac:'acdc', ct:'ctype', V:'voltage', I:'current', P:'power', L:'length', dU:'drop',
              m:'method', mat:'material', ins:'condtemp', T:'ambient', g:'grouping', pf:'pf', t:'dur', dm:'durmode'};
const pages = {};

function page(file){
  if(pages[file]) return pages[file];
  const vc = new VirtualConsole(), errors = [];
  vc.on('jsdomError', e => errors.push(String(e)));
  const dom = new JSDOM(fs.readFileSync(file, 'utf8'), { url: 'https://x.test/', runScripts: 'dangerously', virtualConsole: vc });
  const d = dom.window.document, defaults = {};
  for(const id of Object.values(KEYS)){ const el = d.getElementById(id); if(el) defaults[id] = el.value; }
  return pages[file] = { dom, d, defaults, errors };
}

function run(file, params){
  const { dom, d, defaults, errors } = page(file);
  errors.length = 0;
  for(const [id, v] of Object.entries(defaults)) d.getElementById(id).value = v;
  for(const [k, v] of Object.entries(params)){
    if(k === 'src') continue;
    const el = d.getElementById(KEYS[k]);
    if(!el) continue;                       // field not in this version (e.g. 'dur' in an older one)
    if(el.tagName === 'SELECT' && ![...el.options].some(o => o.value === v)) continue;
    el.value = v;
  }
  const src = params.src === 'kW' ? 'power' : 'current';
  if(src === 'power') d.getElementById('current').value = '';
  d.getElementById(src).dispatchEvent(new dom.window.Event('input'));
  const r = {};
  for(const id of OUT){ const el = d.getElementById(id); r[id] = el ? el.textContent.trim() : null; }
  r.critDrop = d.getElementById('limDrop').classList.contains('crit');
  r.critAmp = d.getElementById('limAmp').classList.contains('crit');
  r.current = d.getElementById('current').value;
  r.power = d.getElementById('power').value;
  if(errors.length) r.errors = [...errors];
  return r;
}

// Evaluates an expression in the page's global scope (top-level consts such as SIZES, AMP, ADIA).
function pageEval(file, expr){ return page(file).dom.window.eval(expr); }

module.exports = { run, pageEval, APP };
