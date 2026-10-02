const { randomInt } = require("node:crypto");
const { Pool } = require("pg");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const cities = [
  { name: "Amsterdam", areaCode: "020" },
  { name: "Rotterdam", areaCode: "010" },
  { name: "Den Haag", areaCode: "070" },
  { name: "Utrecht", areaCode: "030" },
  { name: "Eindhoven", areaCode: "040" },
  { name: "Groningen", areaCode: "050" },
  { name: "Tilburg", areaCode: "013" },
  { name: "Almere", areaCode: "036" },
  { name: "Breda", areaCode: "076" },
  { name: "Nijmegen", areaCode: "024" },
  { name: "Enschede", areaCode: "053" },
  { name: "Haarlem", areaCode: "023" },
  { name: "Arnhem", areaCode: "026" },
  { name: "Zaanstad", areaCode: "075" },
  { name: "Amersfoort", areaCode: "033" },
  { name: "Apeldoorn", areaCode: "055" },
  { name: "s-Hertogenbosch", areaCode: "073" },
  { name: "Leiden", areaCode: "071" },
  { name: "Maastricht", areaCode: "043" },
  { name: "Dordrecht", areaCode: "078" },
  { name: "Zwolle", areaCode: "038" },
  { name: "Zoetermeer", areaCode: "079" },
  { name: "Venlo", areaCode: "077" },
  { name: "Leeuwarden", areaCode: "058" },
  { name: "Middelburg", areaCode: "0118" },
];
const streetNames = [
  "Stationsweg", "Dorpsstraat", "Kerkstraat", "Wilhelminastraat", "Parklaan",
  "Molenstraat", "Schoolstraat", "Beukenlaan", "Julianalaan", "Havenstraat",
];
const postcodeLetters = "ABCDEFGHJKLMNPRTVWXYZ";

function randomPostcode() {
  const firstLetter = postcodeLetters[randomInt(postcodeLetters.length)];
  const secondLetter = postcodeLetters[randomInt(postcodeLetters.length)];
  return `${randomInt(1000, 10000)}${firstLetter}${secondLetter}`;
}

function createLocation(city) {
  const subscriberLength = city.areaCode.length === 4 ? 6 : 7;
  return {
    naam: `Locatie ${city.name}`,
    plaats: city.name,
    postcode: randomPostcode(),
    adres: `${streetNames[randomInt(streetNames.length)]} ${randomInt(1, 250)}`,
    telefoonnummer: `${city.areaCode}-${String(randomInt(0, 10 ** subscriberLength)).padStart(subscriberLength, "0")}`,
  };
}

function shuffled(values) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

async function seedTestData(databasePool) {
  const database = await databasePool.connect();
  try {
    await database.query("BEGIN");
    await database.query("LOCK TABLE locaties, consultant IN EXCLUSIVE MODE");

    const locations = cities.map(createLocation);
    const names = locations.map((location) => location.naam);
    const existing = await database.query(
      "SELECT idlocatie, naam, plaats FROM locaties WHERE naam = ANY($1)",
      [names],
    );
    if (existing.rowCount !== 0 && existing.rowCount !== locations.length) {
      throw new Error("Een deel van de testlocaties bestaat al. Er is niets gewijzigd om bestaande locaties te beschermen.");
    }

    let locationIds;
    if (existing.rowCount === locations.length) {
      const existingByName = new Map(existing.rows.map((row) => [row.naam, row]));
      if (locations.some((location) => {
        const row = existingByName.get(location.naam);
        return !row || row.plaats !== location.plaats || row.idlocatie < 100 || row.idlocatie > 999;
      })) {
        throw new Error("Bestaande locaties met testnamen hebben onverwachte gegevens of ID's. Er is niets gewijzigd.");
      }
      locationIds = locations.map((location) => existingByName.get(location.naam).idlocatie);
    } else {
      const usedIdsResult = await database.query("SELECT idlocatie FROM locaties WHERE idlocatie BETWEEN 100 AND 999");
      const usedIds = new Set(usedIdsResult.rows.map((row) => row.idlocatie));
      const availableIds = [];
      for (let id = 100; id <= 999; id += 1) {
        if (!usedIds.has(id)) availableIds.push(id);
      }
      if (availableIds.length < locations.length) {
        throw new Error("Er zijn minder dan 25 vrije locatie-ID's tussen 100 en 999.");
      }
      locationIds = shuffled(availableIds).slice(0, locations.length);
    }

    const idColumn = await database.query(`
      SELECT column_default, is_identity
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'locaties'
        AND column_name = 'id'
    `);
    if (idColumn.rowCount === 0) throw new Error("De kolom locaties.id is niet gevonden.");
    const hasGeneratedId = idColumn.rows[0].column_default !== null || idColumn.rows[0].is_identity === "YES";
    const nextIdResult = hasGeneratedId ? null : await database.query("SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM locaties");
    let nextId = nextIdResult ? nextIdResult.rows[0].next_id : null;

    for (let index = 0; index < locations.length; index += 1) {
      const location = locations[index];
      const locationId = locationIds[index];
      if (existing.rowCount === 0) {
        const values = [locationId, location.naam, location.adres, location.postcode, location.plaats, location.telefoonnummer];
        const columns = ["idlocatie", "naam", "adres", "postcode", "plaats", "telefoonnummer"];
        if (!hasGeneratedId) {
          columns.unshift("id");
          values.unshift(nextId++);
        }
        const placeholders = values.map((_, valueIndex) => `$${valueIndex + 1}`);
        await database.query(
          `INSERT INTO locaties (${columns.join(", ")}) VALUES (${placeholders.join(", ")})`,
          values,
        );
      }
    }

    const consultants = await database.query("SELECT id FROM consultant ORDER BY id");
    for (let index = 0; index < consultants.rows.length; index += 1) {
      await database.query(
        "UPDATE consultant SET defaultlocatie = $1 WHERE id = $2",
        [locationIds[index % locationIds.length], consultants.rows[index].id],
      );
    }

    await database.query("COMMIT");
    console.log(`Locaties toegevoegd of bijgewerkt: ${locations.length}`);
    console.log(`Consultants gekoppeld: ${consultants.rowCount}`);
    console.log(`Gebruikte idlocatie's: ${locationIds.join(", ")}`);
  } catch (error) {
    await database.query("ROLLBACK");
    throw error;
  } finally {
    database.release();
  }
}

module.exports = { seedTestData };

if (require.main === module) {
  if (!process.env.DATABASE_URL) throw new Error("Stel DATABASE_URL in voordat testdata wordt toegevoegd.");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  seedTestData(pool)
    .catch((error) => {
      console.error(`Testdata toevoegen mislukt: ${error.message}`);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
