import { Agent } from '@atproto/api'
import { getSession } from './auth.js'

// Post a blip to the thought stream
export async function postBlip(content) {
  const session = getSession()
  if (!session) {
    throw new Error('Not authenticated')
  }

  const agent = new Agent(session)

  // Create the blip record
  const record = {
    $type: 'stream.thought.blip',
    content: content.trim(),
    createdAt: new Date().toISOString(),
  }

  // Post to the user's repository
  const response = await agent.com.atproto.repo.createRecord({
    repo: session.did,
    collection: 'stream.thought.blip',
    record,
  })

  return response.data
}