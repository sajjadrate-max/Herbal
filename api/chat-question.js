// Vercel Serverless Function
// Route: POST /api/chat-question
//
// اس فائل کا مقصد: مریض کی بتائی گئی تکلیف کی بنیاد پر ایک ہی بار میں
// یہ فیصلہ کرنا کہ باقی تشخیصی سوالات (pool) میں سے کون سے واقعی
// ضروری/متعلقہ ہیں — تاکہ سسٹم یہ تمام سوالات ایک ساتھ (بیک وقت) دکھا سکے،
// ایک ایک کر کے نہیں۔ غیر متعلقہ سوالات فہرست سے خارج کر دیے جاتے ہیں۔
//
// اہم: OPENAI_API_KEY کبھی بھی کلائنٹ (براؤزر) کوڈ میں نہیں لکھنی —
// یہ صرف Vercel کے Environment Variables میں محفوظ رہنی چاہیے (select-nuskha.js کی طرح)۔

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'صرف POST request قبول ہے۔' });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'سرور پر OPENAI_API_KEY سیٹ نہیں ہے۔ Vercel Environment Variables میں شامل کریں۔' });
  }

  try {
    const { complaint, pool } = req.body || {};

    if (!Array.isArray(pool) || pool.length === 0) {
      return res.status(200).json({ questions: [] });
    }

    const limitedPool = pool.slice(0, 30).map(f => ({
      id: f.id,
      title: f.title,
      options: Array.isArray(f.options) ? f.options.slice(0, 8) : []
    }));

    const systemPrompt = `آپ ایک تجربہ کار معالج کے معاون ہیں جو مریض سے صرف وہی تشخیصی سوالات پوچھتے ہیں جو واقعی ضروری ہوں — غیر متعلقہ سوالات پوچھ کر مریض کا وقت ضائع نہیں کرتے۔

مریض نے اپنی تکلیف اپنے الفاظ میں بتا دی ہے۔ کچھ لازمی معلومات (عمر، ازدواجی حیثیت، شوگر، بلڈ پریشر) الگ سے ہمیشہ پوچھی جاتی ہیں — ان کے بارے میں آپ کو فیصلہ نہیں کرنا۔ آپ کا کام: نیچے دی گئی فہرست ("pool") میں سے وہ تمام سوالات ایک ساتھ منتخب کرنا ہے جو مریض کی بتائی گئی تکلیف کی روشنی میں تشخیص کو واقعی بہتر/واضح کریں گے — یہ تمام سوالات مریض کو ایک ہی بار، بیک وقت دکھائے جائیں گے (ایک ایک کر کے نہیں)، اس لیے فہرست حتمی اور مکمل ہونی چاہیے۔

اصول:
1) صرف وہی سوالات منتخب کریں جن کا مریض کی بتائی گئی تکلیف سے حقیقی تعلق ہو (مثلاً اگر تکلیف گیس/معدے سے متعلق ہے تو گیس، زبان، ذائقہ سے متعلق سوالات؛ اگر جوڑوں کے درد کی بات ہو تو "درد کس وقت/حالت میں زیادہ ہوتا ہے" جیسے سوالات) — بالکل غیر متعلقہ سوال (مثلاً پیشاب کا سوال جبکہ تکلیف صرف جوڑوں کے درد کی ہو) ہرگز شامل نہ کریں۔
2) عام مزاج تشخیصی سوالات (چہرہ، نبض، زبان، ہاتھ کی جلد وغیرہ) بھی مفید ہو سکتے ہیں کیونکہ یہ مزاج طے کرنے میں مدد دیتے ہیں — اگر تکلیف سے براہ راست متعلق سوالات کم ہوں تو ان میں سے 1-2 بھی شامل کر لیں تاکہ مزاج کا معقول اندازہ ہو سکے۔
3) کل ملا کر 2 سے 6 سوالات کافی ہیں — اس سے زیادہ مت چنیں، ورنہ مریض پر غیر ضروری بوجھ پڑے گا۔
4) اگر تکلیف اتنی واضح ہے کہ اضافی سوالات کی ضرورت ہی نہیں، تو خالی فہرست ("questions": []) واپس کریں۔

جواب صرف اس JSON شکل میں دیں، کوئی اضافی متن نہیں:
{"questions": ["فہرست میں سے منتخب کردہ ids کی array، مثلاً id1، id2"]}`;

    const userPrompt = `مریض کی تکلیف: ${complaint || 'نامعلوم'}

دستیاب سوالات کی فہرست (صرف انہی میں سے "id" منتخب کریں):
${limitedPool.map((f, i) => `${i + 1}. id: "${f.id}" — سوال: ${f.title} — آپشنز: ${f.options.join('، ')}`).join('\n')}`;

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
        temperature: 0.2,
        response_format: { type: 'json_object' }
      })
    });

    if (!openaiRes.ok) {
      const errBody = await openaiRes.text().catch(() => '');
      return res.status(502).json({ error: 'OpenAI API سے جواب نہیں ملا۔', details: errBody });
    }

    const data = await openaiRes.json();
    const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;

    if (!content) {
      return res.status(200).json({ questions: [] });
    }

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      return res.status(200).json({ questions: [] });
    }

    const validIds = new Set(limitedPool.map(f => f.id));
    const questions = Array.isArray(parsed.questions)
      ? parsed.questions.filter(id => validIds.has(id)).slice(0, 6)
      : [];

    return res.status(200).json({ questions });

  } catch (err) {
    console.error('chat-question error:', err);
    // خرابی کی صورت میں مریض کو روکنے کی بجائے خالی فہرست دے دیں (صرف لازمی سوالات ہی پوچھے جائیں گے)
    return res.status(200).json({ questions: [] });
  }
}
