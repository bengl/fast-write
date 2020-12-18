const binding = require('./build/Release/writev.node');

const PTR = Symbol('pointer');

const uvBufs = Buffer.alloc(1024);
const uvBufs64 = new BigUint64Array(uvBufs.buffer, uvBufs.offset);
const uvBufLens = Buffer.alloc(1024);
const uvBufLens32 = new Uint32Array(uvBufLens.buffer, uvBufLens.offset);
const submissions = Buffer.alloc(4096); // [len, fd0, cbId0, count0, fd1, cbId1, count1, fd2, cbId2, count2, ...]
const submissions32 = new Uint32Array(submissions.buffer, submissions.offset);
const cbMap = new Map();
let idPool = 0;
let bufsOffset = 0;

function mainCallback(cbId, result) {
  const cb = cbMap.get(cbId);
  cbMap.delete(cbId);
  cb(result);
}

binding.setup(mainCallback, uvBufs, uvBufLens, submissions);

function getPointer(buf, offset = 0) {
  if (buf.buffer) {
    return getPointer(buf.buffer, buf.offset)
  }
  if (buf[PTR]) {
    return buf[PTR] + BigInt(offset);
  }
  const pointer = binding.getPtr(buf);
  buf[PTR] = pointer;
  return pointer + BigInt(offset);
}

function setIovecs(offset, ptr, bufLen) {
  uvBufs64[offset] = ptr;
  uvBufLens32[offset] = bufLen;
}

// note: this writes over the whole arena every time.
function writev(fd, bufs, cb) {
  const id = idPool++;
  cbMap.set(id, cb);
  let len = submissions32[0];
  if (len === 0) {
    bufsOffset = 0;
  }

  for (let i = 0; i < bufs.length; i++) {
    const buf = bufs[i];
    const bufLen = buf.length
    setIovecs(bufsOffset + i, getPointer(buf), bufLen);
  }

  bufsOffset += bufs.length;

  submissions32[1 + (len * 3)] = fd;
  submissions32[2 + (len * 3)] = id;
  submissions32[3 + (len * 3)] = bufs.length;

  submissions32[0] = len + 1;
  console.log('added 1 to pendingSubs', submissions32[0], 'for cbId', id);
  //setImmediate(() => {});
}

module.exports = writev;
