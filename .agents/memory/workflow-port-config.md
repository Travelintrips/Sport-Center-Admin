---
name: Workflow waitForPort config
description: restart_workflow tool fails DIDNT_OPEN_A_PORT if workflow lacks explicit waitForPort; fix via configureWorkflow.
---

## Rule
`restart_workflow` tool can fail with "DIDNT_OPEN_A_PORT" even when the server clearly opened the port (visible in logs). This happens when the workflow is not explicitly configured with `waitForPort`.

**Why:** Replit's port detection in the restart_workflow path requires `waitForPort` to be set in the workflow config. Without it, the tool times out and sends SIGTERM/SIGKILL, killing the running server. Repeated calls make it worse (each kill → restart → kill cycle).

**How to apply:**
- Fix via code_execution: `await configureWorkflow({ name: "Start API server", command: "...", waitForPort: 8080, outputType: "console", autoStart: true })`
- "Start API server" uses port 8080, outputType "console" (not "webview" — webview requires port 5000)
- After configureWorkflow, the workflow shows RUNNING status correctly
- Don't call restart_workflow multiple times — each call kills the running instance
