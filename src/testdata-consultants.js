const { Pool } = require("pg");
const { fakerNL } = require("@faker-js/faker");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const TEST_PASSWORD = "Test2026!";

const RECORDS_PER_RUN = 10;
const MAX_RECORDS_IN_DB = 20;

const MOGELIJKE_FUNCTIES = [
  "Huisarts",
  "Psycholoog",
  "Praktijkondersteuner GGZ",
  "Fysiotherapeut",
];

const MOGELIJKE_TUSSENVOEGSELS = [
  { weight: 80, value: "" },
  { weight: 6, value: "van" },
  { weight: 5, value: "de" },
  { weight: 5, value: "van der" },
  { weight: 4, value: "van de" },
];

const MOGELIJKE_WERKDAGEN = [
  { weight: 50, value: "MaDiWoDoVr" },
  { weight: 5, value: "MaDiWo" },
  { weight: 10, value: "MaWo" },
  { weight: 10, value: "DiDo" },
  { weight: 25, value: "MaDiWoDo" },
];

function maakNieuwConsultant() {
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
    email: `${schoneVoornaam}.${schoneAchternaam}@example.ta`,
    functie: fakerNL.helpers.arrayElement(MOGELIJKE_FUNCTIES),
    werkdagen: fakerNL.helpers.weightedArrayElement(MOGELIJKE_WERKDAGEN),
    start_werkdag: "08:30",
    einde_werkdag: "17:00",
    start_pauze: "12:30",
    telefoonnummer: `06${fakerNL.string.numeric(8)}`,
    adres: {
      straat: `${fakerNL.location.street()} ${fakerNL.location.buildingNumber()}`,
      huisnummer: fakerNL.location.buildingNumber(),
      postcode: fakerNL.location.zipCode('####??'), // bijv. '1234AB' (6 tekens)
      plaats: fakerNL.location.city(),
    },
  };
}

const consultants = fakerNL.helpers.multiple(maakNieuwConsultant, { count: RECORDS_PER_RUN });

async function seedConsultants() {
  if (!process.env.DATABASE_URL) {
    throw new Error("Stel DATABASE_URL in voordat testconsultants worden toegevoegd.");
  }

  const database = await pool.connect();
  try {
    await database.query("BEGIN");
    await database.query("SELECT pg_advisory_xact_lock(741852963)");

    const tables = await database.query(`
      SELECT to_regclass('consultant') AS consultant_table,
             to_regclass('klanten') AS klanten_table,
             to_regclass('locaties') AS locaties_table
    `);
    if (!tables.rows[0].consultant_table || !tables.rows[0].klanten_table || !tables.rows[0].locaties_table) {
      throw new Error("De tabellen consultant, klanten en locaties ontbreken. Initialiseer eerst het databaseschema.");
    }
    const existingConsultants = await database.query("SELECT COUNT(*)::int AS aantal FROM consultant");
    const aantalBestaand = existingConsultants.rows[0].aantal;
    const maximaleNieuweConsultants = Math.max(0, MAX_RECORDS_IN_DB - aantalBestaand);

    if (maximaleNieuweConsultants === 0) {
      await database.query("COMMIT");
      console.log(`Testconsultants toevoegen overgeslagen: er bestaan al ${aantalBestaand} consultants (maximum ${MAX_RECORDS_IN_DB}).`);
      return;
    }

    const locations = await database.query("SELECT idlocatie FROM locaties ORDER BY idlocatie");
    if (locations.rowCount === 0) {
      throw new Error("Er zijn geen locaties. Voeg locaties toe met `npm run testdata:locaties`.");
    }

    let created = 0;

    for (let index = 0; index < consultants.length && created < maximaleNieuweConsultants; index += 1) {
      const consultant = consultants[index];

      // 1. Controleer of de username al bestaat in de tabel consultant
      const existing = await database.query(
        "SELECT username FROM consultant WHERE LOWER(username) = LOWER($1)",
        [consultant.username],
      );

      if (existing.rowCount > 0) {
        continue;
      }

      // 2. Controleer of de username niet al in gebruik is door een cliënt
      const usernameConflict = await database.query(
        "SELECT username FROM klanten WHERE LOWER(username) = LOWER($1)",
        [consultant.username],
      );

      if (usernameConflict.rowCount > 0) {
        continue;
      }

      // 3. Kies een willekeurige locatie uit alle beschikbare locaties
      const randomIndex = Math.floor(Math.random() * locations.rows.length);
      const randomLocatieId = locations.rows[randomIndex].idlocatie;

      // 4a. Voeg eerst het adres toe en vang het nieuwe 'idadres' op
      const adresResult = await database.query(`
        INSERT INTO adres (straat, postcode, woonplaats)
        VALUES ($1, $2, $3)
        RETURNING idadres
      `, [
        consultant.adres.straat,
        consultant.adres.postcode,
        consultant.adres.plaats,
      ]);

      const nieuwAdresId = adresResult.rows[0].idadres;

      // 4. Voeg de nieuwe consultant toe aan de database
      await database.query(`
        INSERT INTO consultant (
          voornaam, tussenvoegsel, achternaam, username, email, functie, telefoonnummer,
          defaultlocatie, werkdagen, start_werkdag, einde_werkdag, start_pauze, password, idadres
        )
        VALUES ($1, NULLIF($2, ''), $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      `, [
        consultant.voornaam,
        consultant.tussenvoegsel,
        consultant.achternaam,
        consultant.username,
        consultant.email,
        consultant.functie,
        consultant.telefoonnummer,
        randomLocatieId,
        consultant.werkdagen,
        consultant.start_werkdag,
        consultant.einde_werkdag,
        consultant.start_pauze,
        TEST_PASSWORD,
        nieuwAdresId,
      ]);

      created += 1;
    }

    await database.query("COMMIT");
    console.log(`Testconsultants toegevoegd: ${created}; al aanwezig overgeslagen: ${consultants.length - created}.`);
    console.log(`Voor alle testconsultants is het tijdelijke wachtwoord: ${TEST_PASSWORD}`);
    console.log("Deze accounts zijn uitsluitend bedoeld voor een lokale testdatabase.");
  } catch (error) {
    await database.query("ROLLBACK");
    throw error;
  } finally {
    database.release();
  }
}

seedConsultants()
  .catch((error) => {
    console.error(`Testconsultants toevoegen mislukt: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());


