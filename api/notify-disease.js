// Vercel Serverless Function
// Route: POST /api/notify-disease
//
// اس فائل کا مقصد: جب کوئی مریض ایسی بیماری/علامت لکھے جو سائٹ کی
// موجودہ فہرست (اعضاء کے مطابق) میں شامل نہیں ہے، تو وہ نام خودکار
// طور پر مزاج کی تشخیص میں شامل نہیں کیا جاتا — بلکہ صرف نوٹ کر کے
// آپ (سائٹ کے مالک) کو ای میل کے ذریعے مطلع کیا جاتا ہے، تاکہ آپ خود
// فیصلہ کریں کہ اسے فہرست میں شامل کرنا ہے یا نہیں۔
//
// اہم: یہ فیچر کام کرنے کے لیے Resend (resend.com) کا مفت اکاؤنٹ اور
// API key درکار ہے۔ Vercel Environment Variables میں یہ دو ویلیوز شامل کریں:
// 1) RESEND_API_KEY   — Resend ڈیش بورڈ سے حاصل کریں
// 2) NOTIFY_EMAIL      — وہ ای میل ایڈریس جس پر اطلاع آنی چاہیے (آپ کا ای میل)
// 3) FROM_EMAIL         — بھیجنے والا ایڈریس (Resend کی verified domain سے، یا
//                         عارضی طور پر 'onboarding@resend.dev' استعمال کر سکتے ہیں)

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'صرف POST request قبول ہے۔' });
  }

  try {
    const { diseaseName } = req.body || {};
    if (!diseaseName || typeof diseaseName !== 'string' || !diseaseName.trim()) {
      return res.status(400).json({ error: 'بیماری کا نام (diseaseName) فراہم نہیں کیا گیا۔' });
    }

    const resendKey = process.env.RESEND_API_KEY;
    const notifyEmail = process.env.NOTIFY_EMAIL;
    const fromEmail = process.env.FROM_EMAIL || 'onboarding@resend.dev';

    if (!resendKey || !notifyEmail) {
      // ای میل سیٹ اپ ابھی مکمل نہیں — سائٹ کو نہیں روکنا، صرف لاگ کر دیں
      console.log('نئی بیماری نوٹ ہوئی (ای میل سیٹ اپ نہیں ہے):', diseaseName);
      return res.status(200).json({ ok: true, emailed: false, note: 'RESEND_API_KEY یا NOTIFY_EMAIL سیٹ نہیں ہے — صرف سرور لاگ میں محفوظ ہوا۔' });
    }

    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${resendKey}`
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [notifyEmail],
        subject: `نئی بیماری فہرست میں شامل نہیں ملی: ${diseaseName}`,
        text: `ایک مریض نے یہ بیماری/علامت لکھی جو فہرست میں موجود نہیں تھی:\n\n"${diseaseName}"\n\nبراہ کرم دیکھیں کہ اسے سائٹ کی بیماریوں کی فہرست میں شامل کرنا ہے یا نہیں۔`
      })
    });

    if (!emailRes.ok) {
      const errBody = await emailRes.text().catch(() => '');
      console.error('Resend email error:', errBody);
      return res.status(200).json({ ok: true, emailed: false, note: 'ای میل بھیجنے میں خرابی، لیکن نوٹ ہو گیا۔' });
    }

    return res.status(200).json({ ok: true, emailed: true });

  } catch (err) {
    console.error('notify-disease error:', err);
    return res.status(200).json({ ok: true, emailed: false, note: String(err && err.message ? err.message : err) });
  }
}
