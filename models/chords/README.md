# Chord front end model

`crema-chord-pitch.onnx` is the pitch-class half of Brian McFee's CREMA chord
model, converted to ONNX so the runtime this app already ships can run it.

| | |
|---|---|
| Upstream | `crema` 0.2.0, `crema/models/chord/model.h5` (model version `a4c7d57.0`) |
| Source | https://pypi.org/project/crema/0.2.0/ · https://github.com/bmcfee/crema |
| License | BSD 2-Clause, whole distribution including the weights — see `LICENSE.crema.md` |
| Paper | McFee & Bello, *Structured training for large-vocabulary chord recognition*, ISMIR 2017 |
| Converted artifact | `crema-chord-pitch.onnx`, sha256 `4edf436133c56f77ab4cb2c15a4ea1a040d4def2358324123fca8d9c54515ab8`, 1.98 MB |

## Why this model

The chroma stage it replaces matches templates against spectral peaks, which
assumes the peaks are tonal partials. On a distorted guitar they are not — the
audit measured a tuning histogram whose strongest bin held 1.5% of peak energy —
so there was nothing for a template to match. This model was trained on
annotated recordings to output pitch classes directly, which is evidence rather
than assumption.

Only two of the four heads are exported: `chord_pitch` (12 pitch-class
activations) and `chord_bass` (13, twelve pitch classes plus "no bass"). They
are the shapes the existing decoder already consumes, so the Viterbi decode, the
bass term, the key estimate, the segment contract and the user correction layer
are all untouched. The 170-way `chord_tag` head and its classifier are dropped:
this app decodes chords itself, and dropping them removes a tenth of the weights.

## Reproducing the conversion

Needs Python 3.11 — the checkpoint is Keras 2.2.2 and only the Keras 2 API can
read it. `SqueezeLayer` is a custom layer from `crema/layers.py` and has to be
supplied by hand because the exported graph does not carry its code.

```bash
uv venv --python 3.11 .venv
uv pip install --python .venv/bin/python "tensorflow==2.15.1" "numpy<2" tf2onnx onnx crema
.venv/bin/python convert.py
```

`convert.py` verifies the ONNX graph against Keras on random input before
writing; the two agree to 1e-6.

## Input

Twelve-channel-free: the model takes `(1, frames, 216, 2)` — a constant-Q
magnitude spectrum in dB, 216 bins of 36 per octave from C1, one channel per
harmonic (fundamental and octave), at a hop of 4096 samples at 44.1 kHz.

The browser does not compute a true multirate constant-Q transform. It maps the
8192-point FFT magnitudes the analysis pass already produces onto the same
log-spaced bins with triangular weights, which is far cheaper and, measured
against a librosa reference on the bundled demo, changes nothing the model
decides: pitch-class activations differ by a mean of 0.02, and every
active/inactive decision agrees. See `apps/web/src/features/analysis/cqt.ts`.
