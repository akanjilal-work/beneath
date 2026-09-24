from beneath_pipeline.layers.earthquakes import compact, parse_rows, year_windows

CSV = """time,latitude,longitude,depth,mag,magType,id,place,type
2011-03-11T05:46:24.120Z,38.297,142.373,29,9.1,mww,a1,"2011 Great Tohoku Earthquake, Japan",earthquake
2011-03-11T06:08:29.660Z,38.969,143.37,2.8,6.7,mb,a2,"134 km ESE of Kamaishi, Japan",earthquake
2011-03-12T01:00:00.000Z,40.0,140.0,1,5.2,mb,a3,"blast",explosion
2011-03-12T02:00:00.000Z,40.0,140.0,,5.4,mb,a4,"no depth",earthquake
2011-03-12T03:00:00.000Z,40.0,140.0,10,4.8,mb,a5,"too small",earthquake
"""


def test_year_windows_stop_at_fixed_end():
    w = year_windows(2024, "2026-09-01")
    assert w == [("2024-01-01", "2025-01-01"), ("2025-01-01", "2026-01-01"), ("2026-01-01", "2026-09-01")]


def test_parse_keeps_only_earthquakes_with_depth_above_minimum():
    rows = parse_rows(CSV, 5)
    assert [r["id"] for r in rows] == ["a1", "a2"]
    assert rows[0]["days"] == 15044   # 2011-03-11 is day 15,044 after 1970-01-01


def test_compact_rounds_and_names_only_large_events():
    doc = compact(parse_rows(CSV, 5), named_from=7)
    assert doc["count"] == 2 and doc["stride"] == 5
    assert doc["data"][:5] == [142.37, 38.3, 29, 9.1, 15044]
    assert doc["data"][5:8] == [143.37, 38.97, 2.8]
    assert doc["names"] == {"0": "2011 Great Tohoku Earthquake, Japan"}
