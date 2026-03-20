# 🏭 The Scrap Co. — Backend API

> Node.js + Express + PostgreSQL REST API for The Scrap Co. Management System

---

## 📁 Project Structure

```
the-scrap-co-backend/
├── src/
│   ├── index.js              ← Server entry point
│   ├── db/
│   │   ├── pool.js           ← PostgreSQL connection
│   │   ├── migrate.js        ← Create all tables
│   │   └── seed.js           ← Insert starter data
│   ├── middleware/
│   │   ├── auth.js           ← JWT verification
│   │   └── errorHandler.js   ← Central error handling
│   └── routes/
│       ├── auth.js           ← Login, register, users
│       ├── materials.js      ← Material CRUD + price history
│       ├── suppliers.js      ← Supplier CRUD
│       ├── transactions.js   ← Core weighing + stock update
│       ├── invoices.js       ← Invoice management + payments
│       └── dashboard.js      ← Analytics & stats
├── .env.example              ← Environment variable template
└── package.json
```

---

## 🚀 Setup (Step by Step)

### 1. Install PostgreSQL
Download from: https://www.postgresql.org/download/
- Windows: Use the installer, set a password for `postgres` user
- Mac: `brew install postgresql && brew services start postgresql`
- Linux (Ubuntu): `sudo apt install postgresql && sudo service postgresql start`

### 2. Create the Database
Open a terminal and run:
```bash
# Login to postgres
psql -U postgres

# Create database
CREATE DATABASE scrapco_db;

# Exit
\q
```

### 3. Install Node.js
Download from: https://nodejs.org/ (choose the LTS version)

### 4. Set Up the Project
```bash
# Enter the project folder
cd the-scrap-co-backend

# Install all dependencies
npm install

# Copy the environment config
cp .env.example .env
```

### 5. Edit .env file
Open `.env` in any text editor and update:
```
DB_PASSWORD=your_postgres_password_here
JWT_SECRET=any_long_random_string_here_eg_scrapco2026secret
```

### 6. Run Database Setup
```bash
# Create all tables
npm run db:migrate

# Insert starter data (materials, admin user, sample suppliers)
npm run db:seed
```

### 7. Start the Server
```bash
# Development (auto-restarts on changes)
npm run dev

# Production
npm start
```

Server runs at: **http://localhost:5000**

---

## 🔐 Authentication

All API routes require a Bearer token. Get one by logging in:

```bash
POST http://localhost:5000/api/auth/login
Content-Type: application/json

{
  "email": "admin@thescrapco.in",
  "password": "admin123"
}
```

Use the returned token in all subsequent requests:
```
Authorization: Bearer <your_token_here>
```

---

## 📡 API Reference

### Auth
| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| POST | `/api/auth/login` | Login | Public |
| GET | `/api/auth/me` | Get current user | All |
| POST | `/api/auth/register` | Create staff user | Admin |
| GET | `/api/auth/users` | List all users | Admin |

### Materials
| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| GET | `/api/materials` | List all materials | All |
| GET | `/api/materials/:id` | Get one material | All |
| POST | `/api/materials` | Add material | Admin/Cashier |
| PUT | `/api/materials/:id` | Update material | Admin/Cashier |
| DELETE | `/api/materials/:id` | Deactivate material | Admin |
| GET | `/api/materials/:id/price-history` | Price change log | All |

### Suppliers
| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| GET | `/api/suppliers` | List suppliers | All |
| GET | `/api/suppliers/:id` | Get supplier + history | All |
| POST | `/api/suppliers` | Add supplier | Admin/Cashier |
| PUT | `/api/suppliers/:id` | Update supplier | Admin/Cashier |
| DELETE | `/api/suppliers/:id` | Deactivate supplier | Admin |

### Transactions
| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| GET | `/api/transactions` | List transactions | All |
| GET | `/api/transactions/:id` | Get one transaction | All |
| POST | `/api/transactions` | Record weighing (auto-creates invoice + updates stock) | Admin/Cashier |
| DELETE | `/api/transactions/:id` | Delete + reverse stock | Admin |

### Invoices
| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| GET | `/api/invoices` | List invoices | All |
| GET | `/api/invoices/:id` | Get invoice details | All |
| PATCH | `/api/invoices/:id/pay` | Mark as paid | Admin/Cashier |
| PATCH | `/api/invoices/:id/status` | Update any status | Admin |

### Dashboard
| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| GET | `/api/dashboard` | All analytics (revenue, stock, trends) | All |

---

## 🔗 Connecting the Frontend

In your React app, replace any hardcoded data with API calls. Example:

```javascript
// services/api.js
const BASE_URL = 'http://localhost:5000/api';

export async function login(email, password) {
  const res = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return res.json();
}

export async function getMaterials(token) {
  const res = await fetch(`${BASE_URL}/materials`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json();
}

export async function createTransaction(data, token) {
  const res = await fetch(`${BASE_URL}/transactions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(data),
  });
  return res.json();
}
```

---

## 👤 User Roles

| Role | Can Do |
|------|--------|
| `admin` | Everything — full access |
| `cashier` | Record transactions, manage materials/suppliers, mark invoices paid |
| `driver` | Read-only access (view transactions and materials) |

---

## 🛡️ Security Features
- Passwords hashed with **bcrypt** (cost factor 10)
- JWT tokens expire after **7 days**
- All deletes are **soft deletes** (data never lost)
- DB transactions ensure stock + invoice are always in sync
- Role-based access on every route

---

## 🗄️ Database Tables

| Table | Purpose |
|-------|---------|
| `users` | Staff accounts with roles |
| `materials` | Material catalog with prices and stock |
| `suppliers` | Supplier register with ID verification |
| `transactions` | Every weighing record |
| `invoices` | Payment invoices linked to transactions |
| `price_history` | Full audit trail of price changes |
