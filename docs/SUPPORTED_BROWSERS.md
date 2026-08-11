# Supported browsers and operating systems

The qualification target is the current and previous stable desktop release.

| Browser | Linux | Windows | macOS | Capability tier |
|---|---:|---:|---:|---|
| Chrome / Chromium | Yes | Yes | Yes | Full local library, practice, SharedArrayBuffer playback and recording. Local ML only after the device-specific probe passes. |
| Microsoft Edge | Yes | Yes | Yes | Same Chromium tier; local ML remains probe-gated. |
| Firefox | Yes | Yes | Yes | Library, practice and cloud separation. Transfer-buffer playback fallback is allowed; local ML is hidden unless a separate WASM probe passes. |
| Safari | — | — | Yes | Library, practice and cloud separation with codec probes. Local ML is hidden. Shipping Safari qualification requires physical macOS hardware. |

Mobile layouts support playback and review. Mobile recording and local separation are not release promises.

Required release evidence is tracked per browser/OS in `docs/qualification/`; the absence of a passing result means the capability is not advertised.
