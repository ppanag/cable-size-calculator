"""Optional: the app's short-time results against two Python packages, run as published.

Setup (once, outside the repo):
    python3 -m venv ~/venvs/cable-tests && ~/venvs/cable-tests/bin/pip install numpy scipy pint matplotlib pandas ipython
    git clone https://github.com/TomLXXVI/python-electric && ~/venvs/cable-tests/bin/pip install --no-deps ./python-electric
    git clone https://github.com/dkienphung/cable_temperature
Run (after node short_dump.js):
    CABLE_TEMPERATURE_DIR=/path/to/cable_temperature ~/venvs/cable-tests/bin/python short_packages.py


  A. dkienphung/cable_temperature  cable_thermal.iec.iec60949_current  (IEC 60949 closed form)
  B. TomLXXVI/python-electric      sizing.cable.sizing._joule_integral (from its material data)
     - short-circuit mode: called as is (θ from its own insulation table: 70/90 → 160/250 °C)
     - load mode: its temperature lookup patched to (ambient → max. conductor temperature)
  C. cable_temperature  CableThermalModel - 1-D radial finite-difference model of a real 70 mm² Cu/XLPE/PVC
     cable (Riba & Llauradó 2022): the current that heats the conductor from θi to θf in exactly t,
     adiabatic and with convection + radiation, compared with the app's 70 mm² Cu/XLPE short-time Iz.
"""
import sys, json, math, os
sys.path.insert(0, os.environ.get('CABLE_TEMPERATURE_DIR', '../../cable_temperature'))
import numpy as np
from cable_thermal.iec import iec60949_current
from cable_thermal.model import CableThermalModel, ModelOptions
from cable_thermal.cables import get_cable
from python_electric.sizing.cable import sizing as pe

d = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out', 'short_results.json')))
num = lambda s: float(s.replace('mm²', '').replace('A', '').strip())
IEC = {'cu': (226.0, 234.5), 'al': (148.0, 228.0)}
PE_MAT = {'cu': 'copper', 'al': 'aluminium'}

def temps(ins, amb, mode, S, bar):
    if bar or mode == 'load':
        return amb, (70 if bar else ins)
    return ins, (250 if ins == 90 else (140 if S > 300 else 160))

def pe_current(mat, ins, thi, thf, t, S, patch):
    if patch:
        orig = pe._lookup_T_cmax
        pe._lookup_T_cmax = lambda insulation, short_time=False: thf if short_time else thi
        try: ji = pe._joule_integral(PE_MAT[mat], 'PVC', S)
        finally: pe._lookup_T_cmax = orig
    else:
        ji = pe._joule_integral(PE_MAT[mat], 'PVC' if ins == 70 else 'XLPE', S)
    return math.sqrt(ji / t)

worst = {'A': 0.0, 'B_sc': 0.0, 'B_load': 0.0}; n = 0
for c in d['cases']:
    p, r = c['p'], c['r']
    if r['verdict']: continue
    mat, ins, amb, t, mode, bar = p['mat'], int(p['ins']), float(p['T']), float(p['t']), p['dm'], p['ct'] == 'bar'
    S = max(num(r['vdropSize']), num(r['ampSize']))
    thi, thf = temps(ins, amb, mode, S, bar)
    K, beta = IEC[mat]
    Ia = float(iec60949_current(thi, thf, t, S, K, beta))
    cap = num(r['capacity'])
    if cap > Ia * 1.002: continue              # the steady Iz is the larger one and is shown; nothing short-time to compare
    n += 1
    worst['A'] = max(worst['A'], abs(cap - Ia) / Ia)
    sc = (mode == 'sc' and not bar)
    Ib = pe_current(mat, ins, thi, thf, t, S, patch=not sc)
    key = 'B_sc' if sc else 'B_load'
    worst[key] = max(worst[key], abs(cap - Ib) / Ib)
print(f'cases compared (short-time Iz shown): {n}')
print('largest difference of the app from  A cable_temperature.iec60949_current: %.3f%%   '
      'B python-electric _joule_integral: short circuit %.2f%%, load %.2f%%' % (worst['A']*100, worst['B_sc']*100, worst['B_load']*100))

# ---- C: finite-difference cable model, 70 mm² Cu/XLPE, ambient 30 °C
base = get_cable('cable70')
iec_cond = base.with_(resistivity_T0=1.7241e-8, alpha=1/(234.5+20), conductor_mass_per_length=3.45e6/385*70e-6,
                      ambient_temperature=30.0)
def fd_current(cable, thi, thf, t, adiabatic):
    m = CableThermalModel(cable, ModelOptions(dt=t/200, adiabatic=adiabatic))
    nn = len(m.x) if hasattr(m, 'x') else None
    def final(I):
        res = m.simulate(I, ambient=30.0, t_end=t, T_init=thi, dt=t/200)
        return float(res.T_conductor_insulation[-1])
    lo, hi = 0.0, 2000.0 * 70 / math.sqrt(t)
    for _ in range(40):
        mid = (lo + hi) / 2
        lo, hi = (mid, hi) if final(mid) < thf else (lo, mid)
    return (lo + hi) / 2
app = {}
for c in d['cases']:
    p, r = c['p'], c['r']
    if p['mat'] == 'cu' and p['ins'] == '90' and p['T'] == '30' and p['ct'] == 'cable' and not r['verdict'] \
       and max(num(r['vdropSize']), num(r['ampSize'])) == 70:
        app[(p['dm'], float(p['t']))] = num(r['capacity'])
print('\nC  70 mm² Cu/XLPE, ambient 30 °C: current that reaches the limit in t (A)')
print(f"{'mode':6} {'t (s)':>6} {'app':>9} {'FD adiab.':>10} {'FD adiab. IEC Cu':>17} {'FD with losses':>15}  app ≤ FD with losses")
for mode, thi, thf in (('load', 30.0, 90.0), ('sc', 90.0, 250.0)):
    for t in (0.05, 0.2, 1.0, 5.0):
        a = app.get((mode, t)) or float(iec60949_current(thi, thf, t, 70, *IEC['cu']))
        src = '' if (mode, t) in app else '*'
        f_ad = fd_current(base.with_(ambient_temperature=30.0), thi, thf, t, True)
        f_iec = fd_current(iec_cond, thi, thf, t, True)
        f_loss = fd_current(base.with_(ambient_temperature=30.0), thi, thf, t, False)
        print(f"{mode:6} {t:6.2f} {a:9.0f}{src:1} {f_ad:10.0f} {f_iec:17.0f} {f_loss:15.0f}  {'yes' if a <= f_loss * 1.001 else 'NO'}")
print('* app value not in the dumped grid (chosen size ≠ 70 mm²): the closed-form value the app uses is shown')
