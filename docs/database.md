# Database

Capstan's database layer (`@zauso-ai/capstan-db`) provides a model definition system built on top of Drizzle ORM. Define your models once with `defineModel()` and get typed schemas, migration generation, and automatic CRUD route scaffolding.

## defineModel()

`defineModel()` declares a data model with fields, relations, and indexes:

```typescript
import { defineModel, field, relation } from "@zauso-ai/capstan-db";

export const Ticket = defineModel("ticket", {
  fields: {
    id: field.id(),
    title: field.string({ required: true, min: 1, max: 200 }),
    description: field.text(),
    status: field.enum(["open", "in_progress", "closed"], { default: "open" }),
    priority: field.enum(["low", "medium", "high"], { default: "medium" }),
    assigneeId: field.string({ references: "user" }),
    createdAt: field.datetime({ default: "now" }),
    updatedAt: field.datetime({ updatedAt: true }),
  },
  relations: {
    assignee: relation.belongsTo("user", { foreignKey: "assigneeId" }),
    comments: relation.hasMany("comment"),
  },
  indexes: [
    { fields: ["status"], unique: false },
    { fields: ["assigneeId", "status"], unique: false },
  ],
});
```

## Field Types

The `field` helper provides builders for all supported scalar types:

| Builder            | Scalar Type  | SQLite Mapping | Description                              |
| ------------------ | ------------ | -------------- | ---------------------------------------- |
| `field.id()`       | `string`     | TEXT PK        | Auto-generated UUID primary key          |
| `field.string()`   | `string`     | TEXT           | Short string                             |
| `field.text()`     | `text`       | TEXT           | Long text                                |
| `field.integer()`  | `integer`    | INTEGER        | Integer                                  |
| `field.number()`   | `number`     | REAL           | Floating-point number                    |
| `field.boolean()`  | `boolean`    | INTEGER (0/1)  | Boolean                                  |
| `field.date()`     | `date`       | TEXT (ISO)     | Date only                                |
| `field.datetime()` | `datetime`   | TEXT (ISO)     | Date and time                            |
| `field.json()`     | `json`       | TEXT (JSON)    | JSON-serialized data                     |
| `field.enum()`     | `string`     | TEXT           | Constrained string with allowed values   |

### Field Options

Every field builder accepts an optional options object:

```typescript
interface FieldOptions {
  required?: boolean;    // NOT NULL constraint
  unique?: boolean;      // UNIQUE constraint
  default?: unknown;     // Default value ("now" for datetime auto-fill)
  min?: number;          // Minimum length (string) or value (number)
  max?: number;          // Maximum length (string) or value (number)
  enum?: readonly string[];  // Allowed values (set automatically by field.enum())
  updatedAt?: boolean;   // Auto-set to current time on update
  autoId?: boolean;      // Auto-generate UUID (set automatically by field.id())
  references?: string;   // Foreign key reference to another model name
}
```

### Examples

```typescript
// Required string with length constraints
field.string({ required: true, min: 1, max: 200 })

// Optional text with no constraints
field.text()

// Integer with range validation
field.integer({ required: true, min: 0, max: 100 })

// Boolean with default value
field.boolean({ default: false })

// Datetime that auto-fills on create
field.datetime({ default: "now" })

// Datetime that auto-updates
field.datetime({ updatedAt: true })

// Enum with default
field.enum(["low", "medium", "high"], { default: "medium" })

// Foreign key reference
field.string({ references: "user" })
```

## Relations

The `relation` helper defines how models connect to each other:

```typescript
import { relation } from "@zauso-ai/capstan-db";

// One ticket belongs to one user
relation.belongsTo("user", { foreignKey: "assigneeId" })

// One user has many tickets
relation.hasMany("ticket")

// One user has one profile
relation.hasOne("profile")

// Many-to-many through a join table
relation.manyToMany("tag", { through: "ticket_tags" })
```

### Relation Types

| Kind         | Description                               | Options                  |
| ------------ | ----------------------------------------- | ------------------------ |
| `belongsTo`  | This model has a FK pointing to another   | `foreignKey?: string`    |
| `hasMany`    | Another model has a FK pointing here      | `foreignKey?: string`    |
| `hasOne`     | Another model has a unique FK pointing here | `foreignKey?: string`  |
| `manyToMany` | Related through a join table              | `through?: string`       |

## Database Providers

Capstan supports three database providers. Each uses Drizzle ORM with a provider-specific driver:

| Provider   | Driver          | Drizzle Adapter          | Connection URL Example                        |
| ---------- | --------------- | ------------------------ | --------------------------------------------- |
| `sqlite`   | better-sqlite3  | drizzle-orm/better-sqlite3 | `./data.db` or `:memory:`                   |
| `postgres` | pg (node-postgres) | drizzle-orm/node-postgres | `postgres://user:pass@host:5432/db`        |
| `mysql`    | mysql2          | drizzle-orm/mysql2       | `mysql://user:pass@host:3306/db`              |

Install the driver for your chosen provider:

```bash
# SQLite
npm install better-sqlite3 drizzle-orm

# PostgreSQL
npm install pg drizzle-orm

# MySQL
npm install mysql2 drizzle-orm
```

## Configuration

Configure the database in `capstan.config.ts`:

```typescript
import { defineConfig, env } from "@zauso-ai/capstan-core";

export default defineConfig({
  app: {
    name: "my-app",
  },
  database: {
    provider: "sqlite",
    url: env("DATABASE_URL") || "./data.db",
  },
});
```

### Using Environment Variables

For production, set the database URL via environment variable:

```bash
# .env
DATABASE_URL=postgres://user:pass@localhost:5432/mydb
```

```typescript
database: {
  provider: "postgres",
  url: env("DATABASE_URL"),
},
```

## Creating a Database Instance

In application code, use `createDatabase()` to get a Drizzle instance:

```typescript
import { createDatabase } from "@zauso-ai/capstan-db";

const { db, close } = createDatabase({
  provider: "sqlite",
  url: "./data.db",
});

// Use db with Drizzle ORM queries...

// Clean up when done
close();
```

For SQLite, WAL mode is automatically enabled for better concurrent read performance.

## Migrations

Capstan provides a migration system that generates SQL from model definition diffs and tracks applied migrations in a `_capstan_migrations` table.

### Commands

```bash
# Generate a new migration from model changes
npx capstan db:migrate --name add_priority_field

# Apply pending migrations directly (bypasses migration files)
npx capstan db:push

# Show migration status (applied vs pending)
npx capstan db:status
```

### How Migrations Work

1. `generateMigration(fromModels, toModels)` compares two sets of model definitions and produces SQL statements
2. Generated SQL handles: CREATE TABLE, ALTER TABLE ADD COLUMN, CREATE INDEX, DROP TABLE
3. Migrations are applied inside transactions (all-or-nothing)
4. The `_capstan_migrations` table tracks which migrations have been applied

### Migration Generation

The migration generator produces forward-only diffs:

- New models produce `CREATE TABLE` statements
- New fields produce `ALTER TABLE ADD COLUMN` statements
- New indexes produce `CREATE INDEX` statements
- Removed models produce `DROP TABLE` statements

**Note**: Column drops, renames, and type changes are not handled automatically due to SQLite's limited ALTER TABLE support. These require manual migration files.

### Migration State Tracking

The `_capstan_migrations` table is automatically created when needed:

```sql
-- SQLite
CREATE TABLE IF NOT EXISTS _capstan_migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- PostgreSQL
CREATE TABLE IF NOT EXISTS _capstan_migrations (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  applied_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- MySQL
CREATE TABLE IF NOT EXISTS _capstan_migrations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

You can query migration status programmatically:

```typescript
import { getMigrationStatus, ensureTrackingTable } from "@zauso-ai/capstan-db";

ensureTrackingTable(client, "sqlite");
const status = getMigrationStatus(client, allMigrationNames, "sqlite");
// status.applied  -- array of { name, appliedAt }
// status.pending  -- array of migration names not yet applied
```

## Auto CRUD Generation

`generateCrudRoutes()` creates API route files from a model definition:

```typescript
import { generateCrudRoutes } from "@zauso-ai/capstan-db";
import { Ticket } from "./models/ticket.model.js";

const files = generateCrudRoutes(Ticket);
// Returns:
// [
//   { path: "tickets/index.api.ts", content: "..." },   // GET (list) + POST (create)
//   { path: "tickets/[id].api.ts", content: "..." },     // GET (by id) + PUT (update) + DELETE
// ]
```

The generated files include:
- Zod input/output schemas derived from the model fields
- `defineAPI()` handlers with proper capability and resource metadata
- `policy: "requireAuth"` on all write endpoints
- TODO comments where you plug in actual database queries

The CLI scaffolder uses this internally:

```bash
npx capstan add api tickets    # Generates CRUD routes for tickets
```

## Table Naming

Model names are automatically pluralized for table names:

| Model Name | Table Name |
| ---------- | ---------- |
| `ticket`   | `tickets`  |
| `company`  | `companies`|
| `status`   | `statuses` |
| `user`     | `users`    |
