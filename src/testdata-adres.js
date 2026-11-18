const { randomInt } = require("node:crypto");
const { Pool } = require("pg");

const places = [
  "Amsterdam", "Rotterdam", "Den Haag", "Utrecht", "Eindhoven",
  "Groningen", "Tilburg", "Almere", "Breda", "Nijmegen",
  "Apeldoorn", "Haarlem", "Arnhem", "Enschede", "Amersfoort",
  "Zaanstad", "'s-Hertogenbosch", "Zwolle", "Zoetermeer", "Leiden",
  "Maastricht", "Dordrecht", "Ede", "Leeuwarden", "Venlo",
  "Delft", "Deventer", "Alkmaar", "Helmond", "Heerlen",
  "Hoorn", "Assen", "Gouda", "Hilversum", "Purmerend",
  "Roosendaal", "Schiedam", "Veenendaal", "Zeist", "Emmen",
];
const streetNames = [
  "Stationsweg", "Dorpsstraat", "Kerkstraat", "Wilhelminastraat", "Parklaan",
  "Molenstraat", "Schoolstraat", "Beukenlaan", "Julianalaan", "Havenstraat",
];
const postcodeLetters = "ABCDEFGHJKLMNPRTVWXYZ";

function createAddress(place) {
  const firstLetter = postcodeLetters[randomInt(postcodeLetters.length)];
  const secondLetter = postcodeLetters[randomInt(postcodeLetters.length)];
  return {
    straat: `${streetNames[randomInt(streetNames.length)]} ${randomInt(1, 250)}`,
    postcode: `${randomInt(1000, 10000)}${firstLetter}${secondLetter}`,
    woonplaats: place,
  };
}

async function addMissingAddresses(database, tableName, entities, usedPlaces, entityName) {
  const unassignedEntities = entities.filter((entity) => entity.idadres === null);
  const availablePlaces = places.filter((place) => !usedPlaces.has(place.toLocaleLowerCase("nl-NL")));
  if (unassignedEntities.length > availablePlaces.length) {
    throw new Error(`Er zijn ${unassignedEntities.length} ${entityName} zonder adres, maar slechts ${availablePlaces.length} ongebruikte plaatsnamen beschikbaar.`);
  }

  for (let index = 0; index < unassignedEntities.length; index += 1) {
    const entity = unassignedEntities[index];
    const address = createAddress(availablePlaces[index]);
    const insertedAddress = await database.query(`
      INSERT INTO adres (straat, postcode, woonplaats)
      VALUES ($1, $2, $3)
      RETURNING idadres
    `, [address.straat, address.postcode, address.woonplaats]);
    const linkedEntity = await database.query(
      `UPDATE ${tableName} SET idadres = $1 WHERE id = $2 AND idadres IS NULL`,
      [insertedAddress.rows[0].idadres, entity.id],
    );
    if (linkedEntity.rowCount !== 1) {
      throw new Error(`Het adres van ${entityName} ${entity.id} kon niet worden gekoppeld.`);
    }
  }

  return unassignedEntities.length;
}

async function getLinkedPlaces(database, tableName) {
  const result = await database.query(`
    SELECT LOWER(TRIM(address.woonplaats)) AS woonplaats
    FROM ${tableName} AS entity
    INNER JOIN adres AS address ON address.idadres = entity.idadres
    WHERE NULLIF(TRIM(address.woonplaats), '') IS NOT NULL
  `);
  return new Set(result.rows.map((row) => row.woonplaats));
}

async function seedAddressTestData(databasePool) {
  const database = await databasePool.connect();
  try {
    await database.query("BEGIN");
    const tables = await database.query(`
      SELECT to_regclass('klanten') AS klanten_table,
             to_regclass('consultant') AS consultant_table,
             to_regclass('adres') AS adres_table
    `);
    if (!tables.rows[0].klanten_table || !tables.rows[0].consultant_table || !tables.rows[0].adres_table) {
      throw new Error("De tabellen klanten, consultant en adres ontbreken. Initialiseer eerst het databaseschema.");
    }

    const requiredColumns = await database.query(`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND ((table_name IN ('klanten', 'consultant') AND column_name IN ('id', 'idadres'))
          OR (table_name = 'adres' AND column_name IN ('idadres', 'straat', 'postcode', 'woonplaats')))
    `);
    const hasColumn = (tableName, columnName) => requiredColumns.rows.some(
      (column) => column.table_name === tableName && column.column_name === columnName,
    );
    if (
      !hasColumn("klanten", "id")
      || !hasColumn("klanten", "idadres")
      || !hasColumn("consultant", "id")
      || !hasColumn("consultant", "idadres")
      || !hasColumn("adres", "idadres")
      || !hasColumn("adres", "straat")
      || !hasColumn("adres", "postcode")
      || !hasColumn("adres", "woonplaats")
    ) {
      throw new Error("Het adresschema is onvolledig. Voer eerst de databasemigraties uit.");
    }

    await database.query("LOCK TABLE klanten, consultant, adres IN EXCLUSIVE MODE");
    const customers = await database.query("SELECT id, idadres FROM klanten ORDER BY id FOR UPDATE");
    const consultants = await database.query("SELECT id, idadres FROM consultant ORDER BY id FOR UPDATE");
    const customerPlaces = await getLinkedPlaces(database, "klanten");
    const consultantPlaces = await getLinkedPlaces(database, "consultant");
    const customerAddressCount = await addMissingAddresses(database, "klanten", customers.rows, customerPlaces, "klant");
    const consultantAddressCount = await addMissingAddresses(database, "consultant", consultants.rows, consultantPlaces, "consultant");

    await database.query("COMMIT");
    console.log(`Adresrecords toegevoegd: ${customerAddressCount} voor klanten en ${consultantAddressCount} voor consultants; bestaande koppelingen overgeslagen: ${customers.rowCount - customerAddressCount} klanten en ${consultants.rowCount - consultantAddressCount} consultants.`);
  } catch (error) {
    await database.query("ROLLBACK");
    throw error;
  } finally {
    database.release();
  }
}

module.exports = { seedAddressTestData };

if (require.main === module) {
  if (!process.env.DATABASE_URL) throw new Error("Stel DATABASE_URL in voordat adres-testdata wordt toegevoegd.");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  seedAddressTestData(pool)
    .catch((error) => {
      console.error(`Adres-testdata toevoegen mislukt: ${error.message}`);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
