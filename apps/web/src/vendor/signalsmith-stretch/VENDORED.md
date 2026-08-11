# Signalsmith Stretch Web

Vendored from `Signalsmith-Audio/signalsmith-stretch` at commit
`57b93f4e9206a089a45387eaa39bdc9f310d3308` (release package 1.3.2).

- Upstream: https://github.com/Signalsmith-Audio/signalsmith-stretch
- Source asset: `web/release/SignalsmithStretch.mjs`
- SHA-256: `97530b11d5bc01015af4cde40d6aa55ff10c40aa1294ca4c8c5762027d517a46`
- License: MIT; see `LICENSE.txt`.

The upstream release embeds its WASM and registers its own AudioWorklet from a
Blob URL. The application build treats this file as an explicit hashed runtime
entry instead of folding it into the React bundle.
