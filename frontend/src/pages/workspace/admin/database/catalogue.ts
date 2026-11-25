export interface SchemaTable {
  name: string;
  description: string;
}

export interface SchemaGroup {
  id: string;
  name: string;
  description: string;
  icon: string;
  tables: SchemaTable[];
}

// Static documentation, not a live inventory or a count of database records.
// Group membership: the supplied 95-table Curriculum Schema audit catalogue.
// Business purposes checked against curriculum_api models, calendar_holidays,
// review_schedule/review_instances, web_week_points, versioning, module_hours,
// source catalogues, and specs/audits/dev-production-readiness/evidence/schema.json.
const group = (id: string, name: string, description: string, icon: string,
  entries: [string, string][]): SchemaGroup => ({
  id, name, description, icon,
  tables: entries.map(([name, description]) => ({ name, description })),
});

export const schemaGroups: SchemaGroup[] = [
  group('core-curriculum', 'Core Curriculum', 'Programmes, cohorts, groups and the structure of learning.', 'ri-book-open-line', [
    ['cohorts', 'ينظم الدفعات التدريبية ومواعيد بدايتها ونهايتها ضمن البرامج.'],
    ['components', 'يحدد أنشطة التعلم داخل الأسابيع، مثل القراءة والاختبارات، ومتطلبات تنفيذها.'],
    ['groups', 'ينظم مجموعات المتعلمين داخل الدفعات ومواعيد جلساتها والمدرب المسؤول عنها.'],
    ['historical_components', 'يحفظ تعريفات الأنشطة السابقة من أنظمة التعلم المصدرية للاحتفاظ بسياق التعلم التاريخي.'],
    ['module_completion_criteria', 'يحدد شروط إكمال الموديول، مثل إنهاء الاختبارات وتحقيق الدرجة المطلوبة.'],
    ['module_details', 'يوضح أهداف الموديول وفوائده للمتعلم وصاحب العمل ومتطلبات التقييم النهائي.'],
    ['modules', 'يعرّف الموديولات التدريبية ومحتواها ومواعيدها وساعاتها المخططة.'],
    ['programmes', 'يعرّف البرامج التدريبية ومستوياتها وأهدافها وساعات التدريب المطلوبة.'],
    ['weeks', 'ينظم أسابيع التعلم داخل الموديول وترتيبها وعناوينها ومخرجاتها.'],
  ]),
  group('week-templates-calendar', 'Week Templates and Calendar', 'Reusable learning weeks, holiday calendars and scheduling choices.', 'ri-calendar-line', [
    ['calendar_countries', 'يعرّف الدول المدعومة وأيام الراحة الأسبوعية الافتراضية لكل دولة.'],
    ['calendar_holidays', 'المصدر الموحد لجميع الإجازات الرسمية والمحلية، ويحتفظ بأسمائها وتواريخها ومصدرها.'],
    ['cohort_calendar_holidays', 'يحدد الإجازات التي تنطبق على كل دفعة تدريبية أو التي تم استثناؤها منها.'],
    ['country_holiday_calendars', 'يحتفظ بتقاويم الإجازات المستوردة لكل دولة وسنة ويتابع حالة تحديثها.'],
    ['module_calendar_holidays', 'يسجل الإجازات والإغلاقات الخاصة بكل موديول تدريبي.'],
    ['web_week_points', 'ينظم أنشطة الأسبوع في نقاط تعليمية مسماة لتسهيل عرضها للمتعلم.'],
    ['week_template_components', 'يحدد الأنشطة ومتطلبات التعلم داخل قوالب الأسابيع القابلة لإعادة الاستخدام.'],
    ['week_templates', 'يحفظ قوالب أسابيع جاهزة بمخرجاتها وأنشطتها لاستخدامها في إعداد المحتوى التدريبي.'],
  ]),
  group('coaches-tutors', 'Coaches and Tutors', 'Teaching staff, group assignments and module notifications.', 'ri-team-line', [
    ['coaches', 'يحتفظ ببيانات المدربين وحالة نشاطهم للتواصل وتوزيع المسؤوليات.'],
    ['group_coaches', 'يحدد المدربين المسؤولين عن متابعة كل مجموعة تدريبية.'],
    ['tutor_module_notifications', 'يتابع إشعارات إسناد الموديولات للمعلمين وحالة إرسالها ومحاولات الإرسال.'],
    ['tutors', 'يحتفظ ببيانات المعلمين ووسائل التواصل معهم وحالة نشاطهم.'],
  ]),
  group('free-courses', 'Free Courses', 'Free course content and its weekly organisation.', 'ri-graduation-cap-line', [
    ['free_course_weeks', 'ينظم أسابيع الدورات المجانية وترتيبها وملخص أنشطتها وساعاتها.'],
    ['free_courses', 'يعرّف الدورات المجانية ووصفها وصورها وترتيب عرضها.'],
    ['free_programme_components', 'يحتفظ بأنشطة الدورات المجانية ومحتواها ومتطلبات إنجازها.'],
  ]),
  group('ksb', 'KSB', 'Knowledge, skills and behaviours covered by learning activities.', 'ri-award-line', [
    ['ksb_component_mappings', 'يحدد المعارف والمهارات والسلوكيات التي يغطيها كل نشاط تعليمي.'],
    ['ksb_source_activity_mappings', 'يحدد المعارف والمهارات والسلوكيات التي تغطيها الأنشطة المستوردة من مصادر التعلم.'],
    ['ksb_standard_definitions', 'يعرّف عناصر المعرفة والمهارات والسلوكيات المطلوبة في المعايير التدريبية.'],
    ['ksb_standard_versions', 'يحفظ إصدارات المعايير التدريبية للتمييز بين متطلبات كل إصدار.'],
  ]),
  group('quizzes', 'Quizzes', 'Assessments, questions, answer choices and learning placement.', 'ri-question-line', [
    ['quiz_answers', 'يحتفظ بخيارات الإجابة لكل سؤال ويحدد الخيارات الصحيحة وترتيب عرضها.'],
    ['quiz_component_links', 'يحدد الاختبارات المستخدمة ضمن الأنشطة التعليمية.'],
    ['quiz_course_links', 'يحدد الموديولات والأسابيع التي تتضمن كل اختبار.'],
    ['quiz_questions', 'يحتفظ بأسئلة الاختبارات وأنواعها ودرجاتها وشروحات الإجابة.'],
    ['quizzes', 'يعرّف الاختبارات وإعدادات النجاح والمحاولات والنشر وطريقة عرض الأسئلة.'],
    ['source_reading_quiz_pairs', 'يحدد اختبار التقييم المصاحب لكل نشاط قراءة مستورد ضمن المجموعة.'],
  ]),
  group('module-hours', 'Module Hours', 'Planned training hours, targets and the history of adjustments.', 'ri-time-line', [
    ['module_hours_access', 'يحدد صلاحيات الوصول إلى إدارة ساعات الموديولات.'],
    ['module_hours_audit', 'يسجل تغييرات الساعات المستهدفة وصلاحيات إدارتها والقيم السابقة والجديدة ومن عدلها.'],
    ['module_hours_targets', 'يحدد الساعات المستهدفة للموديولات لمقارنتها بالساعات المخططة.'],
    ['source_planned_hours_bulk_batches', 'يسجل عمليات تعديل الساعات المخططة لمجموعة من الأنشطة وملخص نتائجها.'],
    ['source_planned_hours_bulk_items', 'يوضح نتيجة تعديل الساعات لكل نشاط ضمن عملية جماعية، مع الساعات السابقة والجديدة.'],
    ['source_planned_hours_default_revisions', 'يحفظ تاريخ تغييرات الساعات الافتراضية للأنشطة المصدرية ومن نفذها.'],
    ['source_planned_hours_defaults', 'يحدد الساعات المخططة الافتراضية للأنشطة المصدرية حسب المجموعة التدريبية.'],
  ]),
  group('live-sessions-attendance', 'Live Sessions and Attendance', 'Scheduled sessions, attendance evidence, absences and recordings.', 'ri-video-line', [
    ['live_session_absence_report_links', 'يوثق مطابقة بلاغات الغياب القديمة مع سجلات الغياب المعتمدة.'],
    ['live_session_absence_report_sources', 'يحفظ نسخة من بلاغات الغياب القديمة للرجوع إلى مصدرها أثناء المراجعة.'],
    ['live_session_absence_review_events', 'يسجل قرارات مراجعة بلاغات الغياب وتغييرات حالتها وأسبابها ومن أجراها.'],
    ['live_session_absences', 'يسجل غياب المتعلم عن الجلسة وبلاغه وخيار تعويض التعلم الفائت.'],
    ['live_session_artifacts', 'يحتفظ بمراجع تسجيلات الجلسات والنصوص المفرغة وحالة حفظها.'],
    ['live_session_attendance', 'يحفظ أدلة الحضور الواردة من Teams، مثل فترات الانضمام ومدة الحضور.'],
    ['live_session_attendance_aliases', 'يعرّف عناوين البريد البديلة المعتمدة للتعرف على حضور المتعلم في الموديول.'],
    ['live_session_attendance_identity_audit', 'يسجل تغييرات مطابقة هويات الحضور مع المتعلمين ومن أجراها.'],
    ['live_session_attendance_identity_links', 'يوثق ربط حضور مشارك في جلسة محددة بالمتعلم الصحيح بعد المراجعة.'],
    ['live_session_attendance_identity_rules', 'يحفظ قواعد مطابقة هويات المشاركين مع المتعلمين داخل الموديول.'],
    ['live_session_join_launches', 'يسجل فتح روابط الانضمام للجلسات من المنصة للمساعدة في تتبع الوصول.'],
    ['live_session_learner_attendance', 'يعرض سجل الحضور النهائي لكل متعلم في الجلسة ومدة حضوره وحالة التعويض.'],
    ['live_session_occurrences', 'يحفظ كل موعد منفرد للجلسة ومواعيده الفعلية وحالته وأدلة حضوره.'],
    ['live_session_recording_events', 'يسجل تفاعلات المشاهدة مع التسجيل، مثل التشغيل والإيقاف وتجاوز المقاطع.'],
    ['live_session_recording_views', 'يتابع مدة مشاهدة المتعلم للتسجيل وآخر موضع وصل إليه.'],
    ['live_session_recovery_transitions', 'يحفظ مراحل تغير حالة تعويض الجلسة الفائتة وأسبابها وأدلتها.'],
    ['live_sessions', 'يعرّف الجلسات المباشرة ومواعيدها وتكرارها والمشاركين وإعدادات الاجتماع.'],
    ['qr_attendance', 'يسجل تأكيد حضور المتعلم باستخدام رمز الاستجابة السريعة.'],
    ['session_result_archive', 'يتابع أرشفة تسجيلات الجلسات ونصوصها وحالة حفظها وأخطاء الأرشفة.'],
    ['session_result_jobs', 'يتابع مهام جمع نتائج الجلسات وحالتها ومحاولات إعادة المعالجة.'],
  ]),
  group('reviews', 'Reviews', 'Review templates, learner meetings, answers and signatures.', 'ri-file-list-3-line', [
    ['learner_review_additions', 'يسجل المراجعات الإضافية المقررة لمتعلم معين ومواعيدها وأسباب إضافتها.'],
    ['review_clash_resolutions', 'يحفظ قرارات الإبقاء على المراجعات المتزامنة في الشهر نفسه ضمن البرنامج.'],
    ['review_fields', 'يحدد أسئلة وحقول نماذج المراجعة ومتطلبات الإجابة وترتيب العرض.'],
    ['review_instance_answers', 'يحفظ الإجابات المدخلة خلال مراجعة المتعلم ومن أجاب وتوقيت الإجابة.'],
    ['review_instance_manual_overrides', 'يوثق التغييرات اليدوية على حالة المراجعة وأسبابها ومن نفذها.'],
    ['review_instance_reopens', 'يسجل إعادة فتح المراجعات مع أسبابها وحالتها السابقة.'],
    ['review_instance_signatures', 'يحفظ توقيعات المشاركين على مراجعة المتعلم وصفاتهم وتاريخ التوقيع.'],
    ['review_instances', 'يتابع كل مراجعة مقررة لمتعلم، من موعدها حتى بدئها وإكمالها.'],
    ['review_occurrence_overrides', 'يحفظ قرارات تخطي مواعيد مراجعة محددة وأسبابها دون تغيير نمط التكرار.'],
    ['review_sections', 'ينظم أقسام نموذج المراجعة وترتيبها والوقت المتوقع لكل قسم.'],
    ['review_templates', 'يعرّف نماذج المراجعات وتكرارها والمشاركين ومتطلبات التوقيع والإشعارات.'],
    ['review_types', 'يعرّف أنواع المراجعات المتاحة وأسماءها وحالة استخدامها.'],
  ]),
  group('source-lms-content', 'Source LMS and Content', 'Imported learning catalogues, activities and source materials.', 'ri-folder-line', [
    ['source_activities', 'يفهرس الأنشطة القادمة من مصادر التعلم ويتابع مطابقتها بأنشطة المنهج.'],
    ['source_courses', 'يفهرس الدورات القادمة من مصادر التعلم ويتابع مطابقتها بالبرامج والموديولات.'],
    ['source_lms_activities', 'يحفظ تفاصيل أنشطة نظام التعلم المصدري، مثل القراءة والفيديو والاختبارات.'],
    ['source_lms_group_activities', 'يحدد أنشطة كل مجموعة في نظام التعلم المصدري وترتيب عرضها.'],
    ['source_lms_groups', 'يحتفظ بالمجموعات المعروفة من نظام التعلم المصدري وأسماءها وتواريخ رصدها.'],
    ['source_lms_raw_pages', 'يحفظ دفعات البيانات المستلمة من نظام التعلم المصدري للرجوع إليها أثناء الاستيراد.'],
    ['source_materials', 'يفهرس المواد التعليمية وروابطها ومددها وحالة النسخ المحفوظة منها.'],
  ]),
  group('microsoft-teams', 'Microsoft Teams', 'Meeting creation, calendar synchronisation and delivery tracking.', 'ri-calendar-event-line', [
    ['module_teams_shares', 'يحدد الموديولات التي تشترك في جلسات Teams مع موديول مصدر.'],
    ['teams_calendar_create_claims', 'يتابع طلبات إنشاء تقويم الجلسات لمنع تكرار الإنشاء عند تزامن الطلبات.'],
    ['teams_calendar_create_drafts', 'يحفظ مسودات إعداد تقويم Teams قبل إتمام إنشاء الجلسات.'],
    ['teams_calendar_integrity_events', 'يسجل أحداث التغيير والتحقق من تقويم Teams ونتائجها ومن بدأها.'],
    ['teams_calendar_sync_state', 'يحفظ آخر حالة تم التحقق منها عند مزامنة تقويم الجلسات.'],
    ['teams_graph_failures', 'يسجل إخفاقات التواصل مع خدمات Microsoft لتشخيص مشكلات الاجتماعات.'],
    ['teams_organization_calendar_connections', 'يحفظ إعدادات ربط تقاويم المؤسسة بخدمات Microsoft Teams.'],
    ['teams_schedule_emails', 'يتابع إرسال رسائل مواعيد الجلسات للمستلمين وحالة التسليم ومحاولاته.'],
  ]),
  group('learner-activity-display', 'Learner Activity Display', 'Activity visibility choices and their audit history.', 'ri-eye-line', [
    ['activity_events', 'يسجل استخدام المنصة، مثل فتح الصفحات وعرض المحتوى وتنزيله، لأغراض المتابعة.'],
    ['learner_activity_display_audit', 'يحفظ تاريخ تعديلات ظهور الأنشطة لكل متعلم وأسبابها ومن نفذها.'],
    ['learner_activity_display_overrides', 'يحفظ قرارات تخصيص حالة ظهور نشاط معين لمتعلم في موديول محدد.'],
  ]),
  group('versioning-cache', 'Versioning and Cache', 'Change history, saved versions and keeping displayed content fresh.', 'ri-history-line', [
    ['cache_epoch', 'يشير إلى تغير محتوى المنهج حتى تعيد المنصة تحميل النسخ المحفوظة مؤقتاً.'],
    ['cache_scope_epoch', 'يتابع التحديثات لكل نطاق من المحتوى لتحديث العرض المتأثر بالتغيير.'],
    ['record_revisions', 'يسجل تاريخ تغييرات محتوى المنهج مع نسخته وقت التغيير والسبب ومن أجراه.'],
    ['record_versions', 'يحفظ الإصدارات المسماة من محتوى المنهج وملاحظات كل إصدار.'],
  ]),
];

export const totalTables = schemaGroups.reduce((sum, item) => sum + item.tables.length, 0);

export function searchCatalogue(query: string, groups = schemaGroups): SchemaGroup[] {
  const term = query.trim().toLocaleLowerCase();
  if (!term) return groups;
  return groups.flatMap(item => {
    const tables = item.name.toLocaleLowerCase().includes(term) ? item.tables : item.tables.filter(table =>
      table.name.toLocaleLowerCase().includes(term) || table.description.includes(term));
    return tables.length ? [{ ...item, tables }] : [];
  });
}
