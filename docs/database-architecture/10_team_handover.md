# Team handover / ملخص التسليم

## الملخص التنفيذي

تم جرد الفرع `lms-ideal-architecture` من ناحية البنية: **595 جدولًا فعليًا ضمن 25 مخططًا تحتوي جداول، و30 مخططًا غير نظامي إجمالًا**. استُخدم فقط `LMS_REFACTOR_DATABASE_URL` بعد التحقق من هوية الفرع عبر Neon وقاعدة البيانات نفسها. لم يتم الاتصال بقاعدة الإنتاج، أو تعديل بيانات أو جداول أو كود التطبيق أو ملفات البيئة.

أهم النتائج:

- **4 سجلات** في `curriculum.week_templates` بلا برنامج أب مطابق.
- **5,830 سجلًا** في `Learner.learner_progress_ksbs` تخالف قيد منع رموز JSON غير الصالحة.
- **50 جدولًا بلا مفتاح أساسي**؛ كثير منها تاريخي أو تشغيلي، فلا يُقترح تعديلها جميعًا تلقائيًا.
- **22 قيدًا غير متحقق منه بالكامل**: 11 FK و11 CHECK. ظهر خلل في قيدين؛ بقية العشرين اجتازت استعلامات فحص البيانات الحالية، ولم يتم تفعيل التحقق في قاعدة البيانات.
- **فهرس واحد غير صالح**، و110 مرشحات لفهارس داعمة للعلاقات، و67 مجموعة فهارس متداخلة تحتاج قياس الاستخدام ومراجعة الاعتمادات.
- **صفر علاقات FK مفقودة مؤكدة** ضمن ما أمكن إثباته؛ توجد حالة قديمة غير محسومة. هذا ليس ضمانًا لعدم وجود علاقات ناقصة أخرى.

المقترح يحافظ على المجالات والأسماء والعقود الحالية، ويبدأ بسلامة البيانات وملكية الجداول والتحقق من القيود، ثم التحسين وفق قياسات فعلية. أول مهمة موصى بها: معالجة مراجع قوالب الأسابيع الأربعة بعد اعتماد الربط الصحيح لكل سجل. لا توجد موافقة ضمنية على ترحيل أو حذف.

## Evidence summary

| Metric | Observed |
| --- | --- |
| Schemas / table-bearing schemas | 30 / 25 |
| Local tables / foreign tables / views | 595 / 2 / 36 |
| PK present / missing | 545 / 50 |
| FK / confirmed missing required FK | 287 / 0, one unresolved legacy candidate |
| Unvalidated constraints / invalid indexes | 22 / 1 |
| Exact profiling | 541 tables, 7,091 columns |
| Deferred full profiles | 54 larger tables |
| FK anti-joins complete / deferred | 260 / 27 |
| Unvalidated CHECK predicates checked | 11 of 11 |
| All-null / other at least 95%-null columns | 212 / 166, in nonempty profiled tables |
| Exactly counted empty tables | 92 |
| Measured application-runtime bottlenecks | 0; representative workload unavailable |
| High-priority performance investigations | 3: invalid index, full-history grouping, exact global counts |
| Current / proposed ERD parts | 52 / 52 |

## Deliverables

1. [Database inventory](01_database_inventory.md)
2. [Relationships](02_relationship_audit.md)
3. [Primary/foreign keys](03_primary_foreign_keys_audit.md)
4. [Data quality](04_data_quality_audit.md)
5. [Performance](05_query_performance_audit.md)
6. [Django/API mapping](06_django_database_mapping.md)
7. [Target architecture](07_target_database_architecture.md)
8. [Roadmap](08_refactoring_roadmap.md)
9. [Migration/rollback](09_migration_and_rollback_strategy.md)
10. This handover.

Supporting artifacts: [findings](evidence/findings.csv), [inventory CSV](evidence/database_inventory.csv), [dependency matrix](evidence/dependency_matrix.csv), [index recommendations](evidence/index_recommendations.csv), [query matrix](evidence/query_optimization_matrix.csv), [migration sequence](evidence/migration_sequence.csv), [ERD index](evidence/erd_index.csv), [audit provenance](evidence/audit_provenance.json).

## Validation and limits

Changed: only audit documents, catalog/aggregate reports and diagrams under `docs/database-architecture/`. No application, configuration or test-policy changes.

Teams baseline: **NOT REQUIRED** — no Teams file or imported behavior edited.

Expanded Teams checks: **NOT REQUIRED** — analysis/documentation only.

Live Teams: **NOT RUN**; no Graph, invitation, email or storage actions.

Feature/backend/browser tests: **NOT RUN** — no implementation changed; application/test startup could use other aliases or mutate data. Plain EXPLAIN did not execute the application queries.

Documentation verification: [validation results](evidence/validation_results.json) records exact artifact/link/count/diagram/secret-check outcomes. [Final database verification](evidence/final_database_verification.json) reconfirms branch identity, read-only mode and structural counts. Initial connection-option failure, combined size-query timeout and FK-batch timeout were recovered with transaction-local settings and smaller queries; failed attempts are not described as passing.

Outstanding: approve P0 remediation rules; complete relevant 54 larger-table profiles and 27 FK anti-joins; obtain representative application performance evidence; verify static dependencies at runtime; resolve optional/absent model mappings and external ownership; prove cross-alias completeness and restore readiness. Implementation approval, migrations and feature tests are future work. This audit does not certify production readiness.

## Review decisions

- Curriculum owner: approve original programme mappings and downstream impact for four orphan templates.
- Progress/KSB owner: approve preservation/remediation and importer investigation for 5,830 invalid-token rows.
- Database owner: approve one clean-constraint validation or index investigation task, separately scoped.
- Application/integration owners: confirm views, aliases, legacy identifier meanings, staff email multiplicity and external consumers.

Actual learner identities and credentials are intentionally excluded. Operational mappings must use an approved private workflow on this branch. Names, NULL values, absent references and zero branch scan counts are not deletion evidence.
