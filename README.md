# demo-dashboard
Applicatie voor het bijhouden van agendaitems.

De applicatiecode en webbestanden staan in `src/`. Playwright-tests en testfixtures staan apart in `tests/`.

## Starten met PostgreSQL

1. Maak een PostgreSQL-database aan, bijvoorbeeld `mijn_dashboard`.
2. Kopieer `.env.example` naar `.env` en vul `DATABASE_URL` in met de gegevens van je database.
3. Installeer de dependencies met `npm install`.
4. Start de app met `npm start`.
5. Open `http://localhost:3000`.

De server maakt de tabel `appointments` automatisch aan. Afspraken verwijzen naar cliënten via hun `username`; de volledige naam wordt bij het tonen opgehaald uit `klanten`. Bewaar `.env` geheim en stel de app niet publiek beschikbaar zonder passende toegangsbescherming; afspraken bevatten persoonsgegevens.

## Lokale testaccounts

Vul een lokale testdatabase eerst met de basistabellen en locaties. Voer daarna vanuit de projectmap de scripts uit:

```powershell
npm run testdata:locaties
npm run testdata:consultants
npm run testdata:klanten
```

De scripts voegen fictieve testgegevens toe en zijn veilig opnieuw uit te voeren: bestaande testaccounts worden overgeslagen. Consultants kunnen inloggen met gebruikersnaam `emulder`, `jdekker`, `sverhoeven`, `tvanloon` of `nvisser`; voor deze accounts is het tijdelijke wachtwoord `TestConsultant2026!`. De testklanten gebruiken de gebruikersnamen uit `src/testdata-klanten.js` en het tijdelijke wachtwoord `Welkom01`; zij moeten dit wachtwoord bij de eerste login wijzigen. Gebruik deze scripts en wachtwoorden uitsluitend in een lokale testdatabase, niet in productie.

## Cliëntaccounts

Voor cliënten zonder account maakt de server automatisch een gebruikersnaam op basis van de eerste letter van de voornaam en de achternaam (bijvoorbeeld `jjansen` voor Jan Jansen). Bij dubbele namen wordt een volgnummer toegevoegd. Het tijdelijke wachtwoord is `Welkom01`; cliënten moeten dit na de eerste login wijzigen. Nieuwe registraties krijgen dezelfde accountnaamregel en een tijdelijk wachtwoord.

## End-to-endtest

Installeer de Playwright-browser eenmalig met `npx playwright install chromium`. Stel daarna `E2E_CONSULTANT_USERNAME` en `E2E_CONSULTANT_PASSWORD` in voor een consultantaccount in `.env` of de shell. De database moet ten minste één cliënt bevatten. Voer de test uit met `npm run test:e2e`; Playwright start de app met de bestaande `.env`-configuratie.

## GitHub Actions

De workflow `.github/workflows/playwright.yml` voert de Playwright-tests alleen uit wanneer je die handmatig start via GitHub **Actions > Playwright tests > Run workflow**. Kies de branch en start de workflow. Deze gebruikt een tijdelijke PostgreSQL-service, initialiseert die met `tests/fixtures/ci-schema.sql` en draait de tests sequentieel. Na afloop vind je onderaan de workflowrun het artefact `playwright-report`. Download en pak het uit en open `index.html` om het HTML-testrapport te bekijken. Het artefact wordt zeven dagen bewaard.

Stel de E2E-variabelen in op de accountgegevens uit dit fixture: `E2E_CONSULTANT_USERNAME=ci-consultant`, `E2E_CONSULTANT_PASSWORD=CIConsultant2026!`, `E2E_CLIENT_USERNAME=ci-client` en `E2E_CLIENT_PASSWORD=CIClient2026!`. Deze vaste gegevens zijn uitsluitend voor de wegwerpdatabase van CI; gebruik ze niet buiten tests.
