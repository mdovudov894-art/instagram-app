// ========== VARIABLES ==========
let token = localStorage.getItem('token');
let myUsername = localStorage.getItem('username');
let myAvatar = localStorage.getItem('myAvatar') || '';
let currentChat = null;
let allUsers = [];
let mediaRecorder = null;
let audioChunks = [];
let recordingCancelled = false;
let recordingTimer = null;
let recordingSeconds = 0;
let selectedMessageId = null;
let isRecording = false;
let replyTo = null;
let unreadMessages = {};
let currentAudio = null;
let currentAudioMsgId = null;
let onlineUsers = new Set();
let typingTimers = {};
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
let userAvatars = {}; // кэши аватарҳо
const audioInstances = new Map();

// Офлайн навбат
let sendQueue = [];
let isSending = false;

// Охирин паём барои ҳар корбар (барои тартиб)
let lastMessageInfo = {}; // { username: { text, timestamp } }

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
            localStorage.setItem('myAvatar', myAvatar);
            return true;
        }
        return false;
    } catch (err) {
        return false;
    }
}

// №12 — Уведомление
async function requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
        await Notification.requestPermission();
    }
}

function showPushNotification(sender, text, avatarUrl) {
    if (Notification.permission !== 'granted') return;
    if (document.visibilityState === 'visible' && currentChat === sender) return;
    const notif = new Notification(sender, {
        body: text,
        icon: avatarUrl || '/icon.png',
        tag: sender,
        renotify: true
    });
    notif.onclick = () => {
        window.focus();
        openChat(sender);
        notif.close();
    };
    setTimeout(() => notif.close(), 5000);
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
    }
}

async function register() {
    const username = document.getElementById('regUsername').value.trim();
    const password = document.getElementById('regPassword').value.trim();
    const errorEl = document.getElementById('registerError');
    if (!username || !password) { errorEl.textContent = 'Ҳамаи майдонҳоро пур кунед!'; return; }
    try {
        const res = await fetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (!res.ok) { errorEl.textContent = data.message; return; }
        token = data.token;
        myUsername = data.username;
        localStorage.setItem('token', token);
        localStorage.setItem('username', myUsername);
        socket.auth.token = token;
        socket.disconnect().connect();
        showApp();
    } catch (err) {
        errorEl.textContent = 'Хатогӣ баромад!';
    }
}

async function login() {
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value.trim();
    const errorEl = document.getElementById('loginError');
    if (!username || !password) { errorEl.textContent = 'Ҳамаи майдонҳоро пур кунед!'; return; }
    try {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (!res.ok) { errorEl.textContent = data.message; return; }
        token = data.token;
        myUsername = data.username;
        myAvatar = data.avatar || '';
        localStorage.setItem('token', token);
        localStorage.setItem('username', myUsername);
        localStorage.setItem('myAvatar', myAvatar);
        socket.auth.token = token;
        socket.disconnect().connect();
        requestNotificationPermission();
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
    allUsers = [];
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
    if (!socket.connected) socket.connect();
    requestNotificationPermission();
    loadUsers();
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

// ========== PROFILE & SETTINGS (#13) ==========
function showProfile() {
    const modal = document.getElementById('profileModal');
    if (!modal) return;
    modal.classList.remove('hidden');
    document.getElementById('profileUsername').textContent = myUsername;
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
    // Visibility
    const vis = localStorage.getItem('myVisibility') || 'everyone';
    document.querySelectorAll('input[name="visibility"]').forEach(r => {
        r.checked = r.value === vis;
    });
}

// Visibility user picker
function showVisibilityPicker(radio) {
    const overlay = document.getElementById('visibilityPickerOverlay');
    const list = document.getElementById('visibilityUserList');
    if (!overlay || !list) return;
    const selectedList = JSON.parse(localStorage.getItem('visibilitySelectedUsers') || '[]');
    list.innerHTML = '';
    allUsers.forEach(user => {
        const checked = selectedList.includes(user.username);
        const avatarUrl = userAvatars[user.username] || '';
        const avatarHtml = avatarUrl
            ? `<img src="${avatarUrl}" style="width:32px;height:32px;border-radius:50%;object-fit:cover;"/>`
            : `<div style="width:32px;height:32px;border-radius:50%;background:var(--accent);display:flex;align-items:center;justify-content:center;font-weight:700;color:#000;font-size:13px;">${user.username[0].toUpperCase()}</div>`;
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
    // Reset radio if cancelled
    const vis = localStorage.getItem('myVisibility') || 'everyone';
    document.querySelectorAll('input[name="visibility"]').forEach(r => r.checked = r.value === vis);
}

async function saveVisibilitySelected() {
    const checkboxes = document.querySelectorAll('#visibilityUserList input[type="checkbox"]:checked');
    const selected = Array.from(checkboxes).map(c => c.value);
    localStorage.setItem('myVisibility', 'selected');
    localStorage.setItem('visibilitySelectedUsers', JSON.stringify(selected));
    document.getElementById('visibilityPickerOverlay')?.classList.add('hidden');
    document.querySelectorAll('input[name="visibility"]').forEach(r => r.checked = r.value === 'selected');
    try {
        await fetch('/api/auth/online-visibility', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ visibility: 'selected', visibleTo: selected })
        });
        socket.emit('updateVisibility', { visibility: 'selected', visibleTo: selected });
        const statusEl = document.getElementById('visibilityStatus');
        if (statusEl) { statusEl.textContent = `✅ ${selected.length} нафар интихоб шуд`; setTimeout(() => { if(statusEl) statusEl.textContent=''; }, 2500); }
    } catch(e) { showToast('Хатогӣ!'); }
}

function hideProfile() {
    document.getElementById('profileModal')?.classList.add('hidden');
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

function showUserProfile(username) {
    if (!username) return;
    const overlay = document.getElementById('profileViewerOverlay');
    if (!overlay) return;
    const avEl = document.getElementById('profileViewerAvatar');
    const nameEl = document.getElementById('profileViewerName');
    const statusEl = document.getElementById('profileViewerStatus');
    const avatarUrl = username === myUsername ? myAvatar : (userAvatars[username] || '');
    const isMe = username === myUsername;
    const isOnline = onlineUsers.has(username);
    if (avEl) {
        if (avatarUrl) {
            avEl.innerHTML = `<img src="${avatarUrl}" alt="${escapeHtml(username)}"/>`;
        } else {
            avEl.textContent = username[0].toUpperCase();
        }
    }
    if (nameEl) nameEl.textContent = username;
    if (statusEl) statusEl.textContent = isMe ? '' : (isOnline ? '🟢 Онлайн' : '⚫ Офлайн');
    overlay.classList.remove('hidden');
}

function hideProfileViewer() {
    document.getElementById('profileViewerOverlay')?.classList.add('hidden');
}

function confirmLogout() {
    hideProfile();
    logout();
}

// №17 — Медиа фиристодан (сурат/видео) — чандто мумкин
async function sendMedia(input) {
    if (!input.files || !input.files.length || !currentChat) return;
    const files = Array.from(input.files);
    for (const file of files) {
        await sendSingleMedia(file);
    }
    input.value = '';
}

async function sendSingleMedia(file) {
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

    const formData = new FormData();
    formData.append('media', file);
    formData.append('receiver', receiver);
    if (replyTo) formData.append('replyToId', replyTo._id);
    cancelReply();

    // Навбатга илова
    sendQueue.push({
        tempId,
        receiver,
        tempMsg,
        execute: async () => {
            const res = await fetch('/api/messages/media', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + token },
                body: formData
            });
            if (!res.ok) throw new Error('Error');
            const msg = await res.json();
            const tempEl = document.getElementById(`msg_${tempId}`);
            if (tempEl) tempEl.remove();
            if (currentChat === receiver) {
                renderMessage(msg);
                container.scrollTop = container.scrollHeight;
            }
            socket.emit('sendMessage', { ...msg, receiver, sender: myUsername });
            URL.revokeObjectURL(objectUrl);
        }
    });
    processQueue();
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
    if (msg.type === 'voice') return '🎤 Голосовой паём';
    if (msg.type === 'image') return '🖼 Сурат';
    if (msg.type === 'video') return '🎥 Видео';
    return msg.body || '';
}

function renderUsers(users) {
    const list = document.getElementById('usersList');
    list.innerHTML = '';

    // Тартиб: охирин паём аввал
    const sorted = [...users].sort((a, b) => {
        const aTime = lastMessageInfo[a.username]?.timestamp || 0;
        const bTime = lastMessageInfo[b.username]?.timestamp || 0;
        return bTime - aTime;
    });

    sorted.forEach(user => {
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

        div.innerHTML = `
            <div class="user-avatar-wrap">
                <div class="user-avatar">${avatarInner}</div>
                ${isOnline ? '<div class="online-dot"></div>' : ''}
            </div>
            <div class="user-info">
                <div class="user-item-top">
                    <div class="name ${isUnread ? 'unread-name' : ''}">${escapeHtml(user.username)}</div>
                </div>
                <div class="last-msg ${isUnread ? 'unread-msg' : ''}" id="lastMsg_${user.username}">${statusHtml}</div>
            </div>
            ${isUnread ? `<div class="unread-badge">${unreadMessages[user.username]}</div>` : ''}
        `;
        list.appendChild(div);
    });
}

function searchUsers() {
    const query = document.getElementById('searchInput').value.toLowerCase();
    const filtered = allUsers.filter(u => u.username.toLowerCase().includes(query));
    renderUsers(filtered);
}

// ========== CHAT ==========
async function openChat(username) {
    // №9 — агар ҳамон чат боз зер карда шавад, ҳеҷ кор нашавад
    if (currentChat === username) {
        document.getElementById('chatArea').classList.add('open');
        return;
    }

    // Дархол чати қаблиро тоза кун
    const container = document.getElementById('messagesContainer');
    container.innerHTML = '';
    container.onscroll = null;

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
    const av = userAvatars[username] || '';
    renderAvatarEl(chatAvEl, username, av);
    document.getElementById('chatArea').classList.add('open');
    updateChatStatus(username);
    cancelReply();
    renderUsers(allUsers);

    await loadMessages();

    // Pending паёмҳои навбатро нишон деҳ
    sendQueue.forEach(task => {
        if (task.receiver === username && task.tempMsg && !document.getElementById(`msg_${task.tempId}`)) {
            renderMessage(task.tempMsg, true);
        }
    });
    const c2 = document.getElementById('messagesContainer');
    if (c2 && sendQueue.some(t => t.receiver === username)) c2.scrollTop = c2.scrollHeight;

    container.onscroll = () => {
        if (container.scrollTop < 80 && !isLoadingMore && hasMoreMessages) {
            loadMoreMessages();
        }
    };
}

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
        } else {
            statusEl.textContent = '';
            statusEl.className = 'chat-status';
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

function goBack() {
    document.getElementById('chatArea').classList.remove('open');
    document.getElementById('chatScreen').classList.add('hidden');
    document.getElementById('chatDefault').classList.remove('hidden');
    currentChat = null;
    cancelReply();
    stopCurrentAudio();
    const container = document.getElementById('messagesContainer');
    container.innerHTML = '';
    container.onscroll = null;
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
            container.innerHTML = '<div style="text-align:center;color:var(--text3);padding:20px;font-size:13px;">Интернет нест. Паёмҳо дастрас нестанд.</div>';
        }
    }
}

async function loadMoreMessages() {
    if (!hasMoreMessages || !oldestTimestamp || !currentChat) return;
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
    } catch (err) {}
}

function isDeletedForMe(msg) {
    if (msg.sender === myUsername && msg.deletedBySender) return true;
    if (msg.receiver === myUsername && msg.deletedByReceiver) return true;
    return false;
}

function createMessageElement(msg, isPending = false) {
    const isSent = msg.sender === myUsername;
    if (isDeletedForMe(msg)) return null;

    const wrapper = document.createElement('div');
    wrapper.className = `message-wrapper ${isSent ? 'sent' : 'received'} ${isPending ? 'pending' : ''}`;
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
        const replyText = escapeHtml(rawReply.replace(/\n+/g, ' ').trim()).substring(0, 45);
        replyHTML = `
            <div class="reply-preview" onclick="scrollToMsg('${msg.replyTo._id}')">
                <div class="reply-preview-inner">
                    <span class="reply-name">${escapeHtml(msg.replyTo.sender)}</span>
                    <span class="reply-text">${replyText}</span>
                </div>
            </div>`;
    }

    let content = '';
    if (msg.type === 'voice' && !msg.deletedBySender && !msg.deletedByReceiver) {
        content = renderVoiceHTML(msg, replyHTML);
    } else if (msg.type === 'image' && !msg.deletedBySender && !msg.deletedByReceiver) {
        content = `<div class="message-bubble media-bubble">
            ${replyHTML}
            <img class="msg-image" src="${msg.mediaUrl}" alt="Сурат" onclick="openImageViewer('${msg.mediaUrl}')" loading="lazy"/>
        </div>`;
    } else if (msg.type === 'video' && !msg.deletedBySender && !msg.deletedByReceiver) {
        content = `<div class="message-bubble media-bubble">
            ${replyHTML}
            <video class="msg-video" controls playsinline preload="metadata">
                <source src="${msg.mediaUrl}"/>
            </video>
        </div>`;
    } else if (msg.deletedBySender || msg.deletedByReceiver) {
        content = `<div class="message-bubble deleted"><i class="fa-solid fa-ban"></i> Паём ҳазф шуд</div>`;
    } else {
        // №16 — паёми дароз
        const MAX_LEN = 300;
        const bodyText = msg.body || '';
        if (bodyText.length > MAX_LEN) {
            const shortHtml = escapeHtml(bodyText.substring(0, MAX_LEN));
            const fullHtml = escapeHtml(bodyText);
            content = `<div class="message-bubble">
                ${replyHTML}
                <span class="msg-short">${shortHtml}</span><span class="msg-full" style="display:none">${fullHtml}</span><span class="expand-btn" onclick="expandMsg(this, event)"> Бештар...</span>
            </div>`;
        } else {
            content = `<div class="message-bubble">${replyHTML}${escapeHtml(bodyText)}</div>`;
        }
    }

    const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const rSender = msg.reactionBySender || '';
    const rReceiver = msg.reactionByReceiver || '';
    let reactionsHTML = '';
    if (rSender || rReceiver) {
        reactionsHTML = `<div class="reactions-row" onclick="showReactionInfo('${escapeAttr(rSender)}','${escapeAttr(rReceiver)}','${escapeAttr(msg.sender)}','${escapeAttr(msg.receiver)}', event)">`;
        if (rSender) reactionsHTML += `<span class="reaction-badge">${rSender}</span>`;
        if (rReceiver) reactionsHTML += `<span class="reaction-badge">${rReceiver}</span>`;
        reactionsHTML += `</div>`;
    }

    let seenHTML = '';
    if (isSent && !isPending) {
        seenHTML = msg.seen
            ? '<i class="fa-solid fa-check-double seen-icon seen"></i>'
            : '<i class="fa-solid fa-check seen-icon"></i>';
    }

    const pendingIcon = isPending ? '<i class="fa-solid fa-clock pending-icon"></i>' : '';

    wrapper.innerHTML = `
        ${content}
        <div class="msg-actions">${reactionsHTML}</div>
        <div class="message-time">${pendingIcon}${seenHTML}${time}</div>
    `;

    // Контекст меню — клик
    const bubble = wrapper.querySelector('.message-bubble');
    if (bubble && !msg.deletedBySender && !msg.deletedByReceiver) {
        bubble.addEventListener('click', (e) => {
            if (e.target.closest('.reply-preview')) return;
            if (e.target.closest('.voice-play-btn')) return;
            if (e.target.closest('.voice-progress')) return;
            showInlineMenu(e, msg, wrapper);
        });
    }

    return wrapper;
}

// ========== INLINE CONTEXT MENU ==========
let activeInlineMenu = null;

function showInlineMenu(e, msg, wrapper) {
    e.stopPropagation();
    closeInlineMenu();

    const isSent = msg.sender === myUsername;
    const menu = document.createElement('div');
    menu.className = `inline-menu ${isSent ? 'sent-menu' : 'received-menu'}`;
    menu.id = 'inlineMenu_' + msg._id;

    const mainReactions = ['❤️', '😂', '😮', '😢', '👍'];
    let reactHtml = '<div class="inline-reactions">';
    mainReactions.forEach(r => {
        reactHtml += `<span onclick="setReactionInline('${msg._id}','${r}','${isSent ? 'sender' : 'receiver'}','${escapeAttr(msg.sender)}','${escapeAttr(msg.receiver)}')">${r}</span>`;
    });
    reactHtml += `<span class="more-reactions-btn" onclick="toggleMoreReactions(this, '${msg._id}','${isSent ? 'sender' : 'receiver'}','${escapeAttr(msg.sender)}','${escapeAttr(msg.receiver)}')">➕</span>`;
    reactHtml += '</div>';

    let actionsHtml = '<div class="inline-actions">';
    actionsHtml += `<button onclick="inlineReply('${msg._id}','${escapeAttr(msg.sender)}',\`${msg.type === 'voice' ? '🎤 Голосовой паём' : escapeHtml(msg.body || '').replace(/`/g, "'")}\`,'${msg.type || 'text'}')"><i class="fa-solid fa-reply"></i> Ҷавоб</button>`;
    actionsHtml += `<button class="del-btn" onclick="inlineDelete('${msg._id}','${escapeAttr(msg.sender)}','${escapeAttr(msg.receiver)}')"><i class="fa-solid fa-trash"></i> Ҳазф</button>`;
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
        document.addEventListener('click', closeInlineMenuOutside, { once: true });
    }, 50);
}

function closeInlineMenu() {
    if (activeInlineMenu) {
        activeInlineMenu.remove();
        activeInlineMenu = null;
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

async function setReactionInline(msgId, emoji, side, msgSender, msgReceiver) {
    closeInlineMenu();
    selectedMessageId = msgId;
    contextMsgSender = msgSender;
    contextMsgReceiver = msgReceiver;

    const wrapper = document.getElementById(`msg_${msgId}`);
    const isSent = wrapper && wrapper.classList.contains('sent');

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

function inlineReply(msgId, sender, text, type) {
    closeInlineMenu();
    setReply(msgId, sender, type === 'voice' ? '🎤 Голосовой паём' : text, type);
}

async function inlineDelete(msgId, msgSender, msgReceiver) {
    closeInlineMenu();
    await deleteMessage(msgId, msgSender, msgReceiver);
}

// ========== SWIPE TO REPLY (mobile) — Instagram style ==========
function addSwipeReply(wrapper, msg) {
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

        // Агар вертикал бошад — ҳеҷ кор накун
        if (!isHorizontal && dy > Math.abs(dx) + 5) return;
        if (Math.abs(dx) > 8) isHorizontal = true;
        if (!isHorizontal) return;

        const isSent = msg.sender === myUsername;
        const validSwipe = isSent ? dx < -8 : dx > 8;
        if (!validSwipe) return;

        // Мулоим кашидан — resistance (resistance effect)
        const absDx = Math.min(Math.abs(dx), MAX_DRAG);
        const dampened = absDx * (1 - absDx / (MAX_DRAG * 2.5));
        const move = Math.max(0, Math.min(dampened, MAX_DRAG * 0.75));

        wrapper.style.transform = isSent ? `translateX(-${move}px)` : `translateX(${move}px)`;

        if (Math.abs(dx) > TRIGGER_THRESHOLD && !swipeTriggered) {
            swipeTriggered = true;
            showSwipeReplyIndicator(wrapper, msg);
            // Тетру вибрация (агар мавҷуд бошад)
            if (navigator.vibrate) navigator.vibrate(30);
        }
    }, { passive: true });

    wrapper.addEventListener('touchend', () => {
        // Spring-back мулоим
        wrapper.style.transition = 'transform 0.35s cubic-bezier(0.34,1.56,0.64,1)';
        wrapper.style.transform = '';
        if (swipeTriggered) {
            const text = getLastMsgText(msg);
            setReply(msg._id, msg.sender, text, msg.type || 'text');
        }
        // Reset
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
    if (el) container.appendChild(el);
}

function renderVoiceHTML(msg, replyHTML = '') {
    const dur = msg.duration && msg.duration > 0 ? formatDuration(msg.duration) : '0:00';
    const heights = [5,9,14,7,12,10,6,16,9,12,5,10,14,7,9,11,6,14,8,12];
    const waves = heights.map(h => `<span style="height:${h}px"></span>`).join('');
    return `
        <div class="message-bubble voice-bubble">
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
        // №10 — аввал scroll тамом мешавад, баъд highlight
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
    if (!currentChat) return;
    autoResize(document.getElementById('messageInput'));
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
    if (!body || !currentChat) return;
    input.value = '';
    input.style.height = 'auto';

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

    // №8 — гиранда огоҳ кун
    if (currentChat) socket.emit('voiceRecording', { sender: myUsername, receiver: currentChat });

    // Input панелро пинҳон кун
    document.getElementById('inputNormal').classList.add('hidden');
    document.getElementById('recordingIndicator').classList.remove('hidden');

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        
        // Муайян кардани формат ва кодек
        let mimeType = 'audio/webm;codecs=opus';
        if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = 'audio/webm';
        if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = 'audio/ogg;codecs=opus';
        if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = '';

        // Илова кардани танзимоти фишурдасозӣ (bitrate: 16000) барои суръат дар Render
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

        // Сабтро бо қисмҳои 250 миллисониягӣ сар мекунем
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
    isRecording = false;
    if (currentChat) socket.emit('stopVoiceRecording', { sender: myUsername, receiver: currentChat });
    if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop();
    document.getElementById('inputNormal').classList.remove('hidden');
    document.getElementById('recordingIndicator').classList.add('hidden');
    audioChunks = [];
}

async function queueVoiceMessage(blob, duration) {
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

// ========== REACTION ==========
async function setReaction(emoji) {
    if (!selectedMessageId) return;
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

// №14 — Реаксия инфо панел (Instagram style)
function showReactionPanel(rSender, rReceiver, sender, receiver, msgId, isSent, event) {
    event.stopPropagation();
    const overlay = document.getElementById('reactionPanelOverlay');
    const content = document.getElementById('reactionPanelContent');
    if (!overlay || !content) return;

    const side = isSent ? 'sender' : 'receiver';
    const myReaction = isSent ? rSender : rReceiver;

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
    // Forward to panel
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
    if (rSender) html += `<span class="reaction-badge">${rSender}</span>`;
    if (rReceiver) html += `<span class="reaction-badge">${rReceiver}</span>`;
    html += `</div>`;

    if (reactionsRow) {
        reactionsRow.outerHTML = html;
    } else {
        actionsDiv.insertAdjacentHTML('afterbegin', html);
    }
}

// ========== DELETE ==========
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

// ========== SOCKET EVENTS ==========
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
    }, 35000);
});

socket.on('userStopVoiceRecording', (data) => {
    clearTimeout(window['voiceClear_' + data.sender]);
    delete typingTimers[data.sender];
    if (currentChat === data.sender) updateChatStatus(data.sender);
    renderUsers(allUsers);
});

socket.on('newMessage', (msg) => {
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
        // №12 — Уведомление
        const notifText = getLastMsgText(msg);
        const senderAvatar = userAvatars[msg.sender] || '';
        showPushNotification(msg.sender, notifText, senderAvatar);
    }
    // Охирин паём навсозӣ + тартиб
    const chatPartner = msg.sender === myUsername ? msg.receiver : msg.sender;
    const msgText = getLastMsgText(msg);
    const isBold = msg.sender !== myUsername && currentChat !== msg.sender;
    updateLastMsg(chatPartner, msgText, isBold, msg.timestamp);
    // Кэш
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
    // Тартиб навсозӣ + notification
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
    // Рӯйхатро дубора тартиб деҳ
    renderUsers(allUsers);
}
