// Vercel Serverless Function
// Route: POST /api/disease-summary
//
// اس فائل کا مقصد: "بیماری کی تلاش" صفحہ پر جب صارف کوئی لفظ تلاش کرتا ہے تو
// diseaseList (جو پہلے سے سائٹ میں موجود ہے) میں سے ملنے والی اندراجات (نام، مزاج، عضو)
// AI کو بھیجی جاتی ہیں — AI کا کام نئی معلومات گھڑنا نہیں بلکہ صرف انہی دی گئی
// اندراجات کی بنیاد پر ایک صاف، مختصر اور مربوط اردو جملہ/جملے بنانا ہے، جیسے:
// "گردے کی پتھری زیادہ تر عضلاتی، غدی اور اعصابی میں ہو سکتی ہے۔"
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
    let diseases = Array.isArray(body.diseases) ? body.diseases : [];

    // حفاظتی حد — بہت بڑی درخواست نہ بنے
    diseases = diseases.slice(0, 60).map(d => ({
      name: stripHtml(d && d.name).slice(0, 120),
      mizajCategory: stripHtml(d && d.mizajCategory).slice(0, 60),
      organ: stripHtml(d && d.organ).slice(0, 120)
    })).filter(d => d.name);

    if (diseases.length === 0) {
      return res.status(400).json({ error: 'کوئی بیماری (diseases) فراہم نہیں کی گئی۔' });
    }

    const listText = diseases.map((d, idx) =>
      `${idx + 1}. نام: ${d.name} | عضو: ${d.organ || 'نامعلوم'} | مزاج کیٹیگری: ${d.mizajCategory || 'نامعلوم'}`
    ).join('\n');

    const systemPrompt = `آپ کو نیچے ایک فہرست دی گئی ہے جو ہماری اپنی ویب سائٹ کے ڈیٹا بیس (diseaseList) سے، صارف کی تلاش کے مطابق، پہلے ہی نکالی جا چکی ہے۔ ہر اندراج میں بیماری کا نام، اس کا عضو، اور اس کی مزاج کیٹیگری دی گئی ہے۔

اہم اصول:
1. صرف نیچے دی گئی فہرست میں موجود معلومات استعمال کریں۔ خود سے کوئی نئی بیماری، وجہ، علاج یا مزاج شامل نہ کریں۔
2. جن اندراجات کا "عضو" ایک جیسا ہو (یا واضح طور پر ایک ہی حقیقی بیماری کی مختلف نام کی صورتیں ہوں)، انہیں ایک ہی گروپ میں ملا دیں۔
3. ہر گروپ کے لیے ایک مختصر اردو جملہ بنائیں، بالکل اس انداز میں: "<بیماری کا نمائندہ نام> زیادہ تر <مزاج1>، <مزاج2> اور <مزاج3> میں ہو سکتی ہے۔" — اگر صرف ایک ہی مزاج کیٹیگری ہو تو: "<نام> زیادہ تر <مزاج> میں ہو سکتی ہے۔"
4. نمائندہ نام کے طور پر گروپ میں شامل ناموں میں سے سب سے مکمل/واضح نام چنیں۔
5. کوئی اضافی وضاحت، تمہید یا اختتامی جملہ نہ لکھیں — صرف ہر گروپ کے لیے ایک لائن، ہر لائن کے شروع میں "🔹 " لگا کر۔
6. جواب صرف اردو میں دیں۔`;

    const userPrompt = `ذیل میں فہرست ہے:\n\n${listText}\n\nبراہ کرم اوپر دیے گئے اصولوں کے مطابق ہر گروپ کے لیے ایک لائن بنائیں۔`;

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
        temperature: 0.2
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

    return res.status(200).json({ summary: content.trim() });

  } catch (err) {
    console.error('disease-summary error:', err);
    return res.status(500).json({ error: err && err.message ? err.message : 'سرور میں خرابی پیش آئی۔' });
  }
}
