import { test, expect } from "@playwright/test";

type TestDatabasePool = {
  query: (sql: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
  end: () => Promise<void>;
};

const { Pool }: { Pool: new (options: { connectionString: string }) => TestDatabasePool } = require("pg");

test("migrates customer address links without changing their address IDs", async () => {
  test.skip(!process.env.CI, "The address migration fixture is initialized in CI.");

  const database = new Pool({ connectionString: process.env.DATABASE_URL! });
  try {
    const customers = await database.query(`
      SELECT id, idadres
      FROM klanten
      WHERE username IN ('ci-clienta', 'ci-clientb')
      ORDER BY id
    `);
    expect(customers.rows).toEqual([
      { id: 1, idadres: 501 },
      { id: 2, idadres: 502 },
    ]);

    const addressColumns = await database.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'adres'
        AND column_name IN ('idklant', 'postcode', 'woonplaats')
      ORDER BY column_name
    `);
    expect(addressColumns.rows).toEqual([
      { column_name: "postcode" },
      { column_name: "woonplaats" },
    ]);

    const addressForeignKey = await database.query(`
      SELECT pg_get_constraintdef(constraint_row.oid) AS definition
      FROM pg_constraint AS constraint_row
      WHERE constraint_row.conrelid = 'klanten'::regclass
        AND constraint_row.conname = 'klanten_idadres_fkey'
    `);
    expect(addressForeignKey.rows).toEqual([
      { definition: "FOREIGN KEY (idadres) REFERENCES adres(idadres)" },
    ]);

    const consultantAddressColumn = await database.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'consultant'
        AND column_name = 'idadres'
    `);
    expect(consultantAddressColumn.rows).toEqual([{ column_name: "idadres" }]);

    const consultantAddressForeignKey = await database.query(`
      SELECT pg_get_constraintdef(constraint_row.oid) AS definition
      FROM pg_constraint AS constraint_row
      WHERE constraint_row.conrelid = 'consultant'::regclass
        AND constraint_row.conname = 'consultant_idadres_fkey'
    `);
    expect(consultantAddressForeignKey.rows).toEqual([
      { definition: "FOREIGN KEY (idadres) REFERENCES adres(idadres)" },
    ]);
  } finally {
    await database.end();
  }
});
