const assert = require('assert');
const fs = require('fs');
const path = require('path');
const writev = require('.');

const helloWorld = [Buffer.from('hello '), Buffer.from('world'), Buffer.from('\n')];

const dir = fs.mkdtempSync('/tmp/fast-writev-');
const filename = path.join(dir, 'out.txt');

const fd = fs.openSync(filename, 'w');

writev(fd, helloWorld, () => {
  fs.closeSync(fd);
  const results = fs.readFileSync(filename, { encoding: 'utf8' });
  assert.strictEqual(results, 'hello world\n');
  fs.unlinkSync(filename);
  fs.rmdirSync(dir);
});
