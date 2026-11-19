---
name: react-ui-accessibility
description: Audit and implement modern accessible HTML, CSS dark mode, semantic dialogs, keyboard focus management, and responsive tables for web interfaces. Use when building modals, navigation bars, tables, or checking ARIA compliance. Do NOT use for SQL migrations or backend API servers.
license: MIT
---

# Modern Accessible UI Guidelines

## Checklist

- Prefer native `<dialog>`, `<details>`, and `popover` primitives before custom JS overlays.
- Support both light and dark modes via `color-scheme: light dark` and `light-dark()`.
- Ensure every interactive button and landmark carries an accessible name and visible focus indicator.
