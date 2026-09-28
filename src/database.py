import sqlite3
import time

DB_NAME = "database.db"

def get_connection():
    return sqlite3.connect(DB_NAME)

def create_database():
    conn = get_connection()
    c = conn.cursor()

    c.execute("""
    CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE,
        password TEXT,
        email TEXT UNIQUE,
        third_party INTEGER,
        provider INTEGER,
        user_id TEXT,
        avatar_emoji TEXT DEFAULT '🎲',
        avatar_color TEXT DEFAULT '#3b82f6',
        last_seen REAL DEFAULT 0,
        discord_id TEXT,
        discord_avatar TEXT,
        discord_username TEXT
    )
    """)

    c.execute("PRAGMA table_info(users)")
    columns = [row[1] for row in c.fetchall()]
    if "avatar_emoji" not in columns:
        c.execute("ALTER TABLE users ADD COLUMN avatar_emoji TEXT DEFAULT '🎲'")
    if "avatar_color" not in columns:
        c.execute("ALTER TABLE users ADD COLUMN avatar_color TEXT DEFAULT '#3b82f6'")
    if "last_seen" not in columns:
        c.execute("ALTER TABLE users ADD COLUMN last_seen REAL DEFAULT 0")
    if "discord_id" not in columns:
        c.execute("ALTER TABLE users ADD COLUMN discord_id TEXT")
    if "discord_avatar" not in columns:
        c.execute("ALTER TABLE users ADD COLUMN discord_avatar TEXT")
    if "discord_username" not in columns:
        c.execute("ALTER TABLE users ADD COLUMN discord_username TEXT")

    c.execute("""
    CREATE TABLE IF NOT EXISTS friendships (
        user_id TEXT NOT NULL,
        friend_id TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        created_at REAL,
        PRIMARY KEY (user_id, friend_id),
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (friend_id) REFERENCES users(id)
    )
    """)

    c.execute("""
    CREATE TABLE IF NOT EXISTS friend_invites (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        inviter_id TEXT NOT NULL,
        invitee_id TEXT NOT NULL,
        room_code TEXT NOT NULL,
        created_at REAL,
        FOREIGN KEY (inviter_id) REFERENCES users(id),
        FOREIGN KEY (invitee_id) REFERENCES users(id)
    )
    """)

    conn.commit()
    conn.close()


def create_user(user_id, username, password, email, third_party=0, provider=0, ext_user_id=None):
    conn = get_connection()
    c = conn.cursor()
    try:
        c.execute("""
        INSERT INTO users (id, username, password, email, third_party, provider, user_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (user_id, username, password, email, third_party, provider, ext_user_id))
        conn.commit()
        return True
    except sqlite3.IntegrityError:
        return False
    finally:
        conn.close()


def get_user_by_username(username):
    conn = get_connection()
    c = conn.cursor()
    c.execute("SELECT * FROM users WHERE username = ?", (username,))
    user = c.fetchone()
    conn.close()
    return user


def get_user_by_id(user_id):
    conn = get_connection()
    c = conn.cursor()
    c.execute("SELECT * FROM users WHERE id = ?", (user_id,))
    user = c.fetchone()
    conn.close()
    return user


def update_user_avatar(user_id, avatar_emoji, avatar_color):
    conn = get_connection()
    c = conn.cursor()
    c.execute("UPDATE users SET avatar_emoji = ?, avatar_color = ? WHERE id = ?",
              (avatar_emoji, avatar_color, user_id))
    conn.commit()
    conn.close()
    return c.rowcount > 0


def update_last_seen(user_id):
    conn = get_connection()
    c = conn.cursor()
    c.execute("UPDATE users SET last_seen = ? WHERE id = ?", (time.time(), user_id))
    conn.commit()
    conn.close()


def search_users(query, exclude_user_id=None):
    conn = get_connection()
    c = conn.cursor()
    if exclude_user_id:
        c.execute("SELECT id, username, avatar_emoji, avatar_color, last_seen FROM users WHERE username LIKE ? AND id != ? LIMIT 20",
                  (f"%{query}%", exclude_user_id))
    else:
        c.execute("SELECT id, username, avatar_emoji, avatar_color, last_seen FROM users WHERE username LIKE ? LIMIT 20",
                  (f"%{query}%",))
    users = c.fetchall()
    conn.close()
    return [{"id": u[0], "username": u[1], "avatar_emoji": u[2], "avatar_color": u[3], "online": (time.time() - (u[4] or 0)) < 120} for u in users]


def send_friend_request(user_id, friend_id):
    conn = get_connection()
    c = conn.cursor()
    try:
        c.execute("SELECT status FROM friendships WHERE user_id = ? AND friend_id = ?", (friend_id, user_id))
        existing = c.fetchone()
        if existing and existing[0] == "accepted":
            conn.close()
            return False, "Bereits befreundet"
        if existing and existing[0] == "pending":
            c.execute("UPDATE friendships SET status = 'accepted' WHERE user_id = ? AND friend_id = ?", (friend_id, user_id))
            c.execute("INSERT OR REPLACE INTO friendships (user_id, friend_id, status, created_at) VALUES (?, ?, 'accepted', ?)",
                      (user_id, friend_id, time.time()))
            conn.commit()
            conn.close()
            return True, "Freundschaft angenommen"
        c.execute("INSERT OR REPLACE INTO friendships (user_id, friend_id, status, created_at) VALUES (?, ?, 'pending', ?)",
                  (user_id, friend_id, time.time()))
        conn.commit()
        conn.close()
        return True, "Freundschaftsanfrage gesendet"
    except Exception as e:
        conn.close()
        return False, str(e)


def respond_friend_request(user_id, friend_id, accept):
    conn = get_connection()
    c = conn.cursor()
    if accept:
        c.execute("UPDATE friendships SET status = 'accepted' WHERE user_id = ? AND friend_id = ?", (friend_id, user_id))
        c.execute("INSERT OR REPLACE INTO friendships (user_id, friend_id, status, created_at) VALUES (?, ?, 'accepted', ?)",
                  (user_id, friend_id, time.time()))
    else:
        c.execute("DELETE FROM friendships WHERE user_id = ? AND friend_id = ?", (friend_id, user_id))
    conn.commit()
    conn.close()
    return True


def remove_friend(user_id, friend_id):
    conn = get_connection()
    c = conn.cursor()
    c.execute("DELETE FROM friendships WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)",
              (user_id, friend_id, friend_id, user_id))
    conn.commit()
    conn.close()
    return True


def get_friends(user_id):
    conn = get_connection()
    c = conn.cursor()
    c.execute("""
        SELECT u.id, u.username, u.avatar_emoji, u.avatar_color, u.last_seen, f.status
        FROM friendships f
        JOIN users u ON (u.id = CASE WHEN f.user_id = ? THEN f.friend_id ELSE f.user_id END)
        WHERE (f.user_id = ? OR f.friend_id = ?) AND f.status IN ('accepted', 'pending')
    """, (user_id, user_id, user_id))
    rows = c.fetchall()
    conn.close()
    friends = []
    pending_incoming = []
    pending_outgoing = []
    for r in rows:
        is_self = r[0] == user_id
        online = (time.time() - (r[4] or 0)) < 120
        entry = {"id": r[0], "username": r[1], "avatar_emoji": r[2], "avatar_color": r[3], "online": online}
        if r[5] == "pending":
            if is_self:
                pending_outgoing.append(entry)
            else:
                pending_incoming.append(entry)
        else:
            if not is_self:
                friends.append(entry)
    return {"friends": friends, "pending_incoming": pending_incoming, "pending_outgoing": pending_outgoing}


def create_friend_invite(inviter_id, invitee_id, room_code):
    conn = get_connection()
    c = conn.cursor()
    c.execute("DELETE FROM friend_invites WHERE invitee_id = ? AND room_code = ?", (invitee_id, room_code))
    c.execute("INSERT INTO friend_invites (inviter_id, invitee_id, room_code, created_at) VALUES (?, ?, ?, ?)",
              (inviter_id, invitee_id, room_code, time.time()))
    conn.commit()
    conn.close()
    return True


def get_friend_invites(user_id):
    conn = get_connection()
    c = conn.cursor()
    c.execute("""
        SELECT fi.id, u.username, u.avatar_emoji, u.avatar_color, fi.room_code, fi.created_at
        FROM friend_invites fi
        JOIN users u ON u.id = fi.inviter_id
        WHERE fi.invitee_id = ? AND fi.created_at > ?
    """, (user_id, time.time() - 3600))
    rows = c.fetchall()
    conn.close()
    return [{"id": r[0], "from_username": r[1], "from_avatar_emoji": r[2], "from_avatar_color": r[3], "room_code": r[4]} for r in rows]


def dismiss_friend_invite(invite_id):
    conn = get_connection()
    c = conn.cursor()
    c.execute("DELETE FROM friend_invites WHERE id = ?", (invite_id,))
    conn.commit()
    conn.close()


def update_user_discord_info(user_id, discord_id, discord_avatar, discord_username):
    conn = get_connection()
    c = conn.cursor()
    c.execute("UPDATE users SET discord_id = ?, discord_avatar = ?, discord_username = ? WHERE id = ?",
              (discord_id, discord_avatar, discord_username, user_id))
    conn.commit()
    conn.close()
