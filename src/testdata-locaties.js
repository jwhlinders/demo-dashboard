const { Pool } = require("pg");
const { fakerNL } = require("@faker-js/faker");

const RECORDS_PER_RUN = 5;
const MAX_RECORDS_IN_DB = 15;

function maakNieuwLocatie() {
  const plaats = fakerNL.location.city();

  return {
    naam: `Locatie ${plaats}`,
    plaats,
    postcode: fakerNL.location.zipCode('####??'),
    adres: `${fakerNL.location.street()} ${fakerNL.location.buildingNumber()}`,
    telefoonnummer: fakerNL.helpers.fromRegExp("0[1-57][0-9]-[1-9][0-9]{6}"),
  };
}


async function seedTestData(databasePool) {
  const database = await databasePool.connect();

  try {
    await database.query("BEGIN");
    await database.query("LOCK TABLE locaties IN EXCLUSIVE MODE");

    const existingLocaties = await database.query("SELECT COUNT(*)::int AS aantal FROM locaties");
    const aantalBestaand = existingLocaties.rows[0].aantal;
    const maximaleNieuweLocaties = Math.max(0, MAX_RECORDS_IN_DB - aantalBestaand);

    if (maximaleNieuweLocaties === 0) {
      await database.query("COMMIT");
      console.log(`Testlocaties toevoegen overgeslagen: er bestaan al ${aantalBestaand} locaties (maximum ${MAX_RECORDS_IN_DB}).`);
      return;
    }
    
    const locations = fakerNL.helpers.multiple(maakNieuwLocatie, {
      count: Math.min(RECORDS_PER_RUN, maximaleNieuweLocaties),
    });
    const names = locations.map((location) => location.naam);

    const existing = await database.query(
      "SELECT naam FROM locaties WHERE naam = ANY($1)",
      [names],
    );

    const bestaandeNamen = new Set(existing.rows.map((row) => row.naam));
    const uniekeLocations = [];

    for (const loc of locations) {
      if (!bestaandeNamen.has(loc.naam)) {
        bestaandeNamen.add(loc.naam); // Voorkomt ook dubbele namen binnen deze run
        uniekeLocations.push(loc);
      }
    }

    if (uniekeLocations.length > 0) {
      // 1. Haal het huidige hoogste idlocatie op (0 als de tabel nog leeg is)
      const maxResult = await database.query(
        "SELECT COALESCE(MAX(idlocatie), 0) AS max_id FROM locaties"
      );
      let NextID = Number(maxResult.rows[0].max_id) + 1;

      // 2. Voeg elk uniek record toe met het oplopende volgnummer
      for (const loc of uniekeLocations) {
        await database.query(
          "INSERT INTO locaties (naam, adres, postcode, plaats, telefoonnummer, actief, idlocatie) VALUES ($1, $2, $3, $4, $5, B'1', $6)",
          [loc.naam, loc.adres, loc.postcode, loc.plaats, loc.telefoonnummer, NextID]
        );
        NextID++;
      }
    }


    await database.query("COMMIT");
    console.log(`Testlocaties toegevoegd: ${uniekeLocations.length}; al aanwezig overgeslagen: ${locations.length - uniekeLocations.length}.`);
    console.log("Deze locaties zijn uitsluitend bedoeld voor testdoeleinden.");
  } catch (error) {
    await database.query("ROLLBACK");
    throw error;
  } finally {
    database.release();
  }
}

module.exports = { maakNieuwLocatie, seedTestData };

if (require.main === module) {
  if (!process.env.DATABASE_URL) {
    throw new Error("Stel DATABASE_URL in voordat testdata wordt toegevoegd.");
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  seedTestData(pool)
    .catch((error) => {
      console.error(`Testdata toevoegen mislukt: ${error.message}`);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
