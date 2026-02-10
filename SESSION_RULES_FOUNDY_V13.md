# Session Rules: Foundry VTT Module Development (Persistent for this repo)

These rules were added per user request and should be read at the start of each session in this environment.

## Target Platform
- **Core:** Foundry VTT **v13.381** (STRICT)
- **Module Type:** Game System / Add-on Module
- **Documentation:** https://foundryvtt.com/api/
- **Language:** TypeScript (Strict Mode), SCSS, Handlebars

## Critical Version Rules (Foundry v13)
1. **Data Models:** Use `DataModel` architecture. Avoid old `Document` mixins.
2. **ESM:** Always use `import/export`. Never use `require`.
3. **Deprecation Check:** Strictly avoid methods marked as "Legacy" or deprecated in v11/v12.
4. **Canvas Interaction:** Use v13 Canvas layers and interaction layer logic.
5. **Knowledge Conflict:** If model knowledge conflicts with v13 specifics, priority goes to v13 rules.
6. If unsure about v13 API: check `foundry.d.ts`, or explicitly state:
   "I am assuming v13 behavior for [MethodName], please verify."

## Note
- Long-term cross-session memory is not guaranteed by the model runtime.
- This file is the persistent source of truth inside this repository.
