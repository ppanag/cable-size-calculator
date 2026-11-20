# Tests

The tests load `../index.html` in [jsdom](https://github.com/jsdom/jsdom) and drive it like a user does: they set the inputs, fire an input event and read the result fields. Nothing in the page is changed for testing.

## Setup

You need Node 18 or newer and Python 3. Run this once:

```bash
cd tests
npm install
```

## Running

Run all of them **before every commit**:

```bash
npm test
```

| Script | What it checks |
|---|---|
| `node regression.js [N] [--ref <git ref> \| --live]` | **Steady load is unchanged.** It runs 20,000 random cases plus edge cases with no duration set. The working copy must give identical results to the baseline: every result field, the message and which criterion sets the size. A second pass sets the cause to "short circuit" with the duration empty, and that must change nothing either. The default baseline is `HEAD` (the last commit). `--live` compares against the page on GitHub Pages. |
| `node short_dump.js` then `python3 short_check.py` | **Short-time sizing (IEC 60949).** It runs a 2,016-case grid: Cu/Al, PVC/XLPE, 10/30/45 °C, 0.05–5 s, load and short circuit, three methods, cables and busbars. Each case is checked against an independent implementation of the adiabatic rule. The size by capacity must be the smallest allowed size meeting it, and never larger than the steady-load size. The Iz shown is compared with the IEC closed form, with a first-principles RK4 integration of the heating equation, and with python-electric's material data. The energy loss must equal n·I²·R·t. |
| `node tables.js` | **Standard tables.** The IEC 60364-4-43 Table 43A k values are 115 / 143 / 76 / 94. The IEC 60949 Table I values are K = 226 / 148 and β = 234.5 / 228. It also checks four published worked examples, and the IEC 60364-5-52:2009 ampacities for Cu/PVC with two loaded conductors (methods A2, B2, C, D1, E). |
| `short_packages.py` (optional) | Compares the short-time results with two Python packages run as published: the IEC 60949 function of [dkienphung/cable_temperature](https://github.com/dkienphung/cable_temperature) and the Joule integral of [TomLXXVI/python-electric](https://github.com/TomLXXVI/python-electric). It also runs cable_temperature's finite-difference model of a real 70 mm² Cu/XLPE cable. The setup is described in the file's header. |

Each script exits with code 1 on failure. Outputs go to `out/`, which git ignores.

## Expected results (2026-11-20)

- Regression: 0 differences and 0 JS errors in both passes.
- Short-time checks:
  - 0 size mismatches.
  - Iz is within 0.12 % of the IEC closed form and within 0.21 % of the RK4 integration. Both differences come from display rounding and K rounded to 226.
  - Iz is within 2.2 % of python-electric, whose copper data gives K ≈ 223.
  - Energy loss is within 4.3 %, because kJ is shown with one decimal.
- Tables: 15 / 15.
- Finite-difference model: with the cable's real data (its effective conductor area is about 65 mm² for a nominal 70 mm²), the IEC result is 3–5 % optimistic below about 1 s. With IEC copper data it is 3–9 % conservative. Heat loss to the air makes no difference up to 5 s.
