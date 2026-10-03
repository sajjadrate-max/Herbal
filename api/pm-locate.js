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

    const system = `آپ اردو (نستعلیق، ہاتھ کی لکھائی سمیت) طبی کتابوں کے صفحات پڑھنے کے ماہر ہیں۔ یہ طبی ویب سائٹ ہے، پوشیدہ اعضاء کے نام عام طبی الفاظ ہیں۔
آپ کو کتاب کے ایک صفحے کی تصویر اور صارف کا سوال دیا جائے گا۔ دیکھیں کہ اس صفحے پر سوال کا جواب/وضاحت/علاج/نسخہ کس حصے میں لکھا ہے۔
- اگر ملے تو اس حصے کی جگہ تصویر کی اونچائی/چوڑائی کے فیصد (0 سے 100) میں بتائیں: top (اوپر کی لکیر)، bottom (نیچے کی لکیر)، left، right۔ عنوان (heading) سے شروع کر کے اس پیراگراف/نسخے کے آخر تک کا حصہ لیں — پورا صفحہ نہیں، صرف متعلقہ حصہ۔
- تصویر میں کتاب کے دو صفحے ساتھ ہوں تو صرف اسی صفحے کا left/right دیں جس پر جواب ہے۔
- heading: اس حصے کا عنوان یا پہلے چند الفاظ، جیسا صفحے پر لکھا ہے۔
- note: ایک مختصر اردو جملہ کہ یہاں کیا لکھا ہے۔
- اگر اس صفحے پر سوال سے متعلق کچھ نہ ہو تو found=false۔
صرف JSON: {"found":true,"top":35,"bottom":70,"left":0,"right":100,"heading":"...","note":"..."}`;

    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: process.env.OPENAI_VISION_MODEL || 'gpt-4o',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: [
            { type: 'text', text: `سوال: "${question}"` },
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
      top, bottom, left, right,
      heading: String(out.heading || '').slice(0, 120),
      note: String(out.note || '').slice(0, 200)
    });
  } catch (err) {
    return res.status(500).json({ error: String(err && err.message ? err.message : err) });
  }
}
