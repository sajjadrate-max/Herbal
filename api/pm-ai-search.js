// Vercel Serverless Function
// Route: POST /api/pm-ai-search
//
// "بیماری کی تلاش" کے لیے AI — دو مرحلے:
//  1) mode:"terms"  → صارف کا سوال سمجھ کر کتابوں میں ڈھونڈنے کے لیے الفاظ/جملے بنائے
//     جواب: { understood, terms:[...], words:[...] }
//  2) mode:"rank"   → براؤزر نے کتابوں سے جو صفحات (امیدوار) ڈھونڈے، ان میں سے صرف وہی چنے جو واقعی
//     اسی سوال کا جواب/وضاحت رکھتے ہوں — ہر ایک کی مختصر وجہ کے ساتھ
//     جواب: { results:[{ id, score, reason }] }
//
// اہم: OPENAI_API_KEY صرف Vercel کے Environment Variables میں — کبھی براؤزر کوڈ میں نہیں۔

async function askOpenAI(apiKey, system, user, model) {
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: model || process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      temperature: 0.1,
      response_format: { type: 'json_object' }
    })
  });
  if (!r.ok) throw new Error('OpenAI: ' + r.status + ' ' + (await r.text().catch(() => '')).slice(0, 300));
  const data = await r.json();
  const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  try { return JSON.parse(content || '{}'); } catch (e) { return {}; }
}

const clean = (arr, n, len) => (Array.isArray(arr) ? arr : [])
  .map(x => String(x || '').trim()).filter(x => x && x.length <= (len || 50)).slice(0, n);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'صرف POST request قبول ہے۔' });
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'سرور پر OPENAI_API_KEY سیٹ نہیں ہے۔' });

  try {
    const body = req.body || {};
    const question = String(body.question || '').trim().slice(0, 300);
    if (!question) return res.status(400).json({ error: 'سوال خالی ہے۔' });

    if (body.mode === 'terms') {
      const system = `آپ طب یونانی، قانون مفرد اعضاء اور جدید طب کے ماہر ہیں اور اردو طبی کتابوں میں تلاش کے ماہر ہیں۔ یہ طبی ویب سائٹ ہے، اس لیے جسم کے پوشیدہ اعضاء اور مردانہ/زنانہ امراض کے نام بلا جھجک لکھیں۔
صارف ایک سوال/بیماری لکھے گا۔ پہلے سمجھیں کہ وہ اصل میں کیا جاننا چاہتا ہے، پھر وہ الفاظ اور جملے بنائیں جو اردو طبی کتابوں کی فہرست/عنوانات/متن میں اسی موضوع کے لیے لکھے ہوتے ہیں۔
مثال: "عضو تناسل کا چھوٹا ہونا" → عضو خاص کو لمبا اور موٹا کرنا، آلہ تناسل کو لمبا کریں، عضو تناسل کا لمبا اور موٹا ہونا، ذکر کی لاغری، عضو خاص میں لاغری، چھوٹا پن، قضیب کا چھوٹا ہونا، طلاء، ...
اصول:
1) "terms": 10 سے 30 مختصر جملے/نام (2 سے 6 الفاظ)، جن میں اسی موضوع کے علمی، عام، علاقائی، عربی/فارسی نام اور اس کے علاج کے عنوان (مثلاً "... کا علاج"، "... کے لیے طلاء") شامل ہوں۔ الٹی/مختلف بیماری نہ ڈالیں۔
2) "words": 3 سے 10 اکیلے اہم الفاظ جو اسی موضوع کی پہچان ہوں (مثلاً لمبا، موٹا، لاغری، عضو خاص) — عام الفاظ (کا، کی، ہونا، بیماری، درد) نہیں۔
3) "understood": ایک مختصر اردو جملہ کہ صارف کیا پوچھ رہا ہے۔
صرف JSON: {"understood":"...","terms":["..."],"words":["..."]}`;
      const out = await askOpenAI(apiKey, system, `سوال: "${question}"`);
      return res.status(200).json({
        understood: String(out.understood || '').slice(0, 200),
        terms: clean(out.terms, 30, 60),
        words: clean(out.words, 10, 25)
      });
    }

    if (body.mode === 'rank') {
      const cands = (Array.isArray(body.candidates) ? body.candidates : []).slice(0, 80).map(c => ({
        id: String(c.id || '').slice(0, 20),
        book: String(c.book || '').slice(0, 90),
        page: String(c.page || '').slice(0, 10),
        text: String(c.text || '').replace(/\s+/g, ' ').slice(0, 420)
      })).filter(c => c.id && c.text);
      if (!cands.length) return res.status(200).json({ results: [] });
      const system = `آپ اردو طبی کتابوں کے ماہر محقق ہیں۔ صارف کا ایک سوال ہے اور کتابوں کے کچھ صفحات کا مختصر متن (یا اس صفحے پر شروع ہونے والے عنوانات) دیا گیا ہے۔ کچھ صفحات کا متن OCR سے خراب/بے ربط بھی ہو سکتا ہے — ایسا بے معنی متن ہو تو اسے متعلقہ نہ سمجھیں۔
کام: ہر صفحے کو دیکھ کر فیصلہ کریں کہ کیا اس صفحے پر واقعی صارف کے سوال کا جواب، وضاحت، اسباب، علامات یا علاج/نسخہ موجود ہے۔
- صرف لفظ ملنا کافی نہیں — موضوع ایک ہونا چاہیے (مثلاً سوال "عضو کا چھوٹا ہونا" ہو تو "عضو کا ورم" یا "موٹاپا" غیر متعلقہ ہیں، مگر "عضو خاص کو لمبا اور موٹا کرنا" متعلقہ ہے)۔
- score: 0 سے 100 (90+ = بالکل اسی سوال کا جواب، 70-89 = واضح طور پر متعلقہ، 50-69 = جزوی، اس سے کم = غیر متعلقہ)۔
- reason: ایک مختصر اردو جملہ کہ اس صفحے پر کیا ہے (مثلاً "عضو خاص کو لمبا کرنے کا طلاء اور طریقہ")۔
صرف متعلقہ صفحات (score 50 یا زیادہ) واپس کریں، سب سے بہتر پہلے، زیادہ سے زیادہ 15۔
صرف JSON: {"results":[{"id":"...","score":95,"reason":"..."}]}`;
      const user = `سوال: "${question}"${body.understood ? `\nسوال کا مطلب: ${String(body.understood).slice(0, 200)}` : ''}\n\nصفحات:\n` +
        cands.map(c => `[${c.id}] کتاب: ${c.book} — صفحہ ${c.page}\n${c.text}`).join('\n\n');
      const out = await askOpenAI(apiKey, system, user);
      const ids = new Set(cands.map(c => c.id));
      const results = (Array.isArray(out.results) ? out.results : [])
        .map(r => ({ id: String(r.id || ''), score: Math.max(0, Math.min(100, parseInt(r.score, 10) || 0)), reason: String(r.reason || '').slice(0, 160) }))
        .filter(r => ids.has(r.id) && r.score >= 50)
        .sort((a, b) => b.score - a.score)
        .slice(0, 15);
      return res.status(200).json({ results });
    }

    return res.status(400).json({ error: 'mode غلط ہے (terms یا rank)۔' });
  } catch (err) {
    return res.status(500).json({ error: String(err && err.message ? err.message : err) });
  }
}
