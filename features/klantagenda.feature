# language: nl
Functionaliteit: Klant kan afspraken aanvragen via de klantagenda

  Achtergrond:
    Gegeven ik ben ingelogd als klant

  Scenario: TC-01: geldige aanvraag verschijnt in de agenda op de eerstvolgende werkdag
    Als ik een geldige afspraak aanvraag voor de eerstvolgende werkdag
    Dan verschijnt de afspraak in de agenda

  Scenario: TC-02: datum kiezen via kalender en afspraak is zichtbaar in de volgende week
    Als ik via de kalender een afspraak voor volgende week kies
    Dan verschijnt de afspraak in de agenda van die week
    Als ik terugga naar de huidige week
    Dan is de afspraak niet zichtbaar

  Scenario: TC-03: aanvraag voor vandaag op een later tijdstip
    Als ik vandaag op een later tijdstip een afspraak aanvraag
    Dan verschijnt de afspraak in de agenda van vandaag

  Scenario: TC-04: eindtijd wordt juist berekend over het hele uur
    Als ik een afspraak met minuut 45 en duur 30 minuten aanvraag
    Dan wordt een eindtijd binnen het volgende uur getoond

  Scenario: TC-05: locatie en consultant zijn verplicht
    Als ik een afspraak verstuur zonder locatie en consultant
    Dan worden beide velden als verplicht gemeld
    En wordt geen afspraak aangemaakt

  Scenario: TC-06a: datum in het weekend wordt geweigerd
    Als ik een afspraak in het weekend probeer aan te vragen
    Dan wordt de datum geweigerd
    En wordt geen afspraak aangemaakt

  Scenario: TC-06b: datum op een niet-ingeroosterde dag wordt geweigerd
    Als ik een datum kies waarop de consultant niet werkt
    Dan wordt gemeld dat de consultant die dag niet aanwezig is
    En wordt geen aanvraag naar de API verstuurd

  Scenario: TC-06c: datum in het verleden wordt geweigerd
    Als ik een datum in het verleden probeer aan te vragen
    Dan wordt via het aanvraagformulier gemeld dat een datum in het verleden niet is toegestaan
    En wordt geen afspraak aangemaakt

  Scenario: TC-07: reden gesprek is verplicht
    Als ik een afspraak verstuur zonder reden gesprek
    Dan wordt de reden gesprek als verplicht gemeld
    En wordt geen aanvraag naar de API verstuurd

  Scenario: TC-08: duur staat vast op 30 minuten
    Dan is de afspraakduur uitgeschakeld en ingesteld op 30 minuten

  Scenario: TC-10a: speciale tekens in reden gesprek worden als tekst getoond
    Als ik een afspraak aanvraag met HTML-, XSS- en SQL-achtige tekens
    Dan wordt de reden letterlijk als tekst getoond
    En wordt geen dialoogvenster geopend

  Scenario: TC-10b: lange tekst wordt afgekapt tot 200 tekens
    Als ik een reden langer dan 200 tekens invoer
    Dan wordt maximaal 200 tekens getoond
    En blijft de agendakaart binnen de kolom
