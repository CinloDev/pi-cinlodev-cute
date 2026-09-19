# Feature: Usage Card Dynamic 4-Tier Semáforo Colors

## Objective
Align the Quotas / Usage card coloring in `src/cute-usage.ts` with the 4-tier semáforo used by the Context card (`Mint` -> `Gold` -> `Orange` -> `Coral`), reflecting remaining available quota dynamically across the pool bullet (`●`), remaining percentage (`xx%`), and Context-style gauge bar (`▰▰▰▱▱`).

## Requirements
1. **Quota Threshold Function (`src/cute-usage.ts`)**:
   - Create `getQuotaThreshold(availablePercent: number, palette: CutePalette): QuotaThreshold`.
   - Thresholds for available quota:
     - >= 65%: Mint (`palette.mint`, optimal / holgado)
     - 40% - 64%: Gold (`palette.gold`, medium / moderado)
     - 20% - 39%: Orange (`palette.orange`, alert / alerta)
     - < 20%: Coral (`palette.coral`, critical / crítico)
   - Evaluates `Math.round(availablePercent)` in lockstep with the visible rounded text.
2. **Card Rendering (`src/cute-usage.ts`)**:
   - Update `CinlodevUsageCard.render` to use `getQuotaThreshold`.
   - Apply the dynamic threshold color to:
     - Pool bullet indicator: `${threshold.color("●")}`
     - Remaining percentage string: `\x1b[1m${threshold.color(`${pct}%`)}\x1b[22m`
     - Gauge bar filled cells: `${threshold.color(g.gaugeFilled.repeat(filledCount))}`
3. **Unit Tests (`test/cute.test.ts`)**:
   - Verify all 4 threshold brackets and boundaries.
   - Verify rendered output uses the dynamic colors.
   - Ensure 100% pass rate in test suite.

## Tasks
- [x] T1: Implement `getQuotaThreshold` and export it in `src/cute-usage.ts`
- [x] T2: Integrate dynamic colors in `CinlodevUsageCard.render` (bullet, percentage, gauge bar)
- [x] T3: Add unit tests in `test/cute.test.ts` and verify test suite
