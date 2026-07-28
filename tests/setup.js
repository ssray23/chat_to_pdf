// Mock Chrome Extension API for Jest JSDOM Environment

const storageMap = new Map();

window.scrollTo = jest.fn();
window.print = jest.fn();

global.chrome = {
  runtime: {
    id: 'test-extension-id',
    getURL: (path) => `chrome-extension://test-extension-id/${path}`,
    sendMessage: jest.fn((msg, callback) => {
      if (typeof callback === 'function') callback({ success: true });
      return Promise.resolve({ success: true });
    }),
    onMessage: {
      addListener: jest.fn(),
      removeListener: jest.fn()
    },
    lastError: null
  },
  tabs: {
    query: jest.fn(() => Promise.resolve([{ id: 1, title: 'Test Chat', url: 'https://claude.ai/chat/123' }])),
    sendMessage: jest.fn((tabId, msg) => Promise.resolve({ success: true, messages: [] })),
    create: jest.fn((opts) => Promise.resolve({ id: 2, ...opts })),
    captureVisibleTab: jest.fn((windowId, options, callback) => {
      const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      if (typeof callback === 'function') callback(dataUrl);
      return Promise.resolve(dataUrl);
    })
  },
  scripting: {
    executeScript: jest.fn(() => Promise.resolve([{ result: true }]))
  },
  storage: {
    local: {
      get: jest.fn((keys) => {
        if (typeof keys === 'string') {
          return Promise.resolve({ [keys]: storageMap.get(keys) });
        }
        if (Array.isArray(keys)) {
          const result = {};
          keys.forEach(k => { result[k] = storageMap.get(k); });
          return Promise.resolve(result);
        }
        const result = {};
        storageMap.forEach((v, k) => { result[k] = v; });
        return Promise.resolve(result);
      }),
      set: jest.fn((items) => {
        Object.entries(items).forEach(([k, v]) => storageMap.set(k, v));
        return Promise.resolve();
      }),
      remove: jest.fn((keys) => {
        const arr = Array.isArray(keys) ? keys : [keys];
        arr.forEach(k => storageMap.delete(k));
        return Promise.resolve();
      }),
      clear: jest.fn(() => {
        storageMap.clear();
        return Promise.resolve();
      })
    }
  }
};

// Reset DOM and mocks before each test
beforeEach(() => {
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  storageMap.clear();
  jest.clearAllMocks();
});
