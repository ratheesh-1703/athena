const PlatformModule = require('react-native-web/dist/exports/Platform');
const Platform = PlatformModule.default || PlatformModule;

const noop = () => {};
const passthrough = (value) => value;

module.exports = {
  BatchedBridge: { registerCallableModule: noop, enqueueNativeCall: noop },
  ExceptionsManager: { handleException: noop },
  Platform,
  RCTEventEmitter: { register: noop, receiveEvent: noop },
  ReactNativeViewConfigRegistry: {
    register: noop,
    get: () => ({}),
  },
  TextInputState: {
    currentlyFocusedInput: () => null,
    focusTextInput: noop,
    blurTextInput: noop,
  },
  UIManager: {},
  deepDiffer: () => false,
  deepFreezeAndThrowOnMutationInDev: passthrough,
  flattenStyle: passthrough,
  ReactFiberErrorDialog: noop,
  legacySendAccessibilityEvent: noop,
  RawEventEmitter: { emit: noop },
  CustomEvent: class CustomEvent {},
  createAttributePayload: () => ({}),
  diffAttributePayloads: () => ({}),
  createPublicInstance: () => null,
  createPublicTextInstance: () => null,
  getNativeTagFromPublicInstance: () => null,
  getNodeFromPublicInstance: () => null,
  getInternalInstanceHandleFromPublicInstance: () => null,
};

module.exports.default = module.exports;
