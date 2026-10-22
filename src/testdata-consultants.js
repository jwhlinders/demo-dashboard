const { Pool } = require("pg");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const TEST_PASSWORD = "Test2026!";
const consultants = [
  {
    voornaam: "Eva",
    tussenvoegsel: "",
    achternaam: "Mulder",
    username: "emulder",
    email: "eva.mulder@example.ta",
    functie: "Beheerder",
    telefoonnummer: "+31 20 000 0001",
    werkdagen: "MaDiWoDoVr",
    start_werkdag: "09:00",
    einde_werkdag: "17:00",
    start_pauze: "12:30",
  },
  {
    voornaam: "Jeroen",
    tussenvoegsel: "de",
    achternaam: "Dekker",
    username: "jdekker",
    email: "jeroen.dekker@example.ta",
    functie: "Huisarts",
    telefoonnummer: "+31 20 000 0002",
    werkdagen: "MaDiDoVr",
    start_werkdag: "08:30",
    einde_werkdag: "16:30",
    start_pauze: "12:00",
  },
  {
    voornaam: "Sanne",
    tussenvoegsel: "",
    achternaam: "Verhoeven",
    username: "sverhoeven",
    email: "sanne.verhoeven@example.ta",
    functie: "Psycholoog",
    telefoonnummer: "+31 20 000 0003",
    werkdagen: "MaWoDoVr",
    start_werkdag: "09:00",
    einde_werkdag: "17:30",
    start_pauze: "12:30",
  },
  {
    voornaam: "Thomas",
    tussenvoegsel: "van",
    achternaam: "Loon",
    username: "tvanloon",
    email: "thomas.vanloon@example.ta",
    functie: "Praktijkondersteuner GGZ",
    telefoonnummer: "+31 20 000 0004",
    werkdagen: "DiWoDoVr",
    start_werkdag: "08:30",
    einde_werkdag: "16:30",
    start_pauze: "12:00",
  },
  {
    voornaam: "Nadia",
    tussenvoegsel: "",
    achternaam: "Visser",
    username: "nvisser",
    email: "nadia.visser@example.ta",
    functie: "Fysiotherapeut",
    telefoonnummer: "+31 20 000 0005",
    werkdagen: "MaDiWoDo",
    start_werkdag: "09:00",
    einde_werkdag: "17:00",
    start_pauze: "13:00",
  },
];

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

    const locations = await database.query("SELECT idlocatie FROM locaties ORDER BY idlocatie");
    if (locations.rowCount === 0) {
      throw new Error("Er zijn geen locaties. Voeg eerst testlocaties toe met `npm run testdata:locaties`.");
    }

    let created = 0;
    for (let index = 0; index < consultants.length; index += 1) {
      const consultant = consultants[index];
      const existing = await database.query(`
        SELECT username, email
        FROM consultant
        WHERE LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($2)
      `, [consultant.username, consultant.email]);
      const matchingUsername = existing.rows.find(
        (row) => row.username.toLowerCase() === consultant.username.toLowerCase(),
      );
      const conflictingEmail = existing.rows.find(
        (row) => row.email.toLowerCase() === consultant.email.toLowerCase()
          && row.username.toLowerCase() !== consultant.username.toLowerCase(),
      );
      if (conflictingEmail) {
        throw new Error(`Het e-mailadres ${consultant.email} is al gekoppeld aan een ander consultantaccount.`);
      }
      if (matchingUsername) continue;

      const usernameConflict = await database.query(
        "SELECT username FROM klanten WHERE LOWER(username) = LOWER($1)",
        [consultant.username],
      );
      if (usernameConflict.rowCount > 0) {
        throw new Error(`De gebruikersnaam ${consultant.username} is al in gebruik door een cliënt.`);
      }

      await database.query(`
        INSERT INTO consultant (
          voornaam, tussenvoegsel, achternaam, username, email, functie, telefoonnummer,
          defaultlocatie, werkdagen, start_werkdag, einde_werkdag, start_pauze, password
        )
        VALUES ($1, NULLIF($2, ''), $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      `, [
        consultant.voornaam,
        consultant.tussenvoegsel,
        consultant.achternaam,
        consultant.username,
        consultant.email,
        consultant.functie,
        consultant.telefoonnummer,
        locations.rows[index % locations.rowCount].idlocatie,
        consultant.werkdagen,
        consultant.start_werkdag,
        consultant.einde_werkdag,
        consultant.start_pauze,
        TEST_PASSWORD,
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
