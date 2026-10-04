"""Build the post-write Martech SSOT report without exposing evidence payloads."""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
POSTWRITE = ROOT / "reports" / "martech_postwrite_dryrun_2026-10-04.json"
WRITE_RESULT = ROOT / "reports" / "martech_write_result_2026-10-04.json"
OUT = ROOT / "reports" / "martech_ssot_style_report_2026-10-04.md"

THUR = {
    8533: ("Abigail Reece", "249:00:00"), 8207: ("Alice Ward", "202:00:00"),
    6034: ("Daisy Rumney", "222:00:00"), 6004: ("Darcey Woodley-Allen", None),
    7222: ("Emily Felton", "259:00:00"), 6285: ("Emily Hancock", "168:00:00"),
    6511: ("Georgia Fenn", "207:00:00"), 7741: ("Jack Hollis", "194:00:00"),
    6737: ("Jonwilliam Macintyre", "322:00:00"), 6320: ("Lisa Atkins", "191:00:00"),
    8534: ("Lois Reilly", "271:00:00"), 6512: ("Megan Walkey", "184:00:00"),
    8297: ("Skye Friskney", "192:00:00"), 6543: ("Yasaman Ziyarati", "241:00:00"),
    6118: ("Zoe Moore Williams", "212:00:00"),
}
FRI = {
    6177: ("Bethanie-Taylor Grenfell", "232:00:00"), 10172: ("Carly Cook", "202:00:00"),
    6433: ("Charlie Leighton", "282:00:00"), 6301: ("Christopher McIntosh", "164:00:00"),
    8708: ("Curran Rana", "227:00:00"), 8390: ("Curtis Cooper", "278:00:00"),
    6144: ("Genevieve Alltimes", "234:00:00"), 7166: ("Isabella Haynes", "256:00:00"),
    6162: ("Jack Junor-Graham", "423:00:00"), 6372: ("Jody Nicholas", "250:00:00"),
    10638: ("Lauren-Eden Penn", "184:00:00"), 7165: ("Leanne Ashcroft", "538:00:00"),
    6358: ("Megan Hodson", "253:00:00"), 9870: ("Mia Murray", "263:00:00"),
    6218: ("Millie Brar", "274:00:00"), 10083: ("Shezreah Yousaf", "176:00:00"),
}


def seconds(value: str | None) -> int | None:
    if not value:
        return None
    h, m, s = (int(part) for part in value.split(":"))
    return h * 3600 + m * 60 + s


def fmt(value: int) -> str:
    sign = "-" if value < 0 else ""
    value = abs(value)
    return f"{sign}{value // 3600}:{(value % 3600) // 60:02d}:{value % 60:02d}"


def table(rows: dict[int, tuple[str, str | None]], by_id: dict[int, dict]) -> list[str]:
    lines = ["| Aptem ID | الطالب | Aptem | SSOT بعد الإصلاح | الفرق |", "|---:|---|---:|---:|---:|"]
    for aid, (name, raw) in rows.items():
        current = int(by_id[aid]["ssot_accepted_before_seconds"])
        raw_seconds = seconds(raw)
        diff = "—" if raw_seconds is None else fmt(current - raw_seconds)
        lines.append(f"| {aid} | {name} | {raw or '—'} | {fmt(current)} | {diff} |")
    return lines


def main() -> None:
    post = json.loads(POSTWRITE.read_text(encoding="utf-8"))
    result = json.loads(WRITE_RESULT.read_text(encoding="utf-8"))
    by_id = {int(row["aptem_id"]): row for row in post["learners"]}
    conflicts = {"count": 29, "seconds": 702900, "hours": "195:15:00"}
    lines = [
        "# Martech — SSOT post-write report",
        "",
        f"Write run: **{result.get('run_id', '—')}** · Database: **{post.get('database', '—')}** · LMS exclusions: **0**",
        "",
        "## Martech – Thur",
        "",
        "- **Coach:** Med Maher",
        "- **Tutor:** Keith Rowland",
        "- **ملاحظة:** يوجد سجل واحد باسم **Default Owner** ضمن البيانات المرسلة.",
        "- **عدد الطلاب:** 15",
        "- **Aptem الخام:** 3114:00:00",
        "- **SSOT بعد الإصلاح:** 4813:41:35",
        "- **الفرق:** +1699:41:35",
        "- **التكرار:** 29 تطابق Aptem/Journal مؤكد المدة بإجمالي 195:15:00 محجوز لبوابة Soft correction؛ لم يتم استبعاده بعد.",
        "",
    ]
    lines += table(THUR, by_id) + ["", "## Martech – Fri", "", "- **Coach:** Radwa Samir", "- **Tutor:** Keith Rowland", "- **عدد الطلاب:** 16", "- **Aptem الخام:** 4236:00:00", "- **SSOT بعد الإصلاح:** 6179:59:36", "- **الفرق:** +1943:59:36", "- **التكرار:** 29 تطابق Aptem/Journal مؤكد المدة بإجمالي 195:15:00 محجوز لبوابة Soft correction؛ لم يتم استبعاده بعد.", ""]
    lines += table(FRI, by_id)
    lines += [
        "",
        "## حالات متبقية للمراجعة",
        "",
        "- **Darcey Woodley-Allen:** 3 Evidence بدون Start/End موثّق؛ لم يتم تعديلها.",
        "- **Leanne Ashcroft:** 17 Additional و4 Parent repairs محجوزة بسبب السعة/التاريخ؛ لم يتم تعديلها.",
        f"- **Duration conflicts:** {conflicts['count']} صفًا بإجمالي {conflicts['hours']}؛ لا يتم اختيار Aptem أو Journal تلقائيًا عند اختلاف المدة.",
        "- **Azure:** 390/390 مرجع موجود، 0 مفقود.",
        "- **الحالة النهائية:** REVIEW/BLOCKED؛ بقية المرشحين تم تنفيذهم والتحقق منهم، لكن Soft correction للتطابقات الـ29 يحتاج موافقة مستقلة.",
    ]
    OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(OUT)


if __name__ == "__main__":
    main()
