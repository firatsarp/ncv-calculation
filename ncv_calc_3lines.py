import sys
import re
import io
import math
import argparse
from pathlib import Path

import numpy as np
import pandas as pd


# ============================================================
# HZI 90101284 REV. 3.1 - WASTE NCV
# 3-LINE HISTORIAN VERSION
#
# - Reads original historian-style headers such as:
#     (A) 1LBA10CF901-XR01.UNIT1@NET1
# - Also accepts simplified KKS headers such as:
#     1 LBA10 CF901
# - Calculates:
#     Instant / 10-min engineering NCV estimate
#     3-hour NCV
#     8-hour NCV
# - Waste counters:
#     L1 = XE56 Today
#     L2 = XE58 Today
#     L3 = XE60 Today
# ============================================================

T_REF = 18.0

AIR_DENSITY = 1.281          # kg/Nm3
FG_DENSITY = 1.235           # kg/Nm3
AIR_TO_FG = 1.234
PROCESS_AIR = 7464.0         # Nm3/h, Rev. 3.1 logic

WATER_DENSITY = 999.2        # kg/m3
WATER_VAPOR = 1.244          # Nm3/kg
WATER_NCV = -2470.5614       # kJ/kg

BLOWDOWN = 330.0             # kg/h
BOTTOM_ASH_LOSS = 132.277    # kJ/kg waste
FLY_ASH_LOSS = 10.2414       # kJ/kg waste
RADIATION_LOSS = 675.0       # kW

STEAM_MIN = 76.08            # t/h
MIN_INSTANT_TPH = 0.1

TODAY_COUNTER = {
    1: "0EAF05EK001XE56",
    2: "0EAF05EK001XE58",
    3: "0EAF05EK001XE60",
}

YESTERDAY_COUNTER = {
    1: "0EAF05EK001XE55",
    2: "0EAF05EK001XE57",
    3: "0EAF05EK001XE59",
}


# ============================================================
# LOOKUP TABLES
# ============================================================

PRIMARY_CP_X = np.array([
    12.0, 29.3, 46.5, 63.8,
    81.0, 98.3, 115.5, 132.8, 150.0
])
PRIMARY_CP_Y = np.array([
    1.011, 1.012, 1.013, 1.014,
    1.015, 1.016, 1.018, 1.020, 1.023
])

SECONDARY_CP_X = np.array([
    12.0, 23.0, 34.0, 45.0,
    56.0, 67.0, 78.0, 89.0, 100.0
])
SECONDARY_CP_Y = np.array([
    1.011, 1.012, 1.012, 1.013,
    1.013, 1.014, 1.015, 1.016, 1.017
])

PROCESS_CP_X = np.array([
    12.0, 16.8, 21.5, 26.3,
    31.0, 35.8, 40.5, 45.3, 50.0
])
PROCESS_CP_Y = np.array([
    1.011, 1.011, 1.012, 1.012,
    1.012, 1.012, 1.012, 1.013, 1.013
])

FG_CP_X = np.array([
    0.0, 18.8, 37.5, 56.3,
    75.0, 93.8, 112.5, 131.3, 150.0
])
FG_CP_Y = np.array([
    1.096, 1.100, 1.104, 1.108,
    1.113, 1.117, 1.122, 1.127, 1.132
])

FEEDWATER_T = np.array([
    95, 105, 110, 115, 120,
    125, 130, 135, 145
])
FEEDWATER_H = np.array([
    404.44, 446.42, 467.46,
    488.53, 509.64, 530.79,
    551.98, 573.22, 615.85
])

STEAM_T = np.array([
    401, 411, 416, 421, 426,
    431, 436, 441, 451
])
STEAM_H = np.array([
    3157.90, 3184.63, 3197.82,
    3210.91, 3223.91, 3236.83,
    3249.66, 3262.42, 3287.73
])

DRUM_P = np.array([
    75, 77, 78, 79, 80,
    81, 82, 83, 85
])
BLOWDOWN_H = np.array([
    1292.70, 1302.55, 1307.42,
    1312.27, 1317.08, 1321.86,
    1326.61, 1331.34, 1340.70
])
SAT_STEAM_H = np.array([
    2765.82, 2762.99, 2761.55,
    2760.09, 2758.61, 2757.12,
    2755.60, 2754.07, 2750.96
])


# ============================================================
# GENERIC HELPERS
# ============================================================

def number(v):
    if pd.isna(v):
        return np.nan

    if isinstance(v, (int, float, np.integer, np.floating)):
        return float(v)

    text = str(v).strip().replace(",", ".")

    # Common historian boolean / state texts
    upper = text.upper()
    if upper in {"ON", "TRUE", "YES", "RUN", "RUNNING", "ACTIVE", "OPEN"}:
        return 1.0
    if upper in {"OFF", "FALSE", "NO", "STOP", "STOPPED", "INACTIVE", "CLOSED"}:
        return 0.0

    nums = re.findall(r"[-+]?\d*\.?\d+", text)
    if not nums:
        return np.nan

    return float(nums[-1])


def numeric(series):
    return series.apply(number)


def interp(value, x, y):
    arr = np.asarray(value, dtype=float)
    return np.interp(arr, x, y, left=y[0], right=y[-1])


def norm(text):
    """Normalize historian / KKS headers to alphanumeric uppercase."""
    return re.sub(r"[^A-Z0-9]", "", str(text).upper())


def header_score(col_norm, candidate_norm):
    """
    Score a normalized column against a normalized candidate.
    Higher is better. Allows original historian suffixes such as
    XR01 / XQ01 / UNIT1 / NET1 while also accepting simplified KKS.
    """
    if col_norm == candidate_norm:
        return 10000 + len(candidate_norm)
    if col_norm.startswith(candidate_norm):
        return 9000 + len(candidate_norm)
    if candidate_norm in col_norm:
        return 5000 + len(candidate_norm)
    return -1


def find_column(df, candidates, required=True):
    """Return the best matching original dataframe column."""
    columns = [(c, norm(c)) for c in df.columns]

    best = None
    best_score = -1

    for rank, candidate in enumerate(candidates):
        cn = norm(candidate)
        if not cn:
            continue

        for original, on in columns:
            score = header_score(on, cn)
            if score < 0:
                continue

            # Earlier candidate aliases are preferred.
            score -= rank * 100
            if score > best_score:
                best = original
                best_score = score

    if best is None and required:
        raise KeyError(" / ".join(candidates))

    return best


def find_datetime_column(df):
    candidates = ["Date Time", "Datetime", "DateTime", "Timestamp", "Time"]
    try:
        return find_column(df, candidates, required=True)
    except KeyError:
        # Tolerate historian variations such as "Date / Time" or extra spaces.
        for col in df.columns:
            n = norm(col)
            if "DATE" in n and "TIME" in n:
                return col
        raise


def _excel_source(file):
    """
    Return a fresh Excel source for pandas. Some historian .xls exports are valid
    OLE/BIFF files but omit the unused padding bytes of the final 512-byte OLE
    sector. xlrd can read them but emits a file-size warning. Padding with zeroes
    preserves all file content and makes the compound file sector-aligned.
    """
    file = Path(file)
    if file.suffix.lower() != ".xls":
        return file

    data = file.read_bytes()
    ole_sig = bytes.fromhex("D0CF11E0A1B11AE1")
    if data.startswith(ole_sig) and (len(data) % 512):
        data += b"\x00" * (512 - (len(data) % 512))
    return io.BytesIO(data)


def _read_excel(file, **kwargs):
    file = Path(file)
    source = _excel_source(file)
    engine = "xlrd" if file.suffix.lower() == ".xls" else "openpyxl"
    return pd.read_excel(source, engine=engine, **kwargs)


def _header_row_score(row):
    values = [norm(x) for x in row if pd.notna(x)]
    if not values:
        return -1

    score = 0
    if "DATETIME" in values:
        score += 100000
    if any(("DATE" in v and "TIME" in v) for v in values):
        score += 50000

    # Strong historian signatures. Use all three lines, not only Line 1.
    if any(v.startswith(("1LBA10CF901", "2LBA10CF901", "3LBA10CF901")) for v in values):
        score += 20000

    # Header rows normally contain many KKS-like signal names.
    signal_tokens = ("LBA", "LAB", "HAD", "LBG", "HLA", "HNA", "ETN", "HJY", "EAF")
    signal_count = sum(any(tok in v for tok in signal_tokens) for v in values)
    score += min(signal_count, 60) * 250
    return score


def find_header_row(file):
    try:
        # Some exports contain several metadata rows; 150 keeps detection robust.
        raw = _read_excel(file, header=None, nrows=150)
    except ImportError as e:
        if str(file).lower().endswith(".xls"):
            raise SystemExit(
                "\n.XLS dosyasi icin xlrd gerekli. Codespaces terminalinde:\n"
                "python -m pip install xlrd openpyxl pandas numpy\n"
            ) from e
        raise

    best_row = 0
    best_score = -1
    for i in range(len(raw)):
        score = _header_row_score(raw.iloc[i])
        if score > best_score:
            best_score = score
            best_row = i

    # Require some evidence of a real historian header.
    return best_row if best_score >= 1000 else 0


def load_input(file):
    file = Path(file)
    header = find_header_row(file)

    try:
        df = _read_excel(file, header=header)
    except ImportError as e:
        if file.suffix.lower() == ".xls":
            raise SystemExit(
                "\n.XLS dosyasi icin xlrd gerekli. Codespaces terminalinde:\n"
                "python -m pip install xlrd openpyxl pandas numpy\n"
            ) from e
        raise

    df = df.dropna(axis=0, how="all")
    df.columns = [str(c).strip() for c in df.columns]

    # If the first pass still did not expose the Date/Time header, search a larger
    # raw block and promote the best embedded header row. This covers legacy
    # historian files where the workbook metadata confuses engine header inference.
    try:
        find_datetime_column(df)
    except KeyError:
        raw = _read_excel(file, header=None, nrows=300)
        scores = [(_header_row_score(raw.iloc[i]), i) for i in range(len(raw))]
        score, retry_header = max(scores, default=(-1, 0))
        if score >= 1000 and retry_header != header:
            df = _read_excel(file, header=retry_header)
            df = df.dropna(axis=0, how="all")
            df.columns = [str(c).strip() for c in df.columns]
            header = retry_header

    return df, header


def infer_interval_minutes(dt):
    d = pd.Series(dt).dropna().sort_values().diff().dt.total_seconds().div(60)
    d = d[(d > 0) & (d < 180)]
    if d.empty:
        return 10.0
    return float(d.median())


def consecutive_run(mask):
    run = np.zeros(len(mask), dtype=int)
    n = 0
    for i, state in enumerate(mask):
        if bool(state):
            n += 1
        else:
            n = 0
        run[i] = n
    return run


# ============================================================
# SIGNAL ALIASES
# ============================================================

def aliases_for_line(line):
    n = str(line)

    # Process air temperature in the sample historian export is:
    #   Line 1 -> 1HLA10CT001-XZ51
    #   Line 2 -> 2HLA20CT001-XZ51
    # Therefore both HLA10 CT001 and HLA20 CT001 are accepted.
    if line == 2:
        process_temp = [
            f"{n}HLA20CT001XZ51",
            f"{n}HLA10CT001XZ51",
            f"{n}HLA20CT001",
            f"{n}HLA10CT001",
        ]
    else:
        process_temp = [
            f"{n}HLA10CT001XZ51",
            f"{n}HLA20CT001XZ51",
            f"{n}HLA10CT001",
            f"{n}HLA20CT001",
        ]

    return {
        "steam_flow": [
            f"{n}LBA10CF901XR01",
            f"{n}LBA10CF901",
        ],
        "steam_temp": [
            f"{n}LBA10CT901XR01",
            f"{n}LBA10CT901",
        ],
        "feedwater_temp": [
            f"{n}LAB40CT001XQ01",
            f"{n}LAB40CT001",
        ],
        "drum_pressure": [
            f"{n}HAD10CP004XQ01",
            f"{n}HAD10CP004",
        ],
        "pa_preheater_flow": [
            f"{n}LBG30CF901XR01",
            f"{n}LBG30CF901",
        ],
        "primary_flow": [
            f"{n}HLA10CF901XR01",
            f"{n}HLA10CF901ZQ01",
            f"{n}HLA10CF901",
        ],
        # Rev.3.1 preference CT003; actual sample historian exports CT002.
        "primary_temp": [
            f"{n}HLA10CT003XQ01",
            f"{n}HLA10CT002XQ01",
            f"{n}HLA10CT003",
            f"{n}HLA10CT002",
        ],
        "secondary_flow": [
            f"{n}HLA20CF901XR01",
            f"{n}HLA20CF901ZQ01",
            f"{n}HLA20CF901",
        ],
        "secondary_temp": [
            f"{n}HLA20CT003XQ01",
            f"{n}HLA20CT003",
        ],
        "process_temp": process_temp,
        "fg_temp": [
            f"{n}HNA10CT901XR01",
            f"{n}HNA10CT901",
        ],
        "water": [
            f"{n}ETN40CF001XQ01",
            f"{n}ETN40CF001",
        ],
        # Original historian burner-in-operation signals.
        "burner1": [
            f"{n}HJY10EZ302XJ01",
            f"{n}HJY10EZ302",
            f"{n}HJY10EK001XE28",
        ],
        "burner2": [
            f"{n}HJY20EZ302XJ01",
            f"{n}HJY20EZ302",
            f"{n}HJY20EK001XE28",
        ],
        "counter": [TODAY_COUNTER[line]],
        "counter_yesterday": [YESTERDAY_COUNTER[line]],
    }


def resolve_signals(df, line):
    aliases = aliases_for_line(line)
    mapping = {}
    missing = []

    for key, candidates in aliases.items():
        required = key != "counter_yesterday"
        try:
            mapping[key] = find_column(df, candidates, required=required)
        except KeyError:
            mapping[key] = None
            missing.append(key)

    return mapping, missing


# ============================================================
# WASTE COUNTER LOGIC
# ============================================================

def counter_to_interval_waste(counter, dt, yesterday=None):
    """
    Convert cumulative TODAY counter into interval tonnes.

    Normal positive difference:
        interval waste = current - previous

    Daily reset:
        if counter drops around midnight / early day,
        interval waste = current counter value.

    If Yesterday counter is available, it is retained only as a diagnostic;
    TODAY remains the primary calculation source.
    """
    counter = pd.to_numeric(counter, errors="coerce")
    dt = pd.to_datetime(dt, errors="coerce")

    waste = counter.diff()
    waste.iloc[0] = 0.0

    neg = waste < 0
    date_change = dt.dt.date != dt.shift(1).dt.date
    early_day = dt.dt.hour < 2

    reset = neg & (date_change | early_day)
    unexpected = neg & ~reset

    waste.loc[reset] = counter.loc[reset]
    waste.loc[unexpected] = np.nan
    waste = waste.clip(lower=0)

    flags = pd.Series("", index=counter.index, dtype=object)
    flags.loc[reset] = "DAILY_RESET"
    flags.loc[unexpected] = "UNEXPECTED_COUNTER_DROP"

    if yesterday is not None:
        yesterday = pd.to_numeric(yesterday, errors="coerce")
        # Diagnostic only: mark where a daily reset has a Yesterday value.
        flags.loc[reset & yesterday.notna()] = "DAILY_RESET_YESTERDAY_AVAILABLE"

    return waste, flags


# ============================================================
# LINE CALCULATION
# ============================================================

def calculate_line(df, line, datetime_col):
    mapping, missing = resolve_signals(df, line)

    if missing:
        return None, {
            "line": line,
            "status": "SKIPPED - MISSING REQUIRED SIGNALS",
            "missing": ", ".join(missing),
            "interval_min": np.nan,
            "mapping": mapping,
            "warnings": "",
        }

    r = pd.DataFrame()
    r["Date Time"] = pd.to_datetime(df[datetime_col], errors="coerce")
    r = r[r["Date Time"].notna()].copy()
    idx = r.index

    for key, col in mapping.items():
        if key == "counter_yesterday":
            continue
        r[key] = numeric(df.loc[idx, col])

    if mapping.get("counter_yesterday") is not None:
        r["counter_yesterday"] = numeric(df.loc[idx, mapping["counter_yesterday"]])
    else:
        r["counter_yesterday"] = np.nan

    r = r.sort_values("Date Time").reset_index(drop=True)

    interval_min = infer_interval_minutes(r["Date Time"])
    startup_slots = max(1, int(math.ceil(15.0 / interval_min)))
    valid_3h_slots = max(1, int(math.ceil(210.0 / interval_min)))
    valid_8h_slots = max(1, int(math.ceil(510.0 / interval_min)))
    dist_slots = max(1, int(round(30.0 / interval_min)))
    roll_3h = max(1, int(round(180.0 / interval_min)))
    roll_8h = max(1, int(round(480.0 / interval_min)))

    # --------------------------------------------------------
    # NCV active logic
    # --------------------------------------------------------
    burner = (
        (r["burner1"].fillna(0) > 0.5)
        | (r["burner2"].fillna(0) > 0.5)
    )
    condition = (r["steam_flow"] > STEAM_MIN) & ~burner

    initial_run = consecutive_run(condition)
    active = initial_run >= startup_slots
    active_run = consecutive_run(active)

    r["NCV_Active"] = active.astype(int)
    r["NCV_3h_Valid"] = active & (active_run >= valid_3h_slots)
    r["NCV_8h_Valid"] = active & (active_run >= valid_8h_slots)

    # --------------------------------------------------------
    # Waste counter -> interval mass -> 30-min distribution
    # --------------------------------------------------------
    waste, counter_flag = counter_to_interval_waste(
        r["counter"],
        r["Date Time"],
        r["counter_yesterday"],
    )

    r["WasteTodayCounter_t"] = r["counter"]
    r["Waste_Interval_t"] = waste
    r["Counter_Flag"] = counter_flag

    kernel = np.ones(dist_slots, dtype=float) / dist_slots
    distributed = np.convolve(waste.fillna(0).values, kernel, mode="full")[:len(r)]
    r["Waste_30min_Distributed_t"] = distributed

    # Equivalent instantaneous throughput for each historian interval.
    r["Throughput_Instant_tph"] = (
        r["Waste_30min_Distributed_t"] * (60.0 / interval_min)
    )

    r["Waste_3h_t"] = (
        r["Waste_30min_Distributed_t"]
        .rolling(roll_3h, min_periods=roll_3h)
        .sum()
    )
    r["Waste_8h_t"] = (
        r["Waste_30min_Distributed_t"]
        .rolling(roll_8h, min_periods=roll_8h)
        .sum()
    )

    r["Throughput_3h_tph"] = r["Waste_3h_t"] / 3.0
    r["Throughput_8h_tph"] = r["Waste_8h_t"] / 8.0

    # --------------------------------------------------------
    # Other heat credits
    # --------------------------------------------------------
    cp_primary = interp(
        (r["primary_temp"] + T_REF) / 2.0,
        PRIMARY_CP_X,
        PRIMARY_CP_Y,
    )
    cp_secondary = interp(
        (r["secondary_temp"] + T_REF) / 2.0,
        SECONDARY_CP_X,
        SECONDARY_CP_Y,
    )
    cp_process = interp(
        (r["process_temp"] + T_REF) / 2.0,
        PROCESS_CP_X,
        PROCESS_CP_Y,
    )

    q_primary = (
        r["primary_flow"] / 3600.0
        * AIR_DENSITY
        * cp_primary
        * (r["primary_temp"] - T_REF)
    )
    q_secondary = (
        r["secondary_flow"] / 3600.0
        * AIR_DENSITY
        * cp_secondary
        * (r["secondary_temp"] - T_REF)
    )
    q_process = (
        PROCESS_AIR / 3600.0
        * AIR_DENSITY
        * cp_process
        * (r["process_temp"] - T_REF)
    )

    water_kg_h = r["water"] * WATER_DENSITY
    q_water = water_kg_h / 3600.0 * WATER_NCV
    q_other = q_primary + q_secondary + q_process + q_water

    # --------------------------------------------------------
    # Useful heat
    # --------------------------------------------------------
    h_fw = interp(r["feedwater_temp"], FEEDWATER_T, FEEDWATER_H)
    h_steam = interp(r["steam_temp"], STEAM_T, STEAM_H)

    # FDS lookup-table logic uses drum pressure + ~1 bar.
    p_abs = r["drum_pressure"] + 1.0
    h_bd = interp(p_abs, DRUM_P, BLOWDOWN_H)
    h_sat = interp(p_abs, DRUM_P, SAT_STEAM_H)

    steam_kg_s = r["steam_flow"] * 1000.0 / 3600.0
    q_steam = steam_kg_s * (h_steam - h_fw)

    q_bd = BLOWDOWN / 3600.0 * (h_bd - h_fw)

    pa_steam_kg_s = r["pa_preheater_flow"] * 1000.0 / 3600.0
    q_pa_preheater = pa_steam_kg_s * (h_sat - h_fw)

    q_useful = q_steam + q_bd + q_pa_preheater

    # --------------------------------------------------------
    # Flue gas loss
    # --------------------------------------------------------
    water_fg_nm3h = water_kg_h * WATER_VAPOR

    fg_nm3h = (
        (r["primary_flow"] + r["secondary_flow"] + PROCESS_AIR)
        * AIR_TO_FG
        + water_fg_nm3h
    )
    fg_kg_s = fg_nm3h * FG_DENSITY / 3600.0

    cp_fg = interp(
        (r["fg_temp"] + T_REF) / 2.0,
        FG_CP_X,
        FG_CP_Y,
    )
    q_fg = fg_kg_s * cp_fg * (r["fg_temp"] - T_REF)

    # --------------------------------------------------------
    # Ash + radiation losses
    # HZI structure uses 3h throughput for ash loss terms.
    # --------------------------------------------------------
    mb = r["Throughput_3h_tph"]
    q_bottom = mb / 3.6 * BOTTOM_ASH_LOSS
    q_fly = mb / 3.6 * FLY_ASH_LOSS
    q_losses = q_fg + q_bottom + q_fly + RADIATION_LOSS

    # --------------------------------------------------------
    # Waste heat input
    # --------------------------------------------------------
    q_waste = q_useful + q_losses - q_other
    r["WasteHeatInput_Instant_kW"] = q_waste

    r["WasteHeatInput_3h_kW"] = (
        r["WasteHeatInput_Instant_kW"]
        .rolling(roll_3h, min_periods=roll_3h)
        .mean()
    )
    r["WasteHeatInput_8h_kW"] = (
        r["WasteHeatInput_Instant_kW"]
        .rolling(roll_8h, min_periods=roll_8h)
        .mean()
    )

    # --------------------------------------------------------
    # NCV
    # kW * 3.6 / (t/h) / 1000 = MJ/kg
    # --------------------------------------------------------
    instant_ok = active & (r["Throughput_Instant_tph"] > MIN_INSTANT_TPH)

    r["NCV_Instant_10min_MJkg_RAW"] = (
        r["WasteHeatInput_Instant_kW"]
        * 3.6
        / r["Throughput_Instant_tph"]
        / 1000.0
    )
    r["NCV_3h_MJkg_RAW"] = (
        r["WasteHeatInput_3h_kW"]
        * 3.6
        / r["Throughput_3h_tph"]
        / 1000.0
    )
    r["NCV_8h_MJkg_RAW"] = (
        r["WasteHeatInput_8h_kW"]
        * 3.6
        / r["Throughput_8h_tph"]
        / 1000.0
    )

    r["NCV_Instant_10min_MJkg"] = r["NCV_Instant_10min_MJkg_RAW"].where(instant_ok)
    r["NCV_3h_MJkg"] = r["NCV_3h_MJkg_RAW"].where(r["NCV_3h_Valid"])
    r["NCV_8h_MJkg"] = r["NCV_8h_MJkg_RAW"].where(r["NCV_8h_Valid"])

    r["NCV_Instant_DisplayHold"] = r["NCV_Instant_10min_MJkg"].ffill()
    r["NCV_3h_DisplayHold"] = r["NCV_3h_MJkg"].ffill()
    r["NCV_8h_DisplayHold"] = r["NCV_8h_MJkg"].ffill()

    # MW outputs
    r["WasteHeatInput_Instant_MW"] = r["WasteHeatInput_Instant_kW"] / 1000.0
    r["WasteHeatInput_3h_MW"] = r["WasteHeatInput_3h_kW"] / 1000.0
    r["WasteHeatInput_8h_MW"] = r["WasteHeatInput_8h_kW"] / 1000.0

    # Selected result columns
    output_cols = [
        "Date Time",
        "WasteTodayCounter_t",
        "Waste_Interval_t",
        "Waste_30min_Distributed_t",
        "Counter_Flag",
        "Throughput_Instant_tph",
        "Throughput_3h_tph",
        "Throughput_8h_tph",
        "WasteHeatInput_Instant_MW",
        "WasteHeatInput_3h_MW",
        "WasteHeatInput_8h_MW",
        "NCV_Active",
        "NCV_3h_Valid",
        "NCV_8h_Valid",
        "NCV_Instant_10min_MJkg",
        "NCV_3h_MJkg",
        "NCV_8h_MJkg",
        "NCV_Instant_DisplayHold",
        "NCV_3h_DisplayHold",
        "NCV_8h_DisplayHold",
    ]

    warnings = []
    process_used = norm(mapping["process_temp"])
    if f"{line}HLA20CT001" in process_used:
        warnings.append("Process temp fallback uses HLA20 CT001")
    primary_used = norm(mapping["primary_temp"])
    if f"{line}HLA10CT002" in primary_used:
        warnings.append("Primary air temp fallback uses CT002")

    status = {
        "line": line,
        "status": "OK",
        "missing": "",
        "interval_min": interval_min,
        "mapping": mapping,
        "warnings": "; ".join(warnings),
    }

    return r[output_cols].copy(), status


# ============================================================
# COMBINE / EXPORT
# ============================================================

def prefix_line_columns(df, line):
    rename = {}
    for c in df.columns:
        if c != "Date Time":
            rename[c] = f"L{line}_{c}"
    return df.rename(columns=rename)


def make_run_info(statuses, input_file, header_row):
    rows = []
    for s in statuses:
        base = {
            "Input_File": str(input_file),
            "Header_Row_Excel": header_row + 1,
            "Line": s["line"],
            "Status": s["status"],
            "Interval_min": s["interval_min"],
            "Missing": s["missing"],
            "Warnings": s["warnings"],
        }
        rows.append(base)

        for key, col in (s.get("mapping") or {}).items():
            rows.append({
                "Input_File": "",
                "Header_Row_Excel": "",
                "Line": s["line"],
                "Status": f"TAG:{key}",
                "Interval_min": "",
                "Missing": "",
                "Warnings": "",
                "Resolved_Historian_Column": "" if col is None else str(col),
            })

    info = pd.DataFrame(rows)
    if "Resolved_Historian_Column" not in info.columns:
        info["Resolved_Historian_Column"] = ""
    return info


def calculate_all(input_file, output_xlsx, output_csv):
    df, header_row = load_input(input_file)
    datetime_col = find_datetime_column(df)

    line_results = {}
    statuses = []

    for line in (1, 2, 3):
        result, status = calculate_line(df, line, datetime_col)
        statuses.append(status)
        if result is not None:
            line_results[line] = result

    if not line_results:
        print("\nHicbir hat hesaplanamadi. Eksik sinyaller:")
        for s in statuses:
            print(f"Line {s['line']}: {s['missing']}")
        raise SystemExit(1)

    combined = None
    for line in (1, 2, 3):
        if line not in line_results:
            continue
        p = prefix_line_columns(line_results[line], line)
        if combined is None:
            combined = p
        else:
            combined = combined.merge(p, on="Date Time", how="outer")

    combined = combined.sort_values("Date Time").reset_index(drop=True)
    run_info = make_run_info(statuses, input_file, header_row)

    with pd.ExcelWriter(output_xlsx, engine="openpyxl") as writer:
        combined.to_excel(writer, sheet_name="All_Lines", index=False)
        for line in (1, 2, 3):
            if line in line_results:
                line_results[line].to_excel(writer, sheet_name=f"Line{line}", index=False)
        run_info.to_excel(writer, sheet_name="Run_Info", index=False)

    combined.to_csv(output_csv, index=False)

    print("\nHesap tamamlandi.")
    print(f"Excel: {output_xlsx}")
    print(f"CSV  : {output_csv}")
    print()

    for s in statuses:
        print(f"Line {s['line']}: {s['status']}")
        if s["missing"]:
            print(f"  Missing: {s['missing']}")
        if s["warnings"]:
            print(f"  Warning: {s['warnings']}")

    print("\nNot: Instant NCV, 10-minute historian resolution icin engineering estimate'tir.")
    print("HZI resmi uzun-donem NCV ciktilari 3h ve 8h degerleridir.")


def main():
    parser = argparse.ArgumentParser(
        description="HZI Rev.3.1 Waste NCV - 3 line historian calculator"
    )
    parser.add_argument("input", help="Historian Excel file (.xls or .xlsx)")
    parser.add_argument(
        "--output",
        default="ncv_3lines_10min_3h_8h.xlsx",
        help="Output Excel file",
    )
    parser.add_argument(
        "--csv",
        default="ncv_3lines_10min_3h_8h.csv",
        help="Output CSV file",
    )
    args = parser.parse_args()

    calculate_all(args.input, args.output, args.csv)


if __name__ == "__main__":
    main()
