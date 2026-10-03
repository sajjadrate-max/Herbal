// Vercel Serverless Function
// Route: POST /api/pm-locate
//
// کتاب کا کھلا ہوا صفحہ (تصویر) اور صارف کا سوال لے کر AI (vision) بتاتا ہے کہ اس صفحے پر
// سوال کی وضاحت/جواب کس جگہ لکھا ہے — تاکہ سائٹ وہاں پیلی نشانی لگا سکے۔
// درخواست: { question, image: "data:image/jpeg;base64,..." }
// جواب: { found, top, bottom, left, right, heading, note }   (top/bottom/left/right = تصویر کا % 0-100)
//
// اہم: OPENAI_API_KEY صرف Vercel کے Environment Variables میں — کبھی براؤزر کوڈ میں نہیں۔
// تصویر پڑھنے کا ماڈل بدلنا ہو تو Vercel میں OPENAI_VISION_MODEL سیٹ کریں (پہلے سے gpt-4o)۔

export const config = { api: { bodyParser: { sizeLimit: '4mb' } } };

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
    const image = String(body.image || '');
    if (!question || !/^data:image\/(jpeg|png|webp);base64,/.test(image)) {
      return res.status(400).json({ error: 'سوال یا تصویر موجود نہیں۔' });
    }
    if (image.length > 3_800_000) return res.status(413).json({ error: 'تصویر بہت بڑی ہے۔' });

    const topic = String(body.topic || '').trim().slice(0, 200);
    const hint = String(body.hint || '').trim().slice(0, 200);
    const keywords = (Array.isArray(body.keywords) ? body.keywords : []).map(x => String(x || '').trim()).filter(Boolean).slice(0, 12);

    const system = `آپ اردو (نستعلیق، ہاتھ کی لکھائی سمیت) طبی کتابوں کے صفحات پڑھنے کے ماہر ہیں۔ یہ طبی ویب سائٹ ہے، پوشیدہ اعضاء کے نام عام طبی الفاظ ہیں۔
آپ کو کتاب کے ایک صفحے کی تصویر، صارف کا سوال، اور اس موضوع کے پہچان والے الفاظ دیے جائیں گے۔ صفحہ غور سے پڑھیں — ہر عنوان (موٹا لکھا ہوا) اور اس کے نیچے کا متن۔
سخت اصول:
1) صرف وہ حصہ چنیں جس کا عنوان یا متن بالکل اسی سوال کے خاص پہلو کے بارے میں ہو۔ مثال: سوال "عضو تناسل کا چھوٹا ہونا" ہو تو صرف وہ حصہ جس میں لمبا/موٹا/دراز/فربہ کرنا یا چھوٹا پن/لاغری لکھا ہو — "طاقت باہ"، "سختی"، "امساک"، "ٹیڑھا پن" والے دوسرے نسخے غلط ہیں، چاہے وہ اسی عضو کے بارے میں ہوں۔
2) اگر ایسا حصہ اس صفحے پر نہ ہو تو found=false دیں — قریب ترین یا ملتا جلتا حصہ ہرگز نہ چنیں۔
3) اگر کسی موضوع کا صرف آخری حصہ (پچھلے صفحے سے جاری) اوپر ہو اور وہ اسی سوال کا ہو، تو وہ حصہ چن سکتے ہیں۔
4) جگہ تصویر کی اونچائی/چوڑائی کے فیصد (0 سے 100) میں: top = اس حصے کے عنوان کی اوپر والی لکیر، bottom = اس حصے کے آخری جملے کی نیچے والی لکیر، left/right = اسی کالم/صفحے کی حد۔ تصویر میں دو صفحے ساتھ ہوں تو صرف متعلقہ صفحے کا left/right۔
5) heading: اس حصے کا عنوان بالکل ویسا جیسا صفحے پر لکھا ہے۔ note: ایک مختصر اردو جملہ کہ یہاں کیا لکھا ہے۔
6) confidence: 0 سے 100 کہ آپ کو کتنا یقین ہے کہ یہ حصہ واقعی اسی سوال کا جواب ہے۔
صرف JSON: {"found":true,"confidence":90,"top":35,"bottom":70,"left":0,"right":100,"heading":"...","note":"..."}`;

    const userText = `سوال: "${question}"` +
      (topic ? `\nسوال کا مطلب: ${topic}` : '') +
      (hint ? `\nکتاب کی فہرست کے مطابق یہاں یہ موضوع ہونا چاہیے: ${hint}` : '') +
      (keywords.length ? `\nاس موضوع کے پہچان والے الفاظ: ${keywords.join('، ')}` : '');

    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: process.env.OPENAI_VISION_MODEL || 'gpt-4o',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: [
            { type: 'text', text: userText },
            { type: 'image_url', image_url: { url: image, detail: 'high' } }
          ] }
        ],
        temperature: 0,
        response_format: { type: 'json_object' }
      })
    });
    if (!r.ok) return res.status(502).json({ error: 'OpenAI API سے جواب نہیں ملا۔', details: (await r.text().catch(() => '')).slice(0, 300) });
    const data = await r.json();
    const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    let out = {};
    try { out = JSON.parse(content || '{}'); } catch (e) { out = {}; }
    const pct = (v, d) => { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : d; };
    let top = pct(out.top, 0), bottom = pct(out.bottom, 100), left = pct(out.left, 0), right = pct(out.right, 100);
    if (bottom < top) [top, bottom] = [bottom, top];
    if (right < left) [left, right] = [right, left];
    if (bottom - top < 4) bottom = Math.min(100, top + 8);
    if (right - left < 20) { left = 0; right = 100; }
    return res.status(200).json({
      found: !!out.found,
      confidence: Math.max(0, Math.min(100, parseInt(out.confidence, 10) || (out.found ? 70 : 0))),
      top, bottom, left, right,
      heading: String(out.heading || '').slice(0, 120),
      note: String(out.note || '').slice(0, 200)
    });
  } catch (err) {
    return res.status(500).json({ error: String(err && err.message ? err.message : err) });
  }
}
