import { initAuthClient, handleCallback, login, logout, isLoggedIn, getSession } from './auth.js'
import { postBlip } from './blip.js'

// Configuration
const JETSTREAM_URL = 'wss://jetstream2.us-west.bsky.network/subscribe?wantedCollections=stream.thought.blip'
const MAX_MESSAGES = 1000 // Increased to store more history
const RECONNECT_DELAY = 5000
const STORAGE_KEY = 'thoughtstream_messages'
const DID_CACHE_KEY = 'thoughtstream_did_cache'

// State
let ws = null
let messages = []
let didCache = new Map()
let reconnectTimeout = null

// Load messages from localStorage
function loadStoredMessages() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      messages = JSON.parse(stored)
      console.log(`Loaded ${messages.length} messages from storage`)
    }
  } catch (err) {
    console.warn('Failed to load stored messages:', err)
  }
}

// Save messages to localStorage
function saveMessages() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(messages))
  } catch (err) {
    console.warn('Failed to save messages:', err)
  }
}

// Load DID cache from localStorage
function loadDidCache() {
  try {
    const stored = localStorage.getItem(DID_CACHE_KEY)
    if (stored) {
      didCache = new Map(JSON.parse(stored))
      console.log(`Loaded ${didCache.size} cached DIDs`)
    }
  } catch (err) {
    console.warn('Failed to load DID cache:', err)
  }
}

// Save DID cache to localStorage
function saveDidCache() {
  try {
    localStorage.setItem(DID_CACHE_KEY, JSON.stringify([...didCache]))
  } catch (err) {
    console.warn('Failed to save DID cache:', err)
  }
}

// DOM elements
const messagesContainer = document.getElementById('messages')
const emptyState = document.getElementById('emptyState')
const authButton = document.getElementById('authButton')
const handleInput = document.getElementById('handleInput')
const loginForm = document.getElementById('loginForm')
const chatContainer = document.getElementById('chatContainer')
const chatInput = document.getElementById('chatInput')
const sendButton = document.getElementById('sendButton')
const userInfo = document.getElementById('userInfo')

// Format timestamp
function formatTimestamp(dateString) {
  const date = new Date(dateString)

  // Format: "Jan 1, 2025 at 3:45 PM"
  const options = {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  }

  return date.toLocaleString('en-US', options).replace(',', ' at')
}

// Resolve DID to handle
async function resolveDidToHandle(did) {
  if (didCache.has(did)) {
    return didCache.get(did)
  }

  try {
    const response = await fetch(`https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${did}`)
    if (response.ok) {
      const data = await response.json()
      didCache.set(did, data.handle)
      saveDidCache() // Persist to localStorage
      return data.handle
    }
  } catch (error) {
    console.error('Error resolving DID:', error)
  }

  const truncated = did.length > 20 ? `${did.substring(0, 20)}...` : did
  didCache.set(did, truncated)
  saveDidCache() // Persist to localStorage
  return truncated
}

// Render a message
function renderMessage(message) {
  const messageEl = document.createElement('div')
  messageEl.className = message.isSystem ? 'message system-message' : 'message'

  const metaEl = document.createElement('div')
  metaEl.className = 'message-meta'

  const authorEl = document.createElement('a')
  authorEl.className = 'message-author'
  authorEl.href = message.isSystem ? '#' : `https://bsky.app/profile/${message.handle}`
  authorEl.target = message.isSystem ? '_self' : '_blank'
  authorEl.textContent = message.handle
  if (message.isSystem) {
    authorEl.onclick = (e) => e.preventDefault()
  }

  const timeText = formatTimestamp(message.createdAt)
  metaEl.appendChild(authorEl)
  metaEl.appendChild(document.createTextNode(` · ${timeText}`))

  const contentEl = document.createElement('div')
  contentEl.className = 'message-content'
  contentEl.innerHTML = marked.parse(message.content)

  messageEl.appendChild(metaEl)
  messageEl.appendChild(contentEl)

  return messageEl
}

// Add a new message
async function addMessage(handle, content, createdAt, isSystem = false) {
  if (emptyState && emptyState.parentNode) {
    emptyState.remove()
  }

  const message = { handle, content, createdAt, isSystem }

  // Check for duplicates (by content and timestamp)
  const isDuplicate = messages.some(m =>
    m.content === content &&
    m.createdAt === createdAt &&
    m.handle === handle
  )

  if (isDuplicate) {
    return // Skip duplicate messages
  }

  messages.unshift(message)

  if (messages.length > MAX_MESSAGES) {
    messages.pop()
    if (messagesContainer.lastChild) {
      messagesContainer.removeChild(messagesContainer.lastChild)
    }
  }

  // Save to localStorage
  saveMessages()

  const messageEl = renderMessage(message)
  if (messagesContainer.firstChild) {
    messagesContainer.insertBefore(messageEl, messagesContainer.firstChild)
  } else {
    messagesContainer.appendChild(messageEl)
  }
}

// Handle incoming WebSocket message
async function handleMessage(data) {
  try {
    const event = JSON.parse(data)

    if (event.kind !== 'commit' || !event.commit) {
      return
    }

    const commit = event.commit
    if (commit.collection !== 'stream.thought.blip' || commit.operation === 'delete') {
      return
    }

    if (!commit.record || !commit.record.content) {
      return
    }

    const handle = await resolveDidToHandle(event.did)

    await addMessage(
      handle,
      commit.record.content,
      commit.record.createdAt || new Date().toISOString(),
      false
    )
  } catch (error) {
    console.error('Error handling message:', error)
  }
}

// Connect to WebSocket
function connect() {
  try {
    ws = new WebSocket(JETSTREAM_URL)

    ws.onopen = () => {
      console.log('Connected to Jetstream')
      addMessage('system', 'Connected to thought stream', new Date().toISOString(), true)
    }

    ws.onmessage = (event) => {
      handleMessage(event.data)
    }

    ws.onerror = (error) => {
      console.error('WebSocket error:', error)
    }

    ws.onclose = () => {
      console.log('Disconnected from Jetstream')
      addMessage('system', 'Disconnected from stream, reconnecting...', new Date().toISOString(), true)

      clearTimeout(reconnectTimeout)
      reconnectTimeout = setTimeout(connect, RECONNECT_DELAY)
    }
  } catch (error) {
    console.error('Failed to create WebSocket:', error)
    clearTimeout(reconnectTimeout)
    reconnectTimeout = setTimeout(connect, RECONNECT_DELAY)
  }
}

// Update UI based on auth state
function updateAuthUI() {
  const loggedIn = isLoggedIn()

  if (loggedIn) {
    const session = getSession()
    loginForm.style.display = 'none'
    chatContainer.style.display = 'flex'

    // Show user info
    resolveDidToHandle(session.did).then(handle => {
      userInfo.textContent = `Signed in as ${handle}`
    })
  } else {
    loginForm.style.display = 'flex'
    chatContainer.style.display = 'none'
    userInfo.textContent = ''
  }
}

// Handle login form
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault()
  const handle = handleInput.value.trim()
  if (handle) {
    authButton.disabled = true
    authButton.textContent = 'Signing in...'
    try {
      await login(handle)
    } catch (err) {
      console.error('Login failed:', err)
      authButton.disabled = false
      authButton.textContent = 'Sign In'
      alert('Login failed: ' + err.message)
    }
  }
})

// Handle logout
document.getElementById('logoutButton').addEventListener('click', async () => {
  await logout()
})

// Handle sending a blip
sendButton.addEventListener('click', async () => {
  const content = chatInput.value.trim()
  if (!content) return

  sendButton.disabled = true
  sendButton.textContent = 'Sending...'

  try {
    await postBlip(content)
    chatInput.value = ''

    // Show success feedback
    sendButton.textContent = 'Sent!'
    setTimeout(() => {
      sendButton.textContent = 'Send'
      sendButton.disabled = false
    }, 1000)
  } catch (err) {
    console.error('Failed to post blip:', err)
    alert('Failed to post: ' + err.message)
    sendButton.textContent = 'Send'
    sendButton.disabled = false
  }
})

// Allow Enter to send (Shift+Enter for new line)
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    sendButton.click()
  }
})

// Initialize
async function init() {
  // Load stored messages and DID cache
  loadStoredMessages()
  loadDidCache()

  // Render stored messages
  if (messages.length > 0) {
    if (emptyState && emptyState.parentNode) {
      emptyState.remove()
    }
    // Render in reverse order (oldest first) so they appear correctly
    for (let i = messages.length - 1; i >= 0; i--) {
      const messageEl = renderMessage(messages[i])
      messagesContainer.appendChild(messageEl)
    }
  }

  // Initialize auth client (this will auto-restore session if available)
  await initAuthClient()

  // Update UI based on session state
  updateAuthUI()

  // Connect to stream
  connect()
}

// Clean up on page unload
window.addEventListener('beforeunload', () => {
  if (ws) {
    ws.close()
  }
  clearTimeout(reconnectTimeout)
})

// Start
init()
