import type { NextFunction, Request, Response } from "express";

/** Arabic versions of user-facing API error messages (keyed by the English text). */
const AR: Record<string, string> = {
  "Username must be 3-20 characters: letters, numbers or underscore": "يجب أن يتكون اسم المستخدم من 3 إلى 20 حرفاً: أحرف إنجليزية أو أرقام أو شرطة سفلية",
  "This username is reserved": "اسم المستخدم هذا محجوز",
  "Display name is required": "الاسم الظاهر مطلوب",
  "Password must be at least 8 characters": "يجب أن تتكون كلمة المرور من 8 أحرف على الأقل",
  "Enter a valid email": "أدخل بريداً إلكترونياً صحيحاً",
  "Enter the 6-digit code": "أدخل الرمز المكوّن من 6 أرقام",
  "Invalid request": "طلب غير صالح",
  "That username is taken": "اسم المستخدم هذا مستخدم بالفعل",
  "An account with this email already exists": "يوجد حساب مسجّل بهذا البريد الإلكتروني",
  "Enter your username or email": "أدخل اسم المستخدم أو البريد الإلكتروني",
  "Enter your password": "أدخل كلمة المرور",
  "This account uses Google sign-in. Continue with Google, or reset your password to add one.":
    "هذا الحساب يستخدم تسجيل الدخول عبر Google. تابع باستخدام Google، أو أعد تعيين كلمة المرور لإضافة واحدة.",
  "Incorrect username/email or password": "اسم المستخدم/البريد الإلكتروني أو كلمة المرور غير صحيحة",
  "Missing Google credential": "بيانات Google مفقودة",
  "Google sign-in failed. Please try again.": "تعذّر تسجيل الدخول عبر Google. حاول مرة أخرى.",
  "An account with this email already exists. Sign in with your password.": "يوجد حساب بهذا البريد الإلكتروني. سجّل الدخول بكلمة المرور.",
  "Your Google sign-in expired. Please continue with Google again.": "انتهت صلاحية تسجيل الدخول عبر Google. تابع باستخدام Google مرة أخرى.",
  "An account already exists for this Google account. Sign in instead.": "يوجد حساب مرتبط بحساب Google هذا. سجّل الدخول بدلاً من ذلك.",
  "Incorrect password": "كلمة المرور غير صحيحة",
  "Type your username to confirm": "اكتب اسم المستخدم للتأكيد",
  "Authentication required": "يجب تسجيل الدخول",
  "That code isn't correct": "الرمز غير صحيح",
  "This code has expired. Request a new one": "انتهت صلاحية الرمز. اطلب رمزاً جديداً",
  "Too many wrong attempts. Request a new code": "محاولات خاطئة كثيرة. اطلب رمزاً جديداً",
  "No speaker found with that ID": "لا يوجد متحدث بهذا المعرّف",
  "Session not found": "الجلسة غير موجودة",
  "AI summaries aren't enabled on this server": "ملخصات الذكاء الاصطناعي غير مفعّلة على هذا الخادم",
  "There's nothing to summarize in this session": "لا يوجد ما يمكن تلخيصه في هذه الجلسة",
  "Couldn't generate the summary": "تعذّر إنشاء الملخص",
  "The model declined to summarize this transcript": "رفض النموذج تلخيص هذا النص",
  "The summary could not be generated. Please try again": "تعذّر إنشاء الملخص. حاول مرة أخرى",
  "Stop the live session before deleting it": "أوقف البث المباشر قبل حذف الجلسة",
  "Too many attempts. Please try again later.": "محاولات كثيرة. حاول مرة أخرى لاحقاً.",
  "Not found": "غير موجود",
  "Internal server error": "خطأ في الخادم",
};

const PATTERNS: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/^Please wait (\d+)s before requesting another code$/, (m) => `يرجى الانتظار ${m[1]} ثانية قبل طلب رمز آخر`],
];

export function localizeError(message: string, lang: string): string {
  if (lang !== "ar") return message;
  if (AR[message]) return AR[message];
  for (const [re, fmt] of PATTERNS) {
    const m = message.match(re);
    if (m) return fmt(m);
  }
  return message;
}

/** Translates the `error` field of JSON responses based on the Accept-Language header. */
export function localizeErrors(req: Request, res: Response, next: NextFunction) {
  const lang = req.acceptsLanguages("en", "ar") || "en";
  if (lang !== "en") {
    const json = res.json.bind(res);
    res.json = (body: any) => json(body && typeof body.error === "string" ? { ...body, error: localizeError(body.error, lang) } : body);
  }
  next();
}
