import { useEffect, useRef, useState } from 'react';
import { ArenaView } from './arena/ArenaView';
import { useArena } from './arena/useArena';
import { EngineBanner } from './components/EngineBanner';
import { Roadmap, RoadmapTab } from './components/Roadmap';
import { InspectorView } from './inspector/InspectorView';
import type { EngineState, PanelCommand, ProjectInfo, Settings } from './types';
import { assets, notifyReady, onHostMessage, request } from './vscode';

type Tab = 'arena' | 'inspector' | RoadmapTab;

const TABS: { id: Tab; label: string; soon?: boolean }[] = [
  { id: 'arena', label: '🎮 Arena' },
  { id: 'inspector', label: '🔍 Inspector' },
  { id: 'training', label: '📊 Training', soon: true },
  { id: 'replay', label: '🎥 Replay', soon: true },
  { id: 'fuzzer', label: '🧪 Fuzzer', soon: true },
  { id: 'rewards', label: '🎯 Rewards', soon: true },
];

export function App() {
  const [engine, setEngine] = useState<EngineState>({ status: 'starting' });
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [settings, setSettings] = useState<Settings>({ defaultSeed: 42, autoReset: true });
  const [tab, setTab] = useState<Tab>('arena');
  const [command, setCommand] = useState<{ seq: number; command: PanelCommand } | null>(null);
  const [registeredEnvs, setRegisteredEnvs] = useState<string[]>([]);
  const arena = useArena();
  const seq = useRef(0);
  const dispatch = (c: PanelCommand) => {
    if (c.tab) setTab(c.tab);
    setCommand({ seq: ++seq.current, command: c });
  };

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
        <div style={{ display: tab === 'arena' ? 'contents' : 'none' }}>
          <ArenaView
            arena={arena}
            project={project}
            settings={settings}
            command={command?.command.tab !== 'inspector' ? command : null}
            registeredEnvs={registeredEnvs}
            active={tab === 'arena'}
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
        {tab !== 'arena' && tab !== 'inspector' && <Roadmap tab={tab} />}
      </main>
    </div>
  );
}
