const routingCode = String.raw`
const payload = $json.body || $json;
if (payload.event !== 'message_created') return [];
if (String(payload.message_type).toLowerCase() !== 'incoming') return [];
const inboxId = Number(payload.inbox?.id || payload.conversation?.inbox_id || 0);
if (inboxId !== 10) return [];

const conversationId = Number(payload.conversation?.display_id || payload.conversation?.id || 0);
const raw = String(payload.content || '').trim();
if (!conversationId || !raw) return [];
const customerText = raw.split(/\n{3,}\*\*/)[0].trim();
const normalize = value => value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
const text = normalize(customerText);
const consumer = /\b(onde vende|onde encontro|procuro|comprar roupa|comprar produto|vestido|calcado|tenis|bolsa|moda infantil|moda feminina|moda masculina|qual loja|loja que vende|categoria de loja)\b/.test(text);
const commercial = text === '1' || /\b(alugar|aluguel|locacao|locar|adquirir|abrir (uma )?loja|montar (uma )?loja|quero (uma )?(loja|box|quiosque)|valor (do |de )?(aluguel|box|loja|quiosque)|tamanho(s)? (de |do )?(box|loja|quiosque)|box disponivel|loja disponivel|quiosque|ponto comercial|espaco comercial)\b/.test(text);
const assisted = text === '2' || text === '3' || consumer;
const route = commercial && !consumer ? 'commercial' : assisted ? 'assistant' : 'menu';

const token = process.env.CHATWOOT_BOT_TOKEN;
if (!token) throw new Error('CHATWOOT_BOT_TOKEN unavailable');
const http = require('http');
function request(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({ hostname: 'chatwoot.business.svc.cluster.local', port: 3000, path, method: 'POST', headers: {
      api_access_token: token, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data)
    }}, res => { let response = ''; res.on('data', chunk => response += chunk); res.on('end', () => {
      if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error('Chatwoot ' + res.statusCode + ': ' + response.slice(0, 200)));
      resolve(response);
    }); });
    req.on('error', reject); req.write(data); req.end();
  });
}
const base = '/api/v1/accounts/1/conversations/' + conversationId;
let reply;
if (route === 'commercial') {
  const existingLabels = (payload.conversation?.labels || [])
    .map(label => typeof label === 'string' ? label : label?.title)
    .filter(Boolean);
  await request(base + '/labels', { labels: [...new Set([...existingLabels, 'enviar-kanban'])] });
  const brokers = [9, 10, 11, 12, 13];
  await request(base + '/assignments', { assignee_id: brokers[conversationId % brokers.length] });
  reply = 'Identificamos seu interesse em ter um espaço no Centro Fashion. 🏪\n\nPara agilizar o atendimento, informe o tipo de espaço desejado (loja, box ou quiosque), seu segmento e o tamanho aproximado. Um corretor dará continuidade por aqui.';
} else {
  await request(base + '/assignments', { assignee_id: 14 });
  reply = route === 'assistant'
    ? 'Entendi! Sua solicitação é sobre lojas, produtos ou outras informações do Centro Fashion. Encaminhei a conversa para a Marilisy, que dará continuidade por aqui.'
    : 'Olá! Para direcionarmos corretamente, responda com uma opção:\n\n1️⃣ Quero alugar ou adquirir loja, box, quiosque ou outro espaço\n2️⃣ Procuro uma loja, produto ou categoria de moda\n3️⃣ Outros assuntos';
}
await request(base + '/messages', { content: reply, message_type: 'outgoing', private: false });
return [{ json: { conversationId, route } }];
`;

const workflow = [{
  id: 'cfCommercialRouting001',
  name: 'Centro Fashion - Triagem WhatsApp Comercial',
  active: false,
  nodes: [
    { id: 'commercial-webhook', name: 'Webhook Chatwoot Comercial', type: 'n8n-nodes-base.webhook', typeVersion: 2.1,
      webhookId: 'ea879f3d-9346-4fb5-a68e-42d89a5bea49', position: [0, 0],
      parameters: { httpMethod: 'POST', path: 'chatwoot-comercial-routing', options: {} } },
    { id: 'commercial-router', name: 'Classificar e Rotear', type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [260, 0], parameters: { jsCode: routingCode } }
  ],
  connections: { 'Webhook Chatwoot Comercial': { main: [[{ node: 'Classificar e Rotear', type: 'main', index: 0 }]] } },
  settings: { executionOrder: 'v1' }, pinData: {}, tags: []
}];

process.stdout.write(JSON.stringify(workflow, null, 2));
