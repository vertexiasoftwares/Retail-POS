import { backup, DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync, openSync, closeSync, fsyncSync } from 'node:fs';
import { copyFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { migrations } from './database/schema.mjs';
import { verifyBackupOwner } from './database/auth.mjs';
const version = migrations.at(-1).version;
const expectedSchemas = new Map();
function schema(db) {
    return JSON.stringify(db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all());
}
function referenceSchema(schemaVersion) {
    if (!expectedSchemas.has(schemaVersion)) {
        const db = new DatabaseSync(':memory:');
        try {
            for (const migration of migrations)
                if (migration.version <= schemaVersion)
                    db.exec(migration.sql);
            expectedSchemas.set(schemaVersion, schema(db));
        }
        finally {
            db.close();
        }
    }
    return expectedSchemas.get(schemaVersion);
}
function flushFile(path) { const handle = openSync(path, 'r+'); try {
    fsyncSync(handle);
}
finally {
    closeSync(handle);
} }
export async function fileChecksum(path) {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(path))
        hash.update(chunk);
    return hash.digest('hex');
}
export function inspectBackup(path) {
    let db;
    try {
        if (!statSync(path).isFile() || statSync(path).size < 100)
            throw new Error('Backup is empty or is not a file.');
        db = new DatabaseSync(path, { readOnly: true });
        db.exec('PRAGMA trusted_schema=OFF');
        const schemaVersion = Number(db.prepare('PRAGMA user_version').get().user_version);
        if (schemaVersion < 7 || schemaVersion > version)
            throw new Error('Backup schema version is not supported by this app version.');
        if (schema(db) !== referenceSchema(schemaVersion))
            throw new Error('This file does not have the expected Vertexia database structure.');
        const checks = db.prepare('PRAGMA integrity_check').all();
        if (checks.length !== 1 || Object.values(checks[0])[0] !== 'ok' || db.prepare('PRAGMA foreign_key_check').all().length)
            throw new Error('Backup integrity or relationships are damaged.');
        const meta = db.prepare('SELECT * FROM backup_metadata WHERE id=1').get();
        const installation = db.prepare("SELECT value FROM app_meta WHERE key='installation_id'").get();
        const businesses = db.prepare('SELECT name FROM businesses').all();
        if (!meta || meta.format !== 'vertexia-backup-v1' || !Number.isFinite(Date.parse(String(meta.created_at))) || !/^[a-f0-9]{32}$/.test(String(installation?.value)) || businesses.length !== 1 || !db.prepare("SELECT 1 FROM app_meta WHERE key='auth_setup_complete'").get())
            throw new Error('This is not a configured Vertexia backup.');
        const owners = db.prepare("SELECT c.username FROM users u JOIN user_credentials c ON c.user_id=u.id WHERE u.role='Owner' AND u.is_active=1 AND EXISTS(SELECT 1 FROM user_branches ub JOIN branches b ON b.id=ub.branch_id WHERE ub.user_id=u.id AND b.is_active=1 AND b.business_id=u.business_id)").all();
        if (!owners.length)
            throw new Error('Backup has no usable owner login.');
        const mismatches = db.prepare(`SELECT 1 FROM stock_levels sl JOIN products p ON p.id=sl.product_id JOIN branches b ON b.id=sl.branch_id WHERE p.business_id<>b.business_id
      UNION ALL SELECT 1 FROM sales s JOIN branches b ON b.id=s.branch_id JOIN users u ON u.id=s.cashier_id WHERE s.business_id<>b.business_id OR u.business_id<>s.business_id
      UNION ALL SELECT 1 FROM sale_items i JOIN sales s ON s.id=i.sale_id JOIN products p ON p.id=i.product_id WHERE p.business_id<>s.business_id
      UNION ALL SELECT 1 FROM purchases p JOIN branches b ON b.id=p.branch_id JOIN suppliers su ON su.id=p.supplier_id WHERE p.business_id<>b.business_id OR su.business_id<>p.business_id LIMIT 1`).get();
        if (mismatches)
            throw new Error('Backup contains inconsistent business references.');
        const count = (table, where = '') => Number(db.prepare(`SELECT COUNT(*) AS n FROM ${table} ${where}`).get().n);
        return { fileName: basename(path), businessName: String(businesses[0].name), createdAt: String(meta.created_at), schemaVersion, sizeBytes: statSync(path).size, sales: count('sales'), products: count('products'), purchases: count('purchases'), openShifts: count('cash_shifts', "WHERE status='open'"), installationId: String(installation.value), ownerUsernames: owners.map(row => String(row.username)) };
    }
    catch (error) {
        throw new Error(error instanceof Error ? error.message : 'Backup could not be validated.');
    }
    finally {
        db?.close();
    }
}
export class BackupService {
    getDatabase;
    databasePath;
    directory;
    now;
    busy = false;
    idle = Promise.resolve();
    candidates = new Map();
    lastAutomaticError = null;
    constructor(getDatabase, databasePath, directory, now = () => new Date()) {
        this.getDatabase = getDatabase;
        this.databasePath = databasePath;
        this.directory = directory;
        this.now = now;
        mkdirSync(directory, { recursive: true });
        // A prior process may have exited during preview. Remove only our generated staging files.
        for (const name of readdirSync(directory)) {
            if (/^(?:\.restore-[a-f0-9-]+\.sqlite|vertexia-[a-z_]+-[a-f0-9-]+\.sqlite\.partial)$/.test(name)) {
                try {
                    unlinkSync(join(directory, name));
                }
                catch { /* A locked staging file is never offered as a completed backup. */ }
            }
        }
    }
    status() {
        const records = [];
        for (const file of readdirSync(this.directory).filter(name => /^vertexia-[a-z_]+-[a-f0-9-]+\.sqlite\.json$/.test(name))) {
            try {
                const record = JSON.parse(readFileSync(join(this.directory, file), 'utf8'));
                const path = join(this.directory, file.slice(0, -5));
                if (record.id && ['manual', 'before_restore', 'automatic'].includes(record.kind) && existsSync(path))
                    records.push({ ...record, path, fileName: basename(path) });
            }
            catch { /* A missing catalog entry never makes an existing backup eligible for restore without validation. */ }
        }
        return { busy: this.busy, directory: this.directory, records: records.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100), lastAutomaticError: this.lastAutomaticError };
    }
    async exclusive(work) {
        if (this.busy)
            throw new Error('A backup or restore operation is already running.');
        this.busy = true;
        let settle;
        this.idle = new Promise(resolveIdle => { settle = resolveIdle; });
        try {
            return await work();
        }
        finally {
            this.busy = false;
            settle();
        }
    }
    whenIdle() { return this.idle; }
    async snapshot(kind) {
        const id = randomUUID(), path = join(this.directory, `vertexia-${kind}-${id}.sqlite`), temporary = path + '.partial';
        try {
            await backup(this.getDatabase().connection, temporary);
            const target = new DatabaseSync(temporary);
            try {
                target.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL');
                target.prepare("INSERT INTO backup_metadata VALUES (1,'vertexia-backup-v1',?,?) ON CONFLICT(id) DO UPDATE SET created_at=excluded.created_at,app_version=excluded.app_version").run(this.now().toISOString(), '1.0.0');
            }
            finally {
                target.close();
            }
            const summary = inspectBackup(temporary);
            const record = { id, fileName: basename(path), path, createdAt: summary.createdAt, sizeBytes: summary.sizeBytes, checksum: await fileChecksum(temporary), kind };
            flushFile(temporary);
            renameSync(temporary, path);
            writeFileSync(path + '.json', JSON.stringify(record), { flag: 'wx' });
            flushFile(path + '.json');
            return record;
        }
        finally {
            if (existsSync(temporary))
                unlinkSync(temporary);
        }
    }
    create(kind = 'manual') { return this.exclusive(() => this.snapshot(kind)); }
    async automatic() {
        if (this.busy || !this.getDatabase().connection.prepare("SELECT 1 FROM app_meta WHERE key='auth_setup_complete'").get())
            return;
        const today = this.now().toISOString().slice(0, 10);
        if (this.status().records.some(record => record.kind === 'automatic' && record.createdAt.startsWith(today)))
            return;
        try {
            await this.create('automatic');
            this.lastAutomaticError = null;
        }
        catch (error) {
            this.lastAutomaticError = error instanceof Error ? error.message : 'Automatic backup failed.';
        }
    }
    rejectLivePath(path) {
        const destination = resolve(path);
        const canonical = existsSync(destination) ? realpathSync(destination) : join(realpathSync(dirname(destination)), basename(destination));
        const live = join(realpathSync(dirname(this.databasePath)), basename(this.databasePath));
        const protectedPaths = [live, live + '-wal', live + '-shm', live + '-journal'];
        if (protectedPaths.some(name => name.toLowerCase() === canonical.toLowerCase()))
            throw new Error('Choose a file outside the live database and its journal files.');
        if (existsSync(destination)) {
            const target = statSync(destination);
            for (const protectedPath of protectedPaths.filter(name => existsSync(name))) {
                const source = statSync(protectedPath);
                if (source.ino !== 0 && source.ino === target.ino && source.dev === target.dev)
                    throw new Error('Selected file refers to the live database or a journal file.');
            }
        }
    }
    safeDestination(path) {
        const destination = resolve(path);
        this.rejectLivePath(destination);
        if (realpathSync(dirname(destination)).toLowerCase() === realpathSync(this.directory).toLowerCase())
            throw new Error('Choose an external location for the exported backup copy.');
        return destination;
    }
    export(id, destination) {
        return this.exclusive(async () => {
            const record = this.status().records.find(item => item.id === id);
            if (!record)
                throw new Error('Backup record is unavailable.');
            if (await fileChecksum(record.path) !== record.checksum)
                throw new Error('Backup file changed after creation.');
            inspectBackup(record.path);
            const path = this.safeDestination(destination), temporary = join(dirname(path), `.vertexia-export-${randomUUID()}.partial`);
            try {
                await copyFile(record.path, temporary, 1);
                flushFile(temporary);
                renameSync(temporary, path);
                return { path };
            }
            finally {
                if (existsSync(temporary))
                    unlinkSync(temporary);
            }
        });
    }
    preview(sourcePath, ownerId) {
        return this.exclusive(async () => {
            this.clearExpired();
            if (this.candidates.size >= 5)
                throw new Error('Cancel a previous restore preview before selecting another backup.');
            this.rejectLivePath(sourcePath);
            if (resolve(sourcePath).toLowerCase() === resolve(this.databasePath).toLowerCase() || existsSync(sourcePath + '-wal'))
                throw new Error('Choose a completed standalone backup file, not a live database.');
            const token = randomUUID(), path = join(this.directory, `.restore-${token}.sqlite`);
            try {
                await copyFile(sourcePath, path, 1);
                let summary = inspectBackup(path);
                if (summary.schemaVersion < version) {
                    const staged = new DatabaseSync(path);
                    try {
                        staged.exec('PRAGMA foreign_keys=ON; BEGIN IMMEDIATE');
                        for (const migration of migrations)
                            if (migration.version > summary.schemaVersion)
                                staged.exec(migration.sql + `; PRAGMA user_version=${migration.version}`);
                        staged.exec('COMMIT');
                    }
                    catch (error) {
                        staged.exec('ROLLBACK');
                        throw error;
                    }
                    finally {
                        staged.close();
                    }
                    summary = inspectBackup(path);
                }
                const currentId = String(this.getDatabase().connection.prepare("SELECT value FROM app_meta WHERE key='installation_id'").get().value);
                const { installationId, ...visible } = summary;
                const result = { ...visible, fileName: basename(sourcePath), checksum: await fileChecksum(path), token, sameInstallation: currentId === installationId };
                this.candidates.set(token, { path, ownerId, expiresAt: this.now().getTime() + 10 * 60 * 1000, summary: result });
                return result;
            }
            catch (error) {
                if (existsSync(path))
                    unlinkSync(path);
                throw error;
            }
        });
    }
    cancel(token, ownerId) {
        const candidate = this.candidates.get(token);
        if (candidate && candidate.ownerId === ownerId) {
            this.candidates.delete(token);
            if (existsSync(candidate.path))
                unlinkSync(candidate.path);
        }
    }
    clearExpired() { for (const [token, value] of this.candidates)
        if (value.expiresAt <= this.now().getTime())
            this.cancel(token, value.ownerId); }
    restore(request, ownerId, hooks) {
        return this.exclusive(async () => {
            this.clearExpired();
            const candidate = this.candidates.get(request?.token);
            if (!candidate || candidate.ownerId !== ownerId)
                throw new Error('Restore preview expired. Select and review the backup again.');
            if (request.confirmation !== 'RESTORE')
                throw new Error('Type RESTORE to confirm replacing current data.');
            if (!candidate.summary.sameInstallation && request.allowDifferentInstallation !== true)
                throw new Error('Confirm that this backup belongs to the business you want to recover.');
            if (await fileChecksum(candidate.path) !== candidate.summary.checksum)
                throw new Error('The reviewed backup changed. Restore was stopped.');
            inspectBackup(candidate.path);
            const source = new DatabaseSync(candidate.path, { readOnly: true });
            let safety, closed = false, locked = false, restored = false;
            try {
                await verifyBackupOwner(source, request.backupOwnerUsername, request.backupOwnerPassword);
                hooks.authorize();
                if (this.getDatabase().connection.prepare("SELECT 1 FROM cash_shifts WHERE status='open'").get())
                    throw new Error('Close all current cash shifts before restoring a backup.');
                hooks.setMaintenance(true);
                locked = true;
                await hooks.quiesce?.();
                hooks.authorize();
                safety = await this.snapshot('before_restore');
                hooks.authorize();
                hooks.close();
                closed = true;
                await (hooks.install ?? backup)(source, this.databasePath);
                hooks.reopen();
                closed = false;
                restored = true;
                return { safetyBackupPath: safety.path };
            }
            catch (error) {
                if (closed && safety) {
                    const recovery = new DatabaseSync(safety.path, { readOnly: true });
                    try {
                        await backup(recovery, this.databasePath);
                        hooks.reopen();
                        closed = false;
                    }
                    catch {
                        throw new Error(`Restore recovery requires support. Preserve the safety backup: ${safety.path}`);
                    }
                    finally {
                        recovery.close();
                    }
                }
                throw error;
            }
            finally {
                source.close();
                if (locked && !closed)
                    hooks.setMaintenance(false);
                if (restored) {
                    try {
                        this.cancel(request.token, ownerId);
                    }
                    catch { /* A staged copy can be removed on next startup; the completed restore must still return success. */ }
                }
            }
        });
    }
}
//# sourceMappingURL=backup.mjs.map