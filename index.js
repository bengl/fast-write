const binding = require('./build/Release/writev.node');
const private = require('./lib/private');

const PTR = private('pointer');
const { getPtr } = binding;
delete binding.getPtr;

const uvErrMap = process.binding('uv').getErrorMap();

const uvBufs = Buffer.alloc(1024);
const uvBufs64 = new BigUint64Array(uvBufs.buffer, uvBufs.offset);
const uvBufs32 = new Uint32Array(uvBufs.buffer, uvBufs.offset);
const submissions = Buffer.alloc(4096); // [len, fd0, cbId0, count0, fd1, cbId1, count1, fd2, cbId2, count2, ...]
const submissions32 = new Uint32Array(submissions.buffer, submissions.offset);
const resultBuffer = Buffer.alloc(4096);
const resultBuffer32 = new Int32Array(resultBuffer.buffer, resultBuffer.offset);
const cbMap = new Map();
let idPool = 0;
let bufsOffset = 0;

function mainCallback() {
  const resultCount = resultBuffer32[0];
  for (let i = 0; i < resultCount; i++) {
    const cbId = resultBuffer32[1 + (i * 2)];
    const result = resultBuffer32[2 + (i * 2)];
    const cb = cbMap.get(cbId);
    cbMap.delete(cbId);
    if (result < 0) {
      const [code, uvmsg] = uvErrMap.get(result);
      const err = new Error(`${code}: ${uvmsg}`);
      cb(err);

    }
    cb(null, result);
  }
}

binding.setup(mainCallback, uvBufs, submissions, resultBuffer);

function getPointer(buf, offset = 0) {
  if (buf.buffer) {
    return getPointer(buf.buffer, buf.offset)
  }
  let pointer = buf[PTR];
  if (!pointer) {
    pointer = getPtr(buf);
    buf[PTR] = pointer;
  }
  return offset ? pointer + BigInt(offset) : pointer;
}

function setIovecs(offset, ptr, bufLen) {
  uvBufs64[offset] = ptr;
  uvBufs32[2 * offset + 2] = bufLen;
}

function writev(fd, bufs, cb) {
  let len = submissions32[0];
  if (len > 900) {
    setImmediate(() => writev(fd, bufs, cb));
    return;
  }
  const id = idPool++;
  cbMap.set(id, cb);
  if (len === 0) {
    bufsOffset = 0;
  }

  for (let i = 0; i < bufs.length; i++) {
    const buf = bufs[i];
    const bufLen = buf.length
    setIovecs(bufsOffset + 2 * i, getPointer(buf), bufLen);
  }

  bufsOffset += bufs.length * 2 ;

  submissions32[1 + (len * 3)] = fd;
  submissions32[2 + (len * 3)] = id;
  submissions32[3 + (len * 3)] = bufs.length;

  submissions32[0] = len + 1;
}

writev.prepareStop = binding.prepareStop;

module.exports = writev;
