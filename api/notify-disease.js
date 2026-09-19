// Vercel Serverless Function
// Route: POST /api/notify-disease
//
// اس فائل کے دو استعمال ہیں:
// 1) جب کوئی مریض ایسی بیماری/علامت لکھے جو سائٹ کی موجودہ فہرست
//    (اعضاء کے مطابق) میں شامل نہیں ہے، تو وہ نام خودکار طور پر مزاج
//    کی تشخیص میں شامل نہیں کیا جاتا — بلکہ صرف نوٹ کر کے آپ (سائٹ
//    کے مالک) کو ای میل کے ذریعے مطلع کیا جاتا ہے (diseaseName)۔
// 2) تشخیص کے نتیجے کے سب سے آخر میں دیے گئے چھوٹے ڈبے کے ذریعے،
//    مریض خود آزادانہ طور پر کوئی بھی تجویز/سوال لکھ کر بھیج سکتا ہے —
//    مثلاً فلاں علامت شامل کریں، فلاں بیماری موجود نہیں، یا اگر ویب
//    سائٹ کا سوال/جواب اس کی علامات/بیماری کے مطابق نہ ملے (message) —
//    اس کے ساتھ ایک سکرین شاٹ/تصویر بھی منسلک کی جا سکتی ہے
//    (imageBase64, imageMime, imageFilename) — یہ سب اسی ای میل کے
//    ساتھ اٹیچمنٹ کے طور پر بھیج دیا جاتا ہے۔
//
// اہم: یہ فیچر کام کرنے کے لیے Resend (resend.com) کا مفت اکاؤنٹ اور
// API key درکار ہے۔ Vercel Environment Variables میں یہ تین ویلیوز شامل کریں:
// 1) RESEND_API_KEY   — Resend ڈیش بورڈ سے حاصل کریں
// 2) NOTIFY_EMAIL      — وہ ای میل ایڈریس جس پر اطلاع آنی چاہیے (آپ کا ای میل)
// 3) FROM_EMAIL         — بھیجنے والا ایڈریس (Resend کی verified domain سے، یا
//                         عارضی طور پر 'onboarding@resend.dev' استعمال کر سکتے ہیں)

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '8mb' // سکرین شاٹ تصویر کی گنجائش کے لیے
    }
  }
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'صرف POST request قبول ہے۔' });
  }

  try {
    const { diseaseName, message, imageBase64, imageMime, imageFilename } = req.body || {};

    const hasDiseaseName = typeof diseaseName === 'string' && diseaseName.trim();
    const hasMessage = typeof message === 'string' && message.trim();
    const hasImage = typeof imageBase64 === 'string' && imageBase64.trim();

    if (!hasDiseaseName && !hasMessage && !hasImage) {
      return res.status(400).json({ error: 'کوئی بیماری کا نام، پیغام یا تصویر فراہم نہیں کی گئی۔' });
    }

    let subject, text;
    if (hasMessage || hasImage || !hasDiseaseName) {
      subject = 'ویب سائٹ سے مریض کی تجویز/سوال موصول ہوا';
      text = hasMessage
        ? `ایک مریض نے تشخیص کے نتیجے کے بعد یہ تجویز/سوال لکھ کر بھیجا:\n\n"${message.trim()}"\n\nبراہ کرم دیکھیں کہ اس کے مطابق سائٹ میں کوئی علامت/بیماری شامل کرنی ہے یا کوئی جواب دینا ہے۔${hasImage ? '\n\n(ساتھ ایک سکرین شاٹ/تصویر بھی منسلک ہے۔)' : ''}`
        : `ایک مریض نے تشخیص کے نتیجے کے بعد صرف ایک سکرین شاٹ/تصویر بھیجی ہے، کوئی متن نہیں لکھا۔ براہ کرم منسلک تصویر دیکھیں۔`;
    } else {
      subject = `نئی بیماری فہرست میں شامل نہیں ملی: ${diseaseName.trim()}`;
      text = `ایک مریض نے یہ بیماری/علامت لکھی جو فہرست میں موجود نہیں تھی:\n\n"${diseaseName.trim()}"\n\nبراہ کرم دیکھیں کہ اسے سائٹ کی بیماریوں کی فہرست میں شامل کرنا ہے یا نہیں۔`;
    }

    const resendKey = process.env.RESEND_API_KEY;
    const notifyEmail = process.env.NOTIFY_EMAIL;
    const fromEmail = process.env.FROM_EMAIL || 'onboarding@resend.dev';

    if (!resendKey || !notifyEmail) {
      // ای میل سیٹ اپ ابھی مکمل نہیں — سائٹ کو نہیں روکنا، صرف لاگ کر دیں
      console.log('نوٹ ہوا (ای میل سیٹ اپ نہیں ہے):', hasMessage ? message : diseaseName, hasImage ? '(+ تصویر)' : '');
      return res.status(200).json({ ok: true, emailed: false, note: 'RESEND_API_KEY یا NOTIFY_EMAIL سیٹ نہیں ہے — صرف سرور لاگ میں محفوظ ہوا۔' });
    }

    const emailPayload = {
      from: fromEmail,
      to: [notifyEmail],
      subject,
      text
    };

    if (hasImage) {
      // Resend base64 اٹیچمنٹ قبول کرتا ہے — بغیر ڈیٹا یو آر ائی پریفکس کے خالص base64 ہونا چاہیے
      const cleanBase64 = imageBase64.indexOf(',') !== -1 ? imageBase64.split(',').pop() : imageBase64;
      const ext = (imageMime && imageMime.split('/')[1]) ? imageMime.split('/')[1] : 'jpg';
      emailPayload.attachments = [{
        filename: imageFilename || `screenshot.${ext}`,
        content: cleanBase64
      }];
    }

    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${resendKey}`
      },
      body: JSON.stringify(emailPayload)
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
