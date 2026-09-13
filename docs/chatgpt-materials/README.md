# تسليم تجهيز أسبوع كامل من ChatGPT إلى LMS

النسخة التنفيذية الأحدث بالإنجليزي البريطاني: [HANDOFF_EN_GB.md](HANDOFF_EN_GB.md). تشمل اختيار الموديول المستهدف، قواعد الـ IDs، وربط الأسبوع بخطة المتعلم. ملف `backend/.env.chatgpt-materials.private` يحتوي نفس التعليمات كتعليقات مع قيم اتصال Azure وNeon الفعلية. التعليمات الإنجليزية الأحدث هي المرجع عند اختلافها مع هذه الملاحظات السابقة.

تاريخ المراجعة: 2026-09-13. المقصود ChatGPT Work حسب توضيح صاحب المشروع.

## القرار المقترح

يجهّز ChatGPT **حزمة أسبوع كاملة**: محتوى القراءة، شرائح، صوت، فيديو عند توفر أداة توليده، كويز بإجاباته، تكليف، وأسئلة reflection. تحفظ الملفات في Azure، وتحفظ بنية الأسبوع وروابط الملفات والأسئلة في جداول `curriculum` في Neon. يعرض LMS كل نوع في العارض المناسب له، وتظل الإجابات والتقدم داخل نظام LMS.

رفع ملفات على Azure، أو تسليم مفاتيح لـ ChatGPT، لا يضيف أسبوعًا تلقائيًا. نحتاج خطوة استيراد تربط الحزمة بالموديول والأسبوع والكويزات وتحدّث الكاش. **هذه الحزمة توثيق ومثال للتسليم؛ لم يتم بناء أو نشر مستورد أو MCP جديد.**

وفق `AGENTS.md` في هذا المشروع: لا ينفّذ الوكيل أي تعديل لقاعدة البيانات، سواء SQL أو عبر API. المسار المتوافق حاليًا هو تجهيز الملفات وSQL نهائي يراجعه صاحب المشروع وينفّذه بنفسه في Neon SQL Editor. الأتمتة التي تكتب البيانات بنفسها تحتاج تغييرًا صريحًا لهذه السياسة وتنفيذ الربط أولًا.

## الملفات

- `README.md`: أعطِ هذا الملف لـ ChatGPT مع المثال ومرجع الجداول.
- `week-package.example.json`: صيغة تسليم **مقترحة**، وليست payload يقبله endpoint موجود. الملفات المذكورة فيها أمثلة غير مولّدة.
- `schema-reference.json`: الأعمدة والقيم الافتراضية والقيود الفعلية لـ 15 جدولًا؛ تم استخراجها من Neon في transaction للقراءة فقط. لا تتضمن سجلات متعلمين أو مفاتيح.
- `inspect-target.sql`: استعلامات قراءة لاختيار الموديول والأسبوع وفحص الربط قبل إعداد SQL الإدخال.
- `.env.example`: أسماء الإعدادات بدون قيم سرية.
- `../../backend/.env.chatgpt-materials.private`: نسخة محلية من إعدادات Azure واتصال قاعدة البيانات الموجودة في `backend/.env`. يتجاهلها Git. **هذا الملف لمسؤول التشغيل وإعداد الاتصال السري، وليس مرفقًا في المحادثة أو جزءًا من حزمة المحتوى.**

## المفاتيح والإعدادات المطلوبة

| الإعداد | الاستخدام الفعلي | من يحتاجه؟ |
| --- | --- | --- |
| `Database_url` | PostgreSQL connection string، تشمل المضيف وقاعدة البيانات والمستخدم وكلمة المرور وSSL | مسؤول التشغيل؛ أو خدمة الربط مستقبلًا |
| `AZURE_STORAGE_ACCOUNT` | اسم حساب Blob Storage | backend / خدمة الربط |
| `AZURE_STORAGE_KEY` | مفتاح حساب التخزين المستخدم حاليًا في الكود | backend / مسؤول التشغيل؛ ليس المتعلم |
| `AZURE_CURRICULUM_CONTAINER` | حاوية الماتريال؛ الافتراضي الحالي `curriculum-uploads` | backend / خدمة الرفع |
| `AZURE_STORAGE_CONNECTION_STRING` | موجود في البيئة وقد يفيد أداة Azure خارجية؛ helper رفع المنهج الحالي يعتمد على account + key | اختياري، لا يغني وحده عن إعدادَي الكود الحاليين |
| `LMS_BASE_URL` | عنوان LMS المنشور الذي يراه المدير والمتعلم | يحدده مسؤول التشغيل؛ الاسم مقترح للحزمة |

`config/settings.py` يختار اتصال قاعدة البيانات بهذا الترتيب: `DATABASE_URL` ثم `DATABASEURL` ثم `Database_url`. الملف الخاص يحتفظ باتصال المصدر تحت الاسم `Database_url`. متغيرات بيئة السيرفر قد تتقدم على الملف المحلي؛ يجب مطابقة بيئة النشر قبل أي استيراد.

المطلوب هنا هو اتصال **PostgreSQL** المستخدم بالفعل في التطبيق. مفتاح إدارة Neon API شيء مختلف ولا يلزم لإضافة محتوى إلى الجداول الموجودة؛ يستخدم Neon API مفاتيحه للمصادقة على عمليات إدارة الخدمة. [توثيق Neon API](https://api-docs.neon.tech/reference/authentication).

لم يتم إنشاء مفاتيح جديدة أو مستخدم قاعدة بيانات محدود الصلاحيات. الملف الخاص نسخة من صلاحيات التطبيق الحالية. لتشغيل تكامل دائم، يُفضّل إبقاء المفاتيح على الخدمة، وإعطاء أداة المحتوى صلاحية محددة. ويمكن لخدمة موثوقة إصدار SAS قصير الصلاحية لملف بعينه؛ Azure يتيح تقييد الموارد والعمليات والمدة. لا تعتبر بادئة مجلد داخل container حدًا أمنيًا مضمونًا. [توثيق Azure SAS](https://learn.microsoft.com/en-us/azure/storage/common/storage-sas-overview).

لم ننسخ مفاتيح البريد أو Microsoft Graph أو بيانات الطلاب أو `OPENAI_API_KEY`. تجهيز الملفات داخل ChatGPT لا يستدعي مشاركة مفتاح OpenAI الخاص بالـ backend. توليد الصوت والفيديو نفسه يعتمد على الأدوات المتاحة للمدير؛ السكريبت أو النص وحده ليس ملف فيديو أو صوت جاهزًا.

## الجداول الصحيحة

كل الأسماء التالية في schema اسمها `curriculum`، وتم التحقق من وجودها في قاعدة البيانات المتصلة بتاريخ المراجعة.

| الجدول | دوره في الحزمة |
| --- | --- |
| `programmes` | البرنامج الأب؛ يُختار موجودًا بالـ `programme_id` |
| `modules` | الموديول الأب: `module_catalogue_id`، ومعه البرنامج والمجموعة حسب التخصيص الحالي |
| `weeks` | الأسبوع الفعلي: `id`, `module_catalogue_id`, `week_number`, `title`, `summary`, `learning_outcomes`, `display_order` |
| `components` | الماتريال: `id`, `week_id`, `module_catalogue_id`, `type`, `title`, `description`, `expected_otjh`, `display_order`, `settings_json` |
| `week_templates` | أسبوع قابل لإعادة الاستخدام في Week Builder؛ لا يعني وحده أنه مضاف لخطة متعلم |
| `week_template_components` | مكوّنات القالب: ترتبط عبر `week_template_id` وتحتفظ بالمحتوى في `settings_json` |
| `ksb_mappings` | ربط KSB صحيح بالموديول/الأسبوع/المكوّن؛ يجب استخدام معرفات موجودة ومعتمدة |
| `quizzes` | تعريف الكويز وإعداداته: `id`, `programme_id`, `week_id`, `status`, `passing_grade`, وغيرها |
| `quiz_questions` | الأسئلة؛ `quiz_id`, `question_text`, `question_type`, `points`, `sort_order`, `explanation` |
| `quiz_answers` | الاختيارات والتصحيح؛ `question_id`, `answer_text`, `is_correct`, `sort_order` |
| `quiz_component_links` | ربط `quiz_id` بالمكوّن `component_id` |
| `quiz_course_links` | ربط `quiz_id` بـ `module_catalogue_id` و`week_id` |
| `free_courses`, `free_course_weeks`, `free_programme_components` | مسار الكورسات المجانية المنفصل؛ يستخدم فقط إذا اختير Free Course بالفعل |

لا تضع أسبوعًا جديدًا في `programme_audit.assets` لمجرد أنه يحتوي ملفات؛ ذلك مسار أرشيف/استيراد قديم مختلف. ولا تكتب في جداول إجابات المتعلمين أو تقدمهم عند تأليف أسبوع.

في `components` توجد أيضًا أعمدة مثل `reflection_required`, `tutor_validation_required`, `coach_validation_required`, `points`, `ksb_mappings` وعمود **`"Reflection_Question"`** بحالة الأحرف هذه. في `week_template_components` لم يوجد العمود الأخير عند الفحص؛ النص المقابل هناك داخل `settings_json.reflectionPrompt`. المرجع JSON هو المصدر الدقيق لباقي الأعمدة والقيود.

اختيار المسار:

1. إذا كان المدير يبني أسبوعًا لإعادة استخدامه لاحقًا: استهدف Week Template أولًا، ثم اربطه بالموديول في مسار الإضافة المعتاد.
2. إذا كان المطلوب ظهوره لمتعلمين في برنامج محدد: يجب اختيار `programme_id` و`module_catalogue_id` والأسبوع/المجموعة الصحيحة والتحقق من وصول هؤلاء المتعلمين إلى الموديول.
3. كتابة `contentStatus: "Draft"` وحدها **ليست ضمانًا لإخفاء** مكوّن موجود بالفعل داخل موديول متعلم. لا تستخدم الموديول الحي كمكان لتجميع نصف أسبوع.

## المحتوى والعرض

| نوع المكوّن | الحقول الأساسية داخل `settings_json` | الشكل المناسب |
| --- | --- | --- |
| `reading` | `readingSource`, `readingContent`, `resourceUrl` | قراءة HTML بسيطة داخل المنصة، أو PDF/مستند في عارض الملف |
| `powerpoint` | `presentationUrl`, `fileName`, `speakerNotes` | PPTX مع نسخة PDF احتياطية؛ العارض الحالي يدعم عرض الشرائح/المستندات |
| `podcast` | `podcastSource`, `podcastUrl`, `transcript`, `durationMinutes` | ملف صوت مع تفريغ نصي في مشغّل الصوت |
| `video` | `sourceType`, `videoUrl`, `shortDescription`, `durationMinutes` | رابط فيديو في مشغّل الفيديو؛ رفع ملف فيديو عبر uploader المنهج يحتاج تطويرًا |
| `quiz` | `buildMode: "linked"`, `linkedQuizId`, `passMarkPercentage`, `attemptsAllowed` | كويز LMS أصلي مع أسئلة واختيارات في جداول الكويز |
| `assignment` | `assignmentBrief`, `submissionInstructions`, `markingRubric`, `assignmentFileUrl`, `assignmentFileName` | التكليف ومرفقاته ومسار التسليم الحالي |
| `reflection` | `reflectionPrompt`, `minimumWordCount`, `learnerGuidance` | سؤال تأمل وإجابة المتعلم داخل المنصة |
| `live-session` في authoring / `live_session` في DB | `sessionPurpose`, `sessionDate`, `sessionTime`, `liveSessionUrl` | تحضير الجلسة؛ رابط Teams وموعدها يصدران من مسار الجدولة الحقيقي |

عند رفع ملف، خزّن كذلك `uploadedFileName`, `uploadedFileUrl`, `uploadedFileSize`, `uploadedFileContentType`, `uploadSource` مع الحقول الخاصة بنوع المكوّن. JSON الخاص بالـ API يسمي حقل المحتوى `settings`، أما عمود SQL فهو **`settings_json`**.

بالنسبة لـ iframe: استخدم رابط LMS الثابت للملفات، ودع العارض الحالي يختار طريقة العرض. لا تجمع الأسبوع كله في iframe واحد إذا أردت تتبع تقدم كل نشاط وتصحيح الكويزات. القراءة البسيطة تُعرض داخل المنصة؛ الكويز لا يصبح قابلاً للتصحيح بمجرد رفع PDF للأسئلة.

ملفات HTML التفاعلية التي تحتوي JavaScript تحتاج مسار استضافة وعزل منفصلًا إذا أُريد دعمها. لا ترفع HTML نشطًا تحت نفس نطاق جلسة LMS وتتجاوز سياسة الرفع. النص داخل `readingContent` ليس حاوية لتنفيذ JavaScript. لم يُنفذ دعم جديد لذلك في هذه المهمة.

## مكان الملفات وروابطها

الصيغة الموجودة في الكود:

```text
Azure container: curriculum-uploads
Azure blob:     <moduleCatalogueId>/<componentId>/<unique-file-name.ext>
DB URL:         /curriculum_api/curriculum/uploads/<moduleCatalogueId>/<componentId>/<unique-file-name.ext>
Local cache:    MEDIA_ROOT/curriculum_component_uploads/<moduleCatalogueId>/<componentId>/<unique-file-name.ext>
```

لا تضف `curriculum_component_uploads/` إلى اسم blob داخل container؛ هذه بادئة التخزين المحلي. رفع Week Template الحالي يستخدم `week-template/<componentId>/<filename>` بدل معرف الموديول. استخدم أسماء ملفات جديدة عند إصدار نسخة، واحتفظ بتطابق blob مع مسار LMS. لا تستبدل ملفًا بنفس الاسم لأن الكود يفضّل النسخة المحلية إن وجدت.

الرابط في قاعدة البيانات يظل ثابتًا دون SAS أو مفتاح. backend يقرأ الملف من Azure ويقدمه عبر LMS مع دعم byte ranges. مسار الملفات يتيح `SAMEORIGIN` للعرض داخل الموقع ويتطلب جلسة مسموحًا لها. يجب أن يكون proxy النشر ممررًا لمسار `/curriculum_api/` على نفس origin الذي يستخدمه المتعلم.

حد الرفع الحالي 300 MiB (`300 * 1024 * 1024`، معروض في الواجهة باسم 300 MB). الأنواع المقبولة حاليًا:

- PowerPoint: `.ppt`, `.pptx`, `.pps`, `.ppsx`, `.pdf`.
- Reading / Assignment: `.txt`, `.doc`, `.docx`, `.pdf`, `.rtf`, `.odt`.
- Podcast: `.mp3`, `.m4a`, `.mp4`, `.wav`, `.aac`, `.ogg`, `.oga`, `.webm`.

قبول امتداد في upload لا يضمن معاينته على كل متصفح؛ PDF وPPTX وMP3 أنسب للبدء مع تجربة العارض. نوع `video` ليس مدعومًا في upload endpoint الحالي حتى مع وجود `.mp4` في قائمة podcast. لا تصنّف الفيديو كـ podcast للتحايل على ذلك. احتفظ بملف الفيديو في الحزمة إلى أن تُعتمد طريقة رفعه وربطه، أو استخدم رابطًا صالحًا من مصدر فيديو مدعوم.

`backfill_uploads_from_azure` الموجود ينسخ blobs إلى القرص المحلي لتحسين القراءة؛ لا ينشئ أسابيع أو مكوّنات ولا يربط ملفات بطلاب. لا يلزم تشغيله لكي يستطيع backend قراءة ملف موجود في Azure. لم يتم تشغيله هنا.

## الـ APIs الموجودة وما يلزم قبل الأتمتة

هذه خريطة للكود وليست إذنًا لتنفيذ كتابات قاعدة البيانات. كلها مسارات نسبية إلى `LMS_BASE_URL`؛ عمليات الكتابة أدناه موثقة فقط، ولم تُستدعَ في هذه المهمة.

| المسار | السلوك |
| --- | --- |
| `GET /curriculum_api/curriculum/components/?module_catalogue_ids=<id>` | قراءة مكوّنات موديول محدد |
| `POST /curriculum_api/curriculum/components/` | إنشاء مكوّن؛ يحتاج على الأقل `title` و`module`، وتحديد معرفات الموديول والأسبوع بدقة |
| `PATCH /curriculum_api/curriculum/components/<id>/` | تحديث مكوّن عبر payload يحتوي `settings` |
| `POST /curriculum_api/curriculum/components/<id>/upload/` | multipart: `file`, `componentType`, `moduleCatalogueId`؛ يعيد metadata |
| `POST /curriculum_api/curriculum/week-components/<id>/upload/` | يخزّن الملف ويعيد metadata فقط؛ لا يحفظ إعدادات مكوّن القالب |
| `/curriculum_api/curriculum/week-templates/` | إدارة قوالب الأسبوع؛ الحفظ له عقد مستقل عن مثال الحزمة |
| `/curriculum_api/curriculum/modules/<id>/structure/` | قراءة/حفظ بنية الموديول؛ لا ترسل جزءًا من البنية وتفترض بقاء بقية الأسابيع |
| `/quiz_api/quizzes/` | إدارة تعريف الكويز |
| `/quiz_api/quizzes/<id>/questions/` | قراءة/حفظ الأسئلة والاختيارات؛ صيغة السؤال تشمل `text`, `questionType`, `answers` |
| `/quiz_api/quizzes/<id>/course-links/` | إدارة ربط الكويز بالموديول والأسبوع |

المصادقة الحالية تعتمد على جلسة مستخدم وصلاحيات staff عند بوابة API. `KBC_LMS_API_KEY` الموجود في البيئة يستخدم في اتصالات النظام القديم؛ لم نجد له مسار قبول كـ bearer token لرفع المنهج الحالي. لا تخترع `LMS_API_KEY` وتفترض أنه يعمل.

**ملاحظة مؤكدة من مراجعة الكود والـ schema:** `update_component_upload_settings` تقرأ وتكتب مفتاحًا اسمه `settings`، بينما جدول `components` يحتوي `settings_json` فقط. و`authoring_upsert` يستبعد الأعمدة غير الموجودة. لذلك `uploaded: true` وحتى `savedToComponent: true` لا يكفيان لإثبات حفظ الرابط؛ يجب قراءة `settings_json` بعد الربط. يجب إصلاح هذه النقطة ضمن تنفيذ الأتمتة، أو حفظ metadata عبر مسار الحفظ الصحيح بعد السماح بالكتابة. لم نعدّل دالة الرفع في مهمة إعداد هذا الملف.

حفظ مكوّنات Week Template الحالي يمسح قائمة المكوّنات ويعيد إدراجها؛ لا ترسل مكوّنًا واحدًا إلى قالب قديم وكأنه تحديث جزئي. احفظ المعرفات الثابتة، وافحص القائمة كاملة قبل إعداد أي تغيير.

الكتابة اليدوية في Neon لا تشغّل تلقائيًا versioning أو validation أو invalidation الموجودة في التطبيق. الكاش الحالي قد يحتفظ ببعض بيانات المنهج 1800 ثانية. لا تعتبر refresh للمتصفح وحده تحديثًا لكاش السيرفر. يجب تضمين إجراء إبطال كاش المنهج المخصص عند تنفيذ الاستيراد، مع مراعاة كل workers والكاش المشترك؛ لا تستخدم مسحًا شاملًا لكل Redis أو تتجاهل سجل المراجعة.

## خطوات التسليم والتنفيذ

1. المدير يحدد موضوع الأسبوع، اللغة، المستوى، أهداف التعلم، المدة، والبرنامج/الموديول المستهدف أو أنه Week Template فقط.
2. ChatGPT ينشئ الملفات الفعلية وmanifest وفق المثال. يميّز أي أصل لم يتمكن من توليده، خصوصًا الصوت والفيديو، ولا يضع رابطًا وهميًا على أنه ملف جاهز.
3. يُراجع المحتوى والأسئلة والإجابات وKSBs والمدة. يتم التحقق من كل ملف ونوعه وحجمه وSHA-256 محليًا.
4. تُرفع الملفات إلى Azure عبر أداة معتمدة وصلاحية محددة، بأسماء جديدة. تحفظ نتيجة كل رفع: container, blob, MIME, size, SHA-256, stable LMS URL. لا تُعلن الحزمة جاهزة قبل التحقق من وجود جميع الملفات المطلوبة.
5. تُراجع المعرفات الفعلية باستخدام `inspect-target.sql` والـ schema. يتم إعداد **SQL نهائي بالقيم الفعلية** يضيف أو يحدّث الأسبوع والمكوّنات وروابط الكويز داخل transaction، مع فحص تعارض المعرفات والنسخ. لا تنفّذه الأداة؛ صاحب المشروع ينفّذه في Neon SQL Editor.
6. لا تنشر أسبوعًا جزئيًا: اربط جميع الملفات والكويزات والأسئلة قبل تفعيل المسار المرئي للمتعلمين. لا تستبدل موديولًا أو قالبًا قديمًا بالكامل دون مراجعة ما سيُحذف.
7. بعد تطبيق SQL، حدّث كاش المنهج بإجراء تشغيل معتمد. اختبر القراءة من حساب المدير ومن حساب متعلم له الموديول، وراجع PDF/PPTX والصوت والفيديو والكويز والتكليف وreflection.
8. اختبر إعادة إرسال نفس الحزمة: يجب ألا تنشئ نسخة إضافية من الأسبوع أو الأسئلة. الحزمة المقترحة تستخدم `packageId` ومعرفات ثابتة، لكن **لا يوجد حاليًا ضمان idempotency تلقائي لهذا العقد**. عند تطابق ID مع محتوى مختلف، أوقف التنفيذ للمراجعة.

لا يوجد SQL إدخال نهائي مرفق الآن لأن موضوع الأسبوع والملفات والمعرفات المستهدفة لم تُحدد بعد. لم نختلق معرفات برنامج أو مجموعة أو مفاتيح KSB. لا يلزم تغيير schema لمجرد إرفاق محتوى بالأنواع الحالية؛ الفيديو المرفوع وHTML التفاعلي وتكامل MCP يحتاجون عملًا برمجيًا منفصلًا.

## اقتراح الربط مع ChatGPT Work

للتشغيل المتكرر، ابنِ MCP يقدّم أدوات محددة لقراءة الأهداف، وفحص الحزمة، وتجهيز الرفع، وإخراج SQL وتقرير تحقق. تظل مفاتيح Azure وNeon على السيرفر. أدوات الإدخال التلقائي لا تُفعّل إلا بعد تعديل سياسة المشروع صراحةً وتنفيذ المصادقة والتحقق والتسجيل ومنع التكرار.

هذا اقتراح معماري، وليس تكاملًا موجودًا. توثيق OpenAI يوضح أن plugins يمكن أن تتضمن MCP يعرّف الأدوات ويتحقق من الصلاحيات وينفّذ العمليات على الخدمة المرتبطة؛ تسليم ملف تعليمات وحده لا ينشئ هذا الاتصال. توفر الأدوات الفعلية يعتمد على حساب المدير وبيئة العمل. [OpenAI: Plugins](https://learn.chatgpt.com/docs/plugins)، [Build an MCP server](https://developers.openai.com/plugins/build/mcp-server).

## نص جاهز للمدير يضعه في ChatGPT

```text
Create a complete learning week for our LMS using the attached handoff,
schema-reference.json and week-package.example.json.

First ask for the subject, learner level, language, learning outcomes, total
learning time, and the exact target programme/module/week IDs, or whether this
is a reusable Week Template. Use only verified KSB IDs. Never invent IDs.

Deliver real files where tools support them: reading PDF plus clean inline HTML,
PPTX plus PDF fallback, audio plus transcript, video plus captions/transcript,
assignment brief plus rubric, reflection prompts, and native quiz questions
with answer keys and explanations. Clearly mark assets you cannot generate.

Return a week-package.json manifest with stable component IDs, ordering,
durations, content settings and an asset inventory. The manifest is a handoff
format, not an existing LMS API request. Keep quiz answer keys out of reading
and other learner-visible content. Do not claim the package is uploaded or live
until that is verified.

Use established service connections for uploads. Never ask me to paste Azure
account keys or database passwords into this conversation. If connections are
missing, finish the files and manifest and report exactly which connection is
missing. Do not route uploads to an unapproved external service.

Follow AGENTS.md: no commits, remote Git writes, migrations, or database writes,
including through application APIs. Prepare exact SQL for the project owner to
review and run in Neon SQL Editor after target IDs and files are final. Include
read-only verification queries and the required curriculum cache refresh step.
Never edit learner records, assessment attempts, enrolments, or legacy archives.
```

## مصادر الكود التي تمت مراجعتها

- `backend/config/settings.py`: اختيار اتصال DB وإعدادات container.
- `backend/curriculum_api/upload_storage.py`: Azure ومسارات الملفات والقراءة المحلية أولًا.
- `backend/curriculum_api/views.py`: الأنواع والإعدادات ودوال الرفع والحفظ والكاش.
- `backend/curriculum_api/models.py` و`backend/quiz_api/models.py`: نماذج المنهج والكويز.
- `backend/quiz_api/views.py`: حفظ الأسئلة وروابط الكويز.
- `backend/login/api_gate.py`: المصادقة وصلاحيات API.
- `backend/learner_api/learner_detail.py`: تحويل إعدادات المكوّن إلى محتوى المتعلم.
- `frontend/src/lib/docEmbed.ts` وواجهات my-learning: المعاينات وعرض الميديا.
- `backend/curriculum_api/management/commands/backfill_uploads_from_azure.py`: غرض backfill الملفات.

تمت مراجعة الكود وفحص schema بالقراءة فقط. لم يُرفع محتوى أو تتغير قاعدة البيانات أو يُختبر استيراد أسبوع فعلي في هذه المهمة.
