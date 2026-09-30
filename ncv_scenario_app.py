import io
import math
from pathlib import Path

import numpy as np
import pandas as pd
import streamlit as st

import ncv_calc_3lines as core


APP_TITLE = "Waste NCV & Throughput Scenario Simulator"
APP_VERSION = "2026.09.30-r4"
DEFAULT_Q_LIMIT_MW = 86.8
DEFAULT_MECH_LIMIT_TPH = 46.0
DEFAULT_TARGET_MIN_TPD = 3000.0
DEFAULT_TARGET_MAX_TPD = 3300.0


def interp_linear_extrap(x, xp, fp):
    """1-D interpolation with linear extrapolation at both ends."""
    x = np.asarray(x, dtype=float)
    xp = np.asarray(xp, dtype=float)
    fp = np.asarray(fp, dtype=float)

    y = np.interp(x, xp, fp)
    low = x < xp[0]
    high = x > xp[-1]

    if np.any(low):
        slope = (fp[1] - fp[0]) / (xp[1] - xp[0])
        y[low] = fp[0] + slope * (x[low] - xp[0])

    if np.any(high):
        slope = (fp[-1] - fp[-2]) / (xp[-1] - xp[-2])
        y[high] = fp[-1] + slope * (x[high] - xp[-1])

    return y


def enthalpy_from_table(value, xp, fp, allow_extrapolation=False):
    arr = np.atleast_1d(np.asarray(value, dtype=float))
    if allow_extrapolation:
        out = interp_linear_extrap(arr, xp, fp)
    else:
        if np.any(arr < xp[0]) or np.any(arr > xp[-1]):
            raise ValueError(
                f"Value outside FDS lookup range {xp[0]:.1f}..{xp[-1]:.1f}. "
                "Enable extrapolation only for sensitivity work."
            )
        out = np.interp(arr, xp, fp)
    return float(out[0]) if np.ndim(value) == 0 else out


def resolved_line_frame(df, line, datetime_col):
    mapping, missing = core.resolve_signals(df, line)
    if missing:
        return None, mapping, missing

    r = pd.DataFrame()
    r["Date Time"] = pd.to_datetime(df[datetime_col], errors="coerce")
    r = r[r["Date Time"].notna()].copy()
    idx = r.index

    for key, col in mapping.items():
        if col is None:
            continue
        r[key] = core.numeric(df.loc[idx, col])

    if "counter_yesterday" not in r.columns:
        r["counter_yesterday"] = np.nan

    r = r.sort_values("Date Time").reset_index(drop=True)
    return r, mapping, []


def baseline_from_window(raw_line, calc_line, hours=8):
    end = raw_line["Date Time"].max()
    start = end - pd.Timedelta(hours=hours)
    rw = raw_line[raw_line["Date Time"] >= start].copy()
    cw = calc_line[calc_line["Date Time"] >= start].copy()

    keys = [
        "steam_flow",
        "steam_temp",
        "feedwater_temp",
        "drum_pressure",
        "pa_preheater_flow",
        "primary_flow",
        "primary_temp",
        "secondary_flow",
        "secondary_temp",
        "process_temp",
        "fg_temp",
        "water",
    ]

    baseline = {k: float(rw[k].median()) for k in keys}

    def last_valid(col, fallback=np.nan):
        s = cw[col].dropna()
        return float(s.iloc[-1]) if not s.empty else fallback

    baseline["throughput_8h_tph"] = last_valid("Throughput_8h_tph")
    baseline["ncv_8h_mjkg"] = last_valid("NCV_8h_DisplayHold")
    baseline["throughput_3h_tph"] = last_valid("Throughput_3h_tph")
    baseline["ncv_3h_mjkg"] = last_valid("NCV_3h_DisplayHold")
    baseline["ncv_instant_mjkg"] = last_valid("NCV_Instant_DisplayHold")
    baseline["waste_heat_8h_mw"] = last_valid("WasteHeatInput_8h_MW")
    baseline["window_start"] = start
    baseline["window_end"] = end
    return baseline


def heat_balance(values, throughput_tph, allow_extrapolation=False):
    """
    Steady-state scenario point based on the same simplified Rev.3.1 heat balance
    used by the historian calculator.

    Scenario-only variables may include process_air_flow and selected model
    assumptions. They are not necessarily independent operator setpoints.
    """
    v = dict(values)

    process_air_flow = float(v.get("process_air_flow", core.PROCESS_AIR))
    blowdown = float(v.get("blowdown", core.BLOWDOWN))
    radiation_loss = float(v.get("radiation_loss", core.RADIATION_LOSS))
    bottom_ash_loss = float(v.get("bottom_ash_loss", core.BOTTOM_ASH_LOSS))
    fly_ash_loss = float(v.get("fly_ash_loss", core.FLY_ASH_LOSS))

    cp_primary = float(core.interp(
        np.array([(v["primary_temp"] + core.T_REF) / 2.0]),
        core.PRIMARY_CP_X,
        core.PRIMARY_CP_Y,
    )[0])
    cp_secondary = float(core.interp(
        np.array([(v["secondary_temp"] + core.T_REF) / 2.0]),
        core.SECONDARY_CP_X,
        core.SECONDARY_CP_Y,
    )[0])
    cp_process = float(core.interp(
        np.array([(v["process_temp"] + core.T_REF) / 2.0]),
        core.PROCESS_CP_X,
        core.PROCESS_CP_Y,
    )[0])

    q_primary = (
        v["primary_flow"] / 3600.0
        * core.AIR_DENSITY
        * cp_primary
        * (v["primary_temp"] - core.T_REF)
    )
    q_secondary = (
        v["secondary_flow"] / 3600.0
        * core.AIR_DENSITY
        * cp_secondary
        * (v["secondary_temp"] - core.T_REF)
    )
    q_process = (
        process_air_flow / 3600.0
        * core.AIR_DENSITY
        * cp_process
        * (v["process_temp"] - core.T_REF)
    )

    water_kg_h = v["water"] * core.WATER_DENSITY
    q_water = water_kg_h / 3600.0 * core.WATER_NCV
    q_other = q_primary + q_secondary + q_process + q_water

    h_fw = enthalpy_from_table(
        v["feedwater_temp"],
        core.FEEDWATER_T,
        core.FEEDWATER_H,
        allow_extrapolation,
    )
    h_steam = enthalpy_from_table(
        v["steam_temp"],
        core.STEAM_T,
        core.STEAM_H,
        allow_extrapolation,
    )

    p_abs = v["drum_pressure"] + 1.0
    h_bd = enthalpy_from_table(
        p_abs,
        core.DRUM_P,
        core.BLOWDOWN_H,
        allow_extrapolation,
    )
    h_sat = enthalpy_from_table(
        p_abs,
        core.DRUM_P,
        core.SAT_STEAM_H,
        allow_extrapolation,
    )

    steam_kg_s = v["steam_flow"] * 1000.0 / 3600.0
    q_steam = steam_kg_s * (h_steam - h_fw)
    q_bd = blowdown / 3600.0 * (h_bd - h_fw)
    pa_steam_kg_s = v["pa_preheater_flow"] * 1000.0 / 3600.0
    q_pa_preheater = pa_steam_kg_s * (h_sat - h_fw)
    q_useful = q_steam + q_bd + q_pa_preheater

    water_fg_nm3h = water_kg_h * core.WATER_VAPOR
    fg_nm3h = (
        (v["primary_flow"] + v["secondary_flow"] + process_air_flow)
        * core.AIR_TO_FG
        + water_fg_nm3h
    )
    fg_kg_s = fg_nm3h * core.FG_DENSITY / 3600.0
    cp_fg = float(core.interp(
        np.array([(v["fg_temp"] + core.T_REF) / 2.0]),
        core.FG_CP_X,
        core.FG_CP_Y,
    )[0])
    q_fg = fg_kg_s * cp_fg * (v["fg_temp"] - core.T_REF)

    q_bottom = throughput_tph / 3.6 * bottom_ash_loss
    q_fly = throughput_tph / 3.6 * fly_ash_loss
    q_losses = q_fg + q_bottom + q_fly + radiation_loss

    q_waste_kw = q_useful + q_losses - q_other
    ncv_mjkg = q_waste_kw * 3.6 / throughput_tph / 1000.0

    return {
        "waste_heat_input_mw": q_waste_kw / 1000.0,
        "ncv_mjkg": ncv_mjkg,
        "q_primary_mw": q_primary / 1000.0,
        "q_secondary_mw": q_secondary / 1000.0,
        "q_process_mw": q_process / 1000.0,
        "q_water_mw": q_water / 1000.0,
        "q_useful_mw": q_useful / 1000.0,
        "q_steam_mw": q_steam / 1000.0,
        "q_blowdown_mw": q_bd / 1000.0,
        "q_pa_preheater_mw": q_pa_preheater / 1000.0,
        "q_fg_loss_mw": q_fg / 1000.0,
        "q_bottom_loss_mw": q_bottom / 1000.0,
        "q_fly_loss_mw": q_fly / 1000.0,
        "q_radiation_loss_mw": radiation_loss / 1000.0,
        "q_losses_mw": q_losses / 1000.0,
    }


def projected_capacity(ncv_mjkg, heat_limit_mw, mechanical_limit_tph):
    if not np.isfinite(ncv_mjkg) or ncv_mjkg <= 0:
        return np.nan
    thermal_tph = heat_limit_mw * 3.6 / ncv_mjkg
    return min(thermal_tph, mechanical_limit_tph)


def make_sensitivity_cases(base_values, temp_step, flow_pct, pressure_step, throughput_step):
    """One-at-a-time low/high cases for every changeable scenario variable."""
    cases = []

    def add(label, key, delta, unit, group):
        cases.append((label, key, delta, unit, group))

    # Temperatures
    for label, key in [
        ("Feedwater temperature", "feedwater_temp"),
        ("Primary air temperature", "primary_temp"),
        ("Secondary air temperature", "secondary_temp"),
        ("Process air temperature", "process_temp"),
        ("Flue gas temperature", "fg_temp"),
        ("Live steam temperature", "steam_temp"),
    ]:
        add(label, key, +temp_step, "°C", "Temperature")
        add(label, key, -temp_step, "°C", "Temperature")

    # Flows / mass flows
    for label, key, unit in [
        ("Primary air flow", "primary_flow", "Nm³/h"),
        ("Secondary air flow", "secondary_flow", "Nm³/h"),
        ("Process air flow", "process_air_flow", "Nm³/h"),
        ("Water injection flow", "water", "m³/h"),
        ("Live steam flow", "steam_flow", "t/h"),
        ("PA preheater steam flow", "pa_preheater_flow", "t/h"),
    ]:
        base = float(base_values[key])
        delta = base * flow_pct / 100.0
        add(label, key, +delta, unit, "Flow")
        add(label, key, -delta, unit, "Flow")

    # Drum pressure
    add("Drum pressure", "drum_pressure", +pressure_step, "bar", "Pressure")
    add("Drum pressure", "drum_pressure", -pressure_step, "bar", "Pressure")

    # Throughput itself is an operating scenario dimension, not a heat-balance input variable.
    cases.append(("Waste throughput", "__throughput__", +throughput_step, "t/h", "Throughput"))
    cases.append(("Waste throughput", "__throughput__", -throughput_step, "t/h", "Throughput"))

    return cases


def sensitivity_table(
    baseline_values,
    throughput_tph,
    heat_limit_mw,
    mech_limit_tph,
    allow_extrapolation,
    temp_step,
    flow_pct,
    pressure_step,
    throughput_step,
):
    base = heat_balance(baseline_values, throughput_tph, allow_extrapolation)
    base_cap = projected_capacity(base["ncv_mjkg"], heat_limit_mw, mech_limit_tph)
    rows = []

    for label, key, delta, unit, group in make_sensitivity_cases(
        baseline_values, temp_step, flow_pct, pressure_step, throughput_step
    ):
        scenario = dict(baseline_values)
        scenario_tph = throughput_tph

        if key == "__throughput__":
            scenario_tph = max(0.1, throughput_tph + delta)
        else:
            scenario[key] = scenario[key] + delta

        try:
            calc = heat_balance(scenario, scenario_tph, allow_extrapolation)
        except ValueError:
            continue

        cap = projected_capacity(calc["ncv_mjkg"], heat_limit_mw, mech_limit_tph)
        rows.append({
            "Group": group,
            "Parameter": label,
            "Change": delta,
            "Unit": unit,
            "Scenario throughput basis (t/h)": scenario_tph,
            "Scenario NCV (MJ/kg)": calc["ncv_mjkg"],
            "ΔNCV (MJ/kg)": calc["ncv_mjkg"] - base["ncv_mjkg"],
            "Waste heat input (MW)": calc["waste_heat_input_mw"],
            "Projected capacity / line (t/h)": cap,
            "Δ capacity / line (t/h)": cap - base_cap,
        })

    out = pd.DataFrame(rows)
    if not out.empty:
        out["|Δ capacity|"] = out["Δ capacity / line (t/h)"].abs()
        out = out.sort_values("|Δ capacity|", ascending=False).drop(columns="|Δ capacity|")
    return out


def make_target_table(heat_limit_mw, active_lines, mech_limit_tph):
    rows = []
    for tpd in (3000, 3100, 3200, 3300):
        tph = tpd / 24.0 / active_lines
        req_ncv = heat_limit_mw * 3.6 / tph
        rows.append({
            "Target total t/day": tpd,
            "Per-line t/h": tph,
            "Required NCV at thermal limit (MJ/kg)": req_ncv,
            "Mechanical limit check": "OK" if tph <= mech_limit_tph else "Above limit",
        })
    return pd.DataFrame(rows)




def _last_valid(series):
    s = pd.Series(series).dropna()
    return float(s.iloc[-1]) if not s.empty else np.nan


def hourly_operator_table(
    raw_line,
    calc_line,
    scenario_values,
    target_tpd,
    active_lines,
    heat_limit_mw,
    mech_limit_tph,
    baseline_steam_flow,
):
    """Build an hourly operator-facing summary from historian data.

    The table combines measured hourly process averages with end-of-hour rolling
    NCV/throughput values and the selected engineering scenario references.
    It is decision support only; it does not issue control commands.
    """
    raw_cols = [
        "Date Time",
        "steam_flow", "steam_temp", "feedwater_temp", "drum_pressure",
        "pa_preheater_flow", "primary_flow", "primary_temp",
        "secondary_flow", "secondary_temp", "process_temp",
        "fg_temp", "water",
    ]
    calc_cols = [
        "Date Time", "Waste_Interval_t",
        "Throughput_Instant_tph", "Throughput_3h_tph", "Throughput_8h_tph",
        "WasteHeatInput_Instant_MW", "WasteHeatInput_3h_MW", "WasteHeatInput_8h_MW",
        "NCV_Instant_DisplayHold", "NCV_3h_DisplayHold", "NCV_8h_DisplayHold",
        "NCV_Active",
    ]
    r = raw_line[[c for c in raw_cols if c in raw_line.columns]].copy()
    c = calc_line[[c for c in calc_cols if c in calc_line.columns]].copy()
    m = pd.merge(r, c, on="Date Time", how="inner").sort_values("Date Time")
    if m.empty:
        return pd.DataFrame()

    m = m.set_index("Date Time")
    mean_cols = [
        "steam_flow", "steam_temp", "feedwater_temp", "drum_pressure",
        "pa_preheater_flow", "primary_flow", "primary_temp",
        "secondary_flow", "secondary_temp", "process_temp",
        "fg_temp", "water", "Throughput_Instant_tph", "NCV_Active",
    ]
    last_cols = [
        "Throughput_3h_tph", "Throughput_8h_tph",
        "WasteHeatInput_Instant_MW", "WasteHeatInput_3h_MW", "WasteHeatInput_8h_MW",
        "NCV_Instant_DisplayHold", "NCV_3h_DisplayHold", "NCV_8h_DisplayHold",
    ]

    hourly = pd.DataFrame(index=m.resample("1h").size().index)
    if "Waste_Interval_t" in m.columns:
        hourly["Waste burned this hour (t)"] = m["Waste_Interval_t"].resample("1h").sum(min_count=1)
    for col in mean_cols:
        if col in m.columns:
            hourly[col] = m[col].resample("1h").mean()
    for col in last_cols:
        if col in m.columns:
            hourly[col] = m[col].resample("1h").apply(_last_valid)

    hourly = hourly.reset_index().rename(columns={"Date Time": "Hour"})
    target_line_tph = target_tpd / 24.0 / max(active_lines, 1)
    target_line_tph = min(target_line_tph, mech_limit_tph)
    target_ncv_max = heat_limit_mw * 3.6 / target_line_tph

    hourly["Target line throughput (t/h)"] = target_line_tph
    hourly["Target max NCV @ thermal limit (MJ/kg)"] = target_ncv_max
    if "Waste burned this hour (t)" in hourly.columns:
        hourly["Equivalent plant rate (t/day)"] = hourly["Waste burned this hour (t)"] * 24.0 * active_lines
        hourly["Throughput gap to target (t/h)"] = target_line_tph - hourly["Waste burned this hour (t)"]

    if "NCV_8h_DisplayHold" in hourly.columns:
        hourly["NCV margin to target max (MJ/kg)"] = target_ncv_max - hourly["NCV_8h_DisplayHold"]
    if "WasteHeatInput_8h_MW" in hourly.columns:
        hourly["Thermal margin (MW)"] = heat_limit_mw - hourly["WasteHeatInput_8h_MW"]
    if "steam_flow" in hourly.columns:
        hourly["Steam vs baseline (%)"] = 100.0 * (hourly["steam_flow"] / baseline_steam_flow - 1.0)

    # Selected scenario references shown alongside each hour.
    refs = {
        "Ref PA temp (°C)": scenario_values.get("primary_temp"),
        "Ref PA flow (Nm³/h)": scenario_values.get("primary_flow"),
        "Ref SA temp (°C)": scenario_values.get("secondary_temp"),
        "Ref SA flow (Nm³/h)": scenario_values.get("secondary_flow"),
        "Ref Process air temp (°C)": scenario_values.get("process_temp"),
        "Ref Process air flow (Nm³/h)": scenario_values.get("process_air_flow"),
        "Ref Feedwater temp (°C)": scenario_values.get("feedwater_temp"),
        "Ref Steam flow (t/h)": scenario_values.get("steam_flow"),
        "Ref Steam temp (°C)": scenario_values.get("steam_temp"),
        "Ref Drum pressure (bar)": scenario_values.get("drum_pressure"),
        "Ref PA preheater steam (t/h)": scenario_values.get("pa_preheater_flow"),
        "Ref Flue gas temp (°C)": scenario_values.get("fg_temp"),
        "Ref Water injection (m³/h)": scenario_values.get("water"),
    }
    for col, value in refs.items():
        hourly[col] = value

    # Differences to scenario reference - more useful and safer than automatic control commands.
    diff_map = {
        "primary_temp": ("Δ PA temp to ref (°C)", "Ref PA temp (°C)"),
        "primary_flow": ("Δ PA flow to ref (Nm³/h)", "Ref PA flow (Nm³/h)"),
        "secondary_temp": ("Δ SA temp to ref (°C)", "Ref SA temp (°C)"),
        "secondary_flow": ("Δ SA flow to ref (Nm³/h)", "Ref SA flow (Nm³/h)"),
        "feedwater_temp": ("Δ Feedwater temp to ref (°C)", "Ref Feedwater temp (°C)"),
        "steam_flow": ("Δ Steam flow to ref (t/h)", "Ref Steam flow (t/h)"),
        "fg_temp": ("Δ FG temp to ref (°C)", "Ref Flue gas temp (°C)"),
        "water": ("Δ Water injection to ref (m³/h)", "Ref Water injection (m³/h)"),
    }
    for actual, (out, refcol) in diff_map.items():
        if actual in hourly.columns:
            hourly[out] = hourly[refcol] - hourly[actual]

    # Simple operator status flags based on selected target and steam preservation.
    def _status(row):
        parts = []
        ncv = row.get("NCV_8h_DisplayHold", np.nan)
        heat = row.get("WasteHeatInput_8h_MW", np.nan)
        steam = row.get("steam_flow", np.nan)
        waste = row.get("Waste burned this hour (t)", np.nan)
        if np.isfinite(heat) and heat > heat_limit_mw:
            parts.append("THERMAL LIMIT")
        if np.isfinite(ncv) and ncv > target_ncv_max:
            parts.append("NCV ABOVE TARGET")
        if np.isfinite(steam) and steam < baseline_steam_flow:
            parts.append("STEAM BELOW BASELINE")
        if np.isfinite(waste) and waste < target_line_tph:
            parts.append("THROUGHPUT BELOW TARGET")
        return "OK / HOLD" if not parts else " | ".join(parts)

    hourly["Operator status"] = hourly.apply(_status, axis=1)
    return hourly


def excel_bytes(sheets):
    bio = io.BytesIO()
    with pd.ExcelWriter(bio, engine="openpyxl") as writer:
        for name, df in sheets.items():
            df.to_excel(writer, sheet_name=name[:31], index=False)
    return bio.getvalue()


# ============================================================
# UI
# ============================================================

st.set_page_config(page_title=APP_TITLE, layout="wide")
st.title(APP_TITLE + " — R4 XLS FIX")
st.caption(f"Build: {APP_VERSION}")
st.caption(
    "HZI Rev. 3.1 historian-based heat-balance scenario tool for evaluating how "
    "process conditions affect calculated NCV and the 3000–3300 t/day throughput target."
)

with st.expander("Model interpretation / important limitation", expanded=True):
    st.markdown(
        """
- HZI's NCV calculation is a **heat-balance estimate of past combustion conditions**; it is not a direct measurement of future or intrinsic waste NCV.
- The simulator can vary every parameter used by the simplified model, but **not every variable is an independent operator setpoint**. Some are consequences of load, combustion, boiler conditions, or equipment limits.
- Use the tool for engineering sensitivity / scenario studies only. Apply only operating ranges approved by the OEM and site procedures.
- `Feedwater temperature` means the FDS heat-balance boundary temperature used by the NCV model. It should not automatically be equated with a tank temperature unless the signal relationship is confirmed.
        """
    )

uploaded = st.file_uploader("Historian file (.xls or .xlsx)", type=["xls", "xlsx"], key="historian_upload_r3")

st.sidebar.header("Capacity target")
st.sidebar.info("Capacity target / limits change feasibility calculations. Projected NCV changes only when Scenario inputs or waste feed are changed.")
target_min_tpd, target_max_tpd = st.sidebar.slider(
    "Target total waste range (t/day)",
    min_value=2000,
    max_value=3600,
    value=(int(DEFAULT_TARGET_MIN_TPD), int(DEFAULT_TARGET_MAX_TPD)),
    step=50,
    key="target_range_r3",
)
operator_target_tpd = st.sidebar.slider(
    "Operator hourly plan target (t/day)",
    min_value=int(target_min_tpd),
    max_value=int(target_max_tpd),
    value=int((target_min_tpd + target_max_tpd) / 2),
    step=50,
    key="operator_target_r3",
)
active_lines = st.sidebar.number_input("Active lines", 1, 3, 3, 1, key="active_lines_r3")
heat_limit_mw = st.sidebar.number_input(
    "Thermal input limit per line (MW)", 50.0, 110.0, DEFAULT_Q_LIMIT_MW, 0.1, key="heat_limit_r3"
)
mech_limit_tph = st.sidebar.number_input(
    "Mechanical throughput limit per line (t/h)", 20.0, 60.0, DEFAULT_MECH_LIMIT_TPH, 0.1, key="mech_limit_r3"
)
allow_extrapolation = st.sidebar.checkbox(
    "Allow linear extrapolation outside FDS lookup tables", value=False, key="extrapolate_r3"
)

st.sidebar.header("Sensitivity steps")
temp_step = st.sidebar.number_input("Temperature step ±°C", 1.0, 30.0, 10.0, 1.0)
flow_pct = st.sidebar.number_input("Flow step ±%", 1.0, 30.0, 5.0, 1.0)
pressure_step = st.sidebar.number_input("Drum pressure step ±bar", 0.1, 10.0, 2.0, 0.1)
throughput_step = st.sidebar.number_input("Throughput step ±t/h", 0.1, 10.0, 2.0, 0.1)

per_line_target_min_tph = target_min_tpd / 24.0 / active_lines
per_line_target_max_tph = target_max_tpd / 24.0 / active_lines
required_ncv_at_min_target = heat_limit_mw * 3.6 / per_line_target_min_tph
required_ncv_at_max_target = heat_limit_mw * 3.6 / per_line_target_max_tph

c1, c2, c3, c4 = st.columns(4)
c1.metric("Target throughput / line", f"{per_line_target_min_tph:.2f}–{per_line_target_max_tph:.2f} t/h")
c2.metric("NCV @ lower target", f"{required_ncv_at_min_target:.3f} MJ/kg")
c3.metric("NCV @ upper target", f"{required_ncv_at_max_target:.3f} MJ/kg")
c4.metric("3300 mechanical check", "OK" if per_line_target_max_tph <= mech_limit_tph else "Above selected limit")

st.dataframe(
    make_target_table(heat_limit_mw, active_lines, mech_limit_tph).style.format({
        "Per-line t/h": "{:.2f}",
        "Required NCV at thermal limit (MJ/kg)": "{:.3f}",
    }),
    width="stretch",
    hide_index=True,
)

if uploaded is None:
    st.warning("Backend has NOT received a historian file yet. If a file chip is still visible after a server restart, remove it with X and upload the file again.")
    st.stop()

suffix = Path(uploaded.name).suffix.lower()
tmp_path = Path(f"/tmp/ncv_scenario_input{suffix}")
tmp_path.write_bytes(uploaded.getbuffer())

try:
    df, header_row = core.load_input(tmp_path)
    datetime_col = core.find_datetime_column(df)
    st.success(
        f"Historian loaded: {uploaded.name} | rows: {len(df):,} | "
        f"header row: {header_row + 1} | time column: {datetime_col}"
    )
except Exception as exc:
    st.error(f"Input file could not be read: {exc}")
    try:
        cols = [str(c) for c in df.columns[:12]] if "df" in locals() else []
        if cols:
            st.caption("First detected columns: " + " | ".join(cols))
    except Exception:
        pass
    st.info(
        "R4 automatically pads non-sector-aligned legacy .xls files and scans up to "
        "300 rows to locate the real historian header."
    )
    st.stop()

available = []
line_cache = {}
for line in (1, 2, 3):
    raw_line, mapping, missing = resolved_line_frame(df, line, datetime_col)
    calc_line, status = core.calculate_line(df, line, datetime_col)
    line_cache[line] = (raw_line, calc_line, status, mapping, missing)
    if raw_line is not None and calc_line is not None:
        available.append(line)

if not available:
    st.error("No line has all required signals. Check signal mapping / Today waste counters.")
    st.stop()

line = st.selectbox("Line", available, index=0)
window_hours = st.selectbox(
    "Baseline window",
    [3, 8, 24, 72],
    index=1,
    format_func=lambda x: f"Last {x} h median process values",
)
raw_line, calc_line, status, mapping, missing = line_cache[line]
base = baseline_from_window(raw_line, calc_line, window_hours)

st.subheader(f"Line {line} actual baseline")
b1, b2, b3, b4 = st.columns(4)
b1.metric("Actual 8h throughput", f"{base['throughput_8h_tph']:.2f} t/h")
b2.metric("Actual 8h NCV", f"{base['ncv_8h_mjkg']:.3f} MJ/kg")
b3.metric("Actual 3h NCV", f"{base['ncv_3h_mjkg']:.3f} MJ/kg")
b4.metric("Actual 8h waste heat input", f"{base['waste_heat_8h_mw']:.2f} MW")

st.markdown("### Quick actual-data what-if projection")
st.caption(
    "Enter the process values you want to test. All other values remain at the selected historian baseline. "
    "The main projection is calibrated to the ACTUAL 8h NCV, so you can see how changing air flows, "
    "air temperatures and waste feed would move the calculated NCV relative to today's operating point."
)

q1, q2 = st.columns(2)
with q1:
    throughput_basis = st.number_input(
        "Scenario waste feed / line (t/h)",
        min_value=5.0,
        max_value=60.0,
        value=float(base["throughput_8h_tph"]) if np.isfinite(base["throughput_8h_tph"]) else 40.0,
        step=0.1,
        key="quick_waste_tph_r3",
    )
with q2:
    st.metric(
        "Equivalent plant waste rate",
        f"{throughput_basis * 24.0 * active_lines:.0f} t/day",
        f"{throughput_basis * 24.0 * active_lines - base['throughput_8h_tph'] * 24.0 * active_lines:+.0f} t/day vs actual"
        if np.isfinite(base['throughput_8h_tph']) else None,
    )

base_values = {
    "steam_flow": base["steam_flow"],
    "steam_temp": base["steam_temp"],
    "feedwater_temp": base["feedwater_temp"],
    "drum_pressure": base["drum_pressure"],
    "pa_preheater_flow": base["pa_preheater_flow"],
    "primary_flow": base["primary_flow"],
    "primary_temp": base["primary_temp"],
    "secondary_flow": base["secondary_flow"],
    "secondary_temp": base["secondary_temp"],
    "process_temp": base["process_temp"],
    "process_air_flow": float(core.PROCESS_AIR),
    "fg_temp": base["fg_temp"],
    "water": base["water"],
    "blowdown": float(core.BLOWDOWN),
    "radiation_loss": float(core.RADIATION_LOSS),
    "bottom_ash_loss": float(core.BOTTOM_ASH_LOSS),
    "fly_ash_loss": float(core.FLY_ASH_LOSS),
}

st.sidebar.header("Scenario inputs")
st.sidebar.caption(
    "These values directly drive the projected NCV. Change any value and the result page reruns immediately."
)

# Keep the quick waste-feed control on the main page and place all process scenario
# variables in the sidebar so the operator can see and change them without scrolling.
primary_temp = st.sidebar.number_input(
    "Primary air temperature (°C)", value=float(base_values["primary_temp"]), step=1.0, key="sc_primary_temp_r3"
)
primary_flow = st.sidebar.number_input(
    "Primary air flow (Nm³/h)", value=float(base_values["primary_flow"]), step=500.0, key="sc_primary_flow_r3"
)
secondary_temp = st.sidebar.number_input(
    "Secondary air temperature (°C)", value=float(base_values["secondary_temp"]), step=1.0, key="sc_secondary_temp_r3"
)
secondary_flow = st.sidebar.number_input(
    "Secondary air flow (Nm³/h)", value=float(base_values["secondary_flow"]), step=500.0, key="sc_secondary_flow_r3"
)
process_temp = st.sidebar.number_input(
    "Process air temperature (°C)", value=float(base_values["process_temp"]), step=1.0, key="sc_process_temp_r3"
)
process_air_flow = st.sidebar.number_input(
    "Process air flow (Nm³/h)", value=float(base_values["process_air_flow"]), step=100.0, key="sc_process_air_flow_r3"
)
feedwater_temp = st.sidebar.number_input(
    "Feedwater temperature (°C)", value=float(base_values["feedwater_temp"]), step=1.0, key="sc_feedwater_temp_r3"
)
water = st.sidebar.number_input(
    "Water injection flow (m³/h)", value=float(base_values["water"]), step=0.1, key="sc_water_r3"
)
steam_flow = st.sidebar.number_input(
    "Live steam flow (t/h)", value=float(base_values["steam_flow"]), step=0.5, key="sc_steam_flow_r3"
)
steam_temp = st.sidebar.number_input(
    "Live steam temperature (°C)", value=float(base_values["steam_temp"]), step=1.0, key="sc_steam_temp_r3"
)
drum_pressure = st.sidebar.number_input(
    "Drum pressure (bar)", value=float(base_values["drum_pressure"]), step=0.1, key="sc_drum_pressure_r3"
)
pa_preheater_flow = st.sidebar.number_input(
    "PA preheater steam flow (t/h)", value=float(base_values["pa_preheater_flow"]), step=0.1, key="sc_pa_preheater_flow_r3"
)
fg_temp = st.sidebar.number_input(
    "Flue gas temperature (°C)", value=float(base_values["fg_temp"]), step=1.0, key="sc_fg_temp_r3"
)

with st.sidebar.expander("Advanced model assumptions", expanded=False):
    st.caption("Engineering sensitivity only; these are not normal operator setpoints.")
    blowdown = st.number_input(
        "Blowdown mass flow assumption (kg/h)", value=float(base_values["blowdown"]), step=10.0, key="sc_blowdown_r3"
    )
    radiation_loss = st.number_input(
        "Radiation loss assumption (kW)", value=float(base_values["radiation_loss"]), step=10.0, key="sc_radiation_loss_r3"
    )
    bottom_ash_loss = st.number_input(
        "Bottom ash specific loss (kJ/kg waste)", value=float(base_values["bottom_ash_loss"]), step=1.0, key="sc_bottom_ash_loss_r3"
    )
    fly_ash_loss = st.number_input(
        "Fly ash specific loss (kJ/kg waste)", value=float(base_values["fly_ash_loss"]), step=1.0, key="sc_fly_ash_loss_r3"
    )

scenario_values = {
    "steam_flow": steam_flow,
    "steam_temp": steam_temp,
    "feedwater_temp": feedwater_temp,
    "drum_pressure": drum_pressure,
    "pa_preheater_flow": pa_preheater_flow,
    "primary_flow": primary_flow,
    "primary_temp": primary_temp,
    "secondary_flow": secondary_flow,
    "secondary_temp": secondary_temp,
    "process_temp": process_temp,
    "process_air_flow": process_air_flow,
    "fg_temp": fg_temp,
    "water": water,
    "blowdown": blowdown,
    "radiation_loss": radiation_loss,
    "bottom_ash_loss": bottom_ash_loss,
    "fly_ash_loss": fly_ash_loss,
}

st.subheader("Scenario inputs — actual vs entered")
scenario_input_rows = []
for key, label, unit in [
    ("primary_temp", "Primary air temperature", "°C"),
    ("primary_flow", "Primary air flow", "Nm³/h"),
    ("secondary_temp", "Secondary air temperature", "°C"),
    ("secondary_flow", "Secondary air flow", "Nm³/h"),
    ("process_temp", "Process air temperature", "°C"),
    ("process_air_flow", "Process air flow", "Nm³/h"),
    ("feedwater_temp", "Feedwater temperature", "°C"),
    ("water", "Water injection", "m³/h"),
    ("steam_flow", "Live steam flow", "t/h"),
    ("steam_temp", "Live steam temperature", "°C"),
    ("drum_pressure", "Drum pressure", "bar"),
    ("pa_preheater_flow", "PA preheater steam flow", "t/h"),
    ("fg_temp", "Flue gas temperature", "°C"),
]:
    scenario_input_rows.append({
        "Parameter": label,
        "Actual baseline": base_values[key],
        "Scenario input": scenario_values[key],
        "Delta": scenario_values[key] - base_values[key],
        "Unit": unit,
    })
scenario_input_df = pd.DataFrame(scenario_input_rows)
st.dataframe(
    scenario_input_df.style.format({"Actual baseline": "{:.3f}", "Scenario input": "{:.3f}", "Delta": "{:+.3f}"}),
    width="stretch", hide_index=True
)

# Visible confirmation that Streamlit has received the user's changes.
changed_mask = scenario_input_df["Delta"].abs() > 1e-9
changed_count = int(changed_mask.sum())
waste_delta = float(throughput_basis) - (
    float(base["throughput_8h_tph"]) if np.isfinite(base["throughput_8h_tph"]) else float(throughput_basis)
)
if abs(waste_delta) > 1e-9:
    changed_count += 1
if changed_count == 0:
    st.info("Scenario is currently identical to the actual baseline. Change a Scenario input or waste feed to run a what-if case.")
else:
    st.success(f"Scenario recalculated with {changed_count} changed input(s).")

# IMPORTANT: baseline and scenario must be evaluated at DIFFERENT waste feeds.
# The previous version evaluated both at the scenario waste feed, so changing
# only the waste-feed input could cancel out of the delta and appear to do
# nothing.  Baseline now always uses the ACTUAL historian 8h throughput.
baseline_throughput_tph = (
    float(base["throughput_8h_tph"])
    if np.isfinite(base["throughput_8h_tph"])
    else float(throughput_basis)
)

try:
    base_calc = heat_balance(base_values, baseline_throughput_tph, allow_extrapolation)
    scenario_calc = heat_balance(scenario_values, float(throughput_basis), allow_extrapolation)
except ValueError as exc:
    st.warning(str(exc))
    st.stop()

# Model delta is applied to the actual 8h historian point.
# This keeps the projection anchored to the measured plant condition while the
# FDS heat-balance model estimates the combined effect of process-variable AND
# waste-feed changes entered by the user.
model_delta_ncv = scenario_calc["ncv_mjkg"] - base_calc["ncv_mjkg"]
actual_anchor_ncv = base["ncv_8h_mjkg"]
projected_ncv = (
    actual_anchor_ncv + model_delta_ncv
    if np.isfinite(actual_anchor_ncv)
    else scenario_calc["ncv_mjkg"]
)

model_delta_heat = scenario_calc["waste_heat_input_mw"] - base_calc["waste_heat_input_mw"]
actual_anchor_heat = base["waste_heat_8h_mw"]
projected_heat_mw = (
    actual_anchor_heat + model_delta_heat
    if np.isfinite(actual_anchor_heat)
    else scenario_calc["waste_heat_input_mw"]
)

base_capacity = projected_capacity(
    actual_anchor_ncv if np.isfinite(actual_anchor_ncv) else base_calc["ncv_mjkg"],
    heat_limit_mw,
    mech_limit_tph,
)
scenario_capacity = projected_capacity(projected_ncv, heat_limit_mw, mech_limit_tph)
scenario_total_tpd = scenario_capacity * 24.0 * active_lines
scenario_entered_tpd = throughput_basis * 24.0 * active_lines

st.subheader("What-if result versus actual historian baseline")
r0, r1, r2, r3, r4, r5, r6 = st.columns(7)
r0.metric("Actual 8h waste", f"{baseline_throughput_tph:.2f} t/h")
r1.metric("Actual 8h NCV", f"{actual_anchor_ncv:.3f} MJ/kg" if np.isfinite(actual_anchor_ncv) else "n/a")
r2.metric(
    "Projected NCV",
    f"{projected_ncv:.3f} MJ/kg",
    f"{projected_ncv - actual_anchor_ncv:+.3f}" if np.isfinite(actual_anchor_ncv) else None,
)
r3.metric(
    "Projected heat input",
    f"{projected_heat_mw:.2f} MW",
    f"{projected_heat_mw - actual_anchor_heat:+.2f} MW" if np.isfinite(actual_anchor_heat) else None,
)
r4.metric("Entered waste feed", f"{throughput_basis:.2f} t/h", f"{scenario_entered_tpd:.0f} t/day plant")
r5.metric(
    "Thermal-limit capacity / line",
    f"{scenario_capacity:.2f} t/h",
    f"{scenario_capacity - base_capacity:+.2f}",
)
if scenario_total_tpd < target_min_tpd:
    target_status = f"{scenario_total_tpd - target_min_tpd:+.0f} t/day vs lower target"
elif scenario_total_tpd <= target_max_tpd:
    target_status = "Inside target band"
else:
    target_status = f"{scenario_total_tpd - target_max_tpd:+.0f} t/day above upper target"
r6.metric("Projected max plant capacity", f"{scenario_total_tpd:.0f} t/day", target_status)

st.caption(
    "Projected NCV = actual 8h historian NCV + FDS-model NCV change caused by the entered scenario. "
    "This is a what-if engineering projection, not a forecast of intrinsic waste quality."
)

# Target gap at 3000 / 3100 / 3200 / 3300
st.markdown("#### Target gap")
target_df = make_target_table(heat_limit_mw, active_lines, mech_limit_tph)
target_df["Scenario NCV (MJ/kg)"] = projected_ncv
target_df["NCV gap vs required (MJ/kg)"] = (
    target_df["Scenario NCV (MJ/kg)"] - target_df["Required NCV at thermal limit (MJ/kg)"]
)
target_df["Projected capacity gap (t/day)"] = scenario_total_tpd - target_df["Target total t/day"]
st.dataframe(
    target_df.style.format({
        "Per-line t/h": "{:.2f}",
        "Required NCV at thermal limit (MJ/kg)": "{:.3f}",
        "Scenario NCV (MJ/kg)": "{:.3f}",
        "NCV gap vs required (MJ/kg)": "{:+.3f}",
        "Projected capacity gap (t/day)": "{:+.0f}",
    }),
    width="stretch",
    hide_index=True,
)

# Put an Excel download button close to the main result so the operator does
# not have to scroll to the bottom of the page.
quick_summary_df = pd.DataFrame([
    {"Metric": "Actual 8h waste throughput", "Value": baseline_throughput_tph, "Unit": "t/h/line"},
    {"Metric": "Scenario waste feed", "Value": throughput_basis, "Unit": "t/h/line"},
    {"Metric": "Actual 8h NCV", "Value": actual_anchor_ncv, "Unit": "MJ/kg"},
    {"Metric": "Projected NCV", "Value": projected_ncv, "Unit": "MJ/kg"},
    {"Metric": "NCV change", "Value": projected_ncv - actual_anchor_ncv if np.isfinite(actual_anchor_ncv) else np.nan, "Unit": "MJ/kg"},
    {"Metric": "Actual 8h waste heat input", "Value": actual_anchor_heat, "Unit": "MW/line"},
    {"Metric": "Projected waste heat input", "Value": projected_heat_mw, "Unit": "MW/line"},
    {"Metric": "Entered plant-equivalent waste", "Value": scenario_entered_tpd, "Unit": "t/day"},
    {"Metric": "Projected max plant capacity", "Value": scenario_total_tpd, "Unit": "t/day"},
])
quick_params_df = scenario_input_df.copy()
quick_params_df = pd.concat([
    pd.DataFrame([{
        "Parameter": "Waste feed / line",
        "Actual baseline": baseline_throughput_tph,
        "Scenario input": throughput_basis,
        "Delta": throughput_basis - baseline_throughput_tph,
        "Unit": "t/h",
    }]),
    quick_params_df,
], ignore_index=True)
try:
    quick_export = excel_bytes({
        "Scenario_Summary": quick_summary_df,
        "Scenario_Inputs": quick_params_df,
        "Target_Gap": target_df,
    })
    st.download_button(
        "⬇ Download current scenario Excel",
        data=quick_export,
        file_name=f"NCV_Scenario_Line{line}_Current.xlsx",
        mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        key="quick_excel_download_r3",
        width="stretch",
    )
except Exception as exc:
    st.error(
        "Excel export could not be created. Install openpyxl with: "
        "python -m pip install openpyxl. "
        f"Technical detail: {exc}"
    )

st.markdown("#### Heat-balance breakdown")
heat_df = pd.DataFrame([
    {"Term": "Waste heat input", "Baseline MW": base_calc["waste_heat_input_mw"], "Scenario MW": scenario_calc["waste_heat_input_mw"]},
    {"Term": "Primary air credit", "Baseline MW": base_calc["q_primary_mw"], "Scenario MW": scenario_calc["q_primary_mw"]},
    {"Term": "Secondary air credit", "Baseline MW": base_calc["q_secondary_mw"], "Scenario MW": scenario_calc["q_secondary_mw"]},
    {"Term": "Process air credit", "Baseline MW": base_calc["q_process_mw"], "Scenario MW": scenario_calc["q_process_mw"]},
    {"Term": "Water injection credit", "Baseline MW": base_calc["q_water_mw"], "Scenario MW": scenario_calc["q_water_mw"]},
    {"Term": "Live steam heat flow", "Baseline MW": base_calc["q_steam_mw"], "Scenario MW": scenario_calc["q_steam_mw"]},
    {"Term": "Blowdown heat flow", "Baseline MW": base_calc["q_blowdown_mw"], "Scenario MW": scenario_calc["q_blowdown_mw"]},
    {"Term": "PA preheater heat flow", "Baseline MW": base_calc["q_pa_preheater_mw"], "Scenario MW": scenario_calc["q_pa_preheater_mw"]},
    {"Term": "Flue gas loss", "Baseline MW": base_calc["q_fg_loss_mw"], "Scenario MW": scenario_calc["q_fg_loss_mw"]},
    {"Term": "Bottom ash loss", "Baseline MW": base_calc["q_bottom_loss_mw"], "Scenario MW": scenario_calc["q_bottom_loss_mw"]},
    {"Term": "Fly ash loss", "Baseline MW": base_calc["q_fly_loss_mw"], "Scenario MW": scenario_calc["q_fly_loss_mw"]},
    {"Term": "Radiation loss", "Baseline MW": base_calc["q_radiation_loss_mw"], "Scenario MW": scenario_calc["q_radiation_loss_mw"]},
])
heat_df["Δ MW"] = heat_df["Scenario MW"] - heat_df["Baseline MW"]
st.dataframe(heat_df.style.format({"Baseline MW": "{:.3f}", "Scenario MW": "{:.3f}", "Δ MW": "{:+.3f}"}), width="stretch", hide_index=True)

st.subheader("All-variable one-at-a-time sensitivity")
st.caption(
    "Each row changes only one variable from the historian baseline using the step sizes in the sidebar. "
    "This helps separate parameter influence before combining variables in the custom scenario."
)
try:
    sens = sensitivity_table(
        base_values,
        throughput_basis,
        heat_limit_mw,
        mech_limit_tph,
        allow_extrapolation,
        temp_step,
        flow_pct,
        pressure_step,
        throughput_step,
    )
    sens["Projected total t/day"] = sens["Projected capacity / line (t/h)"] * 24.0 * active_lines
    st.dataframe(
        sens.style.format({
            "Change": "{:+.3f}",
            "Scenario throughput basis (t/h)": "{:.2f}",
            "Scenario NCV (MJ/kg)": "{:.4f}",
            "ΔNCV (MJ/kg)": "{:+.4f}",
            "Waste heat input (MW)": "{:.2f}",
            "Projected capacity / line (t/h)": "{:.2f}",
            "Δ capacity / line (t/h)": "{:+.2f}",
            "Projected total t/day": "{:.0f}",
        }),
        width="stretch",
        hide_index=True,
    )
except Exception as exc:
    sens = pd.DataFrame()
    st.warning(f"Sensitivity table could not be produced: {exc}")

st.subheader("Hourly operator view")
st.caption(
    "Hourly historian averages plus the selected scenario reference values. "
    "This is an operator decision-support table, not an automatic control command. "
    "Apply only within approved OEM/site operating limits."
)

hourly_ops = hourly_operator_table(
    raw_line=raw_line,
    calc_line=calc_line,
    scenario_values=scenario_values,
    target_tpd=operator_target_tpd,
    active_lines=active_lines,
    heat_limit_mw=heat_limit_mw,
    mech_limit_tph=mech_limit_tph,
    baseline_steam_flow=float(base_values["steam_flow"]),
)

if not hourly_ops.empty:
    latest = hourly_ops.dropna(subset=["Hour"]).iloc[-1]
    o1, o2, o3, o4, o5, o6 = st.columns(6)
    o1.metric("Hourly target", f"{operator_target_tpd:.0f} t/day")
    o2.metric("Target / line", f"{latest['Target line throughput (t/h)']:.2f} t/h")
    if "Waste burned this hour (t)" in latest:
        o3.metric("Latest hour waste", f"{latest['Waste burned this hour (t)']:.2f} t")
    if "NCV_8h_DisplayHold" in latest:
        o4.metric("Latest 8h NCV", f"{latest['NCV_8h_DisplayHold']:.3f} MJ/kg")
    if "steam_flow" in latest:
        o5.metric("Latest avg steam", f"{latest['steam_flow']:.1f} t/h")
    o6.metric("Operator status", str(latest.get("Operator status", "")))

    show_hours = st.number_input("Hours shown in operator table", min_value=6, max_value=168, value=24, step=6)
    hourly_show = hourly_ops.tail(int(show_hours)).copy()
    preferred_cols = [
        "Hour", "Waste burned this hour (t)", "Equivalent plant rate (t/day)",
        "Target line throughput (t/h)", "Throughput gap to target (t/h)",
        "NCV_3h_DisplayHold", "NCV_8h_DisplayHold",
        "Target max NCV @ thermal limit (MJ/kg)", "NCV margin to target max (MJ/kg)",
        "WasteHeatInput_8h_MW", "Thermal margin (MW)",
        "steam_flow", "Steam vs baseline (%)",
        "primary_temp", "Ref PA temp (°C)", "Δ PA temp to ref (°C)",
        "primary_flow", "Ref PA flow (Nm³/h)", "Δ PA flow to ref (Nm³/h)",
        "secondary_temp", "Ref SA temp (°C)", "Δ SA temp to ref (°C)",
        "secondary_flow", "Ref SA flow (Nm³/h)", "Δ SA flow to ref (Nm³/h)",
        "feedwater_temp", "Ref Feedwater temp (°C)", "Δ Feedwater temp to ref (°C)",
        "fg_temp", "Ref Flue gas temp (°C)", "Δ FG temp to ref (°C)",
        "water", "Ref Water injection (m³/h)", "Δ Water injection to ref (m³/h)",
        "Operator status",
    ]
    preferred_cols = [c for c in preferred_cols if c in hourly_show.columns]
    st.dataframe(
        hourly_show[preferred_cols],
        width="stretch",
        hide_index=True,
    )
else:
    st.warning("Hourly operator table could not be generated for this line.")

# Current modified-vs-baseline parameter table
param_rows = []
labels = {
    "feedwater_temp": ("Feedwater temperature", "°C"),
    "primary_temp": ("Primary air temperature", "°C"),
    "primary_flow": ("Primary air flow", "Nm³/h"),
    "secondary_temp": ("Secondary air temperature", "°C"),
    "secondary_flow": ("Secondary air flow", "Nm³/h"),
    "process_temp": ("Process air temperature", "°C"),
    "process_air_flow": ("Process air flow", "Nm³/h"),
    "fg_temp": ("Flue gas temperature", "°C"),
    "water": ("Water injection flow", "m³/h"),
    "steam_flow": ("Live steam flow", "t/h"),
    "steam_temp": ("Live steam temperature", "°C"),
    "drum_pressure": ("Drum pressure", "bar"),
    "pa_preheater_flow": ("PA preheater steam flow", "t/h"),
    "blowdown": ("Blowdown mass flow assumption", "kg/h"),
    "radiation_loss": ("Radiation loss assumption", "kW"),
    "bottom_ash_loss": ("Bottom ash specific loss", "kJ/kg waste"),
    "fly_ash_loss": ("Fly ash specific loss", "kJ/kg waste"),
}
for key, (label, unit) in labels.items():
    param_rows.append({
        "Parameter": label,
        "Baseline": base_values[key],
        "Scenario": scenario_values[key],
        "Delta": scenario_values[key] - base_values[key],
        "Unit": unit,
    })
param_df = pd.DataFrame(param_rows)

with st.expander("Changed parameters", expanded=False):
    st.dataframe(param_df.style.format({"Baseline": "{:.3f}", "Scenario": "{:.3f}", "Delta": "{:+.3f}"}), width="stretch", hide_index=True)

with st.expander("Resolved historian tags"):
    map_df = pd.DataFrame([
        {"Internal variable": k, "Historian column": v}
        for k, v in mapping.items()
    ])
    st.dataframe(map_df, width="stretch", hide_index=True)

summary_df = pd.DataFrame([
    {"Metric": "Baseline NCV", "Value": base_calc["ncv_mjkg"], "Unit": "MJ/kg"},
    {"Metric": "Projected NCV vs actual", "Value": projected_ncv, "Unit": "MJ/kg"},
    {"Metric": "Projected waste heat input vs actual", "Value": projected_heat_mw, "Unit": "MW/line"},
    {"Metric": "Projected capacity", "Value": scenario_capacity, "Unit": "t/h/line"},
    {"Metric": "Projected total capacity", "Value": scenario_total_tpd, "Unit": "t/day"},
    {"Metric": "Target minimum", "Value": target_min_tpd, "Unit": "t/day"},
    {"Metric": "Target maximum", "Value": target_max_tpd, "Unit": "t/day"},
])

try:
    export = excel_bytes({
        "Scenario_Summary": summary_df,
        "Scenario_Inputs": quick_params_df,
        "Parameters": param_df,
        "Target_Gap": target_df,
        "Heat_Balance": heat_df,
        "Sensitivity": sens if not sens.empty else pd.DataFrame({"Message": ["Sensitivity unavailable"]}),
        "Hourly_Operator": hourly_ops if 'hourly_ops' in locals() and not hourly_ops.empty else pd.DataFrame({"Message": ["Hourly operator table unavailable"]}),
    })
    st.download_button(
        "⬇ Download FULL scenario report (.xlsx)",
        data=export,
        file_name=f"NCV_Scenario_Line{line}_Full.xlsx",
        mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        key="full_excel_download",
        width="stretch",
    )
except Exception as exc:
    st.error(
        "Full Excel export could not be created. Install openpyxl with: "
        "python -m pip install openpyxl. "
        f"Technical detail: {exc}"
    )

st.caption(
    "Projected capacity = min(thermal-limit throughput, selected mechanical throughput limit). "
    "Thermal-limit throughput = Heat input limit [MW] × 3.6 / calculated NCV [MJ/kg]."
)
