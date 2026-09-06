const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { createAlerts } = require('./alerts');

function fixture(send = async () => {}, lookupPhone = async () => null) {
  const db = new DatabaseSync(':memory:');
  let clock = 1800000000000;
  const options = { enabled: true, send, lookupPhone, now: () => clock, logger: { log() {}, error() {} } };
  const alerts = createAlerts(db, options);
  return { db, alerts, options, advance: ms => { clock += ms; }, jobs: () => db.prepare('SELECT * FROM mail_queue').all() };
}
function event(id, body = 'hola', changes = {}) {
  return { event: 'message', session: 'negocio_cz', payload: { id, body, from: '51999999999@c.us', fromMe: false, ...changes } };
}

test('first contact, event deduplication and 30 minutes of inactivity survive recreation', () => {
  const f = fixture();
  assert.equal(f.alerts.record(event('1')), true);
  assert.equal(f.alerts.record(event('1')), false);
  f.advance(20 * 60000);
  assert.equal(f.alerts.record(event('2')), false);
  f.advance(20 * 60000);
  assert.equal(f.alerts.record(event('3')), false);
  f.advance(30 * 60000);
  const restarted = createAlerts(f.db, f.options);
  assert.equal(restarted.record(event('4')), true);
  assert.equal(f.jobs().length, 2);
  f.db.close();
});

test('ignores outgoing messages, groups, statuses and other sessions', () => {
  const f = fixture();
  for (const e of [event('1','hola',{fromMe:true}),event('2','hola',{from:'group@g.us'}),event('3','hola',{from:'status@broadcast'}),{...event('4'),session:'negocio_local'},{...event('5'),event:'session.status'}]) assert.equal(f.alerts.record(e),false);
  assert.equal(f.jobs().length,0);
  f.db.close();
});

test('advisor and order alerts bypass cooldown without mistaking category numbers for menu choices', () => {
  const f = fixture();
  f.alerts.record(event('1'));
  assert.equal(f.alerts.record(event('2','7'),'categorias'),false);
  assert.equal(f.alerts.record(event('3','7'),'principal'),true);
  assert.equal(f.alerts.record(event('4','2'),'principal'),true);
  assert.equal(f.alerts.record(event('5','dos jugos'),'esperando_pedido'),true);
  assert.equal(f.alerts.record(event('6','hola'),'esperando_pedido'),false);
  assert.equal(f.jobs().length,4);
  f.db.close();
});

test('null text and LID work without inventing a phone number', () => {
  const f = fixture();
  assert.equal(f.alerts.record(event('1',null,{from:'123456789@lid'})),true);
  assert.match(f.jobs()[0].body,/Mensaje sin texto/);
  assert.doesNotMatch(f.jobs()[0].body,/wa\.me/);
  f.db.close();
});

test('failed SMTP stays pending, retries after delay and sends only once', async () => {
  let attempts = 0;
  const f = fixture(async () => { if (++attempts === 1) throw Error('offline'); });
  f.alerts.record(event('1'));
  await f.alerts.flush();
  assert.equal(f.jobs()[0].status,'pending');
  await f.alerts.flush();
  assert.equal(attempts,1);
  f.advance(60000);
  await f.alerts.flush();
  assert.equal(f.jobs()[0].status,'sent');
  await f.alerts.flush();
  assert.equal(attempts,2);
  f.db.close();
});

test('stops retrying after eight failures and keeps the failed alert', async () => {
  const f = fixture(async () => { throw Error('offline'); });
  f.alerts.record(event('1'));
  for(let i=0;i<8;i++){await f.alerts.flush();f.advance(3600000);}
  assert.equal(f.jobs()[0].status,'failed');
  assert.equal(f.jobs()[0].attempts,8);
  f.db.close();
});

test('disabled alerts do not queue or send', async () => {
  const f = fixture();
  const alerts = createAlerts(f.db,{enabled:false,send:async()=>assert.fail('must not send')});
  assert.equal(alerts.record(event('1')),false);
  await alerts.flush();
  assert.equal(f.jobs().length,0);
  f.db.close();
});

test('resolves LID only while sending and preserves resolved phone for retries', async () => {
  let lookups = 0;
  let attempts = 0;
  const f = fixture(async message => {
    assert.match(message.body, /Numero: \+51999999999/);
    assert.match(message.body, /https:\/\/wa.me\/51999999999/);
    if (++attempts === 1) throw Error('SMTP offline');
  }, async chat => { assert.equal(chat,'123456789@lid'); lookups++; return '51999999999'; });
  f.alerts.record(event('1','hola',{from:'123456789@lid'}));
  assert.equal(lookups,0);
  await f.alerts.flush();
  f.advance(60000);
  await createAlerts(f.db,f.options).flush();
  assert.equal(lookups,1);
  assert.equal(f.jobs()[0].status,'sent');
  f.db.close();
});

test('unknown phone or lookup failure does not prevent mail delivery', async () => {
  for (const lookup of [async()=>null, async()=>{throw Error('timeout');}]) {
    const f = fixture(async message => {
      assert.match(message.body,/123456789@lid/);
      assert.doesNotMatch(message.body,/wa\.me/);
    },lookup);
    f.alerts.record(event('1',null,{from:'123456789@lid'}));
    await f.alerts.flush();
    assert.equal(f.jobs()[0].status,'sent');
    f.db.close();
  }
});

test('WAHA lookup uses negocio_cz and validates the returned mapping', async () => {
  const { resolvePhone } = require('./contact');
  for (const [data,expected] of [
    [{lid:'123@lid',pn:'51999999999@c.us'},'51999999999'],
    [{lid:'123@lid',pn:null},null],
    [{lid:'999@lid',pn:'51999999999@c.us'},null],
    [{lid:'123@lid',pn:'123@lid'},null]
  ]) {
    const result=await resolvePhone('123@lid',{fetchImpl:async(url,options)=>{
      assert.match(url,/\/api\/negocio_cz\/lids\/123%40lid$/);
      assert.ok(options.signal);
      return {ok:true,json:async()=>data};
    }});
    assert.equal(result,expected);
  }
});

test('upgrades the existing queue without losing pending emails', async () => {
  const db=new DatabaseSync(':memory:');
  db.exec("CREATE TABLE mail_queue (id INTEGER PRIMARY KEY, subject TEXT, body TEXT, status TEXT DEFAULT 'pending', attempts INTEGER DEFAULT 0, next_attempt INTEGER, created_at INTEGER); INSERT INTO mail_queue(subject,body,next_attempt,created_at) VALUES('old','original',0,0)");
  let sent=0;
  const alerts=createAlerts(db,{enabled:true,send:async m=>{assert.equal(m.body,'original');sent++;},lookupPhone:async()=>assert.fail('old records have no chat metadata'),logger:{log(){},error(){}}});
  await alerts.flush();
  assert.equal(sent,1);
  db.close();
});
