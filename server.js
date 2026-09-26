const { randomUUID } = require("node:crypto");
const path = require("node:path");
const express = require("express");
const { Pool } = require("pg");

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const port = Number(process.env.PORT || 3000);

app.use(express.json({ limit: "16kb" }));

app.get("/api/consultant", async (request, response, next) => {
  try {
    const result = await pool.query(`
      SELECT TRIM(voornaam) AS first_name,
             TRIM(COALESCE(tussenvoegsel, '')) AS prefix,
             TRIM(achternaam) AS last_name
      FROM consultant
      LIMIT 1
    `);
    if (result.rowCount === 0) return response.json({ name: "Agenda" });

    const consultant = result.rows[0];
    const name = [consultant.first_name, consultant.prefix, consultant.last_name]
      .filter(Boolean)
      .join(" ");
    response.json({ name: name || "Agenda" });
  } catch (error) {
    next(error);
  }
});

app.get("/api/clients", async (request, response, next) => {
  try {
    const result = await pool.query(`
      SELECT TRIM(voornaam) || ' ' || TRIM(achternaam) AS name
      FROM klanten
      WHERE NULLIF(TRIM(voornaam), '') IS NOT NULL
        AND NULLIF(TRIM(achternaam), '') IS NOT NULL
      GROUP BY TRIM(voornaam), TRIM(achternaam)
      ORDER BY TRIM(achternaam), TRIM(voornaam)
    `);
    response.json(result.rows.map((row) => row.name));
  } catch (error) {
    next(error);
  }
});

function validateAppointment(body) {
  const date = typeof body?.date === "string" ? body.date : "";
  const dateValue = new Date(`${date}T00:00:00Z`);
  const start = typeof body?.start === "string" ? body.start : "";
  const client = typeof body?.client === "string" ? body.client.trim() : "";
  const durationMinutes = Number(body?.durationMinutes);
  const notes = typeof body?.notes === "string" ? body.notes.trim() : "";
  const startMatch = /^(\d{2}):(\d{2})$/.exec(start);
  const startMinutes = startMatch ? Number(startMatch[1]) * 60 + Number(startMatch[2]) : -1;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(dateValue.valueOf()) || dateValue.toISOString().slice(0, 10) !== date) {
    return "Kies een geldige datum.";
  }
  if ([0, 6].includes(dateValue.getUTCDay())) return "Afspraken zijn alleen op werkdagen toegestaan.";
  if (!client || client.length > 80) return "Vul een cliëntnaam van maximaal 80 tekens in.";
  if (!startMatch || Number(startMatch[1]) > 23 || Number(startMatch[2]) > 59) return "Kies een geldige starttijd.";
  if (!Number.isInteger(durationMinutes) || durationMinutes < 15 || durationMinutes > 720 || startMinutes + durationMinutes >= 1440) {
    return "Kies een geldige duur die op dezelfde dag eindigt.";
  }
  if (notes.length > 200) return "Notities mogen maximaal 200 tekens bevatten.";

  return null;
}

app.get("/api/appointments", async (request, response, next) => {
  try {
    const result = await pool.query(`
      SELECT id,
             to_char(appointment_date, 'YYYY-MM-DD') AS date,
             client,
             to_char(start_time, 'HH24:MI') AS start,
             duration_minutes AS "durationMinutes",
             notes
      FROM appointments
      ORDER BY appointment_date, start_time
    `);
    response.json(result.rows);
  } catch (error) {
    next(error);
  }
});

app.post("/api/appointments", async (request, response, next) => {
  const validationError = validateAppointment(request.body);
  if (validationError) return response.status(400).json({ error: validationError });

  const { date, client, start, durationMinutes, notes } = request.body;
  try {
    const matchingClient = await pool.query(`
      SELECT 1
      FROM klanten
      WHERE TRIM(CONCAT(voornaam, ' ', achternaam)) = $1
      LIMIT 1
    `, [client]);
    if (matchingClient.rowCount === 0) {
      return response.status(400).json({ error: "Kies een cliënt uit de lijst." });
    }

    const result = await pool.query(`
      INSERT INTO appointments (id, appointment_date, client, start_time, duration_minutes, notes)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id,
                to_char(appointment_date, 'YYYY-MM-DD') AS date,
                client,
                to_char(start_time, 'HH24:MI') AS start,
                duration_minutes AS "durationMinutes",
                notes
    `, [randomUUID(), date, client.trim(), start, Number(durationMinutes), (notes || "").trim()]);
    response.status(201).json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

app.patch("/api/appointments/:id", async (request, response, next) => {
  try {
    const existingResult = await pool.query(
      "SELECT to_char(appointment_date, 'YYYY-MM-DD') AS date, client FROM appointments WHERE id = $1",
      [request.params.id],
    );
    if (existingResult.rowCount === 0) return response.sendStatus(404);

    const existingAppointment = existingResult.rows[0];
    const validationError = validateAppointment({
      date: existingAppointment.date,
      client: existingAppointment.client,
      start: request.body?.start,
      durationMinutes: request.body?.durationMinutes,
      notes: request.body?.notes,
    });
    if (validationError) return response.status(400).json({ error: validationError });

    const result = await pool.query(`
      UPDATE appointments
      SET start_time = $1, duration_minutes = $2, notes = $3
      WHERE id = $4
      RETURNING id,
                to_char(appointment_date, 'YYYY-MM-DD') AS date,
                client,
                to_char(start_time, 'HH24:MI') AS start,
                duration_minutes AS "durationMinutes",
                notes
    `, [request.body.start, Number(request.body.durationMinutes), (request.body.notes || "").trim(), request.params.id]);
    response.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

app.delete("/api/appointments/:id", async (request, response, next) => {
  try {
    const result = await pool.query("DELETE FROM appointments WHERE id = $1", [request.params.id]);
    if (result.rowCount === 0) return response.sendStatus(404);
    response.sendStatus(204);
  } catch (error) {
    next(error);
  }
});

app.use("/api", (request, response) => response.status(404).json({ error: "API-route niet gevonden." }));
app.get("/", (request, response) => response.sendFile(path.join(__dirname, "index.html")));
app.get("/styles.css", (request, response) => response.sendFile(path.join(__dirname, "styles.css")));
app.get("/app.js", (request, response) => response.sendFile(path.join(__dirname, "app.js")));
app.use((error, request, response, next) => {
  console.error(error);
  if (response.headersSent) return next(error);
  response.status(500).json({ error: "Er is een probleem met de database." });
});

async function start() {
  if (!process.env.DATABASE_URL) throw new Error("Stel DATABASE_URL in voordat de server start.");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS appointments (
      id UUID PRIMARY KEY,
      appointment_date DATE NOT NULL,
      client VARCHAR(80) NOT NULL,
      start_time TIME NOT NULL,
      duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
      notes VARCHAR(200) NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  app.listen(port, () => console.log(`Agenda beschikbaar op http://localhost:${port}`));
}

start().catch((error) => {
  console.error("Server starten mislukt:", error.message);
  process.exitCode = 1;
});