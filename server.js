const { randomUUID, randomBytes, scrypt, timingSafeEqual } = require("node:crypto");
const { promisify } = require("node:util");
const path = require("node:path");
const express = require("express");
const { Pool } = require("pg");
const { DEFAULT_CLIENT_PASSWORD: defaultClientPassword, makeAccountBase, runMigrations } = require("./migraties");
const { seedTestData } = require("./testdata");

const scryptAsync = promisify(scrypt);
const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const port = Number(process.env.PORT || 3000);
const sessions = new Map();
const sessionCookie = "agenda_session";

app.use(express.json({ limit: "16kb" }));
app.use(express.urlencoded({ extended: false }));

function getSession(request) {
  const token = request.headers.cookie?.match(new RegExp(`${sessionCookie}=([^;]+)`))?.[1];
  return token ? sessions.get(token) : null;
}

function requireLogin(request, response, next) {
  if (request.path === "/styles.css") return next();
  const session = getSession(request);
  if (session?.mustChangePassword && request.path !== "/api/change-password" && request.path !== "/api/logout") {
    if (request.path.startsWith("/api/")) {
      return response.status(403).json({ error: "Stel eerst een nieuw wachtwoord in.", mustChangePassword: true });
    }
    return response.redirect("/change-password");
  }
  if (session) return next();
  if (request.path.startsWith("/api/")) return response.status(401).json({ error: "Log eerst in." });
  response.redirect("/login");
}

app.get("/login", (request, response) => response.sendFile(path.join(__dirname, "login.html")));
app.get("/register", (request, response) => response.sendFile(path.join(__dirname, "register.html")));
app.get("/change-password", (request, response) => {
  if (!getSession(request)) return response.redirect("/login");
  response.sendFile(path.join(__dirname, "change-password.html"));
});
app.get("/settings", requireLogin, (request, response) => {
  const session = getSession(request);
  if (!session || session.role !== "consultant") return response.redirect("/");
  response.sendFile(path.join(__dirname, "consultant-settings.html"));
});

app.post("/api/register", async (request, response, next) => {
  const firstName = typeof request.body?.voornaam === "string" ? request.body.voornaam.trim() : "";
  const prefix = typeof request.body?.tussenvoegsel === "string" ? request.body.tussenvoegsel.trim() : "";
  const lastName = typeof request.body?.achternaam === "string" ? request.body.achternaam.trim() : "";
  const email = typeof request.body?.email === "string" ? request.body.email.trim().toLowerCase() : "";
  const fullName = [firstName, prefix, lastName].filter(Boolean).join(" ");

  if (!firstName || firstName.length > 80 || !lastName || lastName.length > 80 || prefix.length > 80 || fullName.length > 80) {
    return response.status(400).json({ error: "Vul een geldige voornaam en achternaam in (samen maximaal 80 tekens)." });
  }
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return response.status(400).json({ error: "Vul een geldig e-mailadres in." });
  }
  const database = await pool.connect();
  try {
    await database.query("BEGIN");
    await database.query("SELECT pg_advisory_xact_lock(741852963)");
    const base = makeAccountBase(firstName, lastName);
    let username = base;
    let suffix = 2;
    while (true) {
      const existingAccount = await database.query(`
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

    const salt = randomBytes(16).toString("hex");
    const passwordHash = await scryptAsync(defaultClientPassword, salt, 64);
    await database.query(`
      INSERT INTO klanten (voornaam, tussenvoegsel, achternaam, email, username, password)
      VALUES ($1, NULLIF($2, ''), $3, $4, $5, $6)
    `, [firstName, prefix, lastName, email, username, `scrypt$${salt}$${passwordHash.toString("hex")}`]);
    await database.query("COMMIT");
    response.status(201).json({ message: "Je account is aangemaakt.", username, password: defaultClientPassword });
  } catch (error) {
    await database.query("ROLLBACK");
    if (error.code === "23505") return response.status(409).json({ error: "Er bestaat al een account met dit e-mailadres." });
    next(error);
  } finally {
    database.release();
  }
});

app.post("/api/login", async (request, response, next) => {
  const username = typeof request.body?.username === "string" ? request.body.username.trim() : "";
  const password = typeof request.body?.password === "string" ? request.body.password : "";
  try {
    const consultantResult = await pool.query(
      "SELECT username, voornaam, tussenvoegsel, achternaam, password FROM consultant WHERE username = $1 LIMIT 1",
      [username],
    );
    let account = consultantResult.rows[0];
    let role = "consultant";
    let name = account && [account.voornaam, account.tussenvoegsel, account.achternaam].filter(Boolean).join(" ");

    if (account && account.password !== password) {
      return response.status(401).json({ error: "Ongeldige gebruikersnaam of wachtwoord." });
    }
    if (!account) {
      const clientResult = await pool.query(`
        SELECT username, voornaam, tussenvoegsel, achternaam, password
        FROM klanten
        WHERE LOWER(username) = LOWER($1)
        LIMIT 1
      `, [username]);
      account = clientResult.rows[0];
      const encodedPassword = account?.password || "";
      if (!account || !/^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(encodedPassword)) {
        return response.status(401).json({ error: "Ongeldige gebruikersnaam of wachtwoord." });
      }

      const [, salt, expectedHex] = encodedPassword.split("$");
      const expectedHash = Buffer.from(expectedHex, "hex");
      const suppliedHash = await scryptAsync(password, salt, expectedHash.length);
      if (!timingSafeEqual(suppliedHash, expectedHash)) {
        return response.status(401).json({ error: "Ongeldige gebruikersnaam of wachtwoord." });
      }
      role = "client";
      name = [account.voornaam, account.tussenvoegsel, account.achternaam].filter(Boolean).join(" ");
    }

    const token = randomUUID();
    const mustChangePassword = role === "client" && password === defaultClientPassword;
    sessions.set(token, { username: account.username, role, name, clientName: role === "client" ? name : null, mustChangePassword, createdAt: Date.now() });
    response.setHeader("Set-Cookie", `${sessionCookie}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800`);
    response.json({ name, mustChangePassword });
  } catch (error) {
    next(error);
  }
});

app.post("/api/change-password", async (request, response, next) => {
  const session = getSession(request);
  const password = typeof request.body?.password === "string" ? request.body.password : "";
  if (!session || session.role !== "client") return response.status(401).json({ error: "Log eerst in als cliënt." });
  if (password.length < 8 || password.length > 128 || password === defaultClientPassword) {
    return response.status(400).json({ error: "Kies een nieuw wachtwoord van 8 tot 128 tekens." });
  }

  try {
    const salt = randomBytes(16).toString("hex");
    const passwordHash = await scryptAsync(password, salt, 64);
    await pool.query("UPDATE klanten SET password = $1 WHERE username = $2", [`scrypt$${salt}$${passwordHash.toString("hex")}`, session.username]);
    session.mustChangePassword = false;
    response.json({ message: "Je wachtwoord is gewijzigd." });
  } catch (error) {
    next(error);
  }
});

app.get("/api/profile", async (request, response, next) => {
  const session = getSession(request);
  if (!session || session.role !== "client") return response.status(403).json({ error: "Alleen cliënten kunnen hun profiel bekijken." });

  try {
    const result = await pool.query(`
      SELECT username, voornaam, COALESCE(tussenvoegsel, '') AS tussenvoegsel,
             achternaam, COALESCE(telefoonnummer, '') AS telefoonnummer
      FROM klanten
      WHERE username = $1
      LIMIT 1
    `, [session.username]);
    if (result.rowCount === 0) return response.status(404).json({ error: "Profiel niet gevonden." });
    response.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

app.patch("/api/profile", async (request, response, next) => {
  const session = getSession(request);
  if (!session || session.role !== "client") return response.status(403).json({ error: "Alleen cliënten kunnen hun profiel wijzigen." });

  const firstName = typeof request.body?.voornaam === "string" ? request.body.voornaam.trim() : "";
  const prefix = typeof request.body?.tussenvoegsel === "string" ? request.body.tussenvoegsel.trim() : "";
  const lastName = typeof request.body?.achternaam === "string" ? request.body.achternaam.trim() : "";
  const phone = typeof request.body?.telefoonnummer === "string" ? request.body.telefoonnummer.trim() : "";
  const password = typeof request.body?.password === "string" ? request.body.password : "";
  const passwordConfirmation = typeof request.body?.passwordConfirmation === "string" ? request.body.passwordConfirmation : "";
  const fullName = [firstName, prefix, lastName].filter(Boolean).join(" ");

  if (!firstName || firstName.length > 80 || !lastName || lastName.length > 80 || prefix.length > 80 || fullName.length > 80) {
    return response.status(400).json({ error: "Vul een geldige voornaam en achternaam in (samen maximaal 80 tekens)." });
  }
  if (phone.length > 30 || (phone && !/^[+0-9().\-\s]{6,30}$/.test(phone))) {
    return response.status(400).json({ error: "Vul een geldig telefoonnummer van maximaal 30 tekens in." });
  }
  if (password !== passwordConfirmation) {
    return response.status(400).json({ error: "De wachtwoorden komen niet overeen." });
  }
  if (password && (password.length < 8 || password.length > 128 || password === defaultClientPassword)) {
    return response.status(400).json({ error: "Kies een nieuw wachtwoord van 8 tot 128 tekens." });
  }

  const database = await pool.connect();
  try {
    await database.query("BEGIN");
    const updates = [firstName, prefix || null, lastName, phone || null, session.username];
    let passwordUpdate = "";
    if (password) {
      const salt = randomBytes(16).toString("hex");
      const passwordHash = await scryptAsync(password, salt, 64);
      updates.push(`scrypt$${salt}$${passwordHash.toString("hex")}`);
      passwordUpdate = `, password = $${updates.length}`;
    }
    const result = await database.query(`
      UPDATE klanten
      SET voornaam = $1, tussenvoegsel = $2, achternaam = $3,
          telefoonnummer = $4${passwordUpdate}
      WHERE username = $5
      RETURNING username
    `, updates);
    if (result.rowCount === 0) {
      await database.query("ROLLBACK");
      return response.status(404).json({ error: "Profiel niet gevonden." });
    }
    await database.query("UPDATE appointments SET client = $1 WHERE client_username = $2", [fullName, session.username]);
    await database.query("COMMIT");
    session.name = fullName;
    session.clientName = fullName;
    response.json({ message: "Je profiel is bijgewerkt.", name: fullName });
  } catch (error) {
    await database.query("ROLLBACK");
    next(error);
  } finally {
    database.release();
  }
});

app.post("/api/logout", requireLogin, (request, response) => {
  const token = request.headers.cookie?.match(new RegExp(`${sessionCookie}=([^;]+)`))?.[1];
  if (token) sessions.delete(token);
  response.setHeader("Set-Cookie", `${sessionCookie}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
  response.sendStatus(204);
});

app.use(requireLogin);

app.get("/api/consultant", async (request, response, next) => {
  const session = getSession(request);
  if (session.role === "client") return response.json({ name: session.name, role: session.role });

  try {
    const result = await pool.query(`
      SELECT TRIM(consultant.voornaam) AS first_name,
             TRIM(COALESCE(tussenvoegsel, '')) AS prefix,
             TRIM(consultant.achternaam) AS last_name,
             (
               SELECT locatie.naam
               FROM locaties AS locatie
               WHERE locatie.idlocatie = consultant.defaultlocatie
               LIMIT 1
             ) AS location_name
      FROM consultant
      WHERE consultant.username = $1
      LIMIT 1
    `, [session.username]);
    if (result.rowCount === 0) return response.json({ name: "Agenda" });

    const consultant = result.rows[0];
    const name = [consultant.first_name, consultant.prefix, consultant.last_name]
      .filter(Boolean)
      .join(" ");
    response.json({ name: name || "Agenda", role: session.role, locationName: consultant.location_name });
  } catch (error) {
    next(error);
  }
});

app.get("/api/consultant/settings", async (request, response, next) => {
  const session = getSession(request);
  if (!session || session.role !== "consultant") {
    return response.status(403).json({ error: "Alleen de consultant kan deze instellingen bekijken." });
  }

  try {
    const result = await pool.query(`
      SELECT consultant.*,
             locatie.naam AS location_name,
             locatie.adres,
             locatie.postcode,
             locatie.plaats
      FROM consultant
      LEFT JOIN locaties AS locatie ON locatie.idlocatie = consultant.defaultlocatie
      WHERE consultant.username = $1
      LIMIT 1
    `, [session.username]);
    if (result.rowCount === 0) return response.status(404).json({ error: "Consultant niet gevonden." });

    const consultant = { ...result.rows[0], role: session.role };
    if (typeof consultant.password === "string") consultant.password = "********";
    response.json(consultant);
  } catch (error) {
    next(error);
  }
});

app.get("/api/clients", async (request, response, next) => {
  const session = getSession(request);
  if (session.role === "client") return response.json([session.clientName]);

  try {
    const result = await pool.query(`
      SELECT TRIM(CONCAT_WS(' ', NULLIF(TRIM(voornaam), ''), NULLIF(TRIM(tussenvoegsel), ''), NULLIF(TRIM(achternaam), ''))) AS name
      FROM klanten
      WHERE NULLIF(TRIM(voornaam), '') IS NOT NULL
        AND NULLIF(TRIM(achternaam), '') IS NOT NULL
      GROUP BY TRIM(voornaam), TRIM(tussenvoegsel), TRIM(achternaam)
      ORDER BY TRIM(achternaam), TRIM(voornaam)
    `);
    response.json(result.rows.map((row) => row.name));
  } catch (error) {
    next(error);
  }
});

app.get("/api/appointment-options", async (request, response, next) => {
  if (getSession(request).role !== "client") {
    return response.status(403).json({ error: "Alleen cliënten kunnen afspraakopties bekijken." });
  }
  try {
    const result = await pool.query(`
      SELECT consultant.username,
             TRIM(CONCAT_WS(' ', NULLIF(TRIM(consultant.voornaam), ''), NULLIF(TRIM(consultant.tussenvoegsel), ''), NULLIF(TRIM(consultant.achternaam), ''))) AS name,
             locatie.idlocatie AS location_id,
             locatie.naam AS location_name
      FROM consultant
      INNER JOIN locaties AS locatie ON locatie.idlocatie = consultant.defaultlocatie
      ORDER BY locatie.naam, consultant.achternaam, consultant.voornaam
    `);
    const locations = [...new Map(result.rows.map((row) => [row.location_id, { id: row.location_id, name: row.location_name }])).values()];
    const consultants = [...new Map(result.rows.map((row) => [row.username.trim().toLocaleLowerCase("nl-NL"), {
      username: row.username,
      name: row.name || row.username,
      locationId: row.location_id,
    }])).values()];
    response.json({ locations, consultants });
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
  const session = getSession(request);
  try {
    const result = await pool.query(`
      SELECT appointment.id,
           to_char(appointment.appointment_date, 'YYYY-MM-DD') AS date,
           appointment.client,
           COALESCE(NULLIF(TRIM(CONCAT_WS(' ', NULLIF(TRIM(consultant.voornaam), ''), NULLIF(TRIM(consultant.tussenvoegsel), ''), NULLIF(TRIM(consultant.achternaam), ''))), ''), consultant.username) AS "consultantName",
           to_char(appointment.start_time, 'HH24:MI') AS start,
           appointment.duration_minutes AS "durationMinutes",
           appointment.notes,
           appointment.aangevraagd
      FROM appointments AS appointment
      LEFT JOIN LATERAL (
        SELECT username, voornaam, tussenvoegsel, achternaam
        FROM consultant
        WHERE consultant.username = appointment.consultant_username
        ORDER BY consultant.id
        LIMIT 1
      ) AS consultant ON TRUE
      WHERE ( $2 = 'consultant' AND appointment.consultant_username = $1 )
        OR ( $2 = 'client' AND appointment.client_username = $1 )
      ORDER BY appointment.appointment_date, appointment.start_time
    `, [session.username, session.role]);
    response.json(result.rows);
  } catch (error) {
    next(error);
  }
});

app.post("/api/appointments", async (request, response, next) => {
  const session = getSession(request);
  const clientRequest = session.role === "client";
  const client = clientRequest ? session.clientName : request.body?.client;
  const durationMinutes = clientRequest ? 30 : request.body?.durationMinutes;
  const validationError = validateAppointment({ ...request.body, client, durationMinutes });
  if (validationError) return response.status(400).json({ error: validationError });
  if (clientRequest && (typeof request.body?.notes !== "string" || !request.body.notes.trim())) {
    return response.status(400).json({ error: "Vul de reden voor het gesprek in." });
  }

  const { date, start, notes } = request.body;
  let consultantUsername = session.username;
  let clientUsername;
  try {
    if (clientRequest) {
      const requestedConsultant = typeof request.body?.consultantUsername === "string" ? request.body.consultantUsername.trim() : "";
      const locationId = Number(request.body?.locationId);
      if (!requestedConsultant || !Number.isInteger(locationId)) {
        return response.status(400).json({ error: "Kies een locatie en consultant." });
      }
      const matchingConsultant = await pool.query(
        "SELECT username FROM consultant WHERE username = $1 AND defaultlocatie = $2",
        [requestedConsultant, locationId],
      );
      if (matchingConsultant.rowCount === 0) {
        return response.status(400).json({ error: "De gekozen consultant hoort niet bij deze locatie." });
      }
      consultantUsername = matchingConsultant.rows[0].username;
      clientUsername = session.username;
    } else {
      const matchingClient = await pool.query(`
            SELECT CASE WHEN COUNT(*) = 1 THEN MAX(username) END AS username,
              COUNT(*) AS match_count
      FROM klanten
      WHERE TRIM(CONCAT_WS(' ', NULLIF(TRIM(voornaam), ''), NULLIF(TRIM(tussenvoegsel), ''), NULLIF(TRIM(achternaam), ''))) = $1
    `, [client]);
      if (matchingClient.rows[0].match_count !== "1" || !matchingClient.rows[0].username) {
        return response.status(400).json({ error: "Kies een cliënt met een uniek account uit de lijst." });
      }
      clientUsername = matchingClient.rows[0].username;
    }

    const result = await pool.query(`
      INSERT INTO appointments (id, appointment_date, client, start_time, duration_minutes, notes, consultant_username, client_username, aangevraagd)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id,
                to_char(appointment_date, 'YYYY-MM-DD') AS date,
                client,
                client_username AS "clientUsername",
                to_char(start_time, 'HH24:MI') AS start,
                duration_minutes AS "durationMinutes",
                notes,
                aangevraagd
    `, [randomUUID(), date, client.trim(), start, Number(durationMinutes), (notes || "").trim(), consultantUsername, clientUsername, clientRequest]);
    response.status(201).json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

app.patch("/api/appointments/:id", async (request, response, next) => {
  if (getSession(request).role === "client") {
    return response.status(403).json({ error: "Cliënten kunnen afspraken alleen bekijken." });
  }
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
                notes,
                aangevraagd
    `, [request.body.start, Number(request.body.durationMinutes), (request.body.notes || "").trim(), request.params.id]);
    response.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

app.patch("/api/appointments/:id/confirm", async (request, response, next) => {
  const session = getSession(request);
  if (session.role !== "consultant") {
    return response.status(403).json({ error: "Alleen de consultant kan een aanvraag bevestigen." });
  }
  try {
    const result = await pool.query(`
      UPDATE appointments
      SET aangevraagd = FALSE
      WHERE id = $1 AND consultant_username = $2 AND aangevraagd = TRUE
      RETURNING id, aangevraagd
    `, [request.params.id, session.username]);
    if (result.rowCount === 0) {
      return response.status(404).json({ error: "De aangevraagde afspraak is niet gevonden." });
    }
    response.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

app.delete("/api/appointments/:id", async (request, response, next) => {
  if (getSession(request).role === "client") {
    return response.status(403).json({ error: "Cliënten kunnen afspraken alleen bekijken." });
  }
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
app.get("/agenda.js", (request, response) => response.sendFile(path.join(__dirname, "agenda.js")));
app.get("/form.js", (request, response) => response.sendFile(path.join(__dirname, "form.js")));
app.use((error, request, response, next) => {
  console.error(error);
  if (response.headersSent) return next(error);
  response.status(500).json({ error: "Er is een probleem met de database." });
});

async function start() {
  if (!process.env.DATABASE_URL) throw new Error("Stel DATABASE_URL in voordat de server start.");

  await runMigrations(pool);
  await seedTestData(pool);
  app.listen(port, () => console.log(`Agenda beschikbaar op http://localhost:${port}`));
}

start().catch((error) => {
  console.error("Server starten mislukt:", error.message);
  process.exitCode = 1;
});
