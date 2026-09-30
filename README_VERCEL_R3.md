# NCV Calculation Platform - Vercel R3

## Routes
- `/` - function selector
- `/ncv-calculation` - historian NCV calculation: 10 min engineering estimate, 3 h and 8 h NCV + Excel export
- `/scenario` - Actual date/time baseline + scenario / hourly projection + Excel export

## Deployment
```bash
npm install
npm run build
git add .
git commit -m "Add NCV calculation and scenario modules"
git push origin main
```

Vercel is already linked to the GitHub repository, so a push to `main` should trigger deployment.
