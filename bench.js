const writev = require('.');

const fs = require('fs');
const fd = fs.openSync('/dev/null', 'w');

const helloWorld = [Buffer.from('hello '), Buffer.from('world'), Buffer.from('\n')];

const LIMIT = 1000000;

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
  writev(fd, helloWorld, cb);
}, () => {
  test('fs.writev', (cb) => {
    fs.writev(fd, helloWorld, cb);
  })
})
