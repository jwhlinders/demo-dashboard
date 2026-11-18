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

async function migrateCustomerAddresses(pool) {
  const database = await pool.connect();
  try {
    await database.query("BEGIN");
    const tables = await database.query(`
      SELECT to_regclass('klanten') IS NOT NULL AS customers_exists,
             to_regclass('adres') IS NOT NULL AS addresses_exists
    `);
    if (!tables.rows[0].addresses_exists) {
      await database.query("COMMIT");
      return;
    }

    await database.query("ALTER TABLE adres ADD COLUMN IF NOT EXISTS postcode VARCHAR(6)");
    await database.query("ALTER TABLE adres ADD COLUMN IF NOT EXISTS woonplaats VARCHAR(50)");
    if (!tables.rows[0].customers_exists) {
      await database.query("COMMIT");
      return;
    }

    const columns = await database.query(`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name IN ('klanten', 'adres')
    `);
    const hasColumn = (tableName, columnName) => columns.rows.some(
      (column) => column.table_name === tableName && column.column_name === columnName,
    );
    if (!hasColumn("adres", "idklant")) {
      await database.query("COMMIT");
      return;
    }
    if (!hasColumn("adres", "idadres") || !hasColumn("klanten", "id")) {
      throw new Error("Cannot migrate customer addresses: expected adres.idadres and klanten.id columns.");
    }

    await database.query("LOCK TABLE klanten, adres IN ACCESS EXCLUSIVE MODE");
    const addressType = await database.query(`
      SELECT format_type(attribute.atttypid, attribute.atttypmod) AS data_type
      FROM pg_attribute AS attribute
      WHERE attribute.attrelid = to_regclass('adres')
        AND attribute.attname = 'idadres'
        AND NOT attribute.attisdropped
    `);
    const customerAddressType = await database.query(`
      SELECT format_type(attribute.atttypid, attribute.atttypmod) AS data_type
      FROM pg_attribute AS attribute
      WHERE attribute.attrelid = to_regclass('klanten')
        AND attribute.attname = 'idadres'
        AND NOT attribute.attisdropped
    `);
    if (customerAddressType.rowCount > 0 && customerAddressType.rows[0].data_type !== addressType.rows[0].data_type) {
      throw new Error("Cannot migrate customer addresses: klanten.idadres has a different type from adres.idadres.");
    }
    if (customerAddressType.rowCount === 0) {
      await database.query(`ALTER TABLE klanten ADD COLUMN idadres ${addressType.rows[0].data_type}`);
    }

    const multipleAddresses = await database.query(`
      SELECT idklant
      FROM adres
      WHERE idklant IS NOT NULL
      GROUP BY idklant
      HAVING COUNT(*) > 1
      LIMIT 1
    `);
    if (multipleAddresses.rowCount > 0) {
      throw new Error(`Cannot migrate customer addresses: customer ${multipleAddresses.rows[0].idklant} has multiple addresses.`);
    }
    const orphanedAddress = await database.query(`
      SELECT address.idadres, address.idklant
      FROM adres AS address
      LEFT JOIN klanten AS customer ON customer.id = address.idklant
      WHERE address.idklant IS NOT NULL
        AND customer.id IS NULL
      LIMIT 1
    `);
    if (orphanedAddress.rowCount > 0) {
      throw new Error(`Cannot migrate customer addresses: address ${orphanedAddress.rows[0].idadres} references missing customer ${orphanedAddress.rows[0].idklant}.`);
    }
    const conflictingAddress = await database.query(`
      SELECT customer.id
      FROM klanten AS customer
      INNER JOIN adres AS address ON address.idklant = customer.id
      WHERE customer.idadres IS NOT NULL
        AND customer.idadres <> address.idadres
      LIMIT 1
    `);
    if (conflictingAddress.rowCount > 0) {
      throw new Error(`Cannot migrate customer addresses: customer ${conflictingAddress.rows[0].id} already references a different address.`);
    }

    await database.query(`
      UPDATE klanten AS customer
      SET idadres = address.idadres
      FROM adres AS address
      WHERE address.idklant = customer.id
        AND customer.idadres IS NULL
    `);
    await database.query(`
      ALTER TABLE klanten
        ADD CONSTRAINT klanten_idadres_fkey
        FOREIGN KEY (idadres) REFERENCES adres (idadres)
    `);
    await database.query("ALTER TABLE adres DROP COLUMN idklant");
    await database.query("COMMIT");
  } catch (error) {
    await database.query("ROLLBACK");
    throw error;
  } finally {
    database.release();
  }
}

async function migrateConsultantAddresses(pool) {
  const database = await pool.connect();
  try {
    await database.query("BEGIN");
    const tables = await database.query(`
      SELECT to_regclass('consultant') IS NOT NULL AS consultants_exists,
             to_regclass('adres') IS NOT NULL AS addresses_exists
    `);
    if (!tables.rows[0].consultants_exists || !tables.rows[0].addresses_exists) {
      await database.query("COMMIT");
      return;
    }

    await database.query("LOCK TABLE consultant, adres IN ACCESS EXCLUSIVE MODE");
    const addressType = await database.query(`
      SELECT format_type(attribute.atttypid, attribute.atttypmod) AS data_type
      FROM pg_attribute AS attribute
      WHERE attribute.attrelid = to_regclass('adres')
        AND attribute.attname = 'idadres'
        AND NOT attribute.attisdropped
    `);
    if (addressType.rowCount === 0) {
      throw new Error("Cannot migrate consultant addresses: expected adres.idadres column.");
    }
    const consultantAddressType = await database.query(`
      SELECT format_type(attribute.atttypid, attribute.atttypmod) AS data_type
      FROM pg_attribute AS attribute
      WHERE attribute.attrelid = to_regclass('consultant')
        AND attribute.attname = 'idadres'
        AND NOT attribute.attisdropped
    `);
    if (
      consultantAddressType.rowCount > 0
      && consultantAddressType.rows[0].data_type !== addressType.rows[0].data_type
    ) {
      throw new Error("Cannot migrate consultant addresses: consultant.idadres has a different type from adres.idadres.");
    }
    if (consultantAddressType.rowCount === 0) {
      await database.query(`ALTER TABLE consultant ADD COLUMN idadres ${addressType.rows[0].data_type}`);
    }

    const matchingForeignKey = await database.query(`
      SELECT pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conrelid = to_regclass('consultant')
        AND contype = 'f'
        AND pg_get_constraintdef(oid) = 'FOREIGN KEY (idadres) REFERENCES adres(idadres)'
    `);
    if (matchingForeignKey.rowCount === 0) {
      const namedForeignKey = await database.query(`
        SELECT pg_get_constraintdef(oid) AS definition
        FROM pg_constraint
        WHERE conrelid = to_regclass('consultant')
          AND conname = 'consultant_idadres_fkey'
      `);
      if (
        namedForeignKey.rowCount > 0
        && namedForeignKey.rows[0].definition !== "FOREIGN KEY (idadres) REFERENCES adres(idadres)"
      ) {
        throw new Error("Cannot migrate consultant addresses: consultant_idadres_fkey already exists with a different definition.");
      }
      if (namedForeignKey.rowCount === 0) {
        await database.query(`
          ALTER TABLE consultant
            ADD CONSTRAINT consultant_idadres_fkey
            FOREIGN KEY (idadres) REFERENCES adres (idadres)
        `);
      }
    }
    await database.query("COMMIT");
  } catch (error) {
    await database.query("ROLLBACK");
    throw error;
  } finally {
    database.release();
  }
}

async function runMigrations(pool) {
  await migrateCustomerAddresses(pool);
  await migrateConsultantAddresses(pool);
  await pool.query("ALTER TABLE consultant ADD COLUMN IF NOT EXISTS username VARCHAR(80) NOT NULL DEFAULT 'consultant'");
  await pool.query(`ALTER TABLE consultant ADD COLUMN IF NOT EXISTS password VARCHAR(255) NOT NULL DEFAULT '${DEFAULT_CLIENT_PASSWORD}'`);
  await pool.query("ALTER TABLE consultant ADD COLUMN IF NOT EXISTS authorisatiecode VARCHAR(8)");
  await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS consultant_authorisatiecode_unique ON consultant (authorisatiecode) WHERE authorisatiecode IS NOT NULL");
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
      start_time TIME NOT NULL,
      duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
      notes VARCHAR(200) NOT NULL DEFAULT '',
      consultant_username VARCHAR(80),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query("ALTER TABLE appointments ADD COLUMN IF NOT EXISTS consultant_username VARCHAR(80)");
  await pool.query("ALTER TABLE appointments ADD COLUMN IF NOT EXISTS client_username VARCHAR(80)");
  await pool.query("ALTER TABLE appointments ADD COLUMN IF NOT EXISTS aangevraagd BOOLEAN NOT NULL DEFAULT FALSE");
  await pool.query("CREATE INDEX IF NOT EXISTS appointments_client_username_idx ON appointments (client_username)");
  const legacyClientColumn = await pool.query(`
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'appointments' AND column_name = 'client'
  `);
  if (legacyClientColumn.rowCount > 0) {
    await pool.query(`
      UPDATE appointments AS appointment
      SET client_username = customer.username
      FROM klanten AS customer
      WHERE appointment.id = ANY($1::uuid[])
        AND customer.username = $2
    `, [[
      "b4ba14ed-0e63-4353-960b-eadee6035e57",
      "4682d519-70f2-4a13-a568-ec40e5edb210",
      "0a928583-7781-46fb-8d45-853eec36c38c",
    ], "aberg"]);
    await pool.query(`
      WITH customer_names AS (
        SELECT username,
               LOWER(TRIM(CONCAT_WS(' ', NULLIF(TRIM(voornaam), ''), NULLIF(TRIM(tussenvoegsel), ''), NULLIF(TRIM(achternaam), '')))) AS full_name,
               LOWER(TRIM(CONCAT_WS(' ', NULLIF(TRIM(voornaam), ''), NULLIF(TRIM(achternaam), '')))) AS first_last_name
        FROM klanten
        WHERE username IS NOT NULL
          AND NULLIF(TRIM(voornaam), '') IS NOT NULL
          AND NULLIF(TRIM(achternaam), '') IS NOT NULL
      ), unique_names AS (
        SELECT normalized_name, MIN(username) AS username
        FROM (
          SELECT full_name AS normalized_name, username FROM customer_names
          UNION ALL
          SELECT first_last_name AS normalized_name, username FROM customer_names
        ) AS name_variants
        GROUP BY normalized_name
        HAVING COUNT(DISTINCT username) = 1
      )
      UPDATE appointments AS appointment
      SET client_username = customer.username
      FROM unique_names AS customer
      WHERE LOWER(BTRIM(appointment.client)) = customer.normalized_name
        AND (appointment.client_username IS NULL OR NOT EXISTS (
          SELECT 1 FROM klanten AS linked_customer WHERE linked_customer.username = appointment.client_username
        ))
    `);
  }

  const unresolvedAppointment = await pool.query(`
    SELECT appointment.id, appointment.client_username
    FROM appointments AS appointment
    LEFT JOIN klanten AS customer ON customer.username = appointment.client_username
    WHERE customer.username IS NULL
    ORDER BY appointment.appointment_date, appointment.start_time
  `);
  if (unresolvedAppointment.rowCount > 0) {
    const unresolvedDetails = unresolvedAppointment.rows.map(({ id, client_username }) => `${id} (${client_username || "no username"})`).join(", ");
    throw new Error(`Appointments cannot be linked to customer accounts: ${unresolvedDetails}. Resolve them before starting the server.`);
  }

  await pool.query("ALTER TABLE appointments DROP COLUMN IF EXISTS client");
  await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS klanten_username_exact_unique ON klanten (username)");
  await pool.query("ALTER TABLE appointments ALTER COLUMN client_username SET NOT NULL");
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'appointments_client_username_fkey'
          AND conrelid = 'appointments'::regclass
      ) THEN
        ALTER TABLE appointments
          ADD CONSTRAINT appointments_client_username_fkey
          FOREIGN KEY (client_username) REFERENCES klanten (username);
      END IF;
    END $$;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS password_reset_requests (
      id UUID PRIMARY KEY,
      client_username VARCHAR(80) NOT NULL,
      tracking_token_hash VARCHAR(64),
      status VARCHAR(20) NOT NULL DEFAULT 'nieuw',
      password_changed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      handled_at TIMESTAMPTZ,
      handled_by VARCHAR(80)
    )
  `);
  await pool.query("ALTER TABLE password_reset_requests DROP CONSTRAINT IF EXISTS password_reset_requests_client_username_fkey");
  await pool.query("ALTER TABLE password_reset_requests ADD COLUMN IF NOT EXISTS tracking_token_hash VARCHAR(64)");
  await pool.query("ALTER TABLE password_reset_requests ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'nieuw'");
  await pool.query("ALTER TABLE password_reset_requests ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ");
  await pool.query("UPDATE password_reset_requests SET status = 'afgehandeld' WHERE handled_at IS NOT NULL AND status = 'nieuw'");
  await pool.query("DROP INDEX IF EXISTS password_reset_requests_open_client_unique");
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS password_reset_requests_tracking_token_hash_unique
    ON password_reset_requests (tracking_token_hash)
    WHERE tracking_token_hash IS NOT NULL
  `);
}

module.exports = {
  DEFAULT_CLIENT_PASSWORD,
  makeAccountBase,
  migrateConsultantAddresses,
  migrateCustomerAddresses,
  runMigrations,
};
