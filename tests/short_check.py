"""Short-time feature against independent implementations (reads out/short_results.json from short_dump.js).

Reference A - IEC 60949 closed form as coded in dkienphung/cable_temperature (cable_thermal/iec.py):
    iec60949_current = K S sqrt(ln((θf+β)/(θi+β)) / t),  K, β from IEC 60949 Table I.
Reference B - python-electric (TomLXXVI) _joule_integral, generalised from (θ_cont → θ_short) to (θi → θf):
    k = sqrt(cp·d / (ρ20·α20) · ln(f(θf)/f(θi))) · 1e-6,  f(T) = 1 + α20 (T − 20),
    with its own material data (Cu 8940 kg/m³, 385 J/kgK, 1.78e-2 Ω mm²/m, 0.0039 1/K; Al 2700, 897, 2.86e-2, 0.0040).
Reference C - first principles: RK4 integration of the adiabatic heat balance with temperature-dependent
    resistance, σc dθ/dt = J² ρ20 (1 + (θ−20)/(β+20)), IEC 60949 material data; the current that brings the
    conductor from θi to θf in exactly t is found by bisection.
The formulas of A and B are transcribed (not imported); C is written from the physics.
"""
import json, math, os, sys

d = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out', 'short_results.json')))
SIZES, AL_MIN, TAB = d['SIZES'], d['AL_MIN'], d['tabulated']

IEC = {'cu': dict(K=226.0, beta=234.5, sigma=3.45e6, rho20=1.7241e-8),
       'al': dict(K=148.0, beta=228.0, sigma=2.5e6, rho20=2.8264e-8)}
PE = {'cu': dict(d=8940.0, cp=385.0, rho20=1.78e-2, a=0.0039),
      'al': dict(d=2700.0, cp=897.0, rho20=2.86e-2, a=0.0040)}

def temps(mat, ins, amb, mode, S, bar):
    if bar or mode == 'load':
        return amb, (70 if bar else ins)
    return ins, (250 if ins == 90 else (140 if S > 300 else 160))

def I_A(mat, thi, thf, t, S):   # dkienphung iec60949_current
    c = IEC[mat]
    return c['K'] * S * math.sqrt(math.log((thf + c['beta']) / (thi + c['beta'])) / t)

def I_B(mat, thi, thf, t, S):   # python-electric joule integral
    c = PE[mat]; f = lambda T: 1 + c['a'] * (T - 20)
    k = math.sqrt(c['cp'] * c['d'] / (c['rho20'] * 1e-6 * c['a']) * math.log(f(thf) / f(thi))) * 1e-6
    return k * S / math.sqrt(t)

def I_C(mat, thi, thf, t, S, n=400):   # RK4 + bisection, SI units
    c = IEC[mat]; A = S * 1e-6
    def final(I):
        J2 = (I / A) ** 2; th = thi; h = t / n
        g = lambda th: J2 * c['rho20'] * (1 + (th - 20) / (c['beta'] + 20)) / c['sigma']
        for _ in range(n):
            k1 = g(th); k2 = g(th + h * k1 / 2); k3 = g(th + h * k2 / 2); k4 = g(th + h * k3)
            th += h * (k1 + 2 * k2 + 2 * k3 + k4) / 6
        return th
    lo, hi = 0.0, 1e3 * S / math.sqrt(t)
    for _ in range(60):
        mid = (lo + hi) / 2
        lo, hi = (mid, hi) if final(mid) < thf else (lo, mid)
    return (lo + hi) / 2

num = lambda s: float(s.replace('mm²', '').replace('A', '').strip())
worst = {'A': 0, 'B': 0, 'C': 0}
n = fails = rescued = 0; size_mismatch = []; cap_mismatch = []
for c in d['cases']:
    p, r, r0 = c['p'], c['r'], c['steady']
    steady_cap = 'exceeds' in r0['verdict']           # steady size above the largest one: the short-time rule may still fit
    if r['verdict'] or (r0['verdict'] and not steady_cap):
        # a short duration may only turn a 'too large' message into a size, never the other way round
        if r['verdict'] != r0['verdict']: fails += 1; print('verdict differs', p, r['verdict'], '|', r0['verdict'])
        continue
    n += 1; rescued = rescued + 1 if steady_cap else rescued
    mat, ins, amb, t, mode, bar = p['mat'], int(p['ins']), float(p['T']), float(p['t']), p['dm'], p['ct'] == 'bar'
    I = float(p['I'])
    # expected size by capacity: smallest candidate the short-time rule allows, never larger than the steady size
    steady = math.inf if steady_cap else num(r0['ampSize'])
    if bar:
        cand = range(1, 2001)
    else:
        tab = TAB[mat + p['ins'] + p['m']]
        cand = [s for s, ok in zip(SIZES, tab) if ok and s >= (AL_MIN if mat == 'al' else 0)]
    short = next((s for s in cand if I <= I_A(mat, *temps(mat, ins, amb, mode, s, bar), t, s) * (1 + 1e-12)), None)
    exp = steady if short is None else min(steady, short)
    got = num(r['ampSize'])
    if abs(got - exp) > 1e-9: size_mismatch.append((p, got, exp))
    # capacity of the chosen size: max(steady Iz of that size, short-time rating)
    chosen = max(num(r['vdropSize']), got)
    thi, thf = temps(mat, ins, amb, mode, chosen, bar)
    Ia, Ib, Ic = I_A(mat, thi, thf, t, chosen), I_B(mat, thi, thf, t, chosen), I_C(mat, thi, thf, t, chosen)
    cap = num(r['capacity'])
    if cap + 0.051 < Ia * 0.999: cap_mismatch.append((p, cap, Ia))
    if abs(cap - Ia) / Ia < 0.02 or cap < Ia * 1.02:   # the short-time value is the one shown
        for k, ref in (('A', Ia), ('B', Ib), ('C', Ic)):
            worst[k] = max(worst[k], abs(cap - ref) / ref)

print(f'cases with a size: {n} (of which {rescued} too large for steady load); unexpected verdicts: {fails}')
print(f'size-by-capacity mismatches: {len(size_mismatch)}'); [print('  ', *m) for m in size_mismatch[:10]]
print(f'capacity below the short-time rating: {len(cap_mismatch)}'); [print('  ', *m) for m in cap_mismatch[:10]]
print('largest relative difference of the shown short-time Iz from  A (IEC closed form): %.4f%%  B (python-electric data): %.3f%%  C (RK4 ODE): %.4f%%'
      % (worst['A'] * 100, worst['B'] * 100, worst['C'] * 100))

# energy loss shown in short-time mode = n · I² · R · t (cables: R = ρ L / S, ρ in normal service)
RHO = {'cu': 0.0225, 'al': 0.036}; UNIT = {'J': 1, 'kJ': 1e3, 'MJ': 1e6}
e_worst = 0.0; e_n = 0
for c in d['cases']:
    p, r = c['p'], c['r']
    if r['verdict'] or p['ct'] != 'cable': continue
    v, u = r['loss'].split(); E = float(v.replace(',', '.')) * UNIT[u]
    S = max(num(r['vdropSize']), num(r['ampSize']))
    exp = (3 if p['ac'] == 'ac3' else 2) * float(p['I']) ** 2 * RHO[p['mat']] * float(p['L']) / S * float(p['t'])
    e_worst = max(e_worst, abs(E - exp) / exp); e_n += 1
print('energy loss: %d cases, largest difference %.2f%% (kJ shown with one decimal)' % (e_n, e_worst * 100))

ok = (not fails and not size_mismatch and not cap_mismatch and worst['A'] < 0.005 and worst['C'] < 0.005
      and worst['B'] < 0.03 and e_worst < 0.06)
print('RESULT:', 'PASS' if ok else 'FAIL')
sys.exit(0 if ok else 1)
