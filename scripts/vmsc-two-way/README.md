# VMSC bidirectional control — DEV staging only

This branch provides a safe, isolated command-queue schema and worker transport contract.
It does **not** enable production command execution.

Transport proposal: authenticated outbound HTTPS polling from VMSC to a scoped DEV gateway.
Command lifecycle: queued -> claimed -> completed/failed/expired.
Worker may accept ONLY read-only `device_info` and `clock_read` commands.
A claim ACK is not a result ACK. Completion requires device response, receipt persisted
in a separate table, and acknowledgement read-back by the server.

Required before enabling:
1. Implement authenticated DEV API (GET claim, POST result), transactional row locking
   with SKIP LOCKED and lease fencing; validate per-worker credential and command UUID.
2. Use dedicated scoped secrets, not legacy LAN ingest key; do not log secrets.
3. Confirm X904 read-only operation semantics on VMSC; test with emulator/mock first.
4. Run DEV tests for duplicate polls, expiry, callback replay, worker restart and failed reads.
5. Keep physical access control, user changes, deletes, clock-setting, and PROD disabled.
6. Obtain separate approval before introducing any device state-changing capability.
