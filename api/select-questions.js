// Vercel Serverless Function
// Route: POST /api/select-questions
//
// اس فائل کا مقصد: مریض کی لکھی گئی مکمل تکلیف (فری ٹیکسٹ) پڑھ کر
// دی گئی اختیاری تشخیصی سوالات کی فہرست میں سے صرف وہی سوال منتخب
// کرنا جو اس مخصوص تکلیف کے لیے واقعی مفید/متعلقہ ہوں — تاکہ مریض کو
// غیر ضروری سوالات نہ پوچھے جائیں۔ نیز، تکلیف کے متن سے میل کھانے
// والی بیماریاں بھی خودکار طور پر شناخت کی جاتی ہیں (matchedDiseaseNames)۔
//
// دوسرا استعمال: جب مریض خود دستی طور پر (مینوئل نظام میں) کوئی
// بیماری/بیماریاں منتخب کرے، تو اسی وقت انہی منتخب بیماریوں کے
// مطابق اضافی متعلقہ سوالات تجویز کیے جاتے ہیں (selectedDiseases)،
// مگر جو سوال مریض پہلے ہی جواب دے چکا ہو (excludeIds) وہ دوبارہ
// کبھی تجویز نہیں کیا جاتا۔
//
// اہم: OPENAI_API_KEY کبھی بھی کلائنٹ (براؤزر) کوڈ میں نہیں لکھنی —
// یہ صرف Vercel کے Environment Variables میں محفوظ رہنی چاہیے۔

const CORE_FALLBACK_IDS = ['weakness', 'face_color', 'pulse'];

function stripHtml(s) {
  return String(s || '').replace(/<[^>]+>/g, '').trim();
}

// عمر پہلے ہی متن میں بیان ہو تو "age" سوال دوبارہ نہ پوچھا جائے (deterministic safety net)
const AGE_STATED_RE = /\d[\d\s,،\-٫]*\s*(سال|برس|ماہ|مہینے)/;
// اگر تکلیف کے متن میں "درد" کا کوئی ذکر ہی نہ ہو تو درد کے وقت/حالت والے سوالات نہ پوچھے جائیں
const PAIN_MENTIONED_RE = /درد|تکلیف دہ|دکھ(تا|تی|نے)/;
const PAIN_TIMING_IDS = ['joint_time', 'joint_position'];

function applyDeterministicSafetyNets(relevantIds, complaintText) {
  let ids = Array.isArray(relevantIds) ? relevantIds.slice() : [];
  const text = complaintText || '';
  if (AGE_STATED_RE.test(text)) {
    ids = ids.filter(id => id !== 'age');
  }
  if (!PAIN_MENTIONED_RE.test(text)) {
    ids = ids.filter(id => !PAIN_TIMING_IDS.includes(id));
  }
  return ids;
}

async function callOpenAI(apiKey, systemPrompt, userPrompt) {
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
    const err = new Error('OpenAI API سے جواب نہیں ملا۔');
    err.status = 502;
    err.details = errBody;
    throw err;
  }

  const data = await openaiRes.json();
  const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!content) {
    const err = new Error('جواب خالی تھا۔');
    err.status = 502;
    throw err;
  }

  try {
    return JSON.parse(content);
  } catch (e) {
    const err = new Error('جواب صحیح فارمیٹ میں نہیں تھا۔');
    err.status = 502;
    throw err;
  }
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
    const complaint = typeof body.complaint === 'string' ? body.complaint.trim() : '';
    const allDiseaseNames = Array.isArray(body.diseases) ? body.diseases : [];
    const selectedDiseases = Array.isArray(body.selectedDiseases) ? body.selectedDiseases.filter(Boolean) : [];
    const excludeIds = new Set(Array.isArray(body.excludeIds) ? body.excludeIds : []);
    let questions = Array.isArray(body.questions) ? body.questions : [];

    // جو سوال پہلے ہی جواب دیا جا چکا ہے اسے فہرست سے ہی نکال دیں — دوبارہ کبھی تجویز نہیں ہوگا
    questions = questions.filter(q => q && q.id && !excludeIds.has(q.id));

    if (!complaint && selectedDiseases.length === 0) {
      return res.status(400).json({ error: 'کوئی تکلیف کا متن (complaint) یا منتخب بیماریاں (selectedDiseases) فراہم نہیں کی گئیں۔' });
    }
    if (questions.length === 0) {
      // کوئی سوال باقی ہی نہیں بچا (سب جواب دیے جا چکے) — خالی نتیجہ واپس بھیج دیں
      return res.status(200).json({ relevantIds: [], matchedDiseaseNames: [] });
    }

    const questionList = questions.map(q => `- id="${q.id}" — ${stripHtml(q.title)}`).join('\n');

    let relevantIds = [];
    let matchedDiseaseNames = [];

    // ---------- موڈ 1: مریض کی مکمل تکلیف کے متن سے سوال + بیماریاں دونوں طے کریں ----------
    if (complaint) {
      const diseaseList = allDiseaseNames.length ? allDiseaseNames.join('، ') : '(کوئی فہرست فراہم نہیں کی گئی)';
      const systemPrompt = `آپ ایک تجربہ کار معالج ہیں جو مریض کی مکمل تکلیف پڑھ کر دو کام کرتے ہیں:
1) نیچے دی گئی بیماریوں کی فہرست میں سے وہی بیماریاں شناخت کریں جن کا مریض نے واضح طور پر ذکر کیا ہو۔
2) نیچے دی گئی اختیاری تشخیصی سوالات کی فہرست میں سے صرف وہی سوال منتخب کریں جو مریض کی بیان کردہ تکلیف سے حقیقی طور پر متعلقہ ہوں اور جن کا جواب علاج/تشخیص میں واقعی فرق پیدا کرے گا۔

اہم اصول:
- جو معلومات مریض پہلے ہی اپنی تحریر میں دے چکا ہو (مثلاً عمر) وہ سوال دوبارہ ہرگز منتخب نہ کریں۔
- درد کے وقت/حالت والے سوالات صرف اسی صورت منتخب کریں جب مریض نے واضح طور پر "درد" کا ذکر کیا ہو۔
- اگر مریض کی تکلیف بہت عمومی/مختصر ہو تو صرف 3-5 بنیادی عمومی سوال منتخب کریں (جیسے مریض کو کیسا محسوس ہوتا ہے، چہرے کا رنگ، نبض)۔
- غیر متعلقہ سوالات ہرگز منتخب نہ کریں۔ زیادہ سے زیادہ 8 سوال منتخب کریں (صفر بھی ہو سکتے ہیں اگر تکلیف بالکل واضح ہو)۔
- بیماریوں میں سے صرف وہی شامل کریں جن کا صریح ذکر ہو، اندازے سے کوئی بیماری شامل نہ کریں۔

جواب صرف اس JSON شکل میں دیں، کوئی اضافی متن نہیں:
{"relevantIds":["id1","id2"], "matchedDiseaseNames":["بیماری کا نام 1"]}`;

      const userPrompt = `مریض کی مکمل تکلیف: ${complaint}

دستیاب بیماریوں کی فہرست: ${diseaseList}

دستیاب اختیاری سوالات:
${questionList}`;

      const parsed = await callOpenAI(apiKey, systemPrompt, userPrompt);
      relevantIds = applyDeterministicSafetyNets(Array.isArray(parsed.relevantIds) ? parsed.relevantIds : [], complaint);
      matchedDiseaseNames = Array.isArray(parsed.matchedDiseaseNames) ? parsed.matchedDiseaseNames : [];

      // اگر نہ کوئی بیماری ملی نہ کوئی سوال منتخب ہوا تو بنیادی سوالات دکھا دیں تاکہ تشخیص رک نہ جائے
      if (relevantIds.length === 0 && matchedDiseaseNames.length === 0) {
        relevantIds = questions.map(q => q.id).filter(id => CORE_FALLBACK_IDS.includes(id));
        if (relevantIds.length === 0) {
          relevantIds = questions.slice(0, 3).map(q => q.id);
        }
      }
    }

    // ---------- موڈ 2: مریض نے خود دستی طور پر بیماری/بیماریاں منتخب کی ہیں — اسی کے مطابق اضافی سوال تجویز کریں ----------
    if (selectedDiseases.length > 0) {
      const remainingQuestions = questions.filter(q => !relevantIds.includes(q.id));
      if (remainingQuestions.length > 0) {
        const remainingList = remainingQuestions.map(q => `- id="${q.id}" — ${stripHtml(q.title)}`).join('\n');
        const systemPrompt = `آپ ایک تجربہ کار معالج ہیں۔ مریض نے نیچے دی گئی بیماری/بیماریاں خود منتخب کی ہیں۔ نیچے دی گئی اختیاری تشخیصی سوالات کی فہرست میں سے صرف وہی سوال منتخب کریں جو ان بیماریوں کی درست تشخیص/علاج کے لیے واقعی مفید ہوں۔

اہم اصول:
- جو سوال فہرست میں موجود ہی نہیں (کیونکہ مریض پہلے ہی جواب دے چکا ہے) اسے منتخب کرنے کا سوال ہی پیدا نہیں ہوتا — صرف نیچے دی گئی فہرست میں سے چنیں۔
- درد کے وقت/حالت والے سوالات صرف اسی صورت منتخب کریں جب یہ بیماری عموماً درد سے متعلق ہو۔
- غیر متعلقہ سوالات ہرگز منتخب نہ کریں۔ زیادہ سے زیادہ 6 سوال منتخب کریں، صفر بھی ہو سکتے ہیں اگر مزید کسی سوال کی ضرورت نہ ہو۔

جواب صرف اس JSON شکل میں دیں، کوئی اضافی متن نہیں:
{"relevantIds":["id1","id2"]}`;

        const userPrompt = `مریض نے یہ بیماری/بیماریاں منتخب کی ہیں: ${selectedDiseases.join('، ')}

دستیاب اختیاری سوالات (جو ابھی تک جواب نہیں دیے گئے):
${remainingList}`;

        const parsed2 = await callOpenAI(apiKey, systemPrompt, userPrompt);
        const extraIds = Array.isArray(parsed2.relevantIds) ? parsed2.relevantIds : [];
        extraIds.forEach(id => {
          if (!relevantIds.includes(id) && !excludeIds.has(id)) relevantIds.push(id);
        });
      }
    }

    // آخری حفاظتی قدم: جو سوال پہلے ہی جواب دیا جا چکا ہے وہ کسی بھی صورت دوبارہ تجویز نہ ہو
    relevantIds = relevantIds.filter(id => !excludeIds.has(id));

    return res.status(200).json({ relevantIds, matchedDiseaseNames });

  } catch (err) {
    console.error('select-questions error:', err);
    const status = err && err.status ? err.status : 500;
    return res.status(status).json({ error: err && err.message ? err.message : 'سرور میں خرابی پیش آئی۔', details: err && err.details ? err.details : String(err) });
  }
}
