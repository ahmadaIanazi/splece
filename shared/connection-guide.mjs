// Product guidance is kept separate from model catalogs and credentials.
export const connectionGoals = [
  {id:'writing',name:'Shape a story',description:'Planning, writing and creative assistance.',lanes:['text','assistant'],providers:['deepseek','openai','openrouter','venice']},
  {id:'visuals',name:'Make images & video',description:'Characters, references and generated clips.',lanes:['image','video'],providers:['venice','fal','xai']},
  {id:'sound',name:'Add voices & sound',description:'Dialogue, ambience, effects and lip sync.',lanes:['audio'],providers:['fal']},
];
export const providerGuides = {
  xai:{summary:'Grok images and video',account:'https://console.x.ai/',credits:'https://console.x.ai/',docs:'https://docs.x.ai/developers/quickstart',billingDocs:'https://docs.x.ai/developers/pricing',
    accountText:'Sign in to xAI Console and choose your team. Splece connects to the developer API, separate from a Grok chat subscription.',
    creditText:'Open Billing in your team console, add API credits and review spending limits. Your Grok subscription does not pay for API generations.',
    keyText:'Open API keys, create a key for Splece with access to Imagine image and video models, and copy it here. Checking the connection does not generate media.'},
  deepseek:{summary:'Writing and story planning',account:'https://platform.deepseek.com/',credits:'https://platform.deepseek.com/top_up',docs:'https://api-docs.deepseek.com/',billingDocs:'https://api-docs.deepseek.com/faq/',
    accountText:'Sign in to the DeepSeek platform. This is the developer account used by Splece, separate from the chat screen.',
    creditText:'Open Top up in the platform and choose an amount you are comfortable with. Your API balance pays for writing and planning requests.',
    keyText:'Open API keys, create a key named Splece, and copy it. Return here with the complete key.'},
  openai:{summary:'Writing and creative assistance',account:'https://platform.openai.com/',credits:'https://platform.openai.com/settings/organization/billing/overview',docs:'https://help.openai.com/en/articles/4936850-where-do-i-find-my-openai-api-key',billingDocs:'https://help.openai.com/en/articles/8264644-what-is-prepaid-billing',
    accountText:'Sign in to the OpenAI API platform and choose the organization or project you want to use.',
    creditText:'Open API billing, add payment details and buy credits. Review automatic recharge before confirming. A ChatGPT subscription does not include API credit.',
    keyText:'Open API keys and create a secret key for Splece in your project. Copy it when it appears; you may only see the full key once.'},
  venice:{summary:'Images, video and optional writing',account:'https://venice.ai/',credits:'https://venice.ai/settings/api',docs:'https://docs.venice.ai/guides/getting-started/generating-api-key',billingDocs:'https://docs.venice.ai/overview/pricing',
    accountText:'Sign in to Venice, then open Settings → API. Your keys and available balance live together here.',
    creditText:'Check your API balance in Settings → API and add funding if needed. A funded account can still be restricted by the spending limit on an individual key.',
    keyText:'Choose Generate New API Key. Name it Splece, choose Inference Only, then copy the new key. Allow the spending source you intend to use.'},
  fal:{summary:'Images, video, voices and sound',account:'https://fal.ai/dashboard',credits:'https://fal.ai/dashboard/billing',docs:'https://fal.ai/docs/documentation/quickstart',billingDocs:'https://fal.ai/docs/documentation/model-apis/pricing',
    accountText:'Sign in to fal.ai and open the dashboard. Use the account or team you want to pay for your generations.',
    creditText:'Open Billing in the dashboard and purchase credits. Images, video and sound draw from the same provider balance; each generation shows an estimate in Splece.',
    keyText:'Open Keys in the dashboard, create an API key for Splece, and copy the whole key. Paste it here without adding an authorization prefix.'},
  openrouter:{summary:'A choice of writing models',account:'https://openrouter.ai/',credits:'https://openrouter.ai/settings/credits',docs:'https://openrouter.ai/docs/quickstart',billingDocs:'https://openrouter.ai/support',
    accountText:'Sign in to OpenRouter. One account can access several writing models supported by Splece.',
    creditText:'Open Credits and add a balance. Review the checkout total and any automatic top-up settings before confirming.',
    keyText:'Open Keys and create a normal API key named Splece. You can give this key a spending limit. Copy it and return here.'},
};
export function connectionQueue(goals, choices) {
  const queue=[];
  for(const goal of connectionGoals.filter(g=>goals.includes(g.id))) {
    const provider=choices[goal.id];
    if(!goal.providers.includes(provider)) continue;
    let entry=queue.find(p=>p.provider===provider);
    if(!entry) queue.push(entry={provider,lanes:[]});
    entry.lanes.push(...goal.lanes);
  }
  return queue;
}
export function connectionRoutePatch(queue, catalog, connections) {
  const patch={};
  for(const entry of queue) {
    if(!connections.some(c=>c.id===entry.provider && c.ready)) continue;
    for(const lane of entry.lanes) {
      const old=catalog.routes[lane];
      const models=catalog.models[lane].filter(m=>m.provider===entry.provider);
      const existing=old.provider===entry.provider && models.find(m=>m.id===old.model);
      const model=existing?.id || models.find(m=>/flash|mini/i.test(m.id))?.id || models[0]?.id || '';
      // Some providers cannot enable this lane until discovery returns a model.
      if(!model && (lane==='video'||['openai','openrouter'].includes(entry.provider)||(['text','assistant'].includes(lane)&&entry.provider==='venice'))) continue;
      patch[lane]={provider:entry.provider,model,enabled:true};
    }
  }
  return patch;
}
