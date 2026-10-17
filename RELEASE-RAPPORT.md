# Release rapport — Cliëntenagenda

**Peildatum:** 15 oktober 2026  

## Samenvatting

In de webapplicatie kunnen cliënten en consultants afspraken beheren. Cliënten kunnen een account maken, hun profiel beheren en afspraken aanvragen. Consultants kunnen de agenda beheren, aanvragen bevestigen en account- en wachtwoordaanvragen behandelen. dit kan later gewijzigd worden.

Het bevat de volgende functionaliteit uitgesplitst naar userstorie:

## User stories

### US-01 — Inloggen en accounttoegang

**Als** cliënt of consultant  
**wil ik** met mijn gebruikersnaam en wachtwoord kunnen inloggen en uitloggen  
**zodat** ik toegang heb tot de agenda die bij mijn rol hoort.

**Acceptatiecriteria**
- Een gebruiker kan inloggen met gebruikersnaam en wachtwoord.
- Cliënten en consultants krijgen rolgebonden agenda- en profielmogelijkheden.
- Een gebruiker met een tijdelijk wachtwoord wordt gevraagd dit eerst te wijzigen.
- Een ingelogde gebruiker kan uitloggen.

### US-02 — Een cliëntaccount aanmaken

**Als** nieuwe cliënt  
**wil ik** mezelf registreren met mijn naam en e-mailadres  
**zodat** ik een account krijg waarmee ik afspraken kan aanvragen.

**Acceptatiecriteria**
- Voornaam, achternaam en geldig e-mailadres zijn vereist; tussenvoegsel is optioneel.
- Het systeem maakt een gebruikersnaam aan op basis van de naam en voegt bij naamconflicten een volgnummer toe.
- Het account krijgt een tijdelijk wachtwoord dat na de eerste login moet worden gewijzigd.
- Een al gebruikt e-mailadres wordt als conflict afgewezen.

### US-03 — Mijn cliëntprofiel beheren

**Als** ingelogde cliënt  
**wil ik** mijn profiel- en contactgegevens kunnen bijwerken en mijn wachtwoord kunnen wijzigen  
**zodat** mijn accountgegevens actueel blijven.

**Acceptatiecriteria**
- De cliënt kan naam, tussenvoegsel en telefoonnummer aanpassen.
- De gebruikersnaam is alleen-lezen.
- De cliënt kan een nieuw wachtwoord instellen en dit bevestigen.

### US-04 — Een afspraak aanvragen

**Als** cliënt  
**wil ik** een consultant, locatie, datum en tijd kiezen en een afspraak aanvragen  
**zodat** ik een afspraak met mijn consultant kan plannen.

**Acceptatiecriteria**
- De aanvraag bevat consultant, locatie, datum, tijdsduur en optionele toelichting.
- De datumkiezer toont niet-beschikbare dagen als uitgeschakeld.
- Datums in het verleden en dagen waarop de gekozen consultant niet werkt, worden geweigerd.
- Een nieuwe aanvraag krijgt de status *aangevraagd* en wordt opgeslagen in PostgreSQL.
- De cliënt ziet dat de aanvraag nog op bevestiging wacht.

### US-05 — De consultantagenda beheren

**Als** consultant  
**wil ik** afspraken kunnen bekijken, aanmaken, wijzigen en verwijderen  
**zodat** ik mijn werkagenda actueel kan houden.

**Acceptatiecriteria**
- De agenda toont afspraken per week en biedt navigatie naar vorige, huidige en volgende week.
- De consultant kan afspraken filteren op cliënt en ziet afspraakoverzichten.
- Nieuwe afspraken kunnen worden ingevoerd met datum, tijd, cliënt en duur.
- Datums in het verleden en dagen waarop de consultant niet werkt, worden tegengehouden.
- Een consultant kan een aanvraag definitief bevestigen.

### US-06 — Consultantgegevens en werkdagen beheren

**Als** consultant  
**wil ik** mijn account- en werkgegevens kunnen bekijken en mijn werkdagen instellen  
**zodat** afspraakaanvragen aansluiten op mijn beschikbaarheid.

**Acceptatiecriteria**
- De instellingen tonen contactgegevens, werklocatie, rol en werktijden.
- De consultant kan werkdagen instellen.
- De ingestelde werkdagen worden gebruikt bij de beschikbaarheid voor afspraakaanvragen.

### US-07 — Wachtwoordherstel aanvragen en volgen

**Als** gebruiker die geen toegang meer heeft tot zijn account  
**wil ik** een wachtwoordherstel aanvragen en de status ervan bekijken  
**zodat** ik na afhandeling weer toegang kan krijgen.

**Acceptatiecriteria**
- De gebruiker kan met de gebruikersnaam een aanvraag indienen en ontvangt een statuscode.
- Een recente dubbele aanvraag wordt herkend en als informatieve melding getoond.
- De aanvraagstatus kan met gebruikersnaam en statuscode worden bekeken.
- Alleen na afhandeling kan de gebruiker een nieuw wachtwoord instellen.
- De consultant kan aanvragen bekijken, behandelen en afhandelen; de accountsoort wordt waar beschikbaar getoond.

### US-08 — End-to-endkwaliteit controleren

**Als** ontwikkelteam  
**wil ik** kritieke gebruikersstromen automatisch testen  
**zodat** regressies in agenda-, account- en herstelprocessen eerder zichtbaar worden.

**Acceptatiecriteria**
- Playwright-tests dekken onder meer consultantlogin, agenda-interacties, afspraakaanvragen en wachtwoordaanvragen.
- GitHub Actions draait de E2E-tests bij pull requests naar `main` en op handmatige aanvraag.
- De workflow gebruikt een tijdelijke PostgreSQL-database en publiceert het HTML-testrapport als artefact.

## Release- en kwaliteitsnotities

- De applicatie gebruikt PostgreSQL; lokaal starten vereist een ingestelde `DATABASE_URL` en `npm start`.

- Afspraken bevatten persoonsgegevens zodeonde dient de app niet publiek beschikbaar moet worden gemaakt zonder passende toegangsbeveiliging.
