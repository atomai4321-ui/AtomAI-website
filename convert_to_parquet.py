"""
Run this ONCE on your own computer (not on Render) to convert
data/dpo_database.csv into data/dpo_database.parquet.

Why: Parquet is a compressed, column-oriented binary format. Reading it is
dramatically faster and uses far less peak memory than parsing an 80MB CSV
through pandas' text parser every time the app starts — which is what was
causing the deploy to be killed on Render's memory- and CPU-constrained
free tier.

Usage:
    python convert_to_parquet.py

This writes data/dpo_database.parquet next to your existing CSV. Commit
that new .parquet file to your GitHub repo (you can keep or remove the
original CSV — app.py will prefer the parquet file automatically).
"""

from pathlib import Path

import pandas as pd

DATA_DIR = Path(__file__).parent / "data"
CSV_PATH = DATA_DIR / "dpo_database.csv"
PARQUET_PATH = DATA_DIR / "dpo_database.parquet"

TEXT_COLUMNS = {
    "Formula",
    "A_site_key",
    "B_site_key",
    "Formula_with_Oxidation_State",
}
CATEGORY_COLUMNS = {"DPO_Type", "Material_Status"}
FLOAT_COLUMNS = {"mu", "mu_a", "mu_b", "tolerance_factor", "Band_Gap", "mean_confidence"}

print(f"Reading {CSV_PATH} ...")

header = pd.read_csv(CSV_PATH, nrows=0).columns.str.strip().tolist()
dtype_map = {}
for col in header:
    if col in CATEGORY_COLUMNS:
        dtype_map[col] = "category"
    elif col in FLOAT_COLUMNS:
        dtype_map[col] = "float32"
    elif col in TEXT_COLUMNS:
        dtype_map[col] = str
    # "stable" is left to default parsing, then converted to bool below.

df = pd.read_csv(CSV_PATH, dtype=dtype_map)
df.columns = df.columns.str.strip()

for col in df.columns:
    if col == "stable":
        df[col] = df[col].fillna(0).astype(str).str.strip().isin(["1", "1.0", "True", "true"])
    elif col in TEXT_COLUMNS:
        df[col] = df[col].fillna("").astype(str).str.strip()

print(f"Loaded {len(df):,} rows. Writing {PARQUET_PATH} ...")
df.to_parquet(PARQUET_PATH, engine="pyarrow", compression="snappy", index=False)

csv_mb = CSV_PATH.stat().st_size / 1e6
parquet_mb = PARQUET_PATH.stat().st_size / 1e6
print(f"Done. CSV was {csv_mb:.1f} MB -> Parquet is {parquet_mb:.1f} MB.")
print("Commit and push data/dpo_database.parquet — app.py will use it automatically.")
