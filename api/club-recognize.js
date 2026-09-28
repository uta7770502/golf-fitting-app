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
    let candidates=Array.isArray(parsed.candidates)?parsed.candidates.slice(0,3):[];
    let usedWebSearch=false;
    const topConfidence=candidates.length?Number(candidates[0].confidence)||0:0;
    if(!candidates.length||topConfidence<70){
      const webPrompt=[
        'Identify this golf club from the photo and use web search when needed.',
        'Search the web for exact matches to visible logos, model names, sole markings, loft markings, and head shape.',
        'Prioritize official manufacturer pages, reputable retailers, archived product pages, and trustworthy golf media.',
        'Return ONLY valid JSON, no markdown.',
        'Give up to 3 ranked candidates.',
        'For each include: brand, model, category, year, spec, confidence (0-100), reason, sourceUrl.',
        'category must be one of: ドライバー, フェアウェイウッド, ユーティリティ/HY, アイアン, ウェッジ, パター.',
        'If uncertain, say so with a lower confidence score.',
        'JSON shape: {"candidates":[{"brand":"","model":"","category":"","year":"","spec":"","confidence":0,"reason":"","sourceUrl":""}]}'
      ].join('\n');
      const wr=await fetch('https://api.openai.com/v1/responses',{
        method:'POST',
        headers:{'Authorization':'Bearer '+process.env.OPENAI_API_KEY,'Content-Type':'application/json'},
        body:JSON.stringify({
          model:'gpt-5.6-luna',
          tools:[{type:'web_search'}],
          input:[{role:'user',content:[
            {type:'input_text',text:webPrompt},
            {type:'input_image',image_url:image}
          ]}],
          max_output_tokens:1200
        })
      });
      const wd=await wr.json();
      if(wr.ok){
        const wt=(wd.output_text||wd.output?.flatMap?.(x=>x.content||[]).find?.(x=>x.type==='output_text')?.text||'').trim();
        try{
          const wp=JSON.parse(wt);
          if(Array.isArray(wp.candidates)&&wp.candidates.length){
            candidates=wp.candidates.slice(0,3);
            usedWebSearch=true;
          }
        }catch(e){
          const mm=wt.match(/\{[\s\S]*\}/);
          if(mm){
            try{
              const wp=JSON.parse(mm[0]);
              if(Array.isArray(wp.candidates)&&wp.candidates.length){
                candidates=wp.candidates.slice(0,3);
                usedWebSearch=true;
              }
            }catch(_){}
          }
        }
      }
    }
    return res.status(200).json({candidates,usedWebSearch});
  }catch(e){
    return res.status(500).json({error:'recognition_failed',detail:e.message});
  }
}