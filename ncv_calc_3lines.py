import sys
import re
import argparse
from pathlib import Path

import numpy as np
import pandas as pd

# ============================================================
# HZI 90101284 REV. 3.1 - WASTE NCV
# 3-LINE VERSION FOR 10-MIN HISTORIAN DATA
#
# Line-specific process tags are created by replacing the first
# line prefix with 1 / 2 / 3, e.g.:
#   1 LBA10 CF901
#   2 LBA10 CF901
#   3 LBA10 CF901
#
# Daily cumulative waste counters are common-system tags:
#   Line 1 Today -> 0 EAF05 EK001 XE56
#   Line 2 Today -> 0 EAF05 EK001 XE58
#   Line 3 Today -> 0 EAF05 EK001 XE60
# ============================================================

T_REF = 18.0
AIR_DENSITY = 1.281          # kg/Nm3
FG_DENSITY = 1.235           # kg/Nm3
AIR_TO_FG = 1.234
PROCESS_AIR = 7464.0         # Nm3/h, Rev.3.1 calculation logic
WATER_DENSITY = 999.2        # kg/m3
WATER_VAPOR = 1.244          # Nm3/kg
WATER_NCV = -2470.5614       # kJ/kg
BLOWDOWN = 330.0             # kg/h
BOTTOM_ASH_LOSS = 132.277    # kJ/kg waste
FLY_ASH_LOSS = 10.2414       # kJ/kg waste
RADIATION_LOSS = 675.0       # kW
STEAM_MIN = 76.08            # t/h

COUNTERS_TODAY = {
    1: "0 EAF05 EK001 XE56",
    2: "0 EAF05 EK001 XE58",
    3: "0 EAF05 EK001 XE60",
}

COUNTERS_YESTERDAY = {
    1: "0 EAF05 EK001 XE55",
    2: "0 EAF05 EK001 XE57",
    3: "0 EAF05 EK001 XE59",
}

# ============================================================
# LOOKUP TABLES
# ============================================================
PRIMARY_CP_X = np.array([12.0, 29.3, 46.5, 63.8, 81.0, 98.3, 115.5, 132.8, 150.0])
PRIMARY_CP_Y = np.array([1.011, 1.012, 1.013, 1.014, 1.015, 1.016, 1.018, 1.020, 1.023])

SECONDARY_CP_X = np.array([12.0, 23.0, 34.0, 45.0, 56.0, 67.0, 78.0, 89.0, 100.0])
SECONDARY_CP_Y = np.array([1.011, 1.012, 1.012, 1.013, 1.013, 1.014, 1.015, 1.016, 1.017])

PROCESS_CP_X = np.array([12.0, 16.8, 21.5, 26.3, 31.0, 35.8, 40.5, 45.3, 50.0])
PROCESS_CP_Y = np.array([1.011, 1.011, 1.012, 1.012, 1.012, 1.012, 1.012, 1.013, 1.013])

FG_CP_X = np.array([0.0, 18.8, 37.5, 56.3, 75.0, 93.8, 112.5, 131.3, 150.0])
FG_CP_Y = np.array([1.096, 1.100, 1.104, 1.108, 1.113, 1.117, 1.122, 1.127, 1.132])

FEEDWATER_T = np.array([95, 105, 110, 115, 120, 125, 130, 135, 145])
FEEDWATER_H = np.array([404.44, 446.42, 467.46, 488.53, 509.64, 530.79, 551.98, 573.22, 615.85])

STEAM_T = np.array([401, 411, 416, 421, 426, 431, 436, 441, 451])
STEAM_H = np.array([3157.90, 3184.63, 3197.82, 3210.91, 3223.91, 3236.83, 3249.66, 3262.42, 3287.73])

DRUM_P = np.array([75, 77, 78, 79, 80, 81, 82, 83, 85])
BLOWDOWN_H = np.array([1292.70, 1302.55, 1307.42, 1312.27, 1317.08, 1321.86, 1326.61, 1331.34, 1340.70])
SAT_STEAM_H = np.array([2765.82, 2762.99, 2761.55, 2760.09, 2758.61, 2757.12, 2755.60, 2754.07, 2750.96])

# ============================================================
# HELPERS
# ============================================================

def number(v):
    if pd.isna(v):
        return np.nan
    if isinstance(v, (int, float, np.integer, np.floating)):
        return float(v)
    text = str(v).replace(",", ".")
    nums = re.findall(r"[-+]?\d*\.?\d+", text)
    if not nums:
        return np.nan
    return float(nums[-1])


def numeric(series):
    return series.apply(number)


def interp(value, x, y):
    arr = np.asarray(value, dtype=float)
    return np.interp(arr, x, y, left=y[0], right=y[-1])


def line_tag(line, suffix):
    return f"{line} {suffix}"


def find_header(file):
    raw = pd.read_excel(file, header=None, nrows=25)
    for i in range(len(raw)):
        values = [str(x).strip() for x in raw.iloc[i] if pd.notna(x)]
        if "Date Time" in values or any(f"{line} LBA10 CF901" in values for line in (1, 2, 3)):
            return i
    return 0


def load(file):
    header = find_header(file)
    df = pd.read_excel(file, header=header)
    df.columns = [str(c).strip() for c in df.columns]
    return df.dropna(axis=0, how="all")


def preferred_tag(df, candidates, label):
    for tag in candidates:
        if tag in df.columns:
            return tag
    raise KeyError(f"{label} bulunamadi. Beklenenlerden biri: {', '.join(candidates)}")


def build_tags(df, line):
    # Rev.3.1 M01 uses HLA10 CT003 for primary air temperature;
    # CT002 remains accepted as fallback for exports using that name.
    primary_temp = preferred_tag(
        df,
        [line_tag(line, "HLA10 CT003"), line_tag(line, "HLA10 CT002")],
        f"Line {line} primary air temperature",
    )

    # Feedwater was seen with line-specific prefix in historian exports.
    feedwater_temp = preferred_tag(
        df,
        [line_tag(line, "LAB40 CT001"), f"0 LAB40 CT001"],
        f"Line {line} feedwater temperature",
    )

    tags = {
        "steam_flow": line_tag(line, "LBA10 CF901"),
        "steam_temp": line_tag(line, "LBA10 CT901"),
        "feedwater_temp": feedwater_temp,
        "drum_pressure": line_tag(line, "HAD10 CP004"),
        "pa_preheater_flow": line_tag(line, "LBG30 CF901"),
        "primary_flow": line_tag(line, "HLA10 CF901"),
        "primary_temp": primary_temp,
        "secondary_flow": line_tag(line, "HLA20 CF901"),
        "secondary_temp": line_tag(line, "HLA20 CT003"),
        "process_temp": line_tag(line, "HLA10 CT001"),
        "fg_temp": line_tag(line, "HNA10 CT901"),
        "water": line_tag(line, "ETN40 CF001"),
        "burner1": line_tag(line, "HJY10 EK001 XE28"),
        "burner2": line_tag(line, "HJY20 EK001 XE28"),
        "counter_today": COUNTERS_TODAY[line],
    }

    missing = [tag for tag in tags.values() if tag not in df.columns]
    if missing:
        raise KeyError(f"Line {line} eksik taglar: {', '.join(missing)}")

    yesterday = COUNTERS_YESTERDAY[line]
    tags["counter_yesterday"] = yesterday if yesterday in df.columns else None
    return tags


def infer_interval_minutes(dt_series):
    diffs = dt_series.sort_values().diff().dropna().dt.total_seconds() / 60.0
    diffs = diffs[(diffs > 0) & np.isfinite(diffs)]
    if diffs.empty:
        return 10.0
    return float(diffs.median())


def consecutive_counts(mask):
    out = np.zeros(len(mask), dtype=int)
    n = 0
    for i, state in enumerate(mask):
        if bool(state):
            n += 1
        else:
            n = 0
        out[i] = n
    return out


def cumulative_to_increment(r, today_col="counter_today", yesterday_col="counter_yesterday"):
    today = r[today_col]
    diff = today.diff()
    inc = diff.copy()
    inc.iloc[0] = 0.0

    dt = r["Date Time"]
    day_change = dt.dt.date.ne(dt.shift(1).dt.date)
    negative = diff < 0
    unexpected_reset = negative & ~day_change

    # At a normal date rollover, use yesterday counter if available.
    # Otherwise use the new day's current counter as the best available approximation.
    normal_reset = negative & day_change
    if yesterday_col in r.columns and r[yesterday_col].notna().any():
        yday = r[yesterday_col]
        exact = (yday - today.shift(1)) + today
        good_exact = normal_reset & exact.notna() & (exact >= 0)
        inc.loc[good_exact] = exact.loc[good_exact]
        inc.loc[normal_reset & ~good_exact] = today.loc[normal_reset & ~good_exact]
    else:
        inc.loc[normal_reset] = today.loc[normal_reset]

    # Do not silently interpret an intra-day negative jump as valid waste.
    inc.loc[unexpected_reset] = np.nan
    inc = inc.where(inc >= 0)

    return inc, normal_reset.astype(int), unexpected_reset.astype(int)


def distribute_30min(waste, interval_min):
    slots = max(1, int(round(30.0 / interval_min)))
    kernel = np.repeat(1.0 / slots, slots)
    return np.convolve(waste.fillna(0).values, kernel, mode="full")[: len(waste)], slots


def calculate_line(df, line):
    tags = build_tags(df, line)

    r = pd.DataFrame()
    r["Date Time"] = pd.to_datetime(df["Date Time"], errors="coerce")
    r = r[r["Date Time"].notna()].copy()
    idx = r.index

    for name, tag in tags.items():
        if tag is not None:
            r[name] = numeric(df.loc[idx, tag])

    if "counter_yesterday" not in r.columns:
        r["counter_yesterday"] = np.nan

    r = r.sort_values("Date Time").reset_index(drop=True)
    interval_min = infer_interval_minutes(r["Date Time"])

    # FDS timing adapted to historian sample interval.
    startup_slots = max(1, int(np.ceil(15.0 / interval_min)))
    valid3_slots = max(1, int(np.ceil(210.0 / interval_min)))
    valid8_slots = max(1, int(np.ceil(510.0 / interval_min)))
    roll3_slots = max(1, int(round(180.0 / interval_min)))
    roll8_slots = max(1, int(round(480.0 / interval_min)))

    burner = (r["burner1"].fillna(0) > 0.5) | (r["burner2"].fillna(0) > 0.5)
    steam_ok = r["steam_flow"] >= STEAM_MIN
    precondition = steam_ok & ~burner

    start_run = consecutive_counts(precondition)
    active = start_run >= startup_slots
    active_run = consecutive_counts(active)

    r["NCV_Active"] = active.astype(int)
    r["NCV_3h_Valid"] = active & (active_run >= valid3_slots)
    r["NCV_8h_Valid"] = active & (active_run >= valid8_slots)

    waste, normal_reset, unexpected_reset = cumulative_to_increment(r)
    r["Counter_Reset"] = normal_reset
    r["Counter_Unexpected_Reset"] = unexpected_reset
    r["Waste_Interval_t"] = waste

    distributed, dist_slots = distribute_30min(waste, interval_min)
    r["Waste_30min_Distributed_t"] = distributed

    # 10-minute / current engineering throughput estimate.
    # The cumulative Today counter is converted to interval waste and then
    # distributed over 30 minutes using the HZI smoothing concept.
    r["Throughput_Instant_tph"] = (
        r["Waste_30min_Distributed_t"] * (60.0 / interval_min)
    )

    r["Waste_3h_t"] = r["Waste_30min_Distributed_t"].rolling(roll3_slots, min_periods=roll3_slots).sum()
    r["Waste_8h_t"] = r["Waste_30min_Distributed_t"].rolling(roll8_slots, min_periods=roll8_slots).sum()
    r["Throughput_3h_tph"] = r["Waste_3h_t"] / 3.0
    r["Throughput_8h_tph"] = r["Waste_8h_t"] / 8.0

    # Other heat credits
    cp_primary = interp((r["primary_temp"] + T_REF) / 2.0, PRIMARY_CP_X, PRIMARY_CP_Y)
    cp_secondary = interp((r["secondary_temp"] + T_REF) / 2.0, SECONDARY_CP_X, SECONDARY_CP_Y)
    cp_process = interp((r["process_temp"] + T_REF) / 2.0, PROCESS_CP_X, PROCESS_CP_Y)

    q_primary = r["primary_flow"] / 3600.0 * AIR_DENSITY * cp_primary * (r["primary_temp"] - T_REF)
    q_secondary = r["secondary_flow"] / 3600.0 * AIR_DENSITY * cp_secondary * (r["secondary_temp"] - T_REF)
    q_process = PROCESS_AIR / 3600.0 * AIR_DENSITY * cp_process * (r["process_temp"] - T_REF)

    water_kg_h = r["water"] * WATER_DENSITY
    q_water = water_kg_h / 3600.0 * WATER_NCV
    q_other = q_primary + q_secondary + q_process + q_water

    # Useful heat
    h_fw = interp(r["feedwater_temp"], FEEDWATER_T, FEEDWATER_H)
    h_steam = interp(r["steam_temp"], STEAM_T, STEAM_H)
    p_abs = r["drum_pressure"] + 1.0
    h_bd = interp(p_abs, DRUM_P, BLOWDOWN_H)
    h_sat = interp(p_abs, DRUM_P, SAT_STEAM_H)

    steam_kg_s = r["steam_flow"] * 1000.0 / 3600.0
    q_steam = steam_kg_s * (h_steam - h_fw)
    q_bd = BLOWDOWN / 3600.0 * (h_bd - h_fw)
    pa_steam_kg_s = r["pa_preheater_flow"] * 1000.0 / 3600.0
    q_pa_preheater = pa_steam_kg_s * (h_sat - h_fw)
    q_useful = q_steam + q_bd + q_pa_preheater

    # Flue-gas heat loss
    water_fg_nm3h = water_kg_h * WATER_VAPOR
    fg_nm3h = (r["primary_flow"] + r["secondary_flow"] + PROCESS_AIR) * AIR_TO_FG + water_fg_nm3h
    fg_kg_s = fg_nm3h * FG_DENSITY / 3600.0
    cp_fg = interp((r["fg_temp"] + T_REF) / 2.0, FG_CP_X, FG_CP_Y)
    q_fg = fg_kg_s * cp_fg * (r["fg_temp"] - T_REF)

    # Ash + radiation losses; 3h throughput is the Rev.3.1 loss basis used here.
    mb = r["Throughput_3h_tph"]
    q_bottom = mb / 3.6 * BOTTOM_ASH_LOSS
    q_fly = mb / 3.6 * FLY_ASH_LOSS
    q_losses = q_fg + q_bottom + q_fly + RADIATION_LOSS

    q_waste = q_useful + q_losses - q_other
    r["WasteHeatInput_kW"] = q_waste

    # Engineering estimate of current/10-minute NCV.
    # HZI Rev.3.1 formally defines 3h and 8h NCV outputs; this extra value
    # uses the current Waste Heat Input and the 30-minute-distributed current
    # throughput to provide a faster operational indication.
    r["WasteHeatInput_Instant_MW"] = r["WasteHeatInput_kW"] / 1000.0
    instant_raw = (
        r["WasteHeatInput_kW"]
        * 3.6
        / r["Throughput_Instant_tph"]
        / 1000.0
    )
    instant_valid = (
        active
        & r["Throughput_Instant_tph"].notna()
        & (r["Throughput_Instant_tph"] > 0.1)
    )
    r["NCV_Instant_10min_MJkg_RAW"] = instant_raw.where(
        r["Throughput_Instant_tph"] > 0.1
    )
    r["NCV_Instant_10min_MJkg"] = r["NCV_Instant_10min_MJkg_RAW"].where(instant_valid)
    r["NCV_Instant_10min_DisplayHold"] = r["NCV_Instant_10min_MJkg"].ffill()

    r["WasteHeatInput_3h_kW"] = r["WasteHeatInput_kW"].rolling(roll3_slots, min_periods=roll3_slots).mean()
    r["WasteHeatInput_8h_kW"] = r["WasteHeatInput_kW"].rolling(roll8_slots, min_periods=roll8_slots).mean()

    r["NCV_3h_MJkg_RAW"] = r["WasteHeatInput_3h_kW"] * 3.6 / r["Throughput_3h_tph"] / 1000.0
    r["NCV_8h_MJkg_RAW"] = r["WasteHeatInput_8h_kW"] * 3.6 / r["Throughput_8h_tph"] / 1000.0

    r["NCV_3h_MJkg"] = r["NCV_3h_MJkg_RAW"].where(r["NCV_3h_Valid"])
    r["NCV_8h_MJkg"] = r["NCV_8h_MJkg_RAW"].where(r["NCV_8h_Valid"])
    r["NCV_3h_DisplayHold"] = r["NCV_3h_MJkg"].ffill()
    r["NCV_8h_DisplayHold"] = r["NCV_8h_MJkg"].ffill()

    # Clean output for one line
    out = pd.DataFrame({
        "Date Time": r["Date Time"],
        "Counter_Today_t": r["counter_today"],
        "Waste_Interval_t": r["Waste_Interval_t"],
        "Counter_Reset": r["Counter_Reset"],
        "Counter_Unexpected_Reset": r["Counter_Unexpected_Reset"],
        "Throughput_Instant_tph": r["Throughput_Instant_tph"],
        "Throughput_3h_tph": r["Throughput_3h_tph"],
        "Throughput_8h_tph": r["Throughput_8h_tph"],
        "WasteHeatInput_Instant_MW": r["WasteHeatInput_Instant_MW"],
        "WasteHeatInput_3h_MW": r["WasteHeatInput_3h_kW"] / 1000.0,
        "WasteHeatInput_8h_MW": r["WasteHeatInput_8h_kW"] / 1000.0,
        "NCV_Active": r["NCV_Active"],
        "NCV_Instant_10min_MJkg": r["NCV_Instant_10min_MJkg"],
        "NCV_Instant_10min_DisplayHold": r["NCV_Instant_10min_DisplayHold"],
        "NCV_3h_MJkg": r["NCV_3h_MJkg"],
        "NCV_8h_MJkg": r["NCV_8h_MJkg"],
        "NCV_3h_DisplayHold": r["NCV_3h_DisplayHold"],
        "NCV_8h_DisplayHold": r["NCV_8h_DisplayHold"],
    })

    meta = {
        "line": line,
        "interval_min": interval_min,
        "distribution_slots": dist_slots,
        "startup_slots": startup_slots,
        "valid3_slots": valid3_slots,
        "valid8_slots": valid8_slots,
        "roll3_slots": roll3_slots,
        "roll8_slots": roll8_slots,
        "counter_today": tags["counter_today"],
        "counter_yesterday": tags["counter_yesterday"],
        "instant_ncv_note": "Engineering estimate using current Waste Heat Input and 30-min-distributed throughput; official HZI outputs are 3h/8h.",
    }
    return out, meta


def make_wide(line_results):
    wide = None
    for line, out in sorted(line_results.items()):
        renamed = out.rename(columns={
            c: f"L{line}_{c}" for c in out.columns if c != "Date Time"
        })
        wide = renamed if wide is None else wide.merge(renamed, on="Date Time", how="outer")
    return wide.sort_values("Date Time").reset_index(drop=True)


def write_excel(path, line_results, wide, meta_rows):
    with pd.ExcelWriter(path, engine="openpyxl") as writer:
        wide.to_excel(writer, sheet_name="All_Lines", index=False)
        for line, out in sorted(line_results.items()):
            out.to_excel(writer, sheet_name=f"Line{line}", index=False)
        pd.DataFrame(meta_rows).to_excel(writer, sheet_name="Run_Info", index=False)

        # Practical workbook formatting
        wb = writer.book
        for ws in wb.worksheets:
            ws.freeze_panes = "A2"
            ws.auto_filter.ref = ws.dimensions
            for col in ws.columns:
                letter = col[0].column_letter
                max_len = min(30, max(len(str(cell.value)) if cell.value is not None else 0 for cell in col) + 2)
                ws.column_dimensions[letter].width = max(12, max_len)


def main():
    parser = argparse.ArgumentParser(description="HZI Rev.3.1 Waste NCV - 3 line calculator")
    parser.add_argument("input", help="Historian Excel file")
    parser.add_argument("-o", "--output", default="ncv_3lines_10min.xlsx", help="Output Excel file")
    parser.add_argument("--csv", default="ncv_3lines_10min.csv", help="Output wide CSV file")
    parser.add_argument("--lines", nargs="+", type=int, choices=[1, 2, 3], default=[1, 2, 3], help="Lines to calculate")
    parser.add_argument("--strict", action="store_true", help="Fail if any requested line is missing required tags")
    args = parser.parse_args()

    input_file = Path(args.input)
    if not input_file.exists():
        raise FileNotFoundError(f"Input dosyasi bulunamadi: {input_file}")

    df = load(input_file)
    if "Date Time" not in df.columns:
        raise KeyError("Date Time kolonu bulunamadi")

    line_results = {}
    meta_rows = []
    errors = []

    for line in args.lines:
        try:
            out, meta = calculate_line(df, line)
            line_results[line] = out
            meta_rows.append(meta)
            print(f"Line {line}: OK")
        except Exception as exc:
            msg = f"Line {line}: {exc}"
            errors.append(msg)
            print(msg)
            if args.strict:
                raise

    if not line_results:
        raise RuntimeError("Hicbir hat hesaplanamadi. Historian taglarini kontrol edin.")

    wide = make_wide(line_results)
    write_excel(args.output, line_results, wide, meta_rows)
    wide.to_csv(args.csv, index=False)

    print("\nHesap tamamlandi.")
    print(f"Excel: {args.output}")
    print(f"CSV  : {args.csv}")
    if errors:
        print("\nAtlanan hatlar / uyarilar:")
        for msg in errors:
            print(" -", msg)

    print("\nSon kayitlar:")
    cols = ["Date Time"]
    for line in sorted(line_results):
        cols.extend([
            f"L{line}_NCV_Instant_10min_MJkg",
            f"L{line}_NCV_3h_MJkg",
            f"L{line}_NCV_8h_MJkg",
        ])
    print(wide[cols].tail(10).to_string(index=False))


if __name__ == "__main__":
    main()
