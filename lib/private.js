const v8 = require('v8');

v8.setFlagsFromString('--allow-natives-syntax');

module.exports = new Function('name', 'return %CreatePrivateSymbol(name)');

v8.setFlagsFromString('--no-allow-natives-syntax');
