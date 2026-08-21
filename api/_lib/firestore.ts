import { Firestore } from '@google-cloud/firestore'
import { getServerConfig, type ServerConfig } from './server-config.js'

export function createFirestoreClient(config: ServerConfig): Firestore {
  return new Firestore({
    projectId: config.firestoreProjectId,
    credentials: {
      client_email: config.firestoreCredentials.clientEmail,
      private_key: config.firestoreCredentials.privateKey,
    },
  })
}

let firestoreClient: Firestore | undefined

export function getFirestoreClient(): Firestore {
  return firestoreClient ??= createFirestoreClient(getServerConfig())
}
