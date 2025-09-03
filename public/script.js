const socket = io();
let currentRoom = '';
let rooms = [];
let roomDetails = {}; // roomName -> {private, allowed}

const tabs = document.getElementById('chat-tabs');
const messages = document.getElementById('messages');
const roomTitle = document.getElementById('room-title');

// Modal elements
const roomModal = document.getElementById('room-modal');
const closeModal = document.getElementById('close-modal');
const modalRoomName = document.getElementById('modal-room-name');
const modalPrivate = document.getElementById('modal-private');
const allowedUsersDiv = document.getElementById('allowed-users-div');
const userCheckboxesDiv = document.getElementById('user-checkboxes');
const roomForm = document.getElementById('room-form');

// Manage Users modal elements
const manageUsersModal = document.getElementById('manage-users-modal');
const closeManageUsersModal = document.getElementById('close-manage-users-modal');
const manageUsersList = document.getElementById('manage-users-list');
const manageAddUserForm = document.getElementById('manage-add-user-form');
const manageAddUserSelect = document.getElementById('manage-add-user-select');

let allUsers = [];
let currentUser = null;

// Fetch all users for the modal
async function fetchAllUsers() {
  const res = await fetch('/api/users');
  if (res.ok) {
    allUsers = await res.json();
    if (currentUser) {
      allUsers = allUsers.filter(u => u !== currentUser);
    }
  }
}

// Get current user
async function fetchCurrentUser() {
  const res = await fetch('/api/me');
  if (res.ok) {
    const data = await res.json();
    currentUser = data.username;
  }
}

// Render user checkboxes
function renderUserCheckboxes() {
  userCheckboxesDiv.innerHTML = '';
  allUsers.forEach(username => {
    const id = 'usercb-' + username;
    const label = document.createElement('label');
    label.style.display = 'block';
    label.style.marginBottom = '0.2em';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = username;
    cb.id = id;
    label.appendChild(cb);
    label.appendChild(document.createTextNode(' ' + username));
    userCheckboxesDiv.appendChild(label);
  });
}

// Modal logic
async function openRoomModal() {
  modalRoomName.value = '';
  modalPrivate.checked = false;
  allowedUsersDiv.style.display = 'none';
  // Fetch users if not already loaded
  if (!currentUser) await fetchCurrentUser();
  await fetchAllUsers();
  renderUserCheckboxes();
  roomModal.hidden = false;
  setTimeout(() => modalRoomName.focus(), 100);
}

closeModal.onclick = function() {
  roomModal.hidden = true;
};
window.onclick = function(event) {
  if (event.target === roomModal) roomModal.hidden = true;
};
modalPrivate.onchange = function() {
  allowedUsersDiv.style.display = modalPrivate.checked ? 'block' : 'none';
};

roomForm.onsubmit = async function(event) {
  event.preventDefault();
  const newRoom = modalRoomName.value.trim();
  if (!newRoom || rooms.includes(newRoom)) {
    alert('Invalid or duplicate room name');
    return;
  }
  const isPrivate = modalPrivate.checked;
  let allowed = [];
  if (isPrivate) {
    allowed = Array.from(userCheckboxesDiv.querySelectorAll('input[type=checkbox]:checked')).map(cb => cb.value);
  }
  const res = await fetch('/api/rooms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: newRoom, isPrivate, allowed })
  });
  if (res.ok) {
    await fetchRooms();
    switchRoom(newRoom);
    roomModal.hidden = true;
  } else if (res.status === 409) {
    alert('Room already exists.');
  } else if (res.status === 400) {
    alert('Room name required.');
  } else if (res.status === 401) {
    alert('You are not logged in.');
    window.location.reload();
  } else {
    const errText = await res.text();
    alert('Could not create room: ' + errText);
  }
};

// Fetch rooms from server
async function fetchRooms() {
  const res = await fetch('/api/rooms');
  rooms = await res.json();
  renderTabs();
}

function renderTabs() {
  tabs.innerHTML = '';
  rooms.forEach(room => {
    const li = document.createElement('li');
    li.textContent = room;
    li.style.cursor = 'pointer';
    // Ensure switchRoom is available globally
    li.addEventListener('click', function() {
      window.switchRoom(room);
    });
    if (room === currentRoom) li.classList.add('active');
    tabs.appendChild(li);
  });
}

// Fetch room details for all rooms
async function fetchRoomDetails() {
  const res = await fetch('/api/rooms');
  if (res.ok) {
    const names = await res.json();
    // Fetch full room info
    const all = await fetch('/data/rooms.json');
    if (all.ok) {
      const allRooms = await all.json();
      roomDetails = {};
      allRooms.forEach(r => { roomDetails[r.name] = r; });
    }
  }
}

closeManageUsersModal.onclick = function() {
  manageUsersModal.hidden = true;
};
window.addEventListener('click', function(event) {
  if (event.target === manageUsersModal) manageUsersModal.hidden = true;
});

async function openManageUsersModal() {
  if (!currentRoom || !roomDetails[currentRoom] || !roomDetails[currentRoom].private) return;
  // Render current users (hide Admin)
  const origAllowed = roomDetails[currentRoom].allowed;
  // Find the creator: the user who created the room (the first non-admin in allowed, or the only user if only 1 non-admin)
  let creator = null;
  for (let i = 0; i < origAllowed.length; ++i) {
    if (origAllowed[i].toLowerCase() !== 'admin') {
      creator = origAllowed[i];
      break;
    }
  }
  // Only show non-admin users
  const allowed = origAllowed.filter(u => u.toLowerCase() !== 'admin');
  manageUsersList.innerHTML = '';
  allowed.forEach((u) => {
    if (u === creator) {
      manageUsersList.innerHTML += `<div style="margin-bottom:0.5em;"><span style="font-weight:bold;">${u}</span> <span style="font-size:0.9em;color:#888;">(creator)</span></div>`;
    } else {
      // Use event delegation for remove button to avoid inline onclick issues
      manageUsersList.innerHTML += `<div class="user-row" data-user="${u}" style="margin-bottom:0.5em;"><span>${u}</span> <button type="button" class="remove-user-btn" style="background:none;border:none;color:#F92672;font-size:1.1em;cursor:pointer;padding:0 0.3em;">❌</button></div>`;
    }
  });
  // Render add user dropdown (hide Admin)
  const addable = allUsers.filter(u => !allowed.includes(u) && u.toLowerCase() !== 'admin');
  manageAddUserSelect.innerHTML = addable.map(u => `<option value="${u}">${u}</option>`).join('');
  manageAddUserForm.style.display = addable.length > 0 ? 'flex' : 'none';
  manageAddUserSelect.disabled = addable.length === 0;
  manageAddUserForm.querySelector('button[type="submit"]').disabled = addable.length === 0;
  manageUsersModal.hidden = false;
}

// Event delegation for remove buttons (fixes non-working delete)
manageUsersList.addEventListener('click', async function(e) {
  if (e.target && e.target.classList.contains('remove-user-btn')) {
    const user = e.target.closest('.user-row').getAttribute('data-user');
    if (!user) return;
    if (!confirm(`Remove ${user} from this room?`)) return;
    const res = await fetch(`/api/rooms/${encodeURIComponent(currentRoom)}/remove-user`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user })
    });
    if (res.ok) {
      await fetchRoomDetails();
      await renderRoomUsers();
      openManageUsersModal();
    } else {
      alert(await res.text());
    }
  }
});

manageAddUserForm.onsubmit = async function(e) {
  e.preventDefault();
  const username = manageAddUserSelect.value;
  if (!username) return;
  const res = await fetch(`/api/rooms/${encodeURIComponent(currentRoom)}/add-user`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username })
  });
  if (res.ok) {
    await fetchRoomDetails();
    await renderRoomUsers();
    openManageUsersModal();
  } else {
    alert(await res.text());
  }
};

// Render users in current room (for private rooms)
async function renderRoomUsers() {
const usersDiv = document.getElementById('room-users');

if (!currentRoom || !roomDetails[currentRoom] || !roomDetails[currentRoom].private) {
  usersDiv.style.display = 'none';
  return;
}

usersDiv.style.display = 'block';
}

socket.on('chatHistory', (msgs) => {
messages.innerHTML = msgs.map(m => {
  const isMe = m.from === '<%= user %>';
  const isBroadcast = m.from === 'Broadcast';

  let classes;
  if (isBroadcast) {
    classes = 'broadcast-message';
  } else {
    classes = `bubble ${isMe ? 'me' : 'them'}`;
  }

  return `
    <div class="${classes}">
      <strong>${m.from}</strong><br>${m.text}
    </div>
  `;
}).join('');

messages.scrollTop = messages.scrollHeight;
});


socket.on('broadcast', (message) => {
  const broadcastDiv = document.createElement('div');
  broadcastDiv.className = 'broadcast-message';
  broadcastDiv.innerHTML = `<strong>BROADCAST</strong><br>${message.text}`;
  messages.appendChild(broadcastDiv);
  messages.scrollTop = messages.scrollHeight;
});

socket.on('newMessage', (m) => {
  const bubble = document.createElement('div');
  bubble.className = `bubble ${m.from === '<%= user %>' ? 'me' : 'them'}`;
  bubble.innerHTML = `<strong>${m.from}</strong><br>${m.text}`;
  messages.appendChild(bubble);
  messages.scrollTop = messages.scrollHeight;
});
async function removeRoom() {
if (!currentRoom) {
  alert('Please select a room to remove.');
  return;
}

if (confirm(`Are you sure you want to delete the room "${currentRoom}"? This cannot be undone.`)) {
  try {
    const res = await fetch(`/api/rooms/${encodeURIComponent(currentRoom)}`, {
      method: 'DELETE'
    });
  
    if (res.ok) {
      currentRoom = '';
      roomTitle.textContent = 'Select a chat';
      messages.innerHTML = '';
      await fetchRooms();
      await fetchRoomDetails();
    } else {
      alert(await res.text());
    }
  } catch (err) {
    console.error('Error removing room:', err);
    alert('Could not remove the room. Please try again.');
  }
}
}
document.addEventListener('keydown', function(event) {
  if (event.key === 'Enter') {
    sendMessage();
  }
});
function sendMessage() {
  const text = document.getElementById('message').value;
  if (text && currentRoom) {
    socket.emit('chatMessage', { room: currentRoom, text });
    document.getElementById('message').value = '';
  }
}

// Define switchRoom before assigning to window.switchRoom
async function switchRoom(room) {
    currentRoom = room;
    roomTitle.textContent = room;
    messages.innerHTML = '';
    await fetchRoomDetails();
    await renderRoomUsers();
    socket.emit('joinRoom', room);
  }
  async function injectUsername() {
  try {
    const response = await fetch('/api/me');
    
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }
  
    const data = await response.json();
  
    // Check if username exists in the response
    if (data.username) {
      const usernameElement = document.getElementById('username');
      if (usernameElement) {
        usernameElement.textContent = data.username;
      } else {
        console.warn('Element with ID "username" not found in the DOM.');
      }
    } else {
      console.warn('Username not found in the response.');
    }
  } catch (error) {
    console.error('Failed to fetch username:', error);
  }
}

injectUsername();

fetchRooms();
fetchRoomDetails();

// Make switchRoom globally accessible
window.switchRoom = switchRoom;
