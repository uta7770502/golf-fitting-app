export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({error:'method_not_allowed'});
  if(!process.env.OPENAI_API_KEY) return res.status(503).json({error:'api_not_configured'});
  try{
    const {image}=req.body||{};
    if(!image||typeof image!=='string'||!image.startsWith('data:image/')) return res.status(400).json({error:'image_required'});
    const prompt = [
      'You are identifying a golf club from a photo of its head or sole.',
      'Return ONLY valid JSON, no markdown.',
      'Give up to 3 ranked candidates from most likely to least likely.',
      'For each candidate include: brand, model, category, year, spec, confidence (0-100), reason.',
      'category must be one of: ドライバー, フェアウェイウッド, ユーティリティ/HY, アイアン, ウェッジ, パター.',
      'spec should be visible/likely loft or club number such as 10.5°, 5W, 4U, 7I, 56°. Use empty string if unknown.',
      'Do not invent certainty. If text/logo/model markings are unclear, lower confidence.',
      'JSON shape: {"candidates":[{"brand":"","model":"","category":"","year":"","spec":"","confidence":0,"reason":""}]}'
    ].join('\n');
    const r = await fetch('https://api.openai.com/v1/responses',{
      method:'POST',
      headers:{'Authorization':'Bearer '+process.env.OPENAI_API_KEY,'Content-Type':'application/json'},
      body:JSON.stringify({
        model:'gpt-5.6-luna',
        input:[{role:'user',content:[
          {type:'input_text',text:prompt},
          {type:'input_image',image_url:image}
        ]}],
        max_output_tokens:900
      })
    });
    const data=await r.json();
    if(!r.ok) return res.status(r.status).json({error:'openai_error',detail:data?.error?.message||'request_failed'});
    const text=(data.output_text||data.output?.flatMap?.(x=>x.content||[]).find?.(x=>x.type==='output_text')?.text||'').trim();
    let parsed;
    try{ parsed=JSON.parse(text); }
    catch(e){
      const m=text.match(/\{[\s\S]*\}/);
      if(!m) throw new Error('invalid_model_json');
      parsed=JSON.parse(m[0]);
    }
    const candidates=Array.isArray(parsed.candidates)?parsed.candidates.slice(0,3):[];
    return res.status(200).json({candidates});
  }catch(e){
    return res.status(500).json({error:'recognition_failed',detail:e.message});
  }
}