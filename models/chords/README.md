# Chord model

`crema-chord.onnx` is Brian McFee's CREMA chord model, converted to ONNX so the
runtime this app already ships can run it.

| | |
|---|---|
| Upstream | `crema` 0.2.0, `crema/models/chord/model.h5` (model version `a4c7d57.0`) |
| Source | https://pypi.org/project/crema/0.2.0/ · https://github.com/bmcfee/crema |
| License | BSD 2-Clause, whole distribution including the weights — see `LICENSE.crema.md` |
| Paper | McFee & Bello, *Structured training for large-vocabulary chord recognition*, ISMIR 2017 |
| Converted artifact | `crema-chord.onnx`, sha256 `796f9bf51aa647cb385f49d0f383b691295410c64cfa369eaa97f0133aadae77`, 2.19 MB |

## Why this model

The chroma stage it replaces matches templates against spectral peaks, which
assumes the peaks are tonal partials. On a distorted guitar they are not — the
audit measured a tuning histogram whose strongest bin held 1.5% of peak energy —
so there was nothing for a template to match. This model was trained on
annotated recordings to output pitch classes and chord names directly, which is
evidence rather than assumption.

Three of the four heads are exported:

| head | shape | used for |
|---|---|---|
| `chord_pitch` | 12 pitch-class activations | the key estimate, and how much this looks like harmony at all |
| `chord_bass` | 13 — twelve pitch classes plus "no bass" | telling a chord from its relative minor, which the bass is the only witness to |
| `chord_tag` | 170 chord classes | the chord itself |

The fourth head, `chord_struct`, is dropped: nothing decodes it.

`chord_tag` is what the paper is about — 170 classes, twelve roots across
fourteen qualities plus `N` and `X`, trained on annotated recordings. The app
decoded it with seven hand-built templates and hand-tuned quality priors until
this head was restored; the priors existed to stop a four-note template winning
on coverage rather than on evidence, which is a problem a trained classifier
does not have.

### The class order is exported, not written down

Nothing in the ONNX graph records which chord each of the 170 outputs means, and
the obvious accessor is the wrong one: `ChordTagTransformer.vocabulary()`
returns `['N', 'X', 'C:min', ...]`, but pumpp fits a scikit-learn `LabelEncoder`
on that list and sklearn sorts, so the model's index order is
`encoder.classes_` — `['A#:7', 'A#:aug', ...]`. Reading the wrong one transposes
every chord the app prints, silently and plausibly.

So `convert.py` exports the order from the checkpoint's own encoder into
`crema-chord-vocabulary.json`, and the build inlines it. `apps/web/src/features/analysis/taggedChords.test.ts`
asserts the file is sorted and 170 long, which is what would fail if the wrong
accessor were ever used again.

## Reproducing the conversion

Needs Python 3.11 — the checkpoint is Keras 2.2.2 and only the Keras 2 API can
read it. `SqueezeLayer` is a custom layer from `crema/layers.py` and has to be
supplied by hand because the exported graph does not carry its code.

```bash
uv venv --python 3.11 .venv
uv pip install --python .venv/bin/python "tensorflow==2.15.1" "numpy<2" tf2onnx "onnx==1.16.2" "onnxruntime==1.18.1" "setuptools<81" crema
ln -sfn .venv/lib/python3.11/site-packages/crema crema
.venv/bin/python convert.py
```

Both pins are load-bearing. A current `onnx` wants an `ml_dtypes` newer than the
one TensorFlow 2.15 holds down, and `setuptools` 81 removed `pkg_resources`,
which `crema` imports at module scope.

`convert.py` verifies the ONNX graph against Keras on random input before
writing; the two agree to within 1e-6.

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
