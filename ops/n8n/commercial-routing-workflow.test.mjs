import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const generator = path.join(here, 'commercial-routing-workflow.mjs');
const workflow = JSON.parse(execFileSync(process.execPath, [generator], { encoding: 'utf8' }));
const code = workflow[0].nodes.find(node => node.name === 'Classificar e Rotear').parameters.jsCode;

async function run(body) {
  const calls = [];
  const mockRequire = name => {
    if (name === 'fs') return { readFileSync: () => 'test-token' };
    if (name !== 'http') throw new Error(`Unexpected module: ${name}`);
    return {
      request(options, callback) {
        const request = new EventEmitter();
        let data = '';
        request.write = chunk => { data += chunk; };
        request.end = () => {
          calls.push({ path: options.path, method: options.method, body: JSON.parse(data) });
          const response = new EventEmitter();
          response.statusCode = 200;
          callback(response);
          queueMicrotask(() => response.emit('end'));
        };
        return request;
      }
    };
  };
  const execute = new AsyncFunction('$json', 'require', code);
  const result = await execute({ body }, mockRequire);
  return { result, calls };
}

function payload(content, labels = [], overrides = {}) {
  return {
    event: 'message_created', message_type: 'incoming', content, created_at: Date.now(),
    inbox: { id: 10 }, conversation: { id: 500, display_id: 500, inbox_id: 10, labels, status: 'open' },
    ...overrides
  };
}

{
  const { result, calls } = await run(payload('Olá'));
  assert.equal(result[0].json.route, 'main-menu');
  assert.ok(calls.some(call => call.path.endsWith('/labels') && call.body.labels.includes('triagem-menu-principal')));
  assert.ok(calls.some(call => call.path.endsWith('/messages') && call.body.content.includes('1️⃣ Quero comprar ou alugar')));
  assert.ok(calls.some(call => call.path.endsWith('/messages') && call.body.content.includes('digite 0 ou MENU')));
}

{
  const recovery = await run(payload('Ainda tenho interesse', [
    'enviar-kanban', 'setor-novos-negocios', 'recuperacao-ativa',
    'recuperacao-corretor-11'
  ], { sender: { id: 321 } }));
  assert.equal(recovery.result[0].json.route, 'recovery-replied');
  assert.equal(recovery.result[0].json.ownerId, 11);
  assert.ok(recovery.calls.some(call => call.path.endsWith('/labels')
    && call.body.labels.includes('recuperacao-respondida')
    && !call.body.labels.includes('recuperacao-ativa')));
  assert.ok(recovery.calls.some(call => call.path.endsWith('/assignments')
    && call.body.assignee_id === 11));
  assert.ok(recovery.calls.some(call => call.path.endsWith('/contacts/321')
    && call.method === 'PATCH'
    && call.body.custom_attributes.pipeline_01_etapas === 'Em contato'));
  assert.ok(!recovery.calls.some(call => call.path.endsWith('/messages')));
}

{
  const { result, calls } = await run(payload('1', ['triagem-menu-principal']));
  assert.equal(result[0].json.route, 'new-business-menu');
  assert.ok(calls.some(call => call.path.endsWith('/labels') && call.body.labels.includes('triagem-novos-negocios')));
  assert.ok(!calls.some(call => call.path.endsWith('/labels') && call.body.labels.includes('enviar-kanban')));
  assert.ok(!calls.some(call => call.path.endsWith('/assignments') && [9, 10, 11, 12, 13].includes(call.body.assignee_id)));

  const box = await run(payload('2', ['triagem-menu-principal', 'triagem-novos-negocios']));
  assert.equal(box.result[0].json.route, 'assunto-espaco-box');
  assert.ok(box.calls.some(call => call.path.endsWith('/labels') && call.body.labels.includes('enviar-kanban')
    && call.body.labels.includes('setor-novos-negocios') && call.body.labels.includes('assunto-espaco-box')));
  assert.ok(box.calls.some(call => call.path.endsWith('/assignments') && [9, 10, 11, 12, 13].includes(call.body.assignee_id)));
  assert.ok(box.calls.some(call => call.path.endsWith('/messages') && call.body.content.includes('Você procura um box')));

  const kiosk = await run(payload('3', ['triagem-menu-principal', 'triagem-novos-negocios']));
  assert.equal(kiosk.result[0].json.route, 'assunto-espaco-quiosque');
  assert.ok(kiosk.calls.some(call => call.path.endsWith('/assignments') && call.body.assignee_id === 20));
  assert.ok(!kiosk.calls.some(call => call.path.endsWith('/assignments') && [9, 10, 11, 12, 13].includes(call.body.assignee_id)));

  const actionSpace = await run(payload('4', ['triagem-menu-principal', 'triagem-novos-negocios']));
  assert.equal(actionSpace.result[0].json.route, 'assunto-espaco-acao-exposicao');
  assert.ok(actionSpace.calls.some(call => call.path.endsWith('/assignments') && call.body.assignee_id === 20));
}

{
  const existing = await run(payload('2', ['triagem-menu-principal', 'enviar-kanban', 'setor-novos-negocios']));
  assert.equal(existing.result[0].json.route, 'assunto-espaco-box');
  assert.equal(existing.result[0].json.compatibility, true);
  assert.ok(existing.calls.some(call => call.path.endsWith('/labels') && call.body.labels.includes('assunto-espaco-box')));
  assert.ok(!existing.calls.some(call => call.path.endsWith('/assignments')));

  const existingKiosk = await run(payload('3', ['triagem-menu-principal', 'enviar-kanban', 'setor-novos-negocios']));
  assert.equal(existingKiosk.result[0].json.compatibility, true);
  assert.ok(existingKiosk.calls.some(call => call.path.endsWith('/assignments') && call.body.assignee_id === 20));
}

{
  const base = ['triagem-menu-principal', 'enviar-kanban', 'setor-novos-negocios',
    'assunto-espaco-box', 'qualificacao-incompleta'];
  const modality = await run(payload('1', [...base, 'triagem-qual-modalidade']));
  assert.equal(modality.result[0].json.route, 'qual-modalidade-locacao');
  assert.ok(modality.calls.some(call => call.path.endsWith('/labels')
    && call.body.labels.includes('qual-modalidade-locacao')
    && call.body.labels.includes('triagem-qual-orcamento')));

  const budget = await run(payload('2', [...base, 'qual-modalidade-locacao', 'triagem-qual-orcamento']));
  assert.equal(budget.result[0].json.route, 'qualification-budget');
  assert.ok(budget.calls.some(call => call.path.endsWith('/labels')
    && call.body.labels.includes('qual-orcamento-compativel')
    && call.body.labels.includes('triagem-qual-prazo')));

  const timeline = await run(payload('1', [...base, 'qual-modalidade-locacao',
    'qual-orcamento-compativel', 'triagem-qual-prazo']));
  assert.equal(timeline.result[0].json.route, 'qual-prazo-imediato');

  const decision = await run(payload('1', [...base, 'qual-modalidade-locacao',
    'qual-orcamento-compativel', 'qual-prazo-imediato', 'triagem-qual-decisao']));
  assert.equal(decision.result[0].json.route, 'qual-decisao-responsavel');

  const business = await run(payload('1', [...base, 'qual-modalidade-locacao',
    'qual-orcamento-compativel', 'qual-prazo-imediato', 'qual-decisao-responsavel',
    'triagem-qual-negocio']));
  assert.equal(business.result[0].json.route, 'qual-negocio-ativo');

  const complete = await run(payload('Loja Teste, moda feminina, 4 m²', [...base,
    'qual-modalidade-locacao', 'qual-orcamento-compativel', 'qual-prazo-imediato',
    'qual-decisao-responsavel', 'qual-negocio-ativo', 'triagem-qual-dados']));
  assert.equal(complete.result[0].json.route, 'qualification-complete');
  assert.equal(complete.result[0].json.score, 90);
  assert.equal(complete.result[0].json.temperature, 'lead-quente');
  const finalLabels = complete.calls.find(call => call.path.endsWith('/labels')).body.labels;
  assert.ok(finalLabels.includes('qualificacao-concluida'));
  assert.ok(finalLabels.includes('lead-quente'));
  assert.ok(!finalLabels.includes('qualificacao-incompleta'));
}

{
  const cold = await run(payload('Ainda planejando', [
    'enviar-kanban', 'setor-novos-negocios', 'assunto-espaco-loja',
    'qualificacao-incompleta', 'qual-modalidade-cdu', 'qual-orcamento-incompativel',
    'qual-prazo-pesquisa', 'qual-decisao-terceiro', 'qual-negocio-planejando',
    'triagem-qual-dados'
  ]));
  assert.equal(cold.result[0].json.score, 15);
  assert.equal(cold.result[0].json.temperature, 'lead-frio');
}

{
  const actionBudget = await run(payload('1', [
    'enviar-kanban', 'setor-novos-negocios', 'assunto-espaco-acao-exposicao',
    'qualificacao-incompleta', 'triagem-qual-modalidade'
  ]));
  assert.ok(actionBudget.calls.some(call => call.path.endsWith('/labels')
    && call.body.labels.includes('triagem-qual-orcamento-livre')));
  const actionTimeline = await run(payload('R$ 5.000', [
    'enviar-kanban', 'setor-novos-negocios', 'assunto-espaco-acao-exposicao',
    'qualificacao-incompleta', 'qual-modalidade-locacao', 'triagem-qual-orcamento-livre'
  ]));
  assert.ok(actionTimeline.calls.some(call => call.path.endsWith('/labels')
    && call.body.labels.includes('qual-orcamento-validar')
    && call.body.labels.includes('triagem-qual-prazo')));
}

{
  const reminder = await run(payload('Olá', ['triagem-menu-principal', 'enviar-kanban', 'setor-novos-negocios', 'assunto-espaco-box']));
  assert.equal(reminder.result[0].json.route, 'broker-waiting-reminder');
  assert.ok(reminder.calls.some(call => call.path.endsWith('/labels') && call.body.labels.includes('triagem-lembrete-enviado')));
  assert.ok(reminder.calls.some(call => call.path.endsWith('/messages') && call.body.content.includes('já foi encaminhado')));

  const repeated = await run(payload('Oi', ['triagem-menu-principal', 'enviar-kanban', 'setor-novos-negocios', 'assunto-espaco-box', 'triagem-lembrete-enviado']));
  assert.deepEqual(repeated.result, []);
  assert.deepEqual(repeated.calls, []);
}

{
  const reopened = await run(payload('menu', ['triagem-menu-principal', 'enviar-kanban', 'setor-novos-negocios', 'assunto-espaco-box', 'cliente-vip']));
  assert.equal(reopened.result[0].json.route, 'new-subject-menu');
  const labels = reopened.calls.find(call => call.path.endsWith('/labels')).body.labels;
  assert.deepEqual(labels.sort(), ['cliente-vip', 'enviar-kanban', 'triagem-menu-principal', 'triagem-novo-assunto'].sort());
  assert.ok(reopened.calls.some(call => call.path.endsWith('/messages') && call.body.content.includes('card comercial existente serão preservados')));

  const hotel = await run(payload('5', ['cliente-vip', 'enviar-kanban', 'triagem-menu-principal', 'triagem-novo-assunto']));
  assert.equal(hotel.result[0].json.route, 'hotel');
  const hotelLabels = hotel.calls.find(call => call.path.endsWith('/labels')).body.labels;
  assert.ok(hotelLabels.includes('enviar-kanban'));
  assert.ok(hotelLabels.includes('setor-hotel'));
  assert.ok(!hotelLabels.includes('triagem-novo-assunto'));
  assert.ok(hotel.calls.some(call => call.path.endsWith('/assignments') && call.body.team_id === 3));
}

{
  const { result } = await run(payload('2', ['triagem-menu-principal']));
  assert.equal(result[0].json.route, 'tenant-menu');
  const finance = await run(payload('2', ['triagem-menu-principal', 'triagem-lojista']));
  assert.equal(finance.result[0].json.route, 'setor-financeiro');
  assert.ok(finance.calls.some(call => call.path.endsWith('/assignments') && call.body.assignee_id === 14));

  const ceop = await run(payload('7', ['triagem-menu-principal', 'triagem-lojista']));
  assert.equal(ceop.result[0].json.route, 'setor-ceop');
  assert.ok(ceop.calls.some(call => call.path.endsWith('/assignments') && call.body.team_id === 5));
  assert.ok(!ceop.calls.some(call => call.path.endsWith('/assignments') && call.body.assignee_id === 7));
}

{
  const empreendedor = await run(payload('Olá', [], {
    inbox: { id: 6 },
    conversation: { id: 600, display_id: 600, inbox_id: 6, labels: [], status: 'open' }
  }));
  assert.equal(empreendedor.result[0].json.route, 'cf-empreendedor-emily');
  assert.ok(empreendedor.calls.some(call => call.path.endsWith('/labels')
    && call.body.labels.includes('assunto-relacionamento-lojistas')));
  assert.ok(empreendedor.calls.some(call => call.path.endsWith('/assignments')
    && call.body.assignee_id === 7));
  assert.ok(!empreendedor.calls.some(call => call.path.endsWith('/messages')));
}

{
  const marketing = await run(payload('4', ['triagem-menu-principal']));
  assert.equal(marketing.result[0].json.route, 'marketing-menu');
  assert.ok(marketing.calls.some(call => call.path.endsWith('/assignments') && call.body.team_id === 1));
  const action = await run(payload('3', ['triagem-menu-principal', 'triagem-marketing']));
  assert.equal(action.result[0].json.route, 'assunto-acoes-promocionais');

  const relationship = await run(payload('6', ['triagem-menu-principal', 'triagem-marketing']));
  assert.equal(relationship.result[0].json.route, 'assunto-relacionamento-lojistas');
  assert.ok(relationship.calls.some(call => call.path.endsWith('/assignments')
    && call.body.assignee_id === 7));
  assert.ok(!relationship.calls.some(call => call.path.endsWith('/assignments')
    && call.body.team_id === 1));
}

{
  const { result, calls } = await run(payload('5', ['triagem-menu-principal']));
  assert.equal(result[0].json.route, 'hotel');
  assert.ok(calls.some(call => call.path.endsWith('/assignments') && call.body.team_id === 3));
}

{
  const resolved = payload('', ['triagem-menu-principal', 'setor-financeiro', 'cliente-vip'], {
    event: 'conversation_status_changed', message_type: '', conversation: {
      id: 500, display_id: 500, inbox_id: 10,
      labels: ['triagem-menu-principal', 'setor-financeiro', 'cliente-vip'], status: 'resolved'
    }
  });
  const { result, calls } = await run(resolved);
  assert.equal(result[0].json.route, 'reset');
  assert.deepEqual(calls.find(call => call.path.endsWith('/labels')).body.labels, ['cliente-vip']);
}

console.log('commercial routing tests: ok');
