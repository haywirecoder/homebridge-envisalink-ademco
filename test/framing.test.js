// The TPI arrives as a TCP stream, so one 'data' event can hold part of a
// line, or several lines. These drive the real data handler with a fake socket.
const test = require('node:test');
const assert = require('node:assert');
const net = require('net');
const EventEmitter = require('events');
const EnvisaLink = require('../envisalink.js');

function session() {
  const socket = new EventEmitter();
  socket.destroyed = false;
  socket.written = [];
  socket.write = (s) => { socket.written.push(s); return true; };
  socket.end = socket.destroy = () => { socket.destroyed = true; };
  const createConnection = net.createConnection;
  net.createConnection = () => socket;

  const warnings = [];
  const log = { info() {}, debug() {}, error() {}, warn: (m) => { if (m.includes('format invalid')) warnings.push(m); } };
  const alarm = new EnvisaLink(log, {
    host: 'evl', password: 'pw', proxyEnabled: true, sessionWatcher: false,
    autoReconnect: false, heartbeatInterval: 30, openZoneTimeout: 30,
  });
  const forwarded = [];
  const fakeServer = { isRunning: () => true, restart: async () => {}, start: async () => {}, stop() {} };
  alarm.tpiproxyServer = { ...fakeServer, writeToClients: (d) => forwarded.push(d.toString()) };
  alarm.wcForwardServer = { ...fakeServer };
  const partitions = [];
  alarm.on('updatepartition', (p) => partitions.push(p));
  alarm.startSession();
  net.createConnection = createConnection;

  const send = async (s) => {
    socket.emit('data', Buffer.from(s));
    await new Promise((resolve) => setImmediate(resolve));
  };
  return { alarm, send, warnings, forwarded, partitions };
}

const READY = '%02,0100000000000000$';
const NOT_READY = '%02,0300000000000000$';

// A partition message updates every partition it lists; count them from one
// message delivered whole, in one read.
async function updatesPerMessage() {
  const s = session();
  await s.send('Login:\r\nOK\r\n');
  await s.send(READY + '\r\n');
  return s.partitions.length;
}

test('a message split across two reads is parsed once, not dropped', async () => {
  const s = session();
  await s.send('Login:\r\nOK\r\n');
  await s.send(READY.slice(0, 9));
  await s.send(READY.slice(9) + '\r\n');
  assert.deepStrictEqual(s.warnings, []);
  assert.strictEqual(s.partitions.length, await updatesPerMessage());
  assert.deepStrictEqual(s.forwarded.join(''), READY + '\r\n');
});

test('several messages in one read are each parsed and forwarded once', async () => {
  const s = session();
  await s.send('Login:\r\nOK\r\n');
  await s.send(`${READY}\r\n${NOT_READY}\r\n${READY}\r\n`);
  assert.deepStrictEqual(s.warnings, []);
  assert.strictEqual(s.partitions.length, 3 * await updatesPerMessage());
  assert.deepStrictEqual(s.forwarded.join(''), `${READY}\r\n${NOT_READY}\r\n${READY}\r\n`);
});

test('the login exchange still works and is not forwarded', async () => {
  const s = session();
  await s.send('Login:\r\n');
  assert.ok(s.alarm.isConnected);
  await s.send('OK\r\n');
  assert.deepStrictEqual(s.forwarded, []);
});
