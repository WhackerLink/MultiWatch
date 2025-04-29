import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import bcrypt from 'bcrypt';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, 'db', 'users.db');

export async function getDB() {
    return open({
        filename: dbPath,
        driver: sqlite3.Database
    });
}

export async function initDB() {
    const db = await getDB();
    await db.exec(`
        CREATE TABLE IF NOT EXISTS users (
                                             id INTEGER PRIMARY KEY AUTOINCREMENT,
                                             username TEXT UNIQUE NOT NULL,
                                             password TEXT NOT NULL
        );
    `);

    const adminExists = await db.get(`SELECT * FROM users WHERE username = ?`, ['admin']);
    if (!adminExists) {
        const hash = await bcrypt.hash('admin', 10);
        await db.run(`INSERT INTO users (username, password) VALUES (?, ?)`, ['admin', hash]);
        console.log('Default admin user created: admin / admin');
    }
}
