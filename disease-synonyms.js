// Vercel Serverless Function
// Route: POST /api/disease-synonyms
//
// اس فائل کا مقصد: ایک بیماری کے کئی نام ہوتے ہیں (اردو، ہندی، عربی/یونانی، فارسی، انگریزی)۔
// صارف جو نام لکھے، OpenAI کی مدد سے اسی بیماری کے دوسرے مشہور نام معلوم کیے جاتے ہیں تاکہ
// "نسخہ سازی" اور "بیماری کی تلاش" میں سب ناموں سے تلاش ہو سکے۔
//
// اہم: OPENAI_API_KEY صرف Vercel کے Environment Variables میں — کبھی براؤزر کوڈ میں نہیں۔

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'صرف POST request قبول ہے۔' });
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'سرور پر OPENAI_API_KEY سیٹ نہیں ہے۔' });

  try {
    const name = String((req.body && req.body.name) || '').trim().slice(0, 120);
    if (!name) return res.status(400).json({ error: 'بیماری کا نام فراہم نہیں کیا گیا۔' });

    const systemPrompt = `آپ یونانی طب (طب یونانی، قانونِ مفرد اعضاء) اور جدید طب دونوں کے ماہر ہیں اور اردو میں جواب دیتے ہیں۔
صارف ایک بیماری/علامت (یا کسی عضو) کا نام دے گا۔ یہ طبی ویب سائٹ ہے، اس لیے جسم کے پوشیدہ اعضاء کے عام/علاقائی نام بھی بلا جھجک دیں۔ آپ کو اسی بیماری کے دوسرے مشہور نام بتانے ہیں جو پاکستانی/ہندوستانی طبی کتابوں اور عام بول چال میں استعمال ہوتے ہیں:
- اگر نام میں کوئی عضو ہو (مثلاً لن، نفس، ذکر، عضو تناسل، شرمگاہ، فوطے، بچہ دانی، کلیجہ) تو اسی جملے کو عضو کے دوسرے ناموں (علمی، عام، علاقائی، عربی، فارسی، انگریزی) کے ساتھ بھی لکھیں — مثلاً "لن کی کمزوری" کے لیے "عضو تناسل کی کمزوری"، "ذکر کی کمزوری"، "ضعف قضیب"، "کمزوری باہ"۔
- اردو/عام بول چال کے نام
- یونانی/عربی نام (مثلاً سیلان الرحم، ضیق النفس، قلاع)
- فارسی/ہندی نام
- انگریزی نام اردو رسم الخط میں (مثلاً ڈائیبیٹیز) اور انگریزی حروف میں بھی (مثلاً Diabetes)
اصول:
1) صرف وہی نام دیں جو واقعی اسی بیماری کے لیے بولے جاتے ہیں — قریبی مگر الگ بیماری کا نام synonyms میں نہ ڈالیں، اسے "related" میں رکھیں۔
2) زیادہ سے زیادہ 20 synonyms اور 6 related۔ ہر نام مختصر (1 سے 4 الفاظ)۔
3) اگر نام غیر واضح ہو (مثلاً صرف کسی عضو کا نام) تو synonyms خالی رکھیں اور "related" میں اس عضو کی عام بیماریاں دیں۔
صرف JSON واپس کریں: {"canonical":"سب سے مشہور اردو نام","synonyms":["..."],"related":["..."]}`;

    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: `بیماری کا نام: "${name}"` }],
        temperature: 0.1,
        response_format: { type: 'json_object' }
      })
    });
    if (!r.ok) return res.status(502).json({ error: 'OpenAI API سے جواب نہیں ملا۔', details: await r.text().catch(() => '') });
    const data = await r.json();
    const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    let out = {};
    try { out = JSON.parse(content || '{}'); } catch (e) { out = {}; }
    const clean = arr => (Array.isArray(arr) ? arr : []).map(x => String(x || '').trim()).filter(x => x && x.length <= 40).slice(0, 20);
    return res.status(200).json({
      canonical: String(out.canonical || name).trim().slice(0, 40),
      synonyms: clean(out.synonyms).filter(x => x !== name),
      related: clean(out.related).slice(0, 6)
    });
  } catch (err) {
    return res.status(500).json({ error: String(err && err.message ? err.message : err) });
  }
}
