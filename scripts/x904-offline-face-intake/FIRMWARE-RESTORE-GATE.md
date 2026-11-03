# X904 firmware capability and biometric recovery gate

## Decision
NO-GO remains in force for sending face photos/templates to the sole production X904. The only installed device is serving Gym door access. Do not run any SDK write or export test against it.

Device context from the existing project handover: serial TDBD234200545, firmware ZMM510-NF24VB-Ver1.4.15, WDMS/PUSH path. No public vendor evidence found in this audit binds the specific firmware string to a supported UploadUserPhoto, SendUserFacePhoto, face-template import, or restore procedure.

## Findings
- Public WDMS documentation describes a general Bio-Photo enrollment/approval workflow and device-side features, but does not certify firmware ZMM510-NF24VB-Ver1.4.15 on serial TDBD234200545.
- The generic ZKTeco SDK manual describes UploadUserPhoto as a user-picture API for new-architecture firmware; that is not proof that this model/firmware implements it, nor proof that a user photo equals a biometric face template.
- Existing VMSC face baseline files are metadata snapshots only. Their records contain face status, length and (in two snapshots) SHA-256; they contain no raw template bytes and cannot restore a template.
- The checked backup locations did not reveal a X904 face-template backup/restore archive.
- The legacy x904-test-500-upload-photo-once.ps1 could call UploadUserPhoto on the production serial. It is now hard-blocked at the start of the file. The paired x904-test-500-readback-photo.ps1 download/export test is also hard-blocked.
- Both PowerShell files passed parser validation after the fail-closed block was inserted. Neither script was executed and no X904 command was sent.

## Required evidence before changing NO-GO
1. Written vendor confirmation naming the exact model, serial and firmware ZMM510-NF24VB-Ver1.4.15, separately confirming:
   - user Bio-Photo upload support;
   - biometric face-template enrollment/import support;
   - required file/template format, size, algorithm version and user-ID mapping;
   - whether the device is expected to use WDMS or standalone SDK for this workflow.
2. A vendor-supported export method that actually captures restorable biometric face-template data (not just photo files, face-status metadata or SHA-256 hashes), with manifest/version information.
3. Vendor-supported restore procedure and validation/rollback method.
4. Successful backup → restore → readback test on a spare X904 of the same model/firmware or a vendor-provided test unit. Do not use the only Gym production device as the first restore test.
5. After spare-device E2E passes, prepare an approved maintenance window and verified pre-change backup before considering any production change.

## Explicitly not sufficient
- A successful generic SDK UploadUserPhoto response.
- A DownloadUserPhoto JPEG.
- Equal face template length or equal SHA-256 values when no source template bytes are preserved.
- A read-only snapshot showing a template is present.
- A generic WDMS feature list that does not identify this firmware.

## Current device safety
- Keep X904_SEND_ENABLED=false.
- Do not install/upgrade firmware or test photo/template writes on production.
- Do not run the blocked scripts; they are intentionally fail-closed.
- Existing membership, check-in, access and suspend workers are not changed by this gate.
## Additional vendor-manual evidence (general WDMS 8.0.5, not firmware-specific)
The official ZKTeco Europe-hosted ZKBio WDMS User Manual (December 2021, software 8.0.5) documents:
- Bio-Photo registration via device QR/mobile capture and approval; after approval it can be used for visible-light face verification (manual section 5.7.1, printed page 57–58).
- Bio-Photo import using batch photos; filename must be employee ID and max photo size 25 KB (section 5.7.2, printed page 59).
- USB-format employee export/import; export can be imported back into a device/system and includes a selectable Face Version for the face template (sections 4.5.2–4.5.3, printed pages 30–31).
- WDMS PostgreSQL backup supports selecting photos, explicitly including bio-photos; manual restore has a “Restore photos” option (section 7.2.1, printed pages 77–78).

Source: https://zkteco.eu/sites/default/files/content/downloads/zkbio-wdms_user-manual.pdf

This is useful recovery guidance at the WDMS software level, but it does **not** establish:
- that X904 model serial TDBD234200545 with firmware ZMM510-NF24VB-Ver1.4.15 is supported as a visible-light device by this WDMS build;
- that the WDMS photo workflow writes a biometric template to this X904 (the manual distinguishes Bio-Photo from Bio-Template);
- the required Face Version, algorithm compatibility, or exact X904 transfer method;
- that a WDMS/PostgreSQL backup currently exists for this deployment, or that restore on the same device model/firmware is successful.

Therefore the manual documents plausible vendor tooling for backup/restore, but NO-GO remains until ZKTeco confirms this exact model/firmware and a spare same-version device proves the complete backup → restore → face readback. Never experiment on the sole production door controller.
