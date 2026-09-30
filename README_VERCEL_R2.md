# NCV Scenario Web - Vercel R2

New in R2:

- Select Actual baseline date/time from uploaded historian file.
- Actual values use the 8-hour window ending at the nearest available historian timestamp.
- Changing the selected Actual date/time resets Scenario inputs to that Actual baseline.
- Excel export includes `Hourly_Projection`.
- Each hourly projection uses that hour's own 8-hour Actual baseline.
- Scenario changes are applied hour-by-hour as deltas relative to the user-selected Actual baseline.
- `Hourly_Actual` is still included for traceability.

## Run locally

```bash
npm install
npm run dev
```

## Deploy

Push these files to the repository root and import the repository in Vercel as a Next.js project.
