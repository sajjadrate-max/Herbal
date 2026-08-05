// Vercel Serverless Function
// Route: POST /api/select-nuskha
//
// اس فائل کا مقصد: مریض کے مزاج، علامات اور بیماریوں کی بنیاد پر
// دی گئی دواؤں کی فہرست میں سے وہ دوا (یا دوائیں) منتخب کرنا جو
// سب سے جلد آرام دیں — OpenAI API کی مدد سے۔
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
    const { mizaj, patientNumber, symptoms, diseases, candidates } = req.body || {};

    if (!Array.isArray(candidates) || candidates.length === 0) {
      return res.status(400).json({ error: 'دواؤں کی فہرست (candidates) خالی یا غلط ہے۔' });
    }

    // فہرست کو بہت لمبا ہونے سے بچانے کے لیے محدود رکھیں (لاگت اور رفتار کے لیے)
    const limitedCandidates = candidates.slice(0, 40).map(c => ({
      name: c.name,
      mizaj: c.mizaj,
      benefit: (c.benefit || '').slice(0, 700) // ہر دوا کا فائدہ محدود لمبائی تک
    }));

    const symptomsText = Array.isArray(symptoms) && symptoms.length ? symptoms.join('، ') : 'کوئی خاص علامت نہیں بتائی گئی';
    const diseasesText = Array.isArray(diseases) && diseases.length ? diseases.join('، ') : 'کوئی خاص بیماری منتخب نہیں کی گئی';

    const systemPrompt = `آپ ایک تجربہ کار معالج ہیں جو "قانونِ مفرد اعضاء" کے اصولوں کے ماہر ہیں۔
آپ کو مریض کا مزاج، اس کی علامات/بیماریاں، اور نیچے دی گئی نسخوں (دواؤں) کی فہرست دی جائے گی۔
آپ کا کام صرف یہ ہے: دی گئی فہرست میں سے وہ 1 سے 3 دوائیں منتخب کریں جو مریض کی علامات/بیماری کو
سب سے جلد اور مؤثر طریقے سے آرام دیں گی، اور مریض کے مزاج کے مطابق بھی موزوں ہوں۔

صرف نیچے دی گئی فہرست میں سے انتخاب کریں — فہرست سے باہر کوئی دوا تجویز نہ کریں۔
ہر انتخاب کے ساتھ ایک مختصر وجہ (ایک سے دو جملے، اردو میں) بھی دیں کہ یہ دوا کیوں موزوں ہے۔

جواب صرف اس JSON شکل میں دیں، کوئی اضافی متن نہیں:
{"selections":[{"name":"دوا کا صحیح نام (فہرست سے بالکل ویسا)","reason":"مختصر وجہ اردو میں"}]}`;

    const userPrompt = `مریض کا مزاج: ${mizaj || 'نامعلوم'}${patientNumber ? ' (نمبر ' + patientNumber + ')' : ''}
علامات: ${symptomsText}
بیماریاں: ${diseasesText}

دستیاب دواؤں کی فہرست:
${limitedCandidates.map((c, i) => `${i + 1}. ${c.name} — مزاج: ${c.mizaj} — فوائد: ${c.benefit}`).join('\n')}`;

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
      return res.status(502).json({ error: 'AI کا جواب خالی تھا۔' });
    }

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      return res.status(502).json({ error: 'AI کا جواب صحیح فارمیٹ میں نہیں تھا۔' });
    }

    if (!parsed.selections || !Array.isArray(parsed.selections)) {
      return res.status(502).json({ error: 'AI کے جواب میں دوائیوں کی فہرست موجود نہیں۔' });
    }

    return res.status(200).json({ selections: parsed.selections });

  } catch (err) {
    console.error('select-nuskha error:', err);
    return res.status(500).json({ error: 'سرور میں خرابی پیش آئی۔', details: String(err && err.message ? err.message : err) });
  }
}
