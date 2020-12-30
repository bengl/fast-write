# fast-write experiment

This is an experiment to see how fast data can be written to a file descriptor
from Node.js on Linux.

Currently it's taking advantage `io_uring`, and using a shared buffer as a
submissions queue, which is read on every libuv tick, to avoid any calls from JS
into C++, with the exception of getting pointers representing buffers. The
`getPointer` operation is also cached.

Current benchmark results (as of the last time this README was comitted):

```
$ node bench
fs.writev: 5.503s
fast-writev: 2.274s
```

> **WARNING:** This repo is more of a scratch-pad experiment repo than a usable
> working library. Observe, but do not use (yet).

## API

Give it a file descriptor number, and an array of buffers, and it will write at
the current offset.

```js
const fs = require('fs');
const writev = require('writev');

const fd = fs.openSync('/tmp/foobar');
writev(fd, ['hello', ' world', '\n'].map(x => Buffer.from(x)), (err, res) => {
  if (err) {
    // (some hand-wavey error handling
  }
  console.log(res); // bytes written
  writev.prepareStop();
});
```

Note the `writev.prepareStop()` at the end. This should be called when you're
sure you're never going to call `writev` again in your program. If you don't,
the event loop will stay alive due to `uv_prepare_t` handle that checks for
submissions on each libuv tick.

In addition to the fd number and buffers, you can also give a third argument,
which is the offset, as would be used in
[`pwritev(2)`](https://linux.die.net/man/2/pwritev). When writing to a socket,
this should be set to 0. The default is -1.

## TODO

* [ ] Docs
* [x] Writev at offsets
* [ ] Readv
* [ ] Interact with sqe and cqe directly from JavaScript
