-- GreenFit — Schema base (PostgreSQL / MySQL compatible con ajustes menores)

CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    email VARCHAR(160) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(10) NOT NULL DEFAULT 'socio', -- 'socio' | 'admin'
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE packs (
    id SERIAL PRIMARY KEY,
    name VARCHAR(120) NOT NULL,       -- ej: "Pack 12 clases Boxeo"
    total_credits INT NOT NULL,
    validity_days INT NOT NULL DEFAULT 30
);

CREATE TABLE user_packs (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id),
    pack_id INT NOT NULL REFERENCES packs(id),
    credits_remaining INT NOT NULL,
    expires_at DATE NOT NULL,
    status VARCHAR(10) NOT NULL DEFAULT 'active' -- 'active' | 'expired'
);

CREATE TABLE classes (
    id SERIAL PRIMARY KEY,
    name VARCHAR(80) NOT NULL,        -- Boxeo, Cross, Funcional
    description TEXT
);

CREATE TABLE schedules (
    id SERIAL PRIMARY KEY,
    class_id INT NOT NULL REFERENCES classes(id),
    start_time TIMESTAMP NOT NULL,
    capacity INT NOT NULL,
    status VARCHAR(10) NOT NULL DEFAULT 'open' -- 'open' | 'cancelled'
);

CREATE TABLE bookings (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id),
    schedule_id INT NOT NULL REFERENCES schedules(id),
    status VARCHAR(12) NOT NULL DEFAULT 'confirmed', -- confirmed | cancelled | attended | no_show
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE notifications (
    id SERIAL PRIMARY KEY,
    user_id INT REFERENCES users(id), -- NULL = masiva
    title VARCHAR(120) NOT NULL,
    body TEXT NOT NULL,
    sent_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_bookings_schedule ON bookings(schedule_id, status);
