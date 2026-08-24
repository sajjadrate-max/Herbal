// Vercel Serverless Function
// Route: POST /api/select-nuskha
//
// اس فائل کا مقصد: مریض کے مزاج، علامات اور بیماریوں کی بنیاد پر
// دی گئی دواؤں کی فہرست میں سے وہ دوا (یا دوائیں) منتخب کرنا جو
// سب سے جلد آرام دیں، اور اسی مزاج کی غذاؤں میں سے بھی موزوں ترین
// غذائیں منتخب کرنا — OpenAI API کی مدد سے۔
//
// اہم: OPENAI_API_KEY کبھی بھی کلائنٹ (براؤزر) کوڈ میں نہیں لکھنی —
// یہ صرف Vercel کے Environment Variables میں محفوظ رہنی چاہیے۔
//
// Vercel ڈیش بورڈ میں سیٹ اپ کا طریقہ:
// 1) Project → Settings → Environment Variables
// 2) Key: OPENAI_API_KEY   Value: <آپ کی اصل OpenAI API key>
// 3) Save کریں اور دوبارہ Deploy کریں (redeploy)

export default async function handler(req, res) {
  // صرف POST request قبول کریں
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'صرف POST request قبول ہے۔' });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'سرور پر OPENAI_API_KEY سیٹ نہیں ہے۔ Vercel Environment Variables میں شامل کریں۔' });
  }

  try {
    const { mizaj, patientNumber, symptoms, diseases, candidates, foods, age, maritalStatus, diseaseDuration, bloodPressure, painTiming, sugar, qabz } = req.body || {};

    if (!Array.isArray(candidates) || candidates.length === 0) {
      return res.status(400).json({ error: 'دواؤں کی فہرست (candidates) خالی یا غلط ہے۔' });
    }

    // فہرست کو بہت لمبا ہونے سے بچانے کے لیے محدود رکھیں (لاگت اور رفتار کے لیے)
    const limitedCandidates = candidates.slice(0, 40).map(c => ({
      name: c.name,
      mizaj: c.mizaj,
      benefit: (c.benefit || '').slice(0, 900) // ہر دوا کا فائدہ محدود لمبائی تک
    }));

    const foodList = Array.isArray(foods) ? foods.slice(0, 80) : [];

    const symptomsText = Array.isArray(symptoms) && symptoms.length ? symptoms.join('، ') : 'کوئی خاص علامت نہیں بتائی گئی';
    const diseasesText = Array.isArray(diseases) && diseases.length ? diseases.join('، ') : 'کوئی خاص بیماری منتخب نہیں کی گئی';

    const systemPrompt = `آپ ایک تجربہ کار معالج ہیں جو "قانونِ مفرد اعضاء" کے اصولوں کے ماہر ہیں۔

اہم: مریض کا مزاج/تحریک (کون سی قسم کی دوائیں دی جانی چاہئیں) پہلے ہی طے ہو چکا ہے — سائٹ کا اپنا نظام موسم، بیماری کی نوعیت (پرانی/نئی)، اور مزاج کے اصولوں کو مدنظر رکھ کر یہ فیصلہ کر چکا ہے۔ آپ کو نیچے صرف اسی مزاج کے مطابق پہلے سے چھنی ہوئی دواؤں کی فہرست دی جائے گی — آپ کا کام مزاج دوبارہ طے کرنا نہیں، بلکہ صرف اسی فہرست میں سے وہ دوا/دوائیں منتخب کرنا ہے جن کے فوائد میں مریض کی بتائی گئی بیماری/علامات کا لفظی یا قریبی مفہومی تعلق سب سے زیادہ واضح ہو۔ اسی طرح دی گئی غذاؤں کی فہرست میں سے بھی بیماری/علامات کے مطابق موزوں ترین غذائیں منتخب کرنی ہیں۔

دوا کے انتخاب کا واحد اصول — دوا صرف اور صرف اس کے "فوائد" کی بنیاد پر منتخب کی جائے گی:
1) صرف انہی دواؤں کو منتخب کریں جن کی "فوائد" فہرست میں مریض کی بتائی گئی بیماری یا علامت کا نام (یا اس کا مترادف/قریبی مفہوم) صاف طور پر موجود ہو۔ اندازے یا عمومی تعلق کی بنیاد پر دوا تجویز نہ کریں۔ عمر، بلڈ پریشر، شوگر، قبض، بیماری کی مدت، تکلیف کا وقت، یا ازدواجی حیثیت — ان میں سے کوئی بھی چیز انتخاب کی بنیاد نہیں بنے گی۔ صرف "فوائد" کے متن سے میل ہی فیصلہ کن ہے۔
2) ہر انتخاب کی "reason" میں لازمی طور پر وہ عین لفظ/فقرہ نقل کریں جو اس دوا کے "benefit" میں موجود تھا اور مریض کی بیماری/علامت سے میل کھاتا ہے — عمومی یا غیر متعلقہ وجہ (جیسے کسی اور بیماری کا ذکر) ہرگز نہ لکھیں۔
3) اگر فہرست میں کوئی دوا مریض کی بتائی گئی بیماری/علامت سے واضح طور پر میل نہیں کھاتی، تو اندازہ لگا کر کوئی دوا نہ تھوپیں — اس صورت میں خالی "selections": [] واپس کریں۔
4) زیادہ سے زیادہ 3 دوائیں منتخب کریں، اور جو سب سے زیادہ درست میل کھاتی ہو اسے پہلے نمبر پر رکھیں۔

غذاؤں کے انتخاب کا اصول:
5) نیچے دی گئی غذاؤں کی فہرست میں سے صرف وہی 5 سے 8 غذائیں منتخب کریں جو مریض کی بتائی گئی بیماری/علامات کے لیے روایتی حکمت کے مطابق خاص طور پر مفید ہوں۔ فہرست سے باہر کوئی غذا تجویز نہ کریں۔ اگر غذاؤں کی فہرست نہ دی گئی ہو یا کوئی خاص میل نہ کھائے تو خالی "foodSelections": [] واپس کریں۔

جواب صرف اس JSON شکل میں دیں، کوئی اضافی متن نہیں:
{"selections":[{"name":"دوا کا صحیح نام (فہرست سے بالکل ویسا)","reason":"مختصر وجہ اردو میں، جس میں دوا کے فوائد سے وہ عین لفظ/فقرہ شامل ہو جو مریض کی بیماری/علامت سے میل کھاتا ہے"}],"foodSelections":[{"name":"غذا کا نام (فہرست سے بالکل ویسا)","reason":"مختصر وجہ اردو میں"}]}`;

    const userPrompt = `مریض کا مزاج: ${mizaj || 'نامعلوم'}${patientNumber ? ' (نمبر ' + patientNumber + ')' : ''}
علامات: ${symptomsText}
بیماریاں: ${diseasesText}

دستیاب دواؤں کی فہرست:
${limitedCandidates.map((c, i) => `${i + 1}. ${c.name} — مزاج: ${c.mizaj} — فوائد: ${c.benefit}`).join('\n')}

دستیاب غذاؤں کی فہرست:
${foodList.length ? foodList.join('، ') : '(کوئی غذائی فہرست فراہم نہیں کی گئی)'}`;

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

    if (!parsed.selections || !Array.isArray(parsed.selections)) {
      return res.status(502).json({ error: 'جواب میں دوائیوں کی فہرست موجود نہیں۔' });
    }

    const foodSelections = Array.isArray(parsed.foodSelections) ? parsed.foodSelections : [];

    return res.status(200).json({ selections: parsed.selections, foodSelections });

  } catch (err) {
    console.error('select-nuskha error:', err);
    return res.status(500).json({ error: 'سرور میں خرابی پیش آئی۔', details: String(err && err.message ? err.message : err) });
  }
}
