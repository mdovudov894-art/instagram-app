const socket = io();

let token = null;
let myUsername = null;
let currentChat = null;
let allUsers = [];
let mediaRecorder = null;
let audioChunks = [];
let recordingCancelled = false;
let recordingTimer = null;
let recordingSeconds = 0;
let selectedMessageId = null;
let isRecording = false;

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
        showApp();
    } catch (err) {
        errorEl.textContent = 'Хатогӣ баромад!';
    }
}

function logout() {
    token = null;
    myUsername = null;
    currentChat = null;
    allUsers = [];
    document.getElementById('authScreen').classList.remove('hidden');
    document.getElementById('mainApp').classList.add('hidden');
}

function showApp() {
    document.getElementById('authScreen').classList.add('hidden');
    document.getElementById('mainApp').classList.remove('hidden');
    document.getElementById('myUsername').textContent = myUsername;
    socket.emit('join', myUsername);
    loadUsers();
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
        const div = document.createElement('div');
        div.className = 'user-item' + (currentChat === user.username ? ' active' : '');
        div.onclick = () => openChat(user.username);
        div.innerHTML = `
            <div class="user-avatar">${user.username[0].toUpperCase()}</div>
            <div class="user-info">
                <div class="name">${user.username}</div>
                <div class="last-msg" id="lastMsg_${user.username}">...</div>
            </div>
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
    document.getElementById('chatDefault').classList.add('hidden');
    document.getElementById('chatScreen').classList.remove('hidden');
    document.getElementById('chatUsername').textContent = username;
    document.getElementById('chatAvatar').textContent = username[0].toUpperCase();
    document.getElementById('chatArea').classList.add('open');
    renderUsers(allUsers);
    await loadMessages();
}

function goBack() {
    document.getElementById('chatArea').classList.remove('open');
    document.getElementById('chatScreen').classList.add('hidden');
    document.getElementById('chatDefault').classList.remove('hidden');
    currentChat = null;
}

async function loadMessages() {
    try {
        const res = await fetch(`/api/messages/${currentChat}`, {
            headers: { 'Authorization': 'Bearer ' + token }
        });
        const messages = await res.json();
        const container = document.getElementById('messagesContainer');
        container.innerHTML = '';
        messages.forEach(msg => renderMessage(msg));
        container.scrollTop = container.scrollHeight;
    } catch (err) {
        console.log('Хатогӣ:', err);
    }
}

function isDeletedForMe(msg) {
    if (msg.sender === myUsername && msg.deletedBySender) return true;
    if (msg.receiver === myUsername && msg.deletedByReceiver) return true;
    return false;
}

function renderMessage(msg) {
    const container = document.getElementById('messagesContainer');
    const isSent = msg.sender === myUsername;

    if (isDeletedForMe(msg)) return;
    if (document.getElementById(`msg_${msg._id}`)) return;

    const wrapper = document.createElement('div');
    wrapper.className = `message-wrapper ${isSent ? 'sent' : 'received'}`;
    wrapper.id = `msg_${msg._id}`;

    let content = '';
    if (msg.type === 'voice' && !msg.deletedBySender) {
        content = renderVoiceHTML(msg);
    } else if (msg.deletedBySender) {
        content = `<div class="message-bubble deleted"><i>Паём ҳазф шуд</i></div>`;
    } else {
        content = `<div class="message-bubble" ondblclick="showReactionPicker('${msg._id}', event)">${escapeHtml(msg.body)}</div>`;
    }

    const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const rSender = msg.reactionBySender || '';
    const rReceiver = msg.reactionByReceiver || '';
    let reactionsHTML = '';
    if (rSender || rReceiver) {
        reactionsHTML = `<div class="reactions-row" onclick="showReactionInfo('${rSender}','${rReceiver}','${msg.sender}','${msg.receiver}', event)">`;
        if (rSender) reactionsHTML += `<span class="reaction-badge">${rSender}</span>`;
        if (rReceiver) reactionsHTML += `<span class="reaction-badge">${rReceiver}</span>`;
        reactionsHTML += `</div>`;
    }

    wrapper.innerHTML = `
        ${content}
        ${reactionsHTML}
        <div class="message-time">${time}</div>
    `;

    wrapper.querySelector('.message-time').addEventListener('dblclick', (e) => {
        e.stopPropagation();
        deleteMessage(msg._id, msg.sender, msg.receiver);
    });

    container.appendChild(wrapper);
}

function renderVoiceHTML(msg) {
    const dur = msg.duration && msg.duration > 0 ? formatDuration(msg.duration) : '0:00';
    const heights = [10,16,22,14,20,18,12,24,16,20,10,18,22,14,16];
    const waves = heights.map(h => `<span style="height:${h}px"></span>`).join('');
    return `
        <div class="message-bubble" style="padding:0" ondblclick="showReactionPicker('${msg._id}', event)">
            <div class="voice-message">
                <button class="voice-play-btn" id="playBtn_${msg._id}" onclick="playVoice(event, '${msg._id}', '${msg.voiceUrl}', ${msg.duration || 0})">
                    <i class="fa-solid fa-play"></i>
                </button>
                <div class="voice-waves" id="waves_${msg._id}">${waves}</div>
                <span class="voice-duration" id="dur_${msg._id}">${dur}</span>
            </div>
        </div>
    `;
}

function formatDuration(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(text));
    return div.innerHTML;
}

// ========== SEND MESSAGE ==========
async function sendMessage() {
    const input = document.getElementById('messageInput');
    const body = input.value.trim();
    if (!body || !currentChat) return;
    input.value = '';
    try {
        const res = await fetch('/api/messages/send', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + token
            },
            body: JSON.stringify({ receiver: currentChat, body })
        });
        const msg = await res.json();
        renderMessage(msg);
        document.getElementById('messagesContainer').scrollTop = 999999;
        socket.emit('sendMessage', { ...msg, receiver: currentChat });
        updateLastMsg(currentChat, body);
    } catch (err) {
        console.log('Хатогӣ:', err);
    }
}

// ========== VOICE ==========
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
        if (!MediaRecorder.isTypeSupported(mimeType)) {
            mimeType = 'audio/webm';
        }
        if (!MediaRecorder.isTypeSupported(mimeType)) {
            mimeType = 'audio/ogg;codecs=opus';
        }
        if (!MediaRecorder.isTypeSupported(mimeType)) {
            mimeType = '';
        }

        const options = mimeType ? { mimeType } : {};
        mediaRecorder = new MediaRecorder(stream, options);

        mediaRecorder.ondataavailable = e => {
            if (e.data && e.data.size > 0) {
                audioChunks.push(e.data);
            }
        };

        mediaRecorder.onstop = async () => {
            stream.getTracks().forEach(t => t.stop());
            clearInterval(recordingTimer);
            isRecording = false;
            const finalSeconds = recordingSeconds;

            if (recordingCancelled) {
                audioChunks = [];
                return;
            }

            if (audioChunks.length === 0) {
                alert('Овоз сабт нашуд!');
                return;
            }

            const actualMime = mediaRecorder.mimeType || 'audio/webm';
            const blob = new Blob(audioChunks, { type: actualMime });
            console.log('Blob size:', blob.size, 'type:', actualMime);
            await sendVoiceMessage(blob, finalSeconds);
        };

        // Ҳар 250ms data гирифтан
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
        console.log('Микрофон хатогӣ:', err);
        alert('Микрофон дастрас нест! Браузер иҷозат диҳад.');
    }
}

function stopRecording() {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
    }
    isRecording = false;
    document.getElementById('voiceBtn').classList.remove('recording');
    document.getElementById('recordingIndicator').classList.add('hidden');
}

function cancelRecording() {
    recordingCancelled = true;
    clearInterval(recordingTimer);
    isRecording = false;
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
    }
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

        const res = await fetch('/api/messages/voice', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + token },
            body: formData
        });

        const msg = await res.json();
        renderMessage(msg);
        document.getElementById('messagesContainer').scrollTop = 999999;
        socket.emit('sendMessage', { ...msg, receiver: currentChat });
        updateLastMsg(currentChat, '🎤 Голосовой паём');
    } catch (err) {
        console.log('Хатогӣ:', err);
    }
}

function playVoice(event, msgId, voiceUrl, duration) {
    event.stopPropagation();

    const btn = document.getElementById(`playBtn_${msgId}`);
    const icon = btn ? btn.querySelector('i') : null;
    const waves = document.getElementById(`waves_${msgId}`);
    const durEl = document.getElementById(`dur_${msgId}`);

    if (icon && icon.classList.contains('fa-pause')) return;

    const audio = new Audio(voiceUrl);

    if (icon) icon.className = 'fa-solid fa-pause';
    if (waves) waves.classList.add('playing');

    let elapsed = 0;
    const timer = setInterval(() => {
        elapsed++;
        if (durEl) durEl.textContent = formatDuration(elapsed);
    }, 1000);

    audio.onended = () => {
        clearInterval(timer);
        if (icon) icon.className = 'fa-solid fa-play';
        if (waves) waves.classList.remove('playing');
        if (durEl) durEl.textContent = formatDuration(duration || elapsed);
    };

    audio.onerror = () => {
        clearInterval(timer);
        if (icon) icon.className = 'fa-solid fa-play';
        if (waves) waves.classList.remove('playing');
        alert('Голосовой паём бор карда нашуд!');
    };

    audio.play().catch(err => {
        clearInterval(timer);
        console.log('Play error:', err);
        if (icon) icon.className = 'fa-solid fa-play';
        if (waves) waves.classList.remove('playing');
    });
}

// ========== REACTION ==========
function showReactionPicker(msgId, event) {
    event.stopPropagation();
    selectedMessageId = msgId;

    const picker = document.getElementById('reactionPicker');
    picker.classList.remove('hidden');

    const x = Math.min(event.clientX, window.innerWidth - 300);
    const y = Math.max(event.clientY - 70, 10);
    picker.style.left = x + 'px';
    picker.style.top = y + 'px';
}

function showReactionInfo(rSender, rReceiver, sender, receiver, event) {
    event.stopPropagation();
    let info = '💬 Реаксияҳо:\n';
    if (rSender) info += `${sender}: ${rSender}\n`;
    if (rReceiver) info += `${receiver}: ${rReceiver}\n`;
    alert(info);
}

document.addEventListener('click', () => {
    document.getElementById('reactionPicker').classList.add('hidden');
});

async function setReaction(emoji) {
    if (!selectedMessageId) return;
    document.getElementById('reactionPicker').classList.add('hidden');

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

function updateReactionInUI(msg) {
    const wrapper = document.getElementById(`msg_${msg._id}`);
    if (!wrapper) return;

    let reactionsRow = wrapper.querySelector('.reactions-row');
    const rSender = msg.reactionBySender || '';
    const rReceiver = msg.reactionByReceiver || '';

    if (!rSender && !rReceiver) {
        if (reactionsRow) reactionsRow.remove();
        return;
    }

    let html = `<div class="reactions-row" onclick="showReactionInfo('${rSender}','${rReceiver}','${msg.sender}','${msg.receiver}', event)">`;
    if (rSender) html += `<span class="reaction-badge">${rSender}</span>`;
    if (rReceiver) html += `<span class="reaction-badge">${rReceiver}</span>`;
    html += `</div>`;

    if (reactionsRow) {
        reactionsRow.outerHTML = html;
    } else {
        const timeEl = wrapper.querySelector('.message-time');
        timeEl.insertAdjacentHTML('beforebegin', html);
    }
}

// ========== DELETE ==========
async function deleteMessage(msgId, msgSender, msgReceiver) {
    if (!confirm('Паёмро ҳазф кунем?')) return;

    try {
        await fetch(`/api/messages/${msgId}`, {
            method: 'DELETE',
            headers: { 'Authorization': 'Bearer ' + token }
        });

        const wrapper = document.getElementById(`msg_${msgId}`);
        if (wrapper) {
            if (myUsername === msgSender) {
                const bubble = wrapper.querySelector('.message-bubble');
                if (bubble) {
                    bubble.className = 'message-bubble deleted';
                    bubble.innerHTML = '<i>Паём ҳазф шуд</i>';
                    bubble.ondblclick = null;
                }
            } else {
                wrapper.remove();
            }
        }

        socket.emit('deleteMessage', {
            _id: msgId,
            sender: msgSender,
            receiver: msgReceiver,
            deletedBy: myUsername
        });
    } catch (err) {
        console.log('Хатогӣ:', err);
    }
}

// ========== SOCKET EVENTS ==========
socket.on('newMessage', (msg) => {
    if (currentChat === msg.sender || currentChat === msg.receiver) {
        renderMessage(msg);
        document.getElementById('messagesContainer').scrollTop = 999999;
    }
    const other = msg.sender === myUsername ? msg.receiver : msg.sender;
    updateLastMsg(other, msg.type === 'voice' ? '🎤 Голосовой паём' : msg.body);
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

    if (data.deletedBy === data.sender) {
        const bubble = wrapper.querySelector('.message-bubble');
        if (bubble) {
            bubble.className = 'message-bubble deleted';
            bubble.innerHTML = '<i>Паём ҳазф шуд</i>';
        }
    } else {
        if (myUsername === data.deletedBy) {
            wrapper.remove();
        }
    }
});

// ========== HELPERS ==========
function updateLastMsg(username, text) {
    const el = document.getElementById(`lastMsg_${username}`);
    if (el) el.textContent = text;
}

setInterval(loadUsers, 30000);