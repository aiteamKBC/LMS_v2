# قواعد حساب كروت الطالب

Programme Progress  |  Attendance  |  OTJ Hours  |  KSB Progress

مراجعة المصادر والتنفيذ: 12 سبتمبر 2026. توثق هذه النسخة القواعد التي أكدها صاحب المشروع والمصادر المستخدمة في ملخص الطالب الجديد.

### ١. التمييز بين الطالب الجديد والمنقول

الطالب الذي له Aptem ID صحيح وموجب طالب منقول: تُجمع بياناته القديمة مع إنجازاته الجديدة في نظامنا. الطالب بلا Aptem ID طالب جديد: يُحسب من بيانات نظامنا فقط.

`enrolment."Created_users".id  /  enrolment."Created_users".aptem_id`

لا يتغير تصنيف الطالب المنقول إلى جديد لمجرد غياب بياناته القديمة أو تعطل قراءتها. في هذه الحالة تظهر البيانات الناقصة كغير متاحة، وليس كصفر.

### ٢. القواعد المتفق عليها

Programme Progress: عدد الأنشطة/الكومبوننت المكتملة ÷ إجمالي أنشطة البرنامج × 100. يشمل البرنامج كله، وليس الموديول الحالي فقط. أكد صاحب المشروع أن القياس بالأنشطة وليس بعدد الموديولات المكتملة.

الإنجاز القديم يظل محفوظًا؛ إكمال نشاط جديد مؤهل يرفع العدد المكتمل. النشاط نفسه إذا ظهر في المصدرين يُحسب مرة واحدة، وتكون حالته مكتملة إذا ثبت اكتماله في أي مصدر.

Attendance: عدد الجلسات التي حضرها الطالب من المصدرين ÷ إجمالي جلساته المحسوبة من المصدرين × 100. جدول KBC مصدر متجدد بسبب الـworkflow، لذلك لا يُثبت كسجل حضور قديم لا يتغير.

TP Planned: الساعات المخططة من خطة التدريب المتفق عليها في العقد المحفوظ. لا تستبدل تلقائيًا بمجموع ساعات المحتوى الحالي، ولا تزيد لمجرد إنجاز نشاط.

Actual: إجمالي الأوديت القديم الظاهر + الساعات الجديدة المسجلة في نظامنا. في المثال: 1171.34 ساعة قديمة + ساعة جديدة = 1172.34 ساعة.

KSB Progress: مجموع النقاط المحققة من الأنشطة المكتملة ÷ إجمالي نقاط كل الكومبوننتات × 100. القياس على النقاط داخل الكومبوننتات، وليس عدد أكواد KSB المميزة على مستوى البرنامج.

### ٣. قواعد الدمج

يُحسب البسط والمقام بعد دمج السجلات وإزالة تكرار الهوية الفعلية؛ لا تُجمع النسب ولا يؤخذ متوسطها. إعادة فتح النشاط أو إعادة إرسال الحفظ لا تضاعف الإنجاز أو الساعات.

التطابق بين المصدرين يحتاج معرفًا صريحًا؛ تشابه اسم النشاط أو اسم الطالب وحده لا يكفي. يجب فصل القديم والجديد في الحساب الداخلي لتسهيل المراجعة.

## مصادر Programme Progress وAttendance

### Programme Progress - المصدر القديم

الموديولات القديمة هي المرتبطة بالطالب في بيانات Audit المخزنة محليًا. يبدأ الربط من Aptem ID إلى هوية الطالب داخل Last_audit، ثم عضويات المجموعات وأنشطتها.

`"Last_audit".learners: aptem_id, learner_id`

`"Last_audit".group_learners: learner_id, group_id`

`"Last_audit".group_activities: group_id, activity_id`

`"Last_audit".activities: activity_id, activity_type`

`"Last_audit".activity_results: learner_id, group_id, activity_id, status`

`Completion fields: video_completed, reading_viewed, quiz_passed`

يؤخذ اكتمال النشاط وفق نوعه وقواعده الحالية. وجود محاولة اختبار وحده لا يعني النجاح، والقراءة المصحوبة باختبار تحتاج تحقق شروط الاثنين. لا يُستخدم اتصال المصدر الخارجي لإعادة تعريف الرصيد القديم في الكارت.

### Programme Progress - الجديد

`enrolment."Created_users": "Training_plan", "Learning_plan"`

`"Learner".learners: id, enrolment_id`

`curriculum.components: id, module_catalogue_id, type`

`"Learner".learner_progress_entries: learner_id, component_ref, quiz_ref, kind, passed`

يقتصر الإجمالي على أنشطة البرنامج المسند للطالب. الإنجازات الجديدة على الأنشطة القديمة تُقرأ أيضًا من جدول المحاولات المحلي التالي؛ فهي جديدة حتى لو كان محتوى النشاط قديمًا.

`"Learner".subject_activity_attempts: enrolment_id, aptem_id, group_id, activity_id, completed, submitted_at`

### Attendance - الجدول القديم المتجدد

`Database: AiTeamKBC  |  Table: public.kbc_attendance`

`Identity: "ID" = Aptem ID  |  Row: "key", "date"`

`Attendance: "Attendance", attendance_status, module, lecture_name`

اسم الجدول الفعلي هو public.kbc_attendance. قيمة Attendance = 1 حضور، و0 غياب؛ التأخر يُحسب حضورًا وفق القاعدة الحالية. الطالب الجديد بلا Aptem ID لا يُضم له سجل قديم بمجرد تشابه البريد الإلكتروني.

### Attendance - تقارير Microsoft Teams الجديدة

`curriculum.live_session_attendance: occurrence_id, email, graph_record_id, total_attendance_seconds, intervals`

`curriculum.live_session_occurrences: id, live_session_id, attendance_report_id, scheduled_start, actual_start`

`curriculum.live_sessions: id, attendees, module_catalogue_id`

وجود تقرير حضور هو الأساس لتقييم الجلسة؛ غياب التقرير ليس غيابًا للطالب. الدعوات تحدد الطلاب المتوقع حضورهم، وتُدمج مرات دخول الطالب في الجلسة نفسها. لا توجد في KBC حاليًا خانة occurrence_id؛ أي تداخل بين المصدرين يحتاج ربطًا واضحًا قبل حذف جلسات باعتبارها مكررة.

## مصادر OTJ Hours وKSB Progress

### TP Planned - العقد المحفوظ

للخطة المستوردة من عقد الطالب المنقول، مصدر الساعات المخططة الموجود في قاعدة البيانات هو:

`fetching_evidence.aptem_cv_contracts_probe.training_plan_planned_hours`

`Identity/version: learner_id, document_name, date, fully_signed_date, id`

عند رفع خطة PDF من Audit، تُحفظ `training_plan_planned_hours` من إجمالي جدول Learning Plan بعد مطابقة مجموع أنشطته بالإجمالي المطبوع. لا تُستخدم ILR Planned Hours أو قيمة الحد الأدنى بديلًا عنه. الملفات التي لا يمكن التحقق من جدولها تُرفع مع تنبيه بضرورة المراجعة، وتظل ساعاتها غير متاحة. تغيير الاسم الظاهر للمستند لا يغير هويته؛ مطابقة سجل مكرر بلا ملف تستخدم الاسم الأصلي وتاريخ النسخة.

تُختار نسخة خطة التدريب الحالية غير المؤرشفة وغير المحذوفة باستخدام الاختيار الموجود في find_contract. للطالب الذي أُصدرت خطته داخل النظام، تُقرأ لقطة الساعات من الوثيقة المحفوظة:

`enrolment."Training_Plan_Documents"."Otjh" -> plannedTotal`

`Identity/version: "Learner_id", "Status", "Created_at"`

غياب وثيقة الخطة أو قيمة الساعات لا يسمح باختراع قيمة أو إظهار صفر. مراجعة ملف PDF للعقد خطوة مستقلة عند اختلاف المستخرج عن العقد؛ لا تُعاد قراءة PDF في كل انتقال بين الصفحات.

### Actual - إجمالي الرصيد القديم

الرقم الظاهر في المثال 1171.34 ساعة يأتي حاليًا من السجلات المقبولة غير المحذوفة في جدول الأوديت التالي، وليس من عمود مباشر باسم Actual في Last_audit:

`structured_manual_activities.manual_learner_activities.actual_hours`

`Filter: aptem_id, accepted = true, deleted_at IS NULL`

أكد صاحب المشروع أن مصدر 1171.34 هو المصدر الصحيح للرصيد القديم. يوجد مجموع آخر قدره 614.6638 ساعة في الجدول التالي؛ لم تثبت علاقة احتوائه داخل الإجمالي المقبول، ولا يستخدم في حساب Actual الجديد:

`"Last_audit".activity_actual_hours: aptem_id, actual_hours`

### Actual - الساعات الجديدة

`"Learner".learner_progress_entries: learner_id, component_ref, claimed_seconds, reported_time, verified_seconds, time_tracking_source`

تُستخدم قواعد الوقت الحالية في completed_hours_value_from_progress وإزالة تكرارها. لا تُستنتج الساعات من عدد الضغطات أو المحاولات. جدول subject_activity_attempts يحفظ الاكتمال، لكنه لا يحتوي وحده على رصيد OTJ جديد؛ استكمال ساعة جديدة يحتاج مصدر وقت محفوظًا.

### KSB Progress - القديم والجديد

`Old targets: structured_manual_activities.activity_ksbs: activity_id, ksbs`

`Learner override: structured_manual_activities.learner_activity_ksbs: aptem_id, activity_id, ksbs, source_preference`

`Old completion: "Last_audit".activity_results: learner_id, group_id, activity_id, status, video_completed, reading_viewed, quiz_passed`

أكد صاحب المشروع أن المقصود بالنقاط القديمة هو نقاط أنشطة Last_audit في الجدولين أعلاه. عندما تكون source_preference = learner تستخدم نقاط الطالب، وإلا تستخدم نقاط النشاط المشتركة. قائمة نقاط فارغة محفوظة صراحة لا تستبدل بنقاط أخرى.

`New targets: curriculum.components.ksb_mappings / curriculum.ksb_mappings`

`New completion: "Learner".learner_progress_entries: component_ref, quiz_ref, kind, passed`

تحسب كل نقطة KSB داخل النشاط مرة واحدة، وتُحسب مرة أخرى إن كانت في نشاط مختلف. لا تتحول النسبة إلى عدد أكواد مميزة على مستوى البرنامج، ولا إلى مجموع الأوزان. اكتمال نشاط قديم عبر subject_activity_attempts يرفع نقاطه أيضًا، مع منع التكرار بالمعرف الصريح.

## نتائج التحقق والتنفيذ

### مثال تم التحقق منه بالقراءة فقط

طالب النظام 125 مرتبط بمعرف Aptem رقم 92. القيم التالية نتائج فحص بتاريخ 12 سبتمبر 2026، وليست أرقامًا ثابتة تُكتب في الكود.

خطة التدريب المستوردة: 867.00 ساعة. لا توجد لهذا الطالب وثيقة Training_Plan_Documents محلية وقت الفحص؛ لذلك يكون مصدر Planned هو العقد المستورد.

Actual القديم الدقيق: 1171.3406 ساعة. الجديد المسجل وقت الفحص: 0.0017 ساعة. المجموع: 1171.3423 ساعة، ويظهر بالتقريب 1171.34. Planned من العقد: 867.00 ساعة.

لقطة Aptem تحتوي 169 كومبوننت: 107 Completed و53 NotStarted و5 InProgress و4 EvidenceRequired. هذه لقطة مكونات Aptem وليست بديلًا عن أنشطة الموديولات المرتبطة بالطالب في Audit.

Programme Progress: 1227 نشاطًا مكتملًا من 3746، بنسبة 32.75%. تشمل الأنشطة القديمة والجديدة؛ إكمال مسجل حديثًا يضاف إلى إنجازات الأوديت.

KSB Progress: 5316 نقطة محققة من 13815 نقطة مستهدفة، بنسبة 38.48%. تشمل النتيجة نقاط الأنشطة وفق المصدر الذي أكده صاحب المشروع.

`GET /learner_api/metrics/<kind>/<enrolment_id>/`

`Implementation: backend/learner_api/dashboard_metrics.py`

فحص الملخص بالقراءة فقط اكتمل في حوالي 2.7 ثانية بعد حذف محتوى الأسئلة وأوصاف KSB غير اللازمة من الاستعلام. القياس محلي لعينة واحدة وليس ضمانًا لزمن كل اتصال.

### الاختيارات

تم التأكيد: Programme Progress بالأنشطة المكتملة ÷ كل الأنشطة. تم التأكيد: KSB Progress بمجموع النقاط المحققة ÷ مجموع نقاط كل الكومبوننتات.

مثال الساعات الموضح: إذا سجل الطالب ساعة جديدة فوق رصيده القديم الظاهر 1171.34، يصبح Actual = 1172.34 ساعة، وتظل TP Planned = 867.00 ساعة.

تم حسم مصدر KSB: نقاط أنشطة Last_audit، وليست إجماليات TotalCompletedKSB وTotalTargetKSB، ولا جدول aptem_component_ksbs الفارغ لهذا الطالب.

### اختبارات مطلوبة عند التنفيذ

١) طالب جديد: لا قراءة لسجل قديم. ٢) طالب منقول: جمع القديم والجديد. ٣) نشاط موجود بالمصدرين: يُحسب مرة واحدة. ٤) اكتمال جديد يرفع التقدم من دون تغيير الرصيد القديم.

٥) وصول صف KBC جديد يظهر في الحضور. ٦) تعدد مرات دخول Teams لا يضاعف الجلسات. ٧) ساعة LMS جديدة ترفع Actual ساعة واحدة وتترك Planned ثابتًا. ٨) KSB ناقصة الربط تظهر غير متاحة، مع الفصل بين النقاط المحققة وإجمالي النقاط.

### ملاحظات التنفيذ

الكروت ديناميكية: أي إضافة أو تصحيح أو حذف في المصادر القديمة أو الجديدة يعيد حساب الإجماليات والنسب، وقد تزيد النسبة أو تقل. الرصيد القديم ليس رقمًا مثبتًا في الكود. TP Planned يتغير عند تغيير خطة العقد المحفوظة، وليس لمجرد إكمال نشاط.

تُشارك الحسابات بين الكروت وصفحات التفاصيل. تُقرأ المصادر كل 30 ثانية أثناء ظهور الصفحة، وعند الرجوع للتبويب أو استعادة الاتصال. الحفظ داخل النظام يبطل الكاش وينبّه الكروت المفتوحة. تظل آخر أرقام ناجحة ظاهرة أثناء التحديث؛ يظهر فشل التحديث مع إعادة المحاولة تلقائيًا. يتوقف الفحص الدوري في التبويب المخفي.

نُفذت الحسابات في الكود وربطت بالكروت وصفحات التقدم والموديولات. لم تنفذ تغييرات قاعدة بيانات أو migrations. أي مخطط أو بيانات إضافية مستقبلًا تظل من اختصاص صاحب المشروع.
