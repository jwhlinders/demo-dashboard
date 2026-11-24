const { randomBytes, scrypt } = require("node:crypto");
const { promisify } = require("node:util");
const { Pool } = require("pg");
const { fakerNL } = require("@faker-js/faker");
const scryptAsync = promisify(scrypt);

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const TEST_PASSWORD = "Test1234!";

const RECORDS_PER_RUN = 7;
const MAX_RECORDS_IN_DB = 10;

const MOGELIJKE_TUSSENVOEGSELS = [
  { weight: 60, value: "" },
  { weight: 6, value: "van" },
  { weight: 5, value: "de" },
  { weight: 20, value: "van der" },
  { weight: 4, value: "van de" },
];

async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const passwordHash = await scryptAsync(password, salt, 64);
  return `scrypt$${salt}$${passwordHash.toString("hex")}`;
}


function maakNieuwKlant() {
  const voornaam = fakerNL.person.firstName();
  const tussenvoegsel = fakerNL.helpers.weightedArrayElement(MOGELIJKE_TUSSENVOEGSELS);
  const achternaam = fakerNL.person.lastName().trim().split(" ").pop();

  // Maak naamdelen schoon voor e-mail en username (kleine letters, geen spaties of leestekens)
  const schoneVoornaam = voornaam.toLowerCase().replace(/[^a-z]/g, "");
  const schoneAchternaam = achternaam.toLowerCase().replace(/[^a-z]/g, "");

  return {
    voornaam,
    tussenvoegsel,
    achternaam,
    username: `${schoneVoornaam.charAt(0)}${schoneAchternaam}`,
    email: `${schoneVoornaam}.${schoneAchternaam}@test.kl`,
    telefoonnummer: `06${fakerNL.string.numeric(8)}`,
    adres: {
      straat: `${fakerNL.location.street()} ${fakerNL.location.buildingNumber()}`,
      huisnummer: fakerNL.location.buildingNumber(),
      postcode: fakerNL.location.zipCode('####??'), // bijv. '1234AB' (6 tekens)
      plaats: fakerNL.location.city(),
    },
  };
}

const klanten = fakerNL.helpers.multiple(maakNieuwKlant, { count: RECORDS_PER_RUN });

async function seedKlanten() {
  if (!process.env.DATABASE_URL) {
    throw new Error("Stel DATABASE_URL in voordat testklanten worden toegevoegd.");
  }

  const database = await pool.connect();
  try {
    await database.query("BEGIN");
    await database.query("SELECT pg_advisory_xact_lock(741852963)");

    const tables = await database.query(`
      SELECT to_regclass('klanten') AS klanten_table,
             to_regclass('adres') AS adres_table
    `);
    if (!tables.rows[0].klanten_table || !tables.rows[0].adres_table) {
      throw new Error("De tabellen klanten en adres ontbreken. Initialiseer eerst het databaseschema.");
    }
    const existingKlanten = await database.query("SELECT COUNT(*)::int AS aantal FROM klanten");
    const aantalBestaand = existingKlanten.rows[0].aantal;
    const maximaleNieuweKlanten = Math.max(0, MAX_RECORDS_IN_DB - aantalBestaand);

    if (maximaleNieuweKlanten === 0) {
      await database.query("COMMIT");
      console.log(`Testklanten toevoegen overgeslagen: er bestaan al ${aantalBestaand} klanten (maximum ${MAX_RECORDS_IN_DB}).`);
      return;
    }

    let created = 0;

    for (let index = 0; index < klanten.length && created < maximaleNieuweKlanten; index += 1) {
      const klant = klanten[index];

      // 1. Controleer of de username al bestaat in de tabel consultant (case-insensitive)
      const existing = await database.query(
        "SELECT username FROM consultant WHERE LOWER(username) = LOWER($1)",
        [klant.username],
      );
    

      if (existing.rowCount > 0) {
        continue;
      }

      // 2. Controleer of de username niet al in gebruik is door een cliënt
      const usernameConflict = await database.query(
        "SELECT username FROM klanten WHERE LOWER(username) = LOWER($1)",
        [klant.username],
      );

      if (usernameConflict.rowCount > 0) {
        continue;
      }

      // 4a. Voeg eerst het adres toe en vang het nieuwe 'idadres' op
      const adresResult = await database.query(`
        INSERT INTO adres (straat, postcode, woonplaats)
        VALUES ($1, $2, $3)
        RETURNING idadres
      `, [
        klant.adres.straat,
        klant.adres.postcode,
        klant.adres.plaats,
      ]);

      const nieuwAdresId = adresResult.rows[0].idadres;

      // 4. Voeg de nieuwe klant toe aan de database
      await database.query(`
        INSERT INTO klanten (
          voornaam, tussenvoegsel, achternaam, username, email, telefoonnummer,
          password, idadres, aanmaakdatum
        )
        VALUES ($1, NULLIF($2, ''), $3, $4, $5, $6, $7, $8, $9)
      `, [
        klant.voornaam,
        klant.tussenvoegsel,
        klant.achternaam,
        klant.username,
        klant.email,
        klant.telefoonnummer,
        await hashPassword(TEST_PASSWORD),
        nieuwAdresId,
        new Date().toISOString(), // aanmaakdatum
      ]);

      created += 1;
    }

    await database.query("COMMIT");
    console.log(`Testklanten toegevoegd: ${created}; al aanwezig overgeslagen: ${klanten.length - created}.`);
    console.log(`Voor alle testklanten is het tijdelijke wachtwoord: ${TEST_PASSWORD}`);
    console.log("Deze accounts zijn uitsluitend bedoeld voor een lokale testdatabase.");
  } catch (error) {
    await database.query("ROLLBACK");
    throw error;
  } finally {
    database.release();
  }
}

seedKlanten()
  .catch((error) => {
    console.error(`Testklanten toevoegen mislukt: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());


