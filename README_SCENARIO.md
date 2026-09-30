# Waste NCV What-If Scenario Simulator

This Streamlit app is designed for a simple operator/engineering question:

> Starting from the actual historian condition, if waste feed, air flows, air temperatures or other process values change, how does the calculated NCV projection change?

## Main workflow
1. Upload the actual historian `.xls` or `.xlsx` file.
2. Select Line 1 / 2 / 3 and a baseline window (3h, 8h, 24h, 72h).
3. The app loads the actual historian baseline automatically.
4. Enter the scenario values you want to test:
   - Waste feed (t/h per line)
   - Primary air temperature and flow
   - Secondary air temperature and flow
   - Process air temperature and flow
   - Feedwater temperature
   - Live steam flow and temperature
   - Drum pressure
   - PA preheater steam flow
   - Flue gas temperature
   - Water injection
5. All values that you do not change remain at the selected actual historian baseline.
6. The app displays:
   - Actual 8h NCV
   - Projected NCV
   - Delta NCV
   - Actual/projected waste heat input
   - Entered waste feed and equivalent plant t/day
   - Thermal-limit capacity per line
   - Projected maximum plant capacity
   - 3000/3100/3200/3300 t/day target gaps
   - Heat-balance term changes
   - One-at-a-time sensitivity ranking
   - Hourly operator table

## Actual-data calibration
The main projected NCV is anchored to the actual 8h historian NCV:

`Projected NCV = Actual 8h NCV + (Scenario model NCV - Baseline model NCV)`

This means the HZI/FDS heat-balance model is used primarily to estimate the *change* caused by your scenario, while the starting point remains the actual plant calculation.

The same delta-calibration method is used for waste heat input.

## Run
```bash
python -m pip install -r requirements_scenario.txt
streamlit run ncv_scenario_app.py --server.address 0.0.0.0 --server.port 8501
```

## Important
This is an engineering what-if/sensitivity tool. It does not change the intrinsic chemical NCV of the waste and it does not issue control commands. Operating limits must follow OEM/site procedures.
