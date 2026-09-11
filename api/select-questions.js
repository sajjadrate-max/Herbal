// Vercel Serverless Function
// Route: POST /api/select-questions
//
// اس فائل کا مقصد: مریض کی لکھی گئی مکمل تکلیف (فری ٹیکسٹ) پڑھ کر
// دی گئی اختیاری تشخیصی سوالات کی فہرست میں سے صرف وہی سوال منتخب
// کرنا جو اس مخصوص تکلیف کے لیے واقعی مفید/متعلقہ ہوں — تاکہ مریض کو
// غیر ضروری سوالات نہ پوچھے جائیں۔
//
// اہم: OPENAI_API_KEY کبھی بھی کلائنٹ (براؤزر) کوڈ میں نہیں لکھنی —
// یہ صرف Vercel کے Environment Variables میں محفوظ رہنی چاہیے۔

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
    const { complaint, questions } = req.body || {};

    if (!complaint || typeof complaint !== 'string' || !complaint.trim()) {
      return res.status(400).json({ error: 'مریض کی تکلیف کا متن (complaint) فراہم نہیں کیا گیا۔' });
    }
    if (!Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({ error: 'سوالات کی فہرست (questions) خالی یا غلط ہے۔' });
    }

    const questionList = questions.map((q, i) => `${i + 1}. id="${q.id}" — ${q.title}`).join('\n');

    const systemPrompt = `آپ ایک تجربہ کار معالج ہیں جو مریض کی مکمل تکلیف پڑھ کر یہ فیصلہ کرتے ہیں کہ آگے کون سے اضافی تشخیصی سوالات پوچھنا واقعی ضروری/مفید ہے، تاکہ مریض کو غیر ضروری طور پر ہر سوال کا جواب نہ دینا پڑے۔

نیچے دی گئی فہرست میں موجود اختیاری تشخیصی سوالات میں سے صرف وہی سوال منتخب کریں جو مریض کی بیان کردہ تکلیف سے حقیقی طور پر متعلقہ ہوں اور جن کا جواب علاج/تشخیص میں واقعی فرق پیدا کرے گا (مثلاً اگر مریض نے جوڑوں کے درد کی بات کی ہے تو "درد کس وقت زیادہ ہوتا ہے" اور "درد کس حالت میں زیادہ ہوتا ہے" جیسے سوال منتخب کریں؛ اگر قبض کا ذکر ہے تو "قبض ہے یا نہیں" منتخب کریں؛ اگر مریض کی تکلیف بہت عمومی/مختصر ہو تو صرف 3-5 بنیادی عمومی سوال منتخب کریں جیسے "مریض کو کیسا محسوس ہوتا ہے"، "چہرے کا رنگ"، "نبض")۔ غیر متعلقہ سوالات ہرگز منتخب نہ کریں۔ زیادہ سے زیادہ 8 سوال منتخب کریں، کم از کم 3۔

جواب صرف اس JSON شکل میں دیں، کوئی اضافی متن نہیں:
{"relevantIds":["id1","id2", "..."]}`;

    const userPrompt = `مریض کی مکمل تکلیف: ${complaint.trim()}

دستیاب اختیاری سوالات:
${questionList}`;

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
        temperature: 0.3,
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
      return res.status(502).json({ error: 'جواب خالی تھا۔' });
    }

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      return res.status(502).json({ error: 'جواب صحیح فارمیٹ میں نہیں تھا۔' });
    }

    const relevantIds = Array.isArray(parsed.relevantIds) ? parsed.relevantIds : [];
    return res.status(200).json({ relevantIds });

  } catch (err) {
    console.error('select-questions error:', err);
    return res.status(500).json({ error: 'سرور میں خرابی پیش آئی۔', details: String(err && err.message ? err.message : err) });
  }
}
