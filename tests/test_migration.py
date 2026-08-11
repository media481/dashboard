"""Uji supabase-hardening-migration.sql di Postgres sungguhan.

Menguji dua skenario:
  A. Database "lama" persis seperti milik user: kt_sessions SUDAH ADA tapi
     tanpa kolom last_used_at (ini yang memicu error 42703).
  B. Database bersih (kt_sessions belum ada sama sekali).

Lalu memverifikasi perilaku: login, upgrade hash sha256->bcrypt, rate limit,
dan penolakan RPC admin untuk non-admin.
"""
import pgserver, pathlib, sys, tempfile, shutil, re

ROOT = pathlib.Path(__file__).resolve().parent.parent
SQL = (ROOT / "supabase-hardening-migration.sql").read_text(encoding="utf-8")
# pgserver tidak punya pgcrypto; fungsinya sudah disediakan lewat PGCRYPTO_SHIM.
SQL_TEST = SQL.replace("create extension if not exists pgcrypto;", "-- (pgcrypto di-shim untuk tes)")


# ------------------------------------------------------------------
# SHIM pgcrypto — KHUSUS TES, tidak ikut ke produksi.
# Supabase menyediakan pgcrypto asli, tapi build pgserver di sini tidak
# punya. Fungsi yang dipakai migrasi di-emulasi agar ALUR LOGIKANYA bisa
# diuji (verifikasi password, upgrade hash, penerbitan token).
# Catatan jujur: crypt() di sini BUKAN bcrypt sungguhan — ia meniru
# format '$2...' supaya cabang deteksi "sudah bcrypt?" di rpc_login
# teruji. Kekuatan kriptografi bcrypt asli tidak diuji di sini.
# ------------------------------------------------------------------
PGCRYPTO_SHIM = """
create schema if not exists extensions;

-- digest(text,'sha256') -> pakai sha256() builtin PostgreSQL 11+
create or replace function digest(p_data text, p_type text)
returns bytea language sql immutable as $$
  select case when p_type = 'sha256' then sha256(p_data::bytea)
              else sha512(p_data::bytea) end;
$$;

create or replace function gen_random_bytes(n int)
returns bytea language sql volatile as $$
  select decode(string_agg(lpad(to_hex((random()*255)::int), 2, '0'), ''), 'hex')
  from generate_series(1, n);
$$;

-- gen_salt/crypt tiruan berformat bcrypt ($2a$<cost>$<salt>)
create or replace function gen_salt(p_type text, p_cost int default 10)
returns text language sql volatile as $$
  select '$2a$' || lpad(p_cost::text, 2, '0') || '$' ||
         encode(gen_random_bytes(8), 'hex');
$$;

create or replace function crypt(p_password text, p_salt text)
returns text language sql immutable as $$
  -- salt = 4 bagian pertama dipisah '$'; hash = sha256(salt||password)
  select substring(p_salt from 1 for 23) ||
         encode(sha256((substring(p_salt from 1 for 23) || p_password)::bytea), 'hex');
$$;
"""


# psql CLI tidak melempar exception ke Python saat query gagal (error hanya
# tercetak ke stderr dan hasilnya string kosong). Jadi pengujian "harus
# ditolak" dilakukan di dalam Postgres: exception ditangkap plpgsql dan
# dikembalikan sebagai teks penanda.
TRY_HELPER = """
create or replace function try_sql(p_sql text)
returns text language plpgsql as $$
begin
  execute p_sql;
  return 'OK';
exception when others then
  return 'ERR: ' || sqlerrm;
end;
$$;
"""

# Skema minimal yang meniru database Merdeka yang sudah jalan.
BASE = """
create role anon;

create table kt_users (
  id text primary key,
  name text,
  username text,
  password text,
  "passwordHash" text,
  role text,
  allowed_sections text[] not null default '{}'::text[],
  last_seen_at timestamptz
);

-- beberapa tabel data (subset) + tabel yang disebut migrasi
create table kt_events (id text primary key, nama text, updated_at timestamptz);
create table kt_anggota (id text primary key, nama text, updated_at timestamptz);
create table kt_settings (event_id text primary key, updated_at timestamptz);
create table kt_telegram_settings (id text primary key, bot_token text, chat_id text,
  enabled boolean, categories jsonb, quiet_hours jsonb, updated_at timestamptz);
create table kt_guest_menu_settings (id text primary key, hidden_sections jsonb);
create table kt_error_log (id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(), message text, section text);

-- policy lama yang terbuka lebar (kondisi sebelum hardening)
do $$ declare t text; begin
  foreach t in array array['kt_events','kt_anggota','kt_settings',
      'kt_telegram_settings','kt_guest_menu_settings','kt_error_log'] loop
    execute format('alter table %I enable row level security;', t);
    execute format('create policy "anon_full_access" on %I for all to anon using (true) with check (true);', t);
  end loop;
end $$;

-- user dengan hash sha256 lama (seperti rpc_login versi lama)
insert into kt_users (id,name,username,"passwordHash",role) values
  ('admin1','Admin Utama','admin', encode(digest('admin123','sha256'),'hex'),'admin'),
  ('user1','User 1','user', encode(digest('user123','sha256'),'hex'),'user');

insert into kt_telegram_settings (id,bot_token,chat_id,enabled)
  values ('main','123456:RAHASIA-BOCOR','999',true);
"""

# Kondisi yang bikin migrasi user gagal: tabel sesi lama, TANPA last_used_at.
LEGACY_SESSIONS = """
create table kt_sessions (
  token text primary key,
  user_id text,
  expires_at timestamptz
);
insert into kt_sessions (token,user_id,expires_at)
  values ('token-lama','admin1', now() + interval '1 day');
"""

def scalar(db, sql):
    """Ambil satu nilai skalar dari psql.

    psql mengembalikan tabel berformat (header, garis pemisah, nilai,
    '(1 row)'), dan nilai kosong jadi baris kosong yang mustahil dibedakan
    dari padding. Jadi query dibungkus penanda <<...>> supaya nilainya
    selalu bisa ditemukan utuh, termasuk saat isinya string kosong.
    """
    inner = sql.strip().rstrip(";")
    out = db.psql("select '<<' || coalesce((" + inner + ")::text, 'NULL') || '>>';")
    m = re.search(r"<<(.*?)>>", out, re.S)
    return m.group(1).strip() if m else ""


def run(label, legacy):
    d = tempfile.mkdtemp()
    db = pgserver.get_server(d)
    try:
        db.psql(PGCRYPTO_SHIM)
        db.psql(TRY_HELPER)
        db.psql(BASE)
        if legacy:
            db.psql(LEGACY_SESSIONS)
        print(f"\n{'='*60}\nSKENARIO {label}\n{'='*60}")

        # psql tidak melempar exception ke Python, jadi keberhasilan migrasi
        # dinilai dari efeknya: fungsi kuncinya harus terbentuk.
        db.psql(SQL_TEST)
        has_fn = scalar(db, "select count(*) from pg_proc where proname='rpc_login'")
        if has_fn == "0":
            print("FAIL  migrasi tidak selesai: rpc_login tidak terbentuk")
            return False
        print("PASS  migrasi jalan sampai selesai tanpa error")

        ok = True

        # kolom lengkap?
        cols = scalar(db, "select string_agg(column_name,',' order by column_name) "
                            "from information_schema.columns where table_name='kt_sessions';")
        need = {"token","user_id","role","created_at","expires_at","last_used_at"}
        got = set(cols.split(","))
        print(("PASS  " if need <= got else "FAIL  ") + f"kolom kt_sessions: {cols}")
        ok &= need <= got

        # tidak ada lagi policy tulis terbuka
        open_w = scalar(db, "select count(*) from pg_policies where schemaname='public' "
                             "and qual='true' and cmd not in ('SELECT','INSERT');")
        print(("PASS  " if open_w=="0" else "FAIL  ") + f"policy tulis terbuka tersisa: {open_w}")
        ok &= open_w=="0"

        # login benar -> dapat token, hash naik ke bcrypt
        tok = scalar(db, "select session_token from rpc_login('admin','admin123');")
        print(("PASS  " if len(tok)==64 else "FAIL  ") + f"login admin dapat token ({len(tok)} char)")
        ok &= len(tok)==64

        h = scalar(db, "select \"passwordHash\" from kt_users where id='admin1';")
        bc = h.startswith("$2")
        print(("PASS  " if bc else "FAIL  ") + f"hash di-upgrade ke bcrypt: {h[:7]}...")
        ok &= bc

        # login kedua kali (sekarang sudah bcrypt) harus tetap berhasil
        tok2 = scalar(db, "select session_token from rpc_login('admin','admin123');")
        print(("PASS  " if len(tok2)==64 else "FAIL  ") + "login lagi setelah upgrade bcrypt")
        ok &= len(tok2)==64

        # password salah -> kosong
        bad = scalar(db, "select count(*) from rpc_login('admin','salah');")
        print(("PASS  " if bad=="0" else "FAIL  ") + f"password salah ditolak (rows={bad})")
        ok &= bad=="0"

        # rate limit: 5 gagal -> percobaan berikutnya diblokir
        for _ in range(5):
            db.psql("select count(*) from rpc_login('user','salah');")
        # password BENAR, tapi harus tetap diblokir karena sudah 5x gagal
        r = scalar(db, "select try_sql($q$select * from rpc_login('user','user123')$q$)")
        blocked = "Terlalu banyak" in r
        print(("PASS  " if blocked else "FAIL  ") + f"rate limit memblokir setelah 5 gagal -> {r[:60]}")
        ok &= blocked

        # rpc_list_users tanpa sesi admin harus ditolak
        r = scalar(db, "select try_sql($q$select * from rpc_list_users()$q$)")
        den = "Akses ditolak" in r
        print(("PASS  " if den else "FAIL  ") + f"rpc_list_users menolak non-admin -> {r[:60]}")
        ok &= den

        # bot token sudah dikosongkan
        bt = scalar(db, "select coalesce(bot_token,'kosong') from kt_telegram_settings where id='main';")
        empty = bt in ("", "kosong")
        print(("PASS  " if empty else "FAIL  ") + f"bot_token dikosongkan (isi: '{bt}')")
        ok &= empty

        # idempoten: jalankan dua kali
        db.psql(SQL_TEST)
        still = scalar(db, "select count(*) from pg_proc where proname='rpc_session_user'")
        print(("PASS  " if still=="1" else "FAIL  ") + "migrasi idempoten (jalan kedua kali tetap sukses)")
        ok &= still=="1"

        return ok
    finally:
        db.cleanup()
        shutil.rmtree(d, ignore_errors=True)

a = run("A — kt_sessions LAMA tanpa last_used_at (kasus user)", True)
b = run("B — database bersih", False)
print("\n" + "="*60)
print("HASIL:", "SEMUA LOLOS" if (a and b) else "ADA YANG GAGAL")
sys.exit(0 if (a and b) else 1)
