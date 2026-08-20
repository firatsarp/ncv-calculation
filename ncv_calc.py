import sys
import re
import numpy as np
import pandas as pd
from pathlib import Path


# ============================================================
# HZI 90101284 REV. 3.1
# LINE 1 WASTE NCV
# 10-MIN HISTORIAN DATA
# ============================================================

T_REF = 18.0

AIR_DENSITY = 1.281          # kg/Nm3
FG_DENSITY = 1.235           # kg/Nm3
AIR_TO_FG = 1.234

# Rev.3.1 calculation logic
PROCESS_AIR = 7464.0         # Nm3/h

WATER_DENSITY = 999.2        # kg/m3
WATER_VAPOR = 1.244          # Nm3/kg
WATER_NCV = -2470.5614       # kJ/kg

BLOWDOWN = 330.0             # kg/h

BOTTOM_ASH_LOSS = 132.277    # kJ/kg waste
FLY_ASH_LOSS = 10.2414       # kJ/kg waste
RADIATION_LOSS = 675.0       # kW

STEAM_MIN = 76.08            # t/h

LINE1_COUNTER = "0 EAF05 EK001 XE56"


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

    return np.interp(
        arr,
        x,
        y,
        left=y[0],
        right=y[-1]
    )


def find_header(file):

    raw = pd.read_excel(
        file,
        header=None,
        nrows=20
    )

    for i in range(len(raw)):

        values = [
            str(x).strip()
            for x in raw.iloc[i]
            if pd.notna(x)
        ]

        if (
            "Date Time" in values
            or "1 LBA10 CF901" in values
        ):
            return i

    return 0


# ============================================================
# LOAD DATA
# ============================================================

def load(file):

    header = find_header(file)

    df = pd.read_excel(
        file,
        header=header
    )

    df = df.dropna(
        axis=0,
        how="all"
    )

    return df


# ============================================================
# MAIN
# ============================================================

def calculate(df):

    required = [

        "Date Time",

        "1 LBA10 CF901",
        "1 LBA10 CT901",

        "1 LAB40 CT001",
        "1 HAD10 CP004",

        "1 LBG30 CF901",

        "1 HLA10 CF901",
        "1 HLA20 CF901",
        "1 HLA20 CT003",

        "1 HLA10 CT001",

        "1 HNA10 CT901",

        "1 ETN40 CF001",

        "1 HJY10 EK001 XE28",
        "1 HJY20 EK001 XE28",

        LINE1_COUNTER
    ]

    # Primary air temperature:
    # Rev.3.1 M01 logic uses CT003.
    if "1 HLA10 CT003" in df.columns:
        primary_temp_tag = "1 HLA10 CT003"

    elif "1 HLA10 CT002" in df.columns:
        primary_temp_tag = "1 HLA10 CT002"

    else:
        raise Exception(
            "Primary air temperature bulunamadi: "
            "1 HLA10 CT003 / CT002"
        )


    missing = [
        x for x in required
        if x not in df.columns
    ]

    if missing:
        print("\nEksik taglar:")

        for x in missing:
            print(x)

        raise SystemExit(1)


    # --------------------------------------------------------
    # Prepare
    # --------------------------------------------------------

    r = pd.DataFrame()

    r["Date Time"] = pd.to_datetime(
        df["Date Time"],
        errors="coerce"
    )

    r = r[r["Date Time"].notna()].copy()

    idx = r.index


    tags = {

        "steam_flow":
            "1 LBA10 CF901",

        "steam_temp":
            "1 LBA10 CT901",

        "feedwater_temp":
            "1 LAB40 CT001",

        "drum_pressure":
            "1 HAD10 CP004",

        "pa_preheater_flow":
            "1 LBG30 CF901",

        "primary_flow":
            "1 HLA10 CF901",

        "primary_temp":
            primary_temp_tag,

        "secondary_flow":
            "1 HLA20 CF901",

        "secondary_temp":
            "1 HLA20 CT003",

        "process_temp":
            "1 HLA10 CT001",

        "fg_temp":
            "1 HNA10 CT901",

        "water":
            "1 ETN40 CF001",

        "burner1":
            "1 HJY10 EK001 XE28",

        "burner2":
            "1 HJY20 EK001 XE28",

        "counter":
            LINE1_COUNTER
    }


    for name, tag in tags.items():

        r[name] = numeric(
            df.loc[idx, tag]
        )


    r = r.sort_values(
        "Date Time"
    ).reset_index(drop=True)


    # ========================================================
    # NCV ACTIVE LOGIC
    # ========================================================

    burner = (
        (r["burner1"].fillna(0) > 0.5)
        |
        (r["burner2"].fillna(0) > 0.5)
    )

    steam_ok = (
        r["steam_flow"] > STEAM_MIN
    )

    condition = (
        steam_ok
        &
        ~burner
    )


    # 10-minute historian:
    # 15 min delay -> approx 2 samples = 20 min

    run = np.zeros(len(r), dtype=int)

    n = 0

    for i, state in enumerate(condition):

        if state:
            n += 1

        else:
            n = 0

        run[i] = n


    active = run >= 2


    active_run = np.zeros(
        len(r),
        dtype=int
    )

    n = 0

    for i, state in enumerate(active):

        if state:
            n += 1

        else:
            n = 0

        active_run[i] = n


    r["NCV_Active"] = active.astype(int)

    # FDS:
    # 3h output active after 210 min = 21 samples
    # 8h output active after 510 min = 51 samples

    r["NCV_3h_Valid"] = (
        active
        &
        (active_run >= 21)
    )

    r["NCV_8h_Valid"] = (
        active
        &
        (active_run >= 51)
    )


    # ========================================================
    # XE56 -> WASTE MASS PER 10 MIN
    # ========================================================

    counter = r["counter"]

    waste = counter.diff()

    waste.iloc[0] = 0.0


    # Daily reset:
    #
    # 700 t
    # 5 t
    #
    # diff negative
    # new waste = 5 t

    reset = waste < 0

    waste.loc[reset] = (
        counter.loc[reset]
    )

    waste = waste.clip(lower=0)


    r["XE56_Counter_t"] = counter
    r["Waste_10min_t"] = waste


    # ========================================================
    # HZI 30 MIN DISTRIBUTION
    # ========================================================

    distributed = np.convolve(

        waste.fillna(0).values,

        np.array([
            1/3,
            1/3,
            1/3
        ]),

        mode="full"

    )[:len(r)]


    r["Waste_30min_Distributed_t"] = (
        distributed
    )


    # ========================================================
    # 3h / 8h THROUGHPUT
    # ========================================================

    r["Waste_3h_t"] = (

        r["Waste_30min_Distributed_t"]

        .rolling(
            18,
            min_periods=18
        )

        .sum()
    )


    r["Waste_8h_t"] = (

        r["Waste_30min_Distributed_t"]

        .rolling(
            48,
            min_periods=48
        )

        .sum()
    )


    r["Throughput_3h_tph"] = (
        r["Waste_3h_t"] / 3
    )

    r["Throughput_8h_tph"] = (
        r["Waste_8h_t"] / 8
    )


    # ========================================================
    # OTHER HEAT CREDITS
    # ========================================================

    tmean = (
        r["primary_temp"] + T_REF
    ) / 2

    cp_primary = interp(
        tmean,
        PRIMARY_CP_X,
        PRIMARY_CP_Y
    )


    tmean = (
        r["secondary_temp"] + T_REF
    ) / 2

    cp_secondary = interp(
        tmean,
        SECONDARY_CP_X,
        SECONDARY_CP_Y
    )


    tmean = (
        r["process_temp"] + T_REF
    ) / 2

    cp_process = interp(
        tmean,
        PROCESS_CP_X,
        PROCESS_CP_Y
    )


    q_primary = (

        r["primary_flow"]
        / 3600

        * AIR_DENSITY

        * cp_primary

        * (
            r["primary_temp"]
            - T_REF
        )
    )


    q_secondary = (

        r["secondary_flow"]
        / 3600

        * AIR_DENSITY

        * cp_secondary

        * (
            r["secondary_temp"]
            - T_REF
        )
    )


    q_process = (

        PROCESS_AIR
        / 3600

        * AIR_DENSITY

        * cp_process

        * (
            r["process_temp"]
            - T_REF
        )
    )


    water_kg_h = (
        r["water"]
        *
        WATER_DENSITY
    )


    q_water = (

        water_kg_h
        / 3600

        * WATER_NCV
    )


    q_other = (

        q_primary
        +
        q_secondary
        +
        q_process
        +
        q_water
    )


    # ========================================================
    # USEFUL HEAT
    # ========================================================

    h_fw = interp(

        r["feedwater_temp"],

        FEEDWATER_T,

        FEEDWATER_H
    )


    h_steam = interp(

        r["steam_temp"],

        STEAM_T,

        STEAM_H
    )


    # FDS logic uses drum pressure + ~1 bar
    p_abs = (
        r["drum_pressure"]
        +
        1
    )


    h_bd = interp(

        p_abs,

        DRUM_P,

        BLOWDOWN_H
    )


    h_sat = interp(

        p_abs,

        DRUM_P,

        SAT_STEAM_H
    )


    steam_kg_s = (

        r["steam_flow"]

        * 1000

        / 3600
    )


    q_steam = (

        steam_kg_s

        *
        (
            h_steam
            -
            h_fw
        )
    )


    q_bd = (

        BLOWDOWN

        / 3600

        *
        (
            h_bd
            -
            h_fw
        )
    )


    pa_steam_kg_s = (

        r["pa_preheater_flow"]

        * 1000

        / 3600
    )


    q_pa_preheater = (

        pa_steam_kg_s

        *
        (
            h_sat
            -
            h_fw
        )
    )


    q_useful = (

        q_steam

        +
        q_bd

        +
        q_pa_preheater
    )


    # ========================================================
    # FLUE GAS LOSS
    # ========================================================

    water_fg_nm3h = (

        water_kg_h

        *
        WATER_VAPOR
    )


    fg_nm3h = (

        (
            r["primary_flow"]
            +
            r["secondary_flow"]
            +
            PROCESS_AIR
        )

        *
        AIR_TO_FG

        +
        water_fg_nm3h
    )


    fg_kg_s = (

        fg_nm3h

        *
        FG_DENSITY

        / 3600
    )


    fg_mean_temp = (

        r["fg_temp"]

        +
        T_REF

    ) / 2


    cp_fg = interp(

        fg_mean_temp,

        FG_CP_X,

        FG_CP_Y
    )


    q_fg = (

        fg_kg_s

        *
        cp_fg

        *
        (
            r["fg_temp"]
            -
            T_REF
        )
    )


    # ========================================================
    # ASH LOSSES
    # ========================================================

    mb = (
        r["Throughput_3h_tph"]
    )


    q_bottom = (

        mb
        / 3.6

        *
        BOTTOM_ASH_LOSS
    )


    q_fly = (

        mb
        / 3.6

        *
        FLY_ASH_LOSS
    )


    q_losses = (

        q_fg

        +
        q_bottom

        +
        q_fly

        +
        RADIATION_LOSS
    )


    # ========================================================
    # WASTE HEAT INPUT
    # ========================================================

    q_waste = (

        q_useful

        +
        q_losses

        -
        q_other
    )


    r["WasteHeatInput_kW"] = q_waste


    r["WasteHeatInput_3h_kW"] = (

        r["WasteHeatInput_kW"]

        .rolling(
            18,
            min_periods=18
        )

        .mean()
    )


    r["WasteHeatInput_8h_kW"] = (

        r["WasteHeatInput_kW"]

        .rolling(
            48,
            min_periods=48
        )

        .mean()
    )


    # ========================================================
    # NCV
    #
    # kW * 3.6 / t/h = kJ/kg
    # ========================================================

    r["NCV_3h_MJkg_RAW"] = (

        r["WasteHeatInput_3h_kW"]

        *
        3.6

        /
        r["Throughput_3h_tph"]

        /
        1000
    )


    r["NCV_8h_MJkg_RAW"] = (

        r["WasteHeatInput_8h_kW"]

        *
        3.6

        /
        r["Throughput_8h_tph"]

        /
        1000
    )


    r["NCV_3h_MJkg"] = (

        r["NCV_3h_MJkg_RAW"]

        .where(
            r["NCV_3h_Valid"]
        )
    )


    r["NCV_8h_MJkg"] = (

        r["NCV_8h_MJkg_RAW"]

        .where(
            r["NCV_8h_Valid"]
        )
    )


    # DCS-style hold columns
    r["NCV_3h_DisplayHold"] = (
        r["NCV_3h_MJkg"]
        .ffill()
    )

    r["NCV_8h_DisplayHold"] = (
        r["NCV_8h_MJkg"]
        .ffill()
    )


    # ========================================================
    # SIMPLE 10-MIN OUTPUT
    # ========================================================

    output = r[[
        "Date Time",

        "XE56_Counter_t",
        "Waste_10min_t",

        "Throughput_3h_tph",
        "Throughput_8h_tph",

        "WasteHeatInput_3h_kW",
        "WasteHeatInput_8h_kW",

        "NCV_Active",

        "NCV_3h_MJkg",
        "NCV_8h_MJkg",

        "NCV_3h_DisplayHold",
        "NCV_8h_DisplayHold"
    ]].copy()


    output["WasteHeatInput_3h_MW"] = (
        output["WasteHeatInput_3h_kW"]
        / 1000
    )

    output["WasteHeatInput_8h_MW"] = (
        output["WasteHeatInput_8h_kW"]
        / 1000
    )


    output = output[[
        "Date Time",

        "XE56_Counter_t",
        "Waste_10min_t",

        "Throughput_3h_tph",
        "Throughput_8h_tph",

        "WasteHeatInput_3h_MW",
        "WasteHeatInput_8h_MW",

        "NCV_Active",

        "NCV_3h_MJkg",
        "NCV_8h_MJkg",

        "NCV_3h_DisplayHold",
        "NCV_8h_DisplayHold"
    ]]


    return output


# ============================================================
# RUN
# ============================================================

if __name__ == "__main__":

    if len(sys.argv) < 2:

        print(
            "\nKullanim:\n"
            "python ncv_calc.py data.xlsx\n"
        )

        raise SystemExit(1)


    input_file = Path(
        sys.argv[1]
    )


    df = load(
        input_file
    )


    result = calculate(
        df
    )


    result.to_excel(
        "ncv_10min_3h_8h.xlsx",
        index=False
    )


    result.to_csv(
        "ncv_10min_3h_8h.csv",
        index=False
    )


    print()
    print(
        "Hesap tamamlandi."
    )

    print(
        "ncv_10min_3h_8h.xlsx"
    )

    print(
        "ncv_10min_3h_8h.csv"
    )


    print()
    print(
        "Son 10 kayit:"
    )

    print(
        result[[
            "Date Time",
            "Throughput_3h_tph",
            "Throughput_8h_tph",
            "NCV_3h_MJkg",
            "NCV_8h_MJkg"
        ]]
        .tail(10)
        .to_string(index=False)
    )
