import { createElement } from "react";
import DocsLayout from "../../components/DocsLayout.js";

export default function Database() {
  return createElement(DocsLayout, null,

    createElement("h1", null, "Database"),

    createElement("p", null,
      "Capstan's database layer (", createElement("code", null, "@zauso-ai/capstan-db"),
      ") provides a model definition system built on top of Drizzle ORM. Define your models once with ",
      createElement("code", null, "defineModel()"),
      " and get typed schemas, migration generation, and automatic CRUD route scaffolding."
    ),

    // defineModel
    createElement("h2", null, "defineModel()"),
    createElement("p", null,
      createElement("code", null, "defineModel()"),
      " declares a data model with fields, relations, and indexes:"
    ),
    createElement("pre", null,
      createElement("code", null,
`import { defineModel, field, relation } from "@zauso-ai/capstan-db";

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
});`
      )
    ),

    // Field Types
    createElement("h2", null, "Field Types"),
    createElement("p", null, "The ", createElement("code", null, "field"),
      " helper provides builders for all supported scalar types:"
    ),
    createElement("table", null,
      createElement("thead", null,
        createElement("tr", null,
          createElement("th", null, "Builder"),
          createElement("th", null, "Scalar Type"),
          createElement("th", null, "SQLite Mapping"),
          createElement("th", null, "Description")
        )
      ),
      createElement("tbody", null,
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "field.id()")),
          createElement("td", null, "string"),
          createElement("td", null, "TEXT PK"),
          createElement("td", null, "Auto-generated UUID primary key")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "field.string()")),
          createElement("td", null, "string"),
          createElement("td", null, "TEXT"),
          createElement("td", null, "Short string")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "field.text()")),
          createElement("td", null, "text"),
          createElement("td", null, "TEXT"),
          createElement("td", null, "Long text")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "field.integer()")),
          createElement("td", null, "integer"),
          createElement("td", null, "INTEGER"),
          createElement("td", null, "Integer")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "field.number()")),
          createElement("td", null, "number"),
          createElement("td", null, "REAL"),
          createElement("td", null, "Floating-point number")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "field.boolean()")),
          createElement("td", null, "boolean"),
          createElement("td", null, "INTEGER (0/1)"),
          createElement("td", null, "Boolean")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "field.date()")),
          createElement("td", null, "date"),
          createElement("td", null, "TEXT (ISO)"),
          createElement("td", null, "Date only")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "field.datetime()")),
          createElement("td", null, "datetime"),
          createElement("td", null, "TEXT (ISO)"),
          createElement("td", null, "Date and time")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "field.json()")),
          createElement("td", null, "json"),
          createElement("td", null, "TEXT (JSON)"),
          createElement("td", null, "JSON-serialized data")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "field.enum()")),
          createElement("td", null, "string"),
          createElement("td", null, "TEXT"),
          createElement("td", null, "Constrained string with allowed values")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "field.vector()")),
          createElement("td", null, "float32[]"),
          createElement("td", null, "F32_BLOB / vector"),
          createElement("td", null, "Fixed-dimension float vector for embeddings")
        )
      )
    ),

    // Field Options
    createElement("h2", null, "Field Options"),
    createElement("p", null, "Every field builder accepts an optional options object:"),
    createElement("pre", null,
      createElement("code", null,
`interface FieldOptions {
  required?: boolean;    // NOT NULL constraint
  unique?: boolean;      // UNIQUE constraint
  default?: unknown;     // Default value ("now" for datetime auto-fill)
  min?: number;          // Minimum length (string) or value (number)
  max?: number;          // Maximum length (string) or value (number)
  updatedAt?: boolean;   // Auto-set to current time on update
  autoId?: boolean;      // Auto-generate UUID (set automatically by field.id())
  references?: string;   // Foreign key reference to another model name
}`
      )
    ),
    createElement("p", null, "Examples:"),
    createElement("pre", null,
      createElement("code", null,
`// Required string with length constraints
field.string({ required: true, min: 1, max: 200 })

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

// Vector embedding (1536 dimensions for OpenAI ada-002)
field.vector(1536)`
      )
    ),

    // Relations
    createElement("h2", null, "Relations"),
    createElement("p", null, "The ", createElement("code", null, "relation"),
      " helper defines how models connect to each other:"
    ),
    createElement("table", null,
      createElement("thead", null,
        createElement("tr", null,
          createElement("th", null, "Kind"),
          createElement("th", null, "Description"),
          createElement("th", null, "Options")
        )
      ),
      createElement("tbody", null,
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "belongsTo")),
          createElement("td", null, "This model has a FK pointing to another"),
          createElement("td", null, createElement("code", null, "foreignKey?: string"))
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "hasMany")),
          createElement("td", null, "Another model has a FK pointing here"),
          createElement("td", null, createElement("code", null, "foreignKey?: string"))
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "hasOne")),
          createElement("td", null, "Another model has a unique FK pointing here"),
          createElement("td", null, createElement("code", null, "foreignKey?: string"))
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "manyToMany")),
          createElement("td", null, "Related through a join table"),
          createElement("td", null, createElement("code", null, "through?: string"))
        )
      )
    ),
    createElement("pre", null,
      createElement("code", null,
`import { relation } from "@zauso-ai/capstan-db";

relation.belongsTo("user", { foreignKey: "assigneeId" })
relation.hasMany("ticket")
relation.hasOne("profile")
relation.manyToMany("tag", { through: "ticket_tags" })`
      )
    ),

    // Database Providers
    createElement("h2", null, "Database Providers"),
    createElement("p", null, "Capstan supports four database providers, each using Drizzle ORM with a provider-specific driver:"),
    createElement("table", null,
      createElement("thead", null,
        createElement("tr", null,
          createElement("th", null, "Provider"),
          createElement("th", null, "Driver"),
          createElement("th", null, "Connection URL Example")
        )
      ),
      createElement("tbody", null,
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "sqlite")),
          createElement("td", null, "better-sqlite3"),
          createElement("td", null, createElement("code", null, "./data.db"), " or ", createElement("code", null, ":memory:"))
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "libsql")),
          createElement("td", null, "@libsql/client"),
          createElement("td", null, createElement("code", null, "file:./data.db"), " or ", createElement("code", null, "libsql://db-name-org.turso.io"))
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "postgres")),
          createElement("td", null, "pg (node-postgres)"),
          createElement("td", null, createElement("code", null, "postgres://user:pass@host:5432/db"))
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "mysql")),
          createElement("td", null, "mysql2"),
          createElement("td", null, createElement("code", null, "mysql://user:pass@host:3306/db"))
        )
      )
    ),
    createElement("p", null, "Install the driver for your chosen provider:"),
    createElement("pre", null,
      createElement("code", null,
`# SQLite
npm install better-sqlite3 drizzle-orm

# libSQL / Turso
npm install @libsql/client drizzle-orm

# PostgreSQL
npm install pg drizzle-orm

# MySQL
npm install mysql2 drizzle-orm`
      )
    ),

    // Configuration
    createElement("h2", null, "Configuration"),
    createElement("p", null, "Configure the database in ", createElement("code", null, "capstan.config.ts"), ":"),
    createElement("pre", null,
      createElement("code", null,
`import { defineConfig, env } from "@zauso-ai/capstan-core";

export default defineConfig({
  app: { name: "my-app" },
  database: {
    provider: "sqlite",
    url: env("DATABASE_URL") || "./data.db",
  },
});`
      )
    ),
    createElement("p", null, "For edge-deployed apps, use the ",
      createElement("code", null, "libsql"), " provider with Turso:"
    ),
    createElement("pre", null,
      createElement("code", null,
`database: {
  provider: "libsql",
  url: env("TURSO_DATABASE_URL"),
  authToken: env("TURSO_AUTH_TOKEN"),
},`
      )
    ),

    // Migrations
    createElement("h2", null, "Migrations"),
    createElement("p", null,
      "Capstan provides a migration system that generates SQL from model definition diffs and tracks applied migrations in a ",
      createElement("code", null, "_capstan_migrations"), " table."
    ),
    createElement("table", null,
      createElement("thead", null,
        createElement("tr", null,
          createElement("th", null, "Command"),
          createElement("th", null, "Description")
        )
      ),
      createElement("tbody", null,
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "capstan db:migrate --name <name>")),
          createElement("td", null, "Generate a new migration from model changes")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "capstan db:push")),
          createElement("td", null, "Apply pending migrations directly (bypasses migration files)")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "capstan db:status")),
          createElement("td", null, "Show migration status (applied vs pending)")
        )
      )
    ),
    createElement("p", null, "The migration generator produces forward-only diffs:"),
    createElement("ul", null,
      createElement("li", null, "New models produce ", createElement("code", null, "CREATE TABLE"), " statements"),
      createElement("li", null, "New fields produce ", createElement("code", null, "ALTER TABLE ADD COLUMN"), " statements"),
      createElement("li", null, "New indexes produce ", createElement("code", null, "CREATE INDEX"), " statements"),
      createElement("li", null, "Removed models produce ", createElement("code", null, "DROP TABLE"), " statements")
    ),
    createElement("div", { className: "callout callout-warning" },
      createElement("strong", null, "Note: "),
      "Column drops, renames, and type changes are not handled automatically due to SQLite's limited ALTER TABLE support. These require manual migration files."
    ),

    // Auto-Generated CRUD
    createElement("h2", null, "Auto-Generated CRUD"),
    createElement("p", null, createElement("code", null, "generateCrudRoutes()"),
      " creates API route files from a model definition:"
    ),
    createElement("pre", null,
      createElement("code", null,
`import { generateCrudRoutes } from "@zauso-ai/capstan-db";
import { Ticket } from "./models/ticket.model.js";

const files = generateCrudRoutes(Ticket);
// Returns:
// [
//   { path: "tickets/index.api.ts", content: "..." },   // GET (list) + POST (create)
//   { path: "tickets/[id].api.ts", content: "..." },     // GET (by id) + PUT (update) + DELETE
// ]`
      )
    ),
    createElement("p", null, "The generated files include:"),
    createElement("ul", null,
      createElement("li", null, "Zod input/output schemas derived from the model fields"),
      createElement("li", null, createElement("code", null, "defineAPI()"), " handlers with proper capability and resource metadata"),
      createElement("li", null, createElement("code", null, 'policy: "requireAuth"'), " on all write endpoints"),
      createElement("li", null, "TODO comments where you plug in actual database queries")
    ),
    createElement("p", null, "Or use the CLI scaffolder:"),
    createElement("pre", null,
      createElement("code", null, "npx capstan add api tickets    # Generates CRUD routes for tickets")
    ),

    // RAG Primitives
    createElement("h2", null, "RAG Primitives"),
    createElement("p", null, "Capstan provides built-in support for vector embeddings and similarity search, enabling retrieval-augmented generation (RAG) workflows."),

    createElement("h3", null, "defineEmbedding()"),
    createElement("p", null, "Configure an embedding model to generate vectors from text:"),
    createElement("pre", null,
      createElement("code", null,
`import { defineEmbedding, openaiEmbeddings } from "@zauso-ai/capstan-db";

export const embeddings = defineEmbedding("text-embedding-3-small", {
  dimensions: 1536,
  adapter: openaiEmbeddings({ apiKey: env("OPENAI_API_KEY") }),
});`
      )
    ),

    createElement("h3", null, "Vector Fields"),
    createElement("p", null, "Add a ", createElement("code", null, "field.vector()"),
      " column to store embeddings alongside your data:"
    ),
    createElement("pre", null,
      createElement("code", null,
`export const Document = defineModel("document", {
  fields: {
    id: field.id(),
    content: field.text({ required: true }),
    embedding: field.vector(1536),
  },
});`
      )
    ),

    createElement("h3", null, "Vector Search"),
    createElement("p", null, "Query by similarity using cosine distance:"),
    createElement("pre", null,
      createElement("code", null,
`import { vectorSearch } from "@zauso-ai/capstan-db";

const results = await vectorSearch(db, {
  table: "documents",
  column: "embedding",
  query: await embeddings.embed("How do I reset my password?"),
  limit: 5,
});
// Returns rows ordered by cosine similarity`
      )
    ),

    // Table Naming
    createElement("h2", null, "Table Naming"),
    createElement("p", null, "Model names are automatically pluralized for table names:"),
    createElement("table", null,
      createElement("thead", null,
        createElement("tr", null,
          createElement("th", null, "Model Name"),
          createElement("th", null, "Table Name")
        )
      ),
      createElement("tbody", null,
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "ticket")),
          createElement("td", null, createElement("code", null, "tickets"))
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "company")),
          createElement("td", null, createElement("code", null, "companies"))
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "status")),
          createElement("td", null, createElement("code", null, "statuses"))
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "user")),
          createElement("td", null, createElement("code", null, "users"))
        )
      )
    )
  );
}
