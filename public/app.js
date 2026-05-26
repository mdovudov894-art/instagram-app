// ========== VARIABLES ==========
let token = localStorage.getItem('token');
let myUsername = localStorage.getItem('username');
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

// Socket с токеном
const socket = io({ auth: { token } });

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
            return true;
        }
        return false;
    } catch (err) {
        return false;
    }
}

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
        localStorage.setItem('token', token);
        localStorage.setItem('username', myUsername);
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
    allUsers = [];
    onlineUsers = new Set();
    stopCurrentAudio();
    socket.disconnect();
    document.getElementById('authScreen').classList.remove('hidden');
    document.getElementById('mainApp').classList.add('hidden');
}

function showApp() {
    document.getElementById('authScreen').classList.add('hidden');
    document.getElementById('mainApp').classList.remove('hidden');
    document.getElementById('myUsername').textContent = myUsername;
    if (!socket.connected) socket.connect();
    loadUsers();
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
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + token
            },
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
        hideChangeUsername();
        showToast('Ном бо муваффақият иваз шуд!');
        socket.emit('changeUsername', { oldUsername, newUsername: myUsername });
        socket.auth.token = token;
        loadUsers();
    } catch (err) {
        errorEl.textContent = 'Хатогӣ баромад!';
    }
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
            renderUsers(allUsers);
        }
    } catch (err) {
        console.log('Хатогӣ:', err);
    }
}

function renderUsers(users) {
    const list = document.getElementById('usersList');
    list.innerHTML = '';
    users.forEach(user => {
        const isUnread = unreadMessages[user.username] > 0;
        const isOnline = onlineUsers.has(user.username);
        const isTypingNow = typingTimers[user.username] === 'typing';
        const div = document.createElement('div');
        div.className = 'user-item' + (currentChat === user.username ? ' active' : '');
        div.onclick = () => openChat(user.username);
        div.innerHTML = `
            <div class="user-avatar-wrap">
                <div class="user-avatar">${user.username[0].toUpperCase()}</div>
                ${isOnline ? '<div class="online-dot"></div>' : ''}
            </div>
            <div class="user-info">
                <div class="name">${escapeHtml(user.username)}</div>
                <div class="last-msg ${isUnread ? 'unread-msg' : ''}" id="lastMsg_${user.username}">
                    ${isTypingNow ? '<span class="typing-dots"><span></span><span></span><span></span></span>' : '...'}
                </div>
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
    currentChat = username;
    unreadMessages[username] = 0;
    hasMoreMessages = true;
    oldestTimestamp = null;
    stopCurrentAudio();

    document.getElementById('chatDefault').classList.add('hidden');
    document.getElementById('chatScreen').classList.remove('hidden');
    document.getElementById('chatUsername').textContent = username;
    document.getElementById('chatAvatar').textContent = username[0].toUpperCase();
    document.getElementById('chatArea').classList.add('open');
    updateChatStatus(username);
    cancelReply();
    renderUsers(allUsers);
    await loadMessages();

    const container = document.getElementById('messagesContainer');
    container.onscroll = () => {
        if (container.scrollTop < 80 && !isLoadingMore && hasMoreMessages) {
            loadMoreMessages();
        }
    };
}

function updateChatStatus(username) {
    const statusEl = document.getElementById('chatStatus');
    if (!statusEl) return;
    if (typingTimers[username] === 'typing') {
        statusEl.innerHTML = '<span class="typing-dots"><span></span><span></span><span></span></span> нависонда истодааст...';
        statusEl.className = 'chat-status typing';
    } else if (onlineUsers.has(username)) {
        statusEl.textContent = 'онлайн';
        statusEl.className = 'chat-status online';
    } else {
        statusEl.textContent = '';
        statusEl.className = 'chat-status';
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
    container.onscroll = null;
}

async function loadMessages() {
    try {
        const res = await fetch(`/api/messages/${currentChat}`, {
            headers: { 'Authorization': 'Bearer ' + token }
        });
        const messages = await res.json();
        const container = document.getElementById('messagesContainer');
        container.innerHTML = '';

        if (messages.length < 30) hasMoreMessages = false;
        if (messages.length > 0) oldestTimestamp = messages[0].timestamp;

        messages.forEach(msg => renderMessage(msg));

        // Железно поён
        requestAnimationFrame(() => {
            container.scrollTop = container.scrollHeight;
        });

        messages.forEach(msg => {
            if (msg.sender === currentChat && !msg.seen) markSeen(msg._id);
        });
    } catch (err) {
        console.log('Хатогӣ:', err);
    }
}

async function loadMoreMessages() {
    if (!hasMoreMessages || !oldestTimestamp || !currentChat) return;
    isLoadingMore = true;

    const container = document.getElementById('messagesContainer');
    const prevScrollHeight = container.scrollHeight;
    const prevScrollTop = container.scrollTop;

    try {
        const res = await fetch(`/api/messages/${currentChat}?before=${encodeURIComponent(oldestTimestamp)}`, {
            headers: { 'Authorization': 'Bearer ' + token }
        });
        const messages = await res.json();

        if (messages.length === 0) {
            hasMoreMessages = false;
            isLoadingMore = false;
            return;
        }

        if (messages.length < 30) hasMoreMessages = false;
        oldestTimestamp = messages[0].timestamp;

        // Боло илова кун
        const fragment = document.createDocumentFragment();
        messages.forEach(msg => {
            if (!document.getElementById(`msg_${msg._id}`)) {
                const el = createMessageElement(msg);
                if (el) fragment.appendChild(el);
            }
        });

        container.insertBefore(fragment, container.firstChild);

        // Скролл position нигоҳ дор — дар ҳамон ҷой бимон
        requestAnimationFrame(() => {
            container.scrollTop = container.scrollHeight - prevScrollHeight + prevScrollTop;
        });

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

    let replyHTML = '';
    if (msg.replyTo && msg.replyTo._id) {
        const replyText = msg.replyTo.type === 'voice' ? '🎤 Голос' : escapeHtml(msg.replyTo.body || '').substring(0, 40);
        replyHTML = `
            <div class="reply-preview" onclick="scrollToMsg('${msg.replyTo._id}')">
                <span class="reply-name">${escapeHtml(msg.replyTo.sender)}</span>
                <span class="reply-text">${replyText}</span>
            </div>`;
    }

    let content = '';
    if (msg.type === 'voice' && !msg.deletedBySender && !msg.deletedByReceiver) {
        content = renderVoiceHTML(msg, replyHTML);
    } else if (msg.deletedBySender || msg.deletedByReceiver) {
        content = `<div class="message-bubble deleted"><i class="fa-solid fa-ban"></i> Паём ҳазф шуд</div>`;
    } else {
        content = `<div class="message-bubble">${replyHTML}${escapeHtml(msg.body)}</div>`;
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

    wrapper.addEventListener('click', (e) => {
        if (e.target.closest('.reply-preview')) return;
        if (e.target.closest('.voice-play-btn')) return;
        if (e.target.closest('.reactions-row')) return;
        if (msg.deletedBySender || msg.deletedByReceiver) return;
        showContextMenu(e, msg);
    });

    return wrapper;
}

function renderMessage(msg, isPending = false) {
    if (document.getElementById(`msg_${msg._id}`)) return;
    const container = document.getElementById('messagesContainer');
    const el = createMessageElement(msg, isPending);
    if (el) container.appendChild(el);
}

function renderVoiceHTML(msg, replyHTML = '') {
    const dur = msg.duration && msg.duration > 0 ? formatDuration(msg.duration) : '0:00';
    const heights = [7,12,17,9,15,13,8,19,12,15,7,13,17,9,12];
    const waves = heights.map(h => `<span style="height:${h}px"></span>`).join('');
    return `
        <div class="message-bubble voice-bubble">
            ${replyHTML ? `<div class="voice-reply-wrap">${replyHTML}</div>` : ''}
            <div class="voice-message">
                <button class="voice-play-btn" id="playBtn_${msg._id}"
                    onclick="toggleAudio(event, '${msg._id}', '${msg.voiceUrl}', ${msg.duration || 0})">
                    <i class="fa-solid fa-play"></i>
                </button>
                <div class="voice-waves" id="waves_${msg._id}">${waves}</div>
                <span class="voice-duration" id="dur_${msg._id}">${dur}</span>
            </div>
        </div>
    `;
}

function scrollToMsg(msgId) {
    const el = document.getElementById(`msg_${msgId}`);
    if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const bubble = el.querySelector('.message-bubble');
        if (bubble) {
            bubble.classList.add('highlight-anim');
            setTimeout(() => bubble.classList.remove('highlight-anim'), 1200);
        }
    }
}

function formatDuration(seconds) {
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

// ========== CONTEXT MENU ==========
function showContextMenu(e, msg) {
    e.stopPropagation();
    contextMsgId = msg._id;
    contextMsgSender = msg.sender;
    contextMsgReceiver = msg.receiver;
    contextMsgType = msg.type;
    contextMsgBody = msg.body || '';
    selectedMessageId = msg._id;

    const menu = document.getElementById('contextMenu');
    menu.classList.remove('hidden');

    const menuW = 240;
    const menuH = 200;
    let x = e.clientX;
    let y = e.clientY;
    if (x + menuW > window.innerWidth) x = window.innerWidth - menuW - 8;
    if (y + menuH > window.innerHeight) y = window.innerHeight - menuH - 8;
    if (y < 8) y = 8;
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
}

function contextReply() {
    document.getElementById('contextMenu').classList.add('hidden');
    const text = contextMsgType === 'voice' ? '🎤 Голосовой паём' : contextMsgBody;
    setReply(contextMsgId, contextMsgSender, text, contextMsgType);
}

async function contextDelete() {
    document.getElementById('contextMenu').classList.add('hidden');
    await deleteMessage(contextMsgId, contextMsgSender, contextMsgReceiver);
}

document.addEventListener('click', (e) => {
    if (!e.target.closest('#contextMenu')) {
        document.getElementById('contextMenu').classList.add('hidden');
    }
});

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
    }, 2500);
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

// ========== SEND MESSAGE ==========
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
    cancelReply();

    const tempMsg = {
        _id: tempId,
        sender: myUsername,
        receiver: currentChat,
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
    requestAnimationFrame(() => {
        container.scrollTop = container.scrollHeight;
    });
    updateLastMsg(currentChat, body);

    try {
        const res = await fetch('/api/messages/send', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + token
            },
            body: JSON.stringify({
                receiver: currentChat,
                body,
                replyToId: currentReply ? currentReply._id : null
            })
        });
        const msg = await res.json();
        const tempEl = document.getElementById(`msg_${tempId}`);
        if (tempEl) tempEl.remove();
        renderMessage(msg);
        requestAnimationFrame(() => {
            container.scrollTop = container.scrollHeight;
        });
        socket.emit('sendMessage', { ...msg, receiver: currentChat, sender: myUsername });
    } catch (err) {
        console.log('Офлайн:', err);
    }
}

// ========== VOICE RECORDING ==========
function toggleRecording() {
    if (!isRecording) {
        startRecording();
    } else {
        stopRecording();
    }
}

async function startRecording() {
    recordingCancelled = false;
    audioChunks = [];
    recordingSeconds = 0;
    isRecording = true;

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        let mimeType = 'audio/webm;codecs=opus';
        if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = 'audio/webm';
        if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = 'audio/ogg;codecs=opus';
        if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = '';

        const options = mimeType ? { mimeType } : {};
        mediaRecorder = new MediaRecorder(stream, options);

        mediaRecorder.ondataavailable = e => {
            if (e.data && e.data.size > 0) audioChunks.push(e.data);
        };

        mediaRecorder.onstop = async () => {
            stream.getTracks().forEach(t => t.stop());
            clearInterval(recordingTimer);
            isRecording = false;
            const finalSeconds = recordingSeconds;
            if (recordingCancelled) { audioChunks = []; return; }
            if (audioChunks.length === 0) { showToast('Овоз сабт нашуд!'); return; }
            const actualMime = mediaRecorder.mimeType || 'audio/webm';
            const blob = new Blob(audioChunks, { type: actualMime });
            await sendVoiceMessage(blob, finalSeconds);
        };

        mediaRecorder.start(250);
        document.getElementById('voiceBtn').classList.add('recording');
        document.getElementById('recordingIndicator').classList.remove('hidden');
        document.getElementById('recordingTime').textContent = '0:00';

        recordingTimer = setInterval(() => {
            recordingSeconds++;
            document.getElementById('recordingTime').textContent = formatDuration(recordingSeconds);
        }, 1000);
    } catch (err) {
        isRecording = false;
        showToast('Микрофон дастрас нест!');
    }
}

function stopRecording() {
    if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop();
    isRecording = false;
    document.getElementById('voiceBtn').classList.remove('recording');
    document.getElementById('recordingIndicator').classList.add('hidden');
}

function cancelRecording() {
    recordingCancelled = true;
    clearInterval(recordingTimer);
    isRecording = false;
    if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop();
    document.getElementById('voiceBtn').classList.remove('recording');
    document.getElementById('recordingIndicator').classList.add('hidden');
    audioChunks = [];
}

async function sendVoiceMessage(blob, duration) {
    try {
        const formData = new FormData();
        formData.append('audio', blob, 'voice.webm');
        formData.append('receiver', currentChat);
        formData.append('duration', duration);
        if (replyTo) formData.append('replyToId', replyTo._id);
        cancelReply();

        const res = await fetch('/api/messages/voice', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + token },
            body: formData
        });
        const msg = await res.json();
        renderMessage(msg);
        const container = document.getElementById('messagesContainer');
        requestAnimationFrame(() => {
            container.scrollTop = container.scrollHeight;
        });
        socket.emit('sendMessage', { ...msg, receiver: currentChat, sender: myUsername });
        updateLastMsg(currentChat, '🎤 Голосовой паём');
    } catch (err) {
        showToast('Голосовой паём фиристода нашуд!');
    }
}

// ========== AUDIO PLAYER ==========
function stopCurrentAudio() {
    if (currentAudio) {
        currentAudio.pause();
        // UI reset
        if (currentAudioMsgId) {
            const btn = document.getElementById(`playBtn_${currentAudioMsgId}`);
            const icon = btn ? btn.querySelector('i') : null;
            const waves = document.getElementById(`waves_${currentAudioMsgId}`);
            if (icon) icon.className = 'fa-solid fa-play';
            if (waves) waves.classList.remove('playing');
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

    // Агар ҳамин паём аллакай кор мекунад
    if (currentAudioMsgId === msgId && currentAudio) {
        if (!currentAudio.paused) {
            // Пауза
            currentAudio.pause();
            if (icon) icon.className = 'fa-solid fa-play';
            if (waves) waves.classList.remove('playing');
        } else {
            // Аз ҳамон ҷо идома деҳ
            currentAudio.play().catch(() => {});
            if (icon) icon.className = 'fa-solid fa-pause';
            if (waves) waves.classList.add('playing');
        }
        return;
    }

    // Агар дигар паём кор мекунад — бандаш
    if (currentAudio) {
        stopCurrentAudio();
    }

    // Нав Audio объект созед
    const audio = new Audio(voiceUrl);
    currentAudio = audio;
    currentAudioMsgId = msgId;

    if (icon) icon.className = 'fa-solid fa-pause';
    if (waves) waves.classList.add('playing');

    // Метаданных бор шуд — давомнокиро нишон деҳ
    audio.onloadedmetadata = () => {
        if (audio.duration && isFinite(audio.duration)) {
            if (durEl) durEl.textContent = formatDuration(audio.duration);
        }
    };

    // Вақти воқеиро нишон деҳ
    audio.ontimeupdate = () => {
        if (durEl && isFinite(audio.currentTime)) {
            durEl.textContent = formatDuration(audio.currentTime);
        }
    };

    audio.onended = () => {
        if (icon) icon.className = 'fa-solid fa-play';
        if (waves) waves.classList.remove('playing');
        if (durEl) durEl.textContent = formatDuration(duration || 0);
        currentAudio = null;
        currentAudioMsgId = null;
    };

    audio.onerror = () => {
        if (icon) icon.className = 'fa-solid fa-play';
        if (waves) waves.classList.remove('playing');
        currentAudio = null;
        currentAudioMsgId = null;
        showToast('Голосовой паём бор карда нашуд!');
    };

    audio.play().catch(() => {
        if (icon) icon.className = 'fa-solid fa-play';
        if (waves) waves.classList.remove('playing');
        currentAudio = null;
        currentAudioMsgId = null;
    });
}

// ========== REACTION ==========
async function setReaction(emoji) {
    if (!selectedMessageId) return;
    document.getElementById('contextMenu').classList.add('hidden');

    const wrapper = document.getElementById(`msg_${selectedMessageId}`);
    const isSent = wrapper && wrapper.classList.contains('sent');
    const side = isSent ? 'sender' : 'receiver';

    try {
        const res = await fetch(`/api/messages/reaction/${selectedMessageId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + token
            },
            body: JSON.stringify({ reaction: emoji, side })
        });
        const updatedMsg = await res.json();
        updateReactionInUI(updatedMsg);

        socket.emit('reaction', {
            _id: selectedMessageId,
            reaction: emoji,
            side,
            sender: myUsername,
            receiver: currentChat,
            reactionBySender: updatedMsg.reactionBySender,
            reactionByReceiver: updatedMsg.reactionByReceiver,
            msgSender: updatedMsg.sender,
            msgReceiver: updatedMsg.receiver
        });
    } catch (err) {
        console.log('Хатогӣ:', err);
    }
}

function showReactionInfo(rSender, rReceiver, sender, receiver, event) {
    event.stopPropagation();
    let msg = '';
    if (rSender) msg += `${sender}: ${rSender}\n`;
    if (rReceiver) msg += `${receiver}: ${rReceiver}`;
    showToast(msg.trim());
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

    try {
        const res = await fetch(`/api/messages/${msgId}`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + token
            },
            body: JSON.stringify({ deleteFor })
        });
        const data = await res.json();

        const wrapper = document.getElementById(`msg_${msgId}`);
        if (wrapper) wrapper.remove();

        socket.emit('deleteMessage', {
            _id: msgId,
            sender: msgSender,
            receiver: msgReceiver,
            deletedBy: myUsername,
            deletedFor: data.deletedFor
        });
    } catch (err) {
        showToast('Ҳазф карда нашуд!');
    }
}

// ========== SOCKET EVENTS ==========
socket.on('connect_error', (err) => {
    console.log('Socket хатогӣ:', err.message);
});

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

socket.on('newMessage', (msg) => {
    if (msg.sender === myUsername && document.getElementById(`msg_${msg._id}`)) return;

    if (currentChat === msg.sender || currentChat === msg.receiver) {
        renderMessage(msg);
        const container = document.getElementById('messagesContainer');
        requestAnimationFrame(() => {
            container.scrollTop = container.scrollHeight;
        });
        if (msg.sender === currentChat) markSeen(msg._id);
    } else if (msg.sender !== myUsername) {
        unreadMessages[msg.sender] = (unreadMessages[msg.sender] || 0) + 1;
        renderUsers(allUsers);
    }

    if (msg.sender !== myUsername) {
        updateLastMsg(msg.sender, msg.type === 'voice' ? '🎤 Голосовой паём' : msg.body, currentChat !== msg.sender);
    }
});

socket.on('reactionUpdate', (data) => {
    updateReactionInUI({
        _id: data._id,
        reactionBySender: data.reactionBySender,
        reactionByReceiver: data.reactionByReceiver,
        sender: data.msgSender,
        receiver: data.msgReceiver
    });
});

socket.on('messageDeleted', (data) => {
    const wrapper = document.getElementById(`msg_${data._id}`);
    if (!wrapper) return;
    if (data.deletedFor === 'all') {
        wrapper.remove();
    } else if (data.deletedFor === 'me') {
        if (myUsername === data.deletedBy) wrapper.remove();
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

// ========== HELPERS ==========
function updateLastMsg(username, text, isBold = false) {
    const el = document.getElementById(`lastMsg_${username}`);
    if (el) {
        el.innerHTML = escapeHtml(text);
        if (isBold) el.classList.add('unread-msg');
        else el.classList.remove('unread-msg');
    }
}