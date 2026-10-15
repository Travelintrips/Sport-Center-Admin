# X904 ALMANO temporary PROD autosync

## Purpose and prerequisites

This is a bounded fallback while direct VPS authenticated X904 reading is not ready. It runs on ALMANO with existing Windows DPAPI-protected credentials. It reads the physical X904, never copies DEV database rows into PROD. ALMANO must remain on, online and logged into its existing Windows user session. No changes to biometric templates, doors, user enrollments, access rights, or the machine's IP.

- Machine: 192.168.100.185 TCP/4370, serial TDBD234200545.
- Target: PROD Supabase nzdweipzckfszczzqtuw; PROD-only X904 LAN Edge function.
- Versioned source: scripts/x904-almano-prod-autosync.ps1.
- Install source on ALMANO: LocalAppData/GymCST/X904/tunnel/Run-X904-ProdAutoSync.ps1.
- Existing protected manual connector: LocalAppData/GymCST/X904/probe/x904-almano-prod-runner.ps1.
- Windows Scheduled Task: GymCST_X904_ProdAutoSync; triggered when the ALMANO user logs in.
- Secure relay task: GymCST_X904_SecureRelay; independent from PROD autosync.

## Execution policy

1. Every 30 minutes, perform an authenticated read-only physical X904 count probe.
2. When machine counts match the most recent durable database ACK and its age is less than 24h, skip the full upload.
3. When counts have changed or durable ACK is at least 24h old, send a complete physical snapshot to PROD only.
4. Mark local success only after the PROD Edge verifies every stored user/event count and returns durable_database_ack=true.
5. Retry transient device reads or transfers up to 3 times, waiting 15 seconds between attempts, then back off 30 minutes. Do not repeatedly hammer the machine.
6. Fail closed on unexpected log-count regression; never clear device logs.
7. Avoid duplicate task instances using a mutex and Windows Task Scheduler single-instance setting.
8. Log only stage identifiers and aggregate counts, never credentials, PINs, names, fingerprints or device templates.

## Control commands (run locally on ALMANO)

View status:
Get-ScheduledTask -TaskName GymCST_X904_ProdAutoSync,GymCST_X904_SecureRelay

View logs:
Get-Content (Join-Path $env:LOCALAPPDATA 'GymCST\X904\tunnel\x904-prod-autosync.log') -Tail 20

Pause autosync, preserving secure tunnel:
Stop-ScheduledTask -TaskName GymCST_X904_ProdAutoSync
Disable-ScheduledTask -TaskName GymCST_X904_ProdAutoSync

Resume autosync:
Enable-ScheduledTask -TaskName GymCST_X904_ProdAutoSync
Start-ScheduledTask -TaskName GymCST_X904_ProdAutoSync

Manual one-off authenticated physical sync:
& (Join-Path $env:LOCALAPPDATA 'GymCST\X904\probe\x904-almano-prod-runner.ps1') -Sync

## Acceptance

PROD E2E PASS requires a real authenticated physical machine read, complete durable ACK from the PROD ingestion endpoint, exactly matching live machine user/log totals in sport_center.gym_x904_lan_state with no pending users/events. Web API health alone is insufficient.

The VPS currently reaches the physical X904 protocol through an SSH reverse relay bound only to VPS loopback 127.0.0.1:14370; a machine response requiring authentication was verified, including reconnection after SSH interruption. This establishes *network connectivity*, not an authenticated VPS-only snapshot. No direct VPS-only E2E should be claimed until it has passed with secure device credential provisioning.

For truly ALMANO-free operation, install a dedicated always-on encrypted gateway or confirm and configure direct ADMS/Push on the physical machine. Never expose TCP/4370 to the public internet.
