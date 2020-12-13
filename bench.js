const writev = require('.');

const fs = require('fs');
const fd = fs.openSync('/dev/null', 'w');

const helloWorld = [Buffer.from('hello '), Buffer.from('world'), Buffer.from('\n')];
const bigHelloWorld = [...helloWorld, ...helloWorld, ...helloWorld];

const LIMIT = 100000;

function test(name, fn, done) {
  console.time(name)
  function doTest(i) {
    fn(() => {
      if (i === LIMIT) {
        console.timeEnd(name);
        done && done();
      } else {
        doTest(i+1)
      }
    })
  }
  doTest(0);
}

test('fast-writev', (cb) => {
  writev(fd, bigHelloWorld, cb);
}, () => {
  test('fs.writev', (cb) => {
    fs.writev(fd, bigHelloWorld, cb);
  })
})
