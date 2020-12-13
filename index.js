const binding = require('./build/Release/writev.node');

const MICRO_OPT_LEN = 32;

const writeBufferArena = Buffer.alloc(10 * 4096);
const uvBufs = Buffer.alloc(4096);
const uvBufs64 = new BigUint64Array(uvBufs.buffer);
const uvBufs32 = new Uint32Array(uvBufs.buffer);

const cbMap = new Map();
let idPool = 0;

function mainCallback(cbId, result) {
  const cb = cbMap.get(cbId);
  cbMap.delete(cbId);
  cb(result);
}

let arenaOffset = binding.setup(writeBufferArena, mainCallback, uvBufs);

let arenaIndex;
let bufMap;
function reset() {
  arenaIndex = 0;
  bufMap = new Map();
}
reset();

function writeBuf(buf, offset) {
  const srcLen = buf.length;
  if (srcLen > MICRO_OPT_LEN) {
    writeBufferArena.set(buf, offset);
  } else {
    for (let i = 0; i < srcLen; i++) {
      writeBufferArena[offset + i] = buf[i];
    }
  }
}

function makeBufferStruct(offset, ptr, bufLen) {
  uvBufs64[offset] = ptr;
  uvBufs32[(2*offset)+2] = bufLen;
}

// note: this writes over the whole arena every time.
function writev(fd, bufs, cb) {
  const id = idPool++;
  cbMap.set(id, cb);
  for (let i = 0; i < bufs.length; i++) {
    const buf = bufs[i];
    const location = bufMap.get(buf);
    if (location) {
      uvBufs64[i] = uvBufs64[location]
      uvBufs64[i + 1] = uvBufs64[location + 1];
    } else {
      const ptr = arenaOffset + BigInt(arenaIndex);
      const bufLen = buf.length
      if (arenaIndex + bufLen > writeBufferArena.length) {
        reset();
        return writev(fd, bufs, cb);
      }
      makeBufferStruct(i * 2, ptr, bufLen);
      writeBuf(buf, arenaIndex);
      arenaIndex += bufLen;
      bufMap.set(buf, i * 2);
    }
  }
  binding.writev(fd, id, bufs.length);
}

module.exports = writev;
