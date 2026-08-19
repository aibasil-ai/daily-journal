import type { Firestore } from '@google-cloud/firestore'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { EncryptedToken } from './token-crypto'

export type ConnectionStatus = 'active' | 'archived' | 'needs_reconnect'

export type UserDocument = {
  id: string
  googleSub: string
  email: string
  name: string
  picture: string
  createdAt: number
  updatedAt: number
}

export type SheetConnectionDocument = {
  id: string
  userId: string
  spreadsheetId: string
  spreadsheetName: string
  encryptedRefreshToken: EncryptedToken
  scopes: string[]
  status: ConnectionStatus
  connectionVersion: number
  createdByService: boolean
  createdAt: number
  updatedAt: number
}

export type SheetClaimDocument = {
  spreadsheetHash: string
  userId: string
  createdAt: number
}

export type OAuthAttempt = {
  state: string
  codeVerifier: string
  intent: 'sign-in' | 'reauthorize'
  expiresAt: number
  consumedAt: number | null
}

export type ProvisioningPhase =
  | 'initial_choice'
  | 'candidate_selection'
  | 'creating'
  | 'verifying'
  | 'ready_to_confirm'
  | 'completed'
  | 'failed'

export type ProvisioningAttemptDocument = {
  id: string
  userId: string
  mode: 'initial' | 'change'
  originalConnectionVersion?: number
  tempEncryptedRefreshToken?: EncryptedToken | null
  selectedSpreadsheetId?: string | null
  selectedSpreadsheetName?: string | null
  createdByService?: boolean
  status: ProvisioningPhase
  expiresAt: number
  errorCode?: string | null
  errorMessage?: string | null
  createdAt: number
  updatedAt: number
}

export type SheetSelectionTokenDocument = {
  selectionCode: string
  provisioningAttemptId: string
  spreadsheetId: string
  spreadsheetName: string
  modifiedTime: string
  expiresAt: number
  consumedAt: number | null
}

export class ConnectionStore {
  constructor(private readonly firestore: Firestore) {}

  async getOrCreateUser(profile: {
    googleSub: string
    email: string
    name: string
    picture: string
  }): Promise<UserDocument> {
    const existing = await this.getUserByGoogleSub(profile.googleSub)
    const now = Date.now()

    if (existing) {
      const updated: UserDocument = {
        ...existing,
        email: profile.email,
        name: profile.name,
        picture: profile.picture,
        updatedAt: now,
      }
      await this.firestore.collection('users').doc(existing.id).set(updated)
      return updated
    }

    const userId = randomUUID()
    const newUser: UserDocument = {
      id: userId,
      googleSub: profile.googleSub,
      email: profile.email,
      name: profile.name,
      picture: profile.picture,
      createdAt: now,
      updatedAt: now,
    }

    await this.firestore.collection('users').doc(userId).set(newUser)
    return newUser
  }

  async getUserByGoogleSub(googleSub: string): Promise<UserDocument | undefined> {
    const snapshot = await this.firestore
      .collection('users')
      .where('googleSub', '==', googleSub)
      .get()

    if (snapshot.empty) return undefined
    return snapshot.docs[0].data() as UserDocument
  }

  async getUserById(userId: string): Promise<UserDocument | undefined> {
    const snapshot = await this.firestore.collection('users').doc(userId).get()
    if (!snapshot.exists) return undefined
    return snapshot.data() as UserDocument
  }

  async findActiveConnection(userId: string): Promise<SheetConnectionDocument | undefined> {
    const snapshot = await this.firestore
      .collection('sheet_connections')
      .where('userId', '==', userId)
      .where('status', '==', 'active')
      .get()

    if (snapshot.empty) return undefined
    return snapshot.docs[0].data() as SheetConnectionDocument
  }

  async createOAuthAttempt(attempt: {
    state: string
    codeVerifier: string
    intent: 'sign-in' | 'reauthorize'
    expiresAt: number
  }): Promise<void> {
    const doc: OAuthAttempt = {
      ...attempt,
      consumedAt: null,
    }
    await this.firestore.collection('oauth_attempts').doc(attempt.state).set(doc)
  }

  async consumeOAuthAttempt(state: string, now: number = Date.now()): Promise<OAuthAttempt | undefined> {
    const docRef = this.firestore.collection('oauth_attempts').doc(state)
    return this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(docRef)
      if (!snapshot.exists) return undefined

      const data = snapshot.data() as OAuthAttempt
      if (data.consumedAt !== null || data.expiresAt <= now) return undefined

      transaction.update(docRef, { consumedAt: now })
      return data
    })
  }

  async createProvisioningAttempt(data: {
    userId: string
    mode: 'initial' | 'change'
    originalConnectionVersion?: number
    tempEncryptedRefreshToken?: EncryptedToken | null
    ttlMs: number
  }): Promise<ProvisioningAttemptDocument> {
    const id = randomUUID()
    const now = Date.now()
    const doc: ProvisioningAttemptDocument = {
      id,
      userId: data.userId,
      mode: data.mode,
      originalConnectionVersion: data.originalConnectionVersion,
      tempEncryptedRefreshToken: data.tempEncryptedRefreshToken ?? null,
      selectedSpreadsheetId: null,
      selectedSpreadsheetName: null,
      createdByService: false,
      status: 'initial_choice',
      expiresAt: now + data.ttlMs,
      errorCode: null,
      errorMessage: null,
      createdAt: now,
      updatedAt: now,
    }

    await this.firestore.collection('provisioning_attempts').doc(id).set(doc)
    return doc
  }

  async getProvisioningAttempt(
    attemptId: string,
    now: number = Date.now(),
  ): Promise<ProvisioningAttemptDocument | undefined> {
    const snapshot = await this.firestore.collection('provisioning_attempts').doc(attemptId).get()
    if (!snapshot.exists) return undefined

    const data = snapshot.data() as ProvisioningAttemptDocument
    if (data.expiresAt <= now) return undefined
    return data
  }

  async updateProvisioningAttempt(
    attemptId: string,
    update: Partial<ProvisioningAttemptDocument>,
  ): Promise<void> {
    const docRef = this.firestore.collection('provisioning_attempts').doc(attemptId)
    await docRef.update({
      ...update,
      updatedAt: Date.now(),
    })
  }

  async createSheetSelectionToken(data: {
    provisioningAttemptId: string
    spreadsheetId: string
    spreadsheetName: string
    modifiedTime: string
    ttlMs: number
  }): Promise<string> {
    const selectionCode = randomBytes(24).toString('base64url')
    const now = Date.now()
    const doc: SheetSelectionTokenDocument = {
      selectionCode,
      provisioningAttemptId: data.provisioningAttemptId,
      spreadsheetId: data.spreadsheetId,
      spreadsheetName: data.spreadsheetName,
      modifiedTime: data.modifiedTime,
      expiresAt: now + data.ttlMs,
      consumedAt: null,
    }

    await this.firestore.collection('sheet_selection_tokens').doc(selectionCode).set(doc)
    return selectionCode
  }

  async consumeSheetSelectionToken(
    selectionCode: string,
    provisioningAttemptId: string,
    now: number = Date.now(),
  ): Promise<SheetSelectionTokenDocument | undefined> {
    const docRef = this.firestore.collection('sheet_selection_tokens').doc(selectionCode)
    return this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(docRef)
      if (!snapshot.exists) return undefined

      const data = snapshot.data() as SheetSelectionTokenDocument
      if (
        data.provisioningAttemptId !== provisioningAttemptId ||
        data.consumedAt !== null ||
        data.expiresAt <= now
      ) {
        return undefined
      }

      transaction.update(docRef, { consumedAt: now })
      return data
    })
  }

  async activateConnection(data: {
    userId: string
    spreadsheetId: string
    spreadsheetName?: string
    encryptedRefreshToken: EncryptedToken
    scopes?: string[]
    createdByService?: boolean
  }): Promise<SheetConnectionDocument> {
    const hash = hashSpreadsheetId(data.spreadsheetId)
    const claimRef = this.firestore.collection('sheet_claims').doc(hash)
    const now = Date.now()

    return this.firestore.runTransaction(async (transaction) => {
      const claimSnapshot = await transaction.get(claimRef)
      if (claimSnapshot.exists) {
        const claim = claimSnapshot.data() as SheetClaimDocument
        if (claim.userId !== data.userId) {
          throw new Error('此資料表已被其他帳號連結')
        }
      }

      transaction.set(claimRef, {
        spreadsheetHash: hash,
        userId: data.userId,
        createdAt: claimSnapshot.exists ? (claimSnapshot.data() as SheetClaimDocument).createdAt : now,
      })

      const existingConnections = await this.firestore
        .collection('sheet_connections')
        .where('userId', '==', data.userId)
        .get()

      let targetConnectionDoc: SheetConnectionDocument | undefined

      for (const doc of existingConnections.docs) {
        const conn = doc.data() as SheetConnectionDocument
        if (conn.spreadsheetId === data.spreadsheetId) {
          targetConnectionDoc = {
            ...conn,
            spreadsheetName: data.spreadsheetName ?? conn.spreadsheetName,
            encryptedRefreshToken: data.encryptedRefreshToken,
            scopes: data.scopes ?? conn.scopes,
            status: 'active',
            connectionVersion: conn.connectionVersion + 1,
            createdByService: data.createdByService ?? conn.createdByService,
            updatedAt: now,
          }
          transaction.set(doc.ref, targetConnectionDoc)
        } else if (conn.status === 'active') {
          transaction.update(doc.ref, {
            status: 'archived',
            updatedAt: now,
          })
        }
      }

      if (!targetConnectionDoc) {
        const id = randomUUID()
        targetConnectionDoc = {
          id,
          userId: data.userId,
          spreadsheetId: data.spreadsheetId,
          spreadsheetName: data.spreadsheetName ?? '每日記事',
          encryptedRefreshToken: data.encryptedRefreshToken,
          scopes: data.scopes ?? [],
          status: 'active',
          connectionVersion: 1,
          createdByService: data.createdByService ?? false,
          createdAt: now,
          updatedAt: now,
        }
        transaction.set(this.firestore.collection('sheet_connections').doc(id), targetConnectionDoc)
      }

      return targetConnectionDoc
    })
  }

  async archiveAndActivateConnection(data: {
    userId: string
    targetSpreadsheetId: string
    targetSpreadsheetName?: string
    encryptedRefreshToken: EncryptedToken
    scopes?: string[]
    createdByService?: boolean
    expectedOriginalVersion: number
  }): Promise<SheetConnectionDocument> {
    const hash = hashSpreadsheetId(data.targetSpreadsheetId)
    const claimRef = this.firestore.collection('sheet_claims').doc(hash)
    const now = Date.now()

    return this.firestore.runTransaction(async (transaction) => {
      const activeConnection = await this.findActiveConnection(data.userId)
      if (
        activeConnection &&
        activeConnection.connectionVersion !== data.expectedOriginalVersion
      ) {
        throw new Error('連線版本不符，請重新整理後再試。')
      }

      const claimSnapshot = await transaction.get(claimRef)
      if (claimSnapshot.exists) {
        const claim = claimSnapshot.data() as SheetClaimDocument
        if (claim.userId !== data.userId) {
          throw new Error('此資料表已被其他帳號連結')
        }
      }

      transaction.set(claimRef, {
        spreadsheetHash: hash,
        userId: data.userId,
        createdAt: claimSnapshot.exists ? (claimSnapshot.data() as SheetClaimDocument).createdAt : now,
      })

      if (activeConnection) {
        const activeRef = this.firestore.collection('sheet_connections').doc(activeConnection.id)
        transaction.update(activeRef, {
          status: 'archived',
          updatedAt: now,
        })
      }

      const existingConnections = await this.firestore
        .collection('sheet_connections')
        .where('userId', '==', data.userId)
        .get()

      let targetConn: SheetConnectionDocument | undefined
      for (const doc of existingConnections.docs) {
        const conn = doc.data() as SheetConnectionDocument
        if (conn.spreadsheetId === data.targetSpreadsheetId) {
          targetConn = {
            ...conn,
            spreadsheetName: data.targetSpreadsheetName ?? conn.spreadsheetName,
            encryptedRefreshToken: data.encryptedRefreshToken,
            scopes: data.scopes ?? conn.scopes,
            status: 'active',
            connectionVersion: conn.connectionVersion + 1,
            createdByService: data.createdByService ?? conn.createdByService,
            updatedAt: now,
          }
          transaction.set(doc.ref, targetConn)
          break
        }
      }

      if (!targetConn) {
        const id = randomUUID()
        targetConn = {
          id,
          userId: data.userId,
          spreadsheetId: data.targetSpreadsheetId,
          spreadsheetName: data.targetSpreadsheetName ?? '每日記事',
          encryptedRefreshToken: data.encryptedRefreshToken,
          scopes: data.scopes ?? [],
          status: 'active',
          connectionVersion: 1,
          createdByService: data.createdByService ?? false,
          createdAt: now,
          updatedAt: now,
        }
        transaction.set(this.firestore.collection('sheet_connections').doc(id), targetConn)
      }

      return targetConn
    })
  }

  async markConnectionNeedsReconnect(connectionId: string): Promise<void> {
    const docRef = this.firestore.collection('sheet_connections').doc(connectionId)
    await docRef.update({
      status: 'needs_reconnect',
      updatedAt: Date.now(),
    })
  }

  async updateEncryptedToken(connectionId: string, token: EncryptedToken): Promise<void> {
    const docRef = this.firestore.collection('sheet_connections').doc(connectionId)
    await docRef.update({
      encryptedRefreshToken: token,
      updatedAt: Date.now(),
    })
  }

  async claimLegacySheet(data: {
    userId: string
    spreadsheetId: string
    spreadsheetName?: string
    encryptedRefreshToken: EncryptedToken
    scopes?: string[]
    createdByService?: boolean
  }): Promise<SheetConnectionDocument> {
    return this.activateConnection({
      ...data,
      createdByService: data.createdByService ?? false,
    })
  }

  async withSheetWriteLease<T>(connectionId: string, fn: () => Promise<T>): Promise<T> {
    const leaseId = randomBytes(16).toString('base64url')
    const leaseRef = this.firestore.collection('sheet_write_leases').doc(connectionId)
    const now = Date.now()

    await this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(leaseRef)
      if (snapshot.exists) {
        const data = snapshot.data() as { expiresAt: number }
        if (data.expiresAt > now) {
          throw new Error('目前有另一項操作正在儲存至 Google Sheet，請稍後再試。')
        }
      }

      transaction.set(leaseRef, {
        connectionId,
        leaseId,
        expiresAt: now + 30_000,
      })
    })

    try {
      return await fn()
    } finally {
      await this.firestore.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(leaseRef)
        if (snapshot.exists) {
          const data = snapshot.data() as { leaseId: string }
          if (data.leaseId === leaseId) {
            transaction.delete(leaseRef)
          }
        }
      }).catch(() => undefined)
    }
  }

  async deleteAccountData(userId: string): Promise<void> {
    const collectionsToClean = [
      'sheet_connections',
      'sessions',
      'provisioning_attempts',
    ]

    for (const colName of collectionsToClean) {
      const snapshot = await this.firestore
        .collection(colName)
        .where('userId', '==', userId)
        .get()

      const batch = this.firestore.batch()
      for (const doc of snapshot.docs) {
        batch.delete(doc.ref)
      }
      await batch.commit()
    }

    const claimsSnapshot = await this.firestore
      .collection('sheet_claims')
      .where('userId', '==', userId)
      .get()
    const claimsBatch = this.firestore.batch()
    for (const doc of claimsSnapshot.docs) {
      claimsBatch.delete(doc.ref)
    }
    await claimsBatch.commit()

    await this.firestore.collection('users').doc(userId).delete()
  }

  async cleanupExpired(now: number = Date.now()): Promise<{
    attempts: number
    leases: number
  }> {
    const expiredAttempts = await this.firestore
      .collection('oauth_attempts')
      .where('expiresAt', '<=', now)
      .get()

    const expiredProvAttempts = await this.firestore
      .collection('provisioning_attempts')
      .where('expiresAt', '<=', now)
      .get()

    const expiredTokens = await this.firestore
      .collection('sheet_selection_tokens')
      .where('expiresAt', '<=', now)
      .get()

    const batch = this.firestore.batch()
    for (const doc of expiredAttempts.docs) batch.delete(doc.ref)
    for (const doc of expiredProvAttempts.docs) batch.delete(doc.ref)
    for (const doc of expiredTokens.docs) batch.delete(doc.ref)
    await batch.commit()

    const expiredLeases = await this.firestore
      .collection('sheet_write_leases')
      .where('expiresAt', '<=', now)
      .get()

    const leaseBatch = this.firestore.batch()
    for (const doc of expiredLeases.docs) leaseBatch.delete(doc.ref)
    await leaseBatch.commit()

    return {
      attempts: expiredAttempts.size + expiredProvAttempts.size + expiredTokens.size,
      leases: expiredLeases.size,
    }
  }
}

export function hashSpreadsheetId(id: string): string {
  return createHash('sha256').update(id.trim()).digest('hex')
}
