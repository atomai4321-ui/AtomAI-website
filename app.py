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

from collections import defaultdict
from pathlib import Path

import pandas as pd
from flask import Flask, render_template, request

app = Flask(__name__)

DATA_DIR = Path(__file__).parent / "data"
DPO_PATH = DATA_DIR / "dpo_database.csv"
ELEMENTS_PATH = DATA_DIR / "elements.csv"

# ----------------------------------------------------------------------
# Load & clean data
# ----------------------------------------------------------------------

print("[AtomAI] Loading databases...")

# Tell pandas the exact final dtype for every column up front, so its C
# parser writes each value directly into a compact float32 / category
# array in a single pass. Reading loosely first and downcasting afterward
# briefly holds BOTH the larger intermediate representation and the
# smaller final one in memory at the same time — a transient spike that
# can get a process OOM-killed even when its steady-state memory is fine.
DPO_TEXT_COLUMNS = {
    "Formula",
    "A_site_key",
    "B_site_key",
    "Formula_with_Oxidation_State",
}
DPO_CATEGORY_COLUMNS = {"DPO_Type", "Material_Status"}
DPO_FLOAT_COLUMNS = {
    "mu",
    "mu_a",
    "mu_b",
    "tolerance_factor",
    "Band_Gap",
    "mean_confidence",
}

DPO_PARQUET_PATH = DATA_DIR / "dpo_database.parquet"

if DPO_PARQUET_PATH.exists():
    # Fast path: Parquet is a compressed, column-oriented binary format.
    # Loading it is dramatically faster and lower-memory than parsing an
    # 80MB+ CSV through pandas' text parser on every deploy/restart — this
    # is what makes the app reliable on a memory-constrained free host.
    # Build this file locally with convert_to_parquet.py and commit it.
    print(f"[AtomAI] Loading {DPO_PARQUET_PATH.name} (fast path)...")
    dpo_df = pd.read_parquet(DPO_PARQUET_PATH)
    dpo_df.columns = dpo_df.columns.str.strip()
else:
    # Fallback: parse the raw CSV directly. Works anywhere, but slower and
    # more memory-hungry — fine for local development, not recommended for
    # a constrained free-tier deploy. Run convert_to_parquet.py once and
    # commit the resulting .parquet file to avoid this path in production.
    print(f"[AtomAI] No Parquet file found — parsing {DPO_PATH.name} directly...")
    _header = pd.read_csv(DPO_PATH, nrows=0).columns.str.strip().tolist()
    _dtype_map = {}
    for _col in _header:
        if _col in DPO_CATEGORY_COLUMNS:
            _dtype_map[_col] = "category"
        elif _col in DPO_FLOAT_COLUMNS:
            _dtype_map[_col] = "float32"
        elif _col in DPO_TEXT_COLUMNS:
            _dtype_map[_col] = str

    dpo_df = pd.read_csv(DPO_PATH, dtype=_dtype_map)
    dpo_df.columns = dpo_df.columns.str.strip()

    for col in dpo_df.columns:
        if col == "stable":
            dpo_df[col] = (
                dpo_df[col].fillna(0).astype(str).str.strip().isin(["1", "1.0", "True", "true"])
            )
        elif col in DPO_TEXT_COLUMNS:
            dpo_df[col] = dpo_df[col].fillna("").astype(str).str.strip()

elements_df = pd.read_csv(ELEMENTS_PATH, dtype=str, keep_default_na=False)
elements_df.columns = elements_df.columns.str.strip()

for col in elements_df.columns:
    elements_df[col] = elements_df[col].astype(str).str.strip()

print(f"[AtomAI] {len(dpo_df):,} DPO rows, {len(elements_df):,} element rows loaded.")

try:
    import resource

    _peak_mb = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024
    print(f"[AtomAI] Peak memory after data load: {_peak_mb:.1f} MB")
except ImportError:
    pass  # resource module isn't available on Windows; harmless to skip

# ----------------------------------------------------------------------
# Build fast lookup indexes (runs once at startup)
# ----------------------------------------------------------------------


def site_key_tuple(raw: str) -> tuple:
    """Turn 'Bi, Ag' into a sorted tuple ('Ag', 'Bi') so order never matters."""
    return tuple(sorted(part.strip() for part in raw.split(",") if part.strip()))


print("[AtomAI] Building search index...")

dpo_index = defaultdict(list)
for i, row in enumerate(dpo_df.itertuples(index=False)):
    a_key = site_key_tuple(row.A_site_key)
    b_key = site_key_tuple(row.B_site_key)
    dpo_index[(a_key, b_key)].append(i)

# A_site_key / B_site_key are only needed to build the index above — drop
# them now to free that memory since nothing after this point uses them.
dpo_df.drop(columns=["A_site_key", "B_site_key"], inplace=True)

elements_index = elements_df.set_index("Atom_Key").to_dict(orient="index")

# Sorted list of unique element symbols for the search dropdowns
element_symbols = sorted(elements_df["Element"].dropna().unique())

print(f"[AtomAI] Index built: {len(dpo_index):,} unique site-key combinations.")
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
        value = float(value)
    except (TypeError, ValueError):
        return default
    return default if value != value else value  # value != value is True only for NaN


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
            matches = dpo_index.get((a_key, b_key))

            if not matches:
                message = (
                    "No Double Perovskite Oxide was found for this combination "
                    "in the current AtomAI database. Try another set of elements."
                )
            else:
                materials = []
                for idx in matches:
                    row = dpo_df.iloc[idx]
                    atoms_for_row = lookup_atoms(row["Formula_with_Oxidation_State"])
                    materials.append(
                        {
                            "Formula": row["Formula"],
                            "DPO_Type": row["DPO_Type"],
                            "Formula_with_Oxidation_State": row["Formula_with_Oxidation_State"],
                            "Band_Gap": to_number(row["Band_Gap"], 0.0),
                            "tolerance_factor": to_number(row["tolerance_factor"]),
                            "mu": to_number(row["mu"]),
                            "mu_a": to_number(row["mu_a"]),
                            "mu_b": to_number(row["mu_b"]),
                            "stable": bool(row["stable"]),
                            "mean_confidence": to_number(row["mean_confidence"]),
                            "Material_Status": row["Material_Status"] or "Unknown",
                            "atoms": atoms_for_row,
                        }
                    )
    return render_template(
        "index.html",
        elements=element_symbols,
        materials=materials,
        message=message,
        submitted=submitted,
        total_materials=f"{len(dpo_df):,}",
        total_elements=f"{elements_df['Element'].nunique():,}",
    )


if __name__ == "__main__":
    app.run(debug=True)