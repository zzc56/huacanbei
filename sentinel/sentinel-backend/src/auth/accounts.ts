import { createHash } from 'node:crypto';
import { closeSync, mkdirSync, openSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';

export type Account = { salt: string; key: string };
const emailHash = (email: string) => createHash('sha256').update(email).digest('hex');

function readLegacyAccount(path: string): Account {
  let account: Partial<Account> | null;
  try {
    account = JSON.parse(readFileSync(path, 'utf8')) as Partial<Account> | null;
  } catch {
    throw new Error('Unable to read a legacy account record');
  }
  if (typeof account?.salt !== 'string' || !/^[a-f0-9]{32}$/i.test(account.salt) ||
      typeof account.key !== 'string' || !/^[a-f0-9]{128}$/i.test(account.key)) {
    throw new Error('A legacy account record has invalid credentials');
  }
  return { salt: account.salt, key: account.key };
}

function migrate(database: DatabaseSync, directory: string) {
  database.exec('BEGIN IMMEDIATE');
  try {
    const version = database.prepare('PRAGMA user_version').get()?.user_version;
    if (version === 0) {
      database.exec(`
        CREATE TABLE accounts (
          email_hash TEXT PRIMARY KEY,
          password_salt TEXT NOT NULL,
          password_hash TEXT NOT NULL,
          created_at INTEGER,
          password_changed_at INTEGER
        ) STRICT, WITHOUT ROWID
      `);
      const importAccount = database.prepare(`
        INSERT INTO accounts (email_hash, password_salt, password_hash)
        VALUES (?, ?, ?)
      `);
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const hash = /^([a-f0-9]{64})\.json$/.exec(entry.name)?.[1];
        if (!entry.isFile() || !hash) continue;
        const account = readLegacyAccount(join(directory, entry.name));
        importAccount.run(hash, account.salt, account.key);
      }
      database.exec('PRAGMA user_version = 1');
    } else if (version !== 1) {
      throw new Error('Unsupported accounts database schema');
    }
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

export class AccountStore {
  private readonly database: DatabaseSync;
  private readonly lookup: StatementSync;
  private readonly insert: StatementSync;
  private readonly updatePassword: StatementSync;

  constructor(directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const path = join(directory, 'accounts.sqlite');
    try {
      closeSync(openSync(path, 'wx', 0o600));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    this.database = new DatabaseSync(path);
    try {
      this.database.exec('PRAGMA busy_timeout = 3000');
      migrate(this.database, directory);
      this.lookup = this.database.prepare(`
        SELECT password_salt, password_hash FROM accounts WHERE email_hash = ?
      `);
      this.insert = this.database.prepare(`
        INSERT INTO accounts (email_hash, password_salt, password_hash, created_at, password_changed_at)
        VALUES (?, ?, ?, ?, ?) ON CONFLICT (email_hash) DO NOTHING
      `);
      this.updatePassword = this.database.prepare(`
        UPDATE accounts SET password_salt = ?, password_hash = ?, password_changed_at = ?
        WHERE email_hash = ?
      `);
    } catch (error) {
      this.database.close();
      throw error;
    }
  }

  get(email: string): Account | undefined {
    const row = this.lookup.get(emailHash(email));
    if (row) return { salt: String(row.password_salt), key: String(row.password_hash) };
  }

  create(email: string, account: Account) {
    const now = Date.now();
    return Number(this.insert.run(emailHash(email), account.salt, account.key, now, now).changes) === 1;
  }

  resetPassword(email: string, account: Account) {
    return Number(this.updatePassword.run(account.salt, account.key, Date.now(), emailHash(email)).changes) === 1;
  }

  close() {
    this.database.close();
  }
}
