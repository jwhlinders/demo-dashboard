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

## GitHub Actions

De workflow `.github/workflows/playwright.yml` voert de Playwright-tests alleen uit wanneer je die handmatig start via GitHub **Actions > Playwright tests > Run workflow**. Kies `main` om het rapport automatisch naar GitHub Pages te publiceren. De eerste keer moet je in **Settings > Pages** bij **Build and deployment** de bron **GitHub Actions** kiezen. Na afloop open je de workflowrun en klik je op de URL van de `github-pages`-deployment om het interactieve rapport te bekijken. Dit wordt ook als artefact `playwright-report` zeven dagen bewaard. Runs van andere branches publiceren niet naar Pages.

Let op: iedereen die toegang heeft tot de gepubliceerde Pages-site kan het rapport bekijken. Het rapport bevat testdetails en mogelijk screenshots; de CI-tests gebruiken uitsluitend synthetische testaccounts.

Stel de E2E-variabelen in op de accountgegevens uit dit fixture: `E2E_CONSULTANT_USERNAME=ci-consultant`, `E2E_CONSULTANT_PASSWORD=CIConsultant2026!`, `E2E_CLIENT_USERNAME=ci-client` en `E2E_CLIENT_PASSWORD=CIClient2026!`. Deze vaste gegevens zijn uitsluitend voor de wegwerpdatabase van CI; gebruik ze niet buiten tests.
