import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { AuthSession, AuthStatus, BusinessSetupInput, BusinessUpdateInput, Permission, StaffCreateInput, StaffUpdateInput, StaffUser } from '../../src/types/auth.js'
import { isUserRole, rolePermissions } from '../../src/shared/auth-policy.js'
import { getRequestContext } from './context.mjs'

type Row = Record<string, string | number | null>
const HASH_OPTIONS = { N: 131072, r: 8, p: 1, maxmem: 160 * 1024 * 1024 }
const dummyHash = `scrypt-v1$${'00'.repeat(16)}$${'00'.repeat(64)}`
const IDLE_MS = 30 * 60 * 1000
const MAX_SESSION_MS = 12 * 60 * 60 * 1000

interface SessionRecord {
  userId: string
  version: number
  branchId: string
  issuedAt: number
  touchedAt: number
}

function text(value: unknown, label: string, limit = 120): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > limit || Array.from(value).some(character => character.charCodeAt(0) < 32)) throw new Error(`Enter a valid ${label}.`)
  return value.trim()
}
function username(value: unknown) {
  const result = text(value, 'username', 64).toLowerCase()
  if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(result)) throw new Error('Username needs 3–64 letters, numbers, dots, underscores or dashes.')
  return result
}
function password(value: unknown, newPassword = false): string {
  if (typeof value !== 'string' || value.length > 128 || value.length < (newPassword ? 8 : 1)) throw new Error(newPassword ? 'Use a password of 8–128 characters.' : 'Invalid username or password.')
  return value
}
async function derive(value: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(value, Buffer.from(salt, 'hex'), 64, HASH_OPTIONS, (error, key) => error ? reject(error) : resolve(key)))
}
async function hashPassword(value: string) {
  const salt = randomBytes(16).toString('hex')
  return `scrypt-v1$${salt}$${(await derive(value, salt)).toString('hex')}`
}
async function verifyPassword(value: string, encoded: string) {
  const valid = /^scrypt-v1\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(encoded)
  const [, salt, expected] = (valid ? encoded : dummyHash).split('$')
  const actual = await derive(value, salt)
  return timingSafeEqual(actual, Buffer.from(expected, 'hex')) && valid
}

/** Local sessions stay in the Electron main process. Never return credential rows to the renderer. */
export class AuthRepository {
  private desktopSession: SessionRecord | null = null
  private readonly sessions = new Map<string, SessionRecord>()
  private queue: Promise<unknown> = Promise.resolve()
  private revision = 0

  get session(): SessionRecord | null {
    return this.desktopSession
  }
  set session(value: SessionRecord | null) {
    this.desktopSession = value
  }

  constructor(private readonly db: DatabaseSync, private readonly now: () => Date = () => new Date(), private readonly authorizeWrite: (channel: string) => void = () => {}) {}

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex')
  }

  private generateToken(): string {
    return randomBytes(32).toString('hex')
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work)
    this.queue = result.catch(() => undefined)
    return result
  }
  async whenIdle(): Promise<void> { await this.queue }
  private transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try { const result = work(); this.db.exec('COMMIT'); return result }
    catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  private business(): Row {
    const rows = this.db.prepare('SELECT id,name FROM businesses ORDER BY created_at').all() as Row[]
    if (rows.length !== 1) throw new Error('This installation requires exactly one business. Contact support.')
    return rows[0]
  }
  private audit(actorId: string, branchId: string, action: string, targetId: string) {
    this.db.prepare('INSERT INTO audit_events VALUES (?,?,?,?,?,?,?,?,?)').run(`audit-${randomUUID()}`, branchId, actorId, 'Security', 'user', targetId, action, '', this.now().toISOString())
  }

  private validateSessionRecord(record: SessionRecord | null, onInvalidate: () => void, touch = false): AuthSession | null {
    if (!record) return null
    const time = this.now().getTime()
    if (time - record.touchedAt >= IDLE_MS || time - record.issuedAt >= MAX_SESSION_MS) {
      onInvalidate()
      return null
    }
    const user = this.db.prepare('SELECT u.*,c.username,c.credential_version,c.must_change_password FROM users u JOIN user_credentials c ON c.user_id=u.id WHERE u.id=?').get(record.userId) as Row | undefined
    if (!user || Number(user.is_active) !== 1 || Number(user.credential_version) !== record.version || !isUserRole(user.role)) {
      onInvalidate()
      return null
    }
    const branches = (this.db.prepare('SELECT b.id,b.name,b.code,b.city FROM user_branches ub JOIN branches b ON b.id=ub.branch_id WHERE ub.user_id=? AND b.business_id=? AND b.is_active=1 ORDER BY b.code').all(record.userId, String(user.business_id)) as Row[]).map(row => ({ id: String(row.id), name: String(row.name), code: String(row.code), city: String(row.city) }))
    if (!branches.some(branch => branch.id === record.branchId)) {
      onInvalidate()
      return null
    }
    if (touch) {
      record.touchedAt = time
    }
    let allowedTabs: string[] | undefined = undefined
    if (user.allowed_tabs && typeof user.allowed_tabs === 'string') {
      try {
        const parsed = JSON.parse(user.allowed_tabs)
        if (Array.isArray(parsed)) allowedTabs = parsed
      } catch {}
    }
    return {
      userId: record.userId,
      name: String(user.name),
      username: String(user.username),
      role: user.role,
      businessId: String(user.business_id),
      businessName: String(this.business().name),
      branches,
      branchId: record.branchId,
      permissions: [...rolePermissions[user.role]],
      allowedTabs,
      mustChangePassword: Number(user.must_change_password) === 1,
    }
  }

  private createSessionRecord(userId: string): SessionRecord {
    const user = this.db.prepare('SELECT c.credential_version,b.id AS branch_id FROM user_credentials c JOIN user_branches ub ON ub.user_id=c.user_id JOIN branches b ON b.id=ub.branch_id JOIN users u ON u.id=c.user_id WHERE c.user_id=? AND b.is_active=1 AND b.business_id=u.business_id ORDER BY b.code LIMIT 1').get(userId) as Row | undefined
    if (!user) throw new Error('This account has no active branch. Contact the owner.')
    const time = this.now().getTime()
    return { userId, version: Number(user.credential_version), branchId: String(user.branch_id), issuedAt: time, touchedAt: time }
  }

  status(token?: string): AuthStatus {
    const effectiveToken = token || getRequestContext()?.sessionToken
    return { needsSetup: !this.db.prepare("SELECT 1 FROM app_meta WHERE key='auth_setup_complete'").get(), businessName: String(this.business().name), session: this.current(effectiveToken) }
  }

  current(token?: string): AuthSession | null {
    const effectiveToken = token || getRequestContext()?.sessionToken
    if (effectiveToken) {
      return this.authenticateToken(effectiveToken, false)
    }
    return this.validateSessionRecord(this.desktopSession, () => { this.desktopSession = null }, false)
  }

  authenticateToken(token: string, touchSession = true): AuthSession | null {
    if (typeof token !== 'string' || !token) return null
    const tokenHash = this.hashToken(token)
    const record = this.sessions.get(tokenHash)
    if (!record) return null
    const session = this.validateSessionRecord(record, () => { this.sessions.delete(tokenHash) }, touchSession)
    if (session) {
      session.sessionToken = token
    }
    return session
  }

  require(permission?: Permission, branchId?: unknown, allowPasswordChange = false, touchSession = true, token?: string): AuthSession {
    const effectiveToken = token || getRequestContext()?.sessionToken
    const session = effectiveToken ? this.authenticateToken(effectiveToken, touchSession) : this.validateSessionRecord(this.desktopSession, () => { this.desktopSession = null }, touchSession)
    if (!session) throw new Error('Session expired. Sign in again.')
    if (session.mustChangePassword && !allowPasswordChange) throw new Error('Change your temporary password before continuing.')
    if (permission && !session.permissions.includes(permission)) throw new Error('You do not have permission for this action.')
    if (branchId !== undefined && (typeof branchId !== 'string' || !session.branches.some(branch => branch.id === branchId))) throw new Error('You do not have access to this branch.')
    return session
  }

  requireToken(token: string, permission?: Permission, branchId?: unknown, allowPasswordChange = false, touchSession = true): AuthSession {
    return this.require(permission, branchId, allowPasswordChange, touchSession, token)
  }

  private start(userId: string): AuthSession {
    this.desktopSession = this.createSessionRecord(userId)
    return this.current()!
  }

  setup(input: BusinessSetupInput): Promise<AuthSession> {
    return this.serial(async () => {
      if (!this.status().needsSetup && !input?.force) throw new Error('Business setup is already complete.')
      const businessName = text(input?.businessName, 'business name')
      const branchName = text(input?.branchName, 'branch name')
      const city = text(input?.city, 'city')
      const ownerName = text(input?.ownerName, 'owner name')
      const login = username(input?.username)
      const revision = this.revision
      const hash = await hashPassword(password(input?.password, true))
      if (revision !== this.revision) throw new Error('Business setup was cancelled. Try again.')
      return this.transaction(() => {
        if (!this.status().needsSetup && !input?.force) throw new Error('Business setup is already complete.')
        const businessId = String(this.business().id)
        const owner = this.db.prepare("SELECT id FROM users WHERE business_id=? AND role='Owner' ORDER BY created_at LIMIT 1").get(businessId) as Row | undefined
        const branch = this.db.prepare('SELECT id FROM branches WHERE business_id=? AND is_active=1 ORDER BY code LIMIT 1').get(businessId) as Row | undefined
        if (!owner || !branch) throw new Error('Existing business identity requires support before setup.')
        const time = this.now().toISOString()
        this.db.prepare('UPDATE businesses SET name=? WHERE id=?').run(businessName, businessId)
        this.db.prepare('UPDATE branches SET name=?,city=? WHERE id=?').run(branchName, city, String(branch.id))
        this.db.prepare("UPDATE users SET name=?,role='Owner',is_active=1 WHERE id=?").run(ownerName, String(owner.id))
        this.db.prepare('DELETE FROM user_credentials WHERE username=? AND user_id!=?').run(login, String(owner.id))
        this.db.prepare(`
          INSERT INTO user_credentials(user_id,username,password_hash,credential_version,must_change_password,failed_attempts,locked_until,updated_at)
          VALUES (?,?,?,1,0,0,NULL,?)
          ON CONFLICT(user_id) DO UPDATE SET
            username=excluded.username,
            password_hash=excluded.password_hash,
            credential_version=credential_version+1,
            must_change_password=0,
            failed_attempts=0,
            locked_until=NULL,
            updated_at=excluded.updated_at
        `).run(String(owner.id), login, hash, time)
        this.db.prepare('DELETE FROM login_throttle WHERE username=? OR username=?').run(login, '*')
        this.db.prepare('INSERT OR IGNORE INTO user_branches SELECT ?,id FROM branches WHERE business_id=? AND is_active=1').run(String(owner.id), businessId)
        this.db.prepare("INSERT INTO app_meta(key,value) VALUES ('auth_setup_complete',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(time)
        this.audit(String(owner.id), String(branch.id), 'Business setup completed', String(owner.id))
        return this.start(String(owner.id))
      })
    })
  }

  private async authenticateCredentials(loginInput: unknown, passwordInput: unknown): Promise<Row> {
    if (this.status().needsSetup) throw new Error('Complete business setup first.')
    const login = username(loginInput)
    const secret = password(passwordInput)
    const time = this.now().getTime()
    const revision = this.revision
    const global = this.db.prepare("SELECT * FROM login_throttle WHERE username='*'").get() as Row | undefined
    const user = this.db.prepare('SELECT u.id,u.is_active,c.* FROM users u JOIN user_credentials c ON c.user_id=u.id WHERE c.username=?').get(login) as Row | undefined
    if ((global?.locked_until && Date.parse(String(global.locked_until)) > time) || (user?.locked_until && Date.parse(String(user.locked_until)) > time)) throw new Error('Too many sign-in attempts. Try again in 15 minutes.')
    const verified = await verifyPassword(secret, user ? String(user.password_hash) : dummyHash)
    if (revision !== this.revision) throw new Error('Sign in was cancelled. Try again.')
    if (user) {
      const latest = this.db.prepare('SELECT credential_version FROM user_credentials WHERE user_id=?').get(String(user.user_id)) as Row | undefined
      if (Number(latest?.credential_version) !== Number(user.credential_version)) throw new Error('Sign in was cancelled. Try again.')
    }
    if (!verified || !user || Number(user.is_active) !== 1) {
      this.transaction(() => {
        const globalCount = Number(global?.failed_attempts ?? 0) + 1
        const until = new Date(time + 15 * 60 * 1000).toISOString()
        this.db.prepare("INSERT INTO login_throttle VALUES ('*',?,?,?) ON CONFLICT(username) DO UPDATE SET failed_attempts=excluded.failed_attempts,locked_until=excluded.locked_until,updated_at=excluded.updated_at").run(globalCount >= 20 ? 0 : globalCount, globalCount >= 20 ? until : null, this.now().toISOString())
        if (user) {
          const count = Number(user.failed_attempts) + 1
          this.db.prepare('UPDATE user_credentials SET failed_attempts=?,locked_until=? WHERE user_id=?').run(count >= 5 ? 0 : count, count >= 5 ? until : null, String(user.user_id))
        }
      })
      throw new Error('Invalid username or password.')
    }
    this.db.prepare('UPDATE user_credentials SET failed_attempts=0,locked_until=NULL WHERE user_id=?').run(String(user.user_id))
    this.db.prepare("DELETE FROM login_throttle WHERE username='*'").run()
    return user
  }

  login(loginInput: unknown, passwordInput: unknown): Promise<AuthSession> {
    return this.serial(async () => {
      if (this.current()) throw new Error('Sign out before switching accounts.')
      const user = await this.authenticateCredentials(loginInput, passwordInput)
      const session = this.start(String(user.user_id))
      this.audit(session.userId, session.branchId, 'User signed in', session.userId)
      return session
    })
  }

  loginWithToken(loginInput: unknown, passwordInput: unknown): Promise<{ token: string; session: AuthSession }> {
    return this.serial(async () => {
      const user = await this.authenticateCredentials(loginInput, passwordInput)
      const token = this.generateToken()
      const tokenHash = this.hashToken(token)
      const record = this.createSessionRecord(String(user.user_id))
      this.sessions.set(tokenHash, record)
      const session = this.validateSessionRecord(record, () => { this.sessions.delete(tokenHash) }, false)!
      session.sessionToken = token
      this.audit(session.userId, session.branchId, 'User signed in', session.userId)
      return { token, session }
    })
  }

  logout(token?: string): void {
    if (token) {
      this.logoutToken(token)
      return
    }
    const session = this.current()
    this.desktopSession = null
    this.revision++
    if (session) this.audit(session.userId, session.branchId, 'User signed out', session.userId)
  }

  logoutToken(token: string): void {
    if (typeof token !== 'string' || !token) return
    const tokenHash = this.hashToken(token)
    const record = this.sessions.get(tokenHash)
    if (!record) return
    const session = this.validateSessionRecord(record, () => {}, false)
    this.sessions.delete(tokenHash)
    if (session) this.audit(session.userId, session.branchId, 'User signed out', session.userId)
  }

  verifyForRestore(secret: string): Promise<string> {
    return this.serial(async () => {
      const session = this.require('backup.manage'), original = this.desktopSession!
      const row = this.db.prepare('SELECT password_hash,failed_attempts,locked_until FROM user_credentials WHERE user_id=?').get(session.userId) as Row
      if (row.locked_until && Date.parse(String(row.locked_until)) > this.now().getTime()) throw new Error('Too many attempts. Try again in 15 minutes.')
      if (!await verifyPassword(password(secret), String(row.password_hash))) {
        const count = Number(row.failed_attempts) + 1
        this.db.prepare('UPDATE user_credentials SET failed_attempts=?,locked_until=? WHERE user_id=?').run(count >= 5 ? 0 : count, count >= 5 ? new Date(this.now().getTime() + 15 * 60 * 1000).toISOString() : null, session.userId)
        throw new Error('Current owner password is incorrect.')
      }
      this.unchangedSession(original)
      this.require('backup.manage')
      this.db.prepare('UPDATE user_credentials SET failed_attempts=0,locked_until=NULL WHERE user_id=?').run(session.userId)
      return session.userId
    })
  }

  selectBranch(branchId: string, token?: string): AuthSession {
    if (token) {
      return this.selectSessionBranch(token, branchId)
    }
    this.require(undefined, branchId)
    this.desktopSession!.branchId = branchId
    return this.current()!
  }

  selectSessionBranch(token: string, branchId: string): AuthSession {
    this.requireToken(token, undefined, branchId)
    const tokenHash = this.hashToken(token)
    const record = this.sessions.get(tokenHash)
    if (record) {
      record.branchId = branchId
    }
    return this.authenticateToken(token, false)!
  }

  listUsers(): StaffUser[] {
    const session = this.require('users.manage')
    return (this.db.prepare('SELECT u.id,u.name,u.role,u.is_active,u.allowed_tabs,c.username,c.must_change_password FROM users u LEFT JOIN user_credentials c ON c.user_id=u.id WHERE u.business_id=? ORDER BY u.name').all(session.businessId) as Row[]).map(row => {
      let allowedTabs: string[] | undefined = undefined
      if (row.allowed_tabs && typeof row.allowed_tabs === 'string') {
        try {
          const parsed = JSON.parse(row.allowed_tabs)
          if (Array.isArray(parsed)) allowedTabs = parsed
        } catch {}
      }
      return {
        id: String(row.id),
        name: String(row.name),
        role: String(row.role),
        isActive: Number(row.is_active) === 1,
        username: row.username === null ? null : String(row.username),
        hasLogin: row.username !== null,
        mustChangePassword: Number(row.must_change_password) === 1,
        allowedTabs,
        branchIds: (this.db.prepare('SELECT branch_id FROM user_branches WHERE user_id=?').all(String(row.id)) as Row[]).map(branch => String(branch.branch_id)),
      }
    })
  }
  private validateBranches(values: unknown, businessId: string): string[] {
    if (!Array.isArray(values) || !values.length || values.length > 100 || new Set(values).size !== values.length) throw new Error('Select at least one unique branch.')
    return values.map(value => {
      const id = text(value, 'branch', 100)
      if (!this.db.prepare('SELECT 1 FROM branches WHERE id=? AND business_id=? AND is_active=1').get(id, businessId)) throw new Error('Invalid business branch.')
      return id
    })
  }
  private unchangedSession(original: object, token?: string) {
    const effectiveToken = token || getRequestContext()?.sessionToken
    const current = effectiveToken ? this.sessions.get(this.hashToken(effectiveToken)) : this.desktopSession
    if (current !== original) throw new Error('Session changed. Try this action again.')
  }
  createUser(input: StaffCreateInput): Promise<StaffUser[]> {
    return this.serial(async () => {
      this.authorizeWrite('auth:create-user')
      const effectiveToken = getRequestContext()?.sessionToken
      const session = this.require('users.manage', undefined, false, true, effectiveToken)
      const original = effectiveToken ? this.sessions.get(this.hashToken(effectiveToken))! : this.desktopSession!
      const name = text(input?.name, 'staff name')
      const login = username(input?.username)
      if (!isUserRole(input?.role)) throw new Error('Invalid role.')
      const branches = this.validateBranches(input.branchIds, session.businessId)
      if (this.db.prepare('SELECT 1 FROM user_credentials WHERE username=?').get(login)) throw new Error('This username is already in use.')
      const hash = await hashPassword(password(input.password, true))
      this.unchangedSession(original, effectiveToken); this.require('users.manage', undefined, false, true, effectiveToken)
      const allowedTabsJson = input.allowedTabs && Array.isArray(input.allowedTabs) ? JSON.stringify(input.allowedTabs) : null
      return this.transaction(() => {
        this.authorizeWrite('auth:create-user')
        this.validateBranches(branches, session.businessId)
        const id = `user-${randomUUID()}`, time = this.now().toISOString()
        this.db.prepare('INSERT INTO users(id,business_id,name,role,is_active,created_at,allowed_tabs) VALUES (?,?,?,?,?,?,?)').run(id, session.businessId, name, input.role, 1, time, allowedTabsJson)
        this.db.prepare('INSERT INTO user_credentials(user_id,username,password_hash,must_change_password,updated_at) VALUES (?,?,?,1,?)').run(id, login, hash, time)
        for (const branch of branches) this.db.prepare('INSERT INTO user_branches VALUES (?,?)').run(id, branch)
        this.audit(session.userId, session.branchId, 'Staff login created', id)
        return this.listUsers()
      })
    })
  }
  updateUser(input: StaffUpdateInput): StaffUser[] {
    const effectiveToken = getRequestContext()?.sessionToken
    const session = this.require('users.manage', undefined, false, true, effectiveToken)
    if (!input || !isUserRole(input.role) || typeof input.isActive !== 'boolean') throw new Error('Invalid staff update.')
    if (input.userId === session.userId) throw new Error('Ask another owner to change your own role or access.')
    const user = this.db.prepare('SELECT u.*,c.user_id AS login_id FROM users u LEFT JOIN user_credentials c ON c.user_id=u.id WHERE u.id=? AND u.business_id=?').get(text(input.userId, 'user identifier', 100), session.businessId) as Row | undefined
    if (!user) throw new Error('Staff member not found.')
    if (input.isActive && !user.login_id) throw new Error('Legacy staff has no login. Create a new staff account.')
    const branches = this.validateBranches(input.branchIds, session.businessId)
    const allowedTabsJson = input.allowedTabs && Array.isArray(input.allowedTabs) ? JSON.stringify(input.allowedTabs) : null
    return this.transaction(() => {
      if (user.role === 'Owner' && (input.role !== 'Owner' || !input.isActive)) {
        const others = this.db.prepare("SELECT 1 FROM users u JOIN user_credentials c ON c.user_id=u.id JOIN user_branches ub ON ub.user_id=u.id JOIN branches b ON b.id=ub.branch_id WHERE u.business_id=? AND u.id<>? AND u.role='Owner' AND u.is_active=1 AND b.is_active=1 LIMIT 1").get(session.businessId, input.userId)
        if (!others) throw new Error('The last active owner cannot be removed.')
      }
      this.db.prepare('UPDATE users SET role=?,is_active=?,allowed_tabs=? WHERE id=?').run(input.role, input.isActive ? 1 : 0, allowedTabsJson, input.userId)
      this.db.prepare('UPDATE user_credentials SET credential_version=credential_version+1 WHERE user_id=?').run(input.userId)
      this.db.prepare('DELETE FROM user_branches WHERE user_id=?').run(input.userId)
      for (const branch of branches) this.db.prepare('INSERT INTO user_branches VALUES (?,?)').run(input.userId, branch)
      this.audit(session.userId, session.branchId, 'Staff role, status and branch access updated', input.userId)
      return this.listUsers()
    })
  }
  resetPassword(userId: string, newPassword: string): Promise<void> {
    return this.serial(async () => {
      this.authorizeWrite('auth:reset-password')
      const effectiveToken = getRequestContext()?.sessionToken
      const session = this.require('users.manage', undefined, false, true, effectiveToken)
      const original = effectiveToken ? this.sessions.get(this.hashToken(effectiveToken))! : this.desktopSession!
      if (userId === session.userId) throw new Error('Use Change Password for your own account.')
      if (!this.db.prepare('SELECT 1 FROM users u JOIN user_credentials c ON c.user_id=u.id WHERE u.id=? AND u.business_id=?').get(text(userId, 'user identifier', 100), session.businessId)) throw new Error('Staff login not found.')
      const hash = await hashPassword(password(newPassword, true))
      this.unchangedSession(original, effectiveToken); this.require('users.manage', undefined, false, true, effectiveToken)
      this.transaction(() => {
        this.authorizeWrite('auth:reset-password')
        this.db.prepare('UPDATE user_credentials SET password_hash=?,credential_version=credential_version+1,must_change_password=1,failed_attempts=0,locked_until=NULL,updated_at=? WHERE user_id=?').run(hash, this.now().toISOString(), userId)
        this.audit(session.userId, session.branchId, 'Staff password reset', userId)
      })
    })
  }
  changePassword(currentPassword: string, newPassword: string, token?: string): Promise<AuthSession> {
    return this.serial(async () => {
      const session = this.require(undefined, undefined, true, true, token)
      const original = token ? this.sessions.get(this.hashToken(token))! : this.desktopSession!
      const row = this.db.prepare('SELECT password_hash,locked_until,failed_attempts FROM user_credentials WHERE user_id=?').get(session.userId) as Row
      if (row.locked_until && Date.parse(String(row.locked_until)) > this.now().getTime()) throw new Error('Too many attempts. Try again in 15 minutes.')
      const next = password(newPassword, true)
      if (next === currentPassword) throw new Error('Choose a different new password.')
      if (!await verifyPassword(password(currentPassword), String(row.password_hash))) {
        const count = Number(row.failed_attempts) + 1
        this.db.prepare('UPDATE user_credentials SET failed_attempts=?,locked_until=? WHERE user_id=?').run(count >= 5 ? 0 : count, count >= 5 ? new Date(this.now().getTime() + 15 * 60 * 1000).toISOString() : null, session.userId)
        throw new Error('Current password is incorrect.')
      }
      const hash = await hashPassword(next)
      this.unchangedSession(original, token)
      this.require(undefined, undefined, true, true, token)
      this.transaction(() => {
        this.db.prepare('UPDATE user_credentials SET password_hash=?,credential_version=credential_version+1,must_change_password=0,failed_attempts=0,locked_until=NULL,updated_at=? WHERE user_id=?').run(hash, this.now().toISOString(), session.userId)
        this.audit(session.userId, session.branchId, 'Password changed', session.userId)
      })
      if (token) {
        const tokenHash = this.hashToken(token)
        const rec = this.sessions.get(tokenHash)
        if (rec) rec.version += 1
        return this.authenticateToken(token, false)!
      }
      return this.start(session.userId)
    })
  }

  verifyCurrentPassword(secret: string, token?: string): Promise<{ ok: boolean }> {
    return this.serial(async () => {
      const effectiveToken = token || getRequestContext()?.sessionToken
      const session = this.require('settings.manage', undefined, false, true, effectiveToken)
      const row = this.db.prepare('SELECT password_hash,locked_until,failed_attempts FROM user_credentials WHERE user_id=?').get(session.userId) as Row
      if (row.locked_until && Date.parse(String(row.locked_until)) > this.now().getTime()) throw new Error('Too many attempts. Try again in 15 minutes.')
      if (!await verifyPassword(password(secret), String(row.password_hash))) {
        const count = Number(row.failed_attempts) + 1
        this.db.prepare('UPDATE user_credentials SET failed_attempts=?,locked_until=? WHERE user_id=?').run(count >= 5 ? 0 : count, count >= 5 ? new Date(this.now().getTime() + 15 * 60 * 1000).toISOString() : null, session.userId)
        throw new Error('Incorrect login password.')
      }
      this.db.prepare('UPDATE user_credentials SET failed_attempts=0,locked_until=NULL WHERE user_id=?').run(session.userId)
      return { ok: true }
    })
  }

  updateBusinessProfile(input: BusinessUpdateInput, token?: string): Promise<AuthSession> {
    return this.serial(async () => {
      const effectiveToken = token || getRequestContext()?.sessionToken
      const session = this.require('settings.manage', undefined, false, true, effectiveToken)
      const original = effectiveToken ? this.sessions.get(this.hashToken(effectiveToken))! : this.desktopSession!
      const businessName = text(input?.businessName, 'store name', 120)
      const branchName = typeof input?.branchName === 'string' && input.branchName.trim() ? text(input.branchName, 'branch name', 120) : undefined
      const city = typeof input?.city === 'string' && input.city.trim() ? text(input.city, 'city', 80) : undefined
      const row = this.db.prepare('SELECT password_hash,locked_until,failed_attempts FROM user_credentials WHERE user_id=?').get(session.userId) as Row
      if (row.locked_until && Date.parse(String(row.locked_until)) > this.now().getTime()) throw new Error('Too many attempts. Try again in 15 minutes.')
      if (!await verifyPassword(password(input?.password), String(row.password_hash))) {
        const count = Number(row.failed_attempts) + 1
        this.db.prepare('UPDATE user_credentials SET failed_attempts=?,locked_until=? WHERE user_id=?').run(count >= 5 ? 0 : count, count >= 5 ? new Date(this.now().getTime() + 15 * 60 * 1000).toISOString() : null, session.userId)
        throw new Error('Incorrect login password.')
      }
      this.unchangedSession(original, effectiveToken)
      this.require('settings.manage', undefined, false, true, effectiveToken)
      this.transaction(() => {
        this.db.prepare('UPDATE user_credentials SET failed_attempts=0,locked_until=NULL WHERE user_id=?').run(session.userId)
        this.db.prepare('UPDATE businesses SET name=? WHERE id=?').run(businessName, session.businessId)
        if (branchName || city) {
          this.db.prepare('UPDATE branches SET name=COALESCE(?, name), city=COALESCE(?, city) WHERE id=? AND business_id=?').run(branchName ?? null, city ?? null, session.branchId, session.businessId)
        }
        this.audit(session.userId, session.branchId, 'Business settings updated', businessName)
      })
      if (effectiveToken) {
        return this.authenticateToken(effectiveToken, false)!
      }
      const next = this.start(session.userId)
      if (this.desktopSession) this.desktopSession.branchId = session.branchId
      return this.current() ?? next
    })
  }

  getActiveSessionCount(): number {
    return this.sessions.size + (this.desktopSession ? 1 : 0)
  }

  hasHashedToken(token: string): boolean {
    return this.sessions.has(this.hashToken(token))
  }
}

export async function verifyBackupOwner(db: DatabaseSync, login: string, secret: string): Promise<string> {
  const row = db.prepare("SELECT u.id,c.password_hash FROM users u JOIN user_credentials c ON c.user_id=u.id WHERE c.username=? AND u.role='Owner' AND u.is_active=1 AND EXISTS(SELECT 1 FROM user_branches ub JOIN branches b ON b.id=ub.branch_id WHERE ub.user_id=u.id AND b.is_active=1 AND b.business_id=u.business_id)").get(username(login)) as Row | undefined
  if (!await verifyPassword(password(secret), row ? String(row.password_hash) : dummyHash) || !row) throw new Error('Backup owner username or password is incorrect.')
  return String(row.id)
}
