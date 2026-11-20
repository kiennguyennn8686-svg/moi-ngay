// Một tuần tính từ thứ Hai đến Chủ nhật. Tiền thưởng thuộc tháng có ngày đạt điều kiện.
function calculateAttendanceBonus_(data) {
  var result = {total:0,awards:[]};
  if (!data || !data.bonusStart || !data.bonusEnd) return result;
  var byDate = Object.create(null);
  (data.bonusAdjacent || []).concat(data.attendance || []).forEach(function (row) { byDate[row.date] = row; });
  var rates = data.rates || [];
  function valueAt(kind, date, fallback) {
    var value = fallback, latest = '';
    rates.forEach(function (rate) {
      if (rate.kind === kind && rate.effective <= date && rate.effective >= latest) {
        latest = rate.effective; value = Number(rate.amount);
      }
    });
    return value;
  }
  function advance(text) {
    var p = text.split('-').map(Number);
    return new Date(Date.UTC(p[0],p[1]-1,p[2]+1)).toISOString().slice(0,10);
  }
  var current = data.bonusStart, streak = 0, rewarded = false;
  while (current <= data.bonusEnd) {
    var weekday = new Date(current + 'T00:00:00Z').getUTCDay();
    if (weekday === 1) { streak = 0; rewarded = false; }
    var row = byDate[current];
    streak = row && Number(row.units) === 1 ? streak + 1 : 0;
    var required = valueAt('bonus_days',current,6);
    var amount = valueAt('bonus_amount',current,0);
    if (!Number.isInteger(required) || required < 1 || required > 7) required = 6;
    if (!rewarded && amount > 0 && streak >= required) {
      rewarded = true;
      if (current.slice(0,7) === data.month) {
        result.total += amount; result.awards.push({date:current,amount:amount,days:required});
      }
    }
    current = advance(current);
  }
  return result;
}
function rateForData_(data, kind, date) {
  var amount = 0, latest = '';
  (data.rates || []).forEach(function (rate) {
    if (rate.kind === kind && rate.effective <= date && rate.effective >= latest) {
      latest = rate.effective; amount = Number(rate.amount) || 0;
    }
  });
  return amount;
}
function mergeAttendanceIntoData_(data, row) {
  if (!data) return;
  var list;
  if (data.month === row.date.slice(0,7)) list = data.attendance;
  else if (data.bonusAdjacent && row.date >= data.bonusStart && row.date <= data.bonusEnd) list = data.bonusAdjacent;
  else return;
  var index = list.findIndex(function (item) { return item.date === row.date; });
  if (index < 0) list.push(Object.assign({},row));
  else list[index] = Object.assign({},row);
}
function projectMutation_(data, task) {
  if (!data) return;
  var payload = task.payload, result = task.result, method = task.method;
  if (method === 'saveProfile') {
    data.displayName = result && typeof result.displayName === 'string' ? result.displayName : payload.displayName;
    return;
  }
  if (method === 'saveAttendance') {
    var all = (data.attendance || []).concat(data.bonusAdjacent || []);
    var previous = all.find(function (row) { return row.date === payload.date; });
    var row = result && typeof result === 'object' && result.date ? result : {
      date:payload.date, units:payload.units, overtimeHours:payload.overtimeHours, note:payload.note,
      dayRate:previous ? previous.dayRate : rateForData_(data,'day',payload.date),
      overtimeRate:previous ? previous.overtimeRate : rateForData_(data,'overtime',payload.date)
    };
    mergeAttendanceIntoData_(data,row); return;
  }
  if (method === 'deleteAttendance') {
    data.attendance = (data.attendance || []).filter(function (row) { return row.date !== payload.date; });
    if (data.bonusAdjacent) data.bonusAdjacent = data.bonusAdjacent.filter(function (row) { return row.date !== payload.date; });
    return;
  }
  if (method === 'saveTransaction') {
    var transaction = result && typeof result === 'object' && result.id ? result : payload;
    data.transactions = (data.transactions || []).filter(function (row) { return row.id !== transaction.id; });
    if (transaction.date.slice(0,7) === data.month) data.transactions.push({id:transaction.id,date:transaction.date,
      type:transaction.type,category:transaction.category,amount:Number(transaction.amount),note:transaction.note || ''});
    return;
  }
  if (method === 'deleteTransaction') {
    data.transactions = (data.transactions || []).filter(function (row) { return row.id !== payload.id; }); return;
  }
  if (method === 'saveBudget') {
    if (data.month === payload.month) data.budget = Number(payload.amount); return;
  }
  if (method === 'applyRate' || method === 'applyAttendanceBonus') {
    var effective = result && result.effective ? result.effective : payload.effectiveDate;
    var kinds = method === 'applyRate' ? [payload.kind] : ['bonus_days','bonus_amount'];
    data.rates = (data.rates || []).filter(function (rate) {
      if (kinds.indexOf(rate.kind) < 0) return true;
      return payload.mode === 'future' && rate.effective < effective;
    });
    if (method === 'applyRate') {
      data.rates.push({kind:payload.kind,effective:effective,amount:Number(payload.amount)});
      (data.attendance || []).concat(data.bonusAdjacent || []).forEach(function (row) {
        if (payload.mode === 'all' || row.date >= effective) {
          if (payload.kind === 'day') row.dayRate = Number(payload.amount);
          else row.overtimeRate = Number(payload.amount);
        }
      });
    } else {
      data.rates.push({kind:'bonus_days',effective:effective,amount:Number(payload.days)});
      data.rates.push({kind:'bonus_amount',effective:effective,amount:Number(payload.amount)});
    }
    data.rates.sort(function (a,b) { return a.effective.localeCompare(b.effective); });
  }
}
function replayMutations_(data, history, revision) {
  history.forEach(function (item) {
    if (!item.settledRevision || item.createdRevision > revision || item.settledRevision > revision) projectMutation_(data,item);
  });
}
function installPlatform_(userAgent, platform, maxTouchPoints) {
  if (/iPhone|iPad|iPod/i.test(userAgent) || (/Mac/i.test(platform) && maxTouchPoints > 1)) return 'ios';
  if (/Android/i.test(userAgent)) return 'android';
  return 'other';
}
// Safari 26.2+ hỗ trợ cookie phân vùng; iOS 26 đóng băng số phiên bản hệ điều hành trong UA.
// Math.sumPrecise có từ Safari 26.2 và giúp nhận biết cả webapp không có chuỗi Version/.
function canUseIosPartitionedSession_(userAgent, platform, maxTouchPoints, hasSumPrecise) {
  if (installPlatform_(userAgent || '', platform || '', maxTouchPoints || 0) !== 'ios') return false;
  var version = /Version\/(\d+)\.(\d+)/.exec(userAgent || '');
  if (version) {
    var major = Number(version[1]), minor = Number(version[2]);
    if (major > 26 || (major === 26 && minor >= 2) || (major === 18 && minor === 4)) return true;
    return false;
  }
  return !!hasSumPrecise;
}
function readPartitionedSessionToken_(doc) {
  try {
    var part = String(doc.cookie || '').split(';').map(function (item) { return item.trim(); }).find(function (item) {
      return item.indexOf('__Host-moi_ngay_session=') === 0;
    });
    var token = part ? part.slice('__Host-moi_ngay_session='.length) : '';
    return /^[0-9a-f]{96}$/.test(token) ? token : '';
  } catch (_) { return ''; }
}
function writePartitionedSessionToken_(doc, token) {
  try {
    var value = /^[0-9a-f]{96}$/.test(token || '') ? token : '';
    // __Host- giới hạn cookie cho đúng host; Partitioned tách cookie theo trang chứa app.
    doc.cookie = '__Host-moi_ngay_session=' + value + '; Path=/; Secure; SameSite=None; Partitioned; Max-Age=' + (value ? '2147483647' : '0');
    return value ? readPartitionedSessionToken_(doc) === value : !readPartitionedSessionToken_(doc);
  } catch (_) { return false; }
}
// Mã kiểm tra chỉ gồm trạng thái lưu trữ và mã rút gọn của nguồn trang, không chứa dữ liệu đăng nhập.
function rememberDiagnostic_(doc, storage, origin, enabled) {
  var localSession = false, cookieSession = !!readPartitionedSessionToken_(doc);
  var localBefore = false, cookieBefore = false, localWrite = false, cookieWrite = false;
  var key = 'moi-ngay.storage-check.v1', cookieName = '__Host-moi_ngay_check';
  function readProbeCookie() {
    try {
      var prefix = cookieName + '=', part = String(doc.cookie || '').split(';').map(function (item) { return item.trim(); })
        .find(function (item) { return item.indexOf(prefix) === 0; });
      return part ? part.slice(prefix.length) : '';
    } catch (_) { return ''; }
  }
  try {
    var saved = JSON.parse(storage.getItem('moi-ngay.session.v1') || 'null');
    localSession = !!(saved && /^[0-9a-f]{96}$/.test(saved.token || ''));
  } catch (_) {}
  try {
    var localValue = storage.getItem(key), nextLocal = localValue === '1' ? '2' : '1';
    localBefore = localValue === '1' || localValue === '2';
    storage.setItem(key, nextLocal); localWrite = storage.getItem(key) === nextLocal;
  } catch (_) {}
  var cookieValue = readProbeCookie(), nextCookie = cookieValue === '1' ? '2' : '1';
  cookieBefore = cookieValue === '1' || cookieValue === '2';
  try {
    doc.cookie = cookieName + '=' + nextCookie + '; Path=/; Secure; SameSite=None; Partitioned; Max-Age=3600';
    cookieWrite = readProbeCookie() === nextCookie;
  } catch (_) {}
  var source = String(origin || ''), fingerprint = 2166136261;
  for (var i = 0; i < source.length; i++) fingerprint = Math.imul(fingerprint ^ source.charCodeAt(i), 16777619);
  var flags = [enabled, localSession, cookieSession, localBefore, cookieBefore, localWrite, cookieWrite]
    .map(function (value) { return value ? '1' : '0'; }).join('');
  return 'D1-' + ('00000000' + (fingerprint >>> 0).toString(16).toUpperCase()).slice(-8) + '-' + flags;
}
// Bản lưu gần nhất chỉ dùng sau khi máy chủ xác nhận đúng tài khoản.
var dataCacheKey_ = 'moi-ngay.data-cache.v1';
function dataCacheMonth_(timeZone, clockOffset, now) {
  try {
    var parts = {};
    new Intl.DateTimeFormat('en-US', {timeZone:timeZone || 'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit'})
      .formatToParts(new Date(now + clockOffset)).forEach(function (part) { parts[part.type] = part.value; });
    return parts.year + '-' + parts.month;
  } catch (_) { return ''; }
}
function validCachedData_(data) {
  var date = /^\d{4}-\d{2}-\d{2}$/;
  function attendance(row) { return row && date.test(row.date || '') && isFinite(Number(row.units)) && isFinite(Number(row.overtimeHours)); }
  return !!(data && /^\d{4}-(0[1-9]|1[0-2])$/.test(data.month || '') && date.test(data.today || '') &&
    date.test(data.bonusStart || '') && date.test(data.bonusEnd || '') && isFinite(Number(data.budget)) &&
    Array.isArray(data.attendance) && data.attendance.every(attendance) &&
    Array.isArray(data.bonusAdjacent) && data.bonusAdjacent.every(attendance) &&
    Array.isArray(data.transactions) && data.transactions.every(function (row) { return row && date.test(row.date || '') && isFinite(Number(row.amount)); }) &&
    Array.isArray(data.rates) && data.rates.every(function (row) { return row && typeof row.kind === 'string' && date.test(row.effective || '') && isFinite(Number(row.amount)); }));
}
function writeDataCache_(storage, uid, data, clockOffset, now) {
  try {
    if (typeof uid !== 'string' || !uid || !validCachedData_(data) || !isFinite(clockOffset) ||
        data.month !== dataCacheMonth_(data.timeZone, clockOffset, now)) return false;
    var content = JSON.stringify({uid:uid,savedAt:now,clockOffset:clockOffset,data:data});
    if (content.length > 1500000) return false;
    storage.setItem(dataCacheKey_, content); return true;
  } catch (_) { return false; }
}
function readDataCache_(storage, uid, now) {
  try {
    var saved = JSON.parse(storage.getItem(dataCacheKey_) || 'null');
    if (!saved || typeof uid !== 'string' || !uid || saved.uid !== uid || !Number.isFinite(saved.savedAt) ||
        saved.savedAt > now + 300000 || now - saved.savedAt > 7 * 86400000 ||
        !Number.isFinite(saved.clockOffset) || !validCachedData_(saved.data) ||
        saved.data.month !== dataCacheMonth_(saved.data.timeZone, saved.clockOffset, now)) return null;
    return saved;
  } catch (_) { return null; }
}
(function () {
  'use strict';
  var app = { view: 'overview', data: null, month: null, request: 0, draft: null, pending: null,
    queue: [], syncSaving: false, syncError: null, revision: 0, history: [], loading: false, renderPending: false, serverClockOffset: 0,
    session: null, authMode: 'login', authBusy: false, loggingOut: false, cacheState: null };
  var $ = function (selector) { return document.querySelector(selector); };
  var html = function (value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); };
  var number = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 });
  var formatNumber = function (value) { return number.format(Number(value) || 0); };
  var money = function (value) { return formatNumber(Math.round(Number(value) || 0)) + ' ₫'; };
  var compact = function (value) {
    value = Number(value) || 0;
    if (value < 1000000) return money(value);
    var rounded = Math.round(value / 10000) * 10000;
    return (rounded !== value ? '≈' : '') + formatNumber(value / 1000000) + ' tr';
  };
  var icon = function (name) { return '<svg aria-hidden="true"><use href="#i-' + name + '"></use></svg>'; };
  var colors = ['#6f9d76','#b3d495','#edb48c','#d98d6d','#d8bf99','#9baeb5','#c1c6a2'];
  var expenseCategories = ['Ăn uống','Sinh hoạt','Đi lại','Mua sắm','Sức khỏe','Giải trí','Khác'];
  var incomeCategories = ['Lương','Thưởng','Thu nhập khác'];
  var installPrompt = null;
  window.addEventListener('beforeinstallprompt', function (event) {
    event.preventDefault(); installPrompt = event;
  });
  window.addEventListener('appinstalled', function () {
    installPrompt = null; toast('Đã cài đặt ứng dụng.');
  });

  function rawRpc(method, payload) {
    return new Promise(function (resolve, reject) {
      if (typeof google === 'undefined' || !google.script || !google.script.run) {
        reject(new Error('Ứng dụng cần được mở từ đường dẫn triển khai Google Apps Script.')); return;
      }
      var runner = google.script.run.withSuccessHandler(resolve).withFailureHandler(function (e) { reject(new Error(e && e.message || 'Không thể kết nối tới Trang tính.')); });
      runner[method](payload);
    });
  }
  function rpc(method, payload) {
    var request = Object.assign({}, payload || {}, { token: app.session && app.session.token });
    return rawRpc(method, request).catch(function (error) {
      if (/AUTH_REQUIRED/.test(error.message)) showAuth('Phiên đăng nhập đã hết. Hãy đăng nhập lại để tiếp tục.');
      throw error;
    });
  }
  var sessionKey = 'moi-ngay.session.v1';
  var useIosPartitionedSession = !window.__MOI_NGAY_HOSTED__ && window.isSecureContext && canUseIosPartitionedSession_(navigator.userAgent, navigator.platform, navigator.maxTouchPoints, typeof Math.sumPrecise === 'function');
  function storeSession(value) {
    try {
      if (value) localStorage.setItem(sessionKey, JSON.stringify(value));
      else { localStorage.removeItem(sessionKey); localStorage.removeItem(dataCacheKey_); }
    } catch (_) {}
    if (useIosPartitionedSession) writePartitionedSessionToken_(document, value && value.token);
  }
  function restoreSession() {
    try {
      var saved = JSON.parse(localStorage.getItem(sessionKey) || 'null');
      if (saved && /^[0-9a-f]{96}$/.test(saved.token || '')) return saved;
    } catch (_) {}
    var token = useIosPartitionedSession ? readPartitionedSessionToken_(document) : '';
    return token ? { token: token } : null;
  }
  function sessionStillCurrent(token) {
    if (!window.__MOI_NGAY_HOSTED__) return true;
    var current = restoreSession();
    return !!(current && current.token === token);
  }
  function rememberDisplayName(value) {
    if (!app.session) return;
    var name = typeof value === 'string' ? value.trim().slice(0, 80) : '';
    if (app.session.displayName === name) return;
    app.session.displayName = name; storeSession(app.session);
  }
  function showRememberedGreeting(session) {
    var name = session && typeof session.displayName === 'string' ? session.displayName.trim().slice(0, 80) : '';
    var title = $('#auth-title'); title.textContent = 'Chào mừng trở lại!';
    // Các trang HTML cũ vẫn hoạt động trong lúc trình duyệt cập nhật bản mới.
    if ($('#auth-loading')) $('#auth-screen').classList.add('is-restoring');
    if (!name) return;
    var line = document.createElement('span');
    line.setAttribute('data-greeting-name', ''); line.textContent = name; line.title = name;
    line.style.display = 'block'; line.style.whiteSpace = 'nowrap';
    title.appendChild(document.createTextNode(' ')); title.appendChild(line); fitGreetingName();
  }
  function showAuth(message) {
    app.request++; app.loading = false;
    app.cacheState = null; updateCacheStatus();
    $('#auth-screen').classList.remove('is-restoring');
    document.documentElement.classList.remove('preparing-session');
    $('#private-app').hidden = true; $('#private-nav').hidden = true; $('#auth-screen').hidden = false;
    if ($('#dialog').open) $('#dialog').close();
    if (app.queue.length) message = (message || 'Hãy đăng nhập lại.') + ' Còn ' + app.queue.length + ' thay đổi chưa lưu; hãy đăng nhập đúng tài khoản trước để tiếp tục lưu.';
    $('#auth-error').textContent = message || ''; $('#auth-error').hidden = !message;
    if (message) { app.authMode = 'login'; updateAuthMode(); $('#auth-error').textContent = message; $('#auth-error').hidden = false; }
    updateSyncStatus();
    window.scrollTo(0,0);
  }
  function updateAuthMode() {
    var creating = app.authMode === 'register';
    document.querySelectorAll('[data-auth-mode]').forEach(function (button) {
      var active = button.dataset.authMode === app.authMode;
      button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
    });
    $('#auth-title').textContent = creating ? 'Bắt đầu mỗi ngày!' : 'Chào mừng trở lại!';
    $('#auth-subtitle').textContent = creating ? 'Tạo tài khoản để có không gian của riêng bạn.' : 'Đăng nhập để tiếp tục chăm chút cho mỗi ngày.';
    $('#auth-confirm-field').hidden = !creating; $('#auth-confirm').required = creating;
    $('#auth-password').autocomplete = creating ? 'new-password' : 'current-password';
    $('#auth-submit').textContent = creating ? 'Tạo tài khoản' : 'Đăng nhập';
    $('#auth-error').hidden = true; $('#auth-error').textContent = '';
    if ($('#auth-retry')) $('#auth-retry').hidden = true;
  }
  function setAuthBusy(busy, restoring) {
    app.authBusy = busy; $('#auth-submit').disabled = busy;
    document.querySelectorAll('[data-auth-mode]').forEach(function (button) { button.disabled = busy; });
    $('#auth-submit').textContent = busy ? (restoring ? 'Chờ một chút nhé…!' : 'Đang xử lý…') : (app.authMode === 'register' ? 'Tạo tài khoản' : 'Đăng nhập');
  }
  function updateCacheStatus() {
    var status = $('#cache-status'); if (!status) return;
    status.hidden = !app.cacheState;
    if (!app.cacheState) { status.innerHTML = ''; return; }
    status.className = 'cache-status' + (app.cacheState === 'error' ? ' cache-error' : '');
    status.innerHTML = app.cacheState === 'error'
      ? '<span>Chưa cập nhật được dữ liệu. Số liệu đang xem có thể cũ.<small>Thử lại để tiếp tục thao tác.</small></span><button type="button" data-action="retry-cache">Thử lại</button>'
      : '<span class="sync-spinner" aria-hidden="true"></span><span>Đang hiển thị dữ liệu đã lưu và cập nhật từ Google…<small>Chờ cập nhật xong để thao tác.</small></span>';
  }
  function saveCurrentDataCache() {
    if (!app.session || !app.data || app.queue.length || app.syncError || app.loading || app.cacheState || !sessionStillCurrent(app.session.token)) return;
    try { writeDataCache_(localStorage, app.session.uid, app.data, app.serverClockOffset, Date.now()); } catch (_) {}
  }
  function toHex(bytes) { return Array.from(bytes).map(function (value) { return value.toString(16).padStart(2, '0'); }).join(''); }
  function fromHex(value) { return new Uint8Array(value.match(/../g).map(function (part) { return parseInt(part, 16); })); }
  async function derivePassword(password, salt, iterations) {
    if (!window.crypto || !window.crypto.subtle || !window.crypto.getRandomValues || typeof TextEncoder === 'undefined') throw new Error('Thiết bị không hỗ trợ bảo vệ mật khẩu. Hãy mở ứng dụng bằng Safari hoặc trình duyệt mới.');
    if (!/^[0-9a-f]{32}$/.test(salt) || iterations !== 600000) throw new Error('Không thể xác minh cài đặt bảo mật.');
    var key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    var bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: fromHex(salt), iterations: iterations, hash: 'SHA-256' }, key, 256);
    return new Uint8Array(bits);
  }
  async function activateSession(session, initialData, initialRevision, cachedSnapshot) {
    // Không chuyển tài khoản khi còn thay đổi chưa gửi của người dùng trước.
    if (app.queue.length && session.uid !== app.queue[0].uid) {
      rawRpc('logoutAccount', { token: session.token }).catch(function () {});
      throw new Error('Còn thay đổi chưa lưu. Hãy đăng nhập lại tài khoản trước để lưu xong.');
    }
    var previous = app.session && app.session.uid;
    app.session = session; storeSession(session);
    $('#auth-form').reset(); $('#auth-error').hidden = true;
    $('#auth-password').type = 'password'; $('#auth-show-password').textContent = 'Hiện';
    $('#auth-show-password').setAttribute('aria-label', 'Hiện mật khẩu');
    if (!app.queue.length || previous !== session.uid) {
      app.view = 'overview'; app.data = null; app.month = null; app.history = []; app.revision = 0;
      if (!initialData) $('#content').innerHTML = '<div class="loading-card"><span class="spinner"></span><span>Đang tải dữ liệu của bạn…</span></div>';
    }
    if (initialData) {
      app.request++; app.loading = !!cachedSnapshot;
      var serverTime = Date.parse(initialData.serverNow || '');
      if (cachedSnapshot) app.serverClockOffset = cachedSnapshot.clockOffset;
      else if (isFinite(serverTime)) app.serverClockOffset = serverTime - Date.now();
      replayMutations_(initialData, app.history, initialRevision);
      app.data = initialData; app.month = initialData.month;
      rememberDisplayName(initialData.displayName); render(true);
    }
    $('#auth-screen').hidden = true; $('#private-app').hidden = false; $('#private-nav').hidden = false;
    $('#auth-screen').classList.remove('is-restoring');
    document.documentElement.classList.remove('preparing-session');
    app.syncError = null; updateSyncStatus(); updateCacheStatus();
    if (initialData) fitGreetingName(); else load(app.month);
    if (initialData && !cachedSnapshot) saveCurrentDataCache();
    if (app.queue.length) processSyncQueue();
  }
  async function logout() {
    if (app.loggingOut) return;
    if (app.queue.length || app.syncSaving) { toast('Hãy đợi lưu hết các thay đổi trước khi đăng xuất.', true); return; }
    app.loggingOut = true;
    var logoutButton = $('[data-action="logout"]');
    if (logoutButton) { logoutButton.disabled = true; logoutButton.textContent = 'Đang đăng xuất…'; }
    var token = app.session && app.session.token;
    try {
      await rawRpc('logoutAccount', { token: token });
      app.session = null; storeSession(null); app.data = null; app.month = null; app.history = [];
      $('#content').innerHTML = ''; showAuth(''); updateAuthMode();
    } catch (_) { toast('Chưa thể đăng xuất. Hãy kiểm tra kết nối và thử lại.', true); }
    finally {
      app.loggingOut = false;
      if (logoutButton && logoutButton.isConnected) { logoutButton.disabled = false; logoutButton.textContent = 'Đăng xuất'; }
    }
  }
  document.querySelectorAll('[data-auth-mode]').forEach(function (button) {
    button.addEventListener('click', function () { if (!app.authBusy) { app.authMode = button.dataset.authMode; updateAuthMode(); } });
  });
  $('#auth-show-password').addEventListener('click', function () {
    var field = $('#auth-password'), showing = field.type === 'text'; field.type = showing ? 'password' : 'text';
    this.textContent = showing ? 'Hiện' : 'Ẩn'; this.setAttribute('aria-label', showing ? 'Hiện mật khẩu' : 'Ẩn mật khẩu');
  });
  if ($('#auth-retry')) $('#auth-retry').addEventListener('click', function () { if (!app.authBusy) startAuth(); });
  $('#auth-form').addEventListener('submit', async function (event) {
    event.preventDefault(); if (app.authBusy) return;
    var form = event.currentTarget, username = form.elements.username.value.trim().toLowerCase(), password = form.elements.password.value;
    $('#auth-error').hidden = true;
    if (app.authMode === 'register' && password !== form.elements.confirm.value) { $('#auth-error').textContent = 'Hai mật khẩu chưa giống nhau.'; $('#auth-error').hidden = false; return; }
    setAuthBusy(true);
    try {
      var session;
      if (app.authMode === 'register') {
        if (!window.crypto || !window.crypto.getRandomValues) throw new Error('Thiết bị không hỗ trợ bảo vệ mật khẩu. Hãy dùng Safari hoặc trình duyệt mới.');
        var saltBytes = new Uint8Array(16); crypto.getRandomValues(saltBytes);
        var salt = toHex(saltBytes), proof = await derivePassword(password, salt, 600000);
        var verifier = toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', proof)));
        session = await rawRpc('registerAccount', { username: username, salt: salt, verifier: verifier });
      } else {
        var details = await rawRpc('getLoginSalt', { username: username });
        var loginProof = await derivePassword(password, details.salt, Number(details.iterations));
        session = await rawRpc('loginAccount', { username: username, proof: toHex(loginProof) });
      }
      await activateSession(session);
    } catch (error) { $('#auth-error').textContent = (error.message || 'Không thể kết nối. Hãy thử lại.').replace(/^AUTH_REQUIRED:\s*/, ''); $('#auth-error').hidden = false; }
    finally { setAuthBusy(false); }
  });
  async function startAuth() {
    var saved = restoreSession();
    if (!saved || !saved.token) { document.documentElement.classList.remove('preparing-session'); return; }
    $('#auth-error').hidden = true;
    if ($('#auth-retry')) $('#auth-retry').hidden = true;
    showRememberedGreeting(saved); setAuthBusy(true, true);
    document.documentElement.classList.remove('preparing-session');
    try {
      var revision = app.revision;
      var settled = null;
      var dataRequest = rawRpc('getAppData', { token: saved.token, month: null }).then(
        function (data) { return settled = {data:data}; }, function (error) { return settled = {error:error}; }
      );
      var user = await rawRpc('getSession', { token: saved.token });
      if (!sessionStillCurrent(saved.token)) { showAuth('Tài khoản trên thiết bị đã thay đổi. Hãy đăng nhập lại.'); return; }
      var session = { token: saved.token, uid: user.uid, username: user.username, expires: saved.expires, displayName: saved.displayName };
      var cached = null;
      try { if ($('#cache-status')) cached = readDataCache_(localStorage, user.uid, Date.now()); } catch (_) {}
      // Nếu dữ liệu mới đã sẵn sàng thì dùng luôn; không chớp qua bản lưu cũ.
      if (cached && (!settled || (settled.error && !/AUTH_REQUIRED/.test(settled.error.message)))) {
        app.cacheState = 'refreshing';
        await activateSession(session, cached.data, revision, cached);
        await finishCacheRefresh(dataRequest, app.request, revision, session);
      } else {
        var result = await dataRequest;
        if (result.error) throw result.error;
        if (!validCachedData_(result.data)) throw new Error('Dữ liệu tải về không hợp lệ.');
        await activateSession(session, result.data, revision);
      }
    } catch (error) {
      var expired = /AUTH_REQUIRED/.test(error.message), changed = !sessionStillCurrent(saved.token);
      if (expired && !changed) storeSession(null);
      app.cacheState = null; updateCacheStatus();
      $('#auth-screen').classList.remove('is-restoring');
      updateAuthMode();
      $('#auth-error').textContent = changed ? 'Tài khoản trên thiết bị đã thay đổi. Hãy đăng nhập lại.' : expired ? 'Phiên đăng nhập đã hết. Hãy đăng nhập lại.' : 'Chưa thể tải dữ liệu. Hãy kiểm tra mạng và thử lại.';
      $('#auth-error').hidden = false;
      if (!expired && !changed && $('#auth-retry')) $('#auth-retry').hidden = false;
    } finally { setAuthBusy(false); }
  }
  async function finishCacheRefresh(request, seq, revision, session) {
    var result = await request;
    if (seq !== app.request || !app.session || app.session.uid !== session.uid || app.session.token !== session.token) return;
    if (!sessionStillCurrent(session.token)) {
      app.session = null; showAuth('Tài khoản trên thiết bị đã thay đổi. Hãy đăng nhập lại.'); return;
    }
    app.loading = false;
    if (result.error || !validCachedData_(result.data)) {
      if (result.error && /AUTH_REQUIRED/.test(result.error.message || '')) {
        storeSession(null); app.session = null; showAuth('Phiên đăng nhập đã hết. Hãy đăng nhập lại.'); return;
      }
      app.cacheState = 'error'; updateCacheStatus(); return;
    }
    app.cacheState = null;
    var data = result.data, serverTime = Date.parse(data.serverNow || '');
    if (isFinite(serverTime)) app.serverClockOffset = serverTime - Date.now();
    replayMutations_(data, app.history, revision);
    app.data = data; app.month = data.month;
    rememberDisplayName(data.displayName); render(true); fitGreetingName();
    updateCacheStatus(); pruneHistory(); saveCurrentDataCache();
  }
  function retryCacheRefresh() {
    if (app.cacheState !== 'error' || !app.session) return;
    app.cacheState = 'refreshing'; app.loading = true; updateCacheStatus();
    var seq = ++app.request, revision = app.revision, session = app.session;
    var request = rawRpc('getAppData', {token:session.token,month:null}).then(
      function (data) { return {data:data}; }, function (error) { return {error:error}; }
    );
    finishCacheRefresh(request, seq, revision, session);
  }
  function toast(message, isError) {
    var node = $('#toast'); node.textContent = message; node.className = 'toast show' + (isError ? ' error' : '');
    clearTimeout(toast.timer); toast.timer = setTimeout(function () { node.className = 'toast'; }, 3800);
  }
  function monthText(month) { var parts = month.split('-'); return 'Tháng ' + Number(parts[1]) + ', ' + parts[0]; }
  function dateText(date) { var p = date.split('-'); return Number(p[2]) + '/' + Number(p[1]) + '/' + p[0]; }
  function shiftDate(date, amount) {
    var p = date.split('-').map(Number); var d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + amount)); return d.toISOString().slice(0, 10);
  }
  function shiftMonth(month, amount) {
    var p = month.split('-').map(Number); var d = new Date(Date.UTC(p[0], p[1] - 1 + amount, 1)); return d.toISOString().slice(0, 7);
  }
  function todayForApp() {
    if (!app.data) return '';
    try {
      var values = {};
      new Intl.DateTimeFormat('en-US',{timeZone:app.data.timeZone || 'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'})
        .formatToParts(new Date(Date.now()+app.serverClockOffset)).forEach(function (part) { values[part.type] = part.value; });
      return values.year + '-' + values.month + '-' + values.day;
    } catch (_) { return app.data.today; }
  }
  function dateForMonth() { var today=todayForApp(); return app.data && app.month === today.slice(0, 7) ? today : app.month + '-01'; }
  function rateAt(kind, date) { return rateForData_(app.data,kind,date); }
  function scheduledRate(kind) {
    return app.data.rates.filter(function (r) { return r.kind === kind && r.effective > todayForApp(); }).sort(function (a,b) { return a.effective.localeCompare(b.effective); })[0] || null;
  }
  function summary() {
    var out = { units: 0, overtime: 0, wages: 0, bonus: 0, bonusAwards: [], income: 0, expenses: 0, categories: [] };
    var categories = Object.create(null);
    app.data.attendance.forEach(function (row) { out.units += row.units; out.overtime += row.overtimeHours; out.wages += row.units * row.dayRate + row.overtimeHours * row.overtimeRate; });
    app.data.transactions.forEach(function (row) {
      if (row.type === 'income') out.income += row.amount;
      else { out.expenses += row.amount; categories[row.category] = (categories[row.category] || 0) + row.amount; }
    });
    var bonus = calculateAttendanceBonus_(app.data);
    out.bonus = bonus.total; out.bonusAwards = bonus.awards; out.wages += bonus.total;
    out.categories = Object.keys(categories).map(function (name) { return { name:name, amount:categories[name] }; }).sort(function(a,b) { return b.amount-a.amount; });
    return out;
  }
  function setHeading() {
    var names = {
      overview:['Xin chào!','Một ngày mới, thêm nhiều điều tốt lành.'],
      attendance:['Chấm công','Mỗi ngày làm việc đều được ghi lại gọn gàng.'],
      transactions:['Thu chi','Những khoản nhỏ cũng xứng đáng được chăm chút.'],
      budget:['Ngân sách','Chủ động với kế hoạch chi tiêu của bạn.'],
      reports:['Báo cáo','Nhìn lại một tháng của bạn.'],
      settings:['Cài đặt','Tùy chỉnh đơn giá phù hợp với công việc.']
    };
    var displayName = app.view === 'overview' && app.data ? String(app.data.displayName || '') : '';
    var title = $('#page-title');
    title.textContent = names[app.view][0] + (displayName ? ' ' : '');
    title.style.overflowWrap = 'anywhere';
    title.parentElement.style.minWidth = '0'; title.parentElement.style.maxWidth = '100%';
    if (displayName) {
      var name = document.createElement('span');
      name.setAttribute('data-greeting-name', ''); name.textContent = displayName;
      name.title = displayName;
      name.style.display = 'block'; name.style.whiteSpace = 'nowrap';
      title.appendChild(name); fitGreetingName();
    }
    $('#page-subtitle').textContent = names[app.view][1];
    $('#month-label').textContent = monthText(app.month);
    document.querySelectorAll('[data-nav]').forEach(function (node) {
      var active = node.dataset.nav === app.view || (node.closest('.mobile-nav') && node.dataset.nav === 'overview' && ['budget','reports'].indexOf(app.view) >= 0);
      node.classList.toggle('active', active); if (active) node.setAttribute('aria-current','page'); else node.removeAttribute('aria-current');
    });
  }
  function fitGreetingName() {
    document.querySelectorAll('[data-greeting-name]').forEach(function (name) {
      name.style.fontSize = '';
      var width = name.clientWidth, needed = name.scrollWidth;
      var size = parseFloat(window.getComputedStyle(name).fontSize);
      if (width > 0 && needed > width && isFinite(size)) {
        name.style.fontSize = Math.max(1, size * width / needed * 0.98).toFixed(2) + 'px';
      }
    });
  }
  function hasPendingAttendance(date) {
    return app.queue.some(function (item) { return (item.method === 'saveAttendance' || item.method === 'deleteAttendance') && item.payload.date === date; });
  }
  function hasPendingTransaction(id) {
    return app.queue.some(function (item) { return (item.method === 'saveTransaction' || item.method === 'deleteTransaction') && item.payload.id === id; });
  }
  function updateSyncStatus() {
    var status = $('#sync-status');
    if (!status) {
      status = document.createElement('div'); status.id = 'sync-status';
      status.setAttribute('role','status'); status.setAttribute('aria-live','polite');
      document.body.appendChild(status);
    }
    var count = app.queue.length;
    status.hidden = !count || !$('#auth-screen').hidden;
    if (!count) { status.innerHTML = ''; return; }
    status.className = 'sync-status' + (app.syncError ? ' sync-error' : '');
    if (app.syncError) {
      status.innerHTML = '<span><strong>Chưa lưu '+count+' thay đổi.</strong> Giữ ứng dụng mở và thử lại. <small>'+html(app.syncError)+'</small></span><button type="button" data-action="retry-sync">Thử lại</button>';
    } else {
      status.innerHTML = '<span class="sync-spinner" aria-hidden="true"></span><span>Đang lưu '+count+' thay đổi lên Google… <small>Giữ ứng dụng mở đến khi lưu xong.</small></span>';
    }
  }
  function pruneHistory() {
    if (!app.loading) app.history = app.history.filter(function (task) { return !task.settledRevision; });
  }
  async function processSyncQueue() {
    if (app.syncSaving || app.syncError || !app.queue.length) return;
    if (!app.session || app.queue[0].uid !== app.session.uid) {
      app.syncError = 'Hãy đăng nhập lại tài khoản đã tạo những thay đổi này.';
      updateSyncStatus(); showAuth(app.syncError); return;
    }
    app.syncSaving = true; updateSyncStatus();
    var item = app.queue[0];
    try {
      item.result = await rpc(item.method,item.payload);
      item.settledRevision = ++app.revision;
      app.queue.shift();
      // Đối chiếu dữ liệu đã lưu rồi áp dụng lại mọi thay đổi đến sau theo đúng thứ tự.
      projectMutation_(app.data,item);
      app.queue.forEach(function (next) { projectMutation_(app.data,next); });
      if (item.method === 'saveProfile' && app.data) rememberDisplayName(app.data.displayName);
      if (app.data && app.data.month === app.month) render();
    } catch (error) {
      app.syncError = error.message || 'Không thể kết nối Google.';
    } finally {
      app.syncSaving = false; updateSyncStatus(); pruneHistory();
      if (!app.queue.length && !app.syncError) saveCurrentDataCache();
      if (!app.queue.length) toast('Đã lưu các thay đổi lên Google.');
      else if (!app.syncError) processSyncQueue();
    }
  }
  function queueMutation(method, payload) {
    if (app.cacheState) { toast('Vui lòng chờ cập nhật dữ liệu trước khi chỉnh sửa.', true); return; }
    if (app.loggingOut || !app.session) { showMutationError('Đang đăng xuất. Vui lòng thử lại sau.'); return; }
    if (!app.data || app.data.month !== app.month) { showMutationError('Đang tải dữ liệu tháng. Vui lòng thử lại sau.'); return; }
    var item = {method:method,payload:payload,uid:app.session.uid,createdRevision:++app.revision,settledRevision:0,result:null};
    clearTimeout(toast.timer); $('#toast').className = 'toast'; $('#toast').textContent = '';
    app.queue.push(item); app.history.push(item);
    projectMutation_(app.data,item); closeDialog(); render(true); updateSyncStatus(); processSyncQueue();
  }
  function saveAttendanceFromForm(form, units) {
    var field = form.elements.hours;
    var hours = Number(field.value);
    if (!field.validity.valid || !isFinite(hours) || hours < 0 || hours > 24) {
      showMutationError('Số giờ tăng ca phải từ 0 đến 24.'); return;
    }
    queueMutation('saveAttendance',{date:app.draft.date,units:units,overtimeHours:hours,note:form.elements.note.value});
  }
  async function load(month) {
    var seq = ++app.request, revision = app.revision, loaded = false; if (month) app.month = month;
    app.loading = true;
    $('#content').innerHTML = '<div class="loading-card"><span class="spinner"></span><span>Đang tải dữ liệu của bạn…</span></div>';
    try {
      var data = await rpc('getAppData', {month:month || null}); if (seq !== app.request) return;
      var serverTime = Date.parse(data.serverNow || '');
      if (isFinite(serverTime)) app.serverClockOffset = serverTime - Date.now();
      // Dữ liệu tải chậm không được ghi đè thay đổi mới hoặc đang chờ lưu.
      replayMutations_(data,app.history,revision);
      app.data = data; app.month = data.month; rememberDisplayName(data.displayName); render(); loaded = true;
    } catch (e) {
      if (seq !== app.request) return;
      $('#content').innerHTML = '<section class="card"><h2 class="card-title">Chưa thể tải dữ liệu</h2><p class="empty-text" style="margin:12px 0">' + html(e.message) + '</p><button class="button button-light" data-action="retry">Thử lại</button></section>';
    } finally { if (seq === app.request) { app.loading = false; pruneHistory(); if (loaded) saveCurrentDataCache(); } }
  }
  function showMutationError(message) {
    if ($('#dialog').open) {
      var error = $('#dialog-error');
      if (!error) { error = document.createElement('p'); error.id = 'dialog-error'; error.className = 'dialog-error'; error.setAttribute('role','alert'); $('#dialog .dialog-inner').appendChild(error); }
      error.textContent = message;
    } else toast(message, true);
  }
  function render(force) {
    if (!app.data) return;
    var active = document.activeElement, content = $('#content');
    if (!force && active && content.contains(active) && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) { app.renderPending = true; return; }
    // Giữ các ô cài đặt đang nhập dở khi một thay đổi khác hoàn tất ở nền.
    var drafts = Array.from(content.querySelectorAll('form[data-dirty="true"]')).map(function (form) {
      var values = {};
      Array.from(form.elements).forEach(function (field) { if (field.name) values[field.name] = field.value; });
      return {kind:form.dataset.form,subkind:form.dataset.kind || '',values:values};
    });
    app.renderPending = false; setHeading();
    var views = { overview:overviewView, attendance:attendanceView, transactions:transactionsView, budget:budgetView, reports:reportsView, settings:settingsView };
    content.innerHTML = views[app.view]();
    drafts.forEach(function (draft) {
      var form = Array.from(content.querySelectorAll('form[data-form]')).find(function (item) {
        return item.dataset.form === draft.kind && (item.dataset.kind || '') === draft.subkind;
      });
      if (!form) return;
      Object.keys(draft.values).forEach(function (name) { if (form.elements[name]) form.elements[name].value = draft.values[name]; });
      form.dataset.dirty = 'true';
    });
    if (app.cacheState) content.querySelectorAll('form input,form select,form textarea').forEach(function (field) { field.disabled = true; });
  }
  function metric(iconName, label, value, detail, title) {
    return '<div class="metric"><div class="metric-icon">'+icon(iconName)+'</div><div><div class="metric-label">'+html(label)+'</div><div class="metric-value" title="'+html(title || value)+'">'+html(value)+'</div><div class="metric-note">'+html(detail)+'</div></div></div>';
  }
  function metricGrid(s) {
    return '<div class="metric-grid">' + metric('calendar','Ngày công',formatNumber(s.units)+' công','Trong tháng') +
      metric('clock','Tăng ca',formatNumber(s.overtime)+' giờ','Trong tháng') +
      metric('coins','Lương dự kiến',compact(s.wages),s.wages>=1000000?money(s.wages)+' · gồm tăng ca, chuyên cần':'Gồm công, tăng ca, chuyên cần',money(s.wages)) +
      metric('wallet','Chi tiêu',compact(s.expenses),s.expenses>=1000000?money(s.expenses):'Trong tháng',money(s.expenses)) + '</div>';
  }
  function calendar() {
    var pieces=app.month.split('-').map(Number), first=new Date(Date.UTC(pieces[0],pieces[1]-1,1)), days=new Date(Date.UTC(pieces[0],pieces[1],0)).getUTCDate();
    var offset=(first.getUTCDay()+6)%7, byDate={}; app.data.attendance.forEach(function(row){byDate[row.date]=row;});
    var output='<div class="calendar-weekdays">'+['T2','T3','T4','T5','T6','T7','CN'].map(function(d){return '<span>'+d+'</span>';}).join('')+'</div><div class="calendar-grid">';
    for(var i=0;i<offset;i++) output+='<div class="empty"></div>';
    for(var day=1;day<=days;day++) {
      var date=app.month+'-'+String(day).padStart(2,'0'), row=byDate[date], classes='calendar-day';
      if(date===todayForApp()) classes+=' today'; if(row&&row.units) classes+=' has-work'; if(row&&row.overtimeHours) classes+=' has-overtime'; if(hasPendingAttendance(date)) classes+=' pending-attendance';
      var label=row ? (row.units===1?'1 công':row.units===0.5?'½ công':'') : '';
      if(row&&row.overtimeHours) label+=(label?' · ':'')+'+'+formatNumber(row.overtimeHours)+'h';
      output+='<button type="button" class="'+classes+'" data-action="day" data-date="'+date+'" aria-label="Ngày '+dateText(date)+(label?', '+html(label):'')+(hasPendingAttendance(date)?', chưa lưu lên Google':'')+'"><span class="calendar-number">'+day+'</span><span class="calendar-info">'+html(label)+'</span></button>';
    }
    return output+'</div><div class="calendar-legend"><span><i class="legend-dot"></i>Đã chấm công</span><span><i class="legend-dot ot"></i>Có tăng ca</span><span>Chạm vào ngày để ghi công</span></div>';
  }
  function calendarCard(link) {
    return '<section class="card"><div class="card-head"><div><h2 class="card-title">'+icon('calendar')+' Lịch chấm công</h2><p class="card-subtitle">'+html(monthText(app.month))+'</p></div>'+(link?'<button class="text-button" data-nav="attendance">Xem chi tiết</button>':'')+'</div>'+calendar()+'</section>';
  }
  function budgetCard(s, link) {
    var budget=app.data.budget, ratio=budget?Math.round(s.expenses/budget*100):0, remaining=budget-s.expenses;
    return '<section class="card"><div class="card-head"><div><h2 class="card-title">'+icon('target')+' Ngân sách tháng</h2><p class="card-subtitle">Một kế hoạch nhỏ, an tâm hơn</p></div>'+(link?'<button class="text-button" data-nav="budget">Quản lý</button>':'')+'</div>'+
      (budget ? '<div class="budget-amount">'+html(compact(s.expenses))+' <small>/ '+html(money(budget))+'</small></div><div class="progress'+(ratio>100?' over':'')+'"><span style="width:'+Math.min(100,ratio)+'%"></span></div><div class="budget-caption"><span>Đã dùng '+ratio+'%</span><strong class="'+(remaining<0?'over-text':'')+'">'+(remaining<0?'Vượt ':'Còn ')+html(money(Math.abs(remaining)))+'</strong></div>' : '<p class="empty-text">Bạn chưa đặt ngân sách cho tháng này.</p><div class="progress"><span style="width:0%"></span></div><button class="text-button" data-nav="budget">Thiết lập ngân sách</button>')+'</section>';
  }
  function distributionCard(s, link) {
    var start=0, stops=[], list='';
    s.categories.forEach(function(category,index){ var end=start+(category.amount/s.expenses*100), color=colors[index%colors.length]; stops.push(color+' '+start+'% '+end+'%'); start=end; list+='<li><span class="category-dot" style="background:'+color+'"></span><span>'+html(category.name)+'</span><strong>'+Math.round(category.amount/s.expenses*100)+'%</strong></li>'; });
    return '<section class="card"><div class="card-head"><div><h2 class="card-title">'+icon('chart')+' Cơ cấu chi tiêu</h2><p class="card-subtitle">Các khoản chi trong tháng</p></div>'+(link?'<button class="text-button" data-nav="reports">Báo cáo</button>':'')+'</div>'+
      (s.expenses ? '<div class="distribution"><div class="donut" style="--chart:conic-gradient('+stops.join(',')+')"><div class="donut-center">'+html(compact(s.expenses))+'<small>đã chi</small></div></div><ul class="category-list">'+list+'</ul></div>' : '<div class="empty-state">Chưa có khoản chi nào trong tháng.<br>Hãy bắt đầu bằng nút “Ghi chi tiêu”.</div>')+'</section>';
  }
  function bonusCard(s) {
    var configured = rateAt('bonus_amount',todayForApp()), upcoming = scheduledRate('bonus_amount');
    var details = s.bonusAwards.length ? 'Đạt '+s.bonusAwards.length+' tuần trong tháng' : 'Chưa có tuần đạt thưởng trong tháng';
    var list = s.bonusAwards.map(function (award) { return '<div class="summary-row"><span>Đạt ngày '+html(dateText(award.date))+'</span><strong class="positive">+'+html(money(award.amount))+'</strong></div>'; }).join('');
    return '<section class="card"><div class="card-head"><div><h2 class="card-title">'+icon('check')+' Thưởng chuyên cần</h2><p class="card-subtitle">'+html(details)+'</p></div><button class="text-button" data-nav="settings">Cài đặt</button></div><div class="budget-amount">'+html(money(s.bonus))+'</div>'+(configured||s.bonus||(upcoming&&upcoming.amount)?list:'<p class="field-help">Đặt số ngày và mức thưởng trong Cài đặt để bắt đầu tính.</p>')+'</section>';
  }
  function overviewView() {
    var s=summary(); return metricGrid(s)+'<div class="dashboard-grid">'+calendarCard(true)+'<div class="right-stack">'+bonusCard(s)+budgetCard(s,true)+distributionCard(s,true)+'</div></div>';
  }
  function attendanceView() {
    var s=summary(), rows=app.data.attendance.slice().sort(function(a,b){return b.date.localeCompare(a.date);});
    var list=rows.length?'<div class="record-list">'+rows.map(function(row){return '<div class="record-row"><div class="record-main"><strong>'+html(dateText(row.date))+'</strong><small>'+html(formatNumber(row.units))+' công · '+html(formatNumber(row.overtimeHours))+' giờ tăng ca'+(row.note?' · '+html(row.note):'')+'</small></div><div class="record-end"><strong>'+html(money(row.units*row.dayRate+row.overtimeHours*row.overtimeRate))+'</strong><div class="record-actions"><button data-action="day" data-date="'+html(row.date)+'" aria-label="Sửa ngày '+html(dateText(row.date))+'">'+icon('edit')+'</button></div></div></div>';}).join('')+'</div>':'<div class="empty-state">Chưa có ngày công nào.<br>Chạm vào một ngày trên lịch để bắt đầu.</div>';
    return '<div class="stats-inline"><div class="mini-stat"><span>Tổng ngày công</span><strong>'+formatNumber(s.units)+' công</strong></div><div class="mini-stat"><span>Giờ tăng ca</span><strong>'+formatNumber(s.overtime)+' giờ</strong></div><div class="mini-stat"><span>Lương dự kiến</span><strong>'+html(compact(s.wages))+'</strong></div></div><div class="section-grid">'+calendarCard(false)+'<div class="stack">'+bonusCard(s)+'<section class="card"><div class="card-head"><div><h2 class="card-title">Ngày đã ghi</h2><p class="card-subtitle">Chọn biểu tượng sửa để thay đổi</p></div></div>'+list+'</section></div></div>';
  }
  function transactionsView() {
    var s=summary(), rows=app.data.transactions.slice().sort(function(a,b){return b.date.localeCompare(a.date);});
    var list=rows.length?'<div class="record-list">'+rows.map(function(row){ return '<div class="record-row"><div class="record-main"><strong>'+html(row.category)+'</strong><small>'+html(dateText(row.date))+(row.note?' · '+html(row.note):'')+(hasPendingTransaction(row.id)?' · Chưa lưu lên Google':'')+'</small></div><div class="record-end"><strong class="'+(row.type==='income'?'positive':'negative')+'">'+(row.type==='income'?'+':'−')+html(money(row.amount))+'</strong><div class="record-actions"><button data-action="edit-transaction" data-id="'+html(row.id)+'" aria-label="Sửa khoản '+html(row.category)+'">'+icon('edit')+'</button><button data-action="delete-transaction" data-id="'+html(row.id)+'" aria-label="Xóa khoản '+html(row.category)+'">'+icon('trash')+'</button></div></div></div>'; }).join('')+'</div>':'<div class="empty-state">Chưa có khoản thu chi nào trong tháng này.</div>';
    return '<div class="section-grid"><section class="card"><div class="card-head"><div><h2 class="card-title">'+icon('wallet')+' Sổ thu chi</h2><p class="card-subtitle">Các khoản đã ghi trong tháng</p></div><button class="button button-primary" data-action="new-transaction">'+icon('plus')+' Thêm khoản</button></div>'+list+'</section><div class="stack"><section class="card"><h2 class="card-title">Tóm tắt tháng</h2><div class="summary-row"><span>Thu nhập thực nhận</span><strong class="positive">'+html(money(s.income))+'</strong></div><div class="summary-row"><span>Tổng chi tiêu</span><strong class="negative">'+html(money(s.expenses))+'</strong></div><div class="summary-row"><span>Thu trừ chi</span><strong>'+html(money(s.income-s.expenses))+'</strong></div><p class="field-help">Thu trừ chi không bao gồm lương dự kiến và không phải số dư tài khoản.</p></section>'+budgetCard(s,true)+'</div></div>';
  }
  function budgetView() {
    var s=summary(); return '<div class="section-grid"><section class="card"><div class="card-head"><div><h2 class="card-title">'+icon('target')+' Đặt ngân sách</h2><p class="card-subtitle">Ngân sách riêng cho '+html(monthText(app.month).toLowerCase())+'</p></div></div><form data-form="budget" class="dialog-form"><div class="field"><label for="budget-amount">Ngân sách chi tiêu (đồng)</label><input id="budget-amount" name="amount" type="number" min="0" step="1" max="1000000000000" value="'+html(app.data.budget)+'" required><span class="field-help">Nhập 0 nếu không muốn đặt ngân sách cho tháng này.</span></div><div><button class="button button-primary" type="submit">Lưu ngân sách</button></div></form></section><div class="stack">'+budgetCard(s,false)+distributionCard(s,true)+'</div></div>';
  }
  function reportsView() {
    var s=summary(); return '<div class="section-grid"><section class="card"><div class="card-head"><div><h2 class="card-title">'+icon('chart')+' Tổng kết tháng</h2><p class="card-subtitle">Dựa trên dữ liệu bạn đã ghi</p></div></div><div class="summary-row"><span>Ngày công</span><strong>'+formatNumber(s.units)+' công</strong></div><div class="summary-row"><span>Giờ tăng ca</span><strong>'+formatNumber(s.overtime)+' giờ</strong></div><div class="summary-row"><span>Thưởng chuyên cần</span><strong class="positive">+'+html(money(s.bonus))+'</strong></div><div class="summary-row"><span>Lương dự kiến</span><strong>'+html(money(s.wages))+'</strong></div><div class="summary-row"><span>Thu nhập thực nhận</span><strong class="positive">'+html(money(s.income))+'</strong></div><div class="summary-row"><span>Chi tiêu</span><strong class="negative">'+html(money(s.expenses))+'</strong></div><div class="summary-row"><span>Thu trừ chi</span><strong>'+html(money(s.income-s.expenses))+'</strong></div><p class="field-help">Lương dự kiến gồm công, tăng ca và chuyên cần; chỉ tính vào thu thực nhận khi bạn tự ghi một khoản thu.</p></section><div class="stack">'+bonusCard(s)+distributionCard(s,false)+budgetCard(s,true)+'</div></div>';
  }
  function rateSetting(kind, label, unit, description) {
    var now=rateAt(kind,todayForApp()), upcoming=scheduledRate(kind), input=upcoming?upcoming.amount:now;
    var status='Hiện tại: '+money(now)+'/'+unit+(upcoming?' · Từ '+dateText(upcoming.effective)+': '+money(upcoming.amount)+'/'+unit:'');
    return '<form class="setting-row" data-form="rate" data-kind="'+kind+'"><div><h3>'+html(label)+'</h3><p>'+html(description)+'</p><p>'+html(status)+'</p></div><div class="field"><label for="rate-'+kind+'">Đơn giá mới (đồng/'+unit+')</label><input id="rate-'+kind+'" name="amount" type="number" min="0" max="1000000000000" step="1" value="'+html(input)+'" required></div><button type="submit" class="button button-primary">Áp dụng</button></form>';
  }
  function bonusSetting() {
    var today=todayForApp(), days=rateAt('bonus_days',today)||6, amount=rateAt('bonus_amount',today);
    var futureDays=scheduledRate('bonus_days'), futureAmount=scheduledRate('bonus_amount');
    var status='Hiện tại: '+days+' ngày đủ công liên tục · thưởng '+money(amount)+'/tuần';
    if(futureDays||futureAmount){
      var effective=futureDays?futureDays.effective:futureAmount.effective;
      status+=' · Từ '+dateText(effective)+': '+(futureDays?futureDays.amount:days)+' ngày · '+money(futureAmount?futureAmount.amount:amount)+'/tuần';
    }
    var inputDays=futureDays?futureDays.amount:days, inputAmount=futureAmount?futureAmount.amount:amount;
    return '<section class="card settings-card"><div class="card-head"><div><h2 class="card-title">'+icon('check')+' Thưởng chuyên cần</h2><p class="card-subtitle">'+html(status)+'</p></div></div><form class="dialog-form" data-form="bonus"><div class="two-fields"><div class="field"><label for="bonus-days">Số ngày đủ 1 công liên tục</label><input id="bonus-days" name="days" type="number" min="1" max="7" step="1" value="'+html(inputDays)+'" required></div><div class="field"><label for="bonus-amount">Tiền thưởng mỗi tuần (đồng)</label><input id="bonus-amount" name="amount" type="number" min="0" max="1000000000000" step="1" value="'+html(inputAmount)+'" required></div></div><div class="notice">Chỉ ngày chấm <strong>đủ 1 công</strong> mới tính; ½ công hoặc không chấm công sẽ ngắt chuỗi. Tuần tính từ thứ Hai đến Chủ nhật, thưởng tối đa một lần mỗi tuần. Tuần giao tháng được tính vào tháng có ngày đạt điều kiện. Nhập 0 đồng để tắt thưởng.</div><div><button type="submit" class="button button-primary">Áp dụng</button></div></form></section>';
  }
  function settingsView() {
    return '<div class="stack"><section class="card settings-card"><div class="account-row"><div><h2 class="card-title">'+icon('home')+' Tài khoản của bạn</h2><p class="account-subtitle">Đang đăng nhập: <span class="account-name">'+html(app.session ? app.session.username : '')+'</span></p></div><button type="button" class="button button-plain" data-action="logout">Đăng xuất</button></div>'+
      '<form class="dialog-form" data-form="profile" style="margin-top:18px;padding-top:18px;border-top:1px solid #edf1e9"><div class="field"><label for="profile-name">Tên của bạn</label><input id="profile-name" name="displayName" type="text" maxlength="80" autocomplete="name" style="font-size:16px" placeholder="Ví dụ: Lê Thị Xuyến" value="'+html(app.data.displayName || '')+'"><span class="field-help">Tên này sẽ xuất hiện trong lời chào ở trang tổng quan.</span></div><div><button type="submit" class="button button-primary">Lưu tên</button></div></form>'+
      (!window.__MOI_NGAY_HOSTED__ && installPlatform_(navigator.userAgent || '', navigator.platform || '', navigator.maxTouchPoints || 0)==='ios'?'<button type="button" class="text-button" data-action="remember-diagnostic" style="margin-top:14px">Kiểm tra ghi nhớ đăng nhập</button>':'')+'</section>'+
      '<section class="card settings-card"><div class="card-head"><div><h2 class="card-title">'+icon('settings')+' Đơn giá công việc</h2><p class="card-subtitle">Bạn có thể thay đổi khi cần.</p></div></div>'+rateSetting('day','Tiền một ngày công','công','Lương dự kiến của một ngày làm việc đầy đủ.')+rateSetting('overtime','Tiền tăng ca','giờ','Đơn giá cho mỗi giờ làm thêm.')+'<div class="notice" style="margin-top:20px"><strong>Khi thay đổi đơn giá:</strong> bạn có thể tính lại tất cả ngày đã ghi hoặc chỉ áp dụng từ ngày mai. Mức cũ của hôm nay và các ngày trước đó sẽ được giữ nguyên nếu chọn từ ngày mai.</div></section>'+bonusSetting()+
      '<section class="card settings-card"><div class="card-head"><div><h2 class="card-title">'+icon('home')+' Cài đặt ứng dụng</h2><p class="card-subtitle">Thêm Chấm công vào màn hình chính iPhone hoặc Android.</p></div></div><button type="button" class="button button-light" data-action="install-app">'+icon('plus')+' Cài đặt ứng dụng</button></section></div>';
  }
  function showDialog(content) { var dialog=$('#dialog'); if(dialog.open) dialog.close(); $('#dialog-content').innerHTML=content; dialog.showModal(); }
  function closeDialog() { if($('#dialog').open) $('#dialog').close(); }
  function dialogHead(title, subtitle) { return '<div class="dialog-head"><div><h2 id="dialog-title">'+html(title)+'</h2><p>'+html(subtitle||'')+'</p></div><button type="button" class="dialog-close" data-action="close-dialog" aria-label="Đóng">'+icon('close')+'</button></div>'; }
  function showRememberDiagnostic() {
    var storage = null;
    try { storage = window.localStorage; } catch (_) {}
    var code = rememberDiagnostic_(document, storage, window.origin || window.location.origin, !!useIosPartitionedSession);
    showDialog('<div class="dialog-inner">'+dialogHead('Kiểm tra ghi nhớ', 'Kiểm tra việc lưu đăng nhập trên thiết bị này')+
      '<div class="notice"><strong>Mã kiểm tra:</strong><br><span style="font-family:monospace;font-size:16px;word-break:break-all">'+html(code)+'</span></div>'+
      '<p class="field-help" style="margin:14px 0">Mã không chứa tên tài khoản, mật khẩu hay mã phiên. Hãy ghi mã này, gạt hẳn app rồi mở lại và bấm Kiểm tra ghi nhớ đăng nhập để lấy mã thứ hai.</p>'+
      '<div class="dialog-actions"><button type="button" class="button button-primary" data-action="close-dialog">Đã hiểu</button></div></div>');
  }
  function attendanceDialog(date) {
    var row=app.data.attendance.find(function(item){return item.date===date;}), units=row?row.units:0, hours=row?row.overtimeHours:0;
    var dayRate=row?row.dayRate:rateAt('day',date), overtimeRate=row?row.overtimeRate:rateAt('overtime',date);
    app.draft={date:date,units:units};
    showDialog('<div class="dialog-inner">'+dialogHead('Chấm công', 'Ngày '+dateText(date))+'<form class="dialog-form" data-form="attendance"><div><div class="field-label" style="margin-bottom:8px">Chọn cách ghi công</div><div class="choice-grid"><button type="button" class="choice '+(units===1?'active':'')+'" data-action="units" data-units="1">Chấm công<small>1 ngày</small></button><button type="button" class="choice '+(units===0.5?'active':'')+'" data-action="units" data-units="0.5">½ công<small>Nửa ngày</small></button><button type="button" class="choice '+(hours?'active':'')+'" data-action="show-overtime">Tăng ca<small>Nhập số giờ</small></button></div><p class="field-help attendance-hint">Chạm 1 công hoặc ½ công để lưu ngay. Với tăng ca và ghi chú, nhập thông tin rồi bấm Lưu ngày.</p><button type="button" class="text-button" data-action="clear-units">Bỏ ngày công</button></div><div class="field" id="overtime-field" '+(hours?'':'hidden')+'><label for="overtime-hours">Số giờ tăng ca</label><input type="number" id="overtime-hours" name="hours" min="0" max="24" step="any" value="'+html(hours)+'"><span class="field-help">Nhập 0 để xóa số giờ tăng ca.</span></div><div class="notice">Đơn giá của ngày này: <strong>'+html(money(dayRate))+'/công</strong> · <strong>'+html(money(overtimeRate))+'/giờ tăng ca</strong></div><div class="field"><label for="attendance-note">Ghi chú <span class="field-help">(không bắt buộc)</span></label><input id="attendance-note" name="note" maxlength="500" placeholder="Ví dụ: ca sáng" value="'+html(row?row.note:'')+'"></div><div class="dialog-actions">'+(row?'<button type="button" class="button button-danger left-action" data-action="delete-day" data-date="'+date+'">Xóa ngày</button>':'')+'<button type="button" class="button button-plain" data-action="close-dialog">Hủy</button><button type="submit" class="button button-primary">Lưu ngày</button></div></form></div>');
  }
  function categoryOptions(type, selected) {
    var categories=type==='income'?incomeCategories:expenseCategories;
    if(selected && categories.indexOf(selected)<0) categories=categories.concat([selected]);
    return categories.map(function(c){return '<option value="'+html(c)+'" '+(c===selected?'selected':'')+'>'+html(c)+'</option>';}).join('');
  }
  function transactionDialog(row, type) {
    row=row||null; var kind=row?row.type:(type||'expense');
    showDialog('<div class="dialog-inner">'+dialogHead(row?'Sửa khoản thu chi':'Thêm khoản thu chi', 'Ghi lại một khoản của bạn')+'<form class="dialog-form" data-form="transaction" data-id="'+html(row?row.id:'')+'"><div class="two-fields"><div class="field"><label for="transaction-type">Loại</label><select id="transaction-type" name="type"><option value="expense" '+(kind==='expense'?'selected':'')+'>Khoản chi</option><option value="income" '+(kind==='income'?'selected':'')+'>Khoản thu</option></select></div><div class="field"><label for="transaction-date">Ngày</label><input id="transaction-date" name="date" type="date" value="'+html(row?row.date:dateForMonth())+'" required></div></div><div class="field"><label for="transaction-amount">Số tiền (đồng)</label><input id="transaction-amount" name="amount" type="number" min="1" step="1" max="1000000000000" value="'+html(row?row.amount:'')+'" placeholder="Ví dụ: 50000" required></div><div class="field"><label for="transaction-category">Danh mục</label><select id="transaction-category" name="category">'+categoryOptions(kind,row?row.category:null)+'</select></div><div class="field"><label for="transaction-note">Ghi chú <span class="field-help">(không bắt buộc)</span></label><input id="transaction-note" name="note" maxlength="500" value="'+html(row?row.note:'')+'" placeholder="Ví dụ: bữa trưa"></div><div class="dialog-actions"><button type="button" class="button button-plain" data-action="close-dialog">Hủy</button><button type="submit" class="button button-primary">Lưu khoản này</button></div></form></div>');
  }
  function newTransactionId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    var bytes = new Uint8Array(16);
    if (window.crypto && typeof window.crypto.getRandomValues === 'function') window.crypto.getRandomValues(bytes);
    else for (var i=0;i<bytes.length;i++) bytes[i]=Math.floor(Math.random()*256);
    return 'tx-' + Array.from(bytes).map(function (value) { return value.toString(16).padStart(2,'0'); }).join('') + '-' + Date.now().toString(36);
  }
  function confirmRate(kind, amount) {
    var futureEffective=shiftDate(todayForApp(),1);
    app.pending={kind:kind,amount:amount,futureEffective:futureEffective}; var unit=kind==='day'?'công':'giờ', label=kind==='day'?'ngày công':'tăng ca';
    showDialog('<div class="dialog-inner">'+dialogHead('Áp dụng đơn giá', 'Đơn giá '+label+' mới: '+money(amount)+' / '+unit)+'<p class="empty-text" style="margin:0 0 16px">Bạn có muốn áp dụng mức này cho tất cả các ngày đã ghi không?</p><div class="rate-choice-group"><button class="button button-light rate-choice" data-action="rate-all"><span>Tất cả các ngày<small>Tính lại cả ngày trước đây và các ngày tiếp theo.</small></span></button><button class="button button-plain rate-choice" data-action="rate-future"><span>Chỉ từ ngày mai<small>Giữ nguyên hôm nay và các ngày trước; áp dụng từ '+html(dateText(futureEffective))+'.</small></span></button></div><div class="dialog-actions" style="margin-top:16px"><button class="button button-plain" data-action="close-dialog">Hủy</button></div></div>');
  }
  function confirmBonus(days, amount) {
    var futureEffective=shiftDate(todayForApp(),1);
    app.pending={type:'bonus',days:days,amount:amount,futureEffective:futureEffective};
    showDialog('<div class="dialog-inner">'+dialogHead('Áp dụng chuyên cần', 'Đủ '+days+' ngày 1 công liên tục: '+money(amount)+' / tuần')+'<p class="empty-text" style="margin:0 0 16px">Bạn muốn áp dụng quy định này cho tất cả các tuần đã ghi không?</p><div class="rate-choice-group"><button class="button button-light rate-choice" data-action="rate-all"><span>Tất cả các tuần<small>Tính lại chuyên cần cho cả các tuần trước đây và sau này.</small></span></button><button class="button button-plain rate-choice" data-action="rate-future"><span>Chỉ từ ngày mai<small>Giữ quy định cũ cho thưởng đạt trước '+html(dateText(futureEffective))+'. Thưởng đạt từ ngày đó dùng quy định mới; chuỗi ngày công trước đó vẫn được tính.</small></span></button></div><div class="dialog-actions" style="margin-top:16px"><button class="button button-plain" data-action="close-dialog">Hủy</button></div></div>');
  }
  function confirmDelete(kind, id) {
    app.pending={kind:kind,id:id}; var description=kind==='day'?'Xóa công, giờ tăng ca và ghi chú của ngày '+dateText(id)+'?':'Xóa khoản thu chi này?';
    showDialog('<div class="dialog-inner">'+dialogHead('Xác nhận xóa',description)+'<div class="dialog-actions"><button class="button button-plain" data-action="close-dialog">Hủy</button><button class="button button-danger" data-action="confirm-delete">Xóa</button></div></div>');
  }
  function installHelp() {
    var platform = installPlatform_(navigator.userAgent || '', navigator.platform || '', navigator.maxTouchPoints || 0);
    var ios = '<ol class="install-steps"><li>Mở đường dẫn ứng dụng trong <strong>Safari</strong>.</li><li>Chạm nút <strong>Chia sẻ</strong> (hình vuông có mũi tên), rồi chọn <strong>Thêm vào MH chính</strong>.</li><li>Kiểm tra tên <strong>Chấm công</strong>; nếu có tùy chọn <strong>Mở dưới dạng ứng dụng web</strong>, hãy bật tùy chọn đó.</li><li>Chạm <strong>Thêm</strong>, rồi mở ứng dụng từ màn hình chính.</li></ol>';
    var android = '<ol class="install-steps"><li>Mở đường dẫn ứng dụng trong <strong>Chrome</strong>.</li><li>Chạm menu <strong>⋮</strong> ở góc trên bên phải.</li><li>Chọn <strong>Cài đặt ứng dụng</strong> hoặc <strong>Thêm vào màn hình chính</strong>.</li><li>Kiểm tra tên <strong>Chấm công</strong> nếu được hỏi, rồi xác nhận <strong>Cài đặt</strong> hoặc <strong>Thêm</strong>.</li></ol>';
    var instructions = platform === 'ios' ? ios : platform === 'android' ? android : '<p class="empty-text">Trên iPhone:</p>'+ios+'<p class="empty-text">Trên Android:</p>'+android;
    var iconNote = platform === 'ios' || platform === 'other' ? '<p class="field-help">Trên iPhone, biểu tượng trên màn hình chính có thể do Google hoặc Safari quyết định.</p>' : '';
    showDialog('<div class="dialog-inner">'+dialogHead('Cài đặt ứng dụng', 'Thêm Chấm công vào màn hình chính')+instructions+iconNote+'<p class="field-help">Trình duyệt sẽ yêu cầu bạn tự xác nhận. Ứng dụng cần kết nối mạng.</p><div class="dialog-actions"><button class="button button-primary" data-action="close-dialog">Đã hiểu</button></div></div>');
  }
  async function installApp() {
    if ((window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true) {
      showDialog('<div class="dialog-inner">'+dialogHead('Đã mở như ứng dụng', 'Chấm công đang chạy từ màn hình chính.')+'<p class="empty-text">Nếu muốn thêm lại biểu tượng, hãy mở đường dẫn ứng dụng trong trình duyệt.</p><div class="dialog-actions"><button class="button button-light" data-action="install-help">Xem hướng dẫn</button><button class="button button-primary" data-action="close-dialog">Đã hiểu</button></div></div>');
      return;
    }
    if (!installPrompt) { installHelp(); return; }
    var prompt = installPrompt; installPrompt = null;
    try { await prompt.prompt(); } catch (_) { installHelp(); }
  }
  document.addEventListener('click', function (event) {
    var button=event.target.closest('button'); if(!button) return;
    if(app.loggingOut) return;
    if(button.dataset.nav){ app.view=button.dataset.nav; if(app.data && app.data.month===app.month) render(true); window.scrollTo(0,0); return; }
    var action=button.dataset.action; if(!action) return;
    if(action==='logout'){logout();return;}
    if(action==='retry-cache'){retryCacheRefresh();return;}
    if(action==='remember-diagnostic'){showRememberDiagnostic();return;}
    if(action==='close-dialog'){closeDialog();return;}
    if(action==='install-app'){installApp();return;}
    if(action==='install-help'){installHelp();return;}
    if(app.cacheState){toast('Vui lòng chờ cập nhật dữ liệu trước khi thao tác.', true);return;}
    if(action==='retry'){load(app.month);return;}
    if(action==='retry-sync'){app.syncError=null;updateSyncStatus();processSyncQueue();return;}
    if(!app.data) return;
    if(action==='previous-month'||action==='next-month'||action==='current-month'){
      var month=action==='current-month'?todayForApp().slice(0,7):shiftMonth(app.month,action==='previous-month'?-1:1); load(month);return;
    }
    if(action==='quick-attendance'){
      if(app.data.month!==app.month){toast('Đang tải dữ liệu tháng. Vui lòng chờ một chút.');return;}
      attendanceDialog(dateForMonth());return;
    }
    if(action==='quick-expense'||action==='new-transaction'){
      if(app.data.month!==app.month){toast('Đang tải dữ liệu tháng. Vui lòng chờ một chút.');return;}
      transactionDialog(null,'expense');return;
    }
    if(action==='day'){attendanceDialog(button.dataset.date);return;}
    if(action==='units'){
      app.draft.units=Number(button.dataset.units);
      saveAttendanceFromForm($('#dialog form[data-form="attendance"]'),app.draft.units);return;
    }
    if(action==='clear-units'){
      app.draft.units=0;
      document.querySelectorAll('[data-action="units"]').forEach(function(item){item.classList.toggle('active',Number(item.dataset.units)===app.draft.units);});return;
    }
    if(action==='show-overtime'){$('#overtime-field').hidden=false;button.classList.add('active');$('#overtime-hours').focus();return;}
    if(action==='edit-transaction'){var row=app.data.transactions.find(function(item){return item.id===button.dataset.id;});if(row)transactionDialog(row);return;}
    if(action==='delete-transaction'){confirmDelete('transaction',button.dataset.id);return;}
    if(action==='delete-day'){confirmDelete('day',button.dataset.date);return;}
    if(action==='confirm-delete'){
      var deleting=app.pending;if(deleting.kind==='day')queueMutation('deleteAttendance',{date:deleting.id});else queueMutation('deleteTransaction',{id:deleting.id});return;
    }
    if(action==='rate-all'||action==='rate-future'){
      var pending=app.pending, mode=action==='rate-all'?'all':'future';
      var effective=mode==='all'?'1900-01-01':pending.futureEffective;
      var sourceForm=pending.type==='bonus' ? $('#content form[data-form="bonus"]') : $('#content form[data-form="rate"][data-kind="'+pending.kind+'"]');
      if(sourceForm) sourceForm.removeAttribute('data-dirty');
      if(pending.type==='bonus') queueMutation('applyAttendanceBonus',{days:pending.days,amount:pending.amount,mode:mode,effectiveDate:effective});
      else queueMutation('applyRate',{kind:pending.kind,amount:pending.amount,mode:mode,effectiveDate:effective});
    }
  });
  function markDirty(event) {
    var form=event.target.form;
    if(form && form.dataset.form && $('#content').contains(form)) form.dataset.dirty='true';
  }
  document.addEventListener('input',markDirty);
  document.addEventListener('change', function(event){
    markDirty(event);
    if(event.target.id==='transaction-type') $('#transaction-category').innerHTML=categoryOptions(event.target.value,null);
  });
  document.addEventListener('focusout',function(event){
    if(app.renderPending && $('#content').contains(event.target)) setTimeout(function(){ if(app.renderPending) render(); },0);
  });
  document.addEventListener('submit', function(event){
    var form=event.target, kind=form.dataset.form;if(!kind)return;event.preventDefault();
    if(app.cacheState){toast('Vui lòng chờ cập nhật dữ liệu trước khi chỉnh sửa.', true);return;}
    if(kind==='profile'){
      var displayName=form.elements.displayName.value.trim();
      if (displayName.length > 80 || /[\u0000-\u001f\u007f]/.test(displayName) || /^[=+\-@]/.test(displayName)) {
        showMutationError('Tên tối đa 80 ký tự và không bắt đầu bằng =, +, - hoặc @.'); return;
      }
      form.removeAttribute('data-dirty'); queueMutation('saveProfile',{displayName:displayName}); return;
    }
    if(kind==='attendance'){
      saveAttendanceFromForm(form,app.draft.units);return;
    }
    if(kind==='transaction'){
      var existingId=form.dataset.id||'', tx={id:existingId||newTransactionId(),create:!existingId,date:form.elements.date.value,type:form.elements.type.value,amount:Number(form.elements.amount.value),category:form.elements.category.value,note:form.elements.note.value};
      queueMutation('saveTransaction',tx);return;
    }
    if(kind==='budget'){form.removeAttribute('data-dirty');queueMutation('saveBudget',{month:app.month,amount:Number(form.elements.amount.value)});return;}
    if(kind==='rate'){confirmRate(form.dataset.kind,Number(form.elements.amount.value));}
    if(kind==='bonus'){confirmBonus(Number(form.elements.days.value),Number(form.elements.amount.value));}
  });
  window.addEventListener('beforeunload',function(event){
    if(app.queue.length){event.preventDefault();event.returnValue='';}
  });
  window.addEventListener('resize', fitGreetingName);
  if (!window.__MOI_NGAY_HOSTED__ && installPlatform_(navigator.userAgent || '', navigator.platform || '', navigator.maxTouchPoints || 0) === 'ios') {
    var diagnosticButton = document.createElement('button'), footnote = $('#auth-screen .auth-footnote');
    diagnosticButton.type = 'button'; diagnosticButton.className = 'text-button';
    diagnosticButton.dataset.action = 'remember-diagnostic'; diagnosticButton.textContent = 'Kiểm tra ghi nhớ đăng nhập';
    diagnosticButton.style.marginTop = '12px';
    if (footnote && footnote.parentNode) footnote.parentNode.insertBefore(diagnosticButton, footnote);
  }
  startAuth();
})();
