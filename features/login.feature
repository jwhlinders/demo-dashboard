# language: nl
Functionaliteit: Loginpagina - functionele testcases

  Achtergrond:
    Gegeven ik ben op de loginpagina

  Scenario: hamburgermenu toont status- en registratiepagina’s
    Gegeven het hamburgermenu is gesloten
    Als ik het hamburgermenu open
    Dan zie ik de links voor status, wachtwoord resetten en registratie
    Als ik op Escape druk
    Dan sluit het menu en krijgt de menuknop de focus

  Scenario: TC-01: succesvol inloggen met geldige gegevens
    Gegeven ik beschik over geldige cliëntgegevens
    Als ik inlog met mijn gebruikersnaam en wachtwoord
    Dan word ik ingelogd en ga ik naar het dashboard

  Scenario: TC-02: inloggen met Enter-toets
    Gegeven ik beschik over geldige cliëntgegevens
    Als ik mijn gebruikersnaam en wachtwoord invul en op Enter druk
    Dan word ik ingelogd en ga ik naar het dashboard

  Scenario: TC-03: wachtwoord is gemaskeerd
    Als ik een wachtwoord invul
    Dan wordt het wachtwoord gemaskeerd weergegeven

  Scenario: TC-04: inloggen na eerder mislukte poging
    Gegeven ik beschik over geldige cliëntgegevens
    Als ik eerst met een verkeerd wachtwoord probeer in te loggen
    Dan zie ik een foutmelding
    Als ik daarna mijn geldige wachtwoord invul en inlog
    Dan word ik ingelogd en ga ik naar het dashboard

  Scenario: TC-05: verkeerd wachtwoord
    Gegeven ik beschik over geldige cliëntgegevens
    Als ik met een verkeerd wachtwoord probeer in te loggen
    Dan zie ik een generieke foutmelding
    En blijf ik uitgelogd

  Scenario: TC-06: onbekende gebruikersnaam geeft dezelfde generieke melding
    Gegeven ik heb de foutmelding gezien na een poging met een bestaande gebruikersnaam en verkeerd wachtwoord
    Als ik daarna met een onbekende gebruikersnaam probeer in te loggen
    Dan is de foutmelding hetzelfde
    En blijf ik uitgelogd

  Scenario: TC-07: beide velden leeg
    Als ik het formulier leeg verstuur
    Dan wordt aangegeven dat de gebruikersnaam verplicht is
    En blijf ik uitgelogd

  Scenario: TC-08: alleen wachtwoord leeg
    Gegeven ik heb mijn gebruikersnaam ingevuld
    Als ik het formulier verstuur zonder wachtwoord
    Dan wordt aangegeven dat het wachtwoord verplicht is
    En blijf ik uitgelogd

  Abstract Scenario: TC-09a: spaties rond gebruikersnaam (<rol>)
    Gegeven ik beschik over geldige gegevens voor een <rol>
    Als ik inlog met spaties rond mijn gebruikersnaam
    Dan word ik ingelogd

    Voorbeelden:
      | rol        |
      | consultant |
      | cliënt     |

  Abstract Scenario: TC-09b: gebruikersnaam in hoofdletters (<rol>)
    Gegeven ik beschik over geldige gegevens voor een <rol>
    Als ik inlog met mijn gebruikersnaam in hoofdletters
    Dan word ik ingelogd

    Voorbeelden:
      | rol        |
      | consultant |
      | cliënt     |

  Abstract Scenario: TC-09c: wachtwoord is hoofdlettergevoelig (<rol>)
    Gegeven ik beschik over geldige gegevens voor een <rol>
    Als ik inlog met mijn wachtwoord in hoofdletters
    Dan blijf ik uitgelogd

    Voorbeelden:
      | rol        |
      | consultant |
      | cliënt     |

  Scenario: TC-10a: SQL-injectie wordt geweigerd zonder databasefout
    Als ik inlog met SQL-injectie als gebruikersnaam en wachtwoord
    Dan blijf ik uitgelogd
    En zie ik geen technische foutmelding
