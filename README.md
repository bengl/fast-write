# fast-write experiment

This is an experiment to see how fast data can be written to a file descriptor
from Node.js on Linux.

Currently it's taking advantage of both `v8-fast-api-calls.h` and `io_uring`.

Current benchmark results (as of the last time this README was comitted):

```
$ node bench
fs.writev: 10.299s
fast-writev: 4.401s
```

> **WARNING:** This repo is more of a scratch-pad experiment repo than a usable
> working library. Observe, but do not use (yet).
