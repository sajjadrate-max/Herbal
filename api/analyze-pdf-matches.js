// Vercel Serverless Function
// Route: POST /api/analyze-pdf-matches
//
// اس فائل کا مقصد: "بیماری کی تلاش" صفحہ پر جب مریض/صارف کوئی لفظ تلاش کرتا ہے
// تو سب سے پہلے صارف کی اپنی PDF کتابوں میں (براؤزر کے اندر ہی) اصل لفظ تلاش کیا
// جاتا ہے — یہ تلاش خالصتاً مقامی (client-side) ہوتی ہے، AI اس میں شامل نہیں۔
// جو اقتباسات (excerpts) اس تلاش سے ملیں، صرف وہی یہاں بھیجے جاتے ہیں۔
//
// یہاں AI کا کام تشخیص خود سے گھڑنا نہیں بلکہ صرف انہی ملے ہوئے اقتباسات کو پڑھ کر
// ایک مربوط، منظم تفصیل بنانا ہے: یہ بیماری/علامت کس کس مزاج (صفراوی/بلغمی/سوداوی/دموی)
// میں زیادہ ہوتی ہے، اس کی ممکنہ وجوہات کیا ہیں، اور یہ کیوں ہوتی ہے — مگر یہ سب کچھ
// صرف فراہم کردہ اقتباسات کی بنیاد پر، اپنی طرف سے فرضی معلومات شامل کیے بغیر۔
//
// اہم: OPENAI_API_KEY کبھی بھی کلائنٹ (براؤزر) کوڈ میں نہیں لکھنی —
// یہ صرف Vercel کے Environment Variables میں محفوظ رہنی چاہیے۔

function stripHtml(s) {
  return String(s || '').replace(/<[^>]+>/g, '').trim();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'صرف POST request قبول ہے۔' });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'سرور پر OPENAI_API_KEY سیٹ نہیں ہے۔' });
  }

  try {
    const body = req.body || {};
    const query = typeof body.query === 'string' ? body.query.trim() : '';
    let matches = Array.isArray(body.matches) ? body.matches : [];

    // حفاظتی حد — بہت بڑی درخواست نہ بنے
    matches = matches.slice(0, 20).map(m => ({
      fileName: stripHtml(m && m.fileName),
      pageNum: m && m.pageNum,
      text: stripHtml(m && m.text).slice(0, 1800)
    })).filter(m => m.fileName && m.text);

    if (!query) {
      return res.status(400).json({ error: 'تلاش کیا گیا لفظ (query) فراہم نہیں کیا گیا۔' });
    }
    if (matches.length === 0) {
      return res.status(400).json({ error: 'کوئی اقتباس (matches) فراہم نہیں کیا گیا۔' });
    }

    const excerptsText = matches.map((m, idx) =>
      `--- اقتباس ${idx + 1} (فائل: ${m.fileName}، صفحہ: ${m.pageNum}) ---\n${m.text}`
    ).join('\n\n');

    const systemPrompt = `آپ ایک تجربہ کار حکیم/معالج ہیں جو قانونِ مفرد اعضاء اور مزاج پر مبنی طریقہ علاج سے واقف ہیں۔

آپ کو نیچے صارف کی اپنی PDF کتابوں میں سے وہ اصل اقتباسات دیے گئے ہیں جہاں تلاش کیا گیا لفظ/جملہ موجود ہے۔ یہ تلاش پہلے ہی مقامی طور پر ہو چکی ہے — آپ کا کام نئے سرے سے تشخیص گھڑنا نہیں، بلکہ صرف انہی اقتباسات کو غور سے پڑھ کر ایک مربوط اور مفید تفصیل ترتیب دینا ہے۔

اہم اصول:
1. صرف نیچے دیے گئے اقتباسات میں موجود معلومات کی بنیاد پر جواب دیں۔ اگر مزاج کی عمومی تشریح (مثلاً کون سی علامات کس مزاج سے جڑی ہیں) درکار ہو تو مستند مزاج کے اصولوں کی روشنی میں اقتباسات کی وضاحت کریں، مگر خود سے کوئی نئی بیماری، دوا یا وجہ ایجاد نہ کریں جس کا اقتباسات میں کوئی اشارہ نہ ہو۔
2. اگر اقتباسات میں کسی سوال کا مکمل جواب موجود نہ ہو تو صاف لکھ دیں کہ "اس بارے میں دستیاب کتابوں میں مکمل تفصیل نہیں ملی" — قیاس آرائی نہ کریں۔
3. جواب اردو میں، صاف اور منظم انداز میں تین حصوں میں دیں:
   - یہ علامت/بیماری کن کن مزاجوں (صفراوی، بلغمی، سوداوی، دموی) میں زیادہ پائی جاتی ہے، اقتباسات کے مطابق۔
   - اقتباسات کے مطابق اس کی ممکنہ وجوہات کیا بیان کی گئی ہیں۔
   - یہ بیماری/علامت کیوں ہوتی ہے — مکمل وضاحت، اقتباسات کے حوالے سے۔
4. جہاں کوئی اہم نکتہ کسی خاص فائل/صفحہ سے لیا ہو، وہاں مختصراً حوالہ دے دیں (مثلاً "فلاں فائل، صفحہ 12 کے مطابق")۔
5. زبان عام فہم اور ہمدردانہ رکھیں، طبی جملے وں کی بھرمار نہ کریں۔`;

    const userPrompt = `صارف نے یہ لفظ/جملہ تلاش کیا: "${query}"

نیچے اسی تلاش سے ملنے والے اصل اقتباسات ہیں:

${excerptsText}

براہ کرم اوپر دیے گئے اصولوں کے مطابق مکمل تفصیل اردو میں لکھیں۔`;

    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.4
      })
    });

    if (!openaiRes.ok) {
      const errBody = await openaiRes.text().catch(() => '');
      console.error('OpenAI API error:', errBody);
      return res.status(502).json({ error: 'OpenAI API سے جواب نہیں ملا۔' });
    }

    const data = await openaiRes.json();
    const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!content) {
      return res.status(502).json({ error: 'جواب خالی تھا۔' });
    }

    return res.status(200).json({ analysis: content.trim() });

  } catch (err) {
    console.error('analyze-pdf-matches error:', err);
    return res.status(500).json({ error: err && err.message ? err.message : 'سرور میں خرابی پیش آئی۔' });
  }
}
