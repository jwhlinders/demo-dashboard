# demo-dashboard
Applicatie voor het bijhouden van agendaitems.

## Starten met PostgreSQL

1. Maak een PostgreSQL-database aan, bijvoorbeeld `mijn_dashboard`.
2. Kopieer `.env.example` naar `.env` en vul `DATABASE_URL` in met de gegevens van je database.
3. Installeer de dependencies met `npm install`.
4. Start de app met `npm start`.
5. Open `http://localhost:3000`.

De server maakt de tabel `appointments` automatisch aan. Afspraken verwijzen naar cliënten via hun `username`; de volledige naam wordt bij het tonen opgehaald uit `klanten`. Bewaar `.env` geheim en stel de app niet publiek beschikbaar zonder passende toegangsbescherming; afspraken bevatten persoonsgegevens.

## Cliëntaccounts

Voor cliënten zonder account maakt de server automatisch een gebruikersnaam op basis van de eerste letter van de voornaam en de achternaam (bijvoorbeeld `jjansen` voor Jan Jansen). Bij dubbele namen wordt een volgnummer toegevoegd. Het tijdelijke wachtwoord is `Welkom01`; cliënten moeten dit na de eerste login wijzigen. Nieuwe registraties krijgen dezelfde accountnaamregel en een tijdelijk wachtwoord.

## End-to-endtest

Installeer de Playwright-browser eenmalig met `npx playwright install chromium`. Stel daarna `E2E_CONSULTANT_USERNAME` en `E2E_CONSULTANT_PASSWORD` in voor een consultantaccount in `.env` of de shell. De database moet ten minste één cliënt bevatten. Voer de test uit met `npm run test:e2e`; Playwright start de app met de bestaande `.env`-configuratie.
