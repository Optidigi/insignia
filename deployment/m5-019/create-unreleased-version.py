"""One-shot, no-build/no-release CLI dispatch after the frozen M5-019 gate."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tomllib

CANONICAL = Path("/home/serveradmin/insignia-m5-019-handoff/version-run")
NODE = Path("/home/serveradmin/.local/opt/node-v24.21.0-linux-x64/bin/node")
CLI = Path("/home/serveradmin/insignia-pf001-tools/shopify/node_modules/@shopify/cli/bin/run.js")


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def durable_new(path, value):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as file:
        json.dump(value, file, indent=2)
        file.write("\n")
        file.flush()
        os.fsync(file.fileno())
    fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


gate_path = Path(sys.argv[1]).resolve()
gate = json.loads(gate_path.read_text())
source = Path(gate["worktree"]).resolve()
assert gate["slice"] == "M5-019" and gate["frozen"] is True
assert gate["versionTag"] == "m5-019-" + gate["sourceHead"][:12]
assert subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=source, text=True).strip() == gate["sourceHead"]
assert not subprocess.check_output(["git", "status", "--porcelain"], cwd=source, text=True)
assert gate["hostClassification"] == "HOST_WEB_READINESS_PASS"
assert gate["activeVersion"] == "1153019904001"
assert len(gate["reviews"]) == 2 and all(review["verdict"] == "CLEAR" for review in gate["reviews"])
for review in gate["reviews"]:
    settings = json.loads(Path(review["settings"]).read_text())
    assert settings["head"] == gate["sourceHead"]
    assert settings["actualTurnContexts"] and all(
        row["model"] == "gpt-6.1-sol" and row["effort"] == "high"
        and row["sandbox_policy"]["type"] == "read-only" and row["approval_policy"] == "never"
        for row in settings["actualTurnContexts"]
    )
assert len(gate["ci"]) == gate["applicableWorkflowCount"] == 10
assert all(row["headSha"] == gate["sourceHead"] and row["conclusion"] == "success" and row["status"] == "completed" for row in gate["ci"])
for row in gate["files"]:
    assert digest(Path(row["path"])) == row["sha256"], "frozen_file_changed"
candidate = Path(gate["candidateDirectory"]).resolve()
config = tomllib.loads((candidate / "shopify.app.m5-019.toml").read_text())
assert config == tomllib.loads((source / "deployment/m5-019/shopify.app.m5-019.toml").read_text())
assert config["client_id"] == "1443cf6d03d39edae7c101a943c5c684"
assert subprocess.check_output([str(NODE), "--version"], text=True).strip() == "v24.21.0"
assert json.loads((CLI.parent.parent / "package.json").read_text())["version"] == "4.8.2"
assert not Path("/home/serveradmin/.local/share/@shopify/cli/package.json").exists(), "external_plugin_registry_changed"

CANONICAL.mkdir(mode=0o700, exist_ok=True)
assert not CANONICAL.is_symlink() and CANONICAL.stat().st_uid == os.getuid()
assert CANONICAL.stat().st_mode & 0o777 == 0o700
# O_EXCL reservation persists even on a crash/timeout/known failure. No resume
# path dispatches another creation command, and no release command exists here.
durable_new(CANONICAL / "creation-reservation.json", {
    "sourceHead": gate["sourceHead"], "gateSha256": digest(gate_path),
    "attempt": 1, "ceiling": 1, "noBuild": True, "noRelease": True,
    "versionTag": gate["versionTag"],
})
environment = {key: os.environ[key] for key in ["HOME", "PATH", "LANG", "LC_ALL", "TZ", "TERM"] if key in os.environ}
environment.update({"CI": "1", "SHOPIFY_CLI_NO_ANALYTICS": "1"})
arguments = [str(NODE), str(CLI), "app", "deploy", "--path", str(candidate),
             "--config", "m5-019", "--no-build", "--no-release",
             "--version", gate["versionTag"], "--no-color"]
with (CANONICAL / "cli-output.private.log").open("x") as output:
    os.chmod(output.name, 0o600)
    process = subprocess.Popen(arguments, cwd=candidate, env=environment,
                               stdin=subprocess.DEVNULL, stdout=output,
                               stderr=subprocess.STDOUT, start_new_session=True)
    try:
        exit_code = process.wait(timeout=300)
        result = {"dispatches": 1, "exit": exit_code,
                  "outcome": "CLI_COMPLETED_READBACK_REQUIRED" if exit_code == 0 else "STOPPED_NO_RETRY"}
    except subprocess.TimeoutExpired:
        import signal
        os.killpg(process.pid, signal.SIGTERM)
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()
        result = {"dispatches": 1, "outcome": "AMBIGUOUS_TIMEOUT_NO_RETRY"}
durable_new(CANONICAL / "dispatch-result.json", result)
print(json.dumps(result))
