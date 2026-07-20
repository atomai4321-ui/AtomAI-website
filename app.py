"""
AtomAI — DPO Explorer
======================
Local Flask demo for the AtomAI double-perovskite-oxide search engine.

Data files expected (place these in the data/ folder):
    data/dpo_database.csv
    data/elements.csv

dpo_database.csv columns:
    Formula, DPO_Type, A_site_key, B_site_key, Formula_with_Oxidation_State,
    mu, mu_a, mu_b, tolerance_factor, Band_Gap, stable, mean_confidence,
    Material_Status

    - A_site_key / B_site_key are comma-separated pairs, e.g. "Bi, Ag".
      Order does NOT matter (Ag,Bi == Bi,Ag), so we index on a sorted tuple.
    - Formula_with_Oxidation_State is a comma-separated list of ion labels
      matching elements.csv's Atom_Key, e.g. "Bi3+, Ag1+, Bi5+, Ag3+".

elements.csv columns:
    Atom_Key, Element, Oxidation_State, Atomic_Number, radii,
    Ionization_Energy, Electronegativity, Electron_Affinity, Atomic_Volume,
    HOMO, LUMO, Zunger_Radius, Group, Period, Block, Melting_Point,
    Boiling_Point, Thermal_Conductivity

    - One row per ion (Atom_Key is the primary key, e.g. "Ag1+").

PERFORMANCE NOTE
-----------------
The DPO database has 500k+ rows. Scanning it row-by-row on every search
request would be far too slow. Instead, we build an in-memory dictionary
index ONCE at startup, keyed by (sorted A-site tuple, sorted B-site tuple).
Every search after that is an O(1) dictionary lookup.
"""

import os
import re
from collections import defaultdict
from pathlib import Path

import pandas as pd
from flask import Flask, jsonify, render_template, request

app = Flask(__name__)

DATA_DIR = Path(__file__).parent / "data"
DPO_PATH = DATA_DIR / "dpo_database.csv"
ELEMENTS_PATH = DATA_DIR / "elements.csv"

# ----------------------------------------------------------------------
# Load & clean data
#
# MEMORY NOTE (learned the hard way on a 512MB free host): the dtype=str
# 500k-row DataFrame is only half the picture. The old version of this
# file also built `dpo_index` as {key: [full row dict, ...]} — a SECOND
# complete copy of the entire database as Python dict objects, which cost
# far more RAM per value than pandas' columnar storage. That duplication
# was the actual OOM cause, not the CSV read itself. Fix: dpo_index now
# stores lightweight integer row positions, and rows are pulled from
# dpo_df (the single source of truth) on demand via .iloc[].
# ----------------------------------------------------------------------

print("[AtomAI] Loading databases...")

# Every column here is text-like in the source CSVs (formulas, ion labels,
# etc.), so reading everything as a fixed dtype avoids pandas' expensive
# per-chunk type-sniffing (that's what the DtypeWarning was about) without
# ballooning memory the way full type inference across mixed columns can.
dpo_df = pd.read_csv(DPO_PATH, dtype=str, keep_default_na=False, low_memory=False)
elements_df = pd.read_csv(ELEMENTS_PATH, dtype=str, keep_default_na=False, low_memory=False)

dpo_df.columns = dpo_df.columns.str.strip()
elements_df.columns = elements_df.columns.str.strip()

for col in dpo_df.columns:
    dpo_df[col] = dpo_df[col].str.strip()

for col in elements_df.columns:
    elements_df[col] = elements_df[col].str.strip()

# Columns with a small number of repeated values compress dramatically with
# category dtype (pandas stores each unique string once + an integer code
# per row, instead of a full string per row).
for col in ("DPO_Type", "A_site_key", "B_site_key", "Material_Status", "stable"):
    if col in dpo_df.columns:
        dpo_df[col] = dpo_df[col].astype("category")

print(f"[AtomAI] {len(dpo_df):,} DPO rows, {len(elements_df):,} element rows loaded.")

# ----------------------------------------------------------------------
# Build fast lookup indexes (runs once at startup)
# ----------------------------------------------------------------------


def site_key_tuple(raw: str) -> tuple:
    """Turn 'Bi, Ag' into a sorted tuple ('Ag', 'Bi') so order never matters."""
    return tuple(sorted(part.strip() for part in raw.split(",") if part.strip()))


print("[AtomAI] Building search index...")

# dpo_index maps (a_key, b_key) -> list of integer row positions in dpo_df.
# No row data is copied here — just cheap ints — so this index stays a
# small fraction of the DataFrame's own size no matter how many rows there are.
dpo_index = defaultdict(list)
a_site_col = dpo_df.columns.get_loc("A_site_key")
b_site_col = dpo_df.columns.get_loc("B_site_key")
for pos, (a_raw, b_raw) in enumerate(
    zip(dpo_df.iloc[:, a_site_col], dpo_df.iloc[:, b_site_col])
):
    a_key = site_key_tuple(a_raw)
    b_key = site_key_tuple(b_raw)
    dpo_index[(a_key, b_key)].append(pos)

elements_index = elements_df.set_index("Atom_Key").to_dict(orient="index")

# Sorted list of unique element symbols for the search dropdowns
element_symbols = sorted(elements_df["Element"].dropna().unique())

# Counts for the homepage stat cards
known_count = int((dpo_df["Material_Status"] == "Known").sum())
predicted_count = int((dpo_df["Material_Status"] == "Predicted").sum())

# Pre-parsed numeric Band_Gap column (float32, not float64 — halves the
# memory of this column with no meaningful precision loss for a band gap).
dpo_df["_band_gap_num"] = pd.to_numeric(dpo_df["Band_Gap"], errors="coerce").astype("float32")

print(f"[AtomAI] Index built: {len(dpo_index):,} unique site-key combinations.")

try:
    import resource

    peak_mb = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024  # KB -> MB on Linux
    print(f"[AtomAI] Peak memory after startup: {peak_mb:,.0f} MB")
except ImportError:
    pass  # resource is Unix-only; harmless to skip on other platforms

print("[AtomAI] Ready.")


# ----------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------


def normalize_symbol(raw: str) -> str:
    """'ag' / 'AG' / ' Ag ' -> 'Ag'."""
    return raw.strip().capitalize()


def lookup_atoms(formula_with_os: str) -> list:
    """Split 'Bi3+, Ag1+, Bi5+, Ag3+' into ion dicts pulled from elements.csv."""
    atoms = []
    for atom_key in (p.strip() for p in formula_with_os.split(",")):
        if not atom_key:
            continue
        info = elements_index.get(atom_key)
        if info:
            atom = dict(info)
            atom["Atom_Key"] = atom_key
            atoms.append(atom)
    return atoms


def to_number(value, default=None):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def format_oxidation_state(raw: str) -> str:
    """'Ba2+, Sr2+, Ni2+, W6+' -> 'Ba<sup>2+</sup> Sr<sup>2+</sup> Ni<sup>2+</sup> W<sup>6+</sup>'."""
    parts = []
    for token in (p.strip() for p in (raw or "").split(",")):
        if not token:
            continue
        m = re.match(r"^([A-Za-z]+)(\d+)([+\-])$", token)
        if m:
            elem, num, sign = m.groups()
            parts.append(f"{elem}<sup>{num}{sign}</sup>")
        else:
            parts.append(token)
    return " ".join(parts)


def split_dpo_type(raw: str) -> dict:
    """'Type 1: AA\u2032BB\u2032O6' -> {'label': 'Type 1', 'pattern': 'AA\u2032BB\u2032O6'}."""
    raw = (raw or "").strip()
    if ":" in raw:
        label, pattern = raw.split(":", 1)
    else:
        label, pattern = raw, ""
    label = label.strip()
    pattern = pattern.strip().replace("'", "\u2032")
    return {"label": label, "pattern": pattern}


def build_material_dict(row: dict) -> dict:
    """Turn one dpo_database.csv row (dict) into the material dict every
    template / API response uses. Shared by the site-chemistry search and
    the band-gap range search so both stay perfectly in sync."""
    dpo_type = split_dpo_type(row["DPO_Type"])
    return {
        "Formula": row["Formula"],
        "DPO_Type": row["DPO_Type"],
        "dpo_type_label": dpo_type["label"],
        "dpo_type_pattern": dpo_type["pattern"],
        "formula_oxidation": row["Formula_with_Oxidation_State"],
        "Band_Gap": to_number(row["Band_Gap"], 0.0),
        "tolerance_factor": to_number(row["tolerance_factor"]),
        "mu": to_number(row["mu"]),
        "mu_a": to_number(row["mu_a"]),
        "mu_b": to_number(row["mu_b"]),
        "stable": row["stable"] in ("1", "1.0", "True", "true"),
        "mean_confidence": to_number(row["mean_confidence"]),
        "Material_Status": row["Material_Status"] or "Unknown",
        "atoms": lookup_atoms(row["Formula_with_Oxidation_State"]),
    }


app.jinja_env.filters["oxidation"] = format_oxidation_state


# ----------------------------------------------------------------------
# Filtering (modular — add more criteria here as needed, e.g. stability,
# Material_Status, DPO_Type, tolerance_factor, mu... every filter just
# narrows dpo_df in memory and reuses build_material_dict for the output).
# ----------------------------------------------------------------------

MAX_BAND_GAP_RESULTS = 500  # keep the response snappy on a 500k+ row table


def filter_by_band_gap(min_v: float, max_v: float, statuses=None) -> tuple:
    """Return (materials, total_matches) for every row whose Band_Gap falls
    inside [min_v, max_v]. Rows with missing/invalid Band_Gap are ignored.
    Runs entirely in memory against the pre-parsed _band_gap_num column.

    statuses: optional list restricting results to those Material_Status
    values (e.g. ["Known"], ["Predicted"], or ["Known", "Predicted"]).
    An empty/omitted list means no status filter — every status matches.
    """
    mask = dpo_df["_band_gap_num"].notna() & dpo_df["_band_gap_num"].between(min_v, max_v)
    if statuses:
        mask &= dpo_df["Material_Status"].str.strip().isin(statuses)
    matches = dpo_df.loc[mask]
    total_matches = len(matches)
    materials = [
        build_material_dict(row._asdict())
        for row in matches.head(MAX_BAND_GAP_RESULTS).itertuples(index=False)
    ]
    return materials, total_matches


# ----------------------------------------------------------------------
# Routes
# ----------------------------------------------------------------------


@app.route("/", methods=["GET", "POST"])
def home():
    materials = None
    message = None
    submitted = {}

    if request.method == "POST":
        A = normalize_symbol(request.form.get("A", ""))
        Ap = normalize_symbol(request.form.get("Ap", ""))
        B = normalize_symbol(request.form.get("B", ""))
        Bp = normalize_symbol(request.form.get("Bp", ""))
        submitted = {"A": A, "Ap": Ap, "B": B, "Bp": Bp}

        if not all([A, Ap, B, Bp]):
            message = "Please provide all four site elements (A, A\u2032, B, B\u2032)."
        else:
            a_key = tuple(sorted([A, Ap]))
            b_key = tuple(sorted([B, Bp]))
            positions = dpo_index.get((a_key, b_key))

            if not positions:
                message = (
                    "No Double Perovskite Oxide was found for this combination "
                    "in the current AtomAI database. Try another set of elements."
                )
            else:
                materials = [
                    build_material_dict(dpo_df.iloc[pos].to_dict()) for pos in positions
                ]
    return render_template(
        "index.html",
        elements=element_symbols,
        materials=materials,
        message=message,
        submitted=submitted,
        total_materials=f"{len(dpo_df):,}",
        total_elements=f"{elements_df['Element'].nunique():,}",
        total_elements_raw=elements_df["Element"].nunique(),
        total_known=known_count,
        total_predicted=predicted_count,
    )


@app.route("/api/band-gap-search", methods=["POST"])
def band_gap_search():
    data = request.get_json(silent=True) or request.form
    min_v = to_number(data.get("min"))
    max_v = to_number(data.get("max"))
    statuses = data.get("statuses") or []
    if isinstance(statuses, str):  # form-encoded fallback: "Known,Predicted"
        statuses = [s.strip() for s in statuses.split(",") if s.strip()]
    valid_statuses = {"Known", "Predicted"}
    statuses = [s for s in statuses if s in valid_statuses]

    if min_v is None or max_v is None:
        return jsonify({"error": "Please provide a valid minimum and maximum band gap."}), 400
    if min_v > max_v:
        min_v, max_v = max_v, min_v

    materials, total_matches = filter_by_band_gap(min_v, max_v, statuses)
    return jsonify(
        {
            "materials": materials,
            "total_matches": total_matches,
            "truncated": total_matches > MAX_BAND_GAP_RESULTS,
            "shown": len(materials),
            "min": min_v,
            "max": max_v,
            "statuses": statuses,
        }
    )


if __name__ == "__main__":
    # Local dev: `python app.py` still works exactly as before (debug on,
    # localhost only). In production a WSGI server (gunicorn, see the
    # Procfile) imports `app` directly and this block never runs — but we
    # still read PORT/DEBUG from the environment so a host's "run command"
    # override or a quick `python app.py` on a server behaves safely.
    port = int(os.environ.get("PORT", 5000))
    debug_mode = os.environ.get("FLASK_DEBUG", "1") == "1"
    app.run(host="0.0.0.0", port=port, debug=debug_mode)