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
    const { complaint, questions, diseases } = req.body || {};

    if (!complaint || typeof complaint !== 'string' || !complaint.trim()) {
      return res.status(400).json({ error: 'مریض کی تکلیف کا متن (complaint) فراہم نہیں کیا گیا۔' });
    }
    if (!Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({ error: 'سوالات کی فہرست (questions) خالی یا غلط ہے۔' });
    }

    const questionList = questions.map((q, i) => `${i + 1}. id="${q.id}" — ${q.title}`).join('\n');
    const diseaseList = Array.isArray(diseases) ? diseases.slice(0, 600) : [];

    const systemPrompt = `آپ ایک تجربہ کار معالج ہیں جو مریض کی مکمل تکلیف پڑھ کر دو کام کرتے ہیں: (الف) دی گئی بیماریوں کی فہرست میں سے وہ بیماری/بیماریاں شناخت کرنا جو مریض نے اپنے الفاظ میں بیان کی ہیں، اور (ب) یہ فیصلہ کرنا کہ آگے کون سے اضافی تشخیصی سوالات پوچھنا واقعی ضروری ہے، تاکہ مریض کو غیر ضروری طور پر کوئی بھی اضافی سوال نہ پوچھا جائے۔

(الف) بیماریوں کی شناخت — نیچے دی گئی بیماریوں کی فہرست میں سے صرف وہی نام منتخب کریں جو مریض کی تکلیف میں لفظی طور پر یا صاف مفہومی طور پر بیان ہوئے ہوں (مثلاً مریض نے "خشک کھانسی" لکھا اور فہرست میں "خشک کھانسی" یا اس سے ملتی جلتی انٹری موجود ہے)۔ اندازہ لگا کر یا محض موضوع کی مشابہت کی بنیاد پر بیماری شامل نہ کریں — تعلق حقیقی اور واضح ہونا چاہیے۔ نام فہرست میں سے بالکل ویسا ہی نقل کریں۔ اگر فہرست میں کوئی واضح میل نہ ملے تو خالی فہرست دیں۔ زیادہ سے زیادہ 6 بیماریاں منتخب کریں۔

(ب) اضافی سوالات — اصول سخت ہے: کم سے کم سوال پوچھیں — جتنے کم سوالوں سے کام چل جائے، اتنے ہی کافی ہیں۔ نیچے دی گئی فہرست میں موجود سوالات میں سے صرف وہی سوال منتخب کریں جو مریض کی بیان کردہ تکلیف کے علاج/تشخیص میں واقعی اور براہِ راست فرق پیدا کریں گے (مثلاً اگر مریض نے جوڑوں کے درد کی بات کی ہے تو "درد کس وقت زیادہ ہوتا ہے" جیسا سوال متعلقہ ہے؛ اگر قبض کا ذکر ہے تو "قبض ہے یا نہیں" متعلقہ ہے)۔ اگر مریض کی بتائی گئی تکلیف خود اتنی واضح اور تفصیلی ہے کہ کسی اضافی سوال کی واقعی ضرورت نہیں (خصوصاً اگر اوپر بیماری واضح شناخت ہو گئی ہو)، تو خالی فہرست دیں — ایک بھی غیر ضروری سوال شامل نہ کریں، محض فہرست بھرنے کے لیے سوال ہرگز منتخب نہ کریں۔

اہم: کوئی بھی سوال منتخب کرنے سے پہلے یہ ضرور چیک کریں کہ مریض نے اپنی تکلیف کی تحریر میں پہلے ہی اس سوال کا جواب نہیں دے دیا۔ مثال کے طور پر اگر مریض نے لکھا ہے کہ اس کی عمر 14-15 سال ہے تو "عمر کتنی ہے" والا سوال ہرگز منتخب نہ کریں کیونکہ یہ معلومات پہلے ہی مل چکی ہے۔ اسی طرح اگر تکلیف میں پہلے سے موجود کوئی اور معلومات (جیسے بیماری کب سے ہے، شوگر ہے یا نہیں، وغیرہ) بیان ہو چکی ہو تو اس سے متعلق سوال دوبارہ نہ پوچھیں۔ صرف وہی معلومات پوچھیں جو مریض کی تحریر میں کہیں موجود نہیں۔ زیادہ سے زیادہ 5 سوال منتخب کریں، کم از کم کی کوئی حد نہیں (0 بھی جائز ہے)۔

جواب صرف اس JSON شکل میں دیں، کوئی اضافی متن نہیں:
{"matchedDiseaseNames":["نام1","نام2"],"relevantIds":["id1","id2", "..."]}`;

    const userPrompt = `مریض کی مکمل تکلیف: ${complaint.trim()}

دستیاب بیماریوں کی فہرست:
${diseaseList.length ? diseaseList.join('، ') : '(کوئی فہرست فراہم نہیں کی گئی)'}

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
    const matchedDiseaseNames = Array.isArray(parsed.matchedDiseaseNames) ? parsed.matchedDiseaseNames : [];
    return res.status(200).json({ relevantIds, matchedDiseaseNames });

  } catch (err) {
    console.error('select-questions error:', err);
    return res.status(500).json({ error: 'سرور میں خرابی پیش آئی۔', details: String(err && err.message ? err.message : err) });
  }
}
