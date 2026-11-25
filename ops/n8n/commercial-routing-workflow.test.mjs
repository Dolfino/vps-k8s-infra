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
          calls.push({ path: options.path, body: JSON.parse(data) });
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
}

{
  const existing = await run(payload('2', ['triagem-menu-principal', 'enviar-kanban', 'setor-novos-negocios']));
  assert.equal(existing.result[0].json.route, 'assunto-espaco-box');
  assert.equal(existing.result[0].json.compatibility, true);
  assert.ok(existing.calls.some(call => call.path.endsWith('/labels') && call.body.labels.includes('assunto-espaco-box')));
  assert.ok(!existing.calls.some(call => call.path.endsWith('/assignments')));
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
}

{
  const marketing = await run(payload('4', ['triagem-menu-principal']));
  assert.equal(marketing.result[0].json.route, 'marketing-menu');
  assert.ok(marketing.calls.some(call => call.path.endsWith('/assignments') && call.body.team_id === 1));
  const action = await run(payload('3', ['triagem-menu-principal', 'triagem-marketing']));
  assert.equal(action.result[0].json.route, 'assunto-acoes-promocionais');
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
