import type { AgentSkill } from "../types.js";
import type { SqliteConnection, SqliteStatement } from "../memory-sqlite.js";
import type {
  Experience,
  ExperienceQuery,
  Strategy,
  EvolutionStore,
  EvolutionStats,
  PruningConfig,
} from "./types.js";

/** Raw row shape for experiences. */
interface RawExperienceRow {
  id: string;
  goal: string;
  outcome: string;
  trajectory: string;
  iterations: number;
  token_usage: number;
  duration: number;
  skills_used: string | null;
  recorded_at: string;
  metadata: string | null;
}

/** Raw row shape for strategies. */
interface RawStrategyRow {
  id: string;
  content: string;
  source: string;
  utility: number;
  applications: number;
  created_at: string;
  updated_at: string;
}

/** Raw row shape for evolved skills. */
interface RawSkillRow {
  id: string;
  name: string;
  description: string;
  trigger_text: string;
  prompt: string;
  utility: number;
  tools: string | null;
  source: string | null;
  created_at: string;
  metadata: string | null;
}

/**
 * Persistent evolution store using SQLite.
 *
 * Compatible with both `better-sqlite3` and `bun:sqlite` Database.
 * Follows the same patterns as `SqliteMemoryBackend`.
 */
export class SqliteEvolutionStore implements EvolutionStore {
  private _db: SqliteConnection;

  constructor(db: SqliteConnection) {
    this._db = db;
    this._ensureTables();
  }

  private _ensureTables(): void {
    this._db.exec(`
      CREATE TABLE IF NOT EXISTS capstan_experiences (
        id TEXT PRIMARY KEY,
        goal TEXT NOT NULL,
        outcome TEXT NOT NULL,
        trajectory TEXT NOT NULL,
        iterations INTEGER NOT NULL,
        token_usage INTEGER NOT NULL,
        duration INTEGER NOT NULL,
        skills_used TEXT,
        recorded_at TEXT NOT NULL,
        metadata TEXT
      )
    `);

    this._db.exec(`
      CREATE TABLE IF NOT EXISTS capstan_strategies (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        source TEXT NOT NULL,
        utility REAL NOT NULL DEFAULT 0.5,
        applications INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

    this._db.exec(`
      CREATE TABLE IF NOT EXISTS capstan_evolved_skills (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        description TEXT NOT NULL,
        trigger_text TEXT NOT NULL,
        prompt TEXT NOT NULL,
        utility REAL NOT NULL DEFAULT 0.5,
        tools TEXT,
        source TEXT,
        created_at TEXT NOT NULL,
        metadata TEXT
      )
    `);

    this._db.exec(
      `CREATE INDEX IF NOT EXISTS idx_experiences_outcome ON capstan_experiences(outcome)`,
    );
    this._db.exec(
      `CREATE INDEX IF NOT EXISTS idx_strategies_utility ON capstan_strategies(utility DESC)`,
    );
  }

  async recordExperience(
    exp: Omit<Experience, "id" | "recordedAt">,
  ): Promise<string> {
    const id = `exp_${crypto.randomUUID()}`;
    const recordedAt = new Date().toISOString();

    this._db
      .prepare(
        `INSERT INTO capstan_experiences (id, goal, outcome, trajectory, iterations, token_usage, duration, skills_used, recorded_at, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        exp.goal,
        exp.outcome,
        JSON.stringify(exp.trajectory),
        exp.iterations,
        exp.tokenUsage,
        exp.duration,
        JSON.stringify(exp.skillsUsed),
        recordedAt,
        exp.metadata != null ? JSON.stringify(exp.metadata) : null,
      );

    return id;
  }

  async queryExperiences(query: ExperienceQuery): Promise<Experience[]> {
    let sql = `SELECT id, goal, outcome, trajectory, iterations, token_usage, duration, skills_used, recorded_at, metadata FROM capstan_experiences WHERE 1=1`;
    const params: unknown[] = [];

    if (query.outcome) {
      sql += ` AND outcome = ?`;
      params.push(query.outcome);
    }
    if (query.since) {
      sql += ` AND recorded_at >= ?`;
      params.push(query.since);
    }

    sql += ` ORDER BY recorded_at DESC`;
    sql += ` LIMIT ?`;
    params.push(query.limit ?? 50);

    const rows = this._db.prepare(sql).all(...params) as RawExperienceRow[];

    let results = rows.map(rowToExperience);

    // Client-side keyword filter on goal (after DB query for outcome/since filtering)
    if (query.goal) {
      const terms = query.goal
        .toLowerCase()
        .split(/\W+/)
        .filter((t) => t.length > 0);
      results = results.filter((e) => {
        const content = e.goal.toLowerCase();
        return terms.some((t) => content.includes(t));
      });
    }

    return results;
  }

  async storeStrategy(
    s: Omit<Strategy, "id" | "createdAt" | "updatedAt">,
  ): Promise<string> {
    const id = `strat_${crypto.randomUUID()}`;
    const now = new Date().toISOString();

    this._db
      .prepare(
        `INSERT INTO capstan_strategies (id, content, source, utility, applications, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, s.content, JSON.stringify(s.source), s.utility, s.applications, now, now);

    return id;
  }

  async queryStrategies(query: string, k: number): Promise<Strategy[]> {
    const rows = this._db
      .prepare(
        `SELECT id, content, source, utility, applications, created_at, updated_at FROM capstan_strategies ORDER BY utility DESC`,
      )
      .all() as RawStrategyRow[];

    if (!query) {
      return rows.slice(0, k).map(rowToStrategy);
    }

    const terms = query
      .toLowerCase()
      .split(/\W+/)
      .filter((t) => t.length > 0);

    if (terms.length === 0) {
      return rows.slice(0, k).map(rowToStrategy);
    }

    const scored = rows.map((row) => {
      const content = row.content.toLowerCase();
      const docTokens = content.split(/\W+/).filter((t) => t.length > 0);
      let hits = 0;
      for (const term of terms) {
        if (docTokens.some((dt) => dt.includes(term) || term.includes(dt))) {
          hits++;
        }
      }
      const score = hits / terms.length;
      return { row, score };
    });

    return scored
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || b.row.utility - a.row.utility)
      .slice(0, k)
      .map((x) => rowToStrategy(x.row));
  }

  async updateStrategyUtility(id: string, delta: number): Promise<void> {
    const now = new Date().toISOString();
    // Clamp to [0, 1] in SQL
    this._db
      .prepare(
        `UPDATE capstan_strategies SET utility = MAX(0, MIN(1, utility + ?)), updated_at = ? WHERE id = ?`,
      )
      .run(delta, now, id);
  }

  async incrementStrategyApplications(id: string): Promise<void> {
    const now = new Date().toISOString();
    this._db
      .prepare(
        `UPDATE capstan_strategies SET applications = applications + 1, updated_at = ? WHERE id = ?`,
      )
      .run(now, id);
  }

  async storeSkill(skill: AgentSkill): Promise<string> {
    const id = `skill_${crypto.randomUUID()}`;
    const now = new Date().toISOString();

    this._db
      .prepare(
        `INSERT INTO capstan_evolved_skills (id, name, description, trigger_text, prompt, utility, tools, source, created_at, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        skill.name,
        skill.description,
        skill.trigger,
        skill.prompt,
        skill.utility ?? 0.5,
        skill.tools != null ? JSON.stringify(skill.tools) : null,
        skill.source ?? null,
        now,
        skill.metadata != null ? JSON.stringify(skill.metadata) : null,
      );

    return id;
  }

  async querySkills(query: string, k: number): Promise<AgentSkill[]> {
    const rows = this._db
      .prepare(
        `SELECT id, name, description, trigger_text, prompt, utility, tools, source, created_at, metadata FROM capstan_evolved_skills`,
      )
      .all() as RawSkillRow[];

    if (!query) {
      return rows.slice(0, k).map(rowToSkill);
    }

    const terms = query
      .toLowerCase()
      .split(/\W+/)
      .filter((t) => t.length > 0);

    if (terms.length === 0) {
      return rows.slice(0, k).map(rowToSkill);
    }

    return rows
      .filter((row) => {
        const content =
          `${row.name} ${row.description} ${row.trigger_text}`.toLowerCase();
        return terms.some((t) => content.includes(t));
      })
      .slice(0, k)
      .map(rowToSkill);
  }

  async pruneStrategies(config: PruningConfig): Promise<number> {
    let pruned = 0;

    // Remove below minUtility
    if (config.minUtility !== undefined) {
      const result = this._db
        .prepare(
          `DELETE FROM capstan_strategies WHERE utility < ?`,
        )
        .run(config.minUtility);
      pruned += result.changes;
    }

    // Cap at maxStrategies, keeping highest utility
    if (config.maxStrategies !== undefined) {
      const count = (
        this._db
          .prepare(`SELECT COUNT(*) as cnt FROM capstan_strategies`)
          .get() as { cnt: number }
      ).cnt;

      if (count > config.maxStrategies) {
        // Get IDs to keep (top N by utility)
        const keepers = this._db
          .prepare(
            `SELECT id FROM capstan_strategies ORDER BY utility DESC LIMIT ?`,
          )
          .all(config.maxStrategies) as { id: string }[];

        const keepIds = keepers.map((r) => r.id);

        if (keepIds.length > 0) {
          // Delete everything not in the keep list
          const placeholders = keepIds.map(() => "?").join(",");
          const result = this._db
            .prepare(
              `DELETE FROM capstan_strategies WHERE id NOT IN (${placeholders})`,
            )
            .run(...keepIds);
          pruned += result.changes;
        }
      }
    }

    return pruned;
  }

  async getStats(): Promise<EvolutionStats> {
    const expCount = (
      this._db
        .prepare(`SELECT COUNT(*) as cnt FROM capstan_experiences`)
        .get() as { cnt: number }
    ).cnt;

    const stratCount = (
      this._db
        .prepare(`SELECT COUNT(*) as cnt FROM capstan_strategies`)
        .get() as { cnt: number }
    ).cnt;

    const skillCount = (
      this._db
        .prepare(`SELECT COUNT(*) as cnt FROM capstan_evolved_skills`)
        .get() as { cnt: number }
    ).cnt;

    const avgRow = this._db
      .prepare(
        `SELECT AVG(utility) as avg_utility FROM capstan_strategies`,
      )
      .get() as { avg_utility: number | null };

    return {
      totalExperiences: expCount,
      totalStrategies: stratCount,
      totalEvolvedSkills: skillCount,
      averageUtility: avgRow.avg_utility ?? 0,
    };
  }
}

/** Convert a raw SQLite row into an Experience. */
function rowToExperience(row: RawExperienceRow): Experience {
  const exp: Experience = {
    id: row.id,
    goal: row.goal,
    outcome: row.outcome as Experience["outcome"],
    trajectory: [],
    iterations: row.iterations,
    tokenUsage: row.token_usage,
    duration: row.duration,
    skillsUsed: [],
    recordedAt: row.recorded_at,
  };

  try {
    exp.trajectory = JSON.parse(row.trajectory);
  } catch {
    /* corrupted -- default to empty */
  }
  if (row.skills_used != null) {
    try {
      exp.skillsUsed = JSON.parse(row.skills_used);
    } catch {
      /* corrupted -- default to empty */
    }
  }
  if (row.metadata != null) {
    try {
      exp.metadata = JSON.parse(row.metadata) as Record<string, unknown>;
    } catch {
      /* corrupted -- skip */
    }
  }

  return exp;
}

/** Convert a raw SQLite row into a Strategy. */
function rowToStrategy(row: RawStrategyRow): Strategy {
  let source: string[] = [];
  try {
    source = JSON.parse(row.source);
  } catch {
    /* corrupted -- default to empty */
  }

  return {
    id: row.id,
    content: row.content,
    source,
    utility: row.utility,
    applications: row.applications,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Convert a raw SQLite row into an AgentSkill. */
function rowToSkill(row: RawSkillRow): AgentSkill {
  const skill: AgentSkill = {
    name: row.name,
    description: row.description,
    trigger: row.trigger_text,
    prompt: row.prompt,
    utility: row.utility,
    source: (row.source as AgentSkill["source"]) ?? undefined,
  };

  if (row.tools != null) {
    try {
      skill.tools = JSON.parse(row.tools) as string[];
    } catch {
      /* corrupted -- skip */
    }
  }
  if (row.metadata != null) {
    try {
      skill.metadata = JSON.parse(row.metadata) as Record<string, unknown>;
    } catch {
      /* corrupted -- skip */
    }
  }

  return skill;
}

/**
 * Create a SQLite-backed evolution store.
 *
 * @param pathOrDb - Path to SQLite file, or an existing database connection
 */
export async function createSqliteEvolutionStore(
  pathOrDb: string | SqliteConnection,
  opts?: Record<string, unknown>,
): Promise<SqliteEvolutionStore> {
  if (typeof pathOrDb === "string") {
    try {
      const mod = await import("better-sqlite3");
      const Database = mod.default;
      const db = new Database(pathOrDb);
      db.pragma("journal_mode = WAL");
      return new SqliteEvolutionStore(db);
    } catch {
      throw new Error(
        "better-sqlite3 is required for SqliteEvolutionStore. Install it: npm install better-sqlite3",
      );
    }
  }
  return new SqliteEvolutionStore(pathOrDb);
}
