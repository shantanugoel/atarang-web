export type EngineCommand =
  | { type: "transport/play"; requestId: string; songId: string; generation: number }
  | { type: "transport/pause"; requestId: string; songId: string; generation: number }
  | { type: "transport/seek"; requestId: string; songId: string; generation: number; timeUs: number }
  | { type: "mixer/level"; requestId: string; songId: string; generation: number; stem: "vocals" | "drums" | "bass" | "other"; gainDb: number };

export type EngineResponse =
  | { type: "ready"; requestId: string; songId: string; generation: number }
  | { type: "snapshot"; requestId: string; songId: string; generation: number; sourceTimeUs: number; playing: boolean }
  | { type: "error"; requestId: string; songId: string; generation: number; code: string };
