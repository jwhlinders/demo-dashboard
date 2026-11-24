  # language: nl
  Functionaliteit: Consultantdashboard en afspraken beheren

  Achtergrond:
  Gegeven ik ben ingelogd als consultant
  @smoke
  Scenario: TC-01: consultant kan inloggen en de volledige naam en locatie zien
  Dan zie ik mijn volledige naam, gebruikersnaam en locatie

  Scenario: TC-02: consultant kan instellingen bekijken en werkdagen wijzigen
  Als ik de instellingen open en de werkdagen controleer
  En ik maandag uitschakel en de instellingen opsla
  Dan is de wijziging opgeslagen en is maandag hersteld

  Scenario: TC-02b: consultant kan contactgegevens, functie en werktijden wijzigen
  Als ik mijn contactgegevens, functie en werktijden wijzig
  Dan worden de gegevens opgeslagen en daarna hersteld
  En kan ik mezelf niet promoveren tot beheerder

  Scenario: TC-02a: consultant kan een werklocatie kiezen en de bijbehorende adresgegevens bekijken
  Als ik een andere werklocatie selecteer
  Dan worden de bijbehorende adresgegevens getoond en opgeslagen
  En is de oorspronkelijke werklocatie hersteld

  Scenario: TC-03: consultant kan een afspraak inplannen op een werkdag
  Als ik een afspraak op een werkdag inplan
  Dan is de afspraak met de juiste gegevens aangemaakt

  Scenario: TC-04: het formulier toont een foutmelding bij een datum in het verleden
  Als ik een datum in het verleden invul
  Dan wordt gemeld dat een datum in het verleden niet is toegestaan

  Scenario: TC-05: het formulier weigert een ongeldige datum
  Als ik een ongeldige datum invul
  Dan wordt gemeld dat de ingevoerde datum ongeldig is

  Scenario: TC-06: een niet-ingeroosterde dag is niet beschikbaar als afspraakdatum
  Als ik een niet-ingeroosterde dag als afspraakdatum probeer te gebruiken
  Dan is die dag niet beschikbaar en wordt de afspraak geweigerd

  Scenario: TC-07: de API weigert een afspraak met een datum in het verleden
  Als ik via de API een afspraak in het verleden probeer te maken
  Dan wordt de afspraak geweigerd met een foutmelding

  Scenario: TC-08: een ingeplande afspraak wordt zichtbaar in de agenda
Als ik een afspraak aanmaak via de API
Dan wordt de afspraak zichtbaar in de agenda
