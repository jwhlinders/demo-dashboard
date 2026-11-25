# demo-dashboard
Applicatie voor het bijhouden van agendaitems.

De applicatiecode en webbestanden staan in `src/`. Playwright-tests en testfixtures staan apart in `tests/`.

## Starten met PostgreSQL

1. Maak een PostgreSQL-database aan, bijvoorbeeld `mijn_dashboard`.
2. Kopieer `.env.example` naar `.env` en vul `DATABASE_URL` in met de gegevens van je database. Als de tabel `consultant` nog niet bestaat, stel dan ook `ADMIN_INITIAL_PASSWORD` in op een wachtwoord van 8 tot 128 tekens.
3. Installeer de dependencies met `npm install`.
4. Start de app met `npm start`.
5. Open `http://localhost:3000`.

De server voert bij het opstarten database-migraties uit en maakt de tabellen `locaties`, `adres`, `consultant`, `klanten` en `appointments` automatisch aan als die ontbreken. 
Als `consultant` nog niet bestaat, wordt de beheerder `admin00` (`beheerder@dashboard.nl`) aangemaakt met `ADMIN_INITIAL_PASSWORD`; adres en locatie blijven leeg. 
De adresverwijzing loopt via `klanten.idadres` en `consultant.idadres`
Afspraken verwijzen naar cliënten via hun `username`; de volledige naam wordt bij het tonen opgehaald uit `klanten`.

## Lokale testaccounts

Vul een lokale testdatabase eerst met de basistabellen en locaties. Voer daarna vanuit de projectmap de scripts uit:

```powershell
npm run testdata:locaties
npm run testdata:consultants
npm run testdata:klanten
```
adressen worden automatisch opgevoerd bij toevoegen van consultants/klanten

Deze scripts voegen fictieve testgegevens toe en zijn veilig opnieuw uit te voeren: bestaande testaccounts en adreskoppelingen worden overgeslagen. Consultants kunnen inloggen met gebruikersnaam bv `emulder`;
Voor deze accounts is het tijdelijke wachtwoord `TestConsultant2026!`. De testklanten gebruiken de gebruikersnamen uit `src/testdata-klanten.js` en het tijdelijke wachtwoord `Welkom01`; 
Gebruik deze scripts en wachtwoorden uitsluitend in een lokale testdatabase, niet in productie.

## Cliëntaccounts

Voor cliënten zonder account maakt de server automatisch een gebruikersnaam op basis van de eerste letter van de voornaam en de achternaam (bijvoorbeeld `jjansen` voor Jan Jansen). Bij dubbele namen wordt een volgnummer toegevoegd. Het tijdelijke wachtwoord is `Welkom01`; cliënten moeten dit na de eerste login wijzigen. Nieuwe registraties krijgen dezelfde accountnaamregel en een tijdelijk wachtwoord.

## Consultantaccounts

Een beheerder kan via **Instellingen > Nieuw consultant** een consultantaccount aanmaken. De applicatie genereert een eenmalige authorisatiecode van acht tekens. De consultant activeert het account via `/consultant` met de gebruikersnaam, authorisatiecode en postcode van de werklocatie, en stelt daarna zelf een wachtwoord in. E-mailverzending van deze gegevens is nog niet ingericht.

## End-to-endtest

Installeer de Playwright-browser eenmalig met `npx playwright install chromium`. Stel `E2E_BEHEERDER_USERNAME` en `E2E_BEHEERDER_PASSWORD` in voor een beheerderaccount, `E2E_CONSULTANT_USERNAME` en `E2E_CONSULTANT_PASSWORD` voor een gewone consultant en `E2E_CLIENT_USERNAME` voor een cliëntaccount in `.env` of de shell. De database moet deze accounts bevatten. Voer de test uit met `npm run test:e2e`; Playwright start de app met de bestaande `.env`-configuratie. De instellingenintegratietest voegt tijdelijk aanvragen toe voor de cliënt en de gewone consultant. Beheerders kunnen beide zien en afhandelen; gewone consultants alleen cliëntaanvragen. De test verwijdert achteraf alleen de eigen records; voer de tests uitsluitend uit tegen een testdatabase.

## GitHub Actions

De workflow `.github/workflows/playwright.yml` voert de Playwright-tests alleen uit wanneer je die handmatig start via GitHub **Actions > Playwright tests > Run workflow**. Kies de branch en start de workflow. Deze gebruikt een tijdelijke PostgreSQL-service, initialiseert die met `tests/fixtures/ci-schema.sql` en draait de tests sequentieel. Na afloop vind je onderaan de workflowrun het artefact `playwright-report`. Download en pak het uit en open `index.html` om het HTML-testrapport te bekijken. Het artefact wordt zeven dagen bewaard.

Stel de E2E-variabelen in op de accountgegevens uit dit fixture: `E2E_BEHEERDER_USERNAME=ci-consultant`, `E2E_BEHEERDER_PASSWORD=CIConsultant2026!`, `E2E_CONSULTANT_USERNAME=ci-consultant-peer`, `E2E_CONSULTANT_PASSWORD=CIConsultant2026!`, `E2E_CLIENT_USERNAME=ci-client` en `E2E_CLIENT_PASSWORD=CIClient2026!`. Deze vaste gegevens zijn uitsluitend voor de wegwerpdatabase van CI; gebruik ze niet buiten tests.
