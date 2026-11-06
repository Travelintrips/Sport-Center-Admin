#!/usr/bin/env python3
"""Read-only verification of the existing Kasbon POOL workbook via XLSX export.

Uses only HTTP GET and stdlib ZIP/XML parsing; NEVER edits the workbook.
The source workbook must be explicitly configured using an environment variable.
"""
import io
import json
import os
import re
import sys
import urllib.request
import zipfile
from datetime import datetime, timedelta
from xml.etree import ElementTree as ET

NS = {"x": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
REL_KEY = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
S = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"


def read_export(workbook_id, tab):
    if not re.fullmatch(r"[A-Za-z0-9_-]{20,100}", workbook_id):
        raise RuntimeError("WORKBOOK_ID_INVALID")
    url = f"https://docs.google.com/spreadsheets/d/{workbook_id}/export?format=xlsx"
    request = urllib.request.Request(url, headers={"User-Agent": "SportCenter-Kasbon-ReadOnly-Audit"})
    with urllib.request.urlopen(request, timeout=35) as response:
        data = response.read(40_000_001)
    if len(data) > 40_000_000 or not data.startswith(b"PK"):
        raise RuntimeError("XLSX_EXPORT_UNAVAILABLE_OR_TOO_LARGE")
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        workbook = ET.fromstring(z.read("xl/workbook.xml"))
        candidates = [x for x in workbook.findall("x:sheets/x:sheet", NS) if x.attrib.get("name") == tab]
        if len(candidates) != 1:
            raise RuntimeError("TAB_NAME_UNVERIFIED")
        rid = candidates[0].attrib[REL_KEY]
        relations = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
        targets = {x.attrib["Id"]: x.attrib["Target"] for x in relations}
        path = targets[rid].lstrip("/")
        if not path.startswith("xl/"):
            path = "xl/" + path
        shared = []
        if "xl/sharedStrings.xml" in z.namelist():
            strings = ET.fromstring(z.read("xl/sharedStrings.xml"))
            shared = ["".join(t.text or "" for t in si.iter(S+"t")) for si in strings.findall("x:si", NS)]
        root = ET.fromstring(z.read(path))
        cells = {}
        for c in root.findall(".//x:sheetData/x:row/x:c", NS):
            addr = c.attrib.get("r", "")
            f = c.find("x:f", NS)
            v = c.find("x:v", NS)
            inline = c.find("x:is", NS)
            val = v.text if v is not None else None
            if c.attrib.get("t") == "s" and val is not None:
                val = shared[int(val)]
            elif inline is not None:
                val = "".join(t.text or "" for t in inline.iter(S+"t"))
            if val is not None or f is not None:
                cells[addr] = {"value": val, "formula": f.text if f is not None else None}
        return cells, len(workbook.findall("x:sheets/x:sheet", NS))


def col(index):
    result = ""
    while index:
        index, mod = divmod(index-1, 26)
        result = chr(65+mod) + result
    return result


def audit(cells):
    def text(addr):
        return str(cells.get(addr, {}).get("value") or "").strip()
    def amount(addr):
        try:
            return round(float(text(addr)), 2)
        except (ValueError, TypeError):
            return 0.0
    sections = []
    max_row = max((int(re.search(r"\d+", x).group()) for x in cells if re.search(r"\d+", x)), default=0)
    for row in range(1, max_row):
        if text(f"A{row}").lower() != "november":
            continue
        header = row + 1
        day_col = {}
        for ci in range(5, 36):
            serial = amount(f"{col(ci)}{header}")
            if serial == 0:
                continue
            date = datetime(1899, 12, 30) + timedelta(days=serial)
            if date.year == 2026 and date.month == 11:
                day_col[date.day] = col(ci)
        if len(day_col) < 5:
            continue
        total_row = next((r for r in range(header+1, min(header+200, max_row+1)) if text(f"B{r}").lower() == "total"), None)
        if not total_row:
            sections.append({"header": header, "warning": "TOTAL_ROW_NOT_FOUND"})
            continue
        daily = []
        for day, c in sorted(day_col.items()):
            entries = [(r, amount(f"{c}{r}")) for r in range(header+1, total_row)]
            calculated = sum(v for _, v in entries)
            reported = amount(f"{c}{total_row}")
            formula = cells.get(f"{c}{total_row}", {}).get("formula")
            if round(calculated-reported, 2) or calculated or formula:
                daily.append({"day": day, "column":c, "sumEntries":calculated, "displayedTotal":reported, "difference":round(reported-calculated,2), "totalIsFormula":bool(formula),
                             "occupiedRows":[r for r,v in entries if v != 0]})
        month_total = amount(f"C{total_row}")
        sum_c = sum(amount(f"C{r}") for r in range(header+1,total_row))
        names = [{"row":r,"label":text(f"B{r}"),"cIsFormula":bool(cells.get(f"C{r}",{}).get("formula"))} for r in range(header+1,total_row) if text(f"B{r}")]
        sections.append({
            "sectionStart":row, "header":header,"firstTransactionRow":header+1,"totalRow":total_row,
            "transactionRows":names,"dayColumns":day_col,
            "reportedMonthlyTotal":month_total,"sumMonthlyItems":sum_c,
            "monthlyDifference":round(month_total-sum_c,2),
            "monthTotalFormula":cells.get(f"C{total_row}",{}).get("formula"),
            "daily":daily, "writeSafe":False
        })
    return {"november2026Sections":sections,"status":"READ_ONLY_AUDIT","writeEnabled":False}


if __name__=="__main__":
    workbook_id = os.getenv("SC_KASBON_POOL_SPREADSHEET_ID", "")
    tab = os.getenv("SC_KASBON_POOL_TAB_NAME", "Kasbon POOL")
    try:
        cells, num_tabs = read_export(workbook_id, tab)
        result = audit(cells)
        result["sheetCount"] = num_tabs
        print(json.dumps(result, ensure_ascii=False, indent=2))
    except Exception as exc:
        print("AUDIT_BLOCKED:", str(exc), file=sys.stderr)
        sys.exit(1)
