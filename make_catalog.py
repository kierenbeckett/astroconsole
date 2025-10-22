import csv
import json
import re


def parse_ra(ra_str):
    ra_str = ra_str.strip().lower()
    parts = re.findall(r"[\d.]+", ra_str)
    if len(parts) < 1:
        return None
    h = float(parts[0])
    m = float(parts[1]) if len(parts) > 1 else 0
    s = float(parts[2]) if len(parts) > 2 else 0
    return (h + m/60 + s/3600)


def parse_dec(dec_str):
    dec_str = dec_str.strip().replace("°", " ").replace("′", " ").replace("″", " ")
    parts = re.findall(r"[-+]?\d*\.?\d+", dec_str)
    if len(parts) < 1:
        return None
    sign = -1 if dec_str.strip().startswith("-") else 1
    d = abs(float(parts[0]))
    m = float(parts[1]) if len(parts) > 1 else 0
    s = float(parts[2]) if len(parts) > 2 else 0
    return sign * (d + m/60 + s/3600)


output = []

SOLAR_SYSTEM_OBJ = {
  "Sun":     { "diameter": 1391400, "color": "#FDB813" },
  "Moon":    { "diameter": 3474,    "color": "#C0C0C0" },
  "Mercury": { "diameter": 4879,    "color": "#B1B1B1" },
  "Venus":   { "diameter": 12104,   "color": "#EEDC82" },
  "Mars":    { "diameter": 6779,    "color": "#C1440E" },
  "Jupiter": { "diameter": 142984,  "color": "#D2B48C" },
  "Saturn":  { "diameter": 120536,  "color": "#F5DEB3" },
  "Uranus":  { "diameter": 51118,   "color": "#66FFFF" },
  "Neptune": { "diameter": 49528,   "color": "#4169E1" },
  "Pluto":   { "diameter": 2376,    "color": "#A9A9A9" }
}

for k, v in SOLAR_SYSTEM_OBJ.items():
    output.append({
        "name": k,
        "diameter": v["diameter"],
        "color": v["color"],
        "type": "sso",
        "alt": [k]
    })

# https://raw.githubusercontent.com/brettonw/YaleBrightStarCatalog/refs/heads/master/bsc5-short.json
with open("bsc5-short.json", "r", encoding="utf-8") as f:
    bright_stars = json.load(f)

hr_to_coords = {}
for star in bright_stars:
    hr = star.get("HR", "").strip()
    if not hr:
        continue
    ra = parse_ra(star.get("RA", ""))
    dec = parse_dec(star.get("Dec", ""))
    if ra is not None and dec is not None:
        hr_to_coords[hr] = (ra, dec)

# https://exopla.net/star-names/modern-iau-star-names/
with open("IAU-Catalog of Star Names (always up to date).csv", "r", encoding="utf-8") as f:
    reader = csv.DictReader(f)
    for row in reader:
        proper_name = row["proper names"].strip()
        hr_field = row.get("Designation", "").strip()
        match = re.search(r"HR\s*(\d+)", hr_field)
        if not match:
            continue
        hr_num = match.group(1)
        coords = hr_to_coords.get(hr_num)
        if coords:
            ra, dec = coords
            output.append({
                "name": proper_name,
                "ra": ra,
                "dec": dec,
                "type": "star",
                "alt": [proper_name, f"HR{hr_num}"]
            })

# https://data.smartidf.services/explore/dataset/ngc-ic-messier-catalog/information/
with open("ngc-ic-messier-catalog.csv", "r", encoding="utf-8", errors="ignore") as f:
    reader = csv.DictReader(f, delimiter=';')
    for row in reader:
        ra_str = row.get("ra", "").strip()
        dec_str = row.get("dec", "").strip()
        if not ra_str or not dec_str:
            continue
        try:
            ra_parts = [float(x) for x in re.split(r"[:\s]", ra_str) if x]
            ra = (ra_parts[0] + ra_parts[1]/60 + ra_parts[2]/3600) if len(ra_parts) >= 3 else None
        except Exception:
            ra = None
        try:
            dec_parts = [float(x) for x in re.split(r"[:\s]", dec_str.replace("−", "-")) if x]
            sign = -1 if dec_str.strip().startswith("-") else 1
            dec = sign * (abs(dec_parts[0]) + dec_parts[1]/60 + dec_parts[2]/3600) if len(dec_parts) >= 3 else None
        except Exception:
            dec = None
        if ra is None or dec is None:
            continue

        common_names = []
        field = row.get("common_names")
        for name in field.split(","):
            n = name.strip()
            if n:
                common_names.append(n)

        aliases = []
        for key in ("Messier", "NGC", "IC", "Name"):
            field = row.get(key)
            if field and field not in aliases:
                aliases.append(field)

        output.append({
            "name": (row.get("Messier") or row.get("Name")) + (" - " + common_names[0] if common_names else ""),
            "ra": ra,
            "dec": dec,
            "type": "dso",
            "alt": common_names + aliases
        })

with open("catalog.js", "w", encoding="utf-8") as f:
    f.write("const CATALOG = " + json.dumps(output))

print(f"✅ Wrote {len(output)} records")
