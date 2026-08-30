// Vercel Serverless Function
// Route: POST /api/chat-question
//
// اس فائل کا مقصد: مریض کی بتائی گئی تکلیف اور اب تک کے جوابات کی بنیاد پر
// یہ فیصلہ کرنا کہ باقی تشخیصی سوالات (pool) میں سے اگلا کون سا سوال واقعی
// ضروری/متعلقہ ہے، یا اگر کافی معلومات مل چکی ہے تو تشخیص مکمل کر دینا —
// تاکہ مریض کو غیر متعلقہ سوالات نہ پوچھنے پڑیں۔
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
    const { complaint, answeredSoFar, pool, questionsAskedSoFar } = req.body || {};

    if (!Array.isArray(pool) || pool.length === 0) {
      return res.status(200).json({ done: true });
    }

    const limitedPool = pool.slice(0, 30).map(f => ({
      id: f.id,
      title: f.title,
      options: Array.isArray(f.options) ? f.options.slice(0, 8) : []
    }));

    const answeredText = Array.isArray(answeredSoFar) && answeredSoFar.length
      ? answeredSoFar.join('؛ ')
      : 'ابھی تک کوئی اضافی سوال نہیں پوچھا گیا';

    const systemPrompt = `آپ ایک تجربہ کار معالج کے معاون ہیں جو مریض سے صرف وہی تشخیصی سوالات پوچھتے ہیں جو واقعی ضروری ہوں — غیر متعلقہ سوالات پوچھ کر مریض کا وقت ضائع نہیں کرتے۔

مریض نے اپنی تکلیف اپنے الفاظ میں بتا دی ہے، اور کچھ لازمی معلومات (عمر، ازدواجی حیثیت، شوگر، بلڈ پریشر) پہلے ہی لی جا چکی ہیں۔ اب آپ کا کام: نیچے دی گئی فہرست ("pool") میں سے وہ ایک سوال منتخب کرنا ہے جو مریض کی بتائی گئی تکلیف کی روشنی میں تشخیص کو سب سے زیادہ بہتر/واضح کرے گا۔

اصول:
1) صرف وہی سوال منتخب کریں جس کا مریض کی بتائی گئی تکلیف سے حقیقی تعلق ہو (مثلاً اگر تکلیف گیس/معدے سے متعلق ہے تو گیس، زبان، ذائقہ سے متعلق سوالات پوچھیں؛ اگر جوڑوں کے درد کی بات ہو تو "درد کس وقت/حالت میں زیادہ ہوتا ہے" جیسے سوالات پوچھیں) — بالکل غیر متعلقہ سوال (مثلاً پیشاب کا سوال جبکہ تکلیف صرف جوڑوں کے درد کی ہو) ہرگز نہ پوچھیں۔
2) عام مزاج تشخیصی سوالات (چہرہ، نبض، زبان، ہاتھ کی جلد وغیرہ) بھی مفید ہو سکتے ہیں کیونکہ یہ مزاج طے کرنے میں مدد دیتے ہیں — اگر تکلیف سے براہ راست متعلق کوئی سوال باقی نہ ہو تو ان میں سے کوئی ایک منتخب کریں، بشرطیکہ ابھی 3-4 سے کم عمومی مزاج سوالات پوچھے جا چکے ہوں۔
3) جیسے ہی آپ کے خیال میں تشخیص کے لیے کافی معلومات مل چکی ہیں (عام طور پر 2 سے 5 اضافی سوالات کافی ہوتے ہیں)، "done":true واپس کریں — غیر ضروری طوالت سے گریز کریں۔
4) ${questionsAskedSoFar || 0} سوالات پہلے ہی پوچھے جا چکے ہیں — اگر یہ تعداد 5 یا زیادہ ہو چکی ہے تو done:true دیں جب تک کوئی سوال واقعی نہایت ضروری نہ ہو۔

جواب صرف اس JSON شکل میں دیں، کوئی اضافی متن نہیں:
{"done": false, "next": "فہرست میں سے وہی id جو منتخب کیا"}
یا
{"done": true}`;

    const userPrompt = `مریض کی تکلیف: ${complaint || 'نامعلوم'}

اب تک پوچھے گئے سوالات اور جوابات: ${answeredText}

باقی دستیاب سوالات کی فہرست (صرف انہی میں سے "id" منتخب کریں):
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
      return res.status(200).json({ done: true });
    }

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      return res.status(200).json({ done: true });
    }

    if (parsed.done === true || !parsed.next) {
      return res.status(200).json({ done: true });
    }

    const validIds = limitedPool.map(f => f.id);
    if (!validIds.includes(parsed.next)) {
      return res.status(200).json({ done: true });
    }

    return res.status(200).json({ done: false, next: parsed.next });

  } catch (err) {
    console.error('chat-question error:', err);
    // خرابی کی صورت میں مریض کو روکنے کی بجائے تشخیص مکمل کرنے دیں
    return res.status(200).json({ done: true });
  }
}
