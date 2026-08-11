export interface EngineSnapshot { playing: boolean; sourceTimeUs: number; generation: number }
type Listener = () => void;

export class AudioEngine {
  #snapshot: EngineSnapshot = { playing: false, sourceTimeUs: 0, generation: 0 };
  #listeners = new Set<Listener>();

  getSnapshot = () => this.#snapshot;
  subscribe = (listener: Listener) => { this.#listeners.add(listener); return () => this.#listeners.delete(listener); };
  play() { this.#update({ playing: true }); }
  pause() { this.#update({ playing: false }); }
  seek(sourceTimeUs: number) { this.#update({ sourceTimeUs: Math.max(0, Math.round(sourceTimeUs)), generation: this.#snapshot.generation + 1 }); }
  #update(change: Partial<EngineSnapshot>) { this.#snapshot = { ...this.#snapshot, ...change }; this.#listeners.forEach((listener) => listener()); }
}
