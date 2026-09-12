# Migrations

Numbered SQL files, applied in order. `wrangler.jsonc` points `migrations_dir`
here, so wrangler knows about them.

## Applying them

With CLI access:

```sh
npm run db:migrate:local    # the local .wrangler/state copy
npm run db:migrate:remote   # the real database
npm run db:migrate:status   # what remote has applied
```

From the Cloudflare dashboard (D1 → profolio → Console), paste the contents of
each unapplied file, oldest first.

**If you apply by hand, also record it.** Wrangler decides what to run from the
`d1_migrations` table, not from the schema. A migration applied in the console
without a matching row there will be replayed the next time anyone runs
`db:migrate:remote`, and the `ALTER TABLE` statements will fail on columns that
already exist.

```sql
INSERT OR IGNORE INTO d1_migrations (name) VALUES ('00NN_whatever.sql');
```

## One-time bootstrap

This database predates any of that: 0001 to 0006 were applied in the console and
`d1_migrations` never existed. `scripts/d1-migrations-bootstrap.sql` creates it
and records everything up to 0007 as applied. Run it once per database, **after**
0007 has been applied, and the commands above work from then on.

## Writing one

- `CREATE TABLE IF NOT EXISTS` and `INSERT OR IGNORE` wherever possible, so a
  half-finished run can be repeated.
- SQLite has no `ADD COLUMN IF NOT EXISTS`. An `ALTER TABLE ... ADD COLUMN` will
  fail on a second run, which is exactly why the tracking table matters.
- Migrations that rewrite existing rows need a guard that makes a second run a
  no-op — see `0007_accounts.sql`, which skips owners already rekeyed.
- Never renumber or edit a file that has been applied anywhere. Add another.
