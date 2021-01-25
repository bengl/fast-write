#include "liburing/io_uring.h"
#include "v8.h"
#include <bits/stdint-uintn.h>
#include <node.h>
#include <node_buffer.h>
#include <uv.h>
#include <iostream>
#include "liburing/src/include/liburing.h"

using namespace v8;

namespace writev_addon {

  uint32_t * pendingSubs;
  int32_t * resultBuffer;

  Eternal<Function> * callback;
  uv_loop_t * loop;
  Isolate * isolate;

  static io_uring ring;
  static uv_poll_t poller;
  static uv_prepare_t preparer;
  static unsigned pending = 0;


  // (callback, pendingSubs, resultBuffer): [ring_ptr, sq, sqes, sizeof(sqe)]
  void setup(const FunctionCallbackInfo<Value>& args) {
    Local<Context> context = isolate->GetCurrentContext();
    Local<Function> localCallback = Local<Function>::Cast(args[0]);
    callback = new Eternal<Function>(isolate, localCallback);
    pendingSubs = (uint32_t *)node::Buffer::Data(args[1]->ToObject(context).ToLocalChecked());
    resultBuffer = (int32_t *)node::Buffer::Data(args[2]->ToObject(context).ToLocalChecked());
    HandleScope scope(isolate);

    Local<Value> rets [4] = {
      node::Buffer::New(isolate, (char*)ring.sq.ring_ptr, ring.sq.ring_sz).ToLocalChecked(),
      node::Buffer::New(isolate, (char*)(&ring.sq), 640).ToLocalChecked(),
      node::Buffer::New(isolate, (char*)ring.sq.sqes, 1024 * sizeof(struct io_uring_sqe)).ToLocalChecked(),
      Number::New(isolate, sizeof(struct io_uring_sqe))
    };
    auto retVal = Array::New(isolate, rets, 4);
    args.GetReturnValue().Set(retVal);
  }

  void getPtr(const FunctionCallbackInfo<Value>& args) {
    void * buffer = args[0].As<ArrayBuffer>()->GetBackingStore()->Data();
    args.GetReturnValue().Set(v8::BigInt::NewFromUnsigned(isolate, (uint64_t)buffer));
  }

  void onSignal(uv_poll_t* handle, int status, int events) {
    int id = 0;
    io_uring_cqe* cqe;
    while (id == 0 || cqe) { // Drain the SQ
      // Per source, this cannot return an error. (That's good because we have no
      // particular callback to invoke with an error.)
      io_uring_peek_cqe(&ring, &cqe);

      if (!cqe) break;

      io_uring_cqe_seen(&ring, cqe);

      pending--;
      if (!pending)
        uv_poll_stop(&poller);

      uint32_t cbId = (uint64_t)io_uring_cqe_get_data(cqe) & 0xFFFFFFFF;

      resultBuffer[1 + (id * 2)] = cbId;
      resultBuffer[2 + (id * 2)] = cqe->res;
      id += 1;
    }
    if (!id) {
      return;
    }
    resultBuffer[0] = (double)id;
    HandleScope scope(isolate);
    Local<Function> cb = callback->Get(isolate);
    (void)cb->Call(cb->CreationContext(), Undefined(isolate), 0, NULL);

  }

  void checkForSubmissions(uv_prepare_t* handle) {
    if (*pendingSubs > 0) {
      // std::cout << "IN CPP::\n";
      // std::cout << "sqe ptr: " << (uint64_t)ring.sq.sqes << "\n";
      // std::cout << "opcode: " << (unsigned)ring.sq.sqes->opcode << "\n";
      // std::cout << "flags: " << (unsigned)ring.sq.sqes->flags << "\n";
      // std::cout << "ioprio: " << (unsigned)ring.sq.sqes->ioprio << "\n";
      // std::cout << "fd: " << (signed)ring.sq.sqes->fd << "\n";
      // std::cout << "off: " << (off_t)ring.sq.sqes->off << "\n";
      // std::cout << "addr: " << (uint64_t)ring.sq.sqes->addr << "\n";
      // std::cout << "addr: " << (unsigned long)ring.sq.sqes->addr << "\n";
      // iovec * vec = (iovec *)ring.sq.sqes->addr;
      // std::string myString0((char*)vec->iov_base, vec->iov_len);
      // std::cout << myString0 << "\n";
      // std::cout << "len: " << (uint32_t)ring.sq.sqes->len << "\n";
      // std::cout << "rw_flags: " << (uint32_t)ring.sq.sqes->rw_flags << "\n";
      // std::cout << "user_data: " << (uint64_t)ring.sq.sqes->user_data << "\n";
      int ret = io_uring_submit(&ring);
      if (ret < 0) {
        fprintf(stderr, "io_uring_submit: %s\n", strerror(-ret));
      }
      *pendingSubs = 0;
      if (!uv_is_active((uv_handle_t*)&poller))
        uv_poll_start(&poller, UV_READABLE, onSignal);
    }
  }

  void prepareStop(const FunctionCallbackInfo<Value>& args) {
    uv_prepare_stop(&preparer);
  }

  void Init(Local<Object> exports) {
    isolate = exports->GetIsolate();
    NODE_SET_METHOD(exports, "setup", &setup);
    
    loop = node::GetCurrentEventLoop(isolate);
    // TODO fixed limit here
    int ret = io_uring_queue_init(1024, &ring, 0);
    if (ret < 0) {
      fprintf(stderr, "queue_init: %s\n", strerror(-ret));
    }
    uv_poll_init(loop, &poller, ring.ring_fd);
    uv_prepare_init(loop, &preparer);
    uv_prepare_start(&preparer, checkForSubmissions);

    NODE_SET_METHOD(exports, "getPtr", &getPtr);
    NODE_SET_METHOD(exports, "prepareStop", &prepareStop);
  }

  NODE_MODULE(NODE_GYP_MODULE_NAME, Init)
}
