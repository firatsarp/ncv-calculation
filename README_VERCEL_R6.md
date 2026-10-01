# NCV Calculation Web – R6 Scenario Model

Base: production R4 / GitHub current blobs verified before modification.

## R6 changes
- Keeps the HZI Rev. 3.1 inverse heat-balance calculated NCV logic.
- Separates scenario work into two modes:
  - **Specific Manual**: absolute values applied only to the selected 8-hour baseline.
  - **Historical Relative**: `No change`, `% Relative`, or `Absolute Δ` applied independently to every hourly rolling 8-hour Actual baseline.
- Waste throughput and live steam response are independent assumptions. No automatic steam response is invented.
- Adds optional live-steam-pressure historian mapping (`LBA10 CP001`) as operating context. Current table-based steam enthalpy still uses steam temperature; no unvalidated pressure correction is added.
- Adds historical status flags: thermal overload, mechanical overload, low steam, lookup extrapolation, outside historical envelope, invalid input.
- Adds one-at-a-time NCV sensitivity decomposition for the selected 8-hour scenario. It is explicitly not additive and not causal attribution.
- Expands Excel export to:
  - Executive_Summary
  - Scenario_Settings
  - Specific_8h
  - Specific_Heat_Balance
  - NCV_Sensitivity
  - Historical_8h_Actual
  - Historical_8h_Projected
  - Historical_Comparison
  - Daily_Summary
  - Scenario_Distribution
  - Target_3000_3300
  - Constraints
  - Source_Tags
  - Lookup_Tables

## Validation performed in this workspace
- R4 source archive blob hashes matched the current GitHub source blobs for `app/scenario/page.js`, `lib/ncv.js`, and `app/globals.css` before editing.
- `lib/ncv.js` and `lib/scenario.js` import successfully under Node 22 ESM test mode.
- Synthetic historical sensitivity test passed for waste +10% and steam +5%, including thermal-overload and historical-envelope flags.
- TypeScript parser check completed without syntax errors for `app/scenario/page.js`, `lib/scenario.js`, and `lib/ncv.js`.

## Build note
A full `npm run build` could not be executed in the isolated workspace because the Next.js npm package was not available in the local npm cache and outbound package registry access is disabled here. Run the normal build in Codespaces/Vercel before production deployment.
