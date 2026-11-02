# Android physical network trace — X904 offline photo preview

Status: harness prepared on the DELL workstation; physical capture not yet run because ADB currently lists zero connected Android devices.

## Safety and scope
- The harness opens the public standalone preview and generates a deterministic synthetic JPEG inside the Android Chrome page.
- It does not select a real gallery photo, upload photo bytes, contact X904, or use the Supabase database.
- The JSON trace stores request URL/method/type/response status and POST-body byte length only. It does not store request bodies, cookies, headers, or photo bytes.
- The raw.githack interstitial may produce provider requests before the preview document is opened. The decisive field is requestsDuringLocalFileValidationCount, measured after the preview page is ready.

## One-time physical setup
1. Connect the Android phone by USB to the DELL PC.
2. On Android, enable Developer options and USB debugging.
3. Approve the “Allow USB debugging” prompt for this DELL.
4. Open Chrome on Android. Leave the device unlocked.

## Capture
Run on DELL PowerShell:

~~~powershell
powershell -ExecutionPolicy Bypass -File "$env:USERPROFILE\Documents\Capture-X904-Android-NetworkTrace.ps1"
~~~

The capture scripts are already staged on DELL:
- %USERPROFILE%\Documents\Capture-X904-Android-NetworkTrace.ps1
- %USERPROFILE%\Documents\x904-android-network-trace.cjs

Expected result:
- STAGED_OFFLINE_ONLY
- requestsDuringLocalFileValidationCount = 0
- output JSON saved under Documents as X904-Android-NetworkTrace-*.json

If ADB reports no device, do not continue; approve USB debugging or reconnect the cable. No VPS login is needed.