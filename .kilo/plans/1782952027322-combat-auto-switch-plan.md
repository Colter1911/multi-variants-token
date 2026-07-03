# Combat Auto Switch Plan

## Goal

Add a new image-level auto-switch condition "in combat" for both token and portrait images. The condition participates in the existing auto activation system without breaking HP/status behavior, manual persistence, Active Effect overrides, Dynamic Ring, linked portraits, unlinked tokens, or the current protection against Foundry token image transformations.

## Confirmed Decisions

- The new checkbox applies to both token images and portrait images.
- A token is considered "in combat" only when it has a Combatant in the active `game.combat`.
- Combat changes must react to combat start/end and to tokens being added to or removed from an already active combat.
- `mta.settoken` / `mta.setportrait` Active Effect overrides remain the highest priority and ignore combat filtering.
- The combat condition is combined with other selected conditions by logical AND.
- A combat-only image is valid while the token is in combat.
- A combat + wounded/status/dead image is valid only when the token is in combat and the other configured condition also matches.
- If one or more combat candidates match, choose among those before ordinary non-combat auto images. Example: in combat at 30% HP, combat-only beats a non-combat wounded image.
- If no combat candidate matches, fall back to the existing normal HP/status/manual/default logic. Example: combat + wounded at full HP does not block the normal image.
- On leaving combat, run the normal auto activation recalculation rather than restoring a separate pre-combat snapshot.
- Preserve the existing external token image override behavior so Foundry transformation/disguise token textures are not overwritten by combat auto switching.

## Affected Files

- `scripts/data/ImageData.mjs`
- `scripts/utils/flag-utils.mjs`
- `scripts/apps/MultiTokenArtManager.mjs`
- `templates/settings-panel.hbs`
- `scripts/logic/AutoActivation.mjs`
- `scripts/module.mjs`
- `lang/en.json`
- `lang/ru.json`
- `CONTEXT.md` if the implementation changes the documented data shape or auto activation flow.

## Implementation Steps

1. Extend the image data shape with `autoEnable.combat`.
   - Add `combat: BooleanField` to `ImageData.defineSchema()` with initial `false`.
   - Add `combat: false` to every new/default `autoEnable` object created in `MultiTokenArtManager.mjs`.
   - In `flag-utils.mjs`, sanitize `autoEnable.combat` via `toBoolean(..., false)`.
   - Ensure legacy actor flags without `combat` normalize safely to `false`.

2. Add UI support in the settings panel.
   - Add a checkbox named `autoEnable.combat` near the existing auto conditions.
   - Disable it when `autoEnable.enabled` is off, matching wounded/dead/status controls.
   - Update the `autoEnable.enabled` change handler in `MultiTokenArtManager.mjs` so it toggles the combat checkbox disabled state.
   - Include `combat` in the `autoEnable` object harvested in `#onSaveSettings()`.
   - Add localization keys, for example `MTA.CombatEnable`: `In Combat` / `В бою` or `Смена в бою`.

3. Add a combat-state helper.
   - Implement helper logic in `AutoActivation.mjs` or `module.mjs` to determine whether a given `tokenDocument` has a Combatant in `game.combat`.
   - Match by token id and scene id when available; support Foundry v13 combatant document shapes defensively (`combatant.tokenId`, `combatant.sceneId`, `combatant.token?.id`, `combatant.token?.document`).
   - Treat missing `game.combat`, missing token, or missing combatant as not in combat.

4. Update image selection in `findBestImageForHp()`.
   - Keep Active Effect override handling outside this function unchanged.
   - Compute current combat state for the `tokenDocument`.
   - Define matching so every configured condition on an auto-enabled image must pass:
     - `combat` requires token-in-active-combat.
     - `die` requires `hp.current <= 0`.
     - `wounded` requires HP percent at or below `woundedPercent`.
     - non-empty `status` requires `hasMatchingStatus(...)`.
   - Treat an auto-enabled image with no configured conditions as not a special auto candidate, preserving current manual-persistence behavior.
   - First evaluate matching combat candidates while in combat.
   - If any matching combat candidates exist, choose from them with the existing priority shape: dead, status, wounded, then combat-only; keep existing wounded threshold sort where lower threshold wins, then `sort` order.
   - If no combat candidates match, run the ordinary non-combat selection equivalent to current behavior: dead, status, wounded, manual persistence, pre-condition restore, default fallback.
   - Outside combat, combat-marked images must not match unless another non-combat path explicitly selects them via Active Effect override.

5. Preserve pre-condition/manual behavior.
   - Update "special image" checks in `applyTokenImageById()`, `applyPortraitById()`, and `findBestImageForHp()` so `autoEnable.combat` counts as special.
   - This allows combat-only images to store the previous image in existing `preConditionImageId` / `preConditionPortraitId` and lets normal recalculation restore/fallback after combat.
   - Do not add a separate pre-combat flag unless implementation proves the existing pre-condition flow cannot handle the confirmed behavior.

6. Add combat hooks in `scripts/module.mjs`.
   - Register hooks for combat lifecycle and combatant membership changes, such as `createCombat`, `updateCombat`, `deleteCombat`, `createCombatant`, `updateCombatant`, and `deleteCombatant` as appropriate for Foundry v13.
   - On combat start/end, schedule auto activation for affected combatant actors/tokens only when the current user should run token automation.
   - On combatant create/delete/update, immediately schedule recalculation for that combatant's actor/token so mid-combat add/remove works.
   - Reuse the existing GM ownership guard (`shouldCurrentUserRunTokenAutomation`) and debouncing style to avoid duplicate updates.
   - For unlinked tokens, use the combatant/token synthetic actor when available rather than `game.actors.get(...)`.

7. Preserve Foundry transformation protection.
   - Do not change `handleExternalTokenImageChange()` semantics.
   - Ensure combat-triggered `runAutoActivation()` still respects `isExternalTokenImageOverrideActive(tokenDocument)`: token texture updates must be skipped while an external override is active.
   - Linked portrait updates should remain consistent with current behavior when an external token override is active.

8. Update documentation map if implementation changes documented behavior.
   - Add `autoEnable.combat` to the data shape in `CONTEXT.md`.
   - Update the auto activation section to document combat matching and hooks.

## Validation Checklist

- Legacy actors with existing images open and save without data loss; `autoEnable.combat` defaults to `false`.
- UI shows the combat checkbox for token and portrait image settings and disables it with the master auto checkbox.
- Combat-only token switches when its token is added to/starts active combat.
- Combat-only token returns through normal auto logic when removed from combat or combat ends.
- Combat + wounded image only wins in combat when HP is at or below its threshold.
- In combat at wounded HP, combat-only beats a non-combat wounded image.
- In combat with only combat + wounded and full HP, normal/default behavior remains active.
- If no combat images match or exist, current HP/status/default/manual behavior is unchanged.
- Active Effect override still selects the requested image regardless of combat flags.
- Foundry transformation/disguise external token image still blocks token auto replacement while active.
- Linked token/portrait behavior remains consistent with the current sorted-index link mode.
- Unlinked tokens use their synthetic actor flags and HP deltas correctly.

## Notes For Implementation

- Keep the change minimal: prefer extending the existing selection function rather than creating a parallel combat activation system.
- Avoid actor-wide combat recalculation for all actors in a scene; target combatants/tokens where possible.
- There is no existing project test suite outside dependencies, so validation will likely be manual in Foundry plus syntax/lint-style review if available.
