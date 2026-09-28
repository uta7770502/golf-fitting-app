const responseFormat={type:'json_schema',name:'club_recognition',strict:true,schema:{type:'object',additionalProperties:false,properties:{candidates:{type:'array',maxItems:3,items:{type:'object',additionalProperties:false,properties:{brand:{type:'string'},model:{type:'string'},category:{type:'string'},year:{type:'string'},spec:{type:'string'},confidence:{type:'number'},reason:{type:'string'},sourceUrl:{type:'string'}},required:['brand','model','category','year','spec','confidence','reason','sourceUrl']}}},required:['candidates']}};
function outputText(data){if(typeof data?.output_text==='string')return data.output_text;for(const item of data?.output||[]){for(const c of item?.content||[]){if(c?.type==='output_text'&&typeof c.text==='string')return c.text}}return''}
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
        text:{format:responseFormat},
        max_output_tokens:900
      })
    });
    const data=await r.json();
    if(!r.ok) return res.status(r.status).json({error:'openai_error',detail:data?.error?.message||'request_failed'});
    const text=outputText(data).trim();
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
          text:{format:responseFormat},
          max_output_tokens:1200
        })
      });
      const wd=await wr.json();
      if(!wr.ok && !candidates.length){return res.status(wr.status).json({error:'web_search_error',detail:wd?.error?.message||'web_search_failed',code:wd?.error?.code||''})}
      if(wr.ok){
        const wt=outputText(wd).trim();
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