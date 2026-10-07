import { useEffect, useRef, useState } from 'react';
import { ArenaView } from './arena/ArenaView';
import { useArena } from './arena/useArena';
import { EngineBanner } from './components/EngineBanner';
import { Roadmap } from './components/Roadmap';
import { FuzzerView } from './fuzzer/FuzzerView';
import { HealthView } from './health/HealthView';
import { InspectorView } from './inspector/InspectorView';
import { ReplayView } from './replay/ReplayView';
import { ProfileEntry, RewardsView } from './rewards/RewardsView';
import type { EngineState, PanelCommand, ProjectInfo, ReplayRequest, RewardProfile, Settings, TabId } from './types';
import { assets, notifyReady, onHostMessage, request } from './vscode';

const TABS: { id: TabId; label: string; soon?: boolean }[] = [
  { id: 'arena', label: '🎮 Arena' },
  { id: 'health', label: '🩺 Health' },
  { id: 'fuzzer', label: '🧨 Fuzzer' },
  { id: 'replay', label: '🎥 Replay' },
  { id: 'rewards', label: '🎯 Rewards' },
  { id: 'inspector', label: '🔍 Inspector' },
  { id: 'training', label: '📊 Training', soon: true },
];

export function App() {
  const [engine, setEngine] = useState<EngineState>({ status: 'starting' });
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [settings, setSettings] = useState<Settings>({ defaultSeed: 42, autoReset: true });
  const [tab, setTab] = useState<TabId>('arena');
  const [command, setCommand] = useState<{ seq: number; command: PanelCommand } | null>(null);
  const [registeredEnvs, setRegisteredEnvs] = useState<string[]>([]);
  const [profile, setProfile] = useState<ProfileEntry | null>(null);
  const arena = useArena();
  const seq = useRef(0);
  const dispatch = (c: PanelCommand) => {
    if (c.tab) setTab(c.tab);
    setCommand({ seq: ++seq.current, command: c });
  };
  const replay = (r: ReplayRequest) => dispatch({ tab: 'arena', replay: r });
  const onProfile = (envId: string, source: string, p: RewardProfile) => setProfile({ envId, source, profile: p });

  useEffect(() => {
    const off = onHostMessage((msg) => {
      switch (msg?.type) {
        case 'init':
          setEngine(msg.engine);
          setProject(msg.project ?? null);
          setSettings(msg.settings);
          break;
        case 'engineState':
          setEngine(msg.state);
          break;
        case 'project':
          setProject(msg.project ?? null);
          break;
        case 'command':
          dispatch(msg.command);
          break;
      }
    });
    notifyReady();
    return off;
  }, []);

  useEffect(() => {
    if (engine.status === 'ready' && engine.hello?.packages.gymnasium) {
      request<{ id: string }[]>('list_envs')
        .then((envs) => setRegisteredEnvs(envs.map((e) => e.id)))
        .catch(() => undefined);
    }
  }, [engine.status, engine.hello?.packages.gymnasium]);

  const hello = engine.hello;
  const forTab = (id: TabId) => (command?.command.tab === id ? command : null);
  const defaultEnv = arena.state.envId ?? project?.environments.find((e) => e.kind === 'custom')?.spec ?? null;
  const shown = (id: TabId) => ({ display: tab === id ? 'contents' : 'none' });

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          {assets.mark && <img src={assets.mark} alt="" className="brand-mark" />}
          <span className="brand-name">
            <span className="brand-rl">RL</span>Forge
          </span>
        </div>
        <nav className="tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`tab ${tab === t.id ? 'active' : ''} ${t.soon ? 'soon' : ''}`}
              onClick={() => setTab(t.id)}
              title={t.soon ? 'Coming soon' : undefined}
            >
              {t.label}
              {t.soon && <span className="soon-badge">soon</span>}
            </button>
          ))}
        </nav>
        <div
          className={`engine-pill engine-${engine.status}`}
          title={hello ? `${hello.executable}\n${Object.entries(hello.packages).map(([k, v]) => `${k}: ${v ?? 'not installed'}`).join('\n')}` : engine.error}
          onClick={() => void request('ui:showLog')}
        >
          <span className="dot" />
          {engine.status === 'ready' && hello
            ? `Python ${hello.python} · gymnasium ${hello.packages.gymnasium ?? '✗'}`
            : engine.status === 'starting'
              ? 'starting engine…'
              : 'engine offline'}
        </div>
      </header>

      <EngineBanner engine={engine} />

      <main className="content">
        <div style={shown('arena')}>
          <ArenaView
            arena={arena}
            project={project}
            settings={settings}
            command={forTab('arena') ?? (command && !command.command.tab ? command : null)}
            registeredEnvs={registeredEnvs}
            active={tab === 'arena'}
          />
        </div>
        <div style={shown('health')}>
          <HealthView
            project={project}
            registeredEnvs={registeredEnvs}
            settings={settings}
            command={forTab('health')}
            defaultEnv={defaultEnv}
            onReplay={replay}
            onNavigate={dispatch}
            onProfile={onProfile}
          />
        </div>
        <div style={shown('fuzzer')}>
          <FuzzerView
            project={project}
            registeredEnvs={registeredEnvs}
            settings={settings}
            command={forTab('fuzzer')}
            defaultEnv={defaultEnv}
            onReplay={replay}
            onProfile={onProfile}
          />
        </div>
        <div style={shown('replay')}>
          <ReplayView
            active={tab === 'replay'}
            refreshKey={arena.state.lastSaved?.at ?? 0}
            onReplay={replay}
            onOpenArena={() => setTab('arena')}
          />
        </div>
        <div style={shown('rewards')}>
          <RewardsView
            project={project}
            registeredEnvs={registeredEnvs}
            command={forTab('rewards')}
            defaultEnv={defaultEnv}
            latest={profile}
            onProfile={onProfile}
          />
        </div>
        {tab === 'inspector' && (
          <InspectorView
            project={project}
            command={command}
            registeredEnvs={registeredEnvs}
            currentEnv={arena.state.envId}
            onWatch={(env) => dispatch({ tab: 'arena', env, autoLaunch: true })}
          />
        )}
        {tab === 'training' && <Roadmap tab="training" />}
      </main>
    </div>
  );
}
