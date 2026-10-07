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
  mode?: 'uniform' | 'policy' | 'q' | 'scripted';
  replayed?: boolean;
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
  recording?: boolean;
  replay?: boolean;
}

export interface AgentDesc {
  kind: 'random' | 'sb3' | 'replay';
  name: string;
  algorithm: string | null;
  path?: string;
  deterministic?: boolean;
  totalSteps?: number;
}

/** Action sequences are JSON: numbers/bools or {nd: [...], dtype} for arrays. */
export type JsonAction = unknown;

export interface ExceptionInfo {
  type: string;
  message: string;
  traceback: string;
  location: { file: string; line: number; function: string } | null;
}

export interface Evidence {
  seed: number;
  episode: number;
  step: number;
  actions: JsonAction[];
  signature: string;
}

export interface HealthCheck {
  id: string;
  title: string;
  status: 'pass' | 'warn' | 'fail' | 'info' | 'skip';
  detail: string;
  evidence?: Evidence | null;
  exception?: ExceptionInfo | null;
  count?: number;
  messages?: string[];
}

export interface Histogram {
  counts: number[];
  edges: number[];
}

export interface RewardProfile {
  steps: number;
  invalid: number;
  min?: number;
  max?: number;
  mean?: number;
  std?: number;
  positive?: number;
  negative?: number;
  zero?: number;
  distinct?: number | null;
  topValues?: { value: number; count: number; share: number }[];
  sparsity?: number;
  histogram?: Histogram;
  episodes?: number;
  returnMean?: number;
  returnStd?: number;
  returnMin?: number;
  returnMax?: number;
  lengthMean?: number;
  lengthMax?: number;
  returnHistogram?: Histogram;
}

export interface HealthReport {
  envId: string;
  seed: number;
  score: number;
  checks: HealthCheck[];
  inspection?: Inspection | null;
  rewardProfile?: RewardProfile;
  frame?: Frame;
  stats?: { episodes: number; steps: number; stepsPerSecond: number; seconds: number; cancelled: boolean };
}

export interface FuzzGroup {
  signature: string;
  code: string;
  level: 'critical' | 'warning';
  message: string;
  exception: ExceptionInfo | null;
  count: number;
  episodes: { episode: number; seed: number; step: number }[];
  seed: number;
  episode: number;
  step: number;
  actions: JsonAction[];
  minimalActions?: JsonAction[];
  reproducible?: boolean;
}

export interface FuzzTotals {
  episodes: number;
  steps: number;
  valid: number;
  suspicious: number;
  failed: number;
  crashed: number;
  capped: number;
}

export interface FuzzReport {
  envId: string;
  seed: number;
  strategy: string;
  maxSteps: number;
  requestedEpisodes: number;
  totals: FuzzTotals;
  seconds: number;
  stepsPerSecond: number;
  cancelled: boolean;
  groups: FuzzGroup[];
  rewardProfile: RewardProfile;
}

export interface JobProgress {
  stage: string;
  fraction: number;
  groups?: number;
  [key: string]: unknown;
}

export interface RecordingMeta {
  path: string;
  size: number;
  envId: string;
  kwargs?: Record<string, unknown> | null;
  seed: number | null;
  episode: number;
  agent: AgentDesc;
  return: Num;
  length: number;
  terminated: boolean;
  truncated: boolean;
  complete: boolean;
  anomalies: number;
  createdAt: number;
}

export interface ReplayRequest {
  path?: string;
  env?: string;
  seed?: number;
  actions?: JsonAction[];
  label?: string;
  stopAt?: number;
  signature?: string;
  kind?: string;
}

export interface ReplayInfo {
  label: string;
  seed: number | null;
  steps: number;
  stopAt: number | null;
  source: { kind: string; path?: string; name?: string; signature?: string };
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

export type TabId = 'arena' | 'inspector' | 'health' | 'fuzzer' | 'replay' | 'rewards' | 'training';

export interface PanelCommand {
  tab?: TabId;
  env?: string;
  model?: string;
  autoLaunch?: boolean;
  /** Start the tab's main action immediately (health check / fuzz run). */
  run?: boolean;
  replay?: ReplayRequest;
}

export interface Settings {
  defaultSeed: number;
  autoReset: boolean;
}
