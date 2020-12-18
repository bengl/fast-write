const writev = require('.');

const fs = require('fs');
const fd = fs.openSync(process.argv[2] || '/dev/null', 'w');

const helloWorld = [Buffer.from('hello '), Buffer.from('world'), Buffer.from('\n')];
const bigHelloWorld = [...helloWorld, ...helloWorld, ...helloWorld];

const PARALLELISM = 10;
const LIMIT = 18;

function test(name, fn, done) {
  console.time(name)
  function doTest(i) {
    let count = 0;
    for (let i = 0; i < PARALLELISM; i++) {
      fn(() => {
        console.log('cb', i, 'called');
        if (++count === LIMIT - 1) {
          console.timeEnd(name);
          done && done();
        } else {
          doTest(i+1)
        }
      });
    }
  }
  doTest(0);
}

function promisify(fn) {
  return (...args) => {
    return new Promise((resolve) => {
      fn(...args, () => resolve());
    });
  };
}

const asyncWriteV = promisify(callback => {
  test('fast-writev', (cb) => {
    writev(fd, bigHelloWorld, cb);
  }, callback);
});
const asyncFsWriteV = promisify(callback => {
  test('fs.writev', (cb) => {
    fs.writev(fd, bigHelloWorld, cb);
  }, callback);
});

(async () => {
  //await asyncFsWriteV();
  await asyncWriteV();
})();

