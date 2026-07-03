# Foundry v14 Compatibility and CSS Isolation Plan

## Context

- Current module targets Foundry VTT `13.351`; `module.json` has `compatibility.minimum = "13"` and `verified = "13"`.
- Foundry v14 stable is available; latest researched build is `14.364`, first stable was `14.359`.
- Official v14 API docs are available, but the Foundry migration article page does not yet list a dedicated v14 migration guide. Use release notes plus API docs as source material.
- The worktree is already dirty in relevant files (`CONTEXT.md`, localization, `MultiTokenArtManager.mjs`, `AutoActivation.mjs`, `module.mjs`, etc.). Do not revert unrelated existing changes.
- There is no `package.json`, no test files, and no local automated test runner discovered. Validation must be mostly manual in Foundry.

## Goals

1. Support Foundry v14 while preserving Foundry v13 behavior.
2. Keep `compatibility.minimum` at `13`; update `verified` to `14` only after compatibility changes are implemented and manually checked.
3. Adapt only module-touched surfaces affected by v14: Active Effects V2, ApplicationV2/header controls, Token/Dynamic Ring updates, FilePicker resolution, active GM detection, and CSS inheritance.
4. Reduce system-specific UI drift using a scoped CSS reset inside module windows, not Shadow DOM and not a global hard reset.

## v14 Research Findings Relevant To This Module

- Active Effects V2 changed effect data significantly: release notes mention `ActiveEffect#changes` migration to `ActiveEffect#system#changes`, `EffectChangeData#value` deserialization, `mode` migrating to string `type`, token-targeted Active Effects, and primary ActiveEffect documents/compendiums.
- Active Effects can now modify Token properties, including images. This overlaps with the module's existing external token image override guard.
- Header controls and context menu APIs were unified; the current module only handles header controls as arrays and then relies on DOM fallback.
- ApplicationV2 gained pop-out support; dialogs and FilePicker can run in detached windows. Current code uses ApplicationV2 for the main app, legacy `Dialog` for manual token and first-run dialogs, and global `FilePicker` directly.
- `TextureData` removed unused `offsetX/Y` and `rotation`. The module uses `texture.src`, `texture.scaleX`, and `texture.scaleY`, which should remain relevant.
- Dynamic Token Ring is still present in v14, with a v14 bugfix specifically mentioning a Dynamic Ring black-dot issue. The module currently writes whole `ring` objects, which is riskier across schema extensions.
- Font Awesome moved to 7.2.0 by v14 stable. Existing `fas fa-masks-theater` should be manually checked; if missing, replace with a stable FA class or a text/icon fallback.
- Core theme/color-scheme and custom element styling changed in v14, strengthening the need for scoped module control styles.

## Implementation Tasks

### 1. Add small compatibility helpers

Create helpers in the smallest appropriate existing files; avoid a broad architecture change unless reuse clearly justifies it.

- Active Effect changes helper, likely in `scripts/logic/AutoActivation.mjs`:
  - `getEffectChangesCompat(effect)` should return a plain array from, in order of preference, `effect.changes`, `effect.system?.changes`, `effect.toObject()?.changes`, `effect.toObject()?.system?.changes`, `effect._source?.changes`, or `effect._source?.system?.changes`.
  - Accept arrays, Sets, Foundry collections, and other iterable values.
  - Keep v13 support by preserving direct `effect.changes` handling.
- Active GM helper, likely in `scripts/module.mjs` and `scripts/utils/file-utils.mjs` or a shared existing utility if one already exists:
  - Prefer `game.users?.activeGM` when present.
  - Fall back to first active GM from `game.users`.
  - Preserve current behavior where a GM proceeds if there is no active GM marker.
- FilePicker helper, likely in `scripts/utils/file-utils.mjs` or local to app files if not shared:
  - Resolve `globalThis.FilePicker ?? foundry.applications?.apps?.FilePicker`.
  - Use it for `createDirectory`, `upload`, and `new FilePicker(...)` call sites in `MultiTokenArtManager.mjs` and `SettingsPanel.mjs`.
  - Keep dual `{ notify: false }` arguments for upload compatibility unless manual v14 testing proves a signature change requires branching.

### 2. Adapt Active Effects handling for v13/v14

Files:

- `scripts/logic/AutoActivation.mjs`
- `scripts/module.mjs`
- `scripts/system-support.mjs`

Steps:

1. Replace current `getEffectChanges(effect)` implementation with the compatibility helper.
2. Keep `activeEffectHasMtaImageOverride(effect)` behavior, but make it detect MTA override keys in both v13 and v14 effect shapes.
3. In `module.mjs`, keep `resolveActorFromActiveEffect(effect)` focused on embedded Actor effects; primary/compendium Active Effects should not schedule actor automation unless they have an Actor parent.
4. For `updateActiveEffect`, continue scheduling actor automation, but ensure force options are used when either the old effect or the update payload contains MTA override keys. Check `_changes` for `changes`, `system.changes`, `disabled`, `statuses`, `name`, `label`, and status flags.
5. In `system-support.mjs`, make status collection more tolerant:
   - Accept collection-like/iterable `document.statuses`, `document.traits`, `tokenDoc.effects`, and `tokenDoc.statuses`.
   - Read `effect.statuses` and `effect.system?.statuses` where available.
   - Preserve PF2e condition item handling.

### 3. Harden Token image and Dynamic Ring updates

Files:

- `scripts/logic/AutoActivation.mjs`
- `scripts/logic/DynamicRing.mjs`
- `scripts/module.mjs`

Steps:

1. Keep token texture update paths as dotted paths: `texture.src`, `texture.scaleX`, `texture.scaleY`.
2. Wrap prototype token updates in a small helper such as `buildPrototypeTokenImageUpdate(image, scaleX, scaleY)` to centralize future v14 schema adaptation, but still return current v13-compatible dotted paths.
3. Replace direct `tokenDocument.object.refresh()` with guarded refresh logic:
   - Prefer `tokenDocument.object?.renderFlags?.set?.({ refresh: true })` or the appropriate public v14 render flag if available after checking local API/docs.
   - Fall back to `tokenDocument.object?.refresh?.()` for v13.
4. In `DynamicRing.mjs`, avoid writing a whole `updates.ring` object for enable/disable when possible. Prefer dotted update paths:
   - `ring.enabled`
   - `ring.colors.ring`
   - `ring.colors.background`
   - `ring.subject.scale`
   - `ring.subject.texture`
5. Preserve snapshot/restore semantics for `originalRing`; do not remove `subject.texture = null` cleanup on restore.
6. Keep the `dynamicTokenRingScaling` setting write in `ready`, but gate it safely by setting existence/try-catch as it is today.
7. Manually test an Active Effect or system transformation that changes `texture.src`; confirm it is still treated as an external override and does not fight MTA automation until reset.

### 4. Make ApplicationV2 header controls v14-tolerant

File:

- `scripts/module.mjs`

Steps:

1. Update `pushActorSheetHeaderControl(sheetLike, controls)` so it handles both array-style controls and object/grouped controls.
2. For array-style controls, preserve the existing unshift behavior.
3. For object/grouped controls, insert a v14-compatible control with a stable `action`, `icon`, `label`, and callback/onClick field only if not already present.
4. Keep the DOM fallback binding in `renderApplicationV2` and `renderActorSheet`; it is useful across v13/v14 and across system sheets.
5. Manually verify the button appears and opens the manager on at least dnd5e and one other system sheet in both v13 and v14.

### 5. Dialog and FilePicker compatibility

Files:

- `scripts/apps/MultiTokenArtManager.mjs`
- `scripts/apps/SettingsPanel.mjs`
- `scripts/settings.mjs`
- `scripts/utils/file-utils.mjs`

Steps:

1. Use the FilePicker compatibility resolver for all `new FilePicker(...)`, `FilePicker.createDirectory`, and `FilePicker.upload` calls.
2. Keep legacy `Dialog` for manual token editing unless v14 manual testing shows it breaks; it depends on custom render/close lifecycle and should not be migrated casually.
3. If v14 warns or breaks on legacy `Dialog`, add a minimal wrapper that uses `foundry.applications.api.DialogV2` for first-run simple confirmation, but keep manual-token dialog legacy until a focused migration can preserve canvas binding and cleanup.
4. Ensure file pickers opened from detached/pop-out contexts still browse and write the selected path into the input.

### 6. Scoped CSS isolation from system styles

Files:

- `styles/multi-tokenart.css`
- `scripts/apps/MultiTokenArtManager.mjs`
- `scripts/settings.mjs`
- Templates only if class roots need adjustment.

Decision:

- Use scoped reset inside module windows. Do not use Shadow DOM. Do not use global `all: initial` on the whole app.

Steps:

1. Ensure all dialog window classes include `multi-tokenart` root class. Manual token and first-run dialogs already pass `classes: [MODULE_ID, ...]`; preserve that.
2. Scope dialog selectors that currently start with `.mta-manual-token-window`, `.mta-system-choice-window`, `.mta-system-choice-dialog`, `.mta-manual-token-dialog`, etc. under `.multi-tokenart` or `.multi-tokenart.mta-*` so they cannot match other systems/modules.
3. Add a module-local reset near the top of `styles/multi-tokenart.css`, for example:
   - `.multi-tokenart, .multi-tokenart * { box-sizing: border-box; }`
   - Reset `font-family`, `font-size`, `line-height`, `color`, `text-shadow`, `letter-spacing` for `.multi-tokenart` content.
   - Explicitly style `.multi-tokenart button`, `.multi-tokenart input`, `.multi-tokenart select`, `.multi-tokenart textarea`, `.multi-tokenart label`, `.multi-tokenart img`, `.multi-tokenart canvas` only within module windows.
   - Use `appearance: auto` or controlled `appearance` carefully for checkboxes/ranges/colors so native controls remain usable.
4. Avoid broad selectors like `.multi-tokenart * { all: revert; }`, because they can break Foundry custom elements and ApplicationV2 layout.
5. Add explicit styles for controls currently vulnerable to system styles:
   - Buttons in manager and dialogs.
   - Text/number/color inputs and selects.
   - Checkboxes/ranges.
   - `.window-content`, `.dialog-content`, `.dialog-buttons` only under `.multi-tokenart` roots.
6. Keep visual design close to current module styling.
7. Manually test in at least dnd5e, PF2e, WFRP4e, and one high-styling system if available.

### 7. Manifest and documentation updates

Files:

- `module.json`
- `CONTEXT.md` only if source behavior or architecture changes materially.

Steps:

1. After code changes and manual checks, update `module.json` compatibility to:
   - `minimum: "13"`
   - `verified: "14"`
2. Do not change package `version` unless the release workflow expects it.
3. Update `CONTEXT.md` only if helpers or behavior changes are important enough for future maintainers, especially ActiveEffect v13/v14 compatibility and scoped CSS reset.

## Manual Validation Checklist

Run in Foundry `13.351` and `14.364` with a copy of test data.

1. Module loads without console errors or compatibility warnings that point to MTA code.
2. Manager opens from Token HUD, actor sheet header, public API, and controlled token debug helper.
3. Actor-only manager updates prototype token image and portrait.
4. Token-context manager updates placed linked and unlinked tokens without losing synthetic actor flags.
5. HP wounded/dead automation still selects correct token and portrait images.
6. Status automation works for generic statuses and PF2e conditions.
7. MTA Active Effect overrides work in v13 and v14:
   - `mta.settoken`
   - `mta.setportrait`
   - enable, disable, update, delete effect.
8. v14 Active Effect that changes token image is treated as external texture override and does not cause an update loop.
9. Combat-only automation still triggers on combat create/update/delete and combatant create/update/delete.
10. Dynamic Ring enable, disable, restore, linked token sync, and manual-token subject scale still work.
11. Random mode and linked token/portrait mode still follow sorted visual index.
12. Upload, paste, drop, browse, and manual token frame browse work as GM and as player via active GM socket.
13. First-run system dialog appears only for active GM and saves selected HP preset.
14. Manual token dialog opens, canvas interaction works, save/close cleanup works.
15. UI layout is stable across systems; module buttons/inputs/selects do not inherit disruptive system fonts, margins, backgrounds, or text colors.
16. Pop-out/detached ApplicationV2 scenarios in v14 do not break FilePicker or main manager rendering.

## Risks and Guardrails

- Active Effects V2 is the highest behavior risk. Keep compatibility helpers additive and v13-first; do not rewrite automation priority.
- Dynamic Ring schema may gain fields in v14. Prefer dotted paths to avoid wiping unknown fields.
- CSS reset can easily overreach. Keep it scoped to `.multi-tokenart` and explicitly test native controls.
- Legacy `Dialog` may still work in v14, but it may warn. Do not migrate manual token dialog unless necessary because it has complex canvas lifecycle.
- Worktree has existing changes. Inspect current diffs before editing and do not revert unrelated changes.

## Out Of Scope

- Supporting Foundry v12 or lower.
- Replacing ApplicationV2 with another UI framework.
- Shadow DOM encapsulation.
- Full migration of all dialogs to DialogV2 unless v14 testing proves legacy Dialog is broken.
- Automated test harness creation; no local test infrastructure exists.
