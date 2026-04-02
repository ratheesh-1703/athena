const PlatformModule = require('react-native-web/dist/exports/Platform');

const Platform = PlatformModule.default || PlatformModule;

module.exports = Platform;
module.exports.default = Platform;
