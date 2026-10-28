/**
 * Privacy Policy and Terms of Use templates.
 * ⚠️ Review these with a lawyer before publishing, and set EXPO_PUBLIC_COMPANY_NAME / EXPO_PUBLIC_SUPPORT_EMAIL.
 */
import type { UiLang } from "@/i18n";

export const LEGAL_UPDATED = "2026-10-28";
const COMPANY = process.env.EXPO_PUBLIC_COMPANY_NAME || "Live Translate";
const EMAIL = process.env.EXPO_PUBLIC_SUPPORT_EMAIL || "support@your-domain.com";

export interface LegalSection {
  heading: string;
  body: string;
}

const fill = (sections: LegalSection[]) =>
  sections.map((s) => ({
    heading: s.heading,
    body: s.body.replaceAll("{company}", COMPANY).replaceAll("{email}", EMAIL),
  }));

const PRIVACY: Record<UiLang, LegalSection[]> = {
  en: [
    {
      heading: "Who we are",
      body: "{company} (\"we\", \"us\") provides the Live Translate app and website, which turns a speaker's live speech into text and translates it for listeners in real time. Contact: {email}.",
    },
    {
      heading: "Information we collect",
      body: "• Speaker accounts: name, username, email address, and a securely hashed password (or your Google account ID if you sign in with Google).\n• Session content: the text recognized from your speech, its translations, session titles, and basic statistics (start/end time, number of listeners, characters translated).\n• Listeners: listeners don't need an account. We process the speaker ID they enter and their connection to deliver captions.\n• Technical data: IP address and device/browser information in server logs, used for security and troubleshooting.",
    },
    {
      heading: "Audio and speech recognition",
      body: "We don't record or store audio. Speech is converted to text by your device's speech service (Apple, Google or your browser), which may process audio on their servers under their own privacy policies. Only the resulting text is sent to our servers.",
    },
    {
      heading: "How we use information",
      body: "To provide live captions and translations, let listeners find speakers, save transcripts in the speaker's history, send verification and password-reset codes, generate optional AI summaries when a speaker requests one, keep the service secure, and comply with the law. We don't sell personal information or use it for advertising.",
    },
    {
      heading: "Service providers",
      body: "We share text only as needed with providers that operate the service on our behalf: the translation provider (for example DeepL, Google Cloud or Anthropic), our email provider (to send codes), our hosting provider, and error monitoring. Google receives sign-in requests if you choose \"Continue with Google\".",
    },
    {
      heading: "Who can see your sessions",
      body: "Live captions are visible to anyone who knows a speaker's ID, unless the speaker starts a private session protected by a PIN. Saved transcripts and summaries are visible only to the speaker's account.",
    },
    {
      heading: "Retention and deletion",
      body: "Transcripts are kept until the speaker deletes them. Speakers can delete individual sessions, or their whole account from Account > Delete account, which permanently removes the account, sessions and transcripts. Backups are overwritten within 14 days.",
    },
    {
      heading: "Security",
      body: "Connections are encrypted (HTTPS), passwords are hashed, and verification codes expire after 10 minutes. No method of transmission or storage is 100% secure.",
    },
    {
      heading: "Your rights",
      body: "Depending on where you live, you may have the right to access, correct, export or delete your personal information, or to object to certain processing. Contact {email} and we'll respond within the time required by law.",
    },
    {
      heading: "Children",
      body: "The service isn't directed to children under 13 (or the minimum age in your country), and children may not create speaker accounts.",
    },
    {
      heading: "Changes",
      body: "We'll post updates to this policy here and change the \"last updated\" date. Significant changes will be announced in the app.",
    },
  ],
  ar: [
    {
      heading: "من نحن",
      body: "تقدّم {company} (\"نحن\") تطبيق وموقع الترجمة الفورية، الذي يحوّل كلام المتحدث المباشر إلى نص ويترجمه للمستمعين لحظياً. للتواصل: {email}.",
    },
    {
      heading: "المعلومات التي نجمعها",
      body: "• حسابات المتحدثين: الاسم واسم المستخدم والبريد الإلكتروني وكلمة مرور مشفّرة بشكل آمن (أو معرّف حساب Google عند تسجيل الدخول عبره).\n• محتوى الجلسات: النص المستخرج من كلامك وترجماته وعناوين الجلسات وإحصاءات أساسية (وقت البدء والانتهاء وعدد المستمعين وعدد الأحرف المترجمة).\n• المستمعون: لا يحتاج المستمعون إلى حساب. نعالج معرّف المتحدث الذي يدخلونه واتصالهم لإيصال الترجمة.\n• بيانات تقنية: عنوان IP ومعلومات الجهاز أو المتصفح في سجلات الخادم، لأغراض الأمان وحل المشكلات.",
    },
    {
      heading: "الصوت والتعرّف على الكلام",
      body: "لا نسجّل الصوت ولا نخزّنه. يحوّل جهازك الكلام إلى نص عبر خدمة التعرّف على الكلام فيه (Apple أو Google أو المتصفح)، وقد تعالج هذه الخدمات الصوت على خوادمها وفق سياسات الخصوصية الخاصة بها. لا يُرسل إلى خوادمنا سوى النص الناتج.",
    },
    {
      heading: "كيف نستخدم المعلومات",
      body: "لتقديم الترجمة المباشرة، وتمكين المستمعين من العثور على المتحدثين، وحفظ النصوص في سجل المتحدث، وإرسال رموز التحقق وإعادة تعيين كلمة المرور، وإنشاء ملخصات بالذكاء الاصطناعي عندما يطلبها المتحدث، والحفاظ على أمان الخدمة، والالتزام بالقانون. لا نبيع المعلومات الشخصية ولا نستخدمها للإعلانات.",
    },
    {
      heading: "مزوّدو الخدمة",
      body: "نشارك النص عند الحاجة فقط مع مزوّدين يشغّلون الخدمة نيابةً عنا: مزوّد الترجمة (مثل DeepL أو Google Cloud أو Anthropic)، ومزوّد البريد الإلكتروني (لإرسال الرموز)، ومزوّد الاستضافة، وخدمة مراقبة الأخطاء. تتلقى Google طلبات تسجيل الدخول إذا اخترت \"المتابعة باستخدام Google\".",
    },
    {
      heading: "من يمكنه رؤية جلساتك",
      body: "الترجمة المباشرة مرئية لأي شخص يعرف معرّف المتحدث، إلا إذا بدأ المتحدث جلسة خاصة محمية برمز PIN. النصوص والملخصات المحفوظة مرئية لحساب المتحدث فقط.",
    },
    {
      heading: "مدة الاحتفاظ والحذف",
      body: "نحتفظ بالنصوص حتى يحذفها المتحدث. يمكن للمتحدث حذف جلسات فردية أو حذف حسابه بالكامل من الحساب > حذف الحساب، مما يزيل الحساب والجلسات والنصوص نهائياً. تُستبدل النسخ الاحتياطية خلال 14 يوماً.",
    },
    {
      heading: "الأمان",
      body: "الاتصالات مشفّرة (HTTPS)، وكلمات المرور مشفّرة، وتنتهي صلاحية رموز التحقق بعد 10 دقائق. لا توجد وسيلة نقل أو تخزين آمنة بنسبة 100%.",
    },
    {
      heading: "حقوقك",
      body: "حسب مكان إقامتك، قد يحق لك الوصول إلى معلوماتك الشخصية أو تصحيحها أو تصديرها أو حذفها، أو الاعتراض على بعض أوجه معالجتها. راسلنا على {email} وسنرد خلال المدة التي يحددها القانون.",
    },
    {
      heading: "الأطفال",
      body: "الخدمة غير موجّهة للأطفال دون 13 عاماً (أو الحد الأدنى للعمر في بلدك)، ولا يجوز للأطفال إنشاء حسابات متحدثين.",
    },
    {
      heading: "التغييرات",
      body: "سننشر أي تحديث لهذه السياسة هنا ونغيّر تاريخ \"آخر تحديث\". وسنعلن عن التغييرات الجوهرية داخل التطبيق.",
    },
  ],
};

const TERMS: Record<UiLang, LegalSection[]> = {
  en: [
    {
      heading: "Agreement",
      body: "By using Live Translate you agree to these Terms. If you use it on behalf of an organization, you confirm you're authorized to accept them for it. Contact: {email}.",
    },
    {
      heading: "The service",
      body: "Live Translate converts speech to text and machine-translates it in real time. Recognition and translation are automatic and can be inaccurate, incomplete or delayed. Don't rely on them where errors could cause harm (for example medical, legal or safety-critical situations) without a qualified human interpreter.",
    },
    {
      heading: "Accounts",
      body: "Speakers must provide accurate information, keep their password secure, and are responsible for activity on their account. Usernames that impersonate others or are offensive may be reclaimed.",
    },
    {
      heading: "Your content",
      body: "You own what you say and the transcripts of it. You give {company} permission to process, translate, transmit and store that content only to operate the service for you. You're responsible for having the right to broadcast what you say and for telling your audience that the session is transcribed and translated where the law requires it.",
    },
    {
      heading: "Acceptable use",
      body: "Don't use the service to break the law, harass people, share content you don't have rights to, distribute malware, overload or reverse-engineer the service, or access sessions you aren't invited to (including guessing PINs).",
    },
    {
      heading: "Third-party services",
      body: "The service relies on third parties (device speech recognition, translation and AI providers, Google sign-in). Their availability and terms are outside our control.",
    },
    {
      heading: "Availability and changes",
      body: "We work to keep the service available but don't guarantee it will be uninterrupted. We may change or discontinue features, and will give reasonable notice of significant changes.",
    },
    {
      heading: "Termination",
      body: "You can stop using the service and delete your account at any time. We may suspend accounts that violate these Terms.",
    },
    {
      heading: "Disclaimers and liability",
      body: "The service is provided \"as is\". To the extent permitted by law, {company} isn't liable for indirect or consequential damages, or for losses caused by translation errors, and our total liability is limited to the amount you paid us in the 12 months before the claim (if any).",
    },
    {
      heading: "Changes to these Terms",
      body: "We may update these Terms; the \"last updated\" date shows the current version. Continuing to use the service after changes means you accept them.",
    },
  ],
  ar: [
    {
      heading: "الاتفاقية",
      body: "باستخدامك لتطبيق الترجمة الفورية فإنك توافق على هذه الشروط. إذا كنت تستخدمه نيابةً عن جهة ما، فأنت تؤكد أنك مخوّل بقبولها نيابةً عنها. للتواصل: {email}.",
    },
    {
      heading: "الخدمة",
      body: "يحوّل التطبيق الكلام إلى نص ويترجمه آلياً بشكل فوري. التعرّف على الكلام والترجمة يتمان تلقائياً وقد يكونان غير دقيقين أو ناقصين أو متأخرين. لا تعتمد عليهما في المواقف التي قد تسبب فيها الأخطاء ضرراً (مثل المواقف الطبية أو القانونية أو المتعلقة بالسلامة) دون مترجم بشري مؤهل.",
    },
    {
      heading: "الحسابات",
      body: "يجب على المتحدثين تقديم معلومات صحيحة والحفاظ على أمان كلمة المرور، وهم مسؤولون عن النشاط الذي يتم عبر حساباتهم. قد نستعيد أسماء المستخدمين التي تنتحل شخصية الآخرين أو تكون مسيئة.",
    },
    {
      heading: "المحتوى الخاص بك",
      body: "أنت تملك ما تقوله ونصوصه. وتمنح {company} الإذن بمعالجة هذا المحتوى وترجمته ونقله وتخزينه فقط لتشغيل الخدمة لك. أنت مسؤول عن امتلاك حق بث ما تقوله، وعن إبلاغ جمهورك بأن الجلسة تُحوّل إلى نص وتُترجم حيثما يتطلب القانون ذلك.",
    },
    {
      heading: "الاستخدام المقبول",
      body: "لا تستخدم الخدمة لمخالفة القانون أو مضايقة الآخرين أو مشاركة محتوى لا تملك حقوقه أو نشر البرمجيات الضارة أو إثقال الخدمة أو محاولة فك شفرتها أو الوصول إلى جلسات لم تُدعَ إليها (بما في ذلك تخمين رموز PIN).",
    },
    {
      heading: "خدمات الأطراف الثالثة",
      body: "تعتمد الخدمة على أطراف ثالثة (خدمة التعرّف على الكلام في الجهاز، ومزوّدي الترجمة والذكاء الاصطناعي، وتسجيل الدخول عبر Google). توفّر هذه الخدمات وشروطها خارج سيطرتنا.",
    },
    {
      heading: "التوفّر والتغييرات",
      body: "نعمل على إبقاء الخدمة متاحة لكننا لا نضمن عدم انقطاعها. قد نغيّر بعض الميزات أو نوقفها، وسنعلن عن التغييرات الجوهرية قبل وقت معقول.",
    },
    {
      heading: "إنهاء الاستخدام",
      body: "يمكنك التوقف عن استخدام الخدمة وحذف حسابك في أي وقت. وقد نعلّق الحسابات التي تخالف هذه الشروط.",
    },
    {
      heading: "إخلاء المسؤولية",
      body: "تُقدَّم الخدمة \"كما هي\". وفي الحدود التي يسمح بها القانون، لا تتحمل {company} المسؤولية عن الأضرار غير المباشرة أو التبعية أو الخسائر الناتجة عن أخطاء الترجمة، وتقتصر مسؤوليتنا الإجمالية على المبلغ الذي دفعته لنا خلال الأشهر الاثني عشر السابقة للمطالبة (إن وُجد).",
    },
    {
      heading: "تغييرات هذه الشروط",
      body: "قد نحدّث هذه الشروط، ويوضح تاريخ \"آخر تحديث\" النسخة الحالية. استمرارك في استخدام الخدمة بعد التغييرات يعني موافقتك عليها.",
    },
  ],
};

export const getPrivacy = (lang: UiLang) => fill(PRIVACY[lang]);
export const getTerms = (lang: UiLang) => fill(TERMS[lang]);
