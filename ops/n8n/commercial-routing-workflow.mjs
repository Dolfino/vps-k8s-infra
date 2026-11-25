const routingCode = String.raw`
const payload = $json.body || $json;
const event = String(payload.event || '');
const inboxId = Number(payload.inbox?.id || payload.conversation?.inbox_id || 0);
if (inboxId !== 10) return [];

const conversationId = Number(payload.conversation?.display_id || payload.conversation?.id || 0);
if (!conversationId) return [];
const existingLabels = (payload.conversation?.labels || [])
  .map(label => typeof label === 'string' ? label : label?.title).filter(Boolean);
const isIncomingMessage = event === 'message_created' && String(payload.message_type).toLowerCase() === 'incoming';
const conversationStatus = String(payload.conversation?.status || payload.status || '').toLowerCase();
const isResolvedConversation = event === 'conversation_status_changed' && conversationStatus === 'resolved';
if (!isIncomingMessage && !isResolvedConversation) return [];

const fs = require('fs');
const token = fs.readFileSync('/run/secrets/chatwoot/token', 'utf8').trim();
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
const routingPrefixes = ['triagem-', 'setor-', 'assunto-'];
const isRoutingLabel = label => label === 'enviar-kanban' || routingPrefixes.some(prefix => label.startsWith(prefix));
if (isResolvedConversation) {
  const remainingLabels = existingLabels.filter(label => !isRoutingLabel(label));
  if (remainingLabels.length !== existingLabels.length) await request(base + '/labels', { labels: remainingLabels });
  return [{ json: { conversationId, route: 'reset' } }];
}

const raw = String(payload.content || '').trim();
if (!raw) return [];
const customerText = raw.split(/\n{3,}\*\*/)[0].trim();
const normalize = value => value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
const text = normalize(customerText);
const numericChoice = (text.match(/^\s*(\d{1,2})\s*[.)-]?\s*$/) || [])[1] || '';
const labels = new Set(existingLabels);
const addLabels = async (...newLabels) => {
  newLabels.filter(Boolean).forEach(label => labels.add(label));
  await request(base + '/labels', { labels: [...labels] });
};
const completeLabels = async (...newLabels) => {
  newLabels.filter(Boolean).forEach(label => labels.add(label));
  labels.delete('triagem-novo-assunto');
  await request(base + '/labels', { labels: [...labels] });
};
const assignAgent = assigneeId => request(base + '/assignments', { team_id: 2, assignee_id: assigneeId });
const assignTeam = teamId => request(base + '/assignments', { team_id: teamId });
const send = content => request(base + '/messages', { content, message_type: 'outgoing', private: false });

const mainMenu = 'Olá! 👋 Seja bem-vindo(a) ao atendimento do Centro Fashion Fortaleza.\n\n' +
  'Para direcionarmos sua solicitação ao setor responsável, escolha uma opção:\n\n' +
  '1️⃣ Quero comprar ou alugar um espaço\n' +
  '2️⃣ Já sou lojista e preciso de atendimento\n' +
  '3️⃣ Procuro uma loja, produto ou categoria\n' +
  '4️⃣ Marketing, divulgação e ações no empreendimento\n' +
  '5️⃣ Hotel Centro Fashion\n' +
  '6️⃣ Outros assuntos\n\nDigite apenas o número da opção desejada.\n\n' +
  'A qualquer momento, digite 0 ou MENU para escolher outro assunto.';
const tenantMenu = 'Certo! Qual assunto você deseja resolver?\n\n' +
  '1️⃣ Contratos\n2️⃣ Financeiro, boletos de CDU ou manutenção\n3️⃣ Renegociação financeira\n' +
  '4️⃣ Troca de titularidade ou migração\n5️⃣ Repasse ou pós-venda\n6️⃣ Distrato\n' +
  '7️⃣ CEOP e autorizações operacionais\n8️⃣ Outro assunto relacionado à loja\n\nDigite apenas o número da opção desejada.';
const catalogMenu = 'O que você procura?\n\n' +
  '1️⃣ Encontrar uma loja\n2️⃣ Encontrar um produto\n3️⃣ Encontrar uma categoria ou segmento\n' +
  '4️⃣ Consultar o catálogo de lojas\n5️⃣ Horários e localização\n\nDigite apenas o número da opção desejada.';
const marketingMenu = 'Qual assunto de Marketing você deseja tratar?\n\n' +
  '1️⃣ Mídia paga e exposição de marca\n2️⃣ Divulgação e campanhas\n3️⃣ Autorização para ações promocionais\n' +
  '4️⃣ Divulgação de inauguração\n5️⃣ Parcerias e eventos\n6️⃣ Relacionamento com lojistas\n' +
  '7️⃣ Outro assunto de Marketing\n\nDigite apenas o número da opção desejada.';

const newBusinessMenu = 'Ótimo! Você tem interesse em qual tipo de espaço?\n\n' +
  '1️⃣ Loja\n2️⃣ Box\n3️⃣ Quiosque\n4️⃣ Espaço para ação ou exposição\n5️⃣ Ainda não sei qual espaço preciso\n\n' +
  'Digite apenas o número da opção desejada.';
const newBusinessRoutes = {
  '1': ['assunto-espaco-loja', 'uma loja'],
  '2': ['assunto-espaco-box', 'um box'],
  '3': ['assunto-espaco-quiosque', 'um quiosque'],
  '4': ['assunto-espaco-acao-exposicao', 'um espaço para ação ou exposição'],
  '5': ['assunto-espaco-indefinido', 'ajuda para definir o espaço ideal']
};
const brokers = [9, 10, 11, 12, 13];
const finishNewBusiness = async selected => {
  await completeLabels(selected[0], 'enviar-kanban', 'setor-novos-negocios');
  await request(base + '/assignments', { team_id: 2, assignee_id: brokers[conversationId % brokers.length] });
  await send('Perfeito! Você procura ' + selected[1] + '.\n\nPara concluir, informe seu nome, o nome da empresa ou loja, seu segmento e o tamanho aproximado desejado. Sua solicitação já foi encaminhada a um corretor, que continuará por aqui.');
};

const menuCommand = /^(0|menu|novo assunto|outro assunto)$/.test(text);
if (menuCommand) {
  const preservedLabels = existingLabels.filter(label => !isRoutingLabel(label));
  if (existingLabels.includes('enviar-kanban')) preservedLabels.push('enviar-kanban');
  preservedLabels.push('triagem-menu-principal', 'triagem-novo-assunto');
  await request(base + '/labels', { labels: [...new Set(preservedLabels)] });
  await send('Vamos iniciar um atendimento sobre outro assunto. O histórico e o card comercial existente serão preservados.\n\n' + mainMenu);
  return [{ json: { conversationId, route: 'new-subject-menu' } }];
}

const hasTerminalRoute = existingLabels.some(label => label === 'enviar-kanban' || label.startsWith('setor-') || label.startsWith('assunto-'));
const hasNewBusinessRoute = existingLabels.includes('enviar-kanban') && existingLabels.includes('setor-novos-negocios');
const hasSpaceSubtype = existingLabels.some(label => label.startsWith('assunto-espaco-'));
if (hasNewBusinessRoute && !hasSpaceSubtype) {
  const selected = newBusinessRoutes[numericChoice];
  if (!selected) {
    await send('Para concluir o encaminhamento, digite um número de 1 a 5.\n\n' + newBusinessMenu);
    return [{ json: { conversationId, route: 'invalid-new-business-option' } }];
  }
  await addLabels(selected[0]);
  await send('Perfeito! Você procura ' + selected[1] + '.\n\nPara concluir, informe seu nome, o nome da empresa ou loja, seu segmento e o tamanho aproximado desejado. Sua solicitação já está com um corretor, que continuará por aqui.');
  return [{ json: { conversationId, route: selected[0], compatibility: true } }];
}
const greeting = /^(ola|oi|bom dia|boa tarde|boa noite)[!. ]*$/.test(text);
if (hasNewBusinessRoute && hasSpaceSubtype && greeting && !existingLabels.includes('triagem-lembrete-enviado')) {
  await addLabels('triagem-lembrete-enviado');
  await send('Seu atendimento já foi encaminhado ao Comercial. Um corretor continuará a conversa por aqui.');
  return [{ json: { conversationId, route: 'broker-waiting-reminder' } }];
}
if (hasTerminalRoute && !existingLabels.includes('triagem-novo-assunto')) return [];
const state = existingLabels.includes('triagem-lojista') ? 'tenant' :
  existingLabels.includes('triagem-catalogo') ? 'catalog' :
  existingLabels.includes('triagem-marketing') ? 'marketing' :
  existingLabels.includes('triagem-novos-negocios') ? 'new-business' :
  existingLabels.includes('triagem-menu-principal') ? 'main' : 'new';

if (state === 'new') {
  await addLabels('triagem-menu-principal');
  await assignAgent(14);
  await send(mainMenu);
  return [{ json: { conversationId, route: 'main-menu' } }];
}

if (state === 'main') {
  if (numericChoice === '1') {
    await addLabels('triagem-novos-negocios');
    await assignAgent(14);
    await send(newBusinessMenu);
    return [{ json: { conversationId, route: 'new-business-menu' } }];
  }
  if (numericChoice === '2') {
    await addLabels('triagem-lojista'); await assignAgent(14); await send(tenantMenu);
    return [{ json: { conversationId, route: 'tenant-menu' } }];
  }
  if (numericChoice === '3') {
    await addLabels('triagem-catalogo'); await assignAgent(14); await send(catalogMenu);
    return [{ json: { conversationId, route: 'catalog-menu' } }];
  }
  if (numericChoice === '4') {
    await addLabels('triagem-marketing'); await assignTeam(1); await send(marketingMenu);
    return [{ json: { conversationId, route: 'marketing-menu' } }];
  }
  if (numericChoice === '5') {
    await completeLabels('setor-hotel'); await assignTeam(3);
    await send('Você será direcionado ao atendimento do Hotel Centro Fashion. 🏨\n\nPara agilizar, informe seu nome, a data prevista de entrada e a quantidade de hóspedes. A equipe do Hotel dará continuidade por aqui.');
    return [{ json: { conversationId, route: 'hotel' } }];
  }
  if (numericChoice === '6') {
    await completeLabels('setor-outros-assuntos'); await assignAgent(14);
    await send('Certo! Descreva resumidamente como podemos ajudar. Nossa equipe fará a triagem e encaminhará sua solicitação ao setor responsável.');
    return [{ json: { conversationId, route: 'other' } }];
  }
  await send('Não consegui identificar essa opção. Por favor, digite um número de 1 a 6.\n\n' + mainMenu);
  return [{ json: { conversationId, route: 'invalid-main-option' } }];
}

if (state === 'new-business') {
  const selected = newBusinessRoutes[numericChoice];
  if (!selected) {
    await send('Não consegui identificar essa opção. Por favor, digite um número de 1 a 5.\n\n' + newBusinessMenu);
    return [{ json: { conversationId, route: 'invalid-new-business-option' } }];
  }
  await finishNewBusiness(selected);
  return [{ json: { conversationId, route: selected[0] } }];
}

if (state === 'tenant') {
  const routes = {
    '1': ['setor-contratos', 'Contratos'], '2': ['setor-financeiro', 'Financeiro, boletos de CDU ou manutenção'],
    '3': ['setor-renegociacao', 'Renegociação financeira'], '4': ['setor-titularidade-migracao', 'Troca de titularidade ou migração'],
    '5': ['setor-repasse-pos-venda', 'Repasse ou pós-venda'], '6': ['setor-distrato', 'Distrato'],
    '7': ['setor-ceop', 'CEOP e autorizações operacionais'], '8': ['setor-lojista-outros', 'Outro assunto relacionado à loja']
  };
  const selected = routes[numericChoice];
  if (!selected) {
    await send('Não consegui identificar essa opção. Por favor, digite um número de 1 a 8.\n\n' + tenantMenu);
    return [{ json: { conversationId, route: 'invalid-tenant-option' } }];
  }
  await completeLabels(selected[0]); await assignAgent(14);
  await send('Entendi! Sua solicitação sobre ' + selected[1] + ' foi registrada.\n\nInforme seu nome, o nome da loja e o número do box ou loja, se souber. A equipe comercial fará o encaminhamento ao setor responsável.');
  return [{ json: { conversationId, route: selected[0] } }];
}

if (state === 'catalog') {
  const routes = {
    '1': ['assunto-encontrar-loja', 'encontrar uma loja'], '2': ['assunto-encontrar-produto', 'encontrar um produto'],
    '3': ['assunto-categoria-segmento', 'encontrar uma categoria ou segmento'], '4': ['assunto-catalogo-lojas', 'consultar o catálogo de lojas'],
    '5': ['assunto-horarios-localizacao', 'horários e localização']
  };
  const selected = routes[numericChoice];
  if (!selected) {
    await send('Não consegui identificar essa opção. Por favor, digite um número de 1 a 5.\n\n' + catalogMenu);
    return [{ json: { conversationId, route: 'invalid-catalog-option' } }];
  }
  await completeLabels(selected[0]); await assignAgent(14);
  await send('Certo! Você deseja ' + selected[1] + '. Descreva o que procura e nossa equipe de relacionamento dará continuidade por aqui.');
  return [{ json: { conversationId, route: selected[0] } }];
}

if (state === 'marketing') {
  const routes = {
    '1': ['assunto-midia-paga', 'mídia paga e exposição de marca'], '2': ['assunto-divulgacao-campanhas', 'divulgação e campanhas'],
    '3': ['assunto-acoes-promocionais', 'autorização para ações promocionais'], '4': ['assunto-inauguracao', 'divulgação de inauguração'],
    '5': ['assunto-parcerias-eventos', 'parcerias e eventos'], '6': ['assunto-relacionamento-lojistas', 'relacionamento com lojistas'],
    '7': ['assunto-marketing-outros', 'outro assunto de Marketing']
  };
  const selected = routes[numericChoice];
  if (!selected) {
    await send('Não consegui identificar essa opção. Por favor, digite um número de 1 a 7.\n\n' + marketingMenu);
    return [{ json: { conversationId, route: 'invalid-marketing-option' } }];
  }
  await completeLabels(selected[0]); await assignTeam(1);
  await send('Entendi! Sua solicitação sobre ' + selected[1] + ' foi encaminhada à equipe de Marketing. Descreva os detalhes para continuarmos o atendimento.');
  return [{ json: { conversationId, route: selected[0] } }];
}
return [];
`;

const workflow = [{
  id: 'cfCommercialRouting001', name: 'Centro Fashion - Triagem WhatsApp Comercial', active: true,
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
