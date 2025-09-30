import { BrowserOAuthClient } from '@atproto/oauth-client-browser'

let oauthClient = null
let currentSession = null

// Initialize the OAuth client
export async function initAuthClient() {
  if (oauthClient) return oauthClient

  // Use the load method for public clients
  oauthClient = await BrowserOAuthClient.load({
    clientId: window.location.origin + '/client-metadata.json',
    handleResolver: 'https://bsky.social',
  })

  // Try to restore existing session
  try {
    const result = await oauthClient.init()
    if (result) {
      currentSession = result.session
    }
  } catch (err) {
    console.warn('Failed to restore session:', err)
  }

  return oauthClient
}

// Start the login flow
export async function login(handle) {
  const client = await initAuthClient()

  try {
    // This will redirect the user and handle the callback
    await client.signIn(handle, {
      state: 'login',
    })
  } catch (err) {
    console.error('Sign in error:', err)
    throw err
  }
}

// Handle OAuth callback - this is now automatic with the new API
export async function handleCallback() {
  // The new API handles callbacks automatically via init()
  // Just check if we have a session after init
  return currentSession !== null
}

// Logout
export async function logout() {
  // Clear IndexedDB databases used by the OAuth client
  const dbNames = ['oauth-client', '@atproto-oauth-client', 'atproto-oauth-client']

  for (const dbName of dbNames) {
    try {
      const deleteRequest = indexedDB.deleteDatabase(dbName)
      await new Promise((resolve, reject) => {
        deleteRequest.onsuccess = resolve
        deleteRequest.onerror = reject
        deleteRequest.onblocked = resolve // Resolve even if blocked
      })
      console.log(`Deleted database: ${dbName}`)
    } catch (err) {
      console.warn(`Failed to delete database ${dbName}:`, err)
    }
  }

  currentSession = null
  oauthClient = null

  // Small delay to ensure IndexedDB deletion completes
  setTimeout(() => {
    window.location.reload()
  }, 100)
}

// Get current session
export function getSession() {
  return currentSession
}

// Check if user is logged in
export function isLoggedIn() {
  return currentSession !== null
}