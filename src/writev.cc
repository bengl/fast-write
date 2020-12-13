#include "v8.h"
#include <node.h>
#include <node_buffer.h>
#include <uv.h>
#include <v8-fast-api-calls.h>
#include <iostream>

using namespace v8;

namespace writev {

  typedef Persistent<Function, CopyablePersistentTraits<Function>> CPersistent;

  void * buffer;
  void * uvBufsBuffer;

  //CPersistent callback;
  Eternal<Function> * callback;
  uv_loop_t * loop;
  Isolate * isolate;

  uv_fs_t fsReq;

  // (writeBufferArena: Buffer, callback: Function, bufferPtrs: Buffer, bufferLengths: Buffer): BigUInt64
  void setup(const FunctionCallbackInfo<Value>& args) {
    Local<Context> context = isolate->GetCurrentContext();
    buffer = node::Buffer::Data(args[0]->ToObject(context).ToLocalChecked());
    Local<Function> localCallback = Local<Function>::Cast(args[1]);
    callback = new Eternal<Function>(isolate, localCallback);
    uvBufsBuffer = node::Buffer::Data(args[2]->ToObject(context).ToLocalChecked());
    loop = node::GetCurrentEventLoop(isolate);

    args.GetReturnValue().Set(v8::BigInt::NewFromUnsigned(isolate, (uint64_t)buffer));
  }

  void fastWriteCb(uv_fs_t * fsReq) {
    if (fsReq->result < 0) {
      std::cout << uv_strerror(fsReq->result) << "\n";
    }
    HandleScope scope(isolate);
    uint32_t cbId = ((uint64_t)fsReq->data & 0xFFFFFFFF);
    free(fsReq);
    Local<Function> cb = callback->Get(isolate);
    Local<Value> argv[2] = {
      Number::New(isolate, (double)cbId),
      Number::New(isolate, (double)fsReq->result)
    };
    cb->Call(cb->CreationContext(), Undefined(isolate), 2, argv);
  }

  inline void doWrite(uint32_t fd, uint32_t cbId, uint32_t nbufs) {
    uv_fs_t * fsReq = (uv_fs_t *)malloc(sizeof(uv_fs_t));
    uint64_t ptr = cbId;
    fsReq->data = (void*)ptr;
    uv_buf_t * iovs = (uv_buf_t *)uvBufsBuffer;
    uv_fs_write(loop, fsReq, fd, iovs, nbufs, 0, fastWriteCb);
  }

  void slowWrite(const FunctionCallbackInfo<Value>& args) {
    // std::cout << "Slow Call\n";
    Local<Context> context = isolate->GetCurrentContext();
    return doWrite(
        args[0]->ToUint32(context).ToLocalChecked()->Value(),
        args[1]->ToUint32(context).ToLocalChecked()->Value(),
        args[2]->ToUint32(context).ToLocalChecked()->Value()
    );
  }

  void fastWrite(v8::ApiObject receiver, uint32_t fd, uint32_t cbId, uint32_t nbufs) {
    // std::cout << "Fast Call\n";
    return doWrite(fd, cbId, nbufs);
  }

  void Init(Local<Object> exports) {
    isolate = exports->GetIsolate();
    NODE_SET_METHOD(exports, "setup", &setup);

    CFunction fastCFunc = CFunction::Make(fastWrite);
    Local<FunctionTemplate> funcTemplate = FunctionTemplate::New(
        isolate, slowWrite,
        Local<Value>(),
        Local<v8::Signature>(),
        0,
        v8::ConstructorBehavior::kThrow,
        v8::SideEffectType::kHasSideEffect,
        &fastCFunc
    );
    Local<Context> context = isolate->GetCurrentContext();
    exports->Set(
        context,
        String::NewFromUtf8(exports->GetIsolate(), "writev").ToLocalChecked(),
        funcTemplate->GetFunction(context).ToLocalChecked()
    );
  }

  NODE_MODULE(NODE_GYP_MODULE_NAME, Init)
}
