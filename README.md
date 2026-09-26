# demo-dashboard
Applicatie voor het bijhouden van agendaitems.

## Starten met PostgreSQL

1. Maak een PostgreSQL-database aan, bijvoorbeeld `mijn_dashboard`.
2. Kopieer `.env.example` naar `.env` en vul `DATABASE_URL` in met de gegevens van je database.
3. Installeer de dependencies met `npm install`.
4. Start de app met `npm start`.
5. Open `http://localhost:3000`.

De server maakt de tabel `appointments` automatisch aan. Bewaar `.env` geheim en stel de app niet publiek beschikbaar zonder passende toegangsbescherming; afspraken bevatten persoonsgegevens.
