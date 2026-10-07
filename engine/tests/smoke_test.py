"""End-to-end smoke test: spawns the engine and drives it through the JSON protocol.

Run from the repository root:  python engine/tests/smoke_test.py [path/to/sb3_model.zip]
"""

from __future__ import annotations

import json
import os
import queue
import subprocess
import sys
import threading
import time

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ENGINE = os.path.join(ROOT, "engine")


class Engine:
    def __init__(self) -> None:
        env = dict(os.environ, PYTHONPATH=ENGINE, PYTHONUNBUFFERED="1", PYTHONIOENCODING="utf-8")
        self.proc = subprocess.Popen(
            [sys.executable, "-m", "rlforge_engine"],
            cwd=ROOT,
            env=env,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
        )
        self.messages: queue.Queue = queue.Queue()
        self.events: list[dict] = []
        self.next_id = 1
        threading.Thread(target=self._read, daemon=True).start()
        threading.Thread(target=self._drain_stderr, daemon=True).start()

    def _read(self) -> None:
        for line in self.proc.stdout:
            msg = json.loads(line)
            if "event" in msg:
                self.events.append(msg)
            else:
                self.messages.put(msg)

    def _drain_stderr(self) -> None:
        for line in self.proc.stderr:
            sys.stderr.write("[engine] " + line)

    def request(self, cmd: str, **args):
        req_id = self.next_id
        self.next_id += 1
        self.proc.stdin.write(json.dumps({"id": req_id, "cmd": cmd, "args": args}) + "\n")
        self.proc.stdin.flush()
        msg = self.messages.get(timeout=60)
        assert msg["id"] == req_id, msg
        if not msg["ok"]:
            raise RuntimeError(msg["error"] + "\n" + msg.get("traceback", ""))
        return msg.get("result")

    def wait_for(self, event: str, count: int = 1, timeout: float = 10.0) -> list[dict]:
        deadline = time.time() + timeout
        while time.time() < deadline:
            found = [e for e in self.events if e["event"] == event]
            if len(found) >= count:
                return found
            time.sleep(0.02)
        raise TimeoutError(f"Timed out waiting for {count}x {event}; got {[e['event'] for e in self.events][-20:]}")

    def close(self) -> None:
        self.proc.stdin.write(json.dumps({"cmd": "shutdown"}) + "\n")
        self.proc.stdin.flush()
        self.proc.wait(timeout=10)


def main() -> None:
    model = sys.argv[1] if len(sys.argv) > 1 else None
    eng = Engine()
    try:
        hello = eng.request("hello")
        print("hello:", hello["python"], hello["packages"])

        envs = eng.request("list_envs")
        print("registered envs:", len(envs))
        assert any(e["id"] == "CartPole-v1" for e in envs)

        insp = eng.request("inspect", env="CartPole-v1")
        assert insp["actionSpace"]["type"] == "Discrete" and insp["actionSpace"]["n"] == 2
        assert insp["observationSpace"]["shape"] == [4]
        assert insp["renderMode"] == "rgb_array"
        print("inspect ok:", insp["envClass"], insp["observationLabels"])

        res = eng.request("load", env="CartPole-v1", seed=7, agent={"kind": "random"}, autoReset=False)
        sid = res["sessionId"]
        reset = eng.wait_for("reset")[0]["data"]
        assert reset["sessionId"] == sid and reset["seed"] == 7
        assert reset["frame"]["kind"] == "image" and reset["frame"]["src"].startswith("data:image/")
        print("reset ok: frame", reset["frame"]["width"], "x", reset["frame"]["height"])

        eng.request("step", count=3)
        steps = eng.wait_for("step", 3)
        s = steps[-1]["data"]
        assert s["step"] == 3 and s["actionInfo"]["type"] == "discrete" and len(s["actionInfo"]["probs"]) == 2
        print("manual steps ok: reward", s["reward"], "total", s["totalReward"])

        eng.request("set_speed", speed=20)
        eng.request("play")
        eng.wait_for("episode_end", 1, timeout=30)
        end = [e for e in eng.events if e["event"] == "episode_end"][0]["data"]
        print("episode_end ok:", end)
        eng.request("reset")
        assert eng.wait_for("reset", 2)[-1]["data"]["episode"] == 2

        insp2 = eng.request("inspect", env="examples/custom_env/grid_world_env.py:BuggyGridWorldEnv")
        print("custom env inspect ok:", insp2["envClass"], insp2["actionLabels"] or insp2["actionSpace"]["repr"])
        eng.request("load", env="examples/custom_env/grid_world_env.py:BuggyGridWorldEnv", seed=0, agent={"kind": "random"})
        eng.request("set_speed", speed=20)
        eng.request("play")
        deadline = time.time() + 20
        flagged = None
        while time.time() < deadline and flagged is None:
            for e in list(eng.events):
                if e["event"] == "step" and e["data"]["anomalies"]:
                    flagged = e["data"]
                    break
            time.sleep(0.05)
        assert flagged, "expected anomalies from BuggyGridWorldEnv"
        print("anomaly detection ok:", flagged["anomalies"][0]["message"])
        eng.request("pause")

        if model:
            eng.events.clear()
            res = eng.request("load", env="CartPole-v1", seed=1, agent={"kind": "sb3", "path": model}, autoReset=False)
            print("sb3 agent:", res["agent"])
            eng.wait_for("reset")
            eng.request("step", count=5)
            s = eng.wait_for("step", 5)[-1]["data"]
            print("sb3 action info:", s["actionInfo"])
            assert s["actionInfo"].get("mode") == "policy" and "value" in s["actionInfo"]

        # ---- recording + replay
        eng.events.clear()
        eng.request("load", env="CartPole-v1", seed=11, agent={"kind": "random"}, autoReset=False, record=True)
        eng.wait_for("reset")
        eng.request("set_speed", speed=20)
        eng.request("play")
        saved = eng.wait_for("episode_saved", timeout=30)[0]["data"]
        print("recording saved:", os.path.basename(saved["path"]), "return", saved["meta"]["return"])
        recs = eng.request("list_recordings")["recordings"]
        assert any(r["path"] == saved["path"] for r in recs)

        eng.events.clear()
        res = eng.request("load", replay={"path": saved["path"]})
        assert res["replay"]["steps"] > 0
        eng.wait_for("reset")
        eng.request("set_speed", speed=20)
        eng.request("play")
        end = eng.wait_for("episode_end", timeout=30)[0]["data"]
        diverged = [a for e in eng.events if e["event"] == "step" for a in e["data"]["anomalies"]
                    if a["code"] == "replay_divergence"]
        assert end["return"] == saved["meta"]["return"], (end, saved["meta"])
        assert not diverged, diverged
        print("replay ok: identical return", end["return"], "with no divergence")
        eng.request("unload")
        eng.request("delete_recording", path=saved["path"])

        # ---- health check
        def run_job(cmd: str, timeout: float = 120, **args) -> dict:
            job = eng.request(cmd, **args)
            deadline = time.time() + timeout
            while time.time() < deadline:
                for e in list(eng.events):
                    if e["event"] in ("job_done", "job_failed") and e["data"]["jobId"] == job["jobId"]:
                        assert e["event"] == "job_done", e["data"]
                        return e["data"]["result"]
                time.sleep(0.05)
            raise TimeoutError(cmd)

        report = run_job("start_health", env="CartPole-v1", seed=0, stepBudget=2000)
        statuses = {c["id"]: c["status"] for c in report["checks"]}
        print("health CartPole:", report["score"], statuses)
        assert statuses["crashes"] == "pass" and statuses["determinism"] == "pass" and report["score"] >= 80

        buggy = run_job("start_health", env="examples/custom_env/grid_world_env.py:BuggyGridWorldEnv", seed=0, stepBudget=2000)
        bstat = {c["id"]: c["status"] for c in buggy["checks"]}
        print("health BuggyGridWorld:", buggy["score"], bstat)
        assert bstat["nan_inf"] == "fail" and buggy["score"] < report["score"]

        # ---- fuzzer + minimisation + replay of the failure
        fz = run_job("start_fuzz", env="examples/custom_env/grid_world_env.py:BuggyGridWorldEnv",
                     episodes=200, maxSteps=200, seed=0)
        print("fuzz totals:", fz["totals"], "groups:", [(g["signature"], g["count"], len(g["actions"]),
                                                          len(g.get("minimalActions") or [])) for g in fz["groups"]])
        nan = next(g for g in fz["groups"] if g["code"] == "nan_observation")
        assert nan["reproducible"] and len(nan["minimalActions"]) <= len(nan["actions"])

        eng.events.clear()
        eng.request("load", replay={"env": "examples/custom_env/grid_world_env.py:BuggyGridWorldEnv",
                                    "seed": nan["seed"], "actions": nan["minimalActions"], "label": "NaN failure"})
        eng.wait_for("reset")
        eng.request("play")
        eng.wait_for("status", 1)
        deadline = time.time() + 15
        hit = None
        while time.time() < deadline and hit is None:
            hit = next((e["data"] for e in eng.events if e["event"] == "step"
                        and any(a["code"] == "nan_observation" for a in e["data"]["anomalies"])), None)
            time.sleep(0.05)
        assert hit, "replaying the minimised failure should reproduce the NaN"
        print("failure replay ok: NaN reproduced at step", hit["step"])

        print("\nALL SMOKE TESTS PASSED")
    finally:
        eng.close()


if __name__ == "__main__":
    main()
