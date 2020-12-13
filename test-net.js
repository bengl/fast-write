const net = require('net');
const writev = require('.');

const fs = require('fs');

const socket = net.connect(80, 'www.google.com', () => {
  const fd = socket._handle.fd;
  console.log(fd);

  writev(fd, [Buffer.from('GET HTTP/1.1 /\r\n\r\n')], () => {})
  socket.on('data', d => console.log(d.toString()));
  socket.on('end', () => process.exit());
})
