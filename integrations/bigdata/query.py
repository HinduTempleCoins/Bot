#!/usr/bin/env python3
# query.py — keyless big-data query via DuckDB (free, CPU, NO account). Reads remote Parquet/CSV/JSON
# over HTTPS (Hugging Face, Open Images, Common Crawl indexes, any open URL) with SQL. httpfs loaded.
#   python3 query.py "SELECT ... LIMIT 100"  -> {"ok":true,"rows":[...]}
import sys, json
try:
    import duckdb
except Exception as e:
    print(json.dumps({"ok": False, "error": "duckdb not installed"})); sys.exit(0)
sql = sys.argv[1] if len(sys.argv) > 1 else ""
if not sql: print(json.dumps({"ok": False, "error": "no sql"})); sys.exit(0)
try:
    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs;")
    rel = con.sql(sql)
    cols = rel.columns
    rows = [dict(zip(cols, r)) for r in rel.fetchall()[:1000]]
    print(json.dumps({"ok": True, "rows": rows, "count": len(rows)}, default=str))
except Exception as e:
    print(json.dumps({"ok": False, "error": str(e)[:200]}))
