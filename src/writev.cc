#include "v8.h"
#include <node.h>
#include <node_buffer.h>
#include <uv.h>
#include <v8-fast-api-calls.h>
#include <iostream>
#include "liburing/src/include/liburing.h"

using namespace v8;

namespace writev_addon {

  typedef Persistent<Function, CopyablePersistentTraits<Function>> CPersistent;

  uint64_t * uvBufsBuffer;
  uint32_t * uvBufLensBuffer;

  //CPersistent callback;
  Eternal<Function> * callback;
  uv_loop_t * loop;
  Isolate * isolate;

  uv_fs_t fsReq;

  static io_uring ring;
  static uv_poll_t poller;
  static uv_prepare_t preparer;
  static unsigned pending = 0;

  typedef struct io_data {
    iovec * iovs;
    uint32_t cbId;
  } io_data;

  inline io_data * init_io_data(uint32_t cbId, uint32_t nbufs) {
    iovec * iovs = (iovec *)malloc(sizeof(iovec) * nbufs);
    for (uint32_t i = 0; i < nbufs; i++) {
      iovs[i].iov_base = (void *)uvBufsBuffer[i];
      iovs[i].iov_len = uvBufLensBuffer[i];
    }

    io_data * data = (io_data *)malloc(sizeof(io_data));
    data->iovs = iovs;
    data->cbId = cbId;
    return data;
  }

  void free_io_data(io_data * data) {
    free(data->iovs);
    free(data);
  }

  // (callback: Function, bufferPtrs: Buffer, bufferLengths: Buffer): void
  void setup(const FunctionCallbackInfo<Value>& args) {
    Local<Context> context = isolate->GetCurrentContext();
    Local<Function> localCallback = Local<Function>::Cast(args[0]);
    callback = new Eternal<Function>(isolate, localCallback);
    uvBufsBuffer = (uint64_t *)node::Buffer::Data(args[1]->ToObject(context).ToLocalChecked());
    uvBufLensBuffer = (uint32_t *)node::Buffer::Data(args[2]->ToObject(context).ToLocalChecked());
  }

  void getPtr(const FunctionCallbackInfo<Value>& args) {
    void * buffer = args[0].As<ArrayBuffer>()->GetBackingStore()->Data();
    args.GetReturnValue().Set(v8::BigInt::NewFromUnsigned(isolate, (uint64_t)buffer));
  }

  void OnSignal(uv_poll_t* handle, int status, int events) {
    while (true) { // Drain the SQ
      io_uring_cqe* cqe;
      // Per source, this cannot return an error. (That's good because we have no
      // particular callback to invoke with an error.)
      io_uring_peek_cqe(&ring, &cqe);

      if (!cqe) return;

      io_uring_cqe_seen(&ring, cqe);

      pending--;
      if (!pending)
        uv_poll_stop(&poller);

      io_data * data = (io_data *)io_uring_cqe_get_data(cqe);

      uint32_t cbId = data->cbId;
      free_io_data(data);

      HandleScope scope(isolate);
      Local<Function> cb = callback->Get(isolate);
      Local<Value> argv[2] = {
        Number::New(isolate, (double)cbId),
        Number::New(isolate, (double)cqe->res)
      };
      cb->Call(cb->CreationContext(), Undefined(isolate), 2, argv);

    }
  }

  void DoSubmit(uv_prepare_t* handle) {
    uv_prepare_stop(handle);
    int ret = io_uring_submit(&ring);
    if (ret < 0) {
      fprintf(stderr, "io_uring_submit: %s\n", strerror(-ret));
    }
    if (!uv_is_active((uv_handle_t*)&poller))
      uv_poll_start(&poller, UV_READABLE, OnSignal);
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
    io_data * data = init_io_data(cbId, nbufs);

    io_uring_sqe* sqe = io_uring_get_sqe(&ring);
    io_uring_prep_writev(sqe, fd, data->iovs, nbufs, 0);
    io_uring_sqe_set_data(sqe, data);

    if (!uv_is_active((uv_handle_t*)&preparer))
      uv_prepare_start(&preparer, DoSubmit);

    pending++;
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
    
    loop = node::GetCurrentEventLoop(isolate);
    // TODO fixed limit here
    int ret = io_uring_queue_init(32, &ring, 0);
    if (ret < 0) {
      fprintf(stderr, "queue_init: %s\n", strerror(-ret));
    }
    uv_poll_init(loop, &poller, ring.ring_fd);
    uv_prepare_init(loop, &preparer);

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

    NODE_SET_METHOD(exports, "getPtr", &getPtr);
  }

  NODE_MODULE(NODE_GYP_MODULE_NAME, Init)
}
