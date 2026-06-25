// ========== VARIABLES ==========
let token = localStorage.getItem('token');
let myUsername = localStorage.getItem('username');
let myAvatar = localStorage.getItem('myAvatar') || '';
let myRole = localStorage.getItem('myRole') || 'user';
let myDisplayName = localStorage.getItem('myDisplayName') || '';
let myAbout = localStorage.getItem('myAbout') || '';
let notificationSettings = JSON.parse(localStorage.getItem('notificationSettings') || '{"sound":true,"vibrate":true}');
let pinnedChats = new Set();
let disappearingSettings = {};
let mediaPreviewFile = null;
let mediaPreviewIsVideo = false;
let galleryCurrentType = 'media';
let galleryCurrentScope = null; // { isGroup, id }
let currentChat = null;       // username чати шахсии ҷорӣ (агар гурӯҳ кушода бошад — null)
let currentGroupId = null;    // ID-и гурӯҳи ҳозира кушодашуда (агар чати шахсӣ — null)
let allUsers = [];
let allGroups = [];           // рӯйхати гурӯҳҳои ман
let groupsById = {};          // кэши маълумоти гурӯҳ бо ID
let mediaRecorder = null;
let audioChunks = [];
let recordingCancelled = false;
let recordingTimer = null;
let recordingSeconds = 0;
let selectedMessageId = null;
let isRecording = false;
let replyTo = null;
let unreadMessages = {};       // барои чати шахсӣ: { username: count }
let unreadGroupMessages = {};  // барои гурӯҳ: { groupId: count }
let currentAudio = null;
let currentAudioMsgId = null;
let onlineUsers = new Set();
let typingTimers = {};
let groupTypingUsers = {}; // { groupId: Set(usernames) }
let contextMsgId = null;
let contextMsgSender = null;
let contextMsgReceiver = null;
let contextMsgType = null;
let contextMsgBody = null;
let typingTimeout = null;
let isTypingSent = false;
let isLoadingMore = false;
let hasMoreMessages = true;
let oldestTimestamp = null;
let userAvatars = {};
let blockedUsers = new Set();
let pinnedMsgId = null;
let currentTheme = localStorage.getItem('theme') || 'dark';
let forgotResetToken = null;
let isChatSearchOpen = false;
const audioInstances = new Map();

// Офлайн навбат
let sendQueue = [];
let isSending = false;

// Охирин паём барои ҳар корбар/гурӯҳ (барои тартиб)
let lastMessageInfo = {};      // { username: { text, timestamp } }
let lastGroupMessageInfo = {}; // { groupId: { text, timestamp } }

let voiceKeepAliveInterval = null;
let isMultiSelectMode = false;
let selectedMessages = new Set();

// Аъзоёни интихобшуда барои гурӯҳи нав / илова кардан
let newGroupSelectedMembers = new Set();
let addMembersSelected = new Set();

// ========== MESSAGE CACHE (localStorage) ==========
const CACHE_LIMIT = 60; // Охирин 60 паём кэш мешавад

function cacheMessages(username, messages) {
    try {
        const key = `chat_${myUsername}_${username}`;
        const toSave = messages.slice(-CACHE_LIMIT);
        localStorage.setItem(key, JSON.stringify(toSave));
    } catch (e) {}
}

function getCachedMessages(username) {
    try {
        const key = `chat_${myUsername}_${username}`;
        const data = localStorage.getItem(key);
        return data ? JSON.parse(data) : null;
    } catch (e) { return null; }
}

function appendToCache(username, newMessages) {
    try {
        const existing = getCachedMessages(username) || [];
        const existingIds = new Set(existing.map(m => m._id));
        const merged = [...existing, ...newMessages.filter(m => !existingIds.has(m._id))];
        cacheMessages(username, merged.slice(-CACHE_LIMIT));
    } catch (e) {}
}

function clearChatCache(username) {
    try {
        localStorage.removeItem(`chat_${myUsername}_${username}`);
    } catch (e) {}
}

// Кэш барои гурӯҳ — бо префикс group_
function cacheGroupMessages(groupId, messages) {
    try {
        const key = `groupchat_${myUsername}_${groupId}`;
        const toSave = messages.slice(-CACHE_LIMIT);
        localStorage.setItem(key, JSON.stringify(toSave));
    } catch (e) {}
}
function getCachedGroupMessages(groupId) {
    try {
        const key = `groupchat_${myUsername}_${groupId}`;
        const data = localStorage.getItem(key);
        return data ? JSON.parse(data) : null;
    } catch (e) { return null; }
}
function appendToGroupCache(groupId, newMessages) {
    try {
        const existing = getCachedGroupMessages(groupId) || [];
        const existingIds = new Set(existing.map(m => m._id));
        const merged = [...existing, ...newMessages.filter(m => !existingIds.has(m._id))];
        cacheGroupMessages(groupId, merged.slice(-CACHE_LIMIT));
    } catch (e) {}
}

const socket = io({ auth: { token } });
const sentSound = new Audio('/sounds/sent.mp3');
const receivedSound = new Audio('/sounds/reseived.mp3'); // бо ҳамон номи худат навиштам
// ========== INIT ==========
document.addEventListener('DOMContentLoaded', async () => {
    if (token && myUsername) {
        const valid = await verifyToken();
        if (valid) {
            showApp();
        } else {
            localStorage.removeItem('token');
            localStorage.removeItem('username');
            token = null;
            myUsername = null;
        }
    }
});

async function verifyToken() {
    try {
        const res = await fetch('/api/auth/verify', {
            headers: { 'Authorization': 'Bearer ' + token }
        });
        if (res.ok) {
            const data = await res.json();
            myUsername = data.username;
            myAvatar = data.avatar || '';
            myDisplayName = data.displayName || myUsername;
            myAbout = data.about || '';
            notificationSettings = data.notificationSettings || { sound: true, vibrate: true };
            localStorage.setItem('myAvatar', myAvatar);
            localStorage.setItem('myDisplayName', myDisplayName);
            localStorage.setItem('myAbout', myAbout);
            localStorage.setItem('notificationSettings', JSON.stringify(notificationSettings));
            return true;
        }
        return false;
    } catch (err) {
        return false;
    }
}

// №12 — Уведомление (production-ready бо Service Worker)
let swRegistration = null;

async function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    try {
        swRegistration = await navigator.serviceWorker.register('/sw.js');
        // Гузориши клик ба уведомление
        navigator.serviceWorker.addEventListener('message', (event) => {
            if (event.data && event.data.type === 'NOTIFICATION_CLICK') {
                if (event.data.groupId) openGroupChat(event.data.groupId);
                else openChat(event.data.sender);
            }
        });
    } catch (e) {
        console.log('Service Worker хатогӣ:', e);
    }
}

async function requestNotificationPermission() {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') {
        await Notification.requestPermission();
    }
    await registerServiceWorker();
}

function showPushNotification(sender, text, avatarUrl, groupId = null) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const isCurrentlyOpen = groupId ? (currentGroupId === groupId) : (currentChat === sender);
    if (document.visibilityState === 'visible' && isCurrentlyOpen) return;

    const title = groupId ? `${groupsById[groupId]?.name || 'Гурӯҳ'}` : sender;
    const body = groupId ? `${sender}: ${text}` : text;
    const tag = groupId ? `g_${groupId}` : sender;

    const payload = {
        title, body,
        icon: avatarUrl || '/icon.png',
        tag
    };

    // Service Worker тариқи (production — HTTPS)
    if (swRegistration && swRegistration.active) {
        swRegistration.active.postMessage({ type: 'SHOW_NOTIFICATION', payload: { ...payload, groupId, sender } });
        return;
    }

    // Fallback — мустақим (локал)
    try {
        const notif = new Notification(title, {
            body,
            icon: avatarUrl || '/icon.png',
            tag,
            renotify: true
        });
        notif.onclick = () => {
            window.focus();
            if (groupId) openGroupChat(groupId);
            else openChat(sender);
            notif.close();
        };
        setTimeout(() => notif.close(), 5000);
    } catch(e) {}
}

// ========== OFFLINE QUEUE ==========
async function processQueue() {
    if (isSending || sendQueue.length === 0) return;
    isSending = true;

    while (sendQueue.length > 0) {
        const task = sendQueue[0];
        try {
            await task.execute();
            sendQueue.shift();
        } catch (err) {
            console.log('Навбат хатогӣ:', err);
            break;
        }
    }
    isSending = false;
}

window.addEventListener('online', () => {
    showToast('Интернет пайваст шуд! 🟢', 2000);
    processQueue();
});

window.addEventListener('offline', () => {
    showToast('Интернет нест! 🔴', 2000);
});

// ========== DIALOG / TOAST ==========
function showDialog(message) {
    return new Promise((resolve) => {
        document.getElementById('dialogMessage').textContent = message;
        document.getElementById('dialogOverlay').classList.remove('hidden');
        document.getElementById('dialogConfirmBtn').onclick = () => {
            document.getElementById('dialogOverlay').classList.add('hidden');
            resolve(true);
        };
        document.getElementById('dialogCancelBtn').onclick = () => {
            document.getElementById('dialogOverlay').classList.add('hidden');
            resolve(false);
        };
    });
}

function showDeleteDialog() {
    return new Promise((resolve) => {
        document.getElementById('deleteDialogOverlay').classList.remove('hidden');
        document.getElementById('deleteForMeBtn').onclick = () => {
            document.getElementById('deleteDialogOverlay').classList.add('hidden');
            resolve('me');
        };
        document.getElementById('deleteForAllBtn').onclick = () => {
            document.getElementById('deleteDialogOverlay').classList.add('hidden');
            resolve('all');
        };
        document.getElementById('deleteCancelBtn').onclick = () => {
            document.getElementById('deleteDialogOverlay').classList.add('hidden');
            resolve(null);
        };
    });
}

function showToast(message, duration = 3000) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.remove('hidden');
    clearTimeout(window.toastTimer);
    window.toastTimer = setTimeout(() => toast.classList.add('hidden'), duration);
}

// ========== AUTH ==========
function showTab(tab) {
    document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.auth-form').forEach(f => f.classList.add('hidden'));
    if (tab === 'login') {
        document.querySelectorAll('.auth-tab')[0].classList.add('active');
        document.getElementById('loginForm').classList.remove('hidden');
    } else {
        document.querySelectorAll('.auth-tab')[1].classList.add('active');
        document.getElementById('registerForm').classList.remove('hidden');
        loadSecurityQuestions();
    }
}

async function login() {
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value.trim();
    const errorEl = document.getElementById('loginError');
    if (!username || !password) { errorEl.textContent = 'Ҳамаи майдонҳоро пур кунед!'; return; }
    try {
        const res = await fetch('/api/auth/login', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (!res.ok) { errorEl.textContent = data.message; return; }
        token = data.token;
        myUsername = data.username;
        myAvatar = data.avatar || '';
        myRole = data.role || 'user';
        myDisplayName = data.displayName || myUsername;
        myAbout = data.about || '';
        localStorage.setItem('token', token);
        localStorage.setItem('username', myUsername);
        localStorage.setItem('myAvatar', myAvatar);
        localStorage.setItem('myRole', myRole);
        localStorage.setItem('myDisplayName', myDisplayName);
        localStorage.setItem('myAbout', myAbout);
        socket.auth.token = token;
        socket.disconnect().connect();
        requestNotificationPermission();
        showApp();
    } catch (err) {
        errorEl.textContent = 'Хатогӣ баромад!';
    }
}

async function register() {
    const username = document.getElementById('regUsername').value.trim();
    const password = document.getElementById('regPassword').value.trim();
    const securityQuestion = document.getElementById('regQuestion').value;
    const securityAnswer = document.getElementById('regAnswer').value.trim();
    const errorEl = document.getElementById('registerError');
    if (!username || !password) { errorEl.textContent = 'Ҳамаи майдонҳоро пур кунед!'; return; }
    if (!securityQuestion) { errorEl.textContent = 'Савол интихоб кунед!'; return; }
    if (!securityAnswer) { errorEl.textContent = 'Ҷавоби саволро нависед!'; return; }
    try {
        const res = await fetch('/api/auth/register', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password, securityQuestion, securityAnswer })
        });
        const data = await res.json();
        if (!res.ok) { errorEl.textContent = data.message; return; }
        token = data.token;
        myUsername = data.username;
        myAvatar = ''; myRole = 'user';
        localStorage.setItem('token', token);
        localStorage.setItem('username', myUsername);
        localStorage.setItem('myAvatar', '');
        localStorage.setItem('myRole', 'user');
        socket.auth.token = token;
        socket.disconnect().connect();
        showApp();
    } catch (err) {
        errorEl.textContent = 'Хатогӣ баромад!';
    }
}

function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('username');
    token = null;
    myUsername = null;
    currentChat = null;
    currentGroupId = null;
    allUsers = [];
    allGroups = [];
    onlineUsers = new Set();
    sendQueue = [];
    stopCurrentAudio();
    socket.disconnect();
    document.getElementById('authScreen').classList.remove('hidden');
    document.getElementById('mainApp').classList.add('hidden');
}

function showApp() {
    document.getElementById('authScreen').classList.add('hidden');
    document.getElementById('mainApp').classList.remove('hidden');
    document.getElementById('myUsername').textContent = myUsername;
    renderMyAvatar();
    applyTheme(currentTheme);
    if (!socket.connected) socket.connect();
    requestNotificationPermission();
    loadUsers();
    loadGroups();
    loadBlockedUsers();
    loadArchivedSet();
    loadMutedSet();
    loadPinnedChatsSet();
    loadDisappearingSettings();
    checkInviteUrlOnLoad();
    // Admin кнопка
    if (myRole === 'admin') {
        const btn = document.getElementById('adminBtn');
        if (btn) btn.style.display = 'flex';
    }
}

function renderMyAvatar() {
    const myAv = document.getElementById('myAvatar');
    if (!myAv) return;
    if (myAvatar) {
        myAv.innerHTML = `<img src="${myAvatar}" alt="${myUsername}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;"/>`;
    } else {
        myAv.textContent = myUsername ? myUsername[0].toUpperCase() : '?';
    }
}

function renderAvatarEl(el, username, avatarUrl) {
    if (!el) return;
    if (avatarUrl) {
        el.innerHTML = `<img src="${avatarUrl}" alt="${username}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;"/>`;
    } else {
        el.textContent = username ? username[0].toUpperCase() : '?';
    }
}

// ========== CHANGE USERNAME ==========
function showChangeUsername() {
    document.getElementById('newUsernameInput').value = '';
    document.getElementById('changeUsernameError').textContent = '';
    document.getElementById('changeUsernameDialog').classList.remove('hidden');
    setTimeout(() => document.getElementById('newUsernameInput').focus(), 100);
}

function hideChangeUsername() {
    document.getElementById('changeUsernameDialog').classList.add('hidden');
}

async function changeUsername() {
    const newUsername = document.getElementById('newUsernameInput').value.trim();
    const errorEl = document.getElementById('changeUsernameError');
    if (!newUsername || newUsername.length < 3) {
        errorEl.textContent = 'Ном камаш 3 ҳарф бошад!';
        return;
    }
    try {
        const res = await fetch('/api/auth/change-username', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ newUsername })
        });
        const data = await res.json();
        if (!res.ok) { errorEl.textContent = data.message; return; }
        const oldUsername = myUsername;
        token = data.token;
        myUsername = data.username;
        localStorage.setItem('token', token);
        localStorage.setItem('username', myUsername);
        document.getElementById('myUsername').textContent = myUsername;
        const myAv = document.getElementById('myAvatar');
        if (myAv) myAv.textContent = myUsername[0].toUpperCase();
        hideChangeUsername();
        showToast('Ном бо муваффақият иваз шуд!');
        socket.emit('changeUsername', { oldUsername, newUsername: myUsername });
        socket.auth.token = token;
        loadUsers();
    } catch (err) {
        errorEl.textContent = 'Хатогӣ баромад!';
    }
}

// ========== PROFILE & SETTINGS ==========
function showProfile() {
    const modal = document.getElementById('profileModal');
    if (!modal) return;
    modal.classList.remove('hidden');
    document.getElementById('profileUsername').textContent = myUsername;
    document.getElementById('displayNameInput').value = myDisplayName || myUsername;
    document.getElementById('aboutInput').value = myAbout || '';
    const bigAv = document.getElementById('profileBigAvatar');
    if (myAvatar) {
        bigAv.style.backgroundImage = `url(${myAvatar})`;
        bigAv.style.backgroundSize = 'cover';
        bigAv.style.backgroundPosition = 'center';
        bigAv.onclick = (e) => {
            if (!e.target.closest('.avatar-edit-icon')) showUserProfile(myUsername);
        };
    } else {
        bigAv.style.backgroundImage = '';
        bigAv.onclick = (e) => {
            if (!e.target.closest('.avatar-edit-icon')) document.getElementById('avatarFileInput')?.click();
        };
    }
    const vis = localStorage.getItem('myVisibility') || 'everyone';
    document.querySelectorAll('input[name="visibility"]').forEach(r => { r.checked = r.value === vis; });
    const lsVis = localStorage.getItem('myLastSeenVisibility') || 'everyone';
    document.querySelectorAll('input[name="lastseen-visibility"]').forEach(r => { r.checked = r.value === lsVis; });
    const avVis = localStorage.getItem('myAvatarVisibility') || 'everyone';
    document.querySelectorAll('input[name="avatar-visibility"]').forEach(r => { r.checked = r.value === avVis; });
    document.getElementById('notifSoundToggle').checked = notificationSettings.sound !== false;
    document.getElementById('notifVibrateToggle').checked = notificationSettings.vibrate !== false;
    loadStorageUsage();
}

async function saveDisplayName() {
    const val = document.getElementById('displayNameInput').value.trim();
    if (!val) { showToast('Ном холӣ буда наметавонад!'); return; }
    try {
        await fetch('/api/auth/display-name', {
            method: 'PUT', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ displayName: val })
        });
        myDisplayName = val;
        showToast('✅ Ном захира шуд');
    } catch (e) { showToast('Хатогӣ!'); }
}

async function saveAbout() {
    const val = document.getElementById('aboutInput').value.trim();
    try {
        await fetch('/api/auth/about', {
            method: 'PUT', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ about: val })
        });
        myAbout = val;
        showToast('✅ Захира шуд');
    } catch (e) { showToast('Хатогӣ!'); }
}

// ---------- Visibility (умумӣ барои 3 намуд: online/lastseen/avatar) ----------
const VISIBILITY_ENDPOINTS = {
    online: { endpoint: '/api/auth/online-visibility', storageKey: 'myVisibility', radioName: 'visibility', socketUpdate: true },
    lastseen: { endpoint: '/api/auth/lastseen-visibility', storageKey: 'myLastSeenVisibility', radioName: 'lastseen-visibility', socketUpdate: false },
    avatar: { endpoint: '/api/auth/avatar-visibility', storageKey: 'myAvatarVisibility', radioName: 'avatar-visibility', socketUpdate: false }
};
let currentVisibilityKind = 'online';

async function saveVisibility(radio) {
    await saveVisibilityKind('online', radio.value, []);
}
async function saveLastSeenVisibility(radio) {
    await saveVisibilityKind('lastseen', radio.value, []);
}
async function saveAvatarVisibility(radio) {
    await saveVisibilityKind('avatar', radio.value, []);
}

async function saveVisibilityKind(kind, visibility, visibleTo) {
    const cfg = VISIBILITY_ENDPOINTS[kind];
    localStorage.setItem(cfg.storageKey, visibility);
    try {
        await fetch(cfg.endpoint, {
            method: 'PUT', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ visibility, visibleTo })
        });
        if (cfg.socketUpdate) socket.emit('updateVisibility', { visibility, visibleTo });
        showToast('✅ Захира шуд');
    } catch (e) { showToast('Хатогӣ!'); }
}

function showVisibilityPicker(radio) { openVisibilityPickerFor('online'); }
function showLastSeenPicker(radio) { openVisibilityPickerFor('lastseen'); }
function showAvatarVisibilityPicker(radio) { openVisibilityPickerFor('avatar'); }

function openVisibilityPickerFor(kind) {
    currentVisibilityKind = kind;
    const cfg = VISIBILITY_ENDPOINTS[kind];
    const overlay = document.getElementById('visibilityPickerOverlay');
    const list = document.getElementById('visibilityUserList');
    if (!overlay || !list) return;
    const selectedList = JSON.parse(localStorage.getItem(cfg.storageKey + 'SelectedUsers') || '[]');
    list.innerHTML = '';
    allUsers.forEach(user => {
        const checked = selectedList.includes(user.username);
        const avatarUrl = userAvatars[user.username] || '';
        const avatarHtml = avatarUrl
            ? `<img src="${avatarUrl}" style="width:32px;height:32px;border-radius:50%;object-fit:cover;"/>`
            : `<div style="width:32px;height:32px;border-radius:50%;background:var(--accent);display:flex;align-items:center;justify-content:center;font-weight:700;color:#fff;font-size:13px;">${user.username[0].toUpperCase()}</div>`;
        const div = document.createElement('label');
        div.className = 'user-picker-item';
        div.innerHTML = `
            ${avatarHtml}
            <span class="upi-name">${escapeHtml(user.username)}</span>
            <input type="checkbox" value="${escapeHtml(user.username)}" ${checked ? 'checked' : ''}/>
        `;
        list.appendChild(div);
    });
    overlay.classList.remove('hidden');
}

function hideVisibilityPicker() {
    document.getElementById('visibilityPickerOverlay')?.classList.add('hidden');
    const cfg = VISIBILITY_ENDPOINTS[currentVisibilityKind];
    const vis = localStorage.getItem(cfg.storageKey) || 'everyone';
    document.querySelectorAll(`input[name="${cfg.radioName}"]`).forEach(r => r.checked = r.value === vis);
}

async function saveVisibilitySelected() {
    const cfg = VISIBILITY_ENDPOINTS[currentVisibilityKind];
    const checkboxes = document.querySelectorAll('#visibilityUserList input[type="checkbox"]:checked');
    const selected = Array.from(checkboxes).map(c => c.value);
    localStorage.setItem(cfg.storageKey, 'selected');
    localStorage.setItem(cfg.storageKey + 'SelectedUsers', JSON.stringify(selected));
    document.getElementById('visibilityPickerOverlay')?.classList.add('hidden');
    document.querySelectorAll(`input[name="${cfg.radioName}"]`).forEach(r => r.checked = r.value === 'selected');
    await saveVisibilityKind(currentVisibilityKind, 'selected', selected);
}

function hideProfile() {
    document.getElementById('profileModal')?.classList.add('hidden');
}

// ========== DARK/LIGHT THEME ==========
function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    currentTheme = theme;
    localStorage.setItem('theme', theme);
    const btn = document.getElementById('themeBtn');
    if (btn) btn.innerHTML = theme === 'dark' ? '<i class="fa-solid fa-moon"></i>' : '<i class="fa-solid fa-sun"></i>';
}
function toggleTheme() { applyTheme(currentTheme === 'dark' ? 'light' : 'dark'); }

// ========== FORGOT PASSWORD ==========
async function showForgotPassword() {
    await loadSecurityQuestions();
    ['forgotStep2','forgotStep3'].forEach(id => document.getElementById(id)?.classList.add('hidden'));
    document.getElementById('forgotStep1')?.classList.remove('hidden');
    document.getElementById('forgotUsername').value = '';
    document.getElementById('forgotErr1').textContent = '';
    document.getElementById('forgotModal')?.classList.remove('hidden');
}
function hideForgotPassword() {
    document.getElementById('forgotModal')?.classList.add('hidden');
    forgotResetToken = null;
}
async function forgotStep1() {
    const username = document.getElementById('forgotUsername').value.trim();
    const err = document.getElementById('forgotErr1');
    if (!username) { err.textContent = 'Номи корбарро нависед!'; return; }
    try {
        const res = await fetch('/api/auth/forgot-password/question', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username })
        });
        const data = await res.json();
        if (!res.ok) { err.textContent = data.message; return; }
        document.getElementById('forgotQuestion').textContent = data.question;
        document.getElementById('forgotAnswer').value = '';
        document.getElementById('forgotErr2').textContent = '';
        document.getElementById('forgotStep1').classList.add('hidden');
        document.getElementById('forgotStep2').classList.remove('hidden');
    } catch(e) { err.textContent = 'Хатогӣ!'; }
}
function forgotBack1() {
    document.getElementById('forgotStep2').classList.add('hidden');
    document.getElementById('forgotStep1').classList.remove('hidden');
}
async function forgotStep2() {
    const username = document.getElementById('forgotUsername').value.trim();
    const answer = document.getElementById('forgotAnswer').value.trim();
    const err = document.getElementById('forgotErr2');
    if (!answer) { err.textContent = 'Ҷавобро нависед!'; return; }
    try {
        const res = await fetch('/api/auth/forgot-password/verify', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, answer })
        });
        const data = await res.json();
        if (!res.ok) { err.textContent = data.message; return; }
        forgotResetToken = data.resetToken;
        document.getElementById('newPass1').value = '';
        document.getElementById('newPass2').value = '';
        document.getElementById('forgotErr3').textContent = '';
        document.getElementById('forgotStep2').classList.add('hidden');
        document.getElementById('forgotStep3').classList.remove('hidden');
    } catch(e) { err.textContent = 'Хатогӣ!'; }
}
async function forgotStep3() {
    const p1 = document.getElementById('newPass1').value.trim();
    const p2 = document.getElementById('newPass2').value.trim();
    const err = document.getElementById('forgotErr3');
    if (p1.length < 6) { err.textContent = 'Парол камаш 6 аломат бошад!'; return; }
    if (p1 !== p2) { err.textContent = 'Паролҳо мувофиқ нестанд!'; return; }
    try {
        const res = await fetch('/api/auth/forgot-password/reset', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ resetToken: forgotResetToken, newPassword: p1 })
        });
        const data = await res.json();
        if (!res.ok) { err.textContent = data.message; return; }
        hideForgotPassword();
        showToast('✅ Парол иваз шуд! Дохил шавед.');
    } catch(e) { err.textContent = 'Хатогӣ!'; }
}

// ========== BLOCK/UNBLOCK ==========
async function loadBlockedUsers() {
    try {
        const res = await fetch('/api/auth/blocked', { headers: { 'Authorization': 'Bearer ' + token } });
        const list = await res.json();
        blockedUsers = new Set(list);
    } catch(e) {}
}
async function blockCurrentUser() {
    if (!currentChat) return;
    const isBlocked = blockedUsers.has(currentChat);
    try {
        await fetch(`/api/auth/${isBlocked ? 'unblock' : 'block'}/${currentChat}`, {
            method: 'POST', headers: { 'Authorization': 'Bearer ' + token }
        });
        if (isBlocked) { blockedUsers.delete(currentChat); showToast(`${currentChat} блок бардошта шуд`); }
        else { blockedUsers.add(currentChat); showToast(`${currentChat} блок карда шуд`); }
        updateBlockBtn();
    } catch(e) { showToast('Хатогӣ!'); }
}
function updateBlockBtn() {
    const btn = document.getElementById('blockBtnText');
    if (btn && currentChat) btn.textContent = blockedUsers.has(currentChat) ? 'Блок бардор' : 'Блок кун';
}

// ========== HEADER INFO CLICK (шахсӣ / гурӯҳ) ==========
function headerInfoClick() {
    if (currentGroupId) {
        showGroupInfo();
    } else if (currentChat) {
        showUserProfile(currentChat);
    }
}

// ========== CHAT OPTIONS ==========
function showChatOptions() {
    if (currentGroupId) {
        showGroupOptions();
        return;
    }
    const menu = document.getElementById('chatOptionsMenu');
    if (!menu) return;
    updateBlockBtn();
    menu.classList.remove('hidden');
    setTimeout(() => document.addEventListener('click', () => hideChatOptions(), { once: true }), 50);
}
function hideChatOptions() { document.getElementById('chatOptionsMenu')?.classList.add('hidden'); }

function showGroupOptions() {
    const menu = document.getElementById('groupOptionsMenu');
    if (!menu) return;
    menu.classList.remove('hidden');
    setTimeout(() => document.addEventListener('click', () => hideGroupOptions(), { once: true }), 50);
}
function hideGroupOptions() { document.getElementById('groupOptionsMenu')?.classList.add('hidden'); }

// ========== SEARCH IN CHAT ==========
function toggleChatSearch() {
    isChatSearchOpen = !isChatSearchOpen;
    const bar = document.getElementById('chatSearchBar');
    const results = document.getElementById('chatSearchResults');
    if (isChatSearchOpen) {
        bar.classList.remove('hidden');
        document.getElementById('chatSearchInput')?.focus();
    } else {
        bar.classList.add('hidden');
        if (results) { results.classList.add('hidden'); results.innerHTML = ''; }
    }
}
async function searchInChat(q) {
    const results = document.getElementById('chatSearchResults');
    const countEl = document.getElementById('searchCount');
    if (!q || q.trim().length < 2) {
        if (results) { results.classList.add('hidden'); results.innerHTML = ''; }
        if (countEl) countEl.textContent = '';
        return;
    }
    try {
        const url = currentGroupId
            ? `/api/groups/${currentGroupId}/search?q=${encodeURIComponent(q)}`
            : `/api/messages/search/${currentChat}?q=${encodeURIComponent(q)}`;
        const res = await fetch(url, { headers: { 'Authorization': 'Bearer ' + token } });
        const msgs = await res.json();
        if (countEl) countEl.textContent = msgs.length ? `${msgs.length} ёфт` : 'Ёфт нашуд';
        if (!results) return;
        results.innerHTML = '';
        if (!msgs.length) {
            results.innerHTML = '<div class="search-empty">Паём ёфт нашуд</div>';
            results.classList.remove('hidden'); return;
        }
        msgs.forEach(msg => {
            const div = document.createElement('div');
            div.className = 'search-result-item';
            const time = new Date(msg.timestamp).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
            const hl = escapeHtml(msg.body).replace(new RegExp(escapeHtml(q), 'gi'), m => `<mark>${m}</mark>`);
            div.innerHTML = `<div class="sr-sender">${escapeHtml(msg.sender)} <span class="sr-time">${time}</span></div><div class="sr-text">${hl}</div>`;
            div.onclick = () => { scrollToMsg(msg._id); toggleChatSearch(); };
            results.appendChild(div);
        });
        results.classList.remove('hidden');
    } catch(e) {}
}

// ========== PINNED MESSAGE ==========
async function loadPinnedMessage() {
    if (currentGroupId) {
        try {
            const res = await fetch(`/api/groups/${currentGroupId}/pinned`, { headers: { 'Authorization': 'Bearer ' + token } });
            const msg = await res.json();
            if (msg) { pinnedMsgId = msg._id; showPinnedBar(msg); }
            else hidePinnedBar();
        } catch(e) {}
        return;
    }
    if (!currentChat) return;
    try {
        const res = await fetch(`/api/messages/pinned/${currentChat}`, {
            headers: { 'Authorization': 'Bearer ' + token }
        });
        const msg = await res.json();
        if (msg) { pinnedMsgId = msg._id; showPinnedBar(msg); }
        else hidePinnedBar();
    } catch(e) {}
}
function showPinnedBar(msg) {
    const bar = document.getElementById('pinnedBar');
    const text = document.getElementById('pinnedText');
    if (!bar || !text) return;
    const preview = msg.type === 'voice' ? '🎤 Голосовой паём'
        : msg.type === 'image' ? '🖼 Сурат' : msg.type === 'video' ? '🎥 Видео'
        : (msg.body || '').substring(0, 60);
    text.textContent = preview;
    bar.classList.remove('hidden');
}
function hidePinnedBar() { pinnedMsgId = null; document.getElementById('pinnedBar')?.classList.add('hidden'); }
function scrollToPinned() { if (pinnedMsgId) scrollToMsg(pinnedMsgId); }

async function pinMessageById(msgId) {
    if (currentGroupId) return pinGroupMessageById(msgId);
    try {
        const res = await fetch(`/api/messages/pin/${msgId}`, {
            method: 'PUT', headers: { 'Authorization': 'Bearer ' + token }
        });
        const data = await res.json();
        if (data.pinned) {
            pinnedMsgId = msgId; showPinnedBar(data.message);
            socket.emit('pinMessage', { msgId, receiver: currentChat, sender: myUsername, message: data.message, pinned: true });
            showToast('📌 Паём сабт шуд');
        } else {
            hidePinnedBar();
            socket.emit('pinMessage', { msgId, receiver: currentChat, sender: myUsername, pinned: false });
            showToast('Паём аз сабт хориҷ шуд');
        }
    } catch(e) { showToast('Хатогӣ!'); }
}
async function unpinMessage() {
    if (!pinnedMsgId) return;
    if (currentGroupId) return unpinGroupMessage();
    await pinMessageById(pinnedMsgId);
}

async function pinGroupMessageById(msgId) {
    try {
        const res = await fetch(`/api/groups/${currentGroupId}/pin/${msgId}`, {
            method: 'PUT', headers: { 'Authorization': 'Bearer ' + token }
        });
        const data = await res.json();
        if (data.pinned) {
            pinnedMsgId = msgId; showPinnedBar(data.message);
            socket.emit('pinGroupMessage', { groupId: currentGroupId, msgId, message: data.message, pinned: true, sender: myUsername });
            showToast('📌 Паём сабт шуд');
        } else {
            hidePinnedBar();
            socket.emit('pinGroupMessage', { groupId: currentGroupId, msgId, pinned: false, sender: myUsername });
            showToast('Паём аз сабт хориҷ шуд');
        }
    } catch(e) { showToast('Хатогӣ!'); }
}
async function unpinGroupMessage() { if (pinnedMsgId) await pinGroupMessageById(pinnedMsgId); }

// ========== EDIT MESSAGE ==========
async function startEditMessage(msgId, currentBody) {
    closeInlineMenu();
    const el = document.getElementById(`msg_${msgId}`);
    if (!el) return;
    const bubble = el.querySelector('.message-bubble');
    if (!bubble) return;
    const origHTML = bubble.innerHTML;
    bubble.innerHTML = `<textarea class="edit-textarea" id="eta_${msgId}">${escapeHtml(currentBody)}</textarea><div class="edit-actions"><button class="edit-cancel" onclick="document.getElementById('msg_${msgId}').querySelector('.message-bubble').innerHTML = atob('${btoa(origHTML)}')">Бекор</button><button class="edit-save" onclick="saveEdit('${msgId}')">Захира</button></div>`;
    const ta = document.getElementById(`eta_${msgId}`);
    if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
}
async function saveEdit(msgId) {
    const ta = document.getElementById(`eta_${msgId}`);
    if (!ta) return;
    const newBody = ta.value.trim();
    if (!newBody) { showToast('Матн холӣ!'); return; }
    try {
        const url = currentGroupId ? `/api/groups/${currentGroupId}/messages/${msgId}` : `/api/messages/edit/${msgId}`;
        const res = await fetch(url, {
            method: 'PUT', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ body: newBody })
        });
        if (!res.ok) { showToast('Хатогӣ!'); return; }
        const msg = await res.json();
        const el = document.getElementById(`msg_${msgId}`);
        if (el) {
            const bubble = el.querySelector('.message-bubble');
            if (bubble) bubble.innerHTML = `${escapeHtml(newBody)}<span class="edited-label"> (иваз карда шуд)</span>`;
        }
        if (currentGroupId) {
            socket.emit('editGroupMessage', { groupId: currentGroupId, _id: msgId, body: newBody, sender: myUsername, edited: true });
        } else {
            socket.emit('editMessage', { _id: msgId, body: newBody, receiver: currentChat, sender: myUsername, edited: true });
        }
    } catch(e) { showToast('Хатогӣ!'); }
}

// ========== EXPORT CHAT ==========
function exportChat() {
    if (!currentChat) return;
    fetch(`/api/messages/export/${currentChat}`, { headers: { 'Authorization': 'Bearer ' + token } })
        .then(r => r.blob())
        .then(blob => {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `chat_${currentChat}.txt`;
            a.click();
            showToast('✅ Чат содир шуд!');
        }).catch(() => showToast('Хатогӣ!'));
}

function exportGroupChat() {
    if (!currentGroupId) return;
    fetch(`/api/groups/${currentGroupId}/export`, { headers: { 'Authorization': 'Bearer ' + token } })
        .then(r => r.blob())
        .then(blob => {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `group_${currentGroupId}.txt`;
            a.click();
            showToast('✅ Чат содир шуд!');
        }).catch(() => showToast('Хатогӣ!'));
}

// ========== SECURITY QUESTIONS LOADER ==========
async function loadSecurityQuestions() {
    try {
        const res = await fetch('/api/auth/security-questions');
        const questions = await res.json();
        const sel = document.getElementById('regQuestion');
        if (sel) {
            sel.innerHTML = '<option value="">Савол интихоб кунед...</option>';
            questions.forEach(q => { sel.innerHTML += `<option value="${q}">${q}</option>`; });
        }
    } catch(e) {}
}

async function uploadAvatar(input) {
    if (!input.files || !input.files[0]) return;
    const file = input.files[0];
    const formData = new FormData();
    formData.append('avatar', file);
    try {
        showToast('Бор карда истодааст...');
        const res = await fetch('/api/auth/upload-avatar', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + token },
            body: formData
        });
        const data = await res.json();
        if (!res.ok) { showToast(data.message || 'Хатогӣ!'); return; }
        myAvatar = data.avatar;
        localStorage.setItem('myAvatar', myAvatar);
        renderMyAvatar();
        showProfile();
        // Real-time avatar update барои ҳамаи корбарон
        socket.emit('avatarChanged', { username: myUsername, avatar: myAvatar });
        showToast('Сурат бо муваффақият бор шуд! ✅');
    } catch(e) {
        showToast('Хатогӣ ҳангоми боркунӣ!');
    }
    input.value = '';
}

async function saveVisibility(radio) {
    const visibility = radio.value;
    localStorage.setItem('myVisibility', visibility);
    try {
        await fetch('/api/auth/online-visibility', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ visibility, visibleTo: [] })
        });
        socket.emit('updateVisibility', { visibility });
        const statusEl = document.getElementById('visibilityStatus');
        if (statusEl) statusEl.textContent = '✅ Захира шуд';
        setTimeout(() => { if(statusEl) statusEl.textContent = ''; }, 2000);
    } catch(e) { showToast('Хатогӣ!'); }
}

async function showUserProfile(username) {
    if (!username) return;
    const overlay = document.getElementById('profileViewerOverlay');
    if (!overlay) return;
    const avEl = document.getElementById('profileViewerAvatar');
    const nameEl = document.getElementById('profileViewerName');
    const statusEl = document.getElementById('profileViewerStatus');
    const aboutEl = document.getElementById('profileViewerAbout');
    const isMe = username === myUsername;

    if (nameEl) nameEl.textContent = username;
    if (statusEl) statusEl.textContent = '...';
    if (aboutEl) aboutEl.textContent = '';
    overlay.classList.remove('hidden');

    if (isMe) {
        renderAvatarEl(avEl, username, myAvatar);
        if (avEl && myAvatar) setupProfileViewerZoom();
        if (nameEl) nameEl.textContent = myDisplayName || myUsername;
        if (statusEl) statusEl.textContent = '';
        if (aboutEl) aboutEl.textContent = myAbout || '';
        return;
    }

    try {
        const res = await fetch(`/api/auth/profile/${username}`, { headers: { 'Authorization': 'Bearer ' + token } });
        const profile = await res.json();
        if (!res.ok) { overlay.classList.add('hidden'); showToast(profile.message || 'Хатогӣ!'); return; }

        if (avEl) {
            if (profile.avatar) {
                avEl.innerHTML = `<img src="${profile.avatar}" alt="${escapeHtml(username)}" id="profileViewerImg"/>`;
                setTimeout(() => setupProfileViewerZoom(), 100);
            } else {
                avEl.innerHTML = '';
                avEl.textContent = username[0].toUpperCase();
            }
        }
        if (nameEl) nameEl.textContent = profile.displayName || username;
        if (aboutEl) aboutEl.textContent = profile.about || '';

        const isOnline = onlineUsers.has(username);
        if (statusEl) {
            if (isOnline) {
                statusEl.textContent = '🟢 Онлайн';
            } else if (profile.lastSeenHidden) {
                statusEl.textContent = '';
            } else if (profile.lastSeenAt) {
                statusEl.textContent = '⚫ Дидашуда: ' + formatLastSeen(profile.lastSeenAt);
            } else {
                statusEl.textContent = '⚫ Офлайн';
            }
        }
    } catch (e) {
        if (statusEl) statusEl.textContent = '';
    }
}

function formatLastSeen(dateStr) {
    const date = new Date(dateStr);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (isToday) return `имрӯз соати ${time}`;
    const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) return `дирӯз соати ${time}`;
    return date.toLocaleDateString('ru', { day: '2-digit', month: '2-digit' }) + ' ' + time;
}

function setupProfileViewerZoom() {
    const img = document.getElementById('profileViewerImg');
    if (img) setupPinchZoom(img);
}

function hideProfileViewer() {
    document.getElementById('profileViewerOverlay')?.classList.add('hidden');
}

// ========== PINCH TO ZOOM ==========
function setupPinchZoom(el) {
    let scale = 1, startScale = 1;
    let posX = 0, posY = 0, startX = 0, startY = 0;
    let initDist = 0;
    let lastTap = 0;

    function dist(t1, t2) {
        return Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
    }

    function applyTransform(animated) {
        el.style.transition = animated ? 'transform 0.2s ease' : 'none';
        el.style.transform = `translate(${posX}px, ${posY}px) scale(${scale})`;
    }

    el.addEventListener('touchstart', (e) => {
        if (e.touches.length === 2) {
            e.preventDefault();
            initDist = dist(e.touches[0], e.touches[1]);
            startScale = scale;
        } else if (e.touches.length === 1) {
            startX = e.touches[0].clientX - posX;
            startY = e.touches[0].clientY - posY;
            // Double tap → zoom/reset
            const now = Date.now();
            if (now - lastTap < 280) {
                if (scale > 1) { scale = 1; posX = 0; posY = 0; }
                else { scale = 2.5; }
                applyTransform(true);
            }
            lastTap = now;
        }
    }, { passive: false });

    el.addEventListener('touchmove', (e) => {
        e.preventDefault();
        if (e.touches.length === 2) {
            const d = dist(e.touches[0], e.touches[1]);
            scale = Math.max(1, Math.min(5, startScale * (d / initDist)));
            applyTransform(false);
        } else if (e.touches.length === 1 && scale > 1) {
            posX = e.touches[0].clientX - startX;
            posY = e.touches[0].clientY - startY;
            applyTransform(false);
        }
    }, { passive: false });

    el.addEventListener('touchend', () => {
        if (scale < 1.05) {
            scale = 1; posX = 0; posY = 0;
            applyTransform(true);
        }
    });
}

function confirmLogout() {
    hideProfile();
    logout();
}

// №17 — Медиа фиристодан (сурат/видео) — чандто мумкин
let pendingMediaFiles = [];

async function sendMedia(input) {
    if (!input.files || !input.files.length) return;
    if (!currentChat && !currentGroupId) return;
    pendingMediaFiles = Array.from(input.files);
    input.value = '';
    showMediaPreviewModal();
}

function showMediaPreviewModal() {
    if (pendingMediaFiles.length === 0) return;
    const file = pendingMediaFiles[0];
    mediaPreviewFile = file;
    mediaPreviewIsVideo = file.type.startsWith('video/');
    const url = URL.createObjectURL(file);
    const content = document.getElementById('mediaPreviewContent');
    content.innerHTML = mediaPreviewIsVideo
        ? `<video src="${url}" controls autoplay muted playsinline></video>`
        : `<img src="${url}" alt="preview"/>`;
    document.getElementById('mediaCaptionInput').value = '';
    document.getElementById('mediaPreviewModal').classList.remove('hidden');
}

function cancelMediaPreview() {
    document.getElementById('mediaPreviewModal').classList.add('hidden');
    pendingMediaFiles = [];
    mediaPreviewFile = null;
}

async function confirmSendMediaPreview() {
    const caption = document.getElementById('mediaCaptionInput').value.trim();
    document.getElementById('mediaPreviewModal').classList.add('hidden');
    const allFiles = [...pendingMediaFiles];
    pendingMediaFiles = [];
    if (allFiles.length === 0) return;
    // Аввалин файл — бо caption; боқимонда — бе caption (мисли WhatsApp multi-send)
    await sendSingleMedia(allFiles[0], caption);
    for (let i = 1; i < allFiles.length; i++) {
        await sendSingleMedia(allFiles[i], '');
    }
}

async function sendSingleMedia(file, caption = '') {
    if (currentGroupId) return sendSingleGroupMedia(file, caption);
    const isVideo = file.type.startsWith('video/');
    const tempId = 'temp_media_' + Date.now() + '_' + Math.random();
    const receiver = currentChat;
    const objectUrl = URL.createObjectURL(file);
    const tempMsg = {
        _id: tempId,
        sender: myUsername,
        receiver,
        type: isVideo ? 'video' : 'image',
        mediaUrl: objectUrl,
        caption,
        timestamp: new Date(),
        reactionBySender: '',
        reactionByReceiver: '',
        seen: false
    };
    renderMessage(tempMsg, true);
    const container = document.getElementById('messagesContainer');
    container.scrollTop = container.scrollHeight;
    const msgText = isVideo ? '🎥 Видео' : '🖼 Сурат';
    updateLastMsg(receiver, msgText, false, tempMsg.timestamp);

    // Гирандаро огоҳ кун — медиа фиристода истода аст
    socket.emit('mediaUploading', { sender: myUsername, receiver, isVideo });

    const formData = new FormData();
    formData.append('media', file);
    formData.append('receiver', receiver);
    if (caption) formData.append('caption', caption);
    if (replyTo) formData.append('replyToId', replyTo._id);
    cancelReply();

    // Навбатга илова
    sendQueue.push({
        tempId,
        receiver,
        tempMsg,
        execute: async () => {
            const msg = await uploadMediaWithProgress(formData, tempId);
            const tempEl = document.getElementById(`msg_${tempId}`);
            if (tempEl) tempEl.remove();
            // Re-render to current container if the chat is still open
            const c = document.getElementById('messagesContainer');
            if (currentChat === receiver && c) {
                renderMessage(msg);
                c.scrollTop = c.scrollHeight;
            }
            socket.emit('sendMessage', { ...msg, receiver, sender: myUsername });
            URL.revokeObjectURL(objectUrl);
        }
    });
    processQueue();
}

// XHR upload бо progress (барои №10)
function uploadMediaWithProgress(formData, tempId, groupId = null) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', groupId ? `/api/groups/${groupId}/media` : '/api/messages/media');
        xhr.setRequestHeader('Authorization', 'Bearer ' + token);

        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
                const percent = Math.round((e.loaded / e.total) * 100);
                const progEl = document.getElementById(`prog_${tempId}`);
                if (progEl) progEl.textContent = percent + '%';
            }
        };

        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                try { resolve(JSON.parse(xhr.responseText)); }
                catch(e) { reject(e); }
            } else {
                reject(new Error('Upload failed: ' + xhr.status));
            }
        };
        xhr.onerror = () => reject(new Error('Network error'));
        xhr.send(formData);
    });
}

// №17 — Image viewer
function openImageViewer(url) {
    const overlay = document.getElementById('imageViewerOverlay');
    const img = document.getElementById('imageViewerImg');
    if (overlay && img) {
        img.src = url;
        overlay.classList.remove('hidden');
    }
}

function hideImageViewer() {
    document.getElementById('imageViewerOverlay')?.classList.add('hidden');
}

// Custom video player (Instagram style)
function toggleVideoPlay(overlay) {
    const wrapper = overlay.closest('.video-wrapper');
    const video = wrapper.querySelector('video');
    const progressFill = wrapper.querySelector('.video-progress-fill');
    if (!video) return;

    if (video.paused) {
        // Дигар видеоҳоро бас кун
        document.querySelectorAll('.msg-video').forEach(v => {
            if (v !== video && !v.paused) {
                v.pause();
                const ov = v.closest('.video-wrapper')?.querySelector('.video-play-overlay');
                if (ov) ov.classList.remove('hidden-overlay');
            }
        });
        video.play().catch(() => {});
        overlay.classList.add('hidden-overlay');
    } else {
        video.pause();
        overlay.classList.remove('hidden-overlay');
    }

    if (!video._progressBound) {
        video._progressBound = true;
        video.addEventListener('timeupdate', () => {
            if (video.duration) {
                progressFill.style.width = (video.currentTime / video.duration * 100) + '%';
            }
        });
        video.addEventListener('ended', () => {
            overlay.classList.remove('hidden-overlay');
            progressFill.style.width = '0%';
        });
        video.addEventListener('pause', () => {
            overlay.classList.remove('hidden-overlay');
        });
    }
}

// №1 — Видеоро полноэкранный кушодан
function openVideoFullscreen(url) {
    const overlay = document.getElementById('videoFullscreenOverlay');
    const video = document.getElementById('videoFullscreenVideo');
    if (overlay && video) {
        // Дигар видеоҳоро бас кун
        document.querySelectorAll('.msg-video').forEach(v => v.pause());
        video.src = url;
        overlay.classList.remove('hidden');
        video.play().catch(() => {});
    }
}

function closeVideoFullscreen() {
    const overlay = document.getElementById('videoFullscreenOverlay');
    const video = document.getElementById('videoFullscreenVideo');
    if (video) { video.pause(); video.src = ''; }
    overlay?.classList.add('hidden');
}

// ========== USERS ==========
async function loadUsers() {
    try {
        const res = await fetch('/api/auth/users', {
            headers: { 'Authorization': 'Bearer ' + token }
        });
        const data = await res.json();
        if (Array.isArray(data)) {
            allUsers = data;
            // Аватарҳоро кэш кун
            data.forEach(user => {
                if (user.avatar) userAvatars[user.username] = user.avatar;
            });
            // Кэшдан охирин паёмро бор кун + хонда нашуда
            data.forEach(user => {
                const cached = getCachedMessages(user.username);
                if (cached && cached.length > 0) {
                    const last = cached[cached.length - 1];
                    const text = getLastMsgText(last);
                    if (!lastMessageInfo[user.username] || new Date(last.timestamp).getTime() > lastMessageInfo[user.username].timestamp) {
                        lastMessageInfo[user.username] = { text, timestamp: new Date(last.timestamp).getTime() };
                    }
                    if (!unreadMessages[user.username]) {
                        const unseenCount = cached.filter(m => m.sender === user.username && !m.seen).length;
                        if (unseenCount > 0) unreadMessages[user.username] = unseenCount;
                    }
                }
            });
            renderUsers(allUsers);
        }
    } catch (err) {
        console.log('Хатогӣ:', err);
    }
}

function getLastMsgText(msg) {
    if (!msg) return '';
    if (msg.type === 'system') return msg.body || '';
    if (msg.type === 'voice') return '🎤 Голосовой паём';
    if (msg.type === 'image') return '🖼 Сурат';
    if (msg.type === 'video') return '🎥 Видео';
    if (msg.type === 'document') return `📄 ${msg.fileName || 'Документ'}`;
    return msg.body || '';
}

// Рендер кардани ҳарду рӯйхат (корбарон + гурӯҳҳо) дар як рӯйхат, бо тартиб
function renderUsers(users) {
    const list = document.getElementById('usersList');
    const archiveRow = document.getElementById('archiveRow');
    list.innerHTML = '';
    if (archiveRow) list.appendChild(archiveRow);

    // Якҳела ҷамъ кардани chats: шахсӣ + гурӯҳӣ (бе чатҳои архившуда)
    const personalItems = users
        .filter(u => !archivedChats.has(u.username))
        .map(u => ({
            kind: 'user', key: u.username, data: u,
            time: lastMessageInfo[u.username]?.timestamp || 0
        }));
    const groupItems = allGroups
        .filter(g => !archivedChats.has(`group:${g._id}`))
        .map(g => ({
            kind: 'group', key: g._id, data: g,
            time: lastGroupMessageInfo[g._id]?.timestamp || (g.lastMessage ? new Date(g.lastMessage.timestamp).getTime() : new Date(g.createdAt).getTime())
        }));

    const combined = [...personalItems, ...groupItems].sort((a, b) => {
        const aPinned = pinnedChats.has(a.kind === 'group' ? `group:${a.key}` : a.key) ? 1 : 0;
        const bPinned = pinnedChats.has(b.kind === 'group' ? `group:${b.key}` : b.key) ? 1 : 0;
        if (aPinned !== bPinned) return bPinned - aPinned;
        return b.time - a.time;
    });

    combined.forEach(item => {
        if (item.kind === 'user') {
            list.appendChild(buildUserRow(item.data));
        } else {
            list.appendChild(buildGroupRow(item.data));
        }
    });
    updateArchiveRow();
}

function buildUserRow(user) {
    const isUnread = (unreadMessages[user.username] || 0) > 0;
    const isOnline = onlineUsers.has(user.username);
    const isTypingNow = typingTimers[user.username] === 'typing';
    const isVoiceNow = typingTimers[user.username] === 'voice';
    const lastInfo = lastMessageInfo[user.username];
    const lastText = lastInfo ? escapeHtml(lastInfo.text) : '';
    const avatarUrl = userAvatars[user.username] || '';

    const div = document.createElement('div');
    div.className = 'user-item' + (currentChat === user.username ? ' active' : '') + (isUnread ? ' has-unread' : '');
    div.onclick = () => openChat(user.username);

    let statusHtml = lastText;
    if (isTypingNow) statusHtml = '<span class="typing-dots"><span></span><span></span><span></span></span>';
    else if (isVoiceNow) statusHtml = '<span class="voice-recording-status"><i class="fa-solid fa-microphone"></i> Голосовой...</span>';

    const avatarInner = avatarUrl
        ? `<img src="${avatarUrl}" alt="${escapeHtml(user.username)}" />`
        : user.username[0].toUpperCase();

    const mutedIcon = isChatMuted(user.username) ? '<i class="fa-solid fa-volume-xmark muted-icon"></i>' : '';
    const pinnedIcon = isChatPinned(user.username) ? '<i class="fa-solid fa-thumbtack pinned-chat-icon"></i>' : '';
    if (isChatPinned(user.username)) div.classList.add('is-pinned');

    div.innerHTML = `
        <div class="user-avatar-wrap" onclick="event.stopPropagation(); showUserProfile('${escapeAttr(user.username)}')">
            <div class="user-avatar">${avatarInner}</div>
            ${isOnline ? '<div class="online-dot"></div>' : ''}
        </div>
        <div class="user-info">
            <div class="user-item-top">
                <div class="name ${isUnread ? 'unread-name' : ''}">${escapeHtml(user.username)}${mutedIcon}${pinnedIcon}</div>
            </div>
            <div class="last-msg ${isUnread ? 'unread-msg' : ''}" id="lastMsg_${user.username}">${statusHtml}</div>
        </div>
        ${isUnread ? `<div class="unread-badge">${unreadMessages[user.username]}</div>` : ''}
    `;
    return div;
}

function buildGroupRow(group) {
    const isUnread = (unreadGroupMessages[group._id] || 0) > 0;
    const lastInfo = lastGroupMessageInfo[group._id];
    const typingSet = groupTypingUsers[group._id];
    const avatarUrl = group.avatar || '';

    const div = document.createElement('div');
    div.className = 'user-item' + (currentGroupId === group._id ? ' active' : '') + (isUnread ? ' has-unread' : '');
    div.onclick = () => openGroupChat(group._id);

    let statusHtml = lastInfo ? escapeHtml(lastInfo.text) : (group.lastMessage ? escapeHtml(getLastMsgText(group.lastMessage)) : 'Гурӯҳ сохта шуд');
    if (typingSet && typingSet.size > 0) {
        const names = Array.from(typingSet).slice(0, 2).join(', ');
        statusHtml = `<span class="typing-dots"><span></span><span></span><span></span></span> <span style="margin-left:4px">${escapeHtml(names)}</span>`;
    }

    const avatarInner = avatarUrl
        ? `<img src="${avatarUrl}" alt="${escapeHtml(group.name)}" />`
        : '<i class="fa-solid fa-users group-badge-icon"></i>';

    const mutedIcon = isChatMuted(`group:${group._id}`) ? '<i class="fa-solid fa-volume-xmark muted-icon"></i>' : '';
    const pinnedIcon = isChatPinned(`group:${group._id}`) ? '<i class="fa-solid fa-thumbtack pinned-chat-icon"></i>' : '';
    if (isChatPinned(`group:${group._id}`)) div.classList.add('is-pinned');

    div.innerHTML = `
        <div class="user-avatar-wrap">
            <div class="user-avatar group-avatar-icon">${avatarInner}</div>
        </div>
        <div class="user-info">
            <div class="user-item-top">
                <div class="name ${isUnread ? 'unread-name' : ''}">${escapeHtml(group.name)}${mutedIcon}${pinnedIcon}</div>
            </div>
            <div class="last-msg ${isUnread ? 'unread-msg' : ''}" id="lastMsgGroup_${group._id}">${statusHtml}</div>
        </div>
        ${isUnread ? `<div class="unread-badge">${unreadGroupMessages[group._id]}</div>` : ''}
    `;
    return div;
}

function searchUsers() {
    const query = document.getElementById('searchInput').value.toLowerCase();
    const filteredUsers = allUsers.filter(u => u.username.toLowerCase().includes(query) && !archivedChats.has(u.username));
    const filteredGroups = allGroups.filter(g => g.name.toLowerCase().includes(query) && !archivedChats.has(`group:${g._id}`));
    const list = document.getElementById('usersList');
    const archiveRow = document.getElementById('archiveRow');
    list.innerHTML = '';
    if (archiveRow && !query) list.appendChild(archiveRow);
    const personalItems = filteredUsers.map(u => ({ kind: 'user', data: u, time: lastMessageInfo[u.username]?.timestamp || 0 }));
    const groupItems = filteredGroups.map(g => ({ kind: 'group', data: g, time: lastGroupMessageInfo[g._id]?.timestamp || new Date(g.createdAt).getTime() }));
    const combined = [...personalItems, ...groupItems].sort((a, b) => b.time - a.time);
    combined.forEach(item => {
        list.appendChild(item.kind === 'user' ? buildUserRow(item.data) : buildGroupRow(item.data));
    });
    if (archiveRow && !query) updateArchiveRow();
}

// ========== CHAT (шахсӣ) ==========
async function openChat(username) {
    // №9 — агар ҳамон чат боз зер карда шавад, ҳеҷ кор нашавад
    if (currentChat === username && !currentGroupId) {
        document.getElementById('chatArea').classList.add('open');
        return;
    }

    currentGroupId = null;

    // Дархол чати қаблиро тоза кун
    const container = document.getElementById('messagesContainer');
    container.innerHTML = '';
    container.onscroll = null;

    // №7 — Дархол хонда нашударо тоза кун ва кэшро навсозӣ кун
    if (unreadMessages[username]) {
        delete unreadMessages[username];
    }
    const cachedForSeen = getCachedMessages(username);
    if (cachedForSeen) {
        let changed = false;
        cachedForSeen.forEach(m => {
            if (m.sender === username && !m.seen) { m.seen = true; changed = true; }
        });
        if (changed) cacheMessages(username, cachedForSeen);
    }

    currentChat = username;
    unreadMessages[username] = 0;
    hasMoreMessages = true;
    oldestTimestamp = null;
    stopCurrentAudio();

    document.getElementById('chatDefault').classList.add('hidden');
    document.getElementById('chatScreen').classList.remove('hidden');
    document.getElementById('chatUsername').textContent = username;
    // №4 — Аватар дар header
    const chatAvEl = document.getElementById('chatAvatar');
    chatAvEl.classList.remove('group-avatar-icon');
    const av = userAvatars[username] || '';
    renderAvatarEl(chatAvEl, username, av);
    document.getElementById('chatArea').classList.add('open');
    document.getElementById('chatStatus').style.display = '';
    document.getElementById('membersTypingBar')?.classList.add('hidden');
    // Сабтшуда паёмро бор кун
    loadPinnedMessage();
    updateChatStatus(username);
    updateMuteButtonText();
    updatePinChatButtonText();
    cancelReply();
    renderUsers(allUsers);

    await loadMessages();

    container.onscroll = () => {
        if (container.scrollTop < 80 && !isLoadingMore && hasMoreMessages) {
            loadMoreMessages();
        }
    };
}

let lastSeenCache = {};

function updateChatStatus(username) {
    const statusEl = document.getElementById('chatStatus');
    if (statusEl) {
        if (typingTimers[username] === 'voice') {
            statusEl.innerHTML = '<i class="fa-solid fa-microphone" style="font-size:11px;margin-right:3px;"></i> Голосовой карда истодааст...';
            statusEl.className = 'chat-status typing';
        } else if (typingTimers[username] === 'typing') {
            statusEl.textContent = 'нависонда истодааст...';
            statusEl.className = 'chat-status typing';
        } else if (onlineUsers.has(username)) {
            statusEl.textContent = 'онлайн';
            statusEl.className = 'chat-status online';
        } else if (lastSeenCache[username] !== undefined) {
            statusEl.textContent = lastSeenCache[username] ? `дидашуда: ${formatLastSeen(lastSeenCache[username])}` : '';
            statusEl.className = 'chat-status';
        } else {
            statusEl.textContent = '';
            statusEl.className = 'chat-status';
            fetchLastSeenForHeader(username);
        }
    }
    const bubble = document.getElementById('typingBubbleIndicator');
    if (bubble) {
        const state = typingTimers[username];
        if ((state === 'typing' || state === 'voice') && currentChat === username) {
            bubble.classList.add('visible');
            if (state === 'voice') {
                bubble.innerHTML = '<div class="typing-bubble voice-bubble-indicator"><i class="fa-solid fa-microphone"></i></div>';
            } else {
                bubble.innerHTML = '<div class="typing-bubble"><span></span><span></span><span></span></div>';
            }
            const c = document.getElementById('messagesContainer');
            if (c) c.scrollTop = c.scrollHeight;
        } else {
            bubble.classList.remove('visible');
        }
    }
}

async function fetchLastSeenForHeader(username) {
    try {
        const res = await fetch(`/api/auth/profile/${username}`, { headers: { 'Authorization': 'Bearer ' + token } });
        const profile = await res.json();
        lastSeenCache[username] = profile.lastSeenHidden ? null : (profile.lastSeenAt || null);
        if (currentChat === username) updateChatStatus(username);
    } catch (e) { lastSeenCache[username] = null; }
}

function goBack() {
    document.getElementById('chatArea').classList.remove('open');
    document.getElementById('chatScreen').classList.add('hidden');
    document.getElementById('chatDefault').classList.remove('hidden');
    currentChat = null;
    currentGroupId = null;
    cancelReply();
    stopCurrentAudio();
    const container = document.getElementById('messagesContainer');
    container.innerHTML = '';
    container.onscroll = null;
}

// Pending паёмҳои навбатро render кардан (медиа/voice/text)
function renderPendingForChat(username) {
    const container = document.getElementById('messagesContainer');
    if (!container) return;
    let added = false;
    sendQueue.forEach(task => {
        if (task.receiver === username && task.tempMsg && !document.getElementById(`msg_${task.tempId}`)) {
            renderMessage(task.tempMsg, true);
            added = true;
        }
    });
    if (added) container.scrollTop = container.scrollHeight;
}

function renderPendingForGroup(groupId) {
    const container = document.getElementById('messagesContainer');
    if (!container) return;
    let added = false;
    sendQueue.forEach(task => {
        if (task.groupId === groupId && task.tempMsg && !document.getElementById(`msg_${task.tempId}`)) {
            renderMessage(task.tempMsg, true);
            added = true;
        }
    });
    if (added) container.scrollTop = container.scrollHeight;
}

async function loadMessages() {
    const container = document.getElementById('messagesContainer');
    container.innerHTML = '';

    // 1. Аввал кэшро нишон деҳ — фаврӣ
    const cached = getCachedMessages(currentChat);
    if (cached && cached.length > 0) {
        cached.forEach(msg => renderMessage(msg));
        container.scrollTop = container.scrollHeight;
    }

    // Pending медиа/паёмҳо — фавран нишон деҳ (новобаста аз fetch)
    renderPendingForChat(currentChat);

    // 2. Аз сервер навсозӣ кун
    try {
        const res = await fetch(`/api/messages/${currentChat}`, {
            headers: { 'Authorization': 'Bearer ' + token }
        });
        if (!res.ok) { hasMoreMessages = false; return; }
        const messages = await res.json();

        // UI-ро навсозӣ кун
        container.innerHTML = '';
        if (messages.length < 30) hasMoreMessages = false;
        if (messages.length > 0) oldestTimestamp = messages[0].timestamp;
        messages.forEach(msg => renderMessage(msg));
        container.scrollTop = container.scrollHeight;

        // Pending-ро дубора нишон деҳ
        renderPendingForChat(currentChat);

        // Кэш кун
        cacheMessages(currentChat, messages);

        // Seen
        messages.forEach(msg => {
            if (msg.sender === currentChat && !msg.seen) markSeen(msg._id);
        });
    } catch (err) {
        // Офлайн — кэш аллакай нишон дода шудааст
        hasMoreMessages = false;
        if (!cached || cached.length === 0) {
            container.innerHTML = '';
            renderPendingForChat(currentChat);
            if (!sendQueue.some(t => t.receiver === currentChat)) {
                container.innerHTML = '<div style="text-align:center;color:var(--text3);padding:20px;font-size:13px;">Интернет нест. Паёмҳо дастрас нестанд.</div>';
            }
        }
    }
}

async function loadMoreMessages() {
    if (!hasMoreMessages || !oldestTimestamp) return;
    if (currentGroupId) return loadMoreGroupMessages();
    if (!currentChat) return;
    isLoadingMore = true;
    const container = document.getElementById('messagesContainer');
    const prevScrollHeight = container.scrollHeight;
    const prevScrollTop = container.scrollTop;
    try {
        const res = await fetch(`/api/messages/${currentChat}?before=${oldestTimestamp}`, {
            headers: { 'Authorization': 'Bearer ' + token }
        });
        const messages = await res.json();
        if (messages.length === 0) { hasMoreMessages = false; isLoadingMore = false; return; }
        if (messages.length < 30) hasMoreMessages = false;
        oldestTimestamp = messages[0].timestamp;
        const fragment = document.createDocumentFragment();
        messages.forEach(msg => {
            if (!document.getElementById(`msg_${msg._id}`)) {
                const el = createMessageElement(msg);
                if (el) fragment.appendChild(el);
            }
        });
        container.insertBefore(fragment, container.firstChild);
        container.scrollTop = prevScrollTop + (container.scrollHeight - prevScrollHeight);

        // Кэшро навсозӣ кун
        const chatUsername = currentChat;
        appendToCache(chatUsername, messages);
    } catch (err) {
        console.log('Хатогӣ:', err);
    }
    isLoadingMore = false;
}

async function markSeen(msgId) {
    try {
        await fetch(`/api/messages/seen/${msgId}`, {
            method: 'PUT',
            headers: { 'Authorization': 'Bearer ' + token }
        });
        socket.emit('messageSeen', { msgId, sender: currentChat });
        // Кэшро навсозӣ кун — то баъди refresh ҳам seen=true бошад
        const cached = getCachedMessages(currentChat);
        if (cached) {
            const msg = cached.find(m => m._id === msgId);
        if (msg) { msg.seen = true; msg.delivered = true; cacheMessages(currentChat, cached); }
        }
    } catch (err) {}
}

function isDeletedForMe(msg) {
    if (msg.groupId) {
        return (msg.deletedFor || []).includes(myUsername);
    }
    // №8 — Агар БАРОИ МАН ҳазф шуда бошад, паём пурра нопадид мешавад (на "ҳазф шуд" блок)
    if (msg.sender === myUsername && msg.deletedBySender) return true;
    if (msg.receiver === myUsername && msg.deletedByReceiver) return true;
    return false;
}

function createMessageElement(msg, isPending = false) {
    const isSent = msg.sender === myUsername;
    if (isDeletedForMe(msg)) return null;

    // Паёми системавӣ (гурӯҳ)
    if (msg.type === 'system') {
        const wrapper = document.createElement('div');
        wrapper.className = 'message-wrapper system-message';
        wrapper.id = `msg_${msg._id}`;
        wrapper.textContent = msg.body;
        return wrapper;
    }

    const isGroup = !!msg.groupId;
    const wrapper = document.createElement('div');
    wrapper.className = `message-wrapper ${isSent ? 'sent' : 'received'} ${isPending ? 'pending' : ''} ${isGroup && !isSent ? 'group-received-row' : ''}`;
    wrapper.id = `msg_${msg._id}`;

    // Свайп барои ответ (мобайл)
    addSwipeReply(wrapper, msg);

    let replyHTML = '';
    if (msg.replyTo && msg.replyTo._id) {
        let rawReply = '';
        if (msg.replyTo.type === 'voice') rawReply = '🎤 Голос';
        else if (msg.replyTo.type === 'image') rawReply = '🖼 Сурат';
        else if (msg.replyTo.type === 'video') rawReply = '🎥 Видео';
        else rawReply = msg.replyTo.body || '';
        const replyText = escapeHtml(rawReply.replace(/\n+/g, ' ').trim()).substring(0, 50);
        replyHTML = `<div class="reply-preview" onclick="scrollToMsg('${msg.replyTo._id}')"><span class="reply-name">${escapeHtml(msg.replyTo.sender)}</span><span class="reply-text">${replyText || '...'}</span></div>`;
    }

    // Номи фиристанда дар паёми гурӯҳ (танҳо received)
    let senderNameHTML = '';
    if (isGroup && !isSent) {
        senderNameHTML = `<span class="group-sender-name" style="color:${senderColor(msg.sender)}">${escapeHtml(msg.sender)}</span>`;
    }

    // Forwarded label
    let forwardedHTML = '';
    if (msg.isForwarded) {
        forwardedHTML = `<div class="forwarded-label"><i class="fa-solid fa-share"></i> Форвард шудааст</div>`;
    }
    senderNameHTML = senderNameHTML + forwardedHTML;

    let content = '';
    if (msg.type === 'voice') {
        content = renderVoiceHTML(msg, replyHTML, senderNameHTML);
    } else if (msg.type === 'document') {
        content = renderDocumentHTML(msg, replyHTML, senderNameHTML);
    } else if (msg.type === 'image') {
        const pendingOverlay = isPending ? '<div class="media-pending-overlay"><i class="fa-solid fa-spinner"></i><span>Фиристода истода...</span></div>' : '';
        const captionHTML = msg.caption ? `<div class="media-caption">${escapeHtml(msg.caption)}</div>` : '';
        content = `<div class="message-bubble media-bubble" style="position:relative;">
            ${senderNameHTML}${replyHTML}
            <img class="msg-image" src="${msg.mediaUrl}" alt="Сурат" onclick="${isPending ? '' : `openImageViewer('${msg.mediaUrl}')`}" loading="lazy"/>
            ${captionHTML}
            ${pendingOverlay}
        </div>`;
    } else if (msg.type === 'video') {
        const pendingOverlay = isPending ? `<div class="media-pending-overlay"><i class="fa-solid fa-spinner"></i><span id="prog_${msg._id}">0%</span></div>` : '';
        const poster = msg.thumbUrl ? ` poster="${msg.thumbUrl}"` : '';
        const captionHTML = msg.caption ? `<div class="media-caption">${escapeHtml(msg.caption)}</div>` : '';
        content = `<div class="message-bubble media-bubble no-menu" style="position:relative;">
            ${senderNameHTML}${replyHTML}
            <div class="video-wrapper" onclick="${isPending ? '' : "toggleVideoPlay(this.querySelector('.video-play-overlay'))"}">
                <video class="msg-video"${poster} playsinline preload="none">
                    <source src="${msg.mediaUrl}"/>
                </video>
                <div class="video-play-overlay" onclick="event.stopPropagation(); toggleVideoPlay(this)">
                    <div class="video-play-btn"><i class="fa-solid fa-play"></i></div>
                </div>
                <div class="video-progress-bar"><div class="video-progress-fill"></div></div>
                <button class="video-fullscreen-btn" onclick="event.stopPropagation(); openVideoFullscreen('${msg.mediaUrl}')"><i class="fa-solid fa-expand"></i></button>
            </div>
            ${captionHTML}
            ${pendingOverlay}
        </div>`;
    } else {
        // Логикаи смайликҳои калон (Big Emoji Behavior)
        const bigEmojiInfo = detectBigEmoji(msg.body || '');
        if (bigEmojiInfo && !msg.replyTo) {
            const sizeClass = bigEmojiInfo.count === 1 ? '' : 'count-2-4';
            content = `<div class="message-bubble big-emoji-bubble">
                ${senderNameHTML}
                <div class="big-emoji-content ${sizeClass}">${escapeHtml(msg.body)}</div>
            </div>`;
        } else {
            // №16 — паёми дароз
            const MAX_LEN = 300;
            const bodyText = msg.body || '';
            const editedLabel = msg.edited ? '<span class="edited-label"> (иваз карда шуд)</span>' : '';
            if (bodyText.length > MAX_LEN) {
                const shortHtml = escapeHtml(bodyText.substring(0, MAX_LEN));
                const fullHtml = escapeHtml(bodyText);
                content = `<div class="message-bubble">
                    ${senderNameHTML}${replyHTML}
                    <span class="msg-short">${shortHtml}</span><span class="msg-full" style="display:none">${fullHtml}</span><span class="expand-btn" onclick="expandMsg(this, event)"> Бештар...</span>${editedLabel}
                </div>`;
            } else {
                content = `<div class="message-bubble">${senderNameHTML}${replyHTML}${escapeHtml(bodyText)}${editedLabel}</div>`;
            }
        }
    }

    const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    let reactionsHTML = '';
    if (isGroup) {
        const reactions = msg.groupReactions || {};
        const entries = Object.entries(reactions);
        if (entries.length > 0) {
            reactionsHTML = `<div class="reactions-row" onclick="showGroupReactionInfo('${msg._id}', event)">`;
            // group emoji ҳамдигар (то 5 нафар)
            const emojis = [...new Set(entries.map(([, e]) => e))];
            emojis.slice(0, 6).forEach(e => { reactionsHTML += `<span class="reaction-badge">${e}</span>`; });
            if (entries.length > 0) reactionsHTML += `<span class="reaction-badge" style="font-size:10px;color:var(--text3)">${entries.length}</span>`;
            reactionsHTML += `</div>`;
        }
    } else {
        const rSender = msg.reactionBySender || '';
        const rReceiver = msg.reactionByReceiver || '';
        if (rSender || rReceiver) {
            reactionsHTML = `<div class="reactions-row" onclick="showReactionInfo('${escapeAttr(rSender)}','${escapeAttr(rReceiver)}','${escapeAttr(msg.sender)}','${escapeAttr(msg.receiver)}', event)">`;
            if (rSender) reactionsHTML += `<span class="reaction-badge">${rSender}</span>`;
            if (rReceiver) reactionsHTML += `<span class="reaction-badge">${rReceiver}</span>`;
            reactionsHTML += `</div>`;
        }
    }

    let seenHTML = '';
    if (isSent && !isPending) {
        if (isGroup) {
            const seenByOthers = (msg.seenBy || []).filter(u => u !== myUsername);
            seenHTML = seenByOthers.length > 0
                ? '<i class="fa-solid fa-check-double seen-icon seen"></i>'
                : '<i class="fa-solid fa-check seen-icon"></i>';
        } else if (msg.seen) {
            seenHTML = '<i class="fa-solid fa-check-double seen-icon seen"></i>';
        } else if (msg.delivered) {
            seenHTML = '<i class="fa-solid fa-check-double seen-icon"></i>';
        } else {
            seenHTML = '<i class="fa-solid fa-check seen-icon"></i>';
        }
    }

    const pendingIcon = isPending ? '<i class="fa-solid fa-clock pending-icon"></i>' : '';
    const starIcon = (msg.starredBy || []).includes(myUsername) ? '<i class="fa-solid fa-star msg-star-indicator"></i>' : '';

    const innerHTML = `
        ${content}
        <div class="msg-actions">${reactionsHTML}</div>
        <div class="message-time">${starIcon}${pendingIcon}${seenHTML}${time}</div>
    `;

    // Дар чати гурӯҳ — received паёмҳо бо аватар
    if (isGroup && !isSent) {
        const avatarUrl = userAvatars[msg.sender] || '';
        const avatarInner = avatarUrl
            ? `<img src="${avatarUrl}" alt="${escapeHtml(msg.sender)}"/>`
            : msg.sender[0].toUpperCase();
        wrapper.innerHTML = `
            <div class="group-msg-avatar" onclick="showUserProfile('${escapeAttr(msg.sender)}')">${avatarInner}</div>
            <div class="group-msg-content">${innerHTML}</div>
        `;
    } else {
        wrapper.innerHTML = innerHTML;
    }

    // Контекст меню — клик
    const bubble = wrapper.querySelector('.message-bubble');
    if (bubble && !msg.deletedBySender && !msg.deletedByReceiver && !isPending) {
        bubble.addEventListener('click', (e) => {
            if (e.target.closest('.reply-preview')) return;
            if (e.target.closest('.voice-play-btn')) return;
            if (e.target.closest('.voice-progress')) return;
            // №3 — Видео: танҳо берун аз video-wrapper зер кардан меню кушояд
            if (e.target.closest('.video-wrapper')) return;
            if (e.target.closest('.msg-image')) {
                // Сурат: меню кушояд (мисли пештара)
            }
            showInlineMenu(e, msg, wrapper);
        });
    }

    return wrapper;
}

// Ранги муайяни ном барои ҳар фиристандаи гурӯҳ (мисли WhatsApp)
const SENDER_COLORS = ['#e17076','#7bc862','#65aadd','#a695e7','#ee7aae','#6ec9cb','#faa774','#bd86e0'];
function senderColor(username) {
    let hash = 0;
    for (let i = 0; i < username.length; i++) hash = (hash * 31 + username.charCodeAt(i)) >>> 0;
    return SENDER_COLORS[hash % SENDER_COLORS.length];
}

// ========== INLINE CONTEXT MENU ==========
let activeInlineMenu = null;

function showInlineMenu(e, msg, wrapper) {
    e.stopPropagation();
    closeInlineMenu();

    const isSent = msg.sender === myUsername;
    const isGroup = !!msg.groupId;
    const menu = document.createElement('div');
    menu.className = `inline-menu ${isSent ? 'sent-menu' : 'received-menu'}`;
    menu.id = 'inlineMenu_' + msg._id;

    const mainReactions = ['❤️', '😂', '😮', '😢', '👍'];
    let reactHtml = '<div class="inline-reactions">';
    mainReactions.forEach(r => {
        if (isGroup) {
            reactHtml += `<span onclick="setGroupReactionInline('${msg._id}','${r}')">${r}</span>`;
        } else {
            reactHtml += `<span onclick="setReactionInline('${msg._id}','${r}','${isSent ? 'sender' : 'receiver'}','${escapeAttr(msg.sender)}','${escapeAttr(msg.receiver)}')">${r}</span>`;
        }
    });
    if (isGroup) {
        reactHtml += `<span class="more-reactions-btn" onclick="toggleMoreReactionsGroup(this, '${msg._id}')">➕</span>`;
    } else {
        reactHtml += `<span class="more-reactions-btn" onclick="toggleMoreReactions(this, '${msg._id}','${isSent ? 'sender' : 'receiver'}','${escapeAttr(msg.sender)}','${escapeAttr(msg.receiver)}')">➕</span>`;
    }
    reactHtml += '</div>';

    let actionsHtml = '<div class="inline-actions">';
    actionsHtml += `<button onclick="inlineReply('${msg._id}','${escapeAttr(msg.sender)}',\`${msg.type === 'voice' ? '🎤 Голосовой паём' : escapeHtml(msg.body || '').replace(/`/g, "'")}\`,'${msg.type || 'text'}')"><i class="fa-solid fa-reply"></i> Ҷавоб</button>`;
    if (!isGroup) {
        actionsHtml += `<button onclick="inlineForward('${msg._id}', false)"><i class="fa-solid fa-share"></i> Форвард</button>`;
    }
    if (isSent && msg.type === 'text') {
        actionsHtml += `<button onclick="startEditMessage('${msg._id}','${escapeAttr(msg.body || '')}')"><i class="fa-solid fa-pen"></i> Иваз кун</button>`;
    }
    if (isSent) {
        actionsHtml += `<button onclick="showMessageInfo('${msg._id}', ${isGroup})"><i class="fa-solid fa-circle-info"></i> Маълумоти паём</button>`;
    }
    actionsHtml += `<button onclick="toggleStarMessage('${msg._id}')"><i class="fa-solid fa-star"></i> ${(msg.starredBy || []).includes(myUsername) ? 'Star хориҷ кун' : 'Star кун'}</button>`;
    actionsHtml += `<button onclick="pinMessageById('${msg._id}')"><i class="fa-solid fa-thumbtack"></i> Сабт</button>`;
    if (isGroup) {
        actionsHtml += `<button class="del-btn" onclick="inlineDeleteGroup('${msg._id}')"><i class="fa-solid fa-trash"></i> Ҳазф</button>`;
    } else {
        actionsHtml += `<button class="del-btn" onclick="inlineDelete('${msg._id}','${escapeAttr(msg.sender)}','${escapeAttr(msg.receiver)}')"><i class="fa-solid fa-trash"></i> Ҳазф</button>`;
    }
    actionsHtml += '</div>';

    menu.innerHTML = reactHtml + actionsHtml;
    menu.style.position = 'fixed';
    menu.style.zIndex = '9997';
    document.body.appendChild(menu);
    activeInlineMenu = menu;

    // Дар ҳамон ҷойи зер кардан нишон деҳ
    requestAnimationFrame(() => {
        const mW = menu.offsetWidth || 250;
        const mH = menu.offsetHeight || 110;
        const tapX = e.clientX || (e.touches && e.touches[0]?.clientX) || window.innerWidth / 2;
        const tapY = e.clientY || (e.touches && e.touches[0]?.clientY) || window.innerHeight / 2;

        let top = tapY - mH - 10;
        if (top < 8) top = tapY + 10;
        if (top + mH > window.innerHeight - 8) top = window.innerHeight - mH - 8;

        let left = isSent ? tapX - mW : tapX;
        if (left + mW > window.innerWidth - 8) left = window.innerWidth - mW - 8;
        if (left < 8) left = 8;

        menu.style.top = top + 'px';
        menu.style.left = left + 'px';
    });

    setTimeout(() => {
        if (_closeMenuHandler) {
            document.removeEventListener('mousedown', _closeMenuHandler);
            document.removeEventListener('touchstart', _closeMenuHandler);
        }
        _closeMenuHandler = (evt) => {
            if (activeInlineMenu && !activeInlineMenu.contains(evt.target)) {
                closeInlineMenu();
            }
        };
        document.addEventListener('mousedown', _closeMenuHandler);
        document.addEventListener('touchstart', _closeMenuHandler);
    }, 100);
}

let _closeMenuHandler = null;

function closeInlineMenu() {
    if (activeInlineMenu) {
        activeInlineMenu.remove();
        activeInlineMenu = null;
    }
    if (_closeMenuHandler) {
        document.removeEventListener('mousedown', _closeMenuHandler);
        document.removeEventListener('touchstart', _closeMenuHandler);
        _closeMenuHandler = null;
    }
}

function closeInlineMenuOutside(e) {
    if (activeInlineMenu && !activeInlineMenu.contains(e.target)) {
        closeInlineMenu();
    }
}

function toggleMoreReactions(btn, msgId, side, msgSender, msgReceiver) {
    const existing = btn.parentElement.querySelector('.more-reactions-list');
    if (existing) { existing.remove(); return; }
    const all = ['😡','👎','🔥','🎉','💯','😍','🤔','😴','🥳','💪','🙏','😎','❓','✅','💔'];
    const div = document.createElement('div');
    div.className = 'more-reactions-list';
    all.forEach(r => {
        const span = document.createElement('span');
        span.textContent = r;
        span.onclick = () => setReactionInline(msgId, r, side, msgSender, msgReceiver);
        div.appendChild(span);
    });
    btn.parentElement.appendChild(div);
}

function toggleMoreReactionsGroup(btn, msgId) {
    const existing = btn.parentElement.querySelector('.more-reactions-list');
    if (existing) { existing.remove(); return; }
    const all = ['😡','👎','🔥','🎉','💯','😍','🤔','😴','🥳','💪','🙏','😎','❓','✅','💔'];
    const div = document.createElement('div');
    div.className = 'more-reactions-list';
    all.forEach(r => {
        const span = document.createElement('span');
        span.textContent = r;
        span.onclick = () => setGroupReactionInline(msgId, r);
        div.appendChild(span);
    });
    btn.parentElement.appendChild(div);
}

async function setReactionInline(msgId, emoji, side, msgSender, msgReceiver) {
    closeInlineMenu();
    selectedMessageId = msgId;
    contextMsgSender = msgSender;
    contextMsgReceiver = msgReceiver;

    try {
        const res = await fetch(`/api/messages/reaction/${msgId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ reaction: emoji, side })
        });
        const updatedMsg = await res.json();
        updateReactionInUI(updatedMsg);
        socket.emit('reaction', {
            _id: msgId, reaction: emoji, side,
            sender: myUsername, receiver: currentChat,
            reactionBySender: updatedMsg.reactionBySender,
            reactionByReceiver: updatedMsg.reactionByReceiver,
            msgSender: updatedMsg.sender, msgReceiver: updatedMsg.receiver
        });
    } catch (err) {
        console.log('Хатогӣ:', err);
    }
}

async function setGroupReactionInline(msgId, emoji) {
    closeInlineMenu();
    try {
        const res = await fetch(`/api/groups/${currentGroupId}/messages/${msgId}/reaction`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ reaction: emoji })
        });
        const data = await res.json();
        updateGroupReactionInUI(data._id, data.groupReactions);
        socket.emit('groupReaction', { groupId: currentGroupId, _id: msgId, groupReactions: data.groupReactions, sender: myUsername });
    } catch (err) {
        console.log('Хатогӣ:', err);
    }
}

function inlineReply(msgId, sender, text, type) {
    closeInlineMenu();
    setReply(msgId, sender, type === 'voice' ? '🎤 Голосовой паём' : text, type);
}

async function inlineDelete(msgId, msgSender, msgReceiver) {
    closeInlineMenu();
    enterMultiSelectMode(msgId);
}
async function inlineDeleteGroup(msgId) {
    closeInlineMenu();
    enterMultiSelectMode(msgId);
}

// ========== MULTI-SELECT DELETE (WhatsApp style) ==========
function enterMultiSelectMode(preSelectMsgId) {
    isMultiSelectMode = true;
    selectedMessages = new Set();
    if (preSelectMsgId) selectedMessages.add(preSelectMsgId);

    const container = document.getElementById('messagesContainer');
    if (container) container.classList.add('multiselect-mode');

    // Ба ҳамаи паёмҳо checkbox илова кун
    document.querySelectorAll('.message-wrapper').forEach(wrapper => {
        if (wrapper.classList.contains('system-message')) return;
        addCheckboxToWrapper(wrapper);
    });

    document.getElementById('multiSelectToolbar')?.classList.remove('hidden');
    updateMsCount();
}

function addCheckboxToWrapper(wrapper) {
    if (wrapper.querySelector('.msg-checkbox-wrap')) return;
    const msgId = wrapper.id.replace('msg_', '');
    const cb = document.createElement('div');
    cb.className = 'msg-checkbox-wrap';
    cb.innerHTML = `<input type="checkbox" class="msg-checkbox" ${selectedMessages.has(msgId) ? 'checked' : ''}/>`;
    cb.querySelector('input').addEventListener('change', (e) => {
        if (e.target.checked) selectedMessages.add(msgId);
        else selectedMessages.delete(msgId);
        wrapper.classList.toggle('selected-msg', e.target.checked);
        updateMsCount();
    });
    // Паёмро зер кардан ҳам toggle мекунад
    wrapper.addEventListener('click', wrapperMultiSelectClick);
    if (selectedMessages.has(msgId)) wrapper.classList.add('selected-msg');

    const isSent = wrapper.classList.contains('sent');
    if (isSent) wrapper.appendChild(cb);
    else wrapper.insertBefore(cb, wrapper.firstChild);
}

function wrapperMultiSelectClick(e) {
    if (!isMultiSelectMode) return;
    const wrapper = e.currentTarget;
    const msgId = wrapper.id.replace('msg_', '');
    const cb = wrapper.querySelector('.msg-checkbox');
    if (!cb) return;
    cb.checked = !cb.checked;
    if (cb.checked) selectedMessages.add(msgId);
    else selectedMessages.delete(msgId);
    wrapper.classList.toggle('selected-msg', cb.checked);
    updateMsCount();
}

function updateMsCount() {
    const el = document.getElementById('msCount');
    if (el) el.textContent = `${selectedMessages.size} интихоб`;
}

function exitMultiSelectMode() {
    isMultiSelectMode = false;
    selectedMessages.clear();
    document.getElementById('messagesContainer')?.classList.remove('multiselect-mode');
    document.getElementById('multiSelectToolbar')?.classList.add('hidden');
    document.querySelectorAll('.msg-checkbox-wrap').forEach(c => c.remove());
    document.querySelectorAll('.message-wrapper').forEach(w => {
        w.classList.remove('selected-msg');
        w.removeEventListener('click', wrapperMultiSelectClick);
    });
}

async function deleteSelected() {
    if (selectedMessages.size === 0) return;
    const ids = Array.from(selectedMessages);

    // Санҷидан: оё паёми дигаре ҳаст?
    const hasOthers = ids.some(id => {
        const w = document.getElementById(`msg_${id}`);
        return w && w.classList.contains('received');
    });

    const overlay = document.getElementById('deleteDialogOverlay');
    if (!overlay) return;

    if (hasOthers) {
        // Танҳо "аз худам ҳазф кун"
        overlay.classList.remove('hidden');
        document.getElementById('deleteForAllBtn').style.display = 'none';
        document.getElementById('deleteForMeBtn').onclick = async () => {
            overlay.classList.add('hidden');
            document.getElementById('deleteForAllBtn').style.display = '';
            await deleteSelectedBulk(ids, 'me');
            exitMultiSelectMode();
        };
        document.getElementById('deleteCancelBtn').onclick = () => {
            overlay.classList.add('hidden');
            document.getElementById('deleteForAllBtn').style.display = '';
        };
    } else {
        // Ҳарду вариант
        overlay.classList.remove('hidden');
        document.getElementById('deleteForAllBtn').style.display = '';
        document.getElementById('deleteForAllBtn').onclick = async () => {
            overlay.classList.add('hidden');
            await deleteSelectedBulk(ids, 'all');
            exitMultiSelectMode();
        };
        document.getElementById('deleteForMeBtn').onclick = async () => {
            overlay.classList.add('hidden');
            await deleteSelectedBulk(ids, 'me');
            exitMultiSelectMode();
        };
        document.getElementById('deleteCancelBtn').onclick = () => overlay.classList.add('hidden');
    }
}

async function deleteSelectedBulk(ids, mode) {
    if (currentGroupId) {
        try {
            const res = await fetch(`/api/groups/${currentGroupId}/bulk-delete`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                body: JSON.stringify({ ids, deleteFor: mode })
            });
            const data = await res.json();
            (data.results || []).forEach(r => {
                const wrapper = document.getElementById(`msg_${r.id}`);
                if (wrapper) wrapper.remove();
                if (r.deletedFor === 'all') {
                    socket.emit('deleteGroupMessage', { groupId: currentGroupId, _id: r.id, deletedFor: 'all', sender: myUsername });
                }
            });
        } catch(e) { console.log(e); }
        return;
    }
    for (const id of ids) {
        await deleteSingleMsg(id, mode);
    }
}

async function deleteSingleMsg(msgId, mode) {
    const wrapper = document.getElementById(`msg_${msgId}`);
    if (!wrapper) return;
    const isSent = wrapper.classList.contains('sent');
    try {
        const res = await fetch(`/api/messages/${msgId}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ deleteFor: mode === 'all' && isSent ? 'all' : 'me' })
        });
        const data = await res.json();
        if (data.success) {
            if (data.deletedFor === 'all') {
                wrapper.remove();
                socket.emit('deleteMessage', { _id: msgId, sender: myUsername, receiver: currentChat, deletedFor: 'all' });
            } else {
                wrapper.remove();
            }
        }
    } catch(e) { console.log(e); }
}

// ========== SWIPE TO REPLY (mobile) — Instagram style ==========
function addSwipeReply(wrapper, msg) {
    if (msg.type === 'system') return;
    let startX = 0;
    let startY = 0;
    let swipeTriggered = false;
    let isHorizontal = false;
    const TRIGGER_THRESHOLD = 72;
    const MAX_DRAG = 80;

    wrapper.addEventListener('touchstart', (e) => {
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        swipeTriggered = false;
        isHorizontal = false;
        wrapper.style.transition = 'none';
    }, { passive: true });

    wrapper.addEventListener('touchmove', (e) => {
        const dx = e.touches[0].clientX - startX;
        const dy = Math.abs(e.touches[0].clientY - startY);

        if (!isHorizontal && dy > Math.abs(dx) + 5) return;
        if (Math.abs(dx) > 8) isHorizontal = true;
        if (!isHorizontal) return;

        const isSent = msg.sender === myUsername;
        const validSwipe = isSent ? dx < -8 : dx > 8;
        if (!validSwipe) return;

        const absDx = Math.min(Math.abs(dx), MAX_DRAG);
        const dampened = absDx * (1 - absDx / (MAX_DRAG * 2.5));
        const move = Math.max(0, Math.min(dampened, MAX_DRAG * 0.75));

        wrapper.style.transform = isSent ? `translateX(-${move}px)` : `translateX(${move}px)`;

        if (Math.abs(dx) > TRIGGER_THRESHOLD && !swipeTriggered) {
            swipeTriggered = true;
            showSwipeReplyIndicator(wrapper, msg);
            if (navigator.vibrate) navigator.vibrate(30);
        }
    }, { passive: true });

    wrapper.addEventListener('touchend', () => {
        wrapper.style.transition = 'transform 0.35s cubic-bezier(0.34,1.56,0.64,1)';
        wrapper.style.transform = '';
        if (swipeTriggered) {
            const text = getLastMsgText(msg);
            setReply(msg._id, msg.sender, text, msg.type || 'text');
        }
        setTimeout(() => { wrapper.style.transition = ''; }, 350);
    });
}

function showSwipeReplyIndicator(wrapper, msg) {
    const indicator = document.createElement('div');
    indicator.className = 'swipe-reply-indicator';
    indicator.innerHTML = '<i class="fa-solid fa-reply"></i>';
    wrapper.appendChild(indicator);
    setTimeout(() => indicator.remove(), 600);
}

function renderMessage(msg, isPending = false) {
    if (document.getElementById(`msg_${msg._id}`)) return;
    const container = document.getElementById('messagesContainer');
    const el = createMessageElement(msg, isPending);
    if (el) {
        container.appendChild(el);
        if (isMultiSelectMode && msg.type !== 'system') addCheckboxToWrapper(el);
        scheduleDisappear(msg);
    }
}

// Паёми нопадидшаванда — хазфи худкор аз DOM баъди мӫҳлат
function scheduleDisappear(msg) {
    if (!msg.expiresAt) return;
    const msUntilExpiry = new Date(msg.expiresAt).getTime() - Date.now();
    if (msUntilExpiry <= 0) {
        const el = document.getElementById(`msg_${msg._id}`);
        if (el) el.remove();
        return;
    }
    if (msUntilExpiry > 2147000000) return; // setTimeout-и MAX (бештар аз 24 рӯз — нодида гир, TTL-и сервер кифоят мекунад)
    setTimeout(() => {
        const el = document.getElementById(`msg_${msg._id}`);
        if (el) el.remove();
    }, msUntilExpiry);
}

function renderVoiceHTML(msg, replyHTML = '', senderNameHTML = '') {
    const dur = msg.duration && msg.duration > 0 ? formatDuration(msg.duration) : '0:00';
    const heights = [5,9,14,7,12,10,6,16,9,12,5,10,14,7,9,11,6,14,8,12];
    const waves = heights.map(h => `<span style="height:${h}px"></span>`).join('');
    return `
        <div class="message-bubble voice-bubble">
            ${senderNameHTML}
            ${replyHTML ? `<div class="voice-reply-wrap">${replyHTML}</div>` : ''}
            <div class="voice-message">
                <button class="voice-play-btn" id="playBtn_${msg._id}"
                    onclick="toggleAudio(event, '${msg._id}', '${msg.voiceUrl}', ${msg.duration || 0})">
                    <i class="fa-solid fa-play"></i>
                </button>
                <div class="voice-content">
                    <div class="voice-waves" id="waves_${msg._id}">${waves}</div>
                    <div class="voice-progress-wrap">
                        <div class="voice-progress" id="progress_${msg._id}">
                            <div class="voice-progress-bar" id="progressBar_${msg._id}"></div>
                        </div>
                        <span class="voice-duration" id="dur_${msg._id}">${dur}</span>
                    </div>
                </div>
            </div>
        </div>
    `;
}

// ========== AUDIO PLAYER ==========
function stopCurrentAudio() {
    if (currentAudio) {
        currentAudio.pause();
        if (currentAudioMsgId) {
            const icon = document.querySelector(`#playBtn_${currentAudioMsgId} i`);
            const waves = document.getElementById(`waves_${currentAudioMsgId}`);
            const bar = document.getElementById(`progressBar_${currentAudioMsgId}`);
            if (icon) icon.className = 'fa-solid fa-play';
            if (waves) waves.classList.remove('playing');
            if (bar) bar.style.width = '0%';
        }
        currentAudio = null;
        currentAudioMsgId = null;
    }
}

function toggleAudio(event, msgId, voiceUrl, duration) {
    event.stopPropagation();

    const btn = document.getElementById(`playBtn_${msgId}`);
    const icon = btn ? btn.querySelector('i') : null;
    const waves = document.getElementById(`waves_${msgId}`);
    const durEl = document.getElementById(`dur_${msgId}`);
    const bar = document.getElementById(`progressBar_${msgId}`);

    if (currentAudioMsgId === msgId && currentAudio) {
        if (!currentAudio.paused) {
            currentAudio.pause();
            if (icon) icon.className = 'fa-solid fa-play';
            if (waves) waves.classList.remove('playing');
        } else {
            currentAudio.play().catch(() => {});
            if (icon) icon.className = 'fa-solid fa-pause';
            if (waves) waves.classList.add('playing');
        }
        return;
    }

    stopCurrentAudio();

    let audio = audioInstances.get(msgId);
    if (!audio) {
        audio = new Audio(voiceUrl);
        audioInstances.set(msgId, audio);

        audio.onloadedmetadata = () => {
            if (durEl && audio.duration && isFinite(audio.duration)) {
                durEl.textContent = formatDuration(Math.round(audio.duration));
            }
        };

        audio.ontimeupdate = () => {
            if (currentAudioMsgId !== msgId) return;
            if (audio.duration && isFinite(audio.duration)) {
                const pct = (audio.currentTime / audio.duration) * 100;
                if (bar) bar.style.width = pct + '%';
                const remaining = audio.duration - audio.currentTime;
                if (durEl) durEl.textContent = formatDuration(Math.round(remaining));
            }
        };

        audio.onended = () => {
            if (icon) icon.className = 'fa-solid fa-play';
            if (waves) waves.classList.remove('playing');
            if (bar) bar.style.width = '0%';
            if (durEl) durEl.textContent = formatDuration(duration || 0);
            currentAudio = null;
            currentAudioMsgId = null;
        };

        audio.onerror = () => {
            if (icon) icon.className = 'fa-solid fa-play';
            if (waves) waves.classList.remove('playing');
            showToast('Голосовой паём бор карда нашуд!');
            currentAudio = null;
            currentAudioMsgId = null;
            audioInstances.delete(msgId);
        };
    }

    // Progress drag
    const progressEl = document.getElementById(`progress_${msgId}`);
    if (progressEl && !progressEl._hasListener) {
        progressEl._hasListener = true;

        let dragging = false;

        const seek = (clientX) => {
            if (!audio.duration) return;
            const rect = progressEl.getBoundingClientRect();
            const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
            audio.currentTime = pct * audio.duration;
        };

        progressEl.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            dragging = true;
            seek(e.clientX);
        });

        document.addEventListener('mousemove', (e) => {
            if (dragging) seek(e.clientX);
        });

        document.addEventListener('mouseup', () => { dragging = false; });

        progressEl.addEventListener('touchstart', (e) => {
            e.stopPropagation();
            seek(e.touches[0].clientX);
        }, { passive: true });

        progressEl.addEventListener('touchmove', (e) => {
            e.stopPropagation();
            seek(e.touches[0].clientX);
        }, { passive: true });
    }

    currentAudio = audio;
    currentAudioMsgId = msgId;
    if (icon) icon.className = 'fa-solid fa-pause';
    if (waves) waves.classList.add('playing');

    audio.play().catch(() => {
        if (icon) icon.className = 'fa-solid fa-play';
        if (waves) waves.classList.remove('playing');
        currentAudio = null;
        currentAudioMsgId = null;
    });
}

function scrollToMsg(msgId) {
    const el = document.getElementById(`msg_${msgId}`);
    if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => {
            const bubble = el.querySelector('.message-bubble');
            if (bubble) {
                bubble.classList.add('highlight-anim');
                setTimeout(() => bubble.classList.remove('highlight-anim'), 1200);
            }
        }, 450);
    }
}

function formatDuration(seconds) {
    if (!seconds || !isFinite(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

// Логикаи смайликҳои калон — санҷидани он ки матн танҳо аз 1-4 эмодзи иборат аст
const EMOJI_REGEX = /^(?:\p{Extended_Pictographic}(?:\u200d\p{Extended_Pictographic})*\ufe0f?)+$/u;
function detectBigEmoji(text) {
    if (!text || !text.trim()) return null;
    const trimmed = text.trim();
    if (trimmed !== text) return null; // фосила дар канор — мисли матн муносибат кун
    if (!EMOJI_REGEX.test(trimmed)) return null;
    // Шумурдани эмодзиҳо (бо назардошти ZWJ-пайвастагӣ ҳамчун як аломат)
    const segments = [...trimmed.matchAll(/\p{Extended_Pictographic}(?:\u200d\p{Extended_Pictographic})*\ufe0f?/gu)];
    const count = segments.length;
    if (count < 1 || count > 4) return null;
    return { count };
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(text));
    return div.innerHTML;
}

function escapeAttr(text) {
    if (!text) return '';
    return text.replace(/'/g, '&#39;').replace(/"/g, '&quot;');
}

// №16 — паёми дарозро кушодан
function expandMsg(btn, e) {
    e.stopPropagation();
    const bubble = btn.closest('.message-bubble');
    if (!bubble) return;
    bubble.querySelector('.msg-short').style.display = 'none';
    bubble.querySelector('.msg-full').style.display = 'inline';
    btn.remove();
}

// ========== REPLY ==========
function setReply(msgId, sender, text, type) {
    replyTo = { _id: msgId, sender, body: text, type };
    const box = document.getElementById('replyBox');
    box.classList.remove('hidden');
    document.getElementById('replyName').textContent = sender;
    document.getElementById('replyText').textContent = type === 'voice' ? '🎤 Голосовой паём' : text;
    document.getElementById('messageInput').focus();
}

function cancelReply() {
    replyTo = null;
    const box = document.getElementById('replyBox');
    if (box) box.classList.add('hidden');
}

// ========== TYPING ==========
function handleTyping() {
    autoResize(document.getElementById('messageInput'));
    if (currentGroupId) {
        if (!isTypingSent) {
            isTypingSent = true;
            socket.emit('groupTyping', { sender: myUsername, groupId: currentGroupId });
        }
        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => {
            isTypingSent = false;
            socket.emit('groupStopTyping', { sender: myUsername, groupId: currentGroupId });
        }, 3000);
        return;
    }
    if (!currentChat) return;
    if (!isTypingSent) {
        isTypingSent = true;
        socket.emit('typing', { sender: myUsername, receiver: currentChat });
    }
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        isTypingSent = false;
        socket.emit('stopTyping', { sender: myUsername, receiver: currentChat });
    }, 3000);
}

function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
}

function autoResize(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

// ========== SEND MESSAGE — навбат бо тартиб ==========
async function sendMessage() {
    const input = document.getElementById('messageInput');
    const body = input.value.trim();
    if (!body) return;
    if (!currentChat && !currentGroupId) return;
    input.value = '';
    input.style.height = 'auto';

    if (currentGroupId) return sendGroupMessage(body);

    clearTimeout(typingTimeout);
    isTypingSent = false;
    socket.emit('stopTyping', { sender: myUsername, receiver: currentChat });

    const tempId = 'temp_' + Date.now();
    const currentReply = replyTo ? { ...replyTo } : null;
    const receiver = currentChat;
    cancelReply();

    const tempMsg = {
        _id: tempId,
        sender: myUsername,
        receiver,
        type: 'text',
        body,
        replyTo: currentReply,
        timestamp: new Date(),
        reactionBySender: '',
        reactionByReceiver: '',
        seen: false
    };

    renderMessage(tempMsg, true);
    const container = document.getElementById('messagesContainer');
    container.scrollTop = container.scrollHeight;
    updateLastMsg(receiver, body, false, tempMsg.timestamp);

    // Навбатга илова кун
    sendQueue.push({
        tempId,
        receiver,
        tempMsg,
        execute: async () => {
            const res = await fetch('/api/messages/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                body: JSON.stringify({ receiver, body, replyToId: currentReply ? currentReply._id : null })
            });
            if (!res.ok) throw new Error('Server error');
            const msg = await res.json();
            const tempEl = document.getElementById(`msg_${tempId}`);
            if (tempEl) tempEl.remove();
            if (currentChat === receiver) {
                renderMessage(msg);
                sentSound.play().catch(e => {});
                container.scrollTop = container.scrollHeight;
            }
            socket.emit('sendMessage', { ...msg, receiver, sender: myUsername });
        }
    });

    processQueue();
}

// ========== VOICE — бо тартиб ==========
function toggleRecording() {
    if (!isRecording) {
        startRecording();
    } else {
        stopRecording();
    }
}

// Voice тугмача
function handleVoiceBtnClick() {
    if (isRecording) {
        stopRecording();
    } else {
        startRecording();
    }
}

async function startRecording() {
    recordingCancelled = false;
    audioChunks = [];
    recordingSeconds = 0;
    isRecording = true;

    // №8 — гиранда огоҳ кун + keepalive
    if (currentGroupId) {
        socket.emit('groupMediaUploading', { sender: myUsername, groupId: currentGroupId, isVideo: false });
    } else if (currentChat) {
        socket.emit('voiceRecording', { sender: myUsername, receiver: currentChat });
        clearInterval(voiceKeepAliveInterval);
        voiceKeepAliveInterval = setInterval(() => {
            if (isRecording && currentChat) {
                socket.emit('voiceRecording', { sender: myUsername, receiver: currentChat });
            } else {
                clearInterval(voiceKeepAliveInterval);
            }
        }, 20000);
    }

    // Input панелро пинҳон кун
    document.getElementById('inputNormal').classList.add('hidden');
    document.getElementById('recordingIndicator').classList.remove('hidden');

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

        let mimeType = 'audio/webm;codecs=opus';
        if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = 'audio/webm';
        if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = 'audio/ogg;codecs=opus';
        if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = '';

        const options = mimeType ? {
            mimeType: mimeType,
            audioBitsPerSecond: 16000
        } : {
            audioBitsPerSecond: 16000
        };

        mediaRecorder = new MediaRecorder(stream, options);

        mediaRecorder.ondataavailable = e => {
            if (e.data && e.data.size > 0) audioChunks.push(e.data);
        };

        mediaRecorder.onstop = async () => {
            stream.getTracks().forEach(track => track.stop());
            clearInterval(recordingTimer);
            clearInterval(voiceKeepAliveInterval);
            isRecording = false;
            if (currentChat) socket.emit('stopVoiceRecording', { sender: myUsername, receiver: currentChat });

            document.getElementById('inputNormal').classList.remove('hidden');
            document.getElementById('recordingIndicator').classList.add('hidden');

            const finalSeconds = recordingSeconds;
            if (recordingCancelled) { audioChunks = []; return; }
            if (audioChunks.length === 0) { showToast('Овоз сабт нашуд!'); return; }

            const actualMime = mediaRecorder.mimeType || 'audio/webm';
            const blob = new Blob(audioChunks, { type: actualMime });
            await queueVoiceMessage(blob, finalSeconds);
        };

        mediaRecorder.start(250);
        document.getElementById('recordingTime').textContent = '0:00';
        recordingTimer = setInterval(() => {
            recordingSeconds++;
            document.getElementById('recordingTime').textContent = formatDuration(recordingSeconds);
        }, 1000);
    } catch (err) {
        isRecording = false;
        document.getElementById('inputNormal').classList.remove('hidden');
        document.getElementById('recordingIndicator').classList.add('hidden');
        showToast('Микрофон дастрас нест!');
    }
}

function stopRecording() {
    if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop();
}

function cancelRecording() {
    recordingCancelled = true;
    clearInterval(recordingTimer);
    clearInterval(voiceKeepAliveInterval);
    isRecording = false;
    if (currentChat) socket.emit('stopVoiceRecording', { sender: myUsername, receiver: currentChat });
    if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop();
    document.getElementById('inputNormal').classList.remove('hidden');
    document.getElementById('recordingIndicator').classList.add('hidden');
    audioChunks = [];
}

async function queueVoiceMessage(blob, duration) {
    if (currentGroupId) return queueGroupVoiceMessage(blob, duration);

    const tempId = 'temp_voice_' + Date.now();
    const receiver = currentChat;
    const currentReply = replyTo ? { ...replyTo } : null;
    cancelReply();

    const tempMsg = {
        _id: tempId,
        sender: myUsername,
        receiver,
        type: 'voice',
        voiceUrl: URL.createObjectURL(blob),
        duration,
        replyTo: currentReply,
        timestamp: new Date(),
        reactionBySender: '',
        reactionByReceiver: '',
        seen: false
    };

    renderMessage(tempMsg, true);
    const container = document.getElementById('messagesContainer');
    container.scrollTop = container.scrollHeight;
    updateLastMsg(receiver, '🎤 Голосовой паём', false, tempMsg.timestamp);

    sendQueue.push({
        tempId,
        receiver,
        tempMsg,
        execute: async () => {
            const formData = new FormData();
            formData.append('audio', blob, 'voice.webm');
            formData.append('receiver', receiver);
            formData.append('duration', duration);
            if (currentReply) formData.append('replyToId', currentReply._id);

            const res = await fetch('/api/messages/voice', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + token },
                body: formData
            });
            if (!res.ok) throw new Error('Server error');
            const msg = await res.json();

            const tempEl = document.getElementById(`msg_${tempId}`);
            if (tempEl) tempEl.remove();
            audioInstances.delete(tempId);

            if (currentChat === receiver) {
                renderMessage(msg);
                container.scrollTop = container.scrollHeight;
            }
            socket.emit('sendMessage', { ...msg, receiver, sender: myUsername });
        }
    });

    processQueue();
}

// ========== REACTION (шахсӣ) ==========
async function setReaction(emoji) {
    if (!selectedMessageId) return;
    if (currentGroupId) return setGroupReactionInline(selectedMessageId, emoji);
    const wrapper = document.getElementById(`msg_${selectedMessageId}`);
    const isSent = wrapper && wrapper.classList.contains('sent');
    const side = isSent ? 'sender' : 'receiver';

    try {
        const res = await fetch(`/api/messages/reaction/${selectedMessageId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ reaction: emoji, side })
        });
        const updatedMsg = await res.json();
        updateReactionInUI(updatedMsg);
        socket.emit('reaction', {
            _id: selectedMessageId, reaction: emoji, side,
            sender: myUsername, receiver: currentChat,
            reactionBySender: updatedMsg.reactionBySender,
            reactionByReceiver: updatedMsg.reactionByReceiver,
            msgSender: updatedMsg.sender, msgReceiver: updatedMsg.receiver
        });
    } catch (err) {
        console.log('Хатогӣ:', err);
    }
}

// №14 — Реаксия инфо панел (Instagram style) — шахсӣ
function showReactionPanel(rSender, rReceiver, sender, receiver, msgId, isSent, event) {
    event.stopPropagation();
    const overlay = document.getElementById('reactionPanelOverlay');
    const content = document.getElementById('reactionPanelContent');
    if (!overlay || !content) return;

    let html = '<div class="reaction-panel-list">';
    if (rSender) {
        const isMe = sender === myUsername;
        html += `<div class="reaction-panel-item">
            <span class="rp-emoji">${rSender}</span>
            <span class="rp-name">${escapeHtml(sender)}</span>
            ${isMe ? `<button class="rp-remove-btn" onclick="removeMyReaction('${msgId}','sender');hideReactionPanel()">Хориҷ</button>` : ''}
        </div>`;
    }
    if (rReceiver) {
        const isMe = receiver === myUsername;
        html += `<div class="reaction-panel-item">
            <span class="rp-emoji">${rReceiver}</span>
            <span class="rp-name">${escapeHtml(receiver)}</span>
            ${isMe ? `<button class="rp-remove-btn" onclick="removeMyReaction('${msgId}','receiver');hideReactionPanel()">Хориҷ</button>` : ''}
        </div>`;
    }
    html += '</div>';
    content.innerHTML = html;
    overlay.classList.remove('hidden');
    setTimeout(() => overlay.querySelector('.reaction-panel')?.classList.add('visible'), 10);
}

function hideReactionPanel() {
    const overlay = document.getElementById('reactionPanelOverlay');
    const panel = overlay?.querySelector('.reaction-panel');
    if (panel) panel.classList.remove('visible');
    setTimeout(() => overlay?.classList.add('hidden'), 250);
}

async function removeMyReaction(msgId, side) {
    const wrapper = document.getElementById(`msg_${msgId}`);
    if (!wrapper) return;
    const isSent = wrapper.classList.contains('sent');
    const actualSide = isSent ? 'sender' : 'receiver';
    try {
        const res = await fetch(`/api/messages/reaction/${msgId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ reaction: '', side: actualSide })
        });
        const updatedMsg = await res.json();
        updateReactionInUI(updatedMsg);
        socket.emit('reaction', {
            _id: msgId, reaction: '', side: actualSide,
            sender: myUsername, receiver: currentChat,
            reactionBySender: updatedMsg.reactionBySender,
            reactionByReceiver: updatedMsg.reactionByReceiver,
            msgSender: updatedMsg.sender, msgReceiver: updatedMsg.receiver
        });
    } catch(e) {}
}

function showReactionInfo(rSender, rReceiver, sender, receiver, event) {
    event.stopPropagation();
    const wrapper = event.target.closest('.message-wrapper');
    if (!wrapper) return;
    const msgId = wrapper.id?.replace('msg_', '');
    const isSent = wrapper.classList.contains('sent');
    showReactionPanel(rSender, rReceiver, sender, receiver, msgId, isSent, event);
}

function updateReactionInUI(msg) {
    const wrapper = document.getElementById(`msg_${msg._id}`);
    if (!wrapper) return;
    const actionsDiv = wrapper.querySelector('.msg-actions');
    if (!actionsDiv) return;

    let reactionsRow = actionsDiv.querySelector('.reactions-row');
    const rSender = msg.reactionBySender || '';
    const rReceiver = msg.reactionByReceiver || '';

    if (!rSender && !rReceiver) {
        if (reactionsRow) reactionsRow.remove();
        return;
    }

    let html = `<div class="reactions-row" onclick="showReactionInfo('${escapeAttr(rSender)}','${escapeAttr(rReceiver)}','${escapeAttr(msg.sender)}','${escapeAttr(msg.receiver)}', event)">`;
    if (rSender) html += `<span class="reaction-badge reaction-bounce">${rSender}</span>`;
    if (rReceiver) html += `<span class="reaction-badge reaction-bounce">${rReceiver}</span>`;
    html += `</div>`;

    if (reactionsRow) {
        reactionsRow.outerHTML = html;
    } else {
        actionsDiv.insertAdjacentHTML('afterbegin', html);
    }

    const newRow = actionsDiv.querySelector('.reactions-row');
    if (newRow) {
        newRow.querySelectorAll('.reaction-bounce').forEach(el => {
            setTimeout(() => el.classList.remove('reaction-bounce'), 500);
        });
    }
}

// ========== REACTION (гурӯҳ) ==========
function updateGroupReactionInUI(msgId, groupReactions) {
    const wrapper = document.getElementById(`msg_${msgId}`);
    if (!wrapper) return;
    const actionsDiv = wrapper.querySelector('.msg-actions');
    if (!actionsDiv) return;
    let reactionsRow = actionsDiv.querySelector('.reactions-row');
    const entries = Object.entries(groupReactions || {});

    if (entries.length === 0) {
        if (reactionsRow) reactionsRow.remove();
        return;
    }

    let html = `<div class="reactions-row" onclick="showGroupReactionInfo('${msgId}', event)">`;
    const emojis = [...new Set(entries.map(([, e]) => e))];
    emojis.slice(0, 6).forEach(e => { html += `<span class="reaction-badge reaction-bounce">${e}</span>`; });
    html += `<span class="reaction-badge" style="font-size:10px;color:var(--text3)">${entries.length}</span>`;
    html += `</div>`;

    if (reactionsRow) reactionsRow.outerHTML = html;
    else actionsDiv.insertAdjacentHTML('afterbegin', html);

    const newRow = actionsDiv.querySelector('.reactions-row');
    if (newRow) {
        newRow.querySelectorAll('.reaction-bounce').forEach(el => setTimeout(() => el.classList.remove('reaction-bounce'), 500));
    }
}

function showGroupReactionInfo(msgId, event) {
    event.stopPropagation();
    // Маълумоти реаксияро аз кэши паёми ҷорӣ гирифтан мумкин нест мустақим — пас аз сервер мегирем
    fetch(`/api/groups/${currentGroupId}/messages`, { headers: { 'Authorization': 'Bearer ' + token } })
        .then(() => {}).catch(() => {});
    const overlay = document.getElementById('reactionPanelOverlay');
    const content = document.getElementById('reactionPanelContent');
    if (!overlay || !content) return;
    // Истифодаи маълумоти дар DOM мавҷуд буда кофист — оддӣ нишон медиҳем номхо аз groupReactions кэши локалӣ
    const wrapper = document.getElementById(`msg_${msgId}`);
    overlay.classList.remove('hidden');
    setTimeout(() => overlay.querySelector('.reaction-panel')?.classList.add('visible'), 10);
    content.innerHTML = '<div class="reaction-panel-list"><div class="reaction-panel-item"><span class="rp-name">Реаксияҳо дар чати гурӯҳ</span></div></div>';
}

// ========== DELETE (шахсӣ) ==========
async function deleteMessage(msgId, msgSender, msgReceiver) {
    const isSender = msgSender === myUsername;
    let deleteFor = 'me';

    if (isSender) {
        deleteFor = await showDeleteDialog();
        if (!deleteFor) return;
    } else {
        const confirmed = await showDialog('Паём танҳо аз чати шумо ҳазф мешавад. Идома диҳем?');
        if (!confirmed) return;
    }

    if (currentAudioMsgId === msgId) stopCurrentAudio();
    audioInstances.delete(msgId);

    try {
        const res = await fetch(`/api/messages/${msgId}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ deleteFor })
        });
        const data = await res.json();
        const wrapper = document.getElementById(`msg_${msgId}`);
        if (wrapper) wrapper.remove();
        socket.emit('deleteMessage', {
            _id: msgId, sender: msgSender, receiver: msgReceiver,
            deletedBy: myUsername, deletedFor: data.deletedFor
        });
    } catch (err) {
        showToast('Ҳазф карда нашуд!');
    }
}

// ===================================================================
// ========================= ГУРӴ (GROUPS) ==========================
// ===================================================================

async function loadGroups() {
    try {
        const res = await fetch('/api/groups', { headers: { 'Authorization': 'Bearer ' + token } });
        const data = await res.json();
        if (Array.isArray(data)) {
            allGroups = data;
            data.forEach(g => { groupsById[g._id] = g; });
            renderUsers(allUsers);
        }
    } catch (err) { console.log('Хатогии гурӯҳ:', err); }
}

// ========== NEW GROUP MODAL ==========
function showNewGroupModal() {
    newGroupSelectedMembers = new Set();
    document.getElementById('newGroupName').value = '';
    document.getElementById('newGroupError').textContent = '';
    const list = document.getElementById('newGroupMemberList');
    list.innerHTML = '';
    allUsers.forEach(user => {
        const avatarUrl = userAvatars[user.username] || '';
        const avatarHtml = avatarUrl
            ? `<img src="${avatarUrl}" style="width:32px;height:32px;border-radius:50%;object-fit:cover;"/>`
            : `<div style="width:32px;height:32px;border-radius:50%;background:var(--accent);display:flex;align-items:center;justify-content:center;font-weight:700;color:#000;font-size:13px;">${user.username[0].toUpperCase()}</div>`;
        const label = document.createElement('label');
        label.className = 'user-picker-item';
        label.innerHTML = `
            ${avatarHtml}
            <span class="upi-name">${escapeHtml(user.username)}</span>
            <input type="checkbox" value="${escapeAttr(user.username)}" onchange="toggleNewGroupMember('${escapeAttr(user.username)}', this.checked)"/>
        `;
        list.appendChild(label);
    });
    document.getElementById('newGroupModal').classList.remove('hidden');
}
function hideNewGroupModal() { document.getElementById('newGroupModal').classList.add('hidden'); }
function toggleNewGroupMember(username, checked) {
    if (checked) newGroupSelectedMembers.add(username);
    else newGroupSelectedMembers.delete(username);
}

async function createGroup() {
    const name = document.getElementById('newGroupName').value.trim();
    const errEl = document.getElementById('newGroupError');
    if (!name || name.length < 2) { errEl.textContent = 'Номи гурӯҳ камаш 2 ҳарф бошад!'; return; }
    if (newGroupSelectedMembers.size === 0) { errEl.textContent = 'Камаш як аъзо интихоб кунед!'; return; }
    try {
        const res = await fetch('/api/groups', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ name, members: Array.from(newGroupSelectedMembers) })
        });
        const data = await res.json();
        if (!res.ok) { errEl.textContent = data.message || 'Хатогӣ!'; return; }
        allGroups.unshift(data);
        groupsById[data._id] = data;
        hideNewGroupModal();
        renderUsers(allUsers);
        socket.emit('groupCreated', { groupId: data._id });
        showToast('✅ Гурӯҳ сохта шуд!');
        openGroupChat(data._id);
    } catch (err) {
        errEl.textContent = 'Хатогӣ баромад!';
    }
}

// ========== OPEN GROUP CHAT ==========
async function openGroupChat(groupId) {
    if (currentGroupId === groupId) {
        document.getElementById('chatArea').classList.add('open');
        return;
    }

    currentChat = null;

    const container = document.getElementById('messagesContainer');
    container.innerHTML = '';
    container.onscroll = null;

    if (unreadGroupMessages[groupId]) delete unreadGroupMessages[groupId];

    currentGroupId = groupId;
    hasMoreMessages = true;
    oldestTimestamp = null;
    stopCurrentAudio();

    let group = groupsById[groupId];
    if (!group) {
        try {
            const res = await fetch(`/api/groups/${groupId}`, { headers: { 'Authorization': 'Bearer ' + token } });
            if (!res.ok) { showToast('Гурӯҳ ёфт нашуд!'); goBack(); return; }
            group = await res.json();
            groupsById[groupId] = group;
            if (!allGroups.find(g => g._id === groupId)) allGroups.unshift(group);
        } catch (e) { goBack(); return; }
    }

    document.getElementById('chatDefault').classList.add('hidden');
    document.getElementById('chatScreen').classList.remove('hidden');
    document.getElementById('chatUsername').textContent = group.name;

    const chatAvEl = document.getElementById('chatAvatar');
    chatAvEl.classList.add('group-avatar-icon');
    if (group.avatar) {
        chatAvEl.innerHTML = `<img src="${group.avatar}" alt="${escapeHtml(group.name)}"/>`;
    } else {
        chatAvEl.innerHTML = '<i class="fa-solid fa-users"></i>';
    }

    document.getElementById('chatArea').classList.add('open');
    document.getElementById('typingBubbleIndicator')?.classList.remove('visible');
    updateGroupTypingBar(groupId);

    loadPinnedMessage();
    updateMuteButtonText();
    updatePinChatButtonText();
    cancelReply();
    renderUsers(allUsers);

    await loadGroupMessages();

    container.onscroll = () => {
        if (container.scrollTop < 80 && !isLoadingMore && hasMoreMessages) {
            loadMoreGroupMessages();
        }
    };
}

function buildMemberSummary(members) {
    if (!members || members.length === 0) return '';
    const others = members.filter(m => m !== myUsername);
    const display = others.length === members.length ? members : ['Шумо', ...others];
    if (display.length <= 3) return display.join(', ');
    const shown = display.slice(0, 2);
    const remaining = display.length - 2;
    return `${shown.join(', ')} ва ${remaining} дигар`;
}

function updateGroupTypingBar(groupId) {
    const statusEl = document.getElementById('chatStatus');
    const typingSet = groupTypingUsers[groupId];
    if (!statusEl) return;
    if (typingSet && typingSet.size > 0) {
        const names = Array.from(typingSet).slice(0, 3).join(', ');
        statusEl.style.display = '';
        statusEl.textContent = `${names} нависонда истодааст...`;
        statusEl.className = 'chat-status typing';
    } else {
        const group = groupsById[groupId];
        statusEl.style.display = '';
        statusEl.textContent = group ? buildMemberSummary(group.members) : '';
        statusEl.className = 'chat-status';
    }
    const bubble = document.getElementById('typingBubbleIndicator');
    if (bubble) {
        if (typingSet && typingSet.size > 0 && currentGroupId === groupId) {
            bubble.classList.add('visible');
            bubble.innerHTML = '<div class="typing-bubble"><span></span><span></span><span></span></div>';
            const c = document.getElementById('messagesContainer');
            if (c) c.scrollTop = c.scrollHeight;
        } else {
            bubble.classList.remove('visible');
        }
    }
}

async function loadGroupMessages() {
    const container = document.getElementById('messagesContainer');
    container.innerHTML = '';

    const cached = getCachedGroupMessages(currentGroupId);
    if (cached && cached.length > 0) {
        cached.forEach(msg => renderMessage(msg));
        container.scrollTop = container.scrollHeight;
    }

    renderPendingForGroup(currentGroupId);

    try {
        const res = await fetch(`/api/groups/${currentGroupId}/messages`, {
            headers: { 'Authorization': 'Bearer ' + token }
        });
        if (!res.ok) { hasMoreMessages = false; return; }
        const messages = await res.json();

        container.innerHTML = '';
        if (messages.length < 30) hasMoreMessages = false;
        if (messages.length > 0) oldestTimestamp = messages[0].timestamp;
        messages.forEach(msg => renderMessage(msg));
        container.scrollTop = container.scrollHeight;

        renderPendingForGroup(currentGroupId);
        cacheGroupMessages(currentGroupId, messages);

        // Seen — ҳамаи паёмҳои дигарон
        messages.forEach(msg => {
            if (msg.sender !== myUsername && msg.type !== 'system' && !(msg.seenBy || []).includes(myUsername)) {
                markGroupSeen(msg._id);
            }
        });
    } catch (err) {
        hasMoreMessages = false;
        if (!cached || cached.length === 0) {
            container.innerHTML = '';
            renderPendingForGroup(currentGroupId);
            container.innerHTML += '<div style="text-align:center;color:var(--text3);padding:20px;font-size:13px;">Интернет нест. Паёмҳо дастрас нестанд.</div>';
        }
    }
}

async function loadMoreGroupMessages() {
    if (!hasMoreMessages || !oldestTimestamp || !currentGroupId) return;
    isLoadingMore = true;
    const container = document.getElementById('messagesContainer');
    const prevScrollHeight = container.scrollHeight;
    const prevScrollTop = container.scrollTop;
    try {
        const res = await fetch(`/api/groups/${currentGroupId}/messages?before=${oldestTimestamp}`, {
            headers: { 'Authorization': 'Bearer ' + token }
        });
        const messages = await res.json();
        if (messages.length === 0) { hasMoreMessages = false; isLoadingMore = false; return; }
        if (messages.length < 30) hasMoreMessages = false;
        oldestTimestamp = messages[0].timestamp;
        const fragment = document.createDocumentFragment();
        messages.forEach(msg => {
            if (!document.getElementById(`msg_${msg._id}`)) {
                const el = createMessageElement(msg);
                if (el) fragment.appendChild(el);
            }
        });
        container.insertBefore(fragment, container.firstChild);
        container.scrollTop = prevScrollTop + (container.scrollHeight - prevScrollHeight);
        appendToGroupCache(currentGroupId, messages);
    } catch (err) { console.log('Хатогӣ:', err); }
    isLoadingMore = false;
}

async function markGroupSeen(msgId) {
    try {
        await fetch(`/api/groups/${currentGroupId}/seen/${msgId}`, {
            method: 'PUT', headers: { 'Authorization': 'Bearer ' + token }
        });
        socket.emit('groupSeen', { groupId: currentGroupId, msgId, username: myUsername });
        const cached = getCachedGroupMessages(currentGroupId);
        if (cached) {
            const msg = cached.find(m => m._id === msgId);
            if (msg) { msg.seenBy = [...(msg.seenBy || []), myUsername]; cacheGroupMessages(currentGroupId, cached); }
        }
    } catch (err) {}
}

// ========== SEND GROUP MESSAGE ==========
async function sendGroupMessage(body) {
    const tempId = 'temp_g_' + Date.now();
    const groupId = currentGroupId;
    const currentReply = replyTo ? { ...replyTo } : null;
    cancelReply();

    const tempMsg = {
        _id: tempId,
        sender: myUsername,
        groupId,
        type: 'text',
        body,
        replyTo: currentReply,
        timestamp: new Date(),
        groupReactions: {},
        seenBy: [myUsername]
    };

    renderMessage(tempMsg, true);
    const container = document.getElementById('messagesContainer');
    container.scrollTop = container.scrollHeight;
    updateGroupLastMsg(groupId, body, tempMsg.timestamp);

    sendQueue.push({
        tempId, groupId, tempMsg,
        execute: async () => {
            const res = await fetch(`/api/groups/${groupId}/messages`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                body: JSON.stringify({ body, replyToId: currentReply ? currentReply._id : null })
            });
            if (!res.ok) throw new Error('Server error');
            const msg = await res.json();
            const tempEl = document.getElementById(`msg_${tempId}`);
            if (tempEl) tempEl.remove();
            if (currentGroupId === groupId) {
                renderMessage(msg);
                sentSound.play().catch(e => {});
                container.scrollTop = container.scrollHeight;
            }
            socket.emit('sendGroupMessage', { ...msg, groupId, sender: myUsername });
        }
    });

    processQueue();
}

async function sendSingleGroupMedia(file, caption = '') {
    const isVideo = file.type.startsWith('video/');
    const tempId = 'temp_gmedia_' + Date.now() + '_' + Math.random();
    const groupId = currentGroupId;
    const objectUrl = URL.createObjectURL(file);
    const tempMsg = {
        _id: tempId, sender: myUsername, groupId,
        type: isVideo ? 'video' : 'image', mediaUrl: objectUrl, caption,
        timestamp: new Date(), groupReactions: {}, seenBy: [myUsername]
    };
    renderMessage(tempMsg, true);
    const container = document.getElementById('messagesContainer');
    container.scrollTop = container.scrollHeight;
    updateGroupLastMsg(groupId, isVideo ? '🎥 Видео' : '🖼 Сурат', tempMsg.timestamp);

    socket.emit('groupMediaUploading', { sender: myUsername, groupId, isVideo });

    const formData = new FormData();
    formData.append('media', file);
    if (caption) formData.append('caption', caption);
    if (replyTo) formData.append('replyToId', replyTo._id);
    cancelReply();

    sendQueue.push({
        tempId, groupId, tempMsg,
        execute: async () => {
            const msg = await uploadMediaWithProgress(formData, tempId, groupId);
            const tempEl = document.getElementById(`msg_${tempId}`);
            if (tempEl) tempEl.remove();
            const c = document.getElementById('messagesContainer');
            if (currentGroupId === groupId && c) {
                renderMessage(msg);
                c.scrollTop = c.scrollHeight;
            }
            socket.emit('sendGroupMessage', { ...msg, groupId, sender: myUsername });
            URL.revokeObjectURL(objectUrl);
        }
    });
    processQueue();
}

async function queueGroupVoiceMessage(blob, duration) {
    const tempId = 'temp_gvoice_' + Date.now();
    const groupId = currentGroupId;
    const currentReply = replyTo ? { ...replyTo } : null;
    cancelReply();

    const tempMsg = {
        _id: tempId, sender: myUsername, groupId, type: 'voice',
        voiceUrl: URL.createObjectURL(blob), duration, replyTo: currentReply,
        timestamp: new Date(), groupReactions: {}, seenBy: [myUsername]
    };

    renderMessage(tempMsg, true);
    const container = document.getElementById('messagesContainer');
    container.scrollTop = container.scrollHeight;
    updateGroupLastMsg(groupId, '🎤 Голосовой паём', tempMsg.timestamp);

    sendQueue.push({
        tempId, groupId, tempMsg,
        execute: async () => {
            const formData = new FormData();
            formData.append('audio', blob, 'voice.webm');
            formData.append('duration', duration);
            if (currentReply) formData.append('replyToId', currentReply._id);

            const res = await fetch(`/api/groups/${groupId}/voice`, {
                method: 'POST', headers: { 'Authorization': 'Bearer ' + token }, body: formData
            });
            if (!res.ok) throw new Error('Server error');
            const msg = await res.json();
            const tempEl = document.getElementById(`msg_${tempId}`);
            if (tempEl) tempEl.remove();
            audioInstances.delete(tempId);
            if (currentGroupId === groupId) {
                renderMessage(msg);
                container.scrollTop = container.scrollHeight;
            }
            socket.emit('sendGroupMessage', { ...msg, groupId, sender: myUsername });
        }
    });
    processQueue();
}

function updateGroupLastMsg(groupId, text, timestamp = Date.now()) {
    lastGroupMessageInfo[groupId] = { text, timestamp: new Date(timestamp).getTime() };
    const el = document.getElementById(`lastMsgGroup_${groupId}`);
    if (el) el.innerHTML = escapeHtml(text);
    renderUsers(allUsers);
}

// ========== GROUP INFO MODAL ==========
function showGroupInfo() {
    const group = groupsById[currentGroupId];
    if (!group) return;
    const modal = document.getElementById('groupInfoModal');
    modal.classList.remove('hidden');

    const avEl = document.getElementById('groupInfoAvatar');
    const isAdminUser = group.isAdmin || group.creator === myUsername;

    avEl.querySelectorAll('img').forEach(i => i.remove());
    if (group.avatar) {
        avEl.style.backgroundImage = `url(${group.avatar})`;
        avEl.style.backgroundSize = 'cover';
        avEl.style.backgroundPosition = 'center';
    } else {
        avEl.style.backgroundImage = '';
        avEl.textContent = '';
        const icon = document.createElement('i');
        icon.className = 'fa-solid fa-users';
        avEl.insertBefore(icon, avEl.firstChild);
    }

    document.getElementById('groupAvatarEditIcon').style.display = isAdminUser ? 'flex' : 'none';
    document.getElementById('groupInfoName').textContent = group.name;
    document.getElementById('groupInfoMemberCount').textContent = `${group.members.length} аъзо`;
    document.getElementById('groupRenameBtn').classList.toggle('hidden', !isAdminUser);
    document.getElementById('addMemberBtn').classList.toggle('hidden', !isAdminUser);
    document.getElementById('deleteGroupBtnWrap').classList.toggle('hidden', group.creator !== myUsername);
    document.getElementById('groupActionRow').classList.toggle('hidden', !isAdminUser);
    document.getElementById('groupDescText').textContent = group.description || (isAdminUser ? 'Тавсиф илова кунед' : 'Тавсиф нест');
    updateMuteButtonText();

    renderGroupMembersList(group);
}
function hideGroupInfo() { document.getElementById('groupInfoModal').classList.add('hidden'); }

function renderGroupMembersList(group) {
    const list = document.getElementById('groupMembersList');
    list.innerHTML = '';
    const isAdminUser = group.isAdmin || group.creator === myUsername;
    group.members.forEach(username => {
        const isMemberAdmin = (group.admins || []).includes(username) || group.creator === username;
        const isCreator = group.creator === username;
        const avatarUrl = userAvatars[username] || '';
        const avatarHtml = avatarUrl ? `<img src="${avatarUrl}" alt="${escapeHtml(username)}"/>` : username[0].toUpperCase();

        const div = document.createElement('div');
        div.className = 'group-member-item';
        div.innerHTML = `
            <div class="gmi-avatar">${avatarHtml}</div>
            <div class="gmi-name">${escapeHtml(username)}${username === myUsername ? ' (шумо)' : ''}</div>
            ${isMemberAdmin ? `<span class="upi-role-badge">${isCreator ? 'Сохтор' : 'Admin'}</span>` : ''}
        `;
        if (isAdminUser && username !== myUsername) {
            div.style.cursor = 'pointer';
            div.onclick = (e) => showMemberActions(e, username, group, isMemberAdmin, isCreator);
        } else if (username !== myUsername) {
            div.style.cursor = 'pointer';
            div.onclick = () => showUserProfile(username);
        }
        list.appendChild(div);
    });
}

function showMemberActions(e, username, group, isMemberAdmin, isCreator) {
    e.stopPropagation();
    const menu = document.getElementById('memberActionsMenu');
    if (!menu) return;
    let html = '';
    if (!isCreator) {
        html += `<button onclick="toggleMemberAdmin('${escapeAttr(username)}', ${!isMemberAdmin}); hideMemberActions()">
            <i class="fa-solid fa-shield-halved"></i> ${isMemberAdmin ? 'Гирифтани admin' : 'Кардан admin'}
        </button>`;
        html += `<button class="danger" onclick="removeMemberFromGroup('${escapeAttr(username)}'); hideMemberActions()">
            <i class="fa-solid fa-user-minus"></i> Хазф аз гурӯҳ
        </button>`;
    }
    html += `<button onclick="showUserProfile('${escapeAttr(username)}'); hideMemberActions()">
        <i class="fa-solid fa-circle-info"></i> Дидани профил
    </button>`;
    menu.innerHTML = html;
    menu.classList.remove('hidden');
    menu.style.top = e.clientY + 'px';
    menu.style.left = Math.min(e.clientX, window.innerWidth - 200) + 'px';
    setTimeout(() => document.addEventListener('click', hideMemberActions, { once: true }), 50);
}
function hideMemberActions() { document.getElementById('memberActionsMenu')?.classList.add('hidden'); }

async function toggleMemberAdmin(username, makeAdmin) {
    try {
        await fetch(`/api/groups/${currentGroupId}/members/${username}/admin`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ makeAdmin })
        });
        const res = await fetch(`/api/groups/${currentGroupId}`, { headers: { 'Authorization': 'Bearer ' + token } });
        const group = await res.json();
        groupsById[currentGroupId] = group;
        renderGroupMembersList(group);
        showToast(makeAdmin ? '✅ Admin шуд' : 'Admin гирифта шуд');
    } catch (e) { showToast('Хатогӣ!'); }
}

async function removeMemberFromGroup(username) {
    const confirmed = await showDialog(`"${username}"-ро аз гурӯҳ хазф кунем?`);
    if (!confirmed) return;
    try {
        await fetch(`/api/groups/${currentGroupId}/members/${username}`, {
            method: 'DELETE', headers: { 'Authorization': 'Bearer ' + token }
        });
        socket.emit('groupMembersChanged', { groupId: currentGroupId, removedMember: username });
        const res = await fetch(`/api/groups/${currentGroupId}`, { headers: { 'Authorization': 'Bearer ' + token } });
        const group = await res.json();
        groupsById[currentGroupId] = group;
        document.getElementById('groupInfoMemberCount').textContent = `${group.members.length} аъзо`;
        renderGroupMembersList(group);
        showToast('✅ Аъзо хазф шуд');
    } catch (e) { showToast('Хатогӣ!'); }
}

// ========== ADD MEMBERS ==========
function showAddMembers() {
    addMembersSelected = new Set();
    const group = groupsById[currentGroupId];
    const list = document.getElementById('addMembersList');
    list.innerHTML = '';
    document.getElementById('addMembersError').textContent = '';
    const candidates = allUsers.filter(u => !group.members.includes(u.username));
    if (candidates.length === 0) {
        list.innerHTML = '<p style="color:var(--text3);font-size:13px;text-align:center;padding:10px">Ҳамаи корбарон аллакай дар гурӯҳ ҳастанд</p>';
    }
    candidates.forEach(user => {
        const avatarUrl = userAvatars[user.username] || '';
        const avatarHtml = avatarUrl
            ? `<img src="${avatarUrl}" style="width:32px;height:32px;border-radius:50%;object-fit:cover;"/>`
            : `<div style="width:32px;height:32px;border-radius:50%;background:var(--accent);display:flex;align-items:center;justify-content:center;font-weight:700;color:#000;font-size:13px;">${user.username[0].toUpperCase()}</div>`;
        const label = document.createElement('label');
        label.className = 'user-picker-item';
        label.innerHTML = `
            ${avatarHtml}
            <span class="upi-name">${escapeHtml(user.username)}</span>
            <input type="checkbox" value="${escapeAttr(user.username)}" onchange="toggleAddMember('${escapeAttr(user.username)}', this.checked)"/>
        `;
        list.appendChild(label);
    });
    document.getElementById('addMembersModal').classList.remove('hidden');
}
function hideAddMembers() { document.getElementById('addMembersModal').classList.add('hidden'); }
function toggleAddMember(username, checked) {
    if (checked) addMembersSelected.add(username);
    else addMembersSelected.delete(username);
}
async function submitAddMembers() {
    const errEl = document.getElementById('addMembersError');
    if (addMembersSelected.size === 0) { errEl.textContent = 'Камаш як корбар интихоб кунед!'; return; }
    try {
        const res = await fetch(`/api/groups/${currentGroupId}/members`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ usernames: Array.from(addMembersSelected) })
        });
        const data = await res.json();
        if (!res.ok) { errEl.textContent = data.message || 'Хатогӣ!'; return; }
        groupsById[currentGroupId] = data;
        const idx = allGroups.findIndex(g => g._id === currentGroupId);
        if (idx >= 0) allGroups[idx] = data;
        hideAddMembers();
        document.getElementById('groupInfoMemberCount').textContent = `${data.members.length} аъзо`;
        renderGroupMembersList(data);
        socket.emit('groupMembersChanged', { groupId: currentGroupId, newMembers: Array.from(addMembersSelected) });
        showToast('✅ Аъзо илова шуд');
    } catch (e) { errEl.textContent = 'Хатогӣ баромад!'; }
}

// ========== RENAME GROUP ==========
function showRenameGroup() {
    const group = groupsById[currentGroupId];
    document.getElementById('renameGroupInput').value = group.name;
    document.getElementById('renameGroupError').textContent = '';
    document.getElementById('renameGroupModal').classList.remove('hidden');
}
function hideRenameGroup() { document.getElementById('renameGroupModal').classList.add('hidden'); }
async function submitRenameGroup() {
    const name = document.getElementById('renameGroupInput').value.trim();
    const errEl = document.getElementById('renameGroupError');
    if (!name || name.length < 2) { errEl.textContent = 'Ном камаш 2 ҳарф бошад!'; return; }
    try {
        const res = await fetch(`/api/groups/${currentGroupId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ name })
        });
        if (!res.ok) { const d = await res.json(); errEl.textContent = d.message || 'Хатогӣ!'; return; }
        groupsById[currentGroupId].name = name;
        document.getElementById('chatUsername').textContent = name;
        document.getElementById('groupInfoName').textContent = name;
        hideRenameGroup();
        socket.emit('groupUpdated', { groupId: currentGroupId });
        showToast('✅ Ном иваз шуд');
        renderUsers(allUsers);
    } catch (e) { errEl.textContent = 'Хатогӣ баромад!'; }
}

async function uploadGroupAvatar(input) {
    if (!input.files || !input.files[0]) return;
    const file = input.files[0];
    const formData = new FormData();
    formData.append('avatar', file);
    try {
        showToast('Бор карда истодааст...');
        const res = await fetch(`/api/groups/${currentGroupId}/avatar`, {
            method: 'POST', headers: { 'Authorization': 'Bearer ' + token }, body: formData
        });
        const data = await res.json();
        if (!res.ok) { showToast(data.message || 'Хатогӣ!'); return; }
        groupsById[currentGroupId].avatar = data.avatar;
        const idx = allGroups.findIndex(g => g._id === currentGroupId);
        if (idx >= 0) allGroups[idx].avatar = data.avatar;
        showGroupInfo();
        const chatAvEl = document.getElementById('chatAvatar');
        chatAvEl.innerHTML = `<img src="${data.avatar}" alt="group"/>`;
        socket.emit('groupUpdated', { groupId: currentGroupId });
        showToast('✅ Аватар бор шуд!');
        renderUsers(allUsers);
    } catch (e) { showToast('Хатогӣ ҳангоми боркунӣ!'); }
    input.value = '';
}

// ========== LEAVE / DELETE GROUP ==========
async function confirmLeaveGroup() {
    const confirmed = await showDialog('Шумо мехоҳед ин гурӯҳро тарк кунед?');
    if (!confirmed) return;
    await leaveGroupNow();
}
function leaveCurrentGroup() { confirmLeaveGroup(); }

async function leaveGroupNow() {
    const groupId = currentGroupId;
    try {
        await fetch(`/api/groups/${groupId}/members/${myUsername}`, {
            method: 'DELETE', headers: { 'Authorization': 'Bearer ' + token }
        });
        socket.emit('groupMembersChanged', { groupId, removedMember: null });
        allGroups = allGroups.filter(g => g._id !== groupId);
        delete groupsById[groupId];
        clearGroupCacheLocal(groupId);
        hideGroupInfo();
        goBack();
        renderUsers(allUsers);
        showToast('Шумо гурӯҳро тарк кардед');
    } catch (e) { showToast('Хатогӣ!'); }
}

async function confirmDeleteGroup() {
    const confirmed = await showDialog('Ин гурӯҳ пурра хазф мешавад. Боварӣ доред?');
    if (!confirmed) return;
    const groupId = currentGroupId;
    try {
        await fetch(`/api/groups/${groupId}`, { method: 'DELETE', headers: { 'Authorization': 'Bearer ' + token } });
        socket.emit('groupMembersChanged', { groupId, removedMember: null });
        allGroups = allGroups.filter(g => g._id !== groupId);
        delete groupsById[groupId];
        clearGroupCacheLocal(groupId);
        hideGroupInfo();
        goBack();
        renderUsers(allUsers);
        showToast('Гурӯҳ хазф шуд');
    } catch (e) { showToast('Хатогӣ!'); }
}

function clearGroupCacheLocal(groupId) {
    try { localStorage.removeItem(`groupchat_${myUsername}_${groupId}`); } catch (e) {}
}

// ========== SOCKET EVENTS — ШАХСӢ ==========
socket.on('connect_error', (err) => console.log('Socket хатогӣ:', err.message));

socket.on('onlineList', (users) => {
    onlineUsers = new Set(users);
    renderUsers(allUsers);
    if (currentChat) updateChatStatus(currentChat);
});

socket.on('userOnline', (data) => {
    onlineUsers.add(data.username);
    renderUsers(allUsers);
    if (currentChat === data.username) updateChatStatus(data.username);
});

socket.on('userOffline', (data) => {
    onlineUsers.delete(data.username);
    delete lastSeenCache[data.username];
    renderUsers(allUsers);
    if (currentChat === data.username) updateChatStatus(data.username);
});

socket.on('userTyping', (data) => {
    if (typingTimers[data.sender] === 'typing') return;
    typingTimers[data.sender] = 'typing';
    if (currentChat === data.sender) updateChatStatus(data.sender);
    renderUsers(allUsers);
    clearTimeout(window['typingClear_' + data.sender]);
    window['typingClear_' + data.sender] = setTimeout(() => {
        delete typingTimers[data.sender];
        if (currentChat === data.sender) updateChatStatus(data.sender);
        renderUsers(allUsers);
    }, 3500);
});

socket.on('userStopTyping', (data) => {
    delete typingTimers[data.sender];
    if (currentChat === data.sender) updateChatStatus(data.sender);
    renderUsers(allUsers);
});

// №8 — Голосовой карда истодааст
socket.on('userVoiceRecording', (data) => {
    typingTimers[data.sender] = 'voice';
    if (currentChat === data.sender) updateChatStatus(data.sender);
    renderUsers(allUsers);
    clearTimeout(window['voiceClear_' + data.sender]);
    window['voiceClear_' + data.sender] = setTimeout(() => {
        if (typingTimers[data.sender] === 'voice') {
            delete typingTimers[data.sender];
            if (currentChat === data.sender) updateChatStatus(data.sender);
            renderUsers(allUsers);
        }
    }, 28000);
});

socket.on('userStopVoiceRecording', (data) => {
    clearTimeout(window['voiceClear_' + data.sender]);
    delete typingTimers[data.sender];
    if (currentChat === data.sender) updateChatStatus(data.sender);
    renderUsers(allUsers);
});

socket.on('messageEdited', (data) => {
    const el = document.getElementById(`msg_${data._id}`);
    if (el) {
        const bubble = el.querySelector('.message-bubble');
        if (bubble) bubble.innerHTML = `${escapeHtml(data.body)}<span class="edited-label"> (иваз карда шуд)</span>`;
    }
    const chatPartner = data.sender === myUsername ? data.receiver : data.sender;
    const cached = getCachedMessages(chatPartner);
    if (cached) {
        const msg = cached.find(m => m._id === data._id);
        if (msg) { msg.body = data.body; msg.edited = true; cacheMessages(chatPartner, cached); }
    }
});

socket.on('messagePinned', (data) => {
    if (currentGroupId) return;
    if (data.pinned && data.message) {
        pinnedMsgId = data.msgId;
        showPinnedBar(data.message);
    } else {
        hidePinnedBar();
    }
});

socket.on('userAvatarChanged', (data) => {
    if (!data || !data.username) return;
    userAvatars[data.username] = data.avatar;
    renderUsers(allUsers);
    if (currentChat === data.username) {
        const chatAvEl = document.getElementById('chatAvatar');
        if (chatAvEl) renderAvatarEl(chatAvEl, data.username, data.avatar);
    }
});

socket.on('mediaUploading', (data) => {
    if (data.sender === myUsername) return;
    if (currentChat !== data.sender) return;
    const text = data.isVideo ? '' : '';
    const container = document.getElementById('messagesContainer');
    if (container && !document.getElementById('mediaUploadingIndicator')) {
        const div = document.createElement('div');
        div.id = 'mediaUploadingIndicator';
        div.className = 'message-wrapper received';
        div.innerHTML = `<div class="message-bubble media-pending-receiver"><i class="fa-solid fa-spinner fa-spin"></i> ${text}</div>`;
        container.appendChild(div);
        container.scrollTop = container.scrollHeight;
        setTimeout(() => div.remove(), 60000);
    }
});

socket.on('newMessage', (msg) => {
    document.getElementById('mediaUploadingIndicator')?.remove();
    if (msg.sender === myUsername && document.getElementById(`msg_${msg._id}`)) return;
    if (currentChat === msg.sender || currentChat === msg.receiver) {
        if (msg.sender !== myUsername) {
            receivedSound.play().catch(e => console.log("Хатогии садо:", e));
        }
        renderMessage(msg);
        const container = document.getElementById('messagesContainer');
        container.scrollTop = container.scrollHeight;
        if (msg.sender === currentChat) markSeen(msg._id);
    } else if (msg.sender !== myUsername) {
        unreadMessages[msg.sender] = (unreadMessages[msg.sender] || 0) + 1;
        const notifText = getLastMsgText(msg);
        const senderAvatar = userAvatars[msg.sender] || '';
        showPushNotification(msg.sender, notifText, senderAvatar);
    }
    const chatPartner = msg.sender === myUsername ? msg.receiver : msg.sender;
    const msgText = getLastMsgText(msg);
    const isBold = msg.sender !== myUsername && currentChat !== msg.sender;
    updateLastMsg(chatPartner, msgText, isBold, msg.timestamp);
    appendToCache(chatPartner, [msg]);
});

socket.on('reactionUpdate', (data) => {
    updateReactionInUI({
        _id: data._id,
        reactionBySender: data.reactionBySender,
        reactionByReceiver: data.reactionByReceiver,
        sender: data.msgSender,
        receiver: data.msgReceiver
    });
    if (data.reaction) {
        const partner = data.sender !== myUsername ? data.sender : null;
        if (partner) {
            const notifText = `${partner} реаксия монд: ${data.reaction}`;
            if (currentChat !== partner) {
                updateLastMsg(partner, `Реаксия: ${data.reaction}`, true, Date.now());
                showPushNotification(partner, notifText, userAvatars[partner] || '');
            } else {
                updateLastMsg(partner, `Реаксия: ${data.reaction}`, false, Date.now());
            }
        }
    }
});

socket.on('messageDeleted', (data) => {
    const wrapper = document.getElementById(`msg_${data._id}`);
    if (!wrapper) return;
    if (data.deletedFor === 'all' || data.deletedFor === 'both') {
        wrapper.remove();
        audioInstances.delete(data._id);
    } else if (data.deletedFor === 'me' && myUsername === data.deletedBy) {
        wrapper.remove();
        audioInstances.delete(data._id);
    }
});

socket.on('messageSeenUpdate', (data) => {
    const wrapper = document.getElementById(`msg_${data.msgId}`);
    if (!wrapper) return;
    const seenIcon = wrapper.querySelector('.seen-icon');
    if (seenIcon) seenIcon.className = 'fa-solid fa-check-double seen-icon seen';
});

// Тики дуввум (delivered) — вакте гиранда онлайн аст ва паём расид
socket.on('messageDeliveredUpdate', (data) => {
    const wrapper = document.getElementById(`msg_${data.msgId}`);
    if (!wrapper) return;
    const seenIcon = wrapper.querySelector('.seen-icon');
    if (seenIcon && !seenIcon.classList.contains('seen')) {
        seenIcon.className = 'fa-solid fa-check-double seen-icon';
    }
});

socket.on('usernameChanged', (data) => {
    loadUsers();
    if (currentChat === data.oldUsername) {
        currentChat = data.newUsername;
        document.getElementById('chatUsername').textContent = data.newUsername;
    }
});

socket.on('newUserRegistered', (data) => {
    if (data.username !== myUsername && !allUsers.find(u => u.username === data.username)) {
        allUsers.push({ username: data.username, avatar: data.avatar || '' });
        renderUsers(allUsers);
    }
});

// ========== SOCKET EVENTS — ГУРӴ ==========

socket.on('newGroupMessage', (msg) => {
    document.getElementById('mediaUploadingIndicator')?.remove();
    if (msg.sender === myUsername && document.getElementById(`msg_${msg._id}`)) return;
    if (currentGroupId === msg.groupId) {
        if (msg.sender !== myUsername) receivedSound.play().catch(e => {});
        renderMessage(msg);
        const container = document.getElementById('messagesContainer');
        container.scrollTop = container.scrollHeight;
        if (msg.sender !== myUsername) markGroupSeen(msg._id);
    } else if (msg.sender !== myUsername) {
        unreadGroupMessages[msg.groupId] = (unreadGroupMessages[msg.groupId] || 0) + 1;
        const notifText = getLastMsgText(msg);
        const senderAvatar = userAvatars[msg.sender] || '';
        showPushNotification(msg.sender, notifText, senderAvatar, msg.groupId);
    }
    const text = msg.type === 'system' ? msg.body : `${msg.sender}: ${getLastMsgText(msg)}`;
    updateGroupLastMsg(msg.groupId, text, msg.timestamp);
    appendToGroupCache(msg.groupId, [msg]);
});

socket.on('groupReactionUpdate', (data) => {
    updateGroupReactionInUI(data._id, data.groupReactions);
});

socket.on('groupMessageDeleted', (data) => {
    const wrapper = document.getElementById(`msg_${data._id}`);
    if (!wrapper) return;
    if (data.deletedFor === 'all') {
        wrapper.remove();
        audioInstances.delete(data._id);
    } else if (data.deletedFor === 'me' && data.sender === myUsername) {
        wrapper.remove();
        audioInstances.delete(data._id);
    }
});

socket.on('groupMessageEdited', (data) => {
    const el = document.getElementById(`msg_${data._id}`);
    if (!el) return;
    const bubble = el.querySelector('.message-bubble');
    if (bubble) {
        const senderSpan = bubble.querySelector('.group-sender-name');
        const senderHTML = senderSpan ? senderSpan.outerHTML : '';
        bubble.innerHTML = `${senderHTML}${escapeHtml(data.body)}<span class="edited-label"> (иваз карда шуд)</span>`;
    }
    const cached = getCachedGroupMessages(data.groupId);
    if (cached) {
        const msg = cached.find(m => m._id === data._id);
        if (msg) { msg.body = data.body; msg.edited = true; cacheGroupMessages(data.groupId, cached); }
    }
});

socket.on('groupMessagePinned', (data) => {
    if (currentGroupId !== data.groupId) return;
    if (data.pinned && data.message) {
        pinnedMsgId = data.msgId;
        showPinnedBar(data.message);
    } else {
        hidePinnedBar();
    }
});

socket.on('groupUserTyping', (data) => {
    if (!groupTypingUsers[data.groupId]) groupTypingUsers[data.groupId] = new Set();
    groupTypingUsers[data.groupId].add(data.sender);
    if (currentGroupId === data.groupId) updateGroupTypingBar(data.groupId);
    renderUsers(allUsers);
    clearTimeout(window['gTypingClear_' + data.groupId + '_' + data.sender]);
    window['gTypingClear_' + data.groupId + '_' + data.sender] = setTimeout(() => {
        groupTypingUsers[data.groupId]?.delete(data.sender);
        if (currentGroupId === data.groupId) updateGroupTypingBar(data.groupId);
        renderUsers(allUsers);
    }, 3500);
});

socket.on('groupUserStopTyping', (data) => {
    groupTypingUsers[data.groupId]?.delete(data.sender);
    if (currentGroupId === data.groupId) updateGroupTypingBar(data.groupId);
    renderUsers(allUsers);
});

socket.on('groupMediaUploading', (data) => {
    if (data.sender === myUsername) return;
    if (currentGroupId !== data.groupId) return;
    const text = data.isVideo ? '🎥 Видео фиристода истода...' : '🖼 Сурат фиристода истода...';
    const container = document.getElementById('messagesContainer');
    if (container && !document.getElementById('mediaUploadingIndicator')) {
        const div = document.createElement('div');
        div.id = 'mediaUploadingIndicator';
        div.className = 'message-wrapper received';
        div.innerHTML = `<div class="message-bubble media-pending-receiver"><i class="fa-solid fa-spinner fa-spin"></i> ${escapeHtml(data.sender)}: ${text}</div>`;
        container.appendChild(div);
        container.scrollTop = container.scrollHeight;
        setTimeout(() => div.remove(), 60000);
    }
});

socket.on('groupMessageSeenUpdate', (data) => {
    const wrapper = document.getElementById(`msg_${data.msgId}`);
    if (!wrapper) return;
    const seenIcon = wrapper.querySelector('.seen-icon');
    if (seenIcon) seenIcon.className = 'fa-solid fa-check-double seen-icon seen';
});

socket.on('addedToGroup', async (data) => {
    try {
        const res = await fetch(`/api/groups/${data.groupId}`, { headers: { 'Authorization': 'Bearer ' + token } });
        if (!res.ok) return;
        const group = await res.json();
        groupsById[group._id] = group;
        if (!allGroups.find(g => g._id === group._id)) {
            allGroups.unshift(group);
            renderUsers(allUsers);
            showToast(`✅ Шуморо ба гурӯҳи "${group.name}" илова карданд`);
        }
    } catch (e) {}
});

socket.on('removedFromGroup', (data) => {
    allGroups = allGroups.filter(g => g._id !== data.groupId);
    delete groupsById[data.groupId];
    if (currentGroupId === data.groupId) {
        goBack();
        showToast('Шуморо аз гурӯҳ хазф карданд');
    }
    renderUsers(allUsers);
});

socket.on('groupMembersUpdated', async (data) => {
    try {
        const res = await fetch(`/api/groups/${data.groupId}`, { headers: { 'Authorization': 'Bearer ' + token } });
        if (!res.ok) return;
        const group = await res.json();
        groupsById[data.groupId] = group;
        const idx = allGroups.findIndex(g => g._id === data.groupId);
        if (idx >= 0) allGroups[idx] = group;
        if (currentGroupId === data.groupId) {
            document.getElementById('groupInfoMemberCount').textContent = `${group.members.length} аъзо`;
            if (!document.getElementById('groupInfoModal').classList.contains('hidden')) renderGroupMembersList(group);
            updateGroupTypingBar(data.groupId);
        }
        renderUsers(allUsers);
    } catch (e) {}
});

socket.on('groupInfoUpdated', async (data) => {
    try {
        const res = await fetch(`/api/groups/${data.groupId}`, { headers: { 'Authorization': 'Bearer ' + token } });
        if (!res.ok) return;
        const group = await res.json();
        groupsById[data.groupId] = group;
        const idx = allGroups.findIndex(g => g._id === data.groupId);
        if (idx >= 0) allGroups[idx] = group;
        if (currentGroupId === data.groupId) {
            document.getElementById('chatUsername').textContent = group.name;
            const chatAvEl = document.getElementById('chatAvatar');
            if (group.avatar) chatAvEl.innerHTML = `<img src="${group.avatar}" alt="group"/>`;
        }
        renderUsers(allUsers);
    } catch (e) {}
});

// ========== HELPERS ==========
function updateLastMsg(username, text, isBold = false, timestamp = Date.now()) {
    lastMessageInfo[username] = {
        text,
        timestamp: new Date(timestamp).getTime()
    };
    const el = document.getElementById(`lastMsg_${username}`);
    if (el) {
        el.innerHTML = escapeHtml(text);
        if (isBold) el.classList.add('unread-msg');
        else el.classList.remove('unread-msg');
    }
    renderUsers(allUsers);
}

// ===================================================================
// ================ STAR / FORWARD / DOCUMENT / ARCHIVE / MUTE / INVITE ====
// ===================================================================

let archivedChats = new Set();
let mutedChats = {};
let forwardMsgId = null;
let forwardIsGroup = false;
let forwardSelectedTargets = new Set();
let currentInviteGroupId = null;

// ---------- ATTACH MENU ----------
function toggleAttachMenu(e) {
    e.stopPropagation();
    const menu = document.getElementById('attachMenu');
    if (!menu) return;
    if (!menu.classList.contains('hidden')) { hideAttachMenu(); return; }
    menu.classList.remove('hidden');
    setTimeout(() => document.addEventListener('click', hideAttachMenu, { once: true }), 50);
}
function hideAttachMenu() { document.getElementById('attachMenu')?.classList.add('hidden'); }

// ---------- FAB MENU ----------
function toggleFabMenu(e) {
    e.stopPropagation();
    const menu = document.getElementById('fabMenu');
    if (!menu) return;
    if (!menu.classList.contains('hidden')) { hideFabMenu(); return; }
    menu.classList.remove('hidden');
    setTimeout(() => document.addEventListener('click', hideFabMenu, { once: true }), 50);
}
function hideFabMenu() { document.getElementById('fabMenu')?.classList.add('hidden'); }

// ---------- DOCUMENT UPLOAD ----------
async function sendDocument(input) {
    if (!input.files || !input.files.length) return;
    if (!currentChat && !currentGroupId) return;
    const files = Array.from(input.files);
    for (const file of files) {
        await sendSingleDocument(file);
    }
    input.value = '';
}

function formatFileSize(bytes) {
    if (!bytes) return '0 KB';
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function fileExtIcon(ext) {
    const map = {
        pdf: 'fa-file-pdf', doc: 'fa-file-word', docx: 'fa-file-word',
        xls: 'fa-file-excel', xlsx: 'fa-file-excel', ppt: 'fa-file-powerpoint', pptx: 'fa-file-powerpoint',
        zip: 'fa-file-zipper', rar: 'fa-file-zipper', txt: 'fa-file-lines',
        mp3: 'fa-file-audio', wav: 'fa-file-audio'
    };
    return map[ext] || 'fa-file';
}

function renderDocumentHTML(msg, replyHTML = '', senderNameHTML = '') {
    const ext = (msg.fileExt || '').toUpperCase();
    return `
        <div class="message-bubble">
            ${senderNameHTML}${replyHTML}
            <div class="document-bubble">
                <div class="document-icon"><i class="fa-solid ${fileExtIcon(msg.fileExt)}"></i></div>
                <div class="document-info">
                    <div class="document-name">${escapeHtml(msg.fileName || 'Файл')}</div>
                    <div class="document-meta">${ext} · ${formatFileSize(msg.fileSize)}</div>
                </div>
                <a class="document-download-btn" href="${msg.mediaUrl}" target="_blank" download="${escapeAttr(msg.fileName || 'file')}" onclick="event.stopPropagation()">
                    <i class="fa-solid fa-download"></i>
                </a>
            </div>
        </div>
    `;
}

async function sendSingleDocument(file) {
    if (currentGroupId) return sendSingleGroupDocument(file);
    const tempId = 'temp_doc_' + Date.now() + '_' + Math.random();
    const receiver = currentChat;
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    const tempMsg = {
        _id: tempId, sender: myUsername, receiver, type: 'document',
        mediaUrl: '#', fileName: file.name, fileSize: file.size, fileExt: ext,
        timestamp: new Date(), reactionBySender: '', reactionByReceiver: '', seen: false
    };
    renderMessage(tempMsg, true);
    const container = document.getElementById('messagesContainer');
    container.scrollTop = container.scrollHeight;
    updateLastMsg(receiver, `📄 ${file.name}`, false, tempMsg.timestamp);

    const formData = new FormData();
    formData.append('document', file);
    formData.append('receiver', receiver);
    if (replyTo) formData.append('replyToId', replyTo._id);
    cancelReply();

    sendQueue.push({
        tempId, receiver, tempMsg,
        execute: async () => {
            const res = await fetch('/api/messages/document', {
                method: 'POST', headers: { 'Authorization': 'Bearer ' + token }, body: formData
            });
            if (!res.ok) throw new Error('Server error');
            const msg = await res.json();
            const tempEl = document.getElementById(`msg_${tempId}`);
            if (tempEl) tempEl.remove();
            if (currentChat === receiver) {
                renderMessage(msg);
                container.scrollTop = container.scrollHeight;
            }
            socket.emit('sendMessage', { ...msg, receiver, sender: myUsername });
        }
    });
    processQueue();
}

async function sendSingleGroupDocument(file) {
    const tempId = 'temp_gdoc_' + Date.now() + '_' + Math.random();
    const groupId = currentGroupId;
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    const tempMsg = {
        _id: tempId, sender: myUsername, groupId, type: 'document',
        mediaUrl: '#', fileName: file.name, fileSize: file.size, fileExt: ext,
        timestamp: new Date(), groupReactions: {}, seenBy: [myUsername]
    };
    renderMessage(tempMsg, true);
    const container = document.getElementById('messagesContainer');
    container.scrollTop = container.scrollHeight;
    updateGroupLastMsg(groupId, `📄 ${file.name}`, tempMsg.timestamp);

    const formData = new FormData();
    formData.append('document', file);
    if (replyTo) formData.append('replyToId', replyTo._id);
    cancelReply();

    sendQueue.push({
        tempId, groupId, tempMsg,
        execute: async () => {
            const res = await fetch(`/api/groups/${groupId}/document`, {
                method: 'POST', headers: { 'Authorization': 'Bearer ' + token }, body: formData
            });
            if (!res.ok) throw new Error('Server error');
            const msg = await res.json();
            const tempEl = document.getElementById(`msg_${tempId}`);
            if (tempEl) tempEl.remove();
            if (currentGroupId === groupId) {
                renderMessage(msg);
                container.scrollTop = container.scrollHeight;
            }
            socket.emit('sendGroupMessage', { ...msg, groupId, sender: myUsername });
        }
    });
    processQueue();
}

// ---------- STAR MESSAGES ----------
async function toggleStarMessage(msgId) {
    closeInlineMenu();
    try {
        const url = currentGroupId ? `/api/groups/${currentGroupId}/messages/${msgId}/star` : `/api/messages/star/${msgId}`;
        const res = await fetch(url, { method: 'PUT', headers: { 'Authorization': 'Bearer ' + token } });
        const data = await res.json();
        const el = document.getElementById(`msg_${msgId}`);
        if (el) {
            let indicator = el.querySelector('.msg-star-indicator');
            const timeEl = el.querySelector('.message-time');
            if (data.starred) {
                if (!indicator && timeEl) {
                    timeEl.insertAdjacentHTML('afterbegin', '<i class="fa-solid fa-star msg-star-indicator"></i>');
                }
            } else if (indicator) {
                indicator.remove();
            }
        }
        showToast(data.starred ? '⭐ Star карда шуд' : 'Star хориҷ шуд');
    } catch (e) { showToast('Хатогӣ!'); }
}

async function showStarredModal() {
    const modal = document.getElementById('starredModal');
    const list = document.getElementById('starredMessagesList');
    if (!modal || !list) return;
    modal.classList.remove('hidden');
    list.innerHTML = '<p style="text-align:center;color:var(--text3);padding:20px">Бор карда истодааст...</p>';
    try {
        const res = await fetch('/api/messages/starred/all', { headers: { 'Authorization': 'Bearer ' + token } });
        const msgs = await res.json();
        if (!msgs.length) {
            list.innerHTML = '<p style="text-align:center;color:var(--text3);padding:20px">Паёми star-шуда нест</p>';
            return;
        }
        list.innerHTML = '';
        msgs.forEach(msg => {
            const time = new Date(msg.timestamp).toLocaleString('ru', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
            const bodyText = getLastMsgText(msg);
            const div = document.createElement('div');
            div.className = 'starred-msg-item';
            div.innerHTML = `
                <div class="starred-msg-header">
                    <span class="starred-msg-sender">${escapeHtml(msg.sender)}</span>
                    <span class="starred-msg-time">${time}</span>
                </div>
                <div class="starred-msg-body">${escapeHtml(bodyText)}</div>
            `;
            div.onclick = () => {
                hideStarredModal();
                const partner = msg.sender === myUsername ? msg.receiver : msg.sender;
                if (msg.groupId) openGroupChat(msg.groupId).then(() => scrollToMsg(msg._id));
                else openChat(partner).then(() => scrollToMsg(msg._id));
            };
            list.appendChild(div);
        });
    } catch (e) {
        list.innerHTML = '<p style="text-align:center;color:var(--text3);padding:20px">Хатогӣ!</p>';
    }
}
function hideStarredModal() { document.getElementById('starredModal')?.classList.add('hidden'); }

// ---------- FORWARD ----------
function inlineForward(msgId, isGroup) {
    closeInlineMenu();
    forwardMsgId = msgId;
    forwardIsGroup = isGroup;
    forwardSelectedTargets = new Set();
    const list = document.getElementById('forwardUserList');
    list.innerHTML = '';
    document.getElementById('forwardError').textContent = '';
    allUsers.forEach(user => {
        const avatarUrl = userAvatars[user.username] || '';
        const avatarHtml = avatarUrl
            ? `<img src="${avatarUrl}" style="width:32px;height:32px;border-radius:50%;object-fit:cover;"/>`
            : `<div style="width:32px;height:32px;border-radius:50%;background:var(--accent);display:flex;align-items:center;justify-content:center;font-weight:700;color:#fff;font-size:13px;">${user.username[0].toUpperCase()}</div>`;
        const label = document.createElement('label');
        label.className = 'user-picker-item';
        label.innerHTML = `
            ${avatarHtml}
            <span class="upi-name">${escapeHtml(user.username)}</span>
            <input type="checkbox" value="${escapeAttr(user.username)}" onchange="toggleForwardTarget('${escapeAttr(user.username)}', this.checked)"/>
        `;
        list.appendChild(label);
    });
    document.getElementById('forwardModal').classList.remove('hidden');
}
function hideForwardModal() { document.getElementById('forwardModal').classList.add('hidden'); }
function toggleForwardTarget(username, checked) {
    if (checked) forwardSelectedTargets.add(username);
    else forwardSelectedTargets.delete(username);
}
async function submitForward() {
    const errEl = document.getElementById('forwardError');
    if (forwardSelectedTargets.size === 0) { errEl.textContent = 'Камаш як корбар интихоб кунед!'; return; }
    try {
        const res = await fetch('/api/messages/forward', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ msgId: forwardMsgId, receivers: Array.from(forwardSelectedTargets) })
        });
        const data = await res.json();
        if (!res.ok) { errEl.textContent = data.message || 'Хатогӣ!'; return; }
        (data.messages || []).forEach(msg => {
            socket.emit('sendMessage', { ...msg, receiver: msg.receiver, sender: myUsername });
            updateLastMsg(msg.receiver, getLastMsgText(msg), false, msg.timestamp);
            appendToCache(msg.receiver, [msg]);
        });
        hideForwardModal();
        showToast('✅ Фиристода шуд');
    } catch (e) { errEl.textContent = 'Хатогӣ баромад!'; }
}

// ---------- ARCHIVE ----------
async function loadArchivedSet() {
    try {
        const res = await fetch('/api/auth/archived', { headers: { 'Authorization': 'Bearer ' + token } });
        const list = await res.json();
        archivedChats = new Set(list);
        updateArchiveRow();
    } catch (e) {}
}
function updateArchiveRow() {
    const row = document.getElementById('archiveRow');
    const countEl = document.getElementById('archiveCount');
    if (!row) return;
    if (archivedChats.size > 0) {
        row.classList.remove('hidden');
        if (countEl) countEl.textContent = archivedChats.size;
    } else {
        row.classList.add('hidden');
    }
}
function chatKey(username, groupId) { return groupId ? `group:${groupId}` : username; }

async function archiveCurrentChat() {
    const key = currentGroupId ? `group:${currentGroupId}` : currentChat;
    if (!key) return;
    try {
        await fetch(`/api/auth/archive/${encodeURIComponent(key)}`, { method: 'POST', headers: { 'Authorization': 'Bearer ' + token } });
        archivedChats.add(key);
        updateArchiveRow();
        showToast('📦 Ба архив гузаронида шуд');
        goBack();
        renderUsers(allUsers);
    } catch (e) { showToast('Хатогӣ!'); }
}
async function unarchiveChat(key) {
    try {
        await fetch(`/api/auth/unarchive/${encodeURIComponent(key)}`, { method: 'POST', headers: { 'Authorization': 'Bearer ' + token } });
        archivedChats.delete(key);
        updateArchiveRow();
        renderArchivedChatsList();
        renderUsers(allUsers);
        showToast('✅ Аз архив баргардонида шуд');
    } catch (e) { showToast('Хатогӣ!'); }
}

function showArchivedChats() {
    document.getElementById('archivedChatsModal')?.classList.remove('hidden');
    renderArchivedChatsList();
}
function hideArchivedChats() { document.getElementById('archivedChatsModal')?.classList.add('hidden'); }

function renderArchivedChatsList() {
    const list = document.getElementById('archivedChatsList');
    if (!list) return;
    list.innerHTML = '';
    if (archivedChats.size === 0) {
        list.innerHTML = '<p style="text-align:center;color:var(--text3);padding:20px">Архив холӣ аст</p>';
        return;
    }
    Array.from(archivedChats).forEach(key => {
        const isGroup = key.startsWith('group:');
        const groupId = isGroup ? key.replace('group:', '') : null;
        const username = isGroup ? null : key;
        const group = isGroup ? groupsById[groupId] : null;
        const name = isGroup ? (group ? group.name : 'Гурӯҳ') : key;
        const avatarUrl = isGroup ? (group ? group.avatar : '') : (userAvatars[username] || '');
        const avatarHtml = avatarUrl
            ? `<img src="${avatarUrl}" style="width:40px;height:40px;border-radius:50%;object-fit:cover;"/>`
            : isGroup
                ? `<div style="width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,#6c5ce7,#a29bfe);display:flex;align-items:center;justify-content:center;color:#fff;font-size:15px;"><i class="fa-solid fa-users"></i></div>`
                : `<div style="width:40px;height:40px;border-radius:50%;background:var(--accent);display:flex;align-items:center;justify-content:center;font-weight:700;color:#fff;font-size:14px;">${name[0].toUpperCase()}</div>`;
        const div = document.createElement('div');
        div.className = 'archived-chat-item';
        div.innerHTML = `
            ${avatarHtml}
            <span style="flex:1;font-size:14px;color:var(--text)">${escapeHtml(name)}</span>
            <button class="archived-chat-unarchive" onclick="event.stopPropagation(); unarchiveChat('${escapeAttr(key)}')">Баргардонидан</button>
        `;
        div.onclick = (e) => {
            if (e.target.closest('.archived-chat-unarchive')) return;
            hideArchivedChats();
            if (isGroup) openGroupChat(groupId);
            else openChat(username);
        };
        list.appendChild(div);
    });
}

// ---------- MUTE ----------
async function loadMutedSet() {
    try {
        const res = await fetch('/api/auth/muted', { headers: { 'Authorization': 'Bearer ' + token } });
        mutedChats = await res.json() || {};
    } catch (e) {}
}
function isChatMuted(key) {
    if (!(key in mutedChats)) return false;
    const until = mutedChats[key];
    if (!until) return true; // доимӣ
    return new Date(until).getTime() > Date.now();
}
function toggleMuteCurrentChat() {
    const key = currentGroupId ? `group:${currentGroupId}` : currentChat;
    if (!key) return;
    if (isChatMuted(key)) {
        unmuteChat(key);
    } else {
        document.getElementById('muteOptionsModal')?.classList.remove('hidden');
        window._muteTargetKey = key;
    }
}
function hideMuteOptions() { document.getElementById('muteOptionsModal')?.classList.add('hidden'); }
async function submitMute(hours) {
    const key = window._muteTargetKey;
    if (!key) return;
    const until = hours > 0 ? new Date(Date.now() + hours * 3600 * 1000).toISOString() : null;
    try {
        await fetch(`/api/auth/mute/${encodeURIComponent(key)}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ until })
        });
        mutedChats[key] = until;
        hideMuteOptions();
        updateMuteButtonText();
        renderUsers(allUsers);
        showToast('🔇 Бесадо карда шуд');
    } catch (e) { showToast('Хатогӣ!'); }
}
async function unmuteChat(key) {
    try {
        await fetch(`/api/auth/unmute/${encodeURIComponent(key)}`, { method: 'POST', headers: { 'Authorization': 'Bearer ' + token } });
        delete mutedChats[key];
        updateMuteButtonText();
        renderUsers(allUsers);
        showToast('🔔 Садо баргардонида шуд');
    } catch (e) { showToast('Хатогӣ!'); }
}
function updateMuteButtonText() {
    const key = currentGroupId ? `group:${currentGroupId}` : currentChat;
    if (!key) return;
    const muted = isChatMuted(key);
    const btn1 = document.getElementById('muteBtnText');
    const btn2 = document.getElementById('muteGroupBtnText');
    if (btn1) btn1.textContent = muted ? 'Садо баргардонидан' : 'Бесадо кардан';
    if (btn2) btn2.textContent = muted ? 'Садо баргардонидан' : 'Бесадо кардан';
}

// ---------- INVITE LINK ----------
function showInviteLink() {
    const group = groupsById[currentGroupId];
    if (!group) return;
    currentInviteGroupId = currentGroupId;
    document.getElementById('inviteLinkText').value = `${window.location.origin}/?invite=${group.inviteCode}`;
    document.getElementById('inviteLinkModal').classList.remove('hidden');
}
function hideInviteLinkModal() { document.getElementById('inviteLinkModal').classList.add('hidden'); }
function copyInviteLink() {
    const input = document.getElementById('inviteLinkText');
    input.select();
    try {
        navigator.clipboard.writeText(input.value);
        showToast('✅ Линк нусха карда шуд');
    } catch (e) {
        document.execCommand('copy');
        showToast('✅ Линк нусха карда шуд');
    }
}
async function resetInviteLink() {
    try {
        const res = await fetch(`/api/groups/${currentInviteGroupId}/invite/reset`, {
            method: 'POST', headers: { 'Authorization': 'Bearer ' + token }
        });
        const data = await res.json();
        groupsById[currentInviteGroupId].inviteCode = data.inviteCode;
        document.getElementById('inviteLinkText').value = `${window.location.origin}/?invite=${data.inviteCode}`;
        showToast('✅ Линк нав шуд');
    } catch (e) { showToast('Хатогӣ!'); }
}

function showJoinByInvite() {
    document.getElementById('joinInviteInput').value = '';
    document.getElementById('joinInviteError').textContent = '';
    document.getElementById('joinInviteModal').classList.remove('hidden');
}
function hideJoinByInvite() { document.getElementById('joinInviteModal').classList.add('hidden'); }
async function submitJoinByInvite() {
    const raw = document.getElementById('joinInviteInput').value.trim();
    const errEl = document.getElementById('joinInviteError');
    if (!raw) { errEl.textContent = 'Линк ё кодро гузоред!'; return; }
    const code = raw.includes('invite=') ? raw.split('invite=')[1].split('&')[0] : raw;
    await joinGroupByCode(code, errEl);
}
async function joinGroupByCode(code, errEl) {
    try {
        const res = await fetch(`/api/groups/invite/${code}/join`, {
            method: 'POST', headers: { 'Authorization': 'Bearer ' + token }
        });
        const data = await res.json();
        if (!res.ok) { if (errEl) errEl.textContent = data.message || 'Хатогӣ!'; else showToast(data.message || 'Хатогӣ!'); return; }
        groupsById[data._id] = data;
        if (!allGroups.find(g => g._id === data._id)) allGroups.unshift(data);
        socket.emit('groupCreated', { groupId: data._id });
        hideJoinByInvite();
        renderUsers(allUsers);
        showToast(`✅ Ба гурӯҳи "${data.name}" ҳамроҳ шудед`);
        openGroupChat(data._id);
    } catch (e) { if (errEl) errEl.textContent = 'Хатогӣ баромад!'; }
}

// Санҷидан агар URL дорои ?invite= бошад (вакти кушодани барнома)
function checkInviteUrlOnLoad() {
    const params = new URLSearchParams(window.location.search);
    const inviteCode = params.get('invite');
    if (inviteCode && myUsername) {
        joinGroupByCode(inviteCode, null);
        window.history.replaceState({}, document.title, window.location.pathname);
    }
}

// ---------- GROUP PERMISSIONS ----------
function showGroupPermissions() {
    const group = groupsById[currentGroupId];
    if (!group) return;
    document.getElementById('sendPermSelect').value = group.sendPermission || 'everyone';
    document.getElementById('editPermSelect').value = group.editPermission || 'admins';
    document.getElementById('groupPermissionsModal').classList.remove('hidden');
}
function hideGroupPermissions() { document.getElementById('groupPermissionsModal').classList.add('hidden'); }
async function submitGroupPermissions() {
    const sendPermission = document.getElementById('sendPermSelect').value;
    const editPermission = document.getElementById('editPermSelect').value;
    try {
        await fetch(`/api/groups/${currentGroupId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ sendPermission, editPermission })
        });
        groupsById[currentGroupId].sendPermission = sendPermission;
        groupsById[currentGroupId].editPermission = editPermission;
        hideGroupPermissions();
        socket.emit('groupUpdated', { groupId: currentGroupId });
        showToast('✅ Танзимот захира шуд');
    } catch (e) { showToast('Хатогӣ!'); }
}

// ---------- GROUP DESCRIPTION EDIT ----------
function showEditGroupDesc() {
    const group = groupsById[currentGroupId];
    document.getElementById('editGroupDescInput').value = group ? (group.description || '') : '';
    document.getElementById('editGroupDescModal').classList.remove('hidden');
}
function hideEditGroupDesc() { document.getElementById('editGroupDescModal').classList.add('hidden'); }
async function submitEditGroupDesc() {
    const description = document.getElementById('editGroupDescInput').value.trim();
    try {
        await fetch(`/api/groups/${currentGroupId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ description })
        });
        groupsById[currentGroupId].description = description;
        document.getElementById('groupDescText').textContent = description || 'Тавсиф илова кунед';
        hideEditGroupDesc();
        socket.emit('groupUpdated', { groupId: currentGroupId });
        showToast('✅ Тавсиф захира шуд');
    } catch (e) { showToast('Хатогӣ!'); }
}

// ===================================================================
// ============ PINNED CHATS / NOTIFICATIONS / STORAGE / ACCOUNT ====
// ===================================================================

// ---------- PINNED CHATS ----------
async function loadPinnedChatsSet() {
    try {
        const res = await fetch('/api/auth/pinned-chats', { headers: { 'Authorization': 'Bearer ' + token } });
        const list = await res.json();
        pinnedChats = new Set(list);
        renderUsers(allUsers);
    } catch (e) {}
}
function isChatPinned(key) { return pinnedChats.has(key); }
async function togglePinCurrentChat() {
    const key = currentGroupId ? `group:${currentGroupId}` : currentChat;
    if (!key) return;
    try {
        if (isChatPinned(key)) {
            await fetch(`/api/auth/unpin-chat/${encodeURIComponent(key)}`, { method: 'POST', headers: { 'Authorization': 'Bearer ' + token } });
            pinnedChats.delete(key);
            showToast('Аз боло хориҷ шуд');
        } else {
            await fetch(`/api/auth/pin-chat/${encodeURIComponent(key)}`, { method: 'POST', headers: { 'Authorization': 'Bearer ' + token } });
            pinnedChats.add(key);
            showToast('📌 Дар боло сабт шуд');
        }
        updatePinChatButtonText();
        renderUsers(allUsers);
    } catch (e) { showToast('Хатогӣ!'); }
}
function updatePinChatButtonText() {
    const key = currentGroupId ? `group:${currentGroupId}` : currentChat;
    if (!key) return;
    const pinned = isChatPinned(key);
    const b1 = document.getElementById('pinChatBtnText');
    const b2 = document.getElementById('pinGroupBtnText');
    if (b1) b1.textContent = pinned ? 'Аз боло хориҷ кардан' : 'Сабт дар боло';
    if (b2) b2.textContent = pinned ? 'Аз боло хориҷ кардан' : 'Сабт дар боло';
}

// ---------- NOTIFICATION SETTINGS ----------
async function saveNotificationSettings() {
    const sound = document.getElementById('notifSoundToggle').checked;
    const vibrate = document.getElementById('notifVibrateToggle').checked;
    notificationSettings = { sound, vibrate };
    localStorage.setItem('notificationSettings', JSON.stringify(notificationSettings));
    try {
        await fetch('/api/auth/notification-settings', {
            method: 'PUT', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ sound, vibrate })
        });
    } catch (e) {}
}

// ---------- STORAGE USAGE ----------
async function loadStorageUsage() {
    const el = document.getElementById('storageUsageBreakdown');
    if (!el) return;
    el.innerHTML = '<p style="font-size:12px;color:var(--text3)">Ҳисоб карда истодааст...</p>';
    try {
        const res = await fetch('/api/auth/storage-usage', { headers: { 'Authorization': 'Bearer ' + token } });
        const data = await res.json();
        const { breakdown, counts, total } = data;
        const colors = { image: '#53bdeb', video: '#a695e7', voice: '#00a884', document: '#faa774' };
        const labels = { image: 'Суратҳо', video: 'Видеоҳо', voice: 'Овозҳо', document: 'Ҳуҷҷатҳо' };

        let barHtml = '<div class="storage-bar-track">';
        Object.keys(breakdown).forEach(key => {
            const pct = total > 0 ? (breakdown[key] / total * 100) : 0;
            if (pct > 0) barHtml += `<div class="storage-bar-seg" style="width:${pct}%;background:${colors[key]}"></div>`;
        });
        barHtml += '</div>';

        let legendHtml = '<div class="storage-legend">';
        Object.keys(breakdown).forEach(key => {
            legendHtml += `<div class="storage-legend-item"><span class="storage-legend-dot" style="background:${colors[key]}"></span>${labels[key]}: ${formatFileSize(breakdown[key])} (${counts[key] || 0})</div>`;
        });
        legendHtml += '</div>';

        el.innerHTML = `
            <div class="storage-bar-row"><span>Ҳамагӣ: ${formatFileSize(total)}</span></div>
            ${barHtml}
            ${legendHtml}
        `;
    } catch (e) {
        el.innerHTML = '<p style="font-size:12px;color:var(--text3)">Хатогӣ!</p>';
    }
}

// ---------- BLOCKED CONTACTS LIST ----------
function showBlockedContacts() {
    document.getElementById('blockedContactsModal')?.classList.remove('hidden');
    renderBlockedContactsList();
}
function hideBlockedContacts() { document.getElementById('blockedContactsModal')?.classList.add('hidden'); }
function renderBlockedContactsList() {
    const list = document.getElementById('blockedContactsList');
    if (!list) return;
    list.innerHTML = '';
    if (blockedUsers.size === 0) {
        list.innerHTML = '<p style="text-align:center;color:var(--text3);padding:20px">Корбари блокшуда нест</p>';
        return;
    }
    Array.from(blockedUsers).forEach(username => {
        const avatarUrl = userAvatars[username] || '';
        const avatarHtml = avatarUrl
            ? `<img src="${avatarUrl}" style="width:40px;height:40px;border-radius:50%;object-fit:cover;"/>`
            : `<div style="width:40px;height:40px;border-radius:50%;background:var(--accent);display:flex;align-items:center;justify-content:center;font-weight:700;color:#fff;font-size:14px;">${username[0].toUpperCase()}</div>`;
        const div = document.createElement('div');
        div.className = 'archived-chat-item';
        div.innerHTML = `
            ${avatarHtml}
            <span style="flex:1;font-size:14px;color:var(--text)">${escapeHtml(username)}</span>
            <button class="archived-chat-unarchive" onclick="unblockFromList('${escapeAttr(username)}')">Бекор кардан</button>
        `;
        list.appendChild(div);
    });
}
async function unblockFromList(username) {
    try {
        await fetch(`/api/auth/unblock/${username}`, { method: 'POST', headers: { 'Authorization': 'Bearer ' + token } });
        blockedUsers.delete(username);
        renderBlockedContactsList();
        showToast(`${username} аз блок хориҷ шуд`);
    } catch (e) { showToast('Хатогӣ!'); }
}

// ---------- DELETE ACCOUNT ----------
function showDeleteAccountModal() {
    document.getElementById('deleteAccountPassword').value = '';
    document.getElementById('deleteAccountError').textContent = '';
    document.getElementById('deleteAccountModal').classList.remove('hidden');
}
function hideDeleteAccountModal() { document.getElementById('deleteAccountModal').classList.add('hidden'); }
async function submitDeleteAccount() {
    const password = document.getElementById('deleteAccountPassword').value;
    const errEl = document.getElementById('deleteAccountError');
    if (!password) { errEl.textContent = 'Паролро ворид кунед!'; return; }
    try {
        const res = await fetch('/api/auth/account', {
            method: 'DELETE', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ password })
        });
        const data = await res.json();
        if (!res.ok) { errEl.textContent = data.message || 'Хатогӣ!'; return; }
        hideDeleteAccountModal();
        showToast('Ҳисоб нест карда шуд');
        logout();
    } catch (e) { errEl.textContent = 'Хатогӣ баромад!'; }
}

// ---------- DISAPPEARING MESSAGES ----------
async function loadDisappearingSettings() {
    try {
        const res = await fetch('/api/auth/disappearing', { headers: { 'Authorization': 'Bearer ' + token } });
        disappearingSettings = await res.json() || {};
    } catch (e) {}
}
function showDisappearingModal() {
    document.getElementById('disappearCustomValue').value = '';
    document.getElementById('disappearingModal').classList.remove('hidden');
}
function hideDisappearingModal() { document.getElementById('disappearingModal').classList.add('hidden'); }
async function setDisappearPreset(seconds) {
    await applyDisappearSetting(seconds);
}
async function setDisappearCustom() {
    const val = parseInt(document.getElementById('disappearCustomValue').value);
    const unit = parseInt(document.getElementById('disappearCustomUnit').value);
    if (!val || val <= 0) { showToast('Ададро дуруст нависед!'); return; }
    await applyDisappearSetting(val * unit);
}
async function applyDisappearSetting(seconds) {
    const key = currentGroupId ? `group:${currentGroupId}` : currentChat;
    if (!key) return;
    try {
        await fetch(`/api/auth/disappearing/${encodeURIComponent(key)}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ seconds })
        });
        if (seconds > 0) disappearingSettings[key] = seconds;
        else delete disappearingSettings[key];
        hideDisappearingModal();
        showToast(seconds > 0 ? '⏱ Паёми нопадидшаванда фаъол шуд' : '⏱ Хомуш карда шуд');
    } catch (e) { showToast('Хатогӣ!'); }
}

// ---------- MESSAGE INFO (кӣ кай хонд) ----------
async function showMessageInfo(msgId, isGroup) {
    closeInlineMenu();
    const modal = document.getElementById('messageInfoModal');
    const content = document.getElementById('messageInfoContent');
    if (!modal || !content) return;
    modal.classList.remove('hidden');
    content.innerHTML = '<p style="text-align:center;color:var(--text3);padding:20px">Бор карда истодааст...</p>';
    if (!isGroup) {
        // Барои чати шахсӣ — статуси оддӣ
        const wrapper = document.getElementById(`msg_${msgId}`);
        const seenIcon = wrapper?.querySelector('.seen-icon.seen');
        content.innerHTML = `
            <div class="starred-msg-item" style="margin-bottom:8px">
                <div class="starred-msg-body">${seenIcon ? '✅ Хонда шуд' : '✓ Расид'}</div>
            </div>
        `;
        return;
    }
    try {
        const res = await fetch(`/api/groups/${currentGroupId}/messages/${msgId}/info`, { headers: { 'Authorization': 'Bearer ' + token } });
        const info = await res.json();
        if (!info.length) {
            content.innerHTML = '<p style="text-align:center;color:var(--text3);padding:20px">Ҳанӯз касе нахондааст</p>';
            return;
        }
        content.innerHTML = '';
        info.sort((a, b) => new Date(a.seenAt) - new Date(b.seenAt)).forEach(item => {
            const time = new Date(item.seenAt).toLocaleString('ru', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
            const avatarUrl = userAvatars[item.username] || '';
            const avatarHtml = avatarUrl
                ? `<img src="${avatarUrl}" style="width:32px;height:32px;border-radius:50%;object-fit:cover;"/>`
                : `<div style="width:32px;height:32px;border-radius:50%;background:var(--accent);display:flex;align-items:center;justify-content:center;font-weight:700;color:#fff;font-size:13px;">${item.username[0].toUpperCase()}</div>`;
            const div = document.createElement('div');
            div.className = 'group-member-item';
            div.style.cursor = 'default';
            div.innerHTML = `
                <div class="gmi-avatar">${avatarHtml}</div>
                <div class="gmi-name">${escapeHtml(item.username)}</div>
                <span style="font-size:11px;color:var(--text3)">${time}</span>
            `;
            content.appendChild(div);
        });
    } catch (e) {
        content.innerHTML = '<p style="text-align:center;color:var(--text3);padding:20px">Хатогӣ!</p>';
    }
}
function hideMessageInfo() { document.getElementById('messageInfoModal')?.classList.add('hidden'); }

// ---------- GALLERY (Media Gallery) ----------
function showGalleryModal() {
    galleryCurrentScope = currentGroupId ? { isGroup: true, id: currentGroupId } : { isGroup: false, id: currentChat };
    if (!galleryCurrentScope.id) return;
    galleryCurrentType = 'media';
    document.getElementById('galleryTabMedia').classList.add('active');
    document.getElementById('galleryTabDocs').classList.remove('active');
    document.getElementById('galleryModal').classList.remove('hidden');
    loadGalleryContent();
}
function hideGalleryModal() { document.getElementById('galleryModal')?.classList.add('hidden'); }
function switchGalleryTab(type) {
    galleryCurrentType = type;
    document.getElementById('galleryTabMedia').classList.toggle('active', type === 'media');
    document.getElementById('galleryTabDocs').classList.toggle('active', type === 'document');
    loadGalleryContent();
}
async function loadGalleryContent() {
    const grid = document.getElementById('galleryGrid');
    if (!grid || !galleryCurrentScope) return;
    grid.innerHTML = '<p style="grid-column:1/-1;text-align:center;color:var(--text3);padding:20px">Бор карда истодааст...</p>';
    try {
        const url = galleryCurrentScope.isGroup
            ? `/api/groups/${galleryCurrentScope.id}/gallery?type=${galleryCurrentType}`
            : `/api/messages/${galleryCurrentScope.id}/gallery?type=${galleryCurrentType}`;
        const res = await fetch(url, { headers: { 'Authorization': 'Bearer ' + token } });
        const items = await res.json();
        grid.innerHTML = '';
        if (!items.length) {
            grid.innerHTML = '<p style="grid-column:1/-1;text-align:center;color:var(--text3);padding:20px">Холӣ аст</p>';
            return;
        }
        items.forEach(msg => {
            if (galleryCurrentType === 'document') {
                const div = document.createElement('div');
                div.className = 'gallery-doc-item';
                div.innerHTML = `
                    <div class="document-icon" style="background:var(--accent)"><i class="fa-solid ${fileExtIcon(msg.fileExt)}"></i></div>
                    <div class="document-info">
                        <div class="document-name" style="color:var(--text)">${escapeHtml(msg.fileName || 'Файл')}</div>
                        <div class="document-meta">${(msg.fileExt || '').toUpperCase()} · ${formatFileSize(msg.fileSize)}</div>
                    </div>
                `;
                div.onclick = () => window.open(msg.mediaUrl, '_blank');
                grid.appendChild(div);
            } else {
                const div = document.createElement('div');
                div.className = 'gallery-grid-item';
                if (msg.type === 'video') {
                    div.innerHTML = `<video src="${msg.mediaUrl}" muted></video><span class="gallery-video-badge"><i class="fa-solid fa-play"></i></span>`;
                    div.onclick = () => { hideGalleryModal(); openVideoFullscreen(msg.mediaUrl); };
                } else {
                    div.innerHTML = `<img src="${msg.mediaUrl}" loading="lazy"/>`;
                    div.onclick = () => { hideGalleryModal(); openImageViewer(msg.mediaUrl); };
                }
                grid.appendChild(div);
            }
        });
    } catch (e) {
        grid.innerHTML = '<p style="grid-column:1/-1;text-align:center;color:var(--text3);padding:20px">Хатогӣ!</p>';
    }
}
