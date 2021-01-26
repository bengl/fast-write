const pitesti = require('pitesti');
const assert = require('assert');
const fs = require('fs');
const net = require('net');
const path = require('path');
const writev = require('.');

const helloWorld = [Buffer.from('hello '), Buffer.from('world'), Buffer.from('\n')];
const goodbyeWorld = [Buffer.from('goodbye '), Buffer.from('world'), Buffer.from('\n')];

const test = pitesti();

const aWritev = (...args) => new Promise((resolve, reject) => {
  writev(...args, (err, result) => {
    if (err) reject(err);
    else resolve(result);
  })
});

test`write stuff to a file`(async () => {
  const dir = fs.mkdtempSync('/tmp/fast-writev-');
  const filename = path.join(dir, 'out.txt');
  console.log(filename)

  const fd = fs.openSync(filename, 'w');
  const result = await aWritev(fd, helloWorld);
  assert.strictEqual(result, 12);
  fs.closeSync(fd);
  const results = fs.readFileSync(filename, { encoding: 'utf8' });
  assert.strictEqual(results, 'hello world\n');
  fs.unlinkSync(filename);
  fs.rmdirSync(dir);
});

test.only`write stuff twice to a file`(async () => {
  const dir = fs.mkdtempSync('/tmp/fast-writev-');
  const filename = path.join(dir, 'out.txt');

  const fd = fs.openSync(filename, 'w');
  assert.strictEqual(await aWritev(fd, helloWorld), 12);
  assert.strictEqual(await aWritev(fd, goodbyeWorld), 14);
  const results = fs.readFileSync(filename, { encoding: 'utf8' });
  fs.closeSync(fd);
  assert.strictEqual(results, 'hello world\ngoodbye world\n');
  fs.unlinkSync(filename);
  fs.rmdirSync(dir);
});

test`write stuff in parallel to a file`(async () => {
  const dir = fs.mkdtempSync('/tmp/fast-writev-');
  const filename = path.join(dir, 'out.txt');

  const fd = fs.openSync(filename, 'w');
  const result = await Promise.all([
    aWritev(fd, goodbyeWorld),
    aWritev(fd, helloWorld),
  ]);
  assert.deepStrictEqual(result, [14, 12]);
  fs.closeSync(fd);
  const results = fs.readFileSync(filename, { encoding: 'utf8' });
  assert.strictEqual(results, 'hello world\nd\n');
  // ^ This result is interesting. It happens because the file cursor hasn't
  // moved by the time we do the second write, so both writes happen at the
  // same offset.
  fs.unlinkSync(filename);
  fs.rmdirSync(dir);
});

test`write stuff to a network socket`(done => {
  const server = net.createServer(async socket => {
    const chunks = [];
    for await (const chunk of socket) {
      chunks.push(chunk);
    }
    assert.strictEqual(
      Buffer.concat(chunks).toString('utf8'),
      'hello world\ngoodbye world\nhello world\ngoodbye world\n');
    server.close();
    done();
  }).listen(0, () => {
    const port = server.address().port;
    const socket = net.connect(port, async () => {
      await aWritev(socket._handle.fd, helloWorld, 0);
      await aWritev(socket._handle.fd, goodbyeWorld, 0);
      await Promise.all([
        aWritev(socket._handle.fd, helloWorld, 0),
        aWritev(socket._handle.fd, goodbyeWorld, 0)
      ]);
      socket.end();
    })
  });
});

test`error case`(() => {
  return assert.rejects(
    aWritev(133742, helloWorld),
    'Error: EBADF: bad file descriptor'
  );
});

test`prepareStop`(() => {
  writev.prepareStop();
});

test();
