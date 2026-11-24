# language: nl
Functionaliteit: Cliëntregistratie

  Scenario: aangemaakte accountgegevens worden getoond en bevestiging leidt terug naar login
    Gegeven ik ben op de registratiepagina
    Als ik mijn voor- en achternaam invul
    Dan wordt mijn e-mailadres automatisch ingevuld
    Als ik het account aanmaak
    Dan zie ik een bevestiging met mijn gebruikersnaam en wachtwoord
    Als ik de registratie bevestig
    Dan keer ik terug naar de loginpagina
