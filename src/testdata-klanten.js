const { randomBytes, scrypt } = require("node:crypto");
const { promisify } = require("node:util");
const { Pool } = require("pg");
const { DEFAULT_CLIENT_PASSWORD } = require("./migraties");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const scryptAsync = promisify(scrypt);
const customers = [
  { voornaam: "Lotte", tussenvoegsel: "", achternaam: "Bakker", username: "lbakker", email: "lotte.bakker@example.invalid", telefoonnummer: "+31 6 0000 0001" },
  { voornaam: "Mohammed", tussenvoegsel: "", achternaam: "El Amrani", username: "melamrani", email: "mohammed.elamrani@example.invalid", telefoonnummer: "+31 6 0000 0002" },
  { voornaam: "Femke", tussenvoegsel: "van der", achternaam: "Meer", username: "fvandermeer", email: "femke.vandermeer@example.invalid", telefoonnummer: "+31 6 0000 0003" },
  { voornaam: "Daan", tussenvoegsel: "", achternaam: "Smit", username: "dsmit", email: "daan.smit@example.invalid", telefoonnummer: "+31 6 0000 0004" },
  { voornaam: "Aisha", tussenvoegsel: "", achternaam: "Yilmaz", username: "ayilmaz", email: "aisha.yilmaz@example.invalid", telefoonnummer: "+31 6 0000 0005" },
  { voornaam: "Pieter", tussenvoegsel: "de", achternaam: "Jong", username: "pdejong", email: "pieter.dejong@example.invalid", telefoonnummer: "+31 6 0000 0006" },
  { voornaam: "Noor", tussenvoegsel: "", achternaam: "van Dijk", username: "nvandijk", email: "noor.vandijk@example.invalid", telefoonnummer: "+31 6 0000 0007" },
  { voornaam: "Sam", tussenvoegsel: "", achternaam: "Kowalski", username: "skowalski", email: "sam.kowalski@example.invalid", telefoonnummer: "+31 6 0000 0008" },
  { voornaam: "Yara", tussenvoegsel: "ten", achternaam: "Hove", username: "ytenhove", email: "yara.tenhove@example.invalid", telefoonnummer: "+31 6 0000 0009" },
  { voornaam: "Milan", tussenvoegsel: "", achternaam: "Peters", username: "mpeters", email: "milan.peters@example.invalid", telefoonnummer: "+31 6 0000 0010" },
];

async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = await scryptAsync(password, salt, 64);
  return `scrypt$${salt}$${hash.toString("hex")}`;
}

async function seedCustomers() {
  if (!process.env.DATABASE_URL) {
    throw new Error("Stel DATABASE_URL in voordat testklanten worden toegevoegd.");
  }

  const database = await pool.connect();
  try {
    await database.query("BEGIN");
    await database.query("SELECT pg_advisory_xact_lock(741852963)");

    const tables = await database.query(`
      SELECT to_regclass('consultant') AS consultant_table,
             to_regclass('klanten') AS klanten_table
    `);
    if (!tables.rows[0].consultant_table || !tables.rows[0].klanten_table) {
      throw new Error("De tabellen consultant en klanten ontbreken. Initialiseer eerst het databaseschema.");
    }

    let created = 0;
    for (const customer of customers) {
      const existing = await database.query(`
        SELECT username, email
        FROM klanten
        WHERE LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($2)
      `, [customer.username, customer.email]);
      const matchingUsername = existing.rows.find(
        (row) => row.username?.toLowerCase() === customer.username.toLowerCase(),
      );
      const conflictingEmail = existing.rows.find(
        (row) => row.email?.toLowerCase() === customer.email.toLowerCase()
          && row.username?.toLowerCase() !== customer.username.toLowerCase(),
      );
      if (conflictingEmail) {
        throw new Error(`Het e-mailadres ${customer.email} is al gekoppeld aan een ander klantaccount.`);
      }
      if (matchingUsername) continue;

      const usernameConflict = await database.query(
        "SELECT username FROM consultant WHERE LOWER(username) = LOWER($1)",
        [customer.username],
      );
      if (usernameConflict.rowCount > 0) {
        throw new Error(`De gebruikersnaam ${customer.username} is al in gebruik door een consultant.`);
      }

      await database.query(`
        INSERT INTO klanten (
          voornaam, tussenvoegsel, achternaam, username, email, telefoonnummer, password
        )
        VALUES ($1, NULLIF($2, ''), $3, $4, $5, $6, $7)
      `, [
        customer.voornaam,
        customer.tussenvoegsel,
        customer.achternaam,
        customer.username,
        customer.email,
        customer.telefoonnummer,
        await hashPassword(DEFAULT_CLIENT_PASSWORD),
      ]);
      created += 1;
    }

    await database.query("COMMIT");
    console.log(`Testklanten toegevoegd: ${created}; al aanwezig overgeslagen: ${customers.length - created}.`);
    console.log(`Voor alle testklanten is het tijdelijke wachtwoord: ${DEFAULT_CLIENT_PASSWORD}`);
    console.log("Testklanten moeten dit wachtwoord na de eerste login wijzigen.");
    console.log("Deze accounts zijn uitsluitend bedoeld voor een lokale testdatabase.");
  } catch (error) {
    await database.query("ROLLBACK");
    throw error;
  } finally {
    database.release();
  }
}

seedCustomers()
  .catch((error) => {
    console.error(`Testklanten toevoegen mislukt: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
