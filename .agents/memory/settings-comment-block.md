---
name: Settings comment block
description: The Settings page contains an intentionally disabled duplicate JSX copy.
---

When retaining the disabled duplicate Settings JSX copy, its outer block comment must remain open through EOF; JSX comment markers inside that copy must not contain a literal `*/`.

**Why:** A nested JSX comment can close the outer JavaScript block comment early, making Vite report a misleading syntax error at the first JSX element that follows.

**How to apply:** If Settings.tsx reports an unexpected token in the later duplicate section, inspect the outer comment boundary and every `*/` inside the disabled copy before changing active UI markup.