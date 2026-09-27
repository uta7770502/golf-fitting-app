export default async function handler(req,res){
  res.setHeader('Cache-Control','s-maxage=3600, stale-while-revalidate=86400');
  if(req.method!=='GET') return res.status(405).json({error:'method_not_allowed'});
  const applicationId=process.env.RAKUTEN_APPLICATION_ID;
  const accessKey=process.env.RAKUTEN_ACCESS_KEY;
  const affiliateId=process.env.RAKUTEN_AFFILIATE_ID||'';
  if(!applicationId||!accessKey) return res.status(503).json({error:'api_not_configured'});
  const q=String(req.query.q||'').trim();
  if(q.length<2) return res.status(400).json({error:'query_required'});
  const u=new URL('https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701');
  u.searchParams.set('applicationId',applicationId);
  u.searchParams.set('accessKey',accessKey);
  u.searchParams.set('keyword',q.slice(0,120));
  u.searchParams.set('format','json');
  u.searchParams.set('hits','12');
  u.searchParams.set('imageFlag','1');
  u.searchParams.set('carrier','2');
  if(affiliateId)u.searchParams.set('affiliateId',affiliateId);
  try{
    const r=await fetch(u,{headers:{'Accept':'application/json'}});
    const data=await r.json().catch(()=>({}));
    if(!r.ok)return res.status(r.status).json({error:data.error||'rakuten_error',message:data.error_description||''});
    const raw=data.Items||data.items||[];
    const rows=raw.map(x=>x.Item||x.item||x).filter(Boolean);
    const seen=new Set(),items=[];
    for(const it of rows){
      const imgs=it.mediumImageUrls||it.smallImageUrls||[];
      for(const im of imgs){
        const url=typeof im==='string'?im:(im.imageUrl||im.url||'');
        if(!url||seen.has(url))continue;
        seen.add(url);
        items.push({imageUrl:url,itemName:it.itemName||'',itemUrl:it.itemUrl||it.affiliateUrl||'',source:'Rakuten'});
        break;
      }
      if(items.length>=6)break;
    }
    return res.status(200).json({query:q,items});
  }catch(e){
    return res.status(502).json({error:'upstream_failed'});
  }
}