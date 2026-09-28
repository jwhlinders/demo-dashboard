const { randomBytes, scrypt } = require("node:crypto");
const { promisify } = require("node:util");

const scryptAsync = promisify(scrypt);
const DEFAULT_CLIENT_PASSWORD = "Welkom01";

function makeAccountBase(firstName, lastName) {
  const accountBase = `${firstName.trim()[0]}${lastName.trim()}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "");
  return (accountBase || "client").slice(0, 80);
}

async function runMigrations(pool) {
  await pool.query("ALTER TABLE consultant ADD COLUMN IF NOT EXISTS username VARCHAR(80) NOT NULL DEFAULT 'consultant'");
  await pool.query(`ALTER TABLE consultant ADD COLUMN IF NOT EXISTS password VARCHAR(255) NOT NULL DEFAULT '${DEFAULT_CLIENT_PASSWORD}'`);
  await pool.query("ALTER TABLE klanten ADD COLUMN IF NOT EXISTS username VARCHAR(80)");
  await pool.query("ALTER TABLE klanten ADD COLUMN IF NOT EXISTS password VARCHAR(255)");

  const accountDatabase = await pool.connect();
  try {
    await accountDatabase.query("BEGIN");
    await accountDatabase.query("SELECT pg_advisory_xact_lock(741852963)");
    const customersWithoutAccounts = await accountDatabase.query(`
      SELECT ctid::text AS row_id, voornaam, achternaam
      FROM klanten
      WHERE NULLIF(TRIM(username), '') IS NULL
        AND NULLIF(TRIM(voornaam), '') IS NOT NULL
        AND NULLIF(TRIM(achternaam), '') IS NOT NULL
      ORDER BY LOWER(achternaam), LOWER(voornaam)
    `);
    for (const customer of customersWithoutAccounts.rows) {
      const base = makeAccountBase(customer.voornaam, customer.achternaam);
      let username = base;
      let suffix = 2;
      while (true) {
        const existingAccount = await accountDatabase.query(`
          SELECT EXISTS (
            SELECT 1 FROM klanten WHERE LOWER(username) = LOWER($1)
            UNION ALL
            SELECT 1 FROM consultant WHERE LOWER(username) = LOWER($1)
          ) AS exists
        `, [username]);
        if (!existingAccount.rows[0].exists) break;
        const suffixText = String(suffix++);
        username = `${base.slice(0, 80 - suffixText.length)}${suffixText}`;
      }
      await accountDatabase.query("UPDATE klanten SET username = $1 WHERE ctid = $2::tid", [username, customer.row_id]);
    }

    const customersWithoutPasswords = await accountDatabase.query(`
      SELECT ctid::text AS row_id
      FROM klanten
      WHERE NULLIF(TRIM(password), '') IS NULL
    `);
    for (const customer of customersWithoutPasswords.rows) {
      const salt = randomBytes(16).toString("hex");
      const hash = await scryptAsync(DEFAULT_CLIENT_PASSWORD, salt, 64);
      await accountDatabase.query("UPDATE klanten SET password = $1 WHERE ctid = $2::tid", [
        `scrypt$${salt}$${hash.toString("hex")}`,
        customer.row_id,
      ]);
    }
    await accountDatabase.query("COMMIT");
  } catch (error) {
    await accountDatabase.query("ROLLBACK");
    throw error;
  } finally {
    accountDatabase.release();
  }

  await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS klanten_username_unique ON klanten (LOWER(username))");
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'consultant' AND column_name = 'gebruikersnaam'
      ) THEN
        UPDATE consultant
        SET username = COALESCE(NULLIF(TRIM(gebruikersnaam), ''), username);
        ALTER TABLE consultant DROP COLUMN gebruikersnaam;
      END IF;
    END $$;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS appointments (
      id UUID PRIMARY KEY,
      appointment_date DATE NOT NULL,
      client VARCHAR(80) NOT NULL,
      start_time TIME NOT NULL,
      duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
      notes VARCHAR(200) NOT NULL DEFAULT '',
      consultant_username VARCHAR(80),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query("ALTER TABLE appointments ADD COLUMN IF NOT EXISTS consultant_username VARCHAR(80)");
  await pool.query("ALTER TABLE appointments ADD COLUMN IF NOT EXISTS client_username VARCHAR(80)");
  await pool.query("CREATE INDEX IF NOT EXISTS appointments_client_username_idx ON appointments (client_username)");
  await pool.query(`
    UPDATE appointments AS appointment
    SET client_username = customer.username
    FROM (
      SELECT TRIM(CONCAT_WS(' ', NULLIF(TRIM(voornaam), ''), NULLIF(TRIM(tussenvoegsel), ''), NULLIF(TRIM(achternaam), ''))) AS client_name,
             MIN(username) AS username
      FROM klanten
      WHERE username IS NOT NULL
        AND NULLIF(TRIM(voornaam), '') IS NOT NULL
        AND NULLIF(TRIM(achternaam), '') IS NOT NULL
      GROUP BY TRIM(voornaam), TRIM(tussenvoegsel), TRIM(achternaam)
      HAVING COUNT(*) = 1
    ) AS customer
    WHERE appointment.client_username IS NULL
      AND appointment.client = customer.client_name
  `);
}

module.exports = { DEFAULT_CLIENT_PASSWORD, makeAccountBase, runMigrations };
