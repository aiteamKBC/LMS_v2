# Additional Hours — تقرير ما بعد التنفيذ (2026-10-04)

## النطاق والقرار

- النطاق: **89 طالبًا** كانوا أقل من Aptem Actual قبل المعالجة.
- المصدر المسموح: Aptem **Additional job activity** وملفات Evidence المرتبطة بها فقط.
- لم تتم إضافة أي LMS Activity أو Assignment أو Journal أو Old LMS.
- جدول Aptem mirror الأصلي لم يُعدّل، ولم تُنفّذ أي Hard Delete أو Bulk Delete.
- Run ID: `1683` — الحالة: `completed_with_issues`.

## ما تمّت كتابته

| البند | النتيجة |
|---|---:|
| Evidence Additional مقبولة ومطبقة | 130 |
| الساعات المضافة | **387:10:00** |
| Parents جديدة | 121 |
| Parents موجودة تم تحويلها/تحديثها | 6 |
| Source rows جديدة | 121 |
| Source rows محدثة | 9 |
| Segments محفوظة | 164 |
| Azure Evidence links | 233 |
| Azure blobs جديدة مرفوعة | 0 |
| LMS rows مستبعدة | **0** |
| Evidence/source IDs مكررة داخل التشغيل | **0** |

### الطلاب الذين أضيفت لهم ساعات

| Aptem ID | الطالب | المضاف |
|---:|---|---:|
| 63 | Hoda Gad | 2:00:00 |
| 963 | Sarah Willingham | 79:50:00 |
| 1000 | Joanna Farn | 9:00:00 |
| 1055 | Harriet Clark | 10:30:00 |
| 1132 | Liberty Gascoigne | 9:00:00 |
| 1168 | Parisa Borghei | 12:00:00 |
| 1241 | Emma Rannard | 18:30:00 |
| 1262 | Daisy Laker | 1:00:00 |
| 1303 | Caitlin McLintock | 79:20:00 |
| 1392 | Olivia Anna Broome | 7:20:00 |
| 1518 | Adam Tomlinson | 4:00:00 |
| 1566 | Emma Dagnall | 1:00:00 |
| 1570 | Abigail Rooney | 23:30:00 |
| 1797 | Kelly Davies | 10:00:00 |
| 1930 | Alfie Long | 4:00:00 |
| 3535 | Paulina Patel | 21:10:00 |
| 4065 | Kirsty Darlington | 6:00:00 |
| 4336 | Nicholas Banks | 6:00:00 |
| 6117 | Connor Hewitson | 26:00:00 |
| 6333 | Ellis Smith | 1:00:00 |
| 6456 | Julia Bysshe | 3:00:00 |
| 6477 | Suzanne Parnham | 29:00:00 |
| 7503 | Callum Price | 8:00:00 |
| 8535 | Aarthi Dhanasekaran | 10:00:00 |
| 8861 | Janet Alderman | 0:30:00 |
| 10074 | Nicola Mansfield | 4:00:00 |
| 10122 | Kerry Ireland | 1:30:00 |

## مراجعة التكرار والـEvidence

- كل الساعات المطبقة مرتبطة بـ`source_evidence_id` من Aptem.
- تم ربط الـblobs الموجودة في حاوية `fetch-aptem-evidences`؛ لم يتم إنشاء نسخ ثانية.
- كل parent/source/segment يساوي مدة Aptem المعتمدة، مع حفظ lineage وAudit.
- لم تتم إضافة محتوى Evidence المصنّف LMS Activity إلى Assignment أو أي مكان آخر.

## عناصر متوقفة للمراجعة

| Evidence | Aptem ID | السبب | الإجراء |
|---:|---:|---|---|
| 39817 | 1303 — Caitlin McLintock | 100 دقيقة، لا يوجد توزيع زمني صالح ضمن تاريخ التعلم وحدود اليوم/الأسبوع/الشهر | لم تُضف |
| 39888 | 1132 — Liberty Gascoigne | 360 دقيقة، تاريخها لا يترك سعة زمنية صالحة قبل نهاية فترة التعلم | لم تُضف |

إجمالي المدة المتوقفة: **7:40:00**. كذلك بقيت سجلات المراجعة الأخرى من الـdry run دون تغيير؛ لم يتم إجبار أي مدة غير قابلة للإثبات.

## النتيجة بعد التنفيذ

- بعد إعادة حساب SSOT Actual مقابل Aptem Actual: **80 طالبًا ما زالوا أقل من Aptem**، و**9 طلاب أصبحوا مساويين أو أعلى**.
- هذا متوقع لأن الإضافة اقتصرت على Evidence Additional المقبولة فقط؛ لم تُستخدم ساعات LMS أو تقديرات غير مثبتة لسد الفجوة.
- أكبر الفجوات المتبقية تشمل: Emily Thornhill، Joanna Farn، Jessie Scott، Kieran Smith، Lauren Kent، Jamie Fowler، Kenneth George، Stephen Handley، وLiberty Gascoigne.
- المجموعة **ليست جاهزة للإغلاق** قبل مراجعة العناصر المتبقية وEvidence غير المدعومة/الغامضة.

## التحقق

- Database target: `neondb` تم التحقق منه دون طباعة بيانات الاتصال.
- Audit run ونتائج ما بعد الكتابة موجودة ومتحققة.
- لا توجد Actual سالبة في السجلات المطبقة.
- Teams baseline: **PASS — 105 tests**.
- Feature synthetic reconciliation test: **PASS — 17 tests**.
