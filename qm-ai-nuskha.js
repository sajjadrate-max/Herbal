// Vercel Serverless Function
// Route: POST /api/qm-ai-nuskha
//
// اس فائل کا مقصد: "نسخہ سازی" میں منتخب بیماری کے لیے قانونِ مفرد اعضاء کے مطابق نسخہ —
// سائٹ (براؤزر) پہلے ہی مرض کی تحریک، علاج والا مزاج (کلیہ 3، 2، 1)، بیمار عضو، اور انہی مزاجوں کی
// جڑی بوٹیوں کی فہرست (کتاب "تحریک امراض اور علاج" کی ادویہ فہرست + "خواص المفردات" + سائٹ کے فوائد)
// اور کشتوں کی فہرست بھیجتی ہے۔ AI کا کام صرف انہی فہرستوں میں سے اس مرض کے لیے بہترین بوٹیاں
// اور کشتہ چننا ہے — مزاج خود طے نہیں کرنا، اور فہرست سے باہر کی بوٹی نہیں دینی۔
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
    const b = req.body || {};
    const disease = String(b.disease || '').trim().slice(0, 120);
    if (!disease) return res.status(400).json({ error: 'بیماری کا نام فراہم نہیں کیا گیا۔' });
    const synonyms = (Array.isArray(b.synonyms) ? b.synonyms : []).slice(0, 15).map(String);
    const herbs = (Array.isArray(b.herbs) ? b.herbs : []).slice(0, 400).map(h => ({
      n: String(h.n || '').slice(0, 40), m: String(h.m || '').slice(0, 30), f: String(h.f || '').slice(0, 200), k: h.k || ''
    })).filter(h => h.n);
    const kushte = (Array.isArray(b.kushte) ? b.kushte : []).slice(0, 30).map(k => ({
      n: String(k.n || '').slice(0, 30), m: String(k.m || '').slice(0, 30), f: String(k.f || '').slice(0, 200)
    }));
    if (!herbs.length) return res.status(400).json({ error: 'جڑی بوٹیوں کی فہرست خالی ہے۔' });

    const systemPrompt = `آپ قانونِ مفرد اعضاء (حکیم صابر ملتانی) اور طب یونانی کے ماہر حکیم ہیں اور اردو میں جواب دیتے ہیں۔
سائٹ نے مرض کی تحریک اور علاج والا مزاج پہلے ہی کتاب کے کلیوں کے مطابق طے کر دیا ہے۔ آپ کو صرف دی گئی فہرستوں میں سے نسخہ چننا ہے۔

نسخے کے اصول (لازمی):
1) ہر بوٹی صرف دی گئی "جڑی بوٹیوں کی فہرست" سے — نام بالکل ویسا ہی لکھیں جیسا فہرست میں ہے۔ فہرست سے باہر کوئی بوٹی نہ دیں۔
2) "مرض کے لیے" (role: "disease") صرف وہ بوٹیاں جو اس مخصوص بیماری (یا اس کے دیے گئے دوسرے ناموں) میں واقعی اور معروف طور پر مفید ہیں — طب یونانی کی مستند معلومات اور دیے گئے فوائد کی بنیاد پر۔ کھینچ تان کر تعلق نہ بنائیں۔ کوشش کریں کہ تینوں کلیوں (کلیہ 3، کلیہ 2، کلیہ 1) کی تحریکوں سے کم از کم ایک ایک مرض کی دوا ہو، مگر صرف اگر وہ واقعی اس مرض میں مفید ہو۔
3) ساتھ میں معاون بوٹیاں (صرف تب جب مرض والی کوئی بوٹی یہ کام پہلے سے نہ کر رہی ہو): "muq" مقوی/ملٹی وٹامن، "hazim" ہاضم، "anti" اینٹی بائیوٹک (جراثیم کش؛ جلدی امراض میں اینٹی سیپٹک)۔ اینٹی بائیوٹک صرف تب جب مرض میں انفیکشن/سوزش/زخم/پیپ/بخار/جلدی مسئلہ ہو۔ معدے کے امراض میں الگ ہاضم ضروری نہیں۔ کمزوری کے امراض میں الگ مقوی ضروری نہیں۔
4) کم سے کم بوٹیاں، زیادہ سے زیادہ فائدہ — عموماً 3 سے 6 بوٹیاں۔ عام ملنے والی بوٹیوں کو ترجیح۔ زہریلی اشیاء (سنکھیا، دھتورہ، کچلہ، جمال گوٹہ، افیون، ہڑتال، رسکپور، آک کا دودھ، جگنو، تیلنی مکھی وغیرہ) ہرگز نہ دیں۔
5) "roles" میں ہر بوٹی کے سب کام لکھیں (مثلاً ["disease","hazim"])؛ "role" اس کا بنیادی کام۔
6) "reason" میں مختصر (ایک سطر) لکھیں کہ یہ بوٹی اس مرض میں کیوں مفید ہے۔
7) کشتہ: دی گئی کشتوں کی فہرست میں سے اس مرض کے لیے 1 یا 2 موزوں کشتے (اختیاری مشورہ)۔ مردانہ/زنانہ امراض (لیکوریا، جریان، احتلام، سرعت انزال، ذکاوت حس، مردانہ کمزوری، منی/سپرم) میں کشتہ مرجان لازمی پہلے نمبر پر۔ کوئی موزوں نہ ہو تو خالی چھوڑ دیں۔
صرف JSON واپس کریں:
{"herbs":[{"name":"...","role":"disease|muq|hazim|anti","roles":["..."],"reason":"..."}],"kushta":[{"name":"...","reason":"..."}],"note":"ایک مختصر سطر (اختیاری)"}`;

    const userPrompt = `بیماری: ${disease}
دوسرے نام: ${synonyms.length ? synonyms.join('، ') : '—'}
مرض کی تحریک: ${b.diseaseTehreek || '—'}
علاج (کلیہ 3): ${b.k3 || '—'} — (کلیہ 2): ${b.k2 || '—'} — (کلیہ 1، جڑ سے): ${b.k1 || '—'}
بیمار عضو: ${b.organ || '—'}${b.organMizaj ? ' (مزاج: ' + b.organMizaj + ')' : ''}
مریض: جوان — مرض: پرانا/شدید

جڑی بوٹیوں کی فہرست (نام — مزاج — فوائد):
${herbs.map((h, i) => `${i + 1}. ${h.n} — ${h.m}${h.f ? ' — ' + h.f : ''}`).join('\n')}

کشتوں کی فہرست (نام — مزاج — فوائد):
${kushte.map((k, i) => `${i + 1}. ${k.n} — ${k.m} — ${k.f}`).join('\n') || '—'}`;

    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
        temperature: 0.2,
        response_format: { type: 'json_object' }
      })
    });
    if (!r.ok) return res.status(502).json({ error: 'OpenAI API سے جواب نہیں ملا۔', details: await r.text().catch(() => '') });
    const data = await r.json();
    const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    let out = {};
    try { out = JSON.parse(content || '{}'); } catch (e) { out = {}; }

    // صرف فہرست میں موجود نام قبول کریں (AI کوئی نام خود نہ گھڑ سکے)
    const herbNames = new Set(herbs.map(h => h.n));
    const kushtaNames = new Set(kushte.map(k => k.n));
    const okRoles = ['disease', 'muq', 'hazim', 'anti'];
    const outHerbs = (Array.isArray(out.herbs) ? out.herbs : [])
      .filter(h => h && herbNames.has(String(h.name || '').trim()))
      .map(h => ({
        name: String(h.name).trim(),
        role: okRoles.includes(h.role) ? h.role : 'disease',
        roles: (Array.isArray(h.roles) ? h.roles : []).filter(x => okRoles.includes(x)),
        reason: String(h.reason || '').slice(0, 200)
      })).slice(0, 8);
    const outKushta = (Array.isArray(out.kushta) ? out.kushta : [])
      .filter(k => k && kushtaNames.has(String(k.name || '').trim()))
      .map(k => ({ name: String(k.name).trim(), reason: String(k.reason || '').slice(0, 200) })).slice(0, 2);
    return res.status(200).json({ herbs: outHerbs, kushta: outKushta, note: String(out.note || '').slice(0, 300) });
  } catch (err) {
    return res.status(500).json({ error: String(err && err.message ? err.message : err) });
  }
}
