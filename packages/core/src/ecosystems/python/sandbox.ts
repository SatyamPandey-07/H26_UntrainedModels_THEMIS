import { dirname, join } from "node:path";
import { shellQuote } from "../../evidence/command.js";
import type { Toolchain } from "../../schema/stages.js";
import { findSkillsDir } from "../../skills/loader.js";
import { discoverRequirementsFiles } from "./requirements.js";

/** Interpreter minor version for the sandbox image; the project's minimum is the safest compatible guess. */
export function pythonImageVersion(pythonVersion: string | undefined): string {
  const m = /(\d+)\.(\d+)/.exec(pythonVersion ?? "");
  if (m && Number(m[1]) === 3 && Number(m[2]) >= 8 && Number(m[2]) <= 14) return `${m[1]}.${m[2]}`;
  return "3.12";
}

function installFiles(dir: string): string[] {
  return discoverRequirementsFiles(dir).filter((f) => /^[\w./-]+$/.test(f) && !/constraint/i.test(f));
}

/** Dockerfile and build arguments for the Python sandbox image of an exported commit. */
export function pythonBuildSpec(
  toolchain: Toolchain,
  exportDir: string,
): { dockerfile: string; buildArgs: string[] } {
  return {
    dockerfile: join(dirname(findSkillsDir()), "docker", "sandbox-python.Dockerfile"),
    buildArgs: [
      "--build-arg",
      `PYTHON_VERSION=${pythonImageVersion(toolchain.pythonVersion)}`,
      "--build-arg",
      `REQ_FILES=${installFiles(exportDir).join(" ")}`,
      "--build-arg",
      `EXTRA_PIP=${toolchain.testRunner === "pytest" ? "pytest" : ""}`,
    ],
  };
}

/** Host-runner install: a virtualenv inside the exported directory (no isolation, so the capsule says so). */
export function pythonHostInstall(dir: string, toolchain: Toolchain): string {
  const reqs = installFiles(dir)
    .map((f) => `-r ${shellQuote(f)}`)
    .join(" ");
  const extra = toolchain.testRunner === "pytest" ? " pytest" : "";
  const packages = `${reqs}${extra}`.trim();
  return packages
    ? `python3 -m venv .venv && .venv/bin/python -m pip install --disable-pip-version-check ${packages}`
    : "python3 -m venv .venv";
}

/** Python client run inside a container to send probe requests; prints the same THEMIS_PROBES line as Node's. */
export const PYTHON_PROBE_SCRIPT = `
import json, sys, time, urllib.request, urllib.error
base, raw = sys.argv[1], sys.argv[2]
reqs = json.loads(raw)
def up():
    try:
        urllib.request.urlopen(base, timeout=2)
        return True
    except urllib.error.HTTPError:
        return True
    except Exception:
        return False
for _ in range(60):
    if up():
        break
    time.sleep(1)
out = []
for r in reqs:
    data = json.dumps(r["body"]).encode() if r.get("body") is not None else None
    headers = {"content-type": "application/json"} if data else {}
    req = urllib.request.Request(base + r["path"], data=data, headers=headers, method=r["method"])
    try:
        with urllib.request.urlopen(req, timeout=15) as res:
            status, body = res.status, res.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        status, body = e.code, e.read().decode("utf-8", "replace")
    except Exception as e:
        status, body = 0, "request failed: " + str(e)
    out.append({"method": r["method"], "path": r["path"], "status": status, "body": body[:20000]})
print("THEMIS_PROBES " + json.dumps(out))
`;
