# HZI Waste NCV Calculation - 3 Line Version

This repository contains a historian-based implementation of the HZI Waste NCV Calculation methodology for the Istanbul WtE plant, based on HZI document 90101284 Rev. 3.1.

The current program calculates Line 1, Line 2 and Line 3 from historian data and produces:

- Instant / 10-minute NCV engineering estimate [MJ/kg]
- 3-hour rolling NCV [MJ/kg]
- 8-hour rolling NCV [MJ/kg]
- Instant / 10-minute waste throughput [t/h]
- 3-hour waste throughput [t/h]
- 8-hour waste throughput [t/h]
- Waste Heat Input [MW]

> HZI Rev. 3.1 formally defines the 3-hour and 8-hour NCV outputs. `NCV_Instant_10min_MJkg` is an additional engineering estimate added for short-term operational trending.

## Main files

- `ncv_calc_3lines.py` - current 3-line calculation program
- `data.xlsx` - empty historian input template
- `requirements.txt` - Python dependencies
- `ncv_calc.py` - older Line 1 calculation retained for reference

## Installation

In GitHub Codespaces terminal:

```bash
python -m pip install -r requirements.txt
```

## Input file

Use `data.xlsx` and paste historian values under the existing headers. The program locates the row containing `Date Time`, so the template may contain information rows above the header.

The historian sampling interval should normally be 10 minutes. The program also detects the actual median interval and adapts the 30-minute distribution and rolling windows accordingly.

## Run

```bash
python ncv_calc_3lines.py data.xlsx
```

Default output files:

```text
ncv_3lines_10min.xlsx
ncv_3lines_10min.csv
```

The Excel output contains:

- `All_Lines`
- `Line1`
- `Line2`
- `Line3`
- `Run_Info`

To calculate selected lines only:

```bash
python ncv_calc_3lines.py data.xlsx --lines 1 3
```

To stop immediately if any requested line is missing a required tag:

```bash
python ncv_calc_3lines.py data.xlsx --strict
```

## Required signal list

`Date Time` is required in addition to the signals below.

### Line 1

```text
1 LBA10 CF901
1 LBA10 CT901
1 LAB40 CT001
1 HAD10 CP004
1 LBG30 CF901
1 HLA10 CF901
1 HLA10 CT003
1 HLA20 CF901
1 HLA20 CT003
1 HLA10 CT001
1 HNA10 CT901
1 ETN40 CF001
1 HJY10 EK001 XE28
1 HJY20 EK001 XE28
0 EAF05 EK001 XE56
```

### Line 2

```text
2 LBA10 CF901
2 LBA10 CT901
2 LAB40 CT001
2 HAD10 CP004
2 LBG30 CF901
2 HLA10 CF901
2 HLA10 CT003
2 HLA20 CF901
2 HLA20 CT003
2 HLA10 CT001
2 HNA10 CT901
2 ETN40 CF001
2 HJY10 EK001 XE28
2 HJY20 EK001 XE28
0 EAF05 EK001 XE58
```

### Line 3

```text
3 LBA10 CF901
3 LBA10 CT901
3 LAB40 CT001
3 HAD10 CP004
3 LBG30 CF901
3 HLA10 CF901
3 HLA10 CT003
3 HLA20 CF901
3 HLA20 CT003
3 HLA10 CT001
3 HNA10 CT901
3 ETN40 CF001
3 HJY10 EK001 XE28
3 HJY20 EK001 XE28
0 EAF05 EK001 XE60
```

## Signal descriptions

| Signal suffix | Description |
|---|---|
| `LBA10 CF901` | Live Steam Flow |
| `LBA10 CT901` | Live Steam Temperature |
| `LAB40 CT001` | Feedwater Temperature |
| `HAD10 CP004` | Boiler Drum Pressure |
| `LBG30 CF901` | Saturated Steam Flow to PA Preheater |
| `HLA10 CF901` | Primary Air Flow |
| `HLA10 CT003` | Primary Air Temperature |
| `HLA20 CF901` | Secondary Air Flow |
| `HLA20 CT003` | Secondary Air Temperature |
| `HLA10 CT001` | Process Air Temperature |
| `HNA10 CT901` | Flue Gas Temperature |
| `ETN40 CF001` | Water Injection Flow |
| `HJY10 EK001 XE28` | Burner 1 In Operation |
| `HJY20 EK001 XE28` | Burner 2 In Operation |
| `0 EAF05 EK001 XE56` | Sum Waste Line 1 Today |
| `0 EAF05 EK001 XE58` | Sum Waste Line 2 Today |
| `0 EAF05 EK001 XE60` | Sum Waste Line 3 Today |

## Waste mass / throughput logic

The historian implementation uses the cumulative Today waste counters:

```text
Line 1 -> 0 EAF05 EK001 XE56
Line 2 -> 0 EAF05 EK001 XE58
Line 3 -> 0 EAF05 EK001 XE60
```

Interval waste is calculated from the difference between consecutive Today counter values. At a normal date rollover, the new day's counter is used. If the optional Yesterday counters are present (`XE55`, `XE57`, `XE59`), the program uses them to improve rollover calculation.

An intra-day negative counter jump is flagged as `Counter_Unexpected_Reset` and is not silently treated as valid waste.

The interval waste is distributed across approximately 30 minutes before throughput is calculated, following the HZI smoothing concept.

Individual crane release / grab-weight signals are therefore not required for this historian-based version.

## NCV active logic

The calculation checks:

- Live Steam Flow
- Burner 1 status
- Burner 2 status

Minimum live steam flow used by the program:

```text
76.08 t/h
```

When an auxiliary burner is operating, NCV calculation becomes inactive. Display-hold columns retain the latest valid value.

## Instant / 10-minute NCV

The short-term engineering estimate uses current Waste Heat Input and the current 30-minute-distributed waste throughput:

```text
NCV [MJ/kg] = Waste Heat Input [kW] x 3.6 / Waste Throughput [t/h] / 1000
```

Output column for each line:

```text
NCV_Instant_10min_MJkg
```

This value is expected to fluctuate more than the 3-hour and 8-hour values.

## 3-hour and 8-hour NCV

The program calculates rolling Waste Heat Input and waste throughput and produces:

```text
NCV_3h_MJkg
NCV_8h_MJkg
```

For the normal 10-minute historian interval, the rolling windows correspond to 18 samples (3 h) and 48 samples (8 h).

## Tag fallbacks / optional inputs

Primary Air Temperature prefers:

```text
1/2/3 HLA10 CT003
```

and accepts `CT002` as a fallback.

Feedwater Temperature normally uses the line-specific tag:

```text
1/2/3 LAB40 CT001
```

The code also accepts `0 LAB40 CT001` as a fallback if the historian export uses a common tag.

Optional Yesterday waste counters:

```text
0 EAF05 EK001 XE55  # Line 1 Yesterday
0 EAF05 EK001 XE57  # Line 2 Yesterday
0 EAF05 EK001 XE59  # Line 3 Yesterday
```

They are not required for normal calculation.

## Signals not required by this version

The current historian-based implementation does not require the individual crane release / fed-weight signals such as `XE37`, `XE41`, `XE43`, `XE47`, `XE49`, and `XE53` because waste quantity is derived from the cumulative Today counters.

Live Steam Pressure and Feedwater Pressure are also not required by the current lookup-table implementation.

## Typical combined output columns

```text
L1_NCV_Instant_10min_MJkg
L1_NCV_3h_MJkg
L1_NCV_8h_MJkg
L2_NCV_Instant_10min_MJkg
L2_NCV_3h_MJkg
L2_NCV_8h_MJkg
L3_NCV_Instant_10min_MJkg
L3_NCV_3h_MJkg
L3_NCV_8h_MJkg
```

The output also includes instant / 3-hour / 8-hour throughput and Waste Heat Input values for each line.

## Reference

```text
HZI Document 90101284
Waste NCV Calculation
Revision 3.1
Project P-3242 Istanbul
```
