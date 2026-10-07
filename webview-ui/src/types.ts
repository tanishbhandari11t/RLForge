export type Num = number | 'NaN' | 'Infinity' | '-Infinity';

export type Encoded =
  | { kind: 'scalar'; value: Num; integer?: boolean }
  | { kind: 'vector'; shape: number[]; dtype: string; values: Num[] }
  | {
      kind: 'tensor';
      shape: number[];
      dtype: string;
      min?: Num | null;
      max?: Num | null;
      mean?: Num | null;
      std?: Num | null;
      nanCount?: number;
      infCount?: number;
    }
  | { kind: 'dict'; items: Record<string, Encoded> }
  | { kind: 'tuple'; items: Encoded[] }
  | { kind: 'other' | 'error'; repr: string };

export type Frame =
  | { kind: 'image'; src: string; width: number; height: number; pixelated?: boolean }
  | { kind: 'text'; text: string };

export interface Anomaly {
  level: 'critical' | 'warning';
  code: string;
  message: string;
  index?: number;
}

export interface ActionInfo {
  type: 'discrete' | 'continuous' | 'other';
  mode?: 'uniform' | 'policy' | 'q';
  probs?: number[];
  qValues?: Num[];
  selected?: number;
  entropy?: number;
  value?: Num;
  q?: Num;
  values?: Num[];
  low?: (Num | null)[];
  high?: (Num | null)[];
  mean?: Num[];
  std?: Num[];
  introspectionError?: string;
}

export interface TimelineEntry {
  step: number;
  obs: Encoded;
  frame?: Frame | null;
  action?: Encoded;
  actionInfo?: ActionInfo;
  reward?: Num;
  totalReward: Num;
  terminated: boolean;
  truncated: boolean;
  info?: unknown;
  anomalies: Anomaly[];
}

export interface EpisodeSummary {
  episode: number;
  seed: number | null;
  return: Num;
  length: number;
  terminated: boolean;
  truncated: boolean;
  anomalies: number;
}

export interface SpaceDesc {
  type: string;
  repr: string;
  shape?: number[];
  dtype?: string;
  low?: Num[] | { min: Num; max: Num; allFinite: boolean };
  high?: Num[] | { min: Num; max: Num; allFinite: boolean };
  boundedBelow?: boolean;
  boundedAbove?: boolean;
  size?: number;
  n?: number;
  start?: number;
  nvec?: number[];
  spaces?: Record<string, SpaceDesc> | SpaceDesc[];
}

export interface Inspection {
  envId: string;
  source: 'registry' | 'file';
  envClass: string;
  description: string | null;
  sourceFile: string | null;
  sourceLine: number | null;
  spec: {
    id: string;
    entryPoint: string;
    maxEpisodeSteps: number | null;
    rewardThreshold: number | null;
    nondeterministic: boolean;
    kwargs: Record<string, unknown>;
  } | null;
  observationSpace: SpaceDesc;
  actionSpace: SpaceDesc;
  observationLabels: string[];
  actionLabels: string[];
  renderModes: string[];
  renderFps: number | null;
  renderMode: string | null;
  rewardRange: Num[] | null;
  wrappers: string[];
  sampleObservation: Encoded | null;
}

export interface SessionStatus {
  playing: boolean;
  speed: number;
  autoReset: boolean;
  episode: number;
  step: number;
  done: boolean;
  baseFps: number;
}

export interface AgentDesc {
  kind: 'random' | 'sb3';
  name: string;
  algorithm: string | null;
  path?: string;
  deterministic?: boolean;
}

export interface Hello {
  engineVersion: string;
  python: string;
  executable: string;
  platform: string;
  packages: Record<string, string | null>;
}

export interface EngineState {
  status: 'stopped' | 'starting' | 'ready' | 'error';
  python?: string;
  pythonSource?: string;
  hello?: Hello;
  error?: string;
}

export interface DetectedEnv {
  spec: string;
  label: string;
  kind: 'registered' | 'custom';
  file: string;
  line: number;
}

export interface ProjectInfo {
  frameworks: string[];
  environments: DetectedEnv[];
  algorithms: { name: string; file: string; line: number }[];
  trainingScripts: { file: string; line: number }[];
  models: { file: string; label: string; algorithm?: string }[];
  pythonFiles: number;
}

export interface EngineError {
  where: string;
  message: string;
  traceback: string;
  location: { file: string; line: number; function: string } | null;
}

export interface PanelCommand {
  tab?: 'arena' | 'inspector';
  env?: string;
  model?: string;
  autoLaunch?: boolean;
}

export interface Settings {
  defaultSeed: number;
  autoReset: boolean;
}
