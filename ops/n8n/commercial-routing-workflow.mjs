const routingCode = String.raw`
const payload = $json.body || $json;
const event = String(payload.event || '');
const inboxId = Number(payload.inbox?.id || payload.conversation?.inbox_id || 0);
if (inboxId !== 10) return [];

const conversationId = Number(payload.conversation?.display_id || payload.conversation?.id || 0);
if (!conversationId) return [];
const contactId = Number(payload.sender?.id || payload.conversation?.meta?.sender?.id || 0);
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
function request(path, body, method = 'POST') {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({ hostname: 'chatwoot.business.svc.cluster.local', port: 3000, path, method, headers: {
      api_access_token: token, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data)
    }}, res => { let response = ''; res.on('data', chunk => response += chunk); res.on('end', () => {
      if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error('Chatwoot ' + res.statusCode + ': ' + response.slice(0, 200)));
      resolve(response);
    }); });
    req.on('error', reject); req.write(data); req.end();
  });
}
const base = '/api/v1/accounts/1/conversations/' + conversationId;
const routingPrefixes = ['triagem-', 'setor-', 'assunto-', 'qual-', 'qualificacao-', 'lead-'];
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
const qualificationSteps = [
  'triagem-qual-modalidade', 'triagem-qual-orcamento', 'triagem-qual-orcamento-livre',
  'triagem-qual-prazo', 'triagem-qual-decisao', 'triagem-qual-negocio', 'triagem-qual-dados'
];
const setQualificationStep = async (nextStep, ...answerLabels) => {
  qualificationSteps.forEach(label => labels.delete(label));
  answerLabels.filter(Boolean).forEach(label => labels.add(label));
  if (nextStep) labels.add(nextStep);
  await request(base + '/labels', { labels: [...labels] });
};
const assignAgent = assigneeId => request(base + '/assignments', { team_id: 2, assignee_id: assigneeId });
const assignTeam = teamId => request(base + '/assignments', { team_id: teamId });
const send = content => request(base + '/messages', { content, message_type: 'outgoing', private: false });

if (isIncomingMessage && existingLabels.includes('recuperacao-ativa')) {
  const ownerLabel = existingLabels.find(label => label.startsWith('recuperacao-corretor-')) || '';
  const ownerId = Number(ownerLabel.replace('recuperacao-corretor-', '')) || 0;
  const recoveryLabels = existingLabels.filter(label =>
    label !== 'recuperacao-ativa'
    && label !== 'recuperacao-respondida'
    && !label.startsWith('recuperacao-corretor-'));
  recoveryLabels.push('recuperacao-respondida');
  await request(base + '/labels', { labels: [...new Set(recoveryLabels)] });
  if (ownerId) await assignAgent(ownerId);
  if (contactId) {
    await request('/api/v1/accounts/1/contacts/' + contactId, {
      custom_attributes: { pipeline_01_etapas: 'Em contato' }
    }, 'PATCH');
  }
  return [{ json: { conversationId, contactId, route: 'recovery-replied', ownerId } }];
}

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
  '3': ['assunto-espaco-quiosque', 'um quiosque', 20],
  '4': ['assunto-espaco-acao-exposicao', 'um espaço para ação ou exposição', 20],
  '5': ['assunto-espaco-indefinido', 'ajuda para definir o espaço ideal']
};
const modalityMenu = 'Para entendermos a melhor condição, qual modalidade você procura?\n\n' +
  '1️⃣ Somente locação\n2️⃣ Aquisição do CDU\n3️⃣ Quero conhecer as duas possibilidades\n' +
  '4️⃣ Ainda não sei\n\nDigite apenas o número da opção desejada.';
const timelineMenu = 'Quando você pretende iniciar?\n\n' +
  '1️⃣ Imediatamente\n2️⃣ Em até 30 dias\n3️⃣ Entre 1 e 3 meses\n' +
  '4️⃣ Mais de 3 meses\n5️⃣ Estou apenas pesquisando\n\nDigite apenas o número da opção desejada.';
const decisionMenu = 'Qual é sua participação na decisão?\n\n' +
  '1️⃣ Sou responsável pela decisão\n2️⃣ Decido com outra pessoa\n' +
  '3️⃣ Estou pesquisando para outra pessoa\n\nDigite apenas o número da opção desejada.';
const businessMenu = 'Em qual situação seu negócio está?\n\n' +
  '1️⃣ Já possuo loja ou empresa funcionando\n2️⃣ Estou iniciando um novo negócio\n' +
  '3️⃣ Ainda estou planejando\n\nDigite apenas o número da opção desejada.';
const cduBudgetMenu = 'Qual faixa de valor você considera disponível para o sinal do CDU?\n\n' +
  '1️⃣ Até R$ 5 mil\n2️⃣ De R$ 5 mil a R$ 10 mil\n3️⃣ De R$ 10 mil a R$ 20 mil\n' +
  '4️⃣ De R$ 20 mil a R$ 40 mil\n5️⃣ Acima de R$ 40 mil\n6️⃣ Preciso conhecer as condições\n\n' +
  'O valor semanal é cumulativo ao CDU e às parcelas. Digite apenas o número da opção.';
const rentalBudgetMenus = {
  'assunto-espaco-box': 'Qual faixa de investimento semanal você considera para o Box?\n\n1️⃣ Até R$ 300\n2️⃣ De R$ 301 a R$ 600\n3️⃣ De R$ 601 a R$ 900\n4️⃣ De R$ 901 a R$ 1.200\n5️⃣ Preciso analisar\n\nDigite apenas o número da opção.',
  'assunto-espaco-loja': 'Qual faixa de investimento semanal você considera para a Loja?\n\n1️⃣ Até R$ 400\n2️⃣ De R$ 401 a R$ 700\n3️⃣ De R$ 701 a R$ 1.200\n4️⃣ De R$ 1.201 a R$ 2.000\n5️⃣ De R$ 2.001 a R$ 3.500\n6️⃣ Acima de R$ 3.500 ou preciso analisar\n\nDigite apenas o número da opção.',
  'assunto-espaco-quiosque': 'Qual faixa de investimento semanal você considera para o Quiosque?\n\n1️⃣ Até R$ 399\n2️⃣ De R$ 400 a R$ 500\n3️⃣ De R$ 501 a R$ 600\n4️⃣ Acima de R$ 600\n5️⃣ Preciso analisar\n\nDigite apenas o número da opção.',
  'assunto-espaco-indefinido': 'Qual faixa de investimento semanal você considera?\n\n1️⃣ Até R$ 300\n2️⃣ De R$ 301 a R$ 700\n3️⃣ De R$ 701 a R$ 1.200\n4️⃣ De R$ 1.201 a R$ 2.000\n5️⃣ Acima de R$ 2.000\n6️⃣ Preciso analisar\n\nDigite apenas o número da opção.'
};
const currentSpace = () => [...labels].find(label => label.startsWith('assunto-espaco-')) || '';
const currentModality = () => [...labels].find(label => label.startsWith('qual-modalidade-')) || '';
const budgetAssessment = (space, modality, choice) => {
  const lastChoice = (modality === 'qual-modalidade-locacao' && ['assunto-espaco-box', 'assunto-espaco-quiosque'].includes(space)) ? '5' : '6';
  if (choice === lastChoice) return 'qual-orcamento-validar';
  if (modality !== 'qual-modalidade-locacao' && choice === '1' && ['assunto-espaco-loja', 'assunto-espaco-quiosque'].includes(space)) return 'qual-orcamento-incompativel';
  if (modality === 'qual-modalidade-locacao' && choice === '1' && ['assunto-espaco-loja', 'assunto-espaco-quiosque'].includes(space)) return 'qual-orcamento-incompativel';
  return 'qual-orcamento-compativel';
};
const qualificationScore = () => {
  let score = labels.has('qual-orcamento-compativel') ? 25 : labels.has('qual-orcamento-validar') ? 5 : 0;
  if (labels.has('qual-prazo-imediato') || labels.has('qual-prazo-30d')) score += 25;
  else if (labels.has('qual-prazo-1a3m')) score += 15;
  else if (labels.has('qual-prazo-mais3m')) score += 5;
  if (labels.has('qual-decisao-responsavel')) score += 15;
  else if (labels.has('qual-decisao-conjunta')) score += 10;
  if (labels.has('qual-negocio-ativo')) score += 15;
  else if (labels.has('qual-negocio-iniciando')) score += 10;
  else if (labels.has('qual-negocio-planejando')) score += 5;
  if (labels.has('qual-dados-informados')) score += 10;
  return score;
};
const finishQualification = async () => {
  labels.add('qual-dados-informados');
  qualificationSteps.forEach(label => labels.delete(label));
  labels.delete('qualificacao-incompleta');
  ['lead-quente', 'lead-morno', 'lead-frio'].forEach(label => labels.delete(label));
  const score = qualificationScore();
  const temperature = score >= 70 ? 'lead-quente' : score >= 40 ? 'lead-morno' : 'lead-frio';
  labels.add('qualificacao-concluida');
  labels.add(temperature);
  await request(base + '/labels', { labels: [...labels] });
  await send('Obrigado! Sua qualificação foi concluída e as informações foram encaminhadas ao responsável. O atendimento continuará por aqui.\n\nA qualquer momento, digite 0 ou MENU para tratar de outro assunto.');
  return { score, temperature };
};
const brokers = [9, 10, 11, 12, 13];
const finishNewBusiness = async selected => {
  await completeLabels(selected[0], 'enviar-kanban', 'setor-novos-negocios', 'qualificacao-incompleta', 'triagem-qual-modalidade');
  const assigneeId = selected[2] || brokers[conversationId % brokers.length];
  await assignAgent(assigneeId);
  await send('Perfeito! Você procura ' + selected[1] + '. Sua solicitação já foi encaminhada ao responsável.\n\n' + modalityMenu);
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

const qualificationStep = qualificationSteps.find(label => existingLabels.includes(label));
if (qualificationStep === 'triagem-qual-modalidade') {
  const routes = {
    '1': 'qual-modalidade-locacao', '2': 'qual-modalidade-cdu',
    '3': 'qual-modalidade-ambas', '4': 'qual-modalidade-indefinida'
  };
  const modality = routes[numericChoice];
  if (!modality) {
    await send('Não consegui identificar essa opção.\n\n' + modalityMenu);
    return [{ json: { conversationId, route: 'invalid-qualification-modality' } }];
  }
  const space = currentSpace();
  if (modality === 'qual-modalidade-indefinida') {
    await setQualificationStep('triagem-qual-prazo', modality, 'qual-orcamento-validar');
    await send(timelineMenu);
    return [{ json: { conversationId, route: modality } }];
  }
  if (space === 'assunto-espaco-acao-exposicao') {
    await setQualificationStep('triagem-qual-orcamento-livre', modality);
    await send('Qual é o orçamento estimado para a ação ou exposição? Você pode informar um valor aproximado ou responder “a definir”.');
    return [{ json: { conversationId, route: modality } }];
  }
  await setQualificationStep('triagem-qual-orcamento', modality);
  await send(modality === 'qual-modalidade-locacao' ? (rentalBudgetMenus[space] || rentalBudgetMenus['assunto-espaco-indefinido']) : cduBudgetMenu);
  return [{ json: { conversationId, route: modality } }];
}

if (qualificationStep === 'triagem-qual-orcamento-livre') {
  await setQualificationStep('triagem-qual-prazo', 'qual-orcamento-validar');
  await send(timelineMenu);
  return [{ json: { conversationId, route: 'qualification-free-budget' } }];
}

if (qualificationStep === 'triagem-qual-orcamento') {
  const space = currentSpace();
  const modality = currentModality();
  const maxChoice = modality === 'qual-modalidade-locacao'
    ? (['assunto-espaco-box', 'assunto-espaco-quiosque'].includes(space) ? 5 : 6)
    : 6;
  const choice = Number(numericChoice);
  if (!choice || choice > maxChoice) {
    await send('Não consegui identificar essa opção.\n\n' + (modality === 'qual-modalidade-locacao' ? (rentalBudgetMenus[space] || rentalBudgetMenus['assunto-espaco-indefinido']) : cduBudgetMenu));
    return [{ json: { conversationId, route: 'invalid-qualification-budget' } }];
  }
  await setQualificationStep('triagem-qual-prazo', budgetAssessment(space, modality, numericChoice));
  await send(timelineMenu);
  return [{ json: { conversationId, route: 'qualification-budget' } }];
}

if (qualificationStep === 'triagem-qual-prazo') {
  const routes = {
    '1': 'qual-prazo-imediato', '2': 'qual-prazo-30d', '3': 'qual-prazo-1a3m',
    '4': 'qual-prazo-mais3m', '5': 'qual-prazo-pesquisa'
  };
  if (!routes[numericChoice]) {
    await send('Não consegui identificar essa opção.\n\n' + timelineMenu);
    return [{ json: { conversationId, route: 'invalid-qualification-timeline' } }];
  }
  await setQualificationStep('triagem-qual-decisao', routes[numericChoice]);
  await send(decisionMenu);
  return [{ json: { conversationId, route: routes[numericChoice] } }];
}

if (qualificationStep === 'triagem-qual-decisao') {
  const routes = { '1': 'qual-decisao-responsavel', '2': 'qual-decisao-conjunta', '3': 'qual-decisao-terceiro' };
  if (!routes[numericChoice]) {
    await send('Não consegui identificar essa opção.\n\n' + decisionMenu);
    return [{ json: { conversationId, route: 'invalid-qualification-decision' } }];
  }
  await setQualificationStep('triagem-qual-negocio', routes[numericChoice]);
  await send(businessMenu);
  return [{ json: { conversationId, route: routes[numericChoice] } }];
}

if (qualificationStep === 'triagem-qual-negocio') {
  const routes = { '1': 'qual-negocio-ativo', '2': 'qual-negocio-iniciando', '3': 'qual-negocio-planejando' };
  if (!routes[numericChoice]) {
    await send('Não consegui identificar essa opção.\n\n' + businessMenu);
    return [{ json: { conversationId, route: 'invalid-qualification-business' } }];
  }
  await setQualificationStep('triagem-qual-dados', routes[numericChoice]);
  await send('Para concluir, informe em uma única mensagem:\n\n• Seu nome\n• Nome da empresa ou loja, se houver\n• Segmento de atuação\n• Tamanho aproximado desejado');
  return [{ json: { conversationId, route: routes[numericChoice] } }];
}

if (qualificationStep === 'triagem-qual-dados') {
  const result = await finishQualification();
  return [{ json: { conversationId, route: 'qualification-complete', ...result } }];
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
  await addLabels(selected[0], 'qualificacao-incompleta', 'triagem-qual-modalidade');
  if (selected[2]) await assignAgent(selected[2]);
  await send('Perfeito! Você procura ' + selected[1] + '. Sua solicitação já está com o responsável.\n\n' + modalityMenu);
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
