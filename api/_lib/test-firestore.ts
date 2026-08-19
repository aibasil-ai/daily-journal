import type { Firestore } from '@google-cloud/firestore'

export class FakeDocumentSnapshot {
  constructor(
    public readonly id: string,
    public readonly ref: FakeDocumentReference,
    private readonly _data: Record<string, unknown> | undefined,
  ) {}

  get exists(): boolean {
    return this._data !== undefined
  }

  data(): Record<string, unknown> | undefined {
    return this._data ? JSON.parse(JSON.stringify(this._data)) : undefined
  }
}

export class FakeDocumentReference {
  constructor(
    public readonly id: string,
    public readonly collection: FakeCollectionReference,
  ) {}

  async get(): Promise<FakeDocumentSnapshot> {
    return this.collection.store.getDoc(this.collection.name, this.id, this)
  }

  async set(data: Record<string, unknown>): Promise<void> {
    this.collection.store.setDoc(this.collection.name, this.id, data)
  }

  async update(data: Record<string, unknown>): Promise<void> {
    this.collection.store.updateDoc(this.collection.name, this.id, data)
  }

  async delete(): Promise<void> {
    this.collection.store.deleteDoc(this.collection.name, this.id)
  }
}

export class FakeQuerySnapshot {
  constructor(public readonly docs: FakeDocumentSnapshot[]) {}

  get empty(): boolean {
    return this.docs.length === 0
  }

  get size(): number {
    return this.docs.length
  }
}

export class FakeCollectionReference {
  private filters: Array<{ field: string; op: string; value: unknown }> = []

  constructor(
    public readonly name: string,
    public readonly store: InMemoryFirestoreData,
  ) {}

  doc(id: string): FakeDocumentReference {
    return new FakeDocumentReference(id, this)
  }

  where(field: string, op: string, value: unknown): FakeCollectionReference {
    const query = new FakeCollectionReference(this.name, this.store)
    query.filters = [...this.filters, { field, op, value }]
    return query
  }

  async get(): Promise<FakeQuerySnapshot> {
    return this.store.queryDocs(this.name, this.filters)
  }
}

export class FakeWriteBatch {
  private operations: Array<() => void> = []

  constructor(_store?: InMemoryFirestoreData) {}

  set(docRef: FakeDocumentReference, data: Record<string, unknown>): this {
    this.operations.push(() => docRef.set(data))
    return this
  }

  update(docRef: FakeDocumentReference, data: Record<string, unknown>): this {
    this.operations.push(() => docRef.update(data))
    return this
  }

  delete(docRef: FakeDocumentReference): this {
    this.operations.push(() => docRef.delete())
    return this
  }

  async commit(): Promise<void> {
    for (const op of this.operations) op()
  }
}

export class FakeTransaction {
  constructor(private readonly store: InMemoryFirestoreData) {}

  async get(docRef: FakeDocumentReference): Promise<FakeDocumentSnapshot> {
    return docRef.get()
  }

  set(docRef: FakeDocumentReference, data: Record<string, unknown>): this {
    this.store.setDoc(docRef.collection.name, docRef.id, data)
    return this
  }

  update(docRef: FakeDocumentReference, data: Record<string, unknown>): this {
    this.store.updateDoc(docRef.collection.name, docRef.id, data)
    return this
  }

  delete(docRef: FakeDocumentReference): this {
    this.store.deleteDoc(docRef.collection.name, docRef.id)
    return this
  }
}

export class InMemoryFirestoreData {
  private readonly collections = new Map<string, Map<string, Record<string, unknown>>>()

  getDoc(collectionName: string, id: string, ref: FakeDocumentReference): FakeDocumentSnapshot {
    const col = this.collections.get(collectionName)
    const data = col?.get(id)
    return new FakeDocumentSnapshot(id, ref, data)
  }

  setDoc(collectionName: string, id: string, data: Record<string, unknown>): void {
    let col = this.collections.get(collectionName)
    if (!col) {
      col = new Map()
      this.collections.set(collectionName, col)
    }
    col.set(id, JSON.parse(JSON.stringify(data)))
  }

  updateDoc(collectionName: string, id: string, data: Record<string, unknown>): void {
    const col = this.collections.get(collectionName)
    const existing = col?.get(id)
    if (!existing) throw new Error(`Document ${collectionName}/${id} not found to update`)
    Object.assign(existing, JSON.parse(JSON.stringify(data)))
  }

  deleteDoc(collectionName: string, id: string): void {
    this.collections.get(collectionName)?.delete(id)
  }

  queryDocs(collectionName: string, filters: Array<{ field: string; op: string; value: unknown }>): FakeQuerySnapshot {
    const col = this.collections.get(collectionName)
    if (!col) return new FakeQuerySnapshot([])

    const docs: FakeDocumentSnapshot[] = []
    for (const [id, data] of col.entries()) {
      let match = true
      for (const filter of filters) {
        const val = data[filter.field]
        if (filter.op === '==' && val !== filter.value) match = false
        if (filter.op === '!=' && val === filter.value) match = false
        if (filter.op === '<' && !(typeof val === 'number' && typeof filter.value === 'number' && val < filter.value)) match = false
        if (filter.op === '<=' && !(typeof val === 'number' && typeof filter.value === 'number' && val <= filter.value)) match = false
        if (filter.op === '>' && !(typeof val === 'number' && typeof filter.value === 'number' && val > filter.value)) match = false
        if (filter.op === '>=' && !(typeof val === 'number' && typeof filter.value === 'number' && val >= filter.value)) match = false
      }
      if (match) {
        const ref = new FakeDocumentReference(id, new FakeCollectionReference(collectionName, this))
        docs.push(new FakeDocumentSnapshot(id, ref, data))
      }
    }
    return new FakeQuerySnapshot(docs)
  }

  clear(): void {
    this.collections.clear()
  }
}

export class FakeFirestore {
  readonly store = new InMemoryFirestoreData()

  collection(name: string): FakeCollectionReference {
    return new FakeCollectionReference(name, this.store)
  }

  batch(): FakeWriteBatch {
    return new FakeWriteBatch(this.store)
  }

  async runTransaction<T>(updateFunction: (transaction: FakeTransaction) => Promise<T>): Promise<T> {
    const transaction = new FakeTransaction(this.store)
    return updateFunction(transaction)
  }
}

export function createFakeFirestore(): Firestore {
  return new FakeFirestore() as unknown as Firestore
}
