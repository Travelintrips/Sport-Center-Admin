# Sport Center DEV working guidance

Read the [CST Global Development SOP v1.0.0](https://github.com/Travelintrips/Core-AI-Foundation/blob/develop/CST-GLOBAL-DEVELOPMENT-SOP.md) before classifying a job. Record its version and source commit in the job checkpoint alongside the application commit and evidence.

Reuse existing Sport Center booking, payments, reconciliation, and X904 flows. Check the prior evidence before selecting regression tests. Test changes on the actual DEV runtime with QA data. Keep live WhatsApp delivery, real payment effects, and physical X904 commands outside DEV tests unless separately authorized. A mocked device acknowledgment or scan is evidence for the simulated path.

Use the repository's existing CI and DEV release workflow for changes that require them. Record the deployed SHA and runtime results separately from CI. Production changes require explicit owner approval.
