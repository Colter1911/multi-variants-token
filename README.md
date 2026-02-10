# Multi Token Art (Foundry VTT v13)

Foundry VTT v13 module scaffold for managing multiple token and portrait images.

## Canonical design document

Use `multi-tokenart-spec.md` as the primary source of truth for architecture and feature behavior.

## Current status

Implemented baseline:
- Module manifest + localization.
- ESM hook entrypoint.
- DataModel structures for actor flags.
- ApplicationV2 manager skeleton and settings panel.
- Core logic baseline for random, auto-activation, auto-rotate, dynamic ring.
- Utilities for flags, HP resolver, and file handling.

Remaining roadmap work should be tracked directly against `multi-tokenart-spec.md`.
