import { MongoCloudStore } from '../../cloud-dist/cloud-server/db/mongo-store.mjs'

function matchesFilter(doc, filter = {}) {
  for (const [key, cond] of Object.entries(filter)) {
    if (key === '$or') {
      const clauses = Array.isArray(cond) ? cond : []
      if (!clauses.some(c => matchesFilter(doc, c))) return false
      continue
    }
    const val = doc[key]
    if (cond instanceof RegExp) {
      if (typeof val !== 'string' || !cond.test(val)) return false
      continue
    }
    if (cond && typeof cond === 'object' && !Array.isArray(cond) && !(cond instanceof Date)) {
      const ops = cond
      if ('$ne' in ops && val === ops.$ne) return false
      if ('$gt' in ops && !(val > ops.$gt)) return false
      if ('$gte' in ops && !(val >= ops.$gte)) return false
      if ('$lte' in ops && !(val <= ops.$lte)) return false
      if ('$in' in ops && !(Array.isArray(ops.$in) && ops.$in.includes(val))) return false
      continue
    }
    if (val !== cond) return false
  }
  return true
}

function applyProject(doc, projection) {
  if (!projection) return { ...doc }
  const entries = Object.entries(projection)
  if (!entries.length) return { ...doc }
  const excludeMode = entries.every(([, v]) => v === 0)
  if (excludeMode) {
    const copy = { ...doc }
    for (const [k, v] of entries) {
      if (v === 0) delete copy[k]
    }
    return copy
  }
  const out = {}
  for (const [k, v] of entries) {
    if (v) out[k] = doc[k]
  }
  return out
}

class InMemoryCollection {
  constructor() {
    this.docs = []
    this.uniqueIndexes = []
  }

  async createIndex(spec, opts = {}) {
    if (opts.unique) {
      this.uniqueIndexes.push(Object.keys(spec))
    }
    return 'ok'
  }

  _checkUnique(candidate, ignoreIdx = -1) {
    if (candidate._id !== undefined) {
      const dupId = this.docs.findIndex((d, i) => i !== ignoreIdx && d._id === candidate._id)
      if (dupId !== -1) {
        const err = new Error('E11000 duplicate key error on _id')
        err.code = 11000
        throw err
      }
    }
    for (const keys of this.uniqueIndexes) {
      if (keys.some(k => candidate[k] === undefined)) continue
      const dup = this.docs.findIndex(
        (d, i) => i !== ignoreIdx && keys.every(k => d[k] === candidate[k]),
      )
      if (dup !== -1) {
        const err = new Error(`E11000 duplicate key error on ${keys.join(',')}`)
        err.code = 11000
        throw err
      }
    }
  }

  async findOne(filter = {}, options = {}) {
    const found = this.docs.find(d => matchesFilter(d, filter))
    return found ? applyProject(found, options.projection) : null
  }

  find(filter = {}, options = {}) {
    let rows = this.docs.filter(d => matchesFilter(d, filter)).map(d => applyProject(d, options.projection))
    const cursor = {
      sort(sortSpec) {
        const entries = Object.entries(sortSpec)
        rows = [...rows].sort((a, b) => {
          for (const [k, dir] of entries) {
            const av = a[k] instanceof Date ? a[k].getTime() : a[k]
            const bv = b[k] instanceof Date ? b[k].getTime() : b[k]
            if (av === bv) continue
            if (av === undefined || av === null) return dir > 0 ? -1 : 1
            if (bv === undefined || bv === null) return dir > 0 ? 1 : -1
            return av < bv ? -dir : dir
          }
          return 0
        })
        return cursor
      },
      skip(n) {
        rows = rows.slice(n)
        return cursor
      },
      limit(n) {
        rows = rows.slice(0, n)
        return cursor
      },
      async toArray() {
        return rows
      },
    }
    return cursor
  }

  async countDocuments(filter = {}) {
    return this.docs.filter(d => matchesFilter(d, filter)).length
  }

  async insertOne(doc) {
    const copy = { ...doc }
    this._checkUnique(copy)
    this.docs.push(copy)
    return { acknowledged: true, insertedId: copy._id }
  }

  _applyUpdate(target, update, isInsert) {
    if (update.$set) {
      Object.assign(target, update.$set)
    }
    if (isInsert && update.$setOnInsert) {
      Object.assign(target, update.$setOnInsert)
    }
    if (update.$inc) {
      for (const [k, delta] of Object.entries(update.$inc)) {
        target[k] = Number(target[k] ?? 0) + Number(delta)
      }
    }
  }

  async updateOne(filter, update, options = {}) {
    const idx = this.docs.findIndex(d => matchesFilter(d, filter))
    if (idx === -1) {
      if (options.upsert) {
        const created = { ...filter }
        for (const [k, v] of Object.entries(created)) {
          if (v && typeof v === 'object' && !(v instanceof Date)) delete created[k]
        }
        this._applyUpdate(created, update, true)
        this._checkUnique(created)
        this.docs.push(created)
        return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 }
      }
      return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 }
    }
    const copy = { ...this.docs[idx] }
    this._applyUpdate(copy, update, false)
    this._checkUnique(copy, idx)
    this.docs[idx] = copy
    return { matchedCount: 1, modifiedCount: 1, upsertedCount: 0 }
  }

  async updateMany(filter, update) {
    let count = 0
    for (let i = 0; i < this.docs.length; i += 1) {
      if (!matchesFilter(this.docs[i], filter)) continue
      const copy = { ...this.docs[i] }
      this._applyUpdate(copy, update, false)
      this.docs[i] = copy
      count += 1
    }
    return { matchedCount: count, modifiedCount: count }
  }

  async findOneAndUpdate(filter, update, options = {}) {
    const idx = this.docs.findIndex(d => matchesFilter(d, filter))
    if (idx === -1) {
      if (!options.upsert) return null
      const created = { ...filter }
      this._applyUpdate(created, update, true)
      this._checkUnique(created)
      this.docs.push(created)
      return { ...created }
    }
    const copy = { ...this.docs[idx] }
    this._applyUpdate(copy, update, false)
    this._checkUnique(copy, idx)
    this.docs[idx] = copy
    return { ...copy }
  }
}

export async function createInMemoryMongoCloudStore() {
  const collections = new Map()
  const fakeDb = {
    collection(name) {
      let col = collections.get(name)
      if (!col) {
        col = new InMemoryCollection()
        collections.set(name, col)
      }
      return col
    },
    async command() {
      return { ok: 1 }
    },
  }
  const store = new MongoCloudStore(null, fakeDb)
  await store.ensureIndexes()
  return store
}
