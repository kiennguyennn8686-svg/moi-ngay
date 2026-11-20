(function () {
  'use strict';
  // Trang chính là bên thứ nhất, nên phiên lưu tại đây không phụ thuộc vùng lưu tạm trong iframe.
  window.__MOI_NGAY_HOSTED__ = true;
  var channel = 'moi-ngay-bridge-v1';
  var methods = ['registerAccount','getLoginSalt','loginAccount','getSession','logoutAccount','getAppData',
    'saveProfile','saveAttendance','deleteAttendance','saveTransaction','deleteTransaction','saveBudget',
    'applyRate','applyAttendanceBonus'];
  var scriptUrl = String(window.MOI_NGAY_SCRIPT_URL || '');
  var readyWindow = null, readyOrigin = '', nextId = 0, pending = Object.create(null);
  var connectError = '';
  document.documentElement.setAttribute('data-mn-bridge', 'loading');
  var frame = document.createElement('iframe');
  frame.title = 'Kết nối dữ liệu Google';
  frame.setAttribute('aria-hidden','true');
  frame.tabIndex = -1;
  frame.style.cssText = 'position:absolute;width:1px;height:1px;left:-10000px;top:0;border:0;opacity:0;pointer-events:none';
  var nonce = '';
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(scriptUrl)) {
    connectError = 'Đường dẫn Google Apps Script chưa được cấu hình đúng.';
  } else if (!window.crypto || !window.crypto.getRandomValues) {
    connectError = 'Trình duyệt không hỗ trợ kết nối an toàn.';
  } else if (window.top !== window) {
    connectError = 'Hãy mở ứng dụng bằng đường dẫn trực tiếp.';
  } else {
    var bytes = new Uint8Array(16); window.crypto.getRandomValues(bytes);
    nonce = Array.from(bytes).map(function (value) { return ('0' + value.toString(16)).slice(-2); }).join('');
    frame.src = scriptUrl + '?mnBridge=1&nonce=' + nonce;
    document.body.appendChild(frame);
  }
  function belongsToBridge(source) {
    try {
      for (var depth = 0; source && depth < 8; depth++) {
        if (source === frame.contentWindow) return true;
        var parent = source.parent;
        if (!parent || parent === source) break;
        source = parent;
      }
    } catch (_) {}
    return false;
  }
  function validGoogleOrigin(value) {
    return /^https:\/\/(?:[a-z0-9-]+\.)+googleusercontent\.com$/i.test(value || '');
  }
  function sendPending(entry) {
    if (!readyWindow || entry.sent) return;
    entry.sent = true;
    try {
      readyWindow.postMessage({channel:channel,nonce:nonce,type:'call',id:entry.id,method:entry.method,payload:entry.payload},readyOrigin);
    } catch (_) {
      delete pending[entry.id]; clearTimeout(entry.timer);
      entry.reject(new Error('Chưa kết nối được với Google. Hãy tải lại ứng dụng.'));
    }
  }
  window.addEventListener('message', function (event) {
    var message = event.data;
    if (!message || message.channel !== channel || message.nonce !== nonce ||
        !validGoogleOrigin(event.origin) || !belongsToBridge(event.source)) return;
    if (message.type === 'ready') {
      if (readyWindow && (event.source !== readyWindow || event.origin !== readyOrigin)) return;
      readyWindow = event.source; readyOrigin = event.origin;
      document.documentElement.setAttribute('data-mn-bridge', 'ready');
      Object.keys(pending).forEach(function (id) { sendPending(pending[id]); });
      return;
    }
    if (event.source !== readyWindow || event.origin !== readyOrigin ||
        (message.type !== 'result' && message.type !== 'error') || !Number.isSafeInteger(message.id)) return;
    var entry = pending[message.id];
    if (!entry) return;
    delete pending[message.id]; clearTimeout(entry.timer);
    if (message.type === 'error') entry.reject(new Error(String(message.error || 'Không thể kết nối Google.').slice(0,500)));
    else entry.resolve(message.value);
  });
  function call(method, payload) {
    return new Promise(function (resolve, reject) {
      if (connectError) { reject(new Error(connectError)); return; }
      if (methods.indexOf(method) < 0 || !payload || typeof payload !== 'object' || Array.isArray(payload)) {
        reject(new Error('Yêu cầu không hợp lệ.')); return;
      }
      var id = ++nextId;
      var entry = {id:id,method:method,payload:payload,resolve:resolve,reject:reject,sent:false};
      entry.timer = setTimeout(function () {
        if (!pending[id]) return;
        delete pending[id]; reject(new Error('Chưa kết nối được với Google. Kiểm tra mạng và cấu hình ứng dụng.'));
      }, 30000);
      pending[id] = entry; sendPending(entry);
    });
  }
  var runner = {
    withSuccessHandler:function (fn) { var next = Object.create(this); next.success = fn; return next; },
    withFailureHandler:function (fn) { var next = Object.create(this); next.failure = fn; return next; }
  };
  methods.forEach(function (method) {
    runner[method] = function (payload) {
      var current = this;
      call(method,payload || {}).then(function (value) {
        if (typeof current.success === 'function') current.success(value);
      }, function (error) {
        if (typeof current.failure === 'function') current.failure({message:error.message});
      });
    };
  });
  window.google = {script:{run:runner}};
})();
