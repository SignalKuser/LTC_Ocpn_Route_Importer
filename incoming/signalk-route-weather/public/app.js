'use strict'

const API_ROOT = '/signalk/v2/api'
const API_V1 = '/signalk/v1/api'
const PLUGIN_API = '/plugins/signalk-route-weather'
const SETTINGS_KEY = 'ltc-route-importer-settings-v2'
const LEGACY_SETTINGS_KEY = 'ltc-route-importer-settings-v1'
const EARTH_RADIUS_M = 6371008.8
const MS_TO_KNOTS = 1.9438444924406
const MPS_TO_KMH = 3.6
const LOCALES = { de: 'de-DE', nl: 'nl-NL', fr: 'fr-FR', gb: 'en-GB' }
const DEFAULT_WIND_REACH_LEVEL = 3
const EXTRA_FIELDS = {
  visibility: ['Visibility', 'nm'], precipitation: ['Precipitation', 'mm'], cloud: ['Cloud cover', '%'],
  humidity: ['Humidity', '%'], waveHeight: ['Wave height', 'm'], waveDirection: ['Wave direction', '°'],
  wavePeriod: ['Wave period', 's'], windWaveHeight: ['Wind wave height', 'm'], swellHeight: ['Swell height', 'm'],
  seaTemperature: ['Sea temperature', '°C'], seaLevel: ['Sea level', 'm'],
  currentSpeed: ['Model current speed', 'kn'], currentDirection: ['Model current direction', '°']
}
const MARINE_EXTRAS = Object.keys(EXTRA_FIELDS).slice(4)
const BASE_EXTRA_LABELS = Object.values(EXTRA_FIELDS).map(([label]) => label)
Object.assign(EXTRA_FIELDS, {
  cape: ['CAPE', 'J/kg'], cin: ['CIN', 'J/kg'], reflectivity: ['Reflectivity', 'dBZ'],
  iceCover: ['Ice cover', '%'], iceThickness: ['Ice thickness', 'm'], dewPoint: ['Dew point', '°C']
})
const LOCAL_MARINE_EXTRAS = [...MARINE_EXTRAS, 'iceCover', 'iceThickness']
const LOCAL_GRIB = 'local-grib'
const SMHI_EXTRAS = ['visibility', 'precipitation', 'cloud', 'humidity']
const PROVIDER_COVERAGE = {
  smhi: { de: 'Schweden und Umgebung', nl: 'Zweden en omgeving', fr: 'Suède et environs', gb: 'Sweden and surrounding areas' },
  'open-meteo': { de: 'Weltweit', nl: 'Wereldwijd', fr: 'Monde entier', gb: 'Worldwide' },
  'met-no': { de: 'Weltweit', nl: 'Wereldwijd', fr: 'Monde entier', gb: 'Worldwide' },
  'dwd-grib': { de: 'Europa', nl: 'Europa', fr: 'Europe', gb: 'Europe' },
  'knmi-grib': { de: 'Niederlande und Umgebung', nl: 'Nederland en omgeving', fr: 'Pays-Bas et environs', gb: 'Netherlands and surrounding areas' },
  'kmi-grib': { de: 'Belgien und Umgebung', nl: 'België en omgeving', fr: 'Belgique et environs', gb: 'Belgium and surrounding areas' },
  'dmi-grib': { de: 'Nordwesteuropa (DINI)', nl: 'Noordwest-Europa (DINI)', fr: 'Nord-ouest de l’Europe (DINI)', gb: 'Northwestern Europe (DINI)' },
  'fmi-grib': { de: 'Skandinavien und Finnland', nl: 'Scandinavië en Finland', fr: 'Scandinavie et Finlande', gb: 'Scandinavia and Finland' },
  'meteo-france-grib': { de: 'Frankreich und Umgebung', nl: 'Frankrijk en omgeving', fr: 'France et environs', gb: 'France and surrounding areas' },
  'ecmwf-grib': { de: 'Weltweit', nl: 'Wereldwijd', fr: 'Monde entier', gb: 'Worldwide' },
  'dwd-icon-d2': { de: 'Mitteleuropa', nl: 'Midden-Europa', fr: 'Europe centrale', gb: 'Central Europe' },
  'ukmo-ukv': { de: 'UK und Irland', nl: 'VK en Ierland', fr: 'R.-U. et Irlande', gb: 'UK and Ireland' },
}
const WORLDWIDE = PROVIDER_COVERAGE['ecmwf-grib']
const VARIABLE_GRID = { de: 'variable Rasterweite', nl: 'variabele rasterafstand', fr: 'maille variable', gb: 'variable grid spacing' }
const PROVIDER_GRID_KM = {
  smhi: 2.5,
  'dwd-grib': 6.5, 'dwd-icon-d2': 2.1, 'dwd-icon-global': 13,
  'dmi-grib': 2, 'fmi-grib': 2.5, 'meteo-france-grib': 2.5, 'knmi-grib': 2,
  'ukmo-ukv': 2, 'ukmo-ukv-netcdf': 2, 'ecmwf-grib': 25, 'ecmwf-01-grib': 9, 'noaa-gfs025': 28
}
const WIND_REACH_LEVELS = [
  { distanceNm: 0.5, minutes: 10 },
  { distanceNm: 1, minutes: 20 },
  { distanceNm: 2, minutes: 30 },
  { distanceNm: 3, minutes: 45 },
  { distanceNm: 5, minutes: 60 },
  ...Array.from({ length: 10 }, (_, index) => ({
    distanceNm: 5 + (index + 1) * 2,
    minutes: 60 + (index + 1) * 24
  }))
]
const PROVIDER_CATALOG = [
  { id: 'smhi', name: 'SMHI Signal K Provider', url: 'https://github.com/fymmot/signalk-smhi-weather-provider', noteKey: 'note-smhi' },
  { id: 'open-meteo', name: 'Open-Meteo', url: 'https://open-meteo.com/en/about', noteKey: 'note-open-meteo' },
  { id: 'met-no', name: 'MET Norway (met.no)', url: 'https://api.met.no/doc/TermsOfService', noteKey: 'note-met-no' },
  { id: 'dwd-grib', name: 'DWD ICON-EU (GRIB)', url: 'https://opendata.dwd.de/weather/nwp/icon-eu/grib/', noteKey: 'note-dwd' },
  { id: 'dwd-icon-d2', name: 'DWD ICON-D2 (API)', url: 'https://open-meteo.com/en/docs/dwd-api', noteKey: 'note-open-meteo' },
  { id: 'dwd-icon-global', name: 'DWD ICON Global (API)', url: 'https://open-meteo.com/en/docs/dwd-api', noteKey: 'note-open-meteo' },
  { id: 'knmi-grib', name: 'KNMI HARM (GRIB)', url: 'https://developer.dataplatform.knmi.nl/open-data-api', noteKey: 'note-knmi', key: true },
  { id: 'kmi-grib', name: 'KMI ALARO (GRIB)', url: 'https://opendata.meteo.be/ftp/forecasts/alaro_40l/', noteKey: 'note-kmi' },
  { id: 'dmi-grib', name: 'DMI HARM (API)', url: 'https://www.dmi.dk/friedata/dokumentation/data/forecast-data-weather-model-harmonie-for-dini-and-ig', noteKey: 'note-dmi' },
  { id: 'fmi-grib', name: 'FMI HARMONIE (GRIB)', url: 'https://en.ilmatieteenlaitos.fi/open-data-manual-forecast-models', noteKey: 'note-fmi' },
  { id: 'meteo-france-grib', name: 'Météo-France AROME (GRIB)', url: 'https://www.data.gouv.fr/datasets/donnees-pnt-retention-14-jours/', noteKey: 'note-meteo-france' },
  { id: 'ecmwf-grib', name: 'ECMWF IFS 0.25° (GRIB)', url: 'https://data.ecmwf.int/forecasts/', noteKey: 'note-ecmwf' },
  { id: 'ecmwf-01-grib', name: 'ECMWF IFS 0.1° (GRIB)', url: 'https://data.ecmwf.int/forecasts/', noteKey: 'note-ecmwf' },
  { id: 'ukmo-ukv', name: 'Met Office UKV (API)', url: 'https://open-meteo.com/en/docs/ukmo-api', noteKey: 'note-open-meteo' },
  { id: 'ukmo-ukv-netcdf', name: 'Met Office UKV (NetCDF)', url: 'https://registry.opendata.aws/met-office-uk-deterministic/', noteKey: 'note-ukv-netcdf' },
  { id: 'noaa-gfs025', name: 'NOAA GFS (GRIB)', url: 'https://www.nco.ncep.noaa.gov/pmb/products/gfs/nomads/', noteKey: 'note-ecmwf' }
]
const translations = {
  de: {
    'Language':'Sprache','Connecting to Signal K':'Verbinde mit Signal K','Weather along the route':'Wetter entlang der Route',
    'ROUTE':'ROUTE','Loading routes …':'Routen werden geladen …','Delete':'Löschen','WEATHER PROVIDER':'WETTERANBIETER',
    'Loading providers …':'Anbieter werden geladen …','WEATHER REFRESH':'WETTER AKTUALISIEREN',
    'Every 15 minutes':'Alle 15 Minuten','Every 30 minutes':'Alle 30 Minuten','Every 1 hour':'Alle 1 Stunde','Every 2 hours':'Alle 2 Stunden','Every 3 hours':'Alle 3 Stunden','Every 6 hours':'Alle 6 Stunden','Every 12 hours':'Alle 12 Stunden','Every 24 hours':'Alle 24 Stunden','Refresh now':'Jetzt aktualisieren',
    'ETA CALCULATION':'ETA-BERECHNUNG','Choose optional data sources':'Optionale Datenquellen auswählen','GPS, SOG and COG':'GPS, SOG und COG','GPS description':'Position und tatsächliche Fahrt über Grund; enthält bereits Wind- und Strömungseinfluss.',
    'Engine on/off':'Maschine an/aus','Motor description':'Bei aktivierter Maschine wird die eingestellte Motor-SOG für die ETA verwendet.','STW through water':'STW – Speed Through Water','STW description':'Wenn GPS/SOG fehlt, kann STW als Geschwindigkeitsbasis für die ETA dienen; mit Strömungsvektor wird die Fahrt über Grund prognostiziert. Ohne GPS-Position bleibt der tatsächliche Routenfortschritt unbekannt.','Current vector':'Strömungsvektor','Checking current source …':'Prüfe eure LTC-Strömungsdaten …',
    'LTC boat polar':'Polardaten','Select LTC polar':'LTC-Polardatei auswählen, um Windwinkel und Fahrt durchs Wasser zu berechnen.','SMHI forecast wind':'SMHI-Vorhersagewind','Forecast wind description':'SMHI-Wind für die LTC-Polar und ETA entlang der Route verwenden.','AWS label':'AWS – Apparent Wind Speed','Onboard wind':'Bordwind (Signal K)','Checking onboard wind …':'Prüfe eigene Windmessung …',
    'LTC POLAR DATA DIRECTORY':'LTC-POLARDATEN-ORDNER AUF DEM SIGNAL-K-PI','Polar directory help':'Der Pfad ist pro Pi einstellbar. LTC speichert eigene Polaren als JSON-Dateien. Beispiel: /home/pi/LTC/Polardata/speech2polardata','DIRECTORY':'ORDNER','Check and save':'Ordner prüfen und übernehmen','SAVED LTC POLARS':'GESPEICHERTE LTC-POLARE','Configure polar directory first':'Zuerst Polardaten-Ordner konfigurieren',
    'SELECTED ROUTE':'AUSGEWÄHLTE ROUTE','No route selected':'Noch keine Route ausgewählt','Distance remaining':'Restdistanz','Weather loaded':'Wetter geladen','Forecast along route':'Wettervorhersage entlang der Route','WAYPOINT':'WEGPUNKT','ARRIVAL':'ANKUNFT','WIND':'WIND','TEMPERATURE':'TEMPERATUR','AIR PRESSURE':'LUFTDRUCK','Select a route to calculate forecast':'Route aus der Liste auswählen, um die Vorhersage zu berechnen.','Status help':'GPS/SOG/COG aktualisieren unterwegs den Fortschritt. Motor, STW, LTC-Polare und Strömungsvektor sind einzeln zuschaltbar.','Forecast source':'Prognose: SMHI über Signal K Weather API · Alle Zeiten Ortszeit des PCs',
    'Delete route?':'Route „{name}“ aus Signal K löschen? Dieser Vorgang kann nicht rückgängig gemacht werden.','No suitable routes':'Signal K enthält noch keine geeignete Route mit mindestens zwei Wegpunkten.','Route refresh failed':'Routen konnten nicht aktualisiert werden: {error}','Route deleted':'Route „{name}“ wurde gelöscht.','Route delete failed':'Route konnte nicht gelöscht werden: {error}','No routes found':'Keine importierten Routen gefunden','No weather providers':'Keine Wetteranbieter registriert','Providers unavailable':'Wetteranbieter nicht erreichbar',
    'Forecast missing':'Vorhersage fehlt','ETA unavailable':'ETA nicht berechenbar','Enable ETA source':'Eine ETA-Quelle aktivieren.','Already passed':'Bereits passiert','Loading forecast':'Wird geladen …','No matching forecast':'Keine passende Zeitstufe','Weather refreshed':'Wetterdaten abgerufen und gespeichert.','Forecast unavailable':'Vorhersage fehlt für {count} Wegpunkt(e).','No provider selected':'Kein Wetteranbieter ausgewählt. SMHI in Signal K aktivieren oder einen Anbieter auswählen.','Passed suffix':' · passiert','Forecast':'Vorhersage','Current':'Strom','Along':'längs'
  },
  nl: {
    'Language':'Taal','Connecting to Signal K':'Verbinden met Signal K','Weather along the route':'Weer langs de route','ROUTE':'ROUTE','Loading routes …':'Routes laden …','Delete':'Verwijderen','WEATHER PROVIDER':'WEERAANBIEDER','Loading providers …':'Aanbieders laden …','WEATHER REFRESH':'WEER VERVERSEN','Every 15 minutes':'Elke 15 minuten','Every 30 minutes':'Elke 30 minuten','Every 1 hour':'Elk uur','Every 2 hours':'Elke 2 uur','Every 3 hours':'Elke 3 uur','Every 6 hours':'Elke 6 uur','Every 12 hours':'Elke 12 uur','Every 24 hours':'Elke 24 uur','Refresh now':'Nu verversen','ETA CALCULATION':'ETA-BEREKENING','Choose optional data sources':'Kies optionele gegevensbronnen','GPS, SOG and COG':'GPS, SOG en COG','GPS description':'Positie en werkelijke snelheid over de grond; bevat al wind- en stromingseffecten.','Engine on/off':'Motor aan/uit','Motor description':'Met de motor ingeschakeld gebruikt de ETA de ingestelde Motor-SOG.','STW through water':'STW – Speed Through Water','STW description':'Als GPS/SOG ontbreekt, kan STW als snelheid voor de ETA dienen; met een stroomvector wordt snelheid over de grond voorspeld. Zonder GPS-positie is de voortgang op de route onbekend.','Current vector':'Stroomvector','Checking current source …':'Stroombron van Signal K controleren …','LTC boat polar':'Polaire gegevens','Select LTC polar':'Selecteer een LTC-polar om windhoek en snelheid door het water te berekenen.','SMHI forecast wind':'SMHI-windverwachting','Forecast wind description':'Gebruik SMHI-wind voor LTC-polar en ETA langs de route.','AWS label':'AWS – Apparent Wind Speed','Onboard wind':'Wind aan boord (Signal K)','Checking onboard wind …':'Eigen windmeting controleren …','LTC POLAR DATA DIRECTORY':'LTC-POLARDATAMAP OP DE SIGNAL-K-PI','Polar directory help':'Het pad is per Pi instelbaar. LTC bewaart eigen polars als JSON-bestanden. Voorbeeld: /home/pi/LTC/Polardata/speech2polardata','DIRECTORY':'MAP','Check and save':'Controleren en opslaan','SAVED LTC POLARS':'OPGESLAGEN LTC-POLARS','Configure polar directory first':'Configureer eerst de polarmap','SELECTED ROUTE':'GESELECTEERDE ROUTE','No route selected':'Geen route geselecteerd','Distance remaining':'Resterende afstand','Weather loaded':'Weer geladen','Forecast along route':'Weersverwachting langs de route','WAYPOINT':'WAYPOINT','ARRIVAL':'AANKOMST','WIND':'WIND','TEMPERATURE':'TEMPERATUUR','AIR PRESSURE':'LUCHTDRUK','Select a route to calculate forecast':'Selecteer een route om de verwachting te berekenen.','Status help':'GPS/SOG/COG werken de voortgang bij. Motor, STW, LTC-polar en stroomvector zijn afzonderlijk in te schakelen.','Forecast source':'Verwachting: SMHI via Signal K Weather API · Alle tijden lokale tijd van de pc','Delete route?':'Route „{name}“ uit Signal K verwijderen? Dit kan niet ongedaan worden gemaakt.','No suitable routes':'Signal K bevat geen geschikte route met minstens twee waypoints.','Route refresh failed':'Routes konden niet worden bijgewerkt: {error}','Route deleted':'Route „{name}“ is verwijderd.','Route delete failed':'Route kon niet worden verwijderd: {error}','No routes found':'Geen geïmporteerde routes gevonden','No weather providers':'Geen weerproviders geregistreerd','Providers unavailable':'Weerproviders niet bereikbaar','Forecast missing':'Verwachting ontbreekt','ETA unavailable':'ETA niet berekenbaar','Enable ETA source':'Schakel een ETA-bron in.','Already passed':'Al gepasseerd','Loading forecast':'Laden …','No matching forecast':'Geen passend tijdstip','Weather refreshed':'Weergegevens opgehaald en opgeslagen.','Forecast unavailable':'Verwachting ontbreekt voor {count} waypoint(s).','No provider selected':'Geen weerprovider geselecteerd. Schakel SMHI in Signal K in of kies een provider.','Passed suffix':' · gepasseerd','Forecast':'Verwachting','Current':'Stroom','Along':'langs'
  },
  fr: {
    'Language':'Langue','Connecting to Signal K':'Connexion à Signal K','Weather along the route':'Météo le long de la route','ROUTE':'ROUTE','Loading routes …':'Chargement des routes …','Delete':'Supprimer','WEATHER PROVIDER':'FOURNISSEUR MÉTÉO','Loading providers …':'Chargement des fournisseurs …','WEATHER REFRESH':'ACTUALISATION MÉTÉO','Every 15 minutes':'Toutes les 15 minutes','Every 30 minutes':'Toutes les 30 minutes','Every 1 hour':'Toutes les heures','Every 2 hours':'Toutes les 2 heures','Every 3 hours':'Toutes les 3 heures','Every 6 hours':'Toutes les 6 heures','Every 12 hours':'Toutes les 12 heures','Every 24 hours':'Toutes les 24 heures','Refresh now':'Actualiser','ETA CALCULATION':'CALCUL DE L’ETA','Choose optional data sources':'Choisir les sources de données facultatives','GPS, SOG and COG':'GPS, SOG et COG','GPS description':'Position et vitesse fond réelle ; inclut déjà les effets du vent et du courant.','Engine on/off':'Moteur marche/arrêt','Motor description':'Lorsque le moteur est activé, l’ETA utilise la valeur Motor-SOG réglée.','STW through water':'STW – Speed Through Water','STW description':'Si le GPS/SOG manque, la STW peut servir de base de vitesse pour l’ETA ; avec un vecteur de courant, la vitesse fond est estimée. Sans position GPS, la progression réelle sur la route reste inconnue.','Current vector':'Vecteur de courant','Checking current source …':'Vérification de la source de courant Signal K …','LTC boat polar':'Données polaires','Select LTC polar':'Sélectionnez une polaire LTC pour calculer l’angle du vent et la vitesse dans l’eau.','SMHI forecast wind':'Prévision de vent SMHI','Forecast wind description':'Utiliser le vent SMHI pour la polaire LTC et l’ETA le long de la route.','AWS label':'AWS – Apparent Wind Speed','Onboard wind':'Vent mesuré à bord (Signal K)','Checking onboard wind …':'Vérification de la mesure de vent …','LTC POLAR DATA DIRECTORY':'DOSSIER DES POLAIRES LTC SUR LE PI SIGNAL K','Polar directory help':'Le chemin est configurable sur chaque Pi. LTC enregistre les polaires en fichiers JSON. Exemple : /home/pi/LTC/Polardata/speech2polardata','DIRECTORY':'DOSSIER','Check and save':'Vérifier et enregistrer','SAVED LTC POLARS':'POLAIRES LTC ENREGISTRÉES','Configure polar directory first':'Configurez d’abord le dossier des polaires','SELECTED ROUTE':'ROUTE SÉLECTIONNÉE','No route selected':'Aucune route sélectionnée','Distance remaining':'Distance restante','Weather loaded':'Météo chargée','Forecast along route':'Prévisions météo le long de la route','WAYPOINT':'POINT DE ROUTE','ARRIVAL':'ARRIVÉE','WIND':'VENT','TEMPERATURE':'TEMPÉRATURE','AIR PRESSURE':'PRESSION','Select a route to calculate forecast':'Sélectionnez une route pour calculer les prévisions.','Status help':'Le GPS/SOG/COG met à jour la progression. Moteur, STW, polaire LTC et courant sont activables séparément.','Forecast source':'Prévisions : SMHI via l’API météo Signal K · Heures locales du PC','Delete route?':'Supprimer la route « {name} » de Signal K ? Cette action est irréversible.','No suitable routes':'Signal K ne contient aucune route adaptée avec au moins deux points.','Route refresh failed':'Échec de l’actualisation des routes : {error}','Route deleted':'La route « {name} » a été supprimée.','Route delete failed':'Impossible de supprimer la route : {error}','No routes found':'Aucune route importée','No weather providers':'Aucun fournisseur météo enregistré','Providers unavailable':'Fournisseurs météo inaccessibles','Forecast missing':'Prévision manquante','ETA unavailable':'ETA non calculable','Enable ETA source':'Activez une source ETA.','Already passed':'Déjà passé','Loading forecast':'Chargement …','No matching forecast':'Aucun créneau correspondant','Weather refreshed':'Données météo mises à jour. Prochaine mise à jour dans {interval}.','Forecast unavailable':'Prévision absente pour {count} point(s). Prochaine mise à jour dans {interval}.','No provider selected':'Aucun fournisseur météo sélectionné. Activez SMHI dans Signal K ou choisissez un fournisseur.','Passed suffix':' · passé','Forecast':'Prévision','Current':'Courant','Along':'longitudinal'
  },
  gb: {
    'Language':'Language','Connecting to Signal K':'Connecting to Signal K','Weather along the route':'Weather along the route','ROUTE':'ROUTE','Loading routes …':'Loading routes …','Delete':'Delete','WEATHER PROVIDER':'WEATHER PROVIDER','Loading providers …':'Loading providers …','WEATHER REFRESH':'WEATHER REFRESH','Every 15 minutes':'Every 15 minutes','Every 30 minutes':'Every 30 minutes','Every 1 hour':'Every 1 hour','Every 2 hours':'Every 2 hours','Every 3 hours':'Every 3 hours','Every 6 hours':'Every 6 hours','Every 12 hours':'Every 12 hours','Every 24 hours':'Every 24 hours','Refresh now':'Refresh now','ETA CALCULATION':'ETA CALCULATION','Choose optional data sources':'Choose optional data sources','GPS, SOG and COG':'GPS, SOG and COG','GPS description':'Position and actual speed over ground; already includes wind and current effects.','Engine on/off':'Engine on/off','Motor description':'With the engine enabled, ETA uses the configured Motor-SOG.','STW through water':'STW – Speed Through Water','STW description':'If GPS/SOG is unavailable, STW can provide the ETA speed basis; with a current vector, speed over ground is forecast. Without a GPS position, actual progress along the route is unknown.','Current vector':'Current vector','Checking current source …':'Checking Signal K current source …','LTC boat polar':'Polar data','Select LTC polar':'Select an LTC polar to calculate wind angle and speed through water.','SMHI forecast wind':'SMHI forecast wind','Forecast wind description':'Use SMHI wind with the LTC polar to calculate ETA along the route.','AWS label':'AWS – Apparent Wind Speed','Onboard wind':'Onboard wind (Signal K)','Checking onboard wind …':'Checking onboard wind measurement …','LTC POLAR DATA DIRECTORY':'LTC POLAR DATA DIRECTORY ON SIGNAL K PI','Polar directory help':'The path is configurable per Pi. LTC saves personal polars as JSON files. Example: /home/pi/LTC/Polardata/speech2polardata','DIRECTORY':'DIRECTORY','Check and save':'Check and save','SAVED LTC POLARS':'SAVED LTC POLARS','Configure polar directory first':'Configure the polar directory first','SELECTED ROUTE':'SELECTED ROUTE','No route selected':'No route selected','Distance remaining':'Distance remaining','Weather loaded':'Weather loaded','Forecast along route':'Weather forecast along the route','WAYPOINT':'WAYPOINT','ARRIVAL':'ARRIVAL','WIND':'WIND','TEMPERATURE':'TEMPERATURE','AIR PRESSURE':'AIR PRESSURE','Select a route to calculate forecast':'Select a route to calculate the forecast.','Status help':'GPS/SOG/COG update progress underway. Motor, STW, LTC polar and current vector can be enabled separately.','Forecast source':'Forecast: SMHI via Signal K Weather API · All times are local to the PC','Delete route?':'Delete route “{name}” from Signal K? This cannot be undone.','No suitable routes':'Signal K contains no suitable route with at least two waypoints.','Route refresh failed':'Could not refresh routes: {error}','Route deleted':'Route “{name}” was deleted.','Route delete failed':'Could not delete route: {error}','No routes found':'No imported routes found','No weather providers':'No weather providers registered','Providers unavailable':'Weather providers unavailable','Forecast missing':'Forecast unavailable','ETA unavailable':'ETA cannot be calculated','Enable ETA source':'Enable an ETA source.','Already passed':'Already passed','Loading forecast':'Loading …','No matching forecast':'No matching forecast time','Weather refreshed':'Weather data refreshed. Next update in {interval}.','Forecast unavailable':'Forecast unavailable for {count} waypoint(s). Next update in {interval}.','No provider selected':'No weather provider selected. Enable SMHI in Signal K or choose a provider.','Passed suffix':' · passed','Forecast':'Forecast','Current':'Current','Along':'along'
  }
}

Object.assign(translations.de, { 'Reload routes':'Routen neu laden','Polar directory placeholder':'Absoluter Pfad auf diesem Pi' })
Object.assign(translations.nl, { 'Reload routes':'Routes opnieuw laden','Polar directory placeholder':'Absoluut pad op deze Pi','LTC boat polar':'Polaire gegevens' })
Object.assign(translations.fr, { 'Reload routes':'Recharger les routes','Polar directory placeholder':'Chemin absolu sur ce Pi' })
Object.assign(translations.gb, { 'Reload routes':'Reload routes','Polar directory placeholder':'Absolute path on this Pi' })
for (const locale of ['de', 'nl', 'fr', 'gb']) Object.assign(translations[locale], { 'WEATHER PROVIDER':'PROVIDER' })
Object.assign(translations.de, { 'Total route time':'Gesamtzeit der Route','Average speed':'Durchschnittsknoten' })
Object.assign(translations.nl, { 'Total route time':'Totale routetijd','Average speed':'Gemiddelde snelheid' })
Object.assign(translations.fr, { 'Total route time':'Durée totale de la route','Average speed':'Vitesse moyenne' })
Object.assign(translations.gb, { 'Total route time':'Total route time','Average speed':'Average speed' })
Object.assign(translations.de, { 'Wind from':'Wind aus','Onboard wind available':'Bordwind verfügbar ({source}): {speed} kn aus {direction}°','No onboard true wind':'Kein wahrer Wind an Signal K gemeldet.','Weather follows ETA':'Wetter folgt der ETA.','Loading route weather':'Wetter für Route wird geladen …' })
Object.assign(translations.nl, { 'Wind from':'Wind uit','Onboard wind available':'Wind aan boord beschikbaar ({source}): {speed} kn uit {direction}°','No onboard true wind':'Geen ware wind beschikbaar in Signal K.','Weather follows ETA':'Weer volgt de ETA.','Loading route weather':'Routeweer laden …' })
Object.assign(translations.fr, { 'Wind from':'Vent de','Onboard wind available':'Vent mesuré disponible ({source}) : {speed} nd de {direction}°','No onboard true wind':'Aucun vent réel disponible dans Signal K.','Weather follows ETA':'La météo suit l’ETA.','Loading route weather':'Chargement de la météo de la route …' })
Object.assign(translations.gb, { 'Wind from':'Wind from','Onboard wind available':'Onboard wind available ({source}): {speed} kn from {direction}°','No onboard true wind':'No true wind data reported to Signal K.','Weather follows ETA':'Weather follows the ETA.','Loading route weather':'Loading route weather …' })
Object.assign(translations.de, { 'Gusts':'Böen','No gusts':'Böen —','Motor plan':'Motor-Planfahrt','Planned speed':'Planfahrt','GPS SOG':'GPS/SOG','STW':'STW','Polar':'Polardaten','No route selected':'Noch keine Route ausgewählt' })
Object.assign(translations.nl, { 'Gusts':'Vlagen','No gusts':'Vlagen —','Motor plan':'Motorplan','Planned speed':'Geplande snelheid','GPS SOG':'GPS/SOG','STW':'STW','Polar':'Polaire gegevens','No route selected':'Geen route geselecteerd' })
Object.assign(translations.fr, { 'Gusts':'Rafales','No gusts':'Rafales —','Motor plan':'Navigation au moteur','Planned speed':'Vitesse prévue','GPS SOG':'GPS/SOG','STW':'STW','Polar':'Données polaires','No route selected':'Aucune route sélectionnée' })
Object.assign(translations.gb, { 'Gusts':'Gusts','No gusts':'Gusts —','Motor plan':'Motor plan','Planned speed':'Planned speed','GPS SOG':'GPS/SOG','STW':'STW','Polar':'Polar data','No route selected':'No route selected' })
Object.assign(translations.de, { 'Onboard wind ETA description':'Für die ETA wird der aktuelle Signal-K-Wind für die künftigen Streckenabschnitte angenommen. Fehlt wahrer Wind, leitet die App ihn aus AWS/AWA sowie Bootsgeschwindigkeit und Kurs ab. Die LTC-Polare wird nur gelesen, nicht verändert.' })
Object.assign(translations.nl, { 'Onboard wind ETA description':'Voor de ETA wordt de huidige Signal K-wind aangenomen voor de komende trajecten. Als ware wind ontbreekt, leidt de app die af uit AWS/AWA en bootsnelheid en koers. De LTC-polar wordt alleen gelezen en niet gewijzigd.' })
Object.assign(translations.fr, { 'Onboard wind ETA description':'Pour l’ETA, le vent Signal K actuel est supposé constant sur les prochains tronçons. Si le vent réel manque, l’app le calcule depuis AWS/AWA, la vitesse et le cap du bateau. La polaire LTC est uniquement lue, jamais modifiée.' })
Object.assign(translations.gb, { 'Onboard wind ETA description':'For ETA, the current Signal K wind is assumed for future route legs. If true wind is unavailable, the app derives it from AWS/AWA plus boat speed and heading/course. The LTC polar is read for calculations and never modified.' })
Object.assign(translations.de, { 'KNOTS':'KN','TWS / TWA':'TWS / TWA','WIND WEIGHT':'WINDGEWICHTUNG' })
Object.assign(translations.nl, { 'KNOTS':'KN','TWS / TWA':'TWS / TWA','WIND WEIGHT':'WINDWEGING' })
Object.assign(translations.fr, { 'KNOTS':'KN','TWS / TWA':'TWS / TWA','WIND WEIGHT':'PONDÉRATION DU VENT' })
Object.assign(translations.gb, { 'KNOTS':'KN','TWS / TWA':'TWS / TWA','WIND WEIGHT':'WIND WEIGHT' })
Object.assign(translations.de, { 'Onboard short':'Bord','Forecast short':'Provider' })
Object.assign(translations.nl, { 'Onboard short':'Aan boord','Forecast short':'Provider' })
Object.assign(translations.fr, { 'Onboard short':'À bord','Forecast short':'Fournisseur' })
Object.assign(translations.gb, { 'Onboard short':'Onboard','Forecast short':'Provider' })
Object.assign(translations.de, { 'Onboard short':'Boot','Total route time':'Geschätzte Gesamtzeit','Average speed':'Durchschnitt','day short':'d','hour short':'h','minute short':'min' })
Object.assign(translations.nl, { 'Total route time':'Geschatte totale tijd','Average speed':'Gemiddelde snelheid','day short':'d','hour short':'u','minute short':'min' })
Object.assign(translations.fr, { 'Total route time':'Durée totale estimée','Average speed':'Vitesse moyenne','day short':'j','hour short':'h','minute short':'min' })
Object.assign(translations.gb, { 'Total route time':'Estimated total time','Average speed':'Average speed','day short':'d','hour short':'h','minute short':'min' })
for (const [locale, values] of Object.entries({
  de: { 'Provider page title':'Wetteranbieter und Zugang','Provider page intro':'Offizielle Anbieter-Seiten, Zugangsvoraussetzungen und gespeicherte Schlüssel.','Open provider access page':'Anbieter- und API-Seite öffnen','API key required':'API-Key erforderlich','No API key required':'Kein API-Key erforderlich','Key present':'Schlüssel gespeichert','Key missing':'Kein Schlüssel gespeichert','Save key':'Schlüssel speichern','Delete key':'Schlüssel löschen','MET Norway contact':'Kontakt für MET Norway User-Agent','Save contact':'Kontakt speichern','Raster cache empty':'Noch keine Rasterdateien gespeichert. Rasterdownload ist noch nicht angebunden.','Raster cache count':'{count} Rasterdatei(en), {size} gespeichert.','Delete raster cache confirmation':'Alle lokal gespeicherten Rasterdaten auf diesem Signal-K-Pi löschen?','Raster cache deleted':'Lokaler Rasterbestand gelöscht.','Credentials saved':'Zugangsdaten auf dem Signal-K-Pi gespeichert.','Credentials failed':'Zugangsdaten konnten nicht gespeichert werden: {error}','Credentials deleted':'Gespeicherter Schlüssel gelöscht.','Credential delete failed':'Schlüssel konnte nicht gelöscht werden: {error}','Cache load failed':'Rasterbestand konnte nicht gelesen werden: {error}','Cache delete failed':'Rasterdaten konnten nicht gelöscht werden: {error}','Page previous':'← Zurück','Page next':'Weiter →','Page label':'Seite {current} von 2','Key not used yet':'Wird erst verwendet, wenn dieser Rasteranbieter angebunden ist.','Met no contact help':'MET.no braucht keinen API-Key, verlangt aber eine Kontaktangabe im User-Agent.','Raster data title':'Gespeicherte Rasterdaten','Delete raster files':'Rasterdaten löschen','Raster storage explanation':'Nach der späteren Anbindung können passende Vorhersageraster auf dem Pi gespeichert und offline wiederverwendet werden. Der lokale Bestand kann hier gelöscht werden.','note-smhi':'Signal K stellt die Vorhersage bereit; diese App braucht dafür keinen eigenen Schlüssel.','note-open-meteo':'Für die kostenlose nicht-kommerzielle API ist kein Schlüssel nötig.','note-met-no':'Kein API-Key. MET.no verlangt eine Kontaktangabe im User-Agent.','note-dwd':'Öffentliche DWD Open Data Dateien; kein API-Key für den Download.','note-knmi':'Kostenloser API-Key für die KNMI Open Data API erforderlich.','note-kmi':'Öffentliche ALARO-GRIB-Dateien des KMI.','note-dmi':'DMI verlangt für die Open Data APIs weder Registrierung noch API-Key.','note-fmi':'FMI Open Data; für öffentliche Modell-Dateien wird kein API-Key angegeben.','note-meteo-france':'Öffentliche AROME-Oberflächenvorhersagen von Météo-France.','note-ecmwf':'Öffentlicher Open-Data-Ausschnitt; kein Schlüssel für öffentliche Downloads.' },
  nl: { 'Provider page title':'Weerproviders en toegang','Provider page intro':'Officiële providerpagina’s, toegangsvereisten en opgeslagen sleutels.','Open provider access page':'Provider- en API-pagina openen','API key required':'API-sleutel vereist','No API key required':'Geen API-sleutel vereist','Key present':'Sleutel opgeslagen','Key missing':'Geen sleutel opgeslagen','Save key':'Sleutel opslaan','Delete key':'Sleutel verwijderen','MET Norway contact':'Contact voor MET Norway User-Agent','Save contact':'Contact opslaan','Raster cache empty':'Nog geen rasterbestanden opgeslagen. Rasterdownload is nog niet aangesloten.','Raster cache count':'{count} rasterbestand(en), {size} opgeslagen.','Delete raster cache confirmation':'Alle lokaal opgeslagen rastergegevens op deze Signal K-Pi verwijderen?','Raster cache deleted':'Lokale rasterbestanden verwijderd.','Credentials saved':'Toegangsgegevens opgeslagen op de Signal K-Pi.','Credentials failed':'Toegangsgegevens konden niet worden opgeslagen: {error}','Credentials deleted':'Opgeslagen sleutel verwijderd.','Credential delete failed':'Sleutel kon niet worden verwijderd: {error}','Cache load failed':'Rasterbestanden konden niet worden gelezen: {error}','Cache delete failed':'Rastergegevens konden niet worden verwijderd: {error}','Page previous':'← Terug','Page next':'Verder →','Page label':'Pagina {current} van 2','Key not used yet':'Wordt pas gebruikt wanneer deze rasterprovider is aangesloten.','Met no contact help':'MET.no heeft geen API-sleutel nodig, maar vereist contactinformatie in de User-Agent.','Raster data title':'Opgeslagen rasterbestanden','Delete raster files':'Rasterbestanden verwijderen','Raster storage explanation':'Na aansluiting kunnen passende voorspellingen lokaal worden bewaard voor offline gebruik.','note-smhi':'Signal K levert de verwachting; deze app heeft geen eigen sleutel nodig.','note-open-meteo':'Geen sleutel nodig voor gratis niet-commercieel gebruik.','note-met-no':'Geen API-sleutel. MET.no vereist contactinformatie in de User-Agent.','note-dwd':'Openbare DWD Open Data bestanden; geen sleutel nodig.','note-knmi':'Gratis API-sleutel vereist voor de KNMI Open Data API.','note-kmi':'Openbare ALARO-GRIB-bestanden van het KMI.','note-dmi':'DMI vereist geen registratie of API-sleutel voor Open Data APIs.','note-fmi':'FMI Open Data; openbare modelbestanden vermelden geen API-sleutel.','note-meteo-france':'Openbare AROME-oppervlakteverwachtingen van Météo-France.','note-ecmwf':'Publieke Open Data selectie; geen sleutel voor publieke downloads.' },
  fr: { 'Provider page title':'Fournisseurs météo et accès','Provider page intro':'Pages officielles, conditions d’accès et clés enregistrées.','Open provider access page':'Ouvrir la page du fournisseur','API key required':'Clé API requise','No API key required':'Aucune clé API requise','Key present':'Clé enregistrée','Key missing':'Aucune clé enregistrée','Save key':'Enregistrer la clé','Delete key':'Supprimer la clé','MET Norway contact':'Contact pour le User-Agent MET Norway','Save contact':'Enregistrer le contact','Raster cache empty':'Aucun fichier raster enregistré. Le téléchargement raster n’est pas encore connecté.','Raster cache count':'{count} fichier(s) raster, {size} enregistrés.','Delete raster cache confirmation':'Supprimer tous les fichiers raster de ce Signal K Pi ?','Raster cache deleted':'Fichiers raster locaux supprimés.','Credentials saved':'Accès enregistré sur le Signal K Pi.','Credentials failed':'Échec de l’enregistrement : {error}','Credentials deleted':'Clé enregistrée supprimée.','Credential delete failed':'Échec de suppression de la clé : {error}','Cache load failed':'Impossible de lire les fichiers raster : {error}','Cache delete failed':'Impossible de supprimer les fichiers raster : {error}','Page previous':'← Retour','Page next':'Suivant →','Page label':'Page {current} sur 2','Key not used yet':'Sera utilisée lorsque ce fournisseur raster sera connecté.','Met no contact help':'MET.no ne nécessite pas de clé, mais demande un contact dans le User-Agent.','Raster data title':'Fichiers raster enregistrés','Delete raster files':'Supprimer les fichiers raster','Raster storage explanation':'Après connexion, les prévisions adaptées seront conservées localement pour une utilisation hors ligne.','note-smhi':'Signal K fournit la prévision ; cette application n’a pas besoin de sa propre clé.','note-open-meteo':'Aucune clé pour l’API gratuite non commerciale.','note-met-no':'Pas de clé API. MET.no exige un contact dans le User-Agent.','note-dwd':'Fichiers DWD Open Data publics ; aucune clé.','note-knmi':'Clé API gratuite requise pour l’API KNMI Open Data.','note-kmi':'Fichiers GRIB ALARO publics de l’IRM.','note-dmi':'DMI ne demande ni inscription ni clé API pour ses APIs Open Data.','note-fmi':'FMI Open Data ; aucune clé indiquée pour les fichiers publics.','note-meteo-france':'Prévisions de surface AROME publiques de Météo-France.','note-ecmwf':'Extrait Open Data public ; aucune clé pour les téléchargements publics.' },
  gb: { 'Provider page title':'Weather providers and access','Provider page intro':'Official provider pages, access requirements and stored keys.','Open provider access page':'Open provider and API page','API key required':'API key required','No API key required':'No API key required','Key present':'Key stored','Key missing':'No key stored','Save key':'Save key','Delete key':'Delete key','MET Norway contact':'Contact for MET Norway User-Agent','Save contact':'Save contact','Raster cache empty':'No raster files stored yet. Raster downloads are not connected yet.','Raster cache count':'{count} raster file(s), {size} stored.','Delete raster cache confirmation':'Delete all raster data stored locally on this Signal K Pi?','Raster cache deleted':'Local raster data deleted.','Credentials saved':'Credentials saved on the Signal K Pi.','Credentials failed':'Could not save credentials: {error}','Credentials deleted':'Stored key deleted.','Credential delete failed':'Could not delete key: {error}','Cache load failed':'Could not read raster files: {error}','Cache delete failed':'Could not delete raster data: {error}','Page previous':'← Back','Page next':'Next →','Page label':'Page {current} of 2','Key not used yet':'Used only after this raster provider is connected.','Met no contact help':'MET.no needs no API key but requires contact information in the User-Agent.','Raster data title':'Stored raster data','Delete raster files':'Delete raster data','Raster storage explanation':'Once connected, suitable forecast data can be stored locally and reused offline.','note-smhi':'Signal K provides the forecast; this app needs no separate key.','note-open-meteo':'No key required for the free non-commercial API.','note-met-no':'No API key. MET.no requires contact information in the User-Agent.','note-dwd':'Public DWD Open Data files; no key for downloads.','note-knmi':'Free API key required for the KNMI Open Data API.','note-kmi':'Public KMI ALARO GRIB files.','note-dmi':'DMI requires neither registration nor an API key for its Open Data APIs.','note-fmi':'FMI Open Data; no key listed for public model files.','note-meteo-france':'Public Météo-France AROME surface forecasts.','note-ecmwf':'Public Open Data subset; no key for public downloads.' }
})) Object.assign(translations[locale], values)
Object.assign(translations.de, { 'Status help':'GPS/SOG/COG liefern Position und Fahrt. Wegpunkte gelten nur dann als passiert, wenn genau diese Route in Signal K aktiv ist.' })
Object.assign(translations.nl, { 'Status help':'GPS/SOG/COG leveren positie en snelheid. Waypoints gelden alleen als gepasseerd wanneer deze route actief is in Signal K.' })
Object.assign(translations.fr, { 'Status help':'Le GPS/SOG/COG fournissent position et vitesse. Un point est marqué passé uniquement si cette route est active dans Signal K.' })
Object.assign(translations.gb, { 'Status help':'GPS/SOG/COG provide position and speed. Waypoints are marked passed only when this route is active in Signal K.' })
Object.assign(translations.de, { 'Use true heading':'Heading True verwenden','Heading description':'Wenn aktiviert, richtet die App AWS/AWA mit navigation.headingTrue aus. Sonst nutzt sie COG als Näherung. Vorhandene STW wird für die Windberechnung aus AWS/AWA genutzt, sofern verfügbar. Das STW-Kästchen steuert nur, ob STW zusätzlich als ETA-Geschwindigkeitsbasis dient.','Signal K true wind':'Signal-K-TWS/TWD','AWS/AWA with STW and heading':'AWS/AWA + STW · Heading True','AWS/AWA with STW and COG':'AWS/AWA + STW · COG-Näherung','AWS/AWA with SOG and COG':'AWS/AWA + SOG/COG','No onboard true wind':'Kein vollständiger Bordwind: TWS+Richtung oder AWS/AWA+STW/SOG+Kurs erforderlich.' })
Object.assign(translations.nl, { 'Use true heading':'Heading True gebruiken','Heading description':'Bij ingeschakelde optie gebruikt de app navigation.headingTrue om AWS/AWA te oriënteren. Anders dient COG als benadering. Beschikbare STW wordt ook gebruikt als STW niet is ingeschakeld voor de ETA.','Signal K true wind':'Signal K TWS/TWD','AWS/AWA with STW and heading':'AWS/AWA + STW · Heading True','AWS/AWA with STW and COG':'AWS/AWA + STW · COG-benadering','AWS/AWA with SOG and COG':'AWS/AWA + SOG/COG','No onboard true wind':'Geen volledige wind aan boord: TWS+richting of AWS/AWA+STW/SOG+koers is nodig.' })
Object.assign(translations.fr, { 'Use true heading':'Utiliser le cap vrai','Heading description':'Activé, navigation.headingTrue oriente AWS/AWA. Sinon, le COG sert d’approximation. La STW disponible est utilisée même si elle est désactivée comme source ETA.','Signal K true wind':'TWS/TWD Signal K','AWS/AWA with STW and heading':'AWS/AWA + STW · cap vrai','AWS/AWA with STW and COG':'AWS/AWA + STW · COG approximatif','AWS/AWA with SOG and COG':'AWS/AWA + SOG/COG','No onboard true wind':'Vent embarqué incomplet : TWS+direction ou AWS/AWA+STW/SOG+route est nécessaire.' })
Object.assign(translations.gb, { 'Use true heading':'Use Heading True','Heading description':'When enabled, the app orients AWS/AWA with navigation.headingTrue. Otherwise it uses COG as an approximation. Available STW is used even if STW is unchecked as an ETA source.','Signal K true wind':'Signal K TWS/TWD','AWS/AWA with STW and heading':'AWS/AWA + STW · Heading True','AWS/AWA with STW and COG':'AWS/AWA + STW · approximate COG','AWS/AWA with SOG and COG':'AWS/AWA + SOG/COG','No onboard true wind':'Onboard wind is incomplete: TWS+direction or AWS/AWA+STW/SOG+course is required.' })
Object.assign(translations.de, { 'Checking heading …':'Prüfe Heading-Pfad …','Heading available':'Kompasswert vorhanden; Heading True kann verwendet werden.','Heading missing COG fallback':'Kein Heading-Wert in Signal K; COG wird als Näherung genutzt.' })
Object.assign(translations.nl, { 'Checking heading …':'Heading-pad controleren …','Heading available':'Kompaswaarde beschikbaar; Heading True kan worden gebruikt.','Heading missing COG fallback':'Geen headingwaarde in Signal K; COG wordt als benadering gebruikt.' })
Object.assign(translations.fr, { 'Checking heading …':'Vérification du cap …','Heading available':'Valeur de cap disponible ; le cap vrai peut être utilisé.','Heading missing COG fallback':'Aucune valeur de cap dans Signal K ; le COG sert d’approximation.' })
Object.assign(translations.gb, { 'Checking heading …':'Checking heading path …','Heading available':'Heading value available; Heading True can be used.','Heading missing COG fallback':'No heading value in Signal K; COG is used as an approximation.' })
Object.assign(translations.de, { 'No SMHI provider':'SMHI ist nicht als Signal-K-Wetteranbieter registriert. Verfügbar: {providers}','Routes updated':'Routenliste aus Signal K aktualisiert; die aktuelle Auswahl bleibt erhalten.','New routes found':'{count} neue Route(n) erkannt. Jetzt im Routenauswahlfeld verfügbar.','Signal K unreachable':'Signal K nicht erreichbar','Connected to Signal K':'Mit Signal K verbunden','GPS missing':'GPS-Position fehlt; ETA beginnt am ersten nicht passierten Wegpunkt.','No ETA source':'Keine ETA-Quelle gewählt; bitte GPS, Motor, STW oder Polare aktivieren.','Current available':'Strömung verfügbar: {source}.','No current API':'Keine passende Strömung verfügbar ({error}).' })
Object.assign(translations.nl, { 'No SMHI provider':'SMHI is niet geregistreerd als Signal K-weerprovider. Beschikbaar: {providers}','Routes updated':'Routelijst van Signal K bijgewerkt; de huidige selectie blijft behouden.','New routes found':'{count} nieuwe route(s) gevonden. Nu beschikbaar in de routelijst.','Signal K unreachable':'Signal K niet bereikbaar','Connected to Signal K':'Verbonden met Signal K','GPS missing':'GPS-positie ontbreekt; ETA begint bij het eerste niet gepasseerde waypoint.','No ETA source':'Geen ETA-bron gekozen; schakel GPS, motor, STW of polar in.','Current available':'Stroming beschikbaar: {source}.','No current API':'Geen passende Stroming beschikbaar ({error}).' })
Object.assign(translations.fr, { 'No SMHI provider':'SMHI n’est pas enregistré comme fournisseur météo Signal K. Disponibles : {providers}','Routes updated':'Liste des routes Signal K actualisée ; la sélection actuelle est conservée.','New routes found':'{count} nouvelle(s) route(s) détectée(s), disponible(s) dans la liste.','Signal K unreachable':'Signal K inaccessible','Connected to Signal K':'Connecté à Signal K','GPS missing':'Position GPS absente ; l’ETA commence au premier point non atteint.','No ETA source':'Aucune source ETA sélectionnée ; activez GPS, moteur, STW ou polaire.','Current available':'Courant disponible : {source}.','No current API':'Aucun courant LTC adapté : {error}.' })
Object.assign(translations.gb, { 'No SMHI provider':'SMHI is not registered as a Signal K weather provider. Available: {providers}','Routes updated':'Signal K route list updated; the current selection is retained.','New routes found':'{count} new route(s) found. Available in the route selector.','Signal K unreachable':'Signal K unreachable','Connected to Signal K':'Connected to Signal K','GPS missing':'GPS position unavailable; ETA starts at the first unpassed waypoint.','No ETA source':'No ETA source selected; enable GPS, motor, STW or polar.','Current available':'Current available: {source}.','No current API':'No suitable Current available ({error}).' })
Object.assign(translations.de, { 'Weather refreshed':'Wetterdaten abgerufen und gespeichert.','Forecast unavailable':'Vorhersage fehlt für {count} Wegpunkt(e).','Fetch weather manually':'Provider gewählt. Wetter erst nach Klick auf „Wetter abrufen“ laden.' })
Object.assign(translations.nl, { 'Weather refreshed':'Weergegevens opgehaald en opgeslagen.','Forecast unavailable':'Verwachting ontbreekt voor {count} waypoint(s).','Fetch weather manually':'Provider gekozen. Haal het weer pas op na klikken op „Nu verversen“.' })
Object.assign(translations.fr, { 'Weather refreshed':'Données météo récupérées et enregistrées.','Forecast unavailable':'Prévision absente pour {count} point(s).','Fetch weather manually':'Fournisseur choisi. Récupérez la météo en cliquant sur « Actualiser ».' })
Object.assign(translations.gb, { 'Weather refreshed':'Weather data fetched and saved.','Forecast unavailable':'Forecast missing for {count} waypoint(s).','Fetch weather manually':'Provider selected. Fetch weather by clicking “Fetch weather”.' })
for (const [locale, text] of Object.entries({
  de: { 'SAVED WEATHER RUN':'GESPEICHERTER WETTERLAUF','No saved weather runs':'Noch kein gespeicherter Lauf','Hide raster providers':'Rasteranbieter ausblenden','Weather online':'Wetterdienst online','Weather offline':'Wetterdienst offline','Snapshot deleted':'Gespeicherter Wetterlauf gelöscht.','Snapshot delete failed':'Wetterlauf konnte nicht gelöscht werden: {error}','Snapshot save failed':'Wetterdaten konnten nicht dauerhaft gespeichert werden: {error}','Raster provider inactive':'Raster · Download und Auswertung noch nicht aktiv','CURRENT DATA DIRECTORY':'LTC-STRÖMUNGSDATEN AUF DEM SIGNAL-K-PI','Current directory placeholder':'Absoluter Pfad zum Stammordner mit Gebietsordnern','Current directory help':'Stammordner mit regionalen HARMONIC/IDX-Paaren, z. B. /home/pi/LTC/Copernicus_Harmonics/TideConverter/ergebnisse. Vorlagenordner sind nicht die Ergebnisdaten.','Check current data':'Ordner prüfen','No current pairs':'Keine passenden HARMONIC/IDX-Paare im Ordner gefunden.','Current coverage':'{datasets} Gebietspaare gefunden. Beste Gesamtabdeckung: {best}; {covered}/{total} Wegpunkte höchstens 15 km von einer Station entfernt. Je Wegpunkt ermittelte Gebiete: {areas}. Für die ETA-Vektoren muss die Strömungs-API denselben Datenstamm verwenden.','Current folder check failed':'Gebietsordner konnten nicht geprüft werden: {error}','Current folder checked':'Strömungsdatenpfad geprüft und gespeichert.','Current path rejected':'Strömungsdatenpfad nicht übernommen: {error}','Current path invalid':'Pfad konnte nicht geprüft werden: {error}' },
  nl: { 'SAVED WEATHER RUN':'OPGESLAGEN WEERBERICHT','No saved weather runs':'Nog geen opgeslagen run','Hide raster providers':'Rasteraanbieders verbergen','Weather online':'Weerdienst online','Weather offline':'Weerdienst offline','Snapshot deleted':'Opgeslagen weerrun verwijderd.','Snapshot delete failed':'Weerrun kon niet worden verwijderd: {error}','Snapshot save failed':'Weergegevens konden niet blijvend worden opgeslagen: {error}','Raster provider inactive':'Raster · downloaden en verwerken nog niet actief','CURRENT DATA DIRECTORY':'LTC-STROOMGEGEVENS OP DE SIGNAL-K-PI','Current directory placeholder':'Absoluut pad naar de hoofdmap met regiomappen','Current directory help':'Hoofdmap met regionale HARMONIC/IDX-paren. Voorbeeld: /home/pi/LTC/Copernicus_Harmonics/TideConverter/ergebnisse.','Check current data':'Map controleren','No current pairs':'Geen passende HARMONIC/IDX-paren gevonden.','Current coverage':'{datasets} gebiedsparen gevonden. Beste dekking: {best}; {covered}/{total} waypoints binnen 15 km van een station. Gebieden per waypoint: {areas}.','Current folder check failed':'Regiomappen konden niet worden gecontroleerd: {error}','Current folder checked':'Stroomgegevenspad gecontroleerd en opgeslagen.','Current path rejected':'Stroomgegevenspad niet opgeslagen: {error}','Current path invalid':'Pad kon niet worden gecontroleerd: {error}' },
  fr: { 'SAVED WEATHER RUN':'PRÉVISION ENREGISTRÉE','No saved weather runs':'Aucune prévision enregistrée','Hide raster providers':'Masquer les fournisseurs raster','Weather online':'Service météo en ligne','Weather offline':'Service météo hors ligne','Snapshot deleted':'Prévision enregistrée supprimée.','Snapshot delete failed':'Impossible de supprimer la prévision : {error}','Snapshot save failed':'Impossible d’enregistrer durablement les données météo : {error}','Raster provider inactive':'Raster · téléchargement et traitement non activés','CURRENT DATA DIRECTORY':'DONNÉES DE COURANT LTC SUR LE PI SIGNAL K','Current directory placeholder':'Chemin absolu vers le dossier contenant les régions','Current directory help':'Dossier racine des paires HARMONIC/IDX régionales. Exemple : /home/pi/LTC/Copernicus_Harmonics/TideConverter/ergebnisse.','Check current data':'Vérifier le dossier','No current pairs':'Aucune paire HARMONIC/IDX trouvée.','Current coverage':'{datasets} paires régionales trouvées. Meilleure couverture : {best} ; {covered}/{total} points à moins de 15 km d’une station. Régions par point : {areas}.','Current folder check failed':'Impossible de vérifier les dossiers régionaux : {error}','Current folder checked':'Chemin des courants vérifié et enregistré.','Current path rejected':'Chemin des courants non enregistré : {error}','Current path invalid':'Impossible de vérifier le chemin : {error}' },
  gb: { 'SAVED WEATHER RUN':'SAVED WEATHER RUN','No saved weather runs':'No saved run yet','Hide raster providers':'Hide raster providers','Weather online':'Weather service online','Weather offline':'Weather service offline','Snapshot deleted':'Saved weather run deleted.','Snapshot delete failed':'Could not delete saved weather run: {error}','Snapshot save failed':'Could not permanently save weather data: {error}','Raster provider inactive':'Raster · download and decoding not available yet','CURRENT DATA DIRECTORY':'LTC CURRENT DATA ON SIGNAL K PI','Current directory placeholder':'Absolute path to parent folder containing regional folders','Current directory help':'Root folder containing regional HARMONIC/IDX pairs. Example: /home/pi/LTC/Copernicus_Harmonics/TideConverter/ergebnisse.','Check current data':'Check folder','No current pairs':'No matching HARMONIC/IDX pairs found.','Current coverage':'{datasets} regional pairs found. Best overall coverage: {best}; {covered}/{total} waypoints within 15 km of a station. Areas per waypoint: {areas}.','Current folder check failed':'Could not scan regional folders: {error}','Current folder checked':'Current data path checked and saved.','Current path rejected':'Current data path was not saved: {error}','Current path invalid':'Could not check path: {error}' }
})) Object.assign(translations[locale], text)
Object.assign(translations.de, { 'SMHI forecast wind':'Anbieter-Windvorhersage','Forecast wind description':'Wind des ausgewählten Anbieters für die LTC-Polare und ETA entlang der Route verwenden.','No provider selected':'Kein Wetteranbieter ausgewählt. SMHI, Open-Meteo oder MET Norway wählen.','Forecast source':'Vorhersage: ausgewählter Wetteranbieter · Alle Zeiten Ortszeit des PCs' })
Object.assign(translations.nl, { 'SMHI forecast wind':'Windverwachting van aanbieder','Forecast wind description':'Gebruik de wind van de geselecteerde aanbieder voor de LTC-polar en ETA.','No provider selected':'Geen weerprovider geselecteerd. Kies SMHI, Open-Meteo of MET Norway.','Forecast source':'Verwachting: geselecteerde weeraanbieder · Alle tijden lokale tijd van de pc' })
Object.assign(translations.fr, { 'SMHI forecast wind':'Vent prévu par le fournisseur','Forecast wind description':'Utiliser le vent du fournisseur sélectionné pour la polaire LTC et l’ETA.','No provider selected':'Aucun fournisseur météo sélectionné. Choisissez SMHI, Open-Meteo ou MET Norway.','Forecast source':'Prévisions : fournisseur météo sélectionné · Heures locales du PC' })
Object.assign(translations.gb, { 'SMHI forecast wind':'Provider forecast wind','Forecast wind description':'Use the selected provider’s wind with the LTC polar and route ETA.','No provider selected':'No weather provider selected. Choose SMHI, Open-Meteo or MET Norway.','Forecast source':'Forecast: selected weather provider · All times are local to the PC' })
Object.assign(translations.de, { 'Checking weather service':'Prüfe Wetterdienst …' })
Object.assign(translations.nl, { 'Checking weather service':'Weerdienst controleren …' })
Object.assign(translations.fr, { 'Checking weather service':'Vérification du service météo …' })
Object.assign(translations.gb, { 'Checking weather service':'Checking weather service …' })
Object.assign(translations.de, { 'Onboard wind missing inputs':'Bordwind nicht berechenbar; fehlende Signal-K-Werte: {inputs}' })
Object.assign(translations.nl, { 'Onboard wind missing inputs':'Wind aan boord kan niet worden berekend; ontbrekende Signal K-waarden: {inputs}' })
Object.assign(translations.fr, { 'Onboard wind missing inputs':'Vent à bord non calculable ; valeurs Signal K manquantes : {inputs}' })
Object.assign(translations.gb, { 'Onboard wind missing inputs':'Onboard wind cannot be calculated; missing Signal K values: {inputs}' })
Object.assign(translations.de, {
  'Checking current source …':'Prüfe eure LTC-Strömungsdaten …',
  'Current source unavailable':'Keine passende LTC-Strömung: {error}',
  'Current available':'Strömung verfügbar · {source}',
  'Current station':'Station',
  'Current directory help':'Stammordner mit euren regionalen HARMONIC/IDX-Paaren. Die App berechnet den Strömungsvektor direkt aus diesen Dateien; deutsche BSH-Detailgebiete haben Vorrang.',
  'Current pair format':'LTC HARMONIC/IDX',
  'Previous weather run':'Älterer Wetterlauf',
  'Next weather run':'Neuerer Wetterlauf',
  'Saved run details':'WETTERLAUF UND SPEICHERUNG',
  'No saved run details':'Noch kein gespeicherter Wetterlauf. Nach dem Abruf wird die Tabelle lokal auf diesem Signal-K-Pi abgelegt.',
  'Snapshot meta':'{provider} · abgerufen {date} · Route: {route} · Datei: {file} · löschen: oben beim gespeicherten Wetterlauf.',
  'Snapshot page':'Wetterlauf {current} von {total}',
  'Snapshot storage path':'Speicherort auf diesem Signal-K-Pi: {path}'
})
Object.assign(translations.nl, {
  'Checking current source …':'LTC-stroomgegevens controleren …',
  'Current source unavailable':'Geen passende LTC-stroom: {error}',
  'Current available':'Stroming beschikbaar · {source}',
  'Current station':'Station',
  'Current directory help':'Basismap met uw regionale HARMONIC/IDX-paren. De app voorspelt de stroomvector rechtstreeks uit deze bestanden; Duitse BSH-detailgebieden krijgen voorrang.',
  'Current pair format':'LTC HARMONIC/IDX',
  'Previous weather run':'Oudere weerrun',
  'Next weather run':'Nieuwere weerrun',
  'Saved run details':'WEERRUN EN OPSLAG',
  'No saved run details':'Er is nog geen weerrun opgeslagen. Na ophalen wordt de tabel lokaal op deze Signal K-Pi bewaard.',
  'Snapshot meta':'{provider} · opgehaald {date} · Route: {route} · Bestand: {file} · verwijderen: boven bij opgeslagen weerrun.',
  'Snapshot page':'Weerrun {current} van {total}',
  'Snapshot storage path':'Opslaglocatie op deze Signal K-Pi: {path}'
})
Object.assign(translations.fr, {
  'Checking current source …':'Vérification des courants LTC …',
  'Current source unavailable':'Aucun courant LTC adapté : {error}',
  'Current available':'Courant disponible · {source}',
  'Current station':'Station',
  'Current directory help':'Dossier racine contenant vos paires HARMONIC/IDX régionales. L’application calcule le vecteur directement à partir de ces fichiers ; les zones détaillées BSH allemandes sont prioritaires.',
  'Current pair format':'LTC HARMONIC/IDX',
  'Previous weather run':'Prévision météo plus ancienne',
  'Next weather run':'Prévision météo plus récente',
  'Saved run details':'PRÉVISION ET STOCKAGE',
  'No saved run details':'Aucune prévision enregistrée. Après récupération, le tableau sera enregistré localement sur ce Pi Signal K.',
  'Snapshot meta':'{provider} · récupéré le {date} · Route : {route} · Fichier : {file} · suppression : en haut, dans les prévisions enregistrées.',
  'Snapshot page':'Prévision {current} sur {total}',
  'Snapshot storage path':'Emplacement sur ce Pi Signal K : {path}'
})
Object.assign(translations.gb, {
  'Checking current source …':'Checking your LTC current files …',
  'Current source unavailable':'No suitable LTC current: {error}',
  'Current available':'Current available · {source}',
  'Current station':'Station',
  'Current directory help':'Root folder containing your regional HARMONIC/IDX pairs. The app predicts current vectors directly from these files; detailed German BSH areas take priority.',
  'Current pair format':'LTC HARMONIC/IDX',
  'Previous weather run':'Older weather run',
  'Next weather run':'Newer weather run',
  'Saved run details':'WEATHER RUN AND STORAGE',
  'No saved run details':'No weather run has been saved yet. After fetching, the table is stored locally on this Signal K Pi.',
  'Snapshot meta':'{provider} · fetched {date} · Route: {route} · File: {file} · delete: use the saved weather run controls above.',
  'Snapshot page':'Weather run {current} of {total}',
  'Snapshot storage path':'Storage location on this Signal K Pi: {path}'
})

Object.assign(translations.de, {
  'Raster point extraction':'Rastermodell · Routendaten abrufen',
  'Raster cache empty':'Keine Rasterdateien gespeichert. DMI HARMONIE liest die Wegpunktwerte direkt aus dem Modell; die Wetterläufe werden separat offline gespeichert.',
  'Raster storage explanation':'DMI HARMONIE fragt gezielt die Route aus dem Rastermodell ab und speichert das Ergebnis als Wetterlauf. Andere Rasteranbieter benötigen noch ihren eigenen Dateiabruf und GRIB-Auswertung.'
})
Object.assign(translations.nl, {
  'Raster point extraction':'Rastermodel · routepunten ophalen',
  'Raster cache empty':'Geen rasterbestanden opgeslagen. DMI HARMONIE leest waypointwaarden rechtstreeks uit het model; weerruns worden apart offline bewaard.',
  'Raster storage explanation':'DMI HARMONIE vraagt gericht routepunten op uit het rastermodel en slaat het resultaat op als weerrun. Andere rasteraanbieders moeten nog hun eigen bestandsdownload en GRIB-verwerking krijgen.'
})
Object.assign(translations.fr, {
  'Raster point extraction':'Modèle raster · extraction sur la route',
  'Raster cache empty':'Aucun fichier raster enregistré. DMI HARMONIE extrait les valeurs des points depuis le modèle ; les prévisions sont enregistrées séparément pour une utilisation hors ligne.',
  'Raster storage explanation':'DMI HARMONIE extrait les points de la route du modèle raster et enregistre le résultat comme prévision. Les autres fournisseurs raster nécessitent encore leur propre téléchargement et décodage GRIB.'
})
Object.assign(translations.gb, {
  'Raster point extraction':'Raster model · route point extraction',
  'Raster cache empty':'No raster files stored. DMI HARMONIE reads waypoint values from the model; forecast runs are stored separately for offline use.',
  'Raster storage explanation':'DMI HARMONIE extracts route points from its raster model and stores the result as a forecast run. Other raster providers still need their own file download and GRIB decoding.'
})

Object.assign(translations.de, { 'Fetch weather': 'Wetter downloaden', 'Internet check': 'Prüfe Internetverbindung …', 'Local weather': 'Lokale Wetterdaten werden geladen …', 'Weather download progress': 'Wetterdaten werden heruntergeladen · {done}/{total} Wegpunkte', 'Processing weather': 'Wetterdaten werden verarbeitet …', 'Weather rate limit': 'API-Limit (429). Warte {seconds} s …', 'Weather rate limit stopped': 'Abruf wegen API-Limit (429) unterbrochen.', 'Missing waypoint weather': 'Wetterdaten fehlen für {points}', 'Weather complete': 'Wetterdownload abgeschlossen.', 'Local weather error': 'Lokale Wetterdaten konnten nicht geladen werden.' })
Object.assign(translations.gb, { 'Fetch weather': 'Download weather', 'Internet check': 'Checking internet access …', 'Local weather': 'Loading local weather data …', 'Weather download progress': 'Downloading weather · {done}/{total} waypoints', 'Processing weather': 'Processing weather data …', 'Weather rate limit': 'API rate limit (429). Waiting {seconds} s …', 'Weather rate limit stopped': 'Download stopped by API rate limit (429).', 'Missing waypoint weather': 'Weather unavailable for {points}', 'Weather complete': 'Weather download complete.', 'Local weather error': 'Could not load local weather data.' })
Object.assign(translations.nl, { 'Fetch weather': 'Weer downloaden', 'Internet check': 'Internetverbinding controleren …', 'Local weather': 'Lokale weergegevens laden …', 'Weather download progress': 'Weergegevens downloaden · {done}/{total} waypoints', 'Processing weather': 'Weergegevens verwerken …', 'Weather rate limit': 'API-limiet (429). Wacht {seconds} s …', 'Weather rate limit stopped': 'Download onderbroken door API-limiet (429).', 'Missing waypoint weather': 'Geen weergegevens voor {points}', 'Weather complete': 'Weerdownload voltooid.', 'Local weather error': 'Lokale weergegevens konden niet worden geladen.' })
Object.assign(translations.fr, { 'Fetch weather': 'Télécharger la météo', 'Internet check': 'Vérification de la connexion Internet …', 'Local weather': 'Chargement des données météo locales …', 'Weather download progress': 'Téléchargement météo · {done}/{total} points', 'Processing weather': 'Traitement des données météo …', 'Weather rate limit': 'Limite API (429). Attente de {seconds} s …', 'Weather rate limit stopped': 'Téléchargement interrompu par la limite API (429).', 'Missing waypoint weather': 'Données météo indisponibles pour {points}', 'Weather complete': 'Téléchargement terminé.', 'Local weather error': 'Impossible de charger les données météo locales.' })

Object.assign(translations.de, { 'Raster storage explanation': 'GRIB-Anbieter speichern heruntergeladene Raster in diesem Ordner. DMI fragt Rasterwerte direkt über seine API ab. Wetterläufe werden separat gespeichert. Für die GRIB-Auswertung benötigt der Pi grib_get (libeccodes-tools).', 'Raster cache empty': 'Keine Rasterdateien gespeichert.' })
Object.assign(translations.nl, { 'Raster storage explanation': 'GRIB-providers bewaren gedownloade rasters in deze map. DMI vraagt rasterwaarden rechtstreeks via zijn API op. Weerruns worden apart opgeslagen. De Pi heeft grib_get (libeccodes-tools) nodig.', 'Raster cache empty': 'Geen rasterbestanden opgeslagen.' })
Object.assign(translations.fr, { 'Raster storage explanation': 'Les fournisseurs GRIB stockent les grilles téléchargées dans ce dossier. DMI interroge les valeurs de grille via son API. Les prévisions sont enregistrées séparément. Le Pi nécessite grib_get (libeccodes-tools).', 'Raster cache empty': 'Aucun fichier raster enregistré.' })
Object.assign(translations.gb, { 'Raster storage explanation': 'GRIB providers keep downloaded grids in this folder. DMI queries grid values through its API. Forecast runs are saved separately. The Pi needs grib_get (libeccodes-tools).', 'Raster cache empty': 'No raster files stored.' })

Object.assign(translations.de, { 'Delete all raster files': 'Alle Rasterdateien löschen', 'Delete raster file?': 'Rasterdatei „{file}“ löschen?', 'Raster file deleted': 'Rasterdatei „{file}“ gelöscht.' })
Object.assign(translations.nl, { 'Delete all raster files': 'Alle rasterbestanden verwijderen', 'Delete raster file?': 'Rasterbestand „{file}“ verwijderen?', 'Raster file deleted': 'Rasterbestand „{file}“ verwijderd.' })
Object.assign(translations.fr, { 'Delete all raster files': 'Supprimer tous les fichiers raster', 'Delete raster file?': 'Supprimer le fichier raster « {file} » ?', 'Raster file deleted': 'Fichier raster « {file} » supprimé.' })
Object.assign(translations.gb, { 'Delete all raster files': 'Delete all raster files', 'Delete raster file?': 'Delete raster file “{file}”?', 'Raster file deleted': 'Raster file “{file}” deleted.' })

Object.assign(translations.de, { 'No new weather download': 'Kein neuer Download' })
Object.assign(translations.nl, { 'No new weather download': 'Geen nieuwe download' })
Object.assign(translations.fr, { 'No new weather download': 'Aucun nouveau téléchargement' })
Object.assign(translations.gb, { 'No new weather download': 'No new download' })

Object.assign(translations.de, {
  COURSE: 'KURS',
  'Course to next waypoint': 'Kurs bis zum nächsten Wegpunkt',
  'Calculated SOG to next waypoint': 'Berechneter SOG bis zum nächsten Wegpunkt',
  'Calculated wind speed and angle': 'Berechnete wahre Windstärke und Windwinkel zum Kurs bis zu diesem Wegpunkt',
  'Wind weighting tooltip': 'Gewichtung von Bootswind zu Providerwind für berechneten Wind',
  'Provider wind tooltip': 'Providerwind',
  'Temperature tooltip': 'Temperatur',
  'Air pressure tooltip': 'Luftdruck'
})
Object.assign(translations.nl, {
  COURSE: 'KOERS',
  'Course to next waypoint': 'Koers naar het volgende waypoint',
  'Calculated SOG to next waypoint': 'Berekende SOG naar het volgende waypoint',
  'Calculated wind speed and angle': 'Berekende ware windsnelheid en windhoek ten opzichte van de koers naar dit waypoint',
  'Wind weighting tooltip': 'Weging van boordwind en voorspelde wind voor de berekende wind',
  'Provider wind tooltip': 'Voorspelde wind',
  'Temperature tooltip': 'Temperatuur',
  'Air pressure tooltip': 'Luchtdruk'
})
Object.assign(translations.fr, {
  COURSE: 'CAP',
  'Course to next waypoint': 'Cap vers le prochain point de route',
  'Calculated SOG to next waypoint': 'SOG calculée jusqu’au prochain point de route',
  'Calculated wind speed and angle': 'Vitesse et angle calculés du vent vrai par rapport au cap vers ce point de route',
  'Wind weighting tooltip': 'Pondération du vent mesuré à bord et du vent prévu pour calculer le vent',
  'Provider wind tooltip': 'Vent prévu',
  'Temperature tooltip': 'Température',
  'Air pressure tooltip': 'Pression atmosphérique'
})
Object.assign(translations.gb, {
  COURSE: 'COURSE',
  'Course to next waypoint': 'Course to the next waypoint',
  'Calculated SOG to next waypoint': 'Calculated SOG to the next waypoint',
  'Calculated wind speed and angle': 'Calculated true wind speed and angle relative to the course to this waypoint',
  'Wind weighting tooltip': 'Weight of onboard and provider wind in the calculated wind',
  'Provider wind tooltip': 'Provider wind',
  'Temperature tooltip': 'Temperature',
  'Air pressure tooltip': 'Air pressure'
})

Object.assign(translations.de, { DISTANCE: 'ENTFERNUNG', 'Distance to next waypoint': 'Entfernung bis zum nächsten Wegpunkt', 'GPS position unavailable': 'Keine GPS-Position' })
Object.assign(translations.nl, { DISTANCE: 'AFSTAND', 'Distance to next waypoint': 'Afstand tot het volgende waypoint', 'GPS position unavailable': 'Geen GPS-positie' })
Object.assign(translations.fr, { DISTANCE: 'DISTANCE', 'Distance to next waypoint': 'Distance jusqu’au prochain point de route', 'GPS position unavailable': 'Position GPS indisponible' })
Object.assign(translations.gb, { DISTANCE: 'DISTANCE', 'Distance to next waypoint': 'Distance to the next waypoint', 'GPS position unavailable': 'No GPS position' })

Object.assign(translations.de, { 'Waypoint radius': 'Wegpunktradius', 'Reset route progress': 'Fortschritt zurücksetzen', 'Distance and bearing to next waypoint': 'Entfernung und Kurs zum nächsten Wegpunkt' })
Object.assign(translations.nl, { 'Waypoint radius': 'Aankomstradius', 'Reset route progress': 'Voortgang wissen', 'Distance and bearing to next waypoint': 'Afstand en peiling naar het volgende waypoint' })
Object.assign(translations.fr, { 'Waypoint radius': 'Rayon d’arrivée', 'Reset route progress': 'Réinitialiser la progression', 'Distance and bearing to next waypoint': 'Distance et relèvement vers le prochain point' })
Object.assign(translations.gb, { 'Waypoint radius': 'Arrival radius', 'Reset route progress': 'Reset route progress', 'Distance and bearing to next waypoint': 'Distance and bearing to next waypoint' })

Object.assign(translations.de, {
  Help: 'Hilfe', 'Close help': 'Schließen', 'Route source': 'Routenquelle', 'Choose GPX': 'GPX-Datei wählen', 'GPX route': 'GPX-Route',
  'Choose a GPX file': 'Wähle eine GPX-Datei mit einer Route oder einem Track.',
  'GPX invalid': 'Die GPX-Datei enthält ungültiges XML oder ungültige Koordinaten.',
  'GPX no routes': 'Die Datei enthält keine Route und keinen Trackabschnitt mit mindestens zwei Punkten.',
  'GPX too large': 'Die GPX-Datei darf höchstens 2 MB groß sein.',
  'GPX failed': 'GPX-Datei konnte nicht übernommen werden. {error}',
})
Object.assign(translations.nl, {
  Help: 'Help', 'Close help': 'Sluiten', 'Route source': 'Routebron', 'Choose GPX': 'GPX-bestand kiezen', 'GPX route': 'GPX-route',
  'Choose a GPX file': 'Kies een GPX-bestand met een route of track.', 'GPX invalid': 'Het GPX-bestand bevat ongeldige XML of coördinaten.', 'GPX no routes': 'Het bestand bevat geen route of tracksegment met minstens twee punten.', 'GPX too large': 'Het GPX-bestand mag maximaal 2 MB groot zijn.', 'GPX failed': 'Het GPX-bestand kon niet worden geïmporteerd. {error}',
})
Object.assign(translations.fr, {
  Help: 'Aide', 'Close help': 'Fermer', 'Route source': 'Source de la route', 'Choose GPX': 'Choisir un fichier GPX', 'GPX route': 'Route GPX',
  'Choose a GPX file': 'Choisissez un fichier GPX contenant une route ou une trace.', 'GPX invalid': 'Le fichier GPX contient du XML ou des coordonnées non valides.', 'GPX no routes': 'Le fichier ne contient aucune route ni aucun segment de trace avec au moins deux points.', 'GPX too large': 'Le fichier GPX ne doit pas dépasser 2 Mo.', 'GPX failed': 'Impossible d’importer le fichier GPX. {error}',
})
Object.assign(translations.gb, {
  Help: 'Help', 'Close help': 'Close', 'Route source': 'Route source', 'Choose GPX': 'Choose GPX file', 'GPX route': 'GPX route',
  'Choose a GPX file': 'Choose a GPX file containing a route or track.', 'GPX invalid': 'The GPX file contains invalid XML or coordinates.', 'GPX no routes': 'The file contains no route or track segment with at least two points.', 'GPX too large': 'The GPX file must be 2 MB or smaller.', 'GPX failed': 'The GPX file could not be imported. {error}',
})

Object.assign(translations.de, {
  'Choose GPX': 'GPX-Dateien wählen', 'GPX files': 'GPX-Dateien', 'GPX inactive': 'deaktiviert', 'GPX browser': 'Im Browser', 'GPX Pi': 'Auf dem Pi',
  'GPX Pi directory': 'GPX-Ordner auf dem Signal-K-Pi', 'Save GPX directory': 'Ordner übernehmen', 'Reload GPX files': 'Dateiliste aktualisieren',
  'No GPX files': 'Keine GPX-Dateien verfügbar.', 'Loading GPX file': 'GPX-Datei wird geladen …',
  'Delete Pi GPX?': 'Die Datei „{name}“ dauerhaft vom Pi löschen?', 'Delete browser GPX?': '„{name}“ aus diesem Browser entfernen?',
  'Fetch weather manually': 'Provider gewählt. Klicke auf „Wetter downloaden“.',
})
Object.assign(translations.nl, {
  'Choose GPX': 'GPX-bestanden kiezen', 'GPX files': 'GPX-bestanden', 'GPX inactive': 'uitgeschakeld', 'GPX browser': 'In de browser', 'GPX Pi': 'Op de Pi',
  'GPX Pi directory': 'GPX-map op de Signal K-Pi', 'Save GPX directory': 'Map opslaan', 'Reload GPX files': 'Bestandslijst vernieuwen',
  'No GPX files': 'Geen GPX-bestanden beschikbaar.', 'Loading GPX file': 'GPX-bestand laden …',
  'Delete Pi GPX?': 'Bestand ‘{name}’ definitief van de Pi verwijderen?', 'Delete browser GPX?': '‘{name}’ uit deze browser verwijderen?',
  'Fetch weather manually': 'Provider gekozen. Klik op ‘Weer downloaden’.',
})
Object.assign(translations.fr, {
  'Choose GPX': 'Choisir des fichiers GPX', 'GPX files': 'Fichiers GPX', 'GPX inactive': 'désactivé', 'GPX browser': 'Dans le navigateur', 'GPX Pi': 'Sur le Pi',
  'GPX Pi directory': 'Dossier GPX sur le Pi Signal K', 'Save GPX directory': 'Enregistrer le dossier', 'Reload GPX files': 'Actualiser la liste',
  'No GPX files': 'Aucun fichier GPX disponible.', 'Loading GPX file': 'Chargement du fichier GPX …',
  'Delete Pi GPX?': 'Supprimer définitivement le fichier « {name} » du Pi ?', 'Delete browser GPX?': 'Retirer « {name} » de ce navigateur ?',
  'Fetch weather manually': 'Fournisseur sélectionné. Cliquez sur « Télécharger la météo ».',
})
Object.assign(translations.gb, {
  'Choose GPX': 'Choose GPX files', 'GPX files': 'GPX files', 'GPX inactive': 'disabled', 'GPX browser': 'In browser', 'GPX Pi': 'On the Pi',
  'GPX Pi directory': 'GPX folder on the Signal K Pi', 'Save GPX directory': 'Save folder', 'Reload GPX files': 'Refresh file list',
  'No GPX files': 'No GPX files available.', 'Loading GPX file': 'Loading GPX file …',
  'Delete Pi GPX?': 'Permanently delete “{name}” from the Pi?', 'Delete browser GPX?': 'Remove “{name}” from this browser?',
  'Fetch weather manually': 'Provider selected. Click “Download weather”.',
})
for (const [language, example, available] of [
  ['de', 'Beispielpfad', 'GPX-Dateien verfügbar: {count}'],
  ['nl', 'Voorbeeldpad', 'Beschikbare GPX-bestanden: {count}'],
  ['fr', 'Exemple de chemin', 'Fichiers GPX disponibles : {count}'],
  ['gb', 'Example path', 'GPX files available: {count}']
]) {
  Object.assign(translations[language], { 'Example path': example, 'GPX file count': available })
}

Object.assign(translations.de, {
  'Before route entry': 'Vor dem Einstieg',
  'Help loading': 'Hilfe wird geladen …', 'Help load failed': 'Hilfe konnte nicht geladen werden ({error}).',
})
Object.assign(translations.nl, {
  'Before route entry': 'Vóór het instappunt',
  'Help loading': 'Help wordt geladen …', 'Help load failed': 'Help kon niet worden geladen ({error}).',
})
Object.assign(translations.fr, {
  'Before route entry': 'Avant l’entrée sur la route',
  'Help loading': 'Chargement de l’aide …', 'Help load failed': 'Impossible de charger l’aide ({error}).',
})
Object.assign(translations.gb, {
  'Before route entry': 'Before joining the route',
  'Help loading': 'Loading help …', 'Help load failed': 'Could not load help ({error}).',
})

Object.assign(translations.de, {
  'Model coverage': 'Modellgebiet · {area}',
  'Planned SOG': 'SOG - Planwert',
  'AWS reading': 'AWS {speed} kn',
  'Onboard wind reach': 'Reichweite des Bootswindes',
  'Onboard wind limit': 'Ohne Bootswind ab {distance} nm oder {duration}',
})
Object.assign(translations.nl, {
  'Model coverage': 'Modelgebied · {area}',
  'Planned SOG': 'Geplande SOG',
  'AWS reading': 'AWS {speed} kn',
  'Onboard wind reach': 'Bereik van de boordwind',
  'Onboard wind limit': 'Zonder boordwind vanaf {distance} nm of {duration}',
})
Object.assign(translations.fr, {
  'Model coverage': 'Domaine du modèle · {area}',
  'Planned SOG': 'SOG prévue',
  'AWS reading': 'AWS {speed} nd',
  'Onboard wind reach': 'Portée du vent mesuré à bord',
  'Onboard wind limit': 'Sans vent mesuré à bord dès {distance} NM ou {duration}',
})
Object.assign(translations.gb, {
  'Model coverage': 'Model coverage · {area}',
  'Planned SOG': 'Planned SOG',
  'AWS reading': 'AWS {speed} kn',
  'Onboard wind reach': 'Onboard wind reach',
  'Onboard wind limit': 'Onboard wind drops out at {distance} nm or {duration}',
})

const elements = Object.fromEntries([
  'connection-status', 'app-version', 'language-select', 'route-select', 'refresh-routes-button', 'delete-route-button', 'weather-provider-select', 'hide-raster-providers', 'snapshot-select', 'delete-snapshot-button', 'snapshot-page', 'snapshot-meta', 'speed-input', 'refresh-button',
  'route-title', 'waypoint-count', 'route-total-distance', 'route-distance-endpoints', 'route-distance', 'route-duration', 'route-average-speed', 'top-route-duration', 'top-route-average-speed', 'forecast-updated', 'forecast-rows',
  'waypoint-radius', 'waypoint-radius-value', 'reset-route-progress', 'next-waypoint-values', 'next-waypoint-target',
  'wind-reach', 'wind-reach-limit',
  'route-source', 'choose-gpx', 'gpx-file', 'gpx-files', 'gpx-status', 'gpx-route-picker', 'gpx-route', 'open-help', 'help-dialog',
  'gpx-pi-dialog', 'gpx-directory-form', 'gpx-directory', 'reload-gpx-library', 'gpx-library-status', 'gpx-library-files',
  'open-grib', 'active-grib', 'grib-dialog', 'grib-existing', 'grib-existing-form', 'grib-upload', 'grib-browse',
  'grib-path-form', 'grib-path', 'grib-source-form', 'grib-source', 'grib-url-form', 'grib-url', 'grib-source-name',
  'grib-status', 'weather-action', 'qtvlm-enable', 'qtvlm-status', 'qtvlm-grib-files', 'qtvlm-history', 'qtvlm-barriers',
  'provider-cards', 'raster-cache-status', 'raster-cache-path', 'delete-raster-cache', 'page-indicator',
  'status-message', 'source-gps', 'source-engine', 'source-stw', 'source-current',
  'source-polar', 'source-forecast-wind', 'source-own-wind', 'source-heading', 'heading-status', 'own-wind-status', 'current-status', 'polar-status', 'motor-speed-input',
  'polar-directory', 'save-polar-directory', 'polar-select', 'current-directory', 'save-current-directory', 'current-datasets-status'
].map((id) => [id, document.getElementById(id)]))

const state = {
  routes: [],
  routeSource: 'signalk',
  gpx: null,
  gpxError: null,
  gpxLocal: [],
  gpxLibrary: { directory: '', files: [] },
  gpxKey: '',
  gpxRequest: 0,
  gpxBusy: false,
  gpxImporting: false,
  gpxLibraryStatus: '',
  gribLibrary: { files: [], sources: [] },
  localGribId: '',
  gribBusy: false,
  deletingGribFiles: new Set(),
  qtVlmSequence: 0,
  qtVlmBusy: false,
  weatherProgress: null,
  downloadBytes: null,
  language: 'de',
  weatherProviders: [],
  weatherProvider: '',
  selectedRoute: null,
  routeTracking: null,
  navigationCourse: null,
  position: null,
  sogMps: null,
  stwMps: null,
  cogDegrees: null,
  headingDegrees: null,
  ownWind: null,
  polar: null,
  polarFiles: [],
  polarWarnings: [],
  weatherCache: new Map(),
  snapshots: [],
  selectedSnapshotId: '',
  snapshotRequestId: 0,
  activeSnapshot: null,
  snapshotDirectory: '',
  currentCache: new Map(),
  currentAvailable: false,
  weatherFetchedAt: null,
  internetOnline: null,
  checkingInternet: false,
  providerKeyStatus: {},
  metNoContact: '',
  renderSerial: 0,
  highlightedWaypoint: null,
  loadingRoutes: false,
  routeLoadPromise: null,
  navigationRefreshPromise: null,
  weatherRequestId: 0,
  settings: {
    gps: true,
    engine: false,
    stw: false,
    current: false,
    polar: false,
    forecastWind: true,
    ownWind: false,
    useHeading: false,
    motorSpeedKnots: 5,
    fallbackSpeedKnots: 5,
    waypointRadiusMeters: 100,
    windReachLevel: DEFAULT_WIND_REACH_LEVEL,
    refreshMinutes: 720,
    polarDirectory: '',
    polarId: ''
  }
}

function t(key, values = {}) {
  let message = translations[state.language]?.[key] || translations.de[key] || key
  for (const [name, value] of Object.entries(values)) message = message.replaceAll(`{${name}}`, String(value))
  return message
}

function applyTranslations() {
  document.documentElement.lang = state.language === 'gb' ? 'en-GB' : state.language
  for (const node of document.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n)
  for (const node of document.querySelectorAll('[data-i18n-aria-label]')) node.setAttribute('aria-label', t(node.dataset.i18nAriaLabel))
  for (const node of document.querySelectorAll('[data-i18n-title]')) node.title = t(node.dataset.i18nTitle)
  for (const node of document.querySelectorAll('[data-i18n-placeholder]')) node.placeholder = t(node.dataset.i18nPlaceholder)
  updateWaypointRadiusLabel()
  updateWindReachLabel()
  updateGpxControls()
  updateGribControls()
  renderStoredGribs()
  renderExtraPickers()
  renderRouteTime(state.selectedRoute)
  for (const option of elements['weather-provider-select'].options) {
    const provider = state.weatherProviders.find(({ id }) => id === option.value)
    if (provider) option.textContent = providerOptionLabel(provider)
  }
  if (elements['help-dialog'].open) loadHelp()
  const snapshot = elements['snapshot-select']
  if (snapshot.disabled && !snapshot.value && snapshot.options[0]) snapshot.options[0].textContent = t('No saved weather runs')
  if (state.weatherProgress) document.getElementById('weather-progress-text').textContent = state.weatherProgress()
  showDownloadSize(state.downloadBytes)
}

const extraTranslations = {
  de: ['Sichtweite', 'Niederschlag', 'Bewölkung', 'Luftfeuchte', 'Wellenhöhe', 'Wellenrichtung', 'Wellenperiode', 'Windseehöhe', 'Dünungshöhe', 'Wassertemperatur', 'Wasserstand', 'Modellströmung', 'Richtung der Modellströmung', 'Zusatzdaten abrufen', 'Zusatzspalten', 'Übertragen am', 'GPX-Stand', 'Modelllauf', 'Marine-Daten fehlen', 'Strömungsdaten prüfen', 'Keine Zusatzdaten verfügbar'],
  nl: ['Zicht', 'Neerslag', 'Bewolking', 'Luchtvochtigheid', 'Golfhoogte', 'Golfrichting', 'Golfperiode', 'Windgolfhoogte', 'Deiningshoogte', 'Watertemperatuur', 'Waterstand', 'Modelstroming', 'Richting modelstroming', 'Extra gegevens ophalen', 'Extra kolommen', 'Overgedragen op', 'GPX-datum', 'Modelrun', 'Mariene gegevens ontbreken', 'Stromingsgegevens controleren', 'Geen extra gegevens beschikbaar'],
  fr: ['Visibilité', 'Précipitations', 'Nébulosité', 'Humidité', 'Hauteur des vagues', 'Direction des vagues', 'Période des vagues', 'Hauteur de mer du vent', 'Hauteur de la houle', 'Température de l’eau', 'Niveau de la mer', 'Vitesse du courant modélisé', 'Direction du courant modélisé', 'Données supplémentaires', 'Colonnes supplémentaires', 'Transféré le', 'Date du GPX', 'Cycle du modèle', 'Données marines indisponibles', 'Vérifier les données de courant', 'Aucune donnée supplémentaire']
}
const extraKeys = [...BASE_EXTRA_LABELS, 'Additional forecast data', 'Additional table columns', 'Transferred at', 'GPX timestamp', 'Model run', 'Marine data unavailable', 'Check current dataset', 'No extra data available']
for (const [language, labels] of Object.entries(extraTranslations)) {
  Object.assign(translations[language], Object.fromEntries(extraKeys.map((key, index) => [key, labels[index]])))
}
Object.assign(translations.gb, Object.fromEntries(extraKeys.map((key) => [key, key])))
const gribKeys = ['Own GRIB file', 'Load GRIB file', 'Saved GRIB files', 'Use GRIB file', 'Choose GRIB file',
  'GRIB path on Pi', 'Load GRIB path', 'Saved GRIB sources', 'Load GRIB source', 'Direct GRIB URL',
  'Optional GRIB source name', 'Load GRIB URL', 'Evaluate GRIB', 'No saved GRIB files', 'No saved GRIB sources',
  'Loading GRIB', 'GRIB selected', 'qtVlm direct import', 'Enable qtVlm receiver', 'Waiting for qtVlm',
  'qtVlm receiver disabled', 'qtVlm imported', 'Reflectivity', 'Ice cover', 'Ice thickness', 'Dew point',
  'qtVlm route', 'qtVlm pathway', 'qtVlm GRIB', 'qtVlm POI', 'qtVlm POI archive', 'qtVlm barrier set', 'qtVlm archived track', 'qtVlm receiver inactive']
const gribTranslations = {
  de: ['Eigene GRIB-Datei', 'GRIB-Datei laden', 'Gespeicherte GRIB-Dateien', 'Datei übernehmen', 'GRIB-Datei auswählen',
    'Dateipfad auf dem Pi', 'Pfad laden', 'Gespeicherte GRIB-Quellen', 'Quelle laden', 'Direkter GRIB-Downloadlink',
    'Name zum Speichern der Quelle (optional)', 'GRIB vom Link laden', 'GRIB auswerten', 'Keine gespeicherten GRIB-Dateien', 'Keine gespeicherten GRIB-Quellen',
    'GRIB wird geladen …', 'GRIB ausgewählt: {name}', 'qtVlm-Direktimport', 'qtVlm-Empfang aktivieren', 'Warte auf qtVlm auf Port 5555.',
    'qtVlm-Empfang deaktiviert.', '{type} „{name}“ importiert{detail}.', 'Radarreflektivität', 'Eisbedeckung', 'Eisstärke', 'Taupunkt',
    'Route', 'Strecke', 'GRIB-Datei', 'POI', 'POIs-Archiv', 'Barriere-Satz', 'Archivspur', 'qtVlm-Empfang lauscht derzeit nicht.'],
  nl: ['Eigen GRIB-bestand', 'GRIB-bestand laden', 'Opgeslagen GRIB-bestanden', 'Bestand gebruiken', 'GRIB-bestand kiezen',
    'Bestandspad op de Pi', 'Pad laden', 'Opgeslagen GRIB-bronnen', 'Bron laden', 'Directe GRIB-downloadlink',
    'Naam om de bron op te slaan (optioneel)', 'GRIB via link laden', 'GRIB verwerken', 'Geen opgeslagen GRIB-bestanden', 'Geen opgeslagen GRIB-bronnen',
    'GRIB wordt geladen …', 'GRIB geselecteerd: {name}', 'Directe qtVlm-import', 'qtVlm-ontvangst inschakelen', 'Wachten op qtVlm op poort 5555.',
    'qtVlm-ontvangst uitgeschakeld.', '{type} ‘{name}’ geïmporteerd{detail}.', 'Radarreflectiviteit', 'IJsbedekking', 'IJsdikte', 'Dauwpunt',
    'Route', 'Traject', 'GRIB-bestand', 'POI', 'POI-archief', 'Barrièreset', 'Gearchiveerde track', 'De qtVlm-ontvanger luistert momenteel niet.'],
  fr: ['Fichier GRIB personnel', 'Charger un fichier GRIB', 'Fichiers GRIB enregistrés', 'Utiliser le fichier', 'Choisir un fichier GRIB',
    'Chemin du fichier sur le Pi', 'Charger le fichier', 'Sources GRIB enregistrées', 'Charger la source', 'Lien direct du fichier GRIB',
    'Nom pour enregistrer la source (facultatif)', 'Charger le GRIB depuis le lien', 'Analyser le GRIB', 'Aucun fichier GRIB enregistré', 'Aucune source GRIB enregistrée',
    'Chargement du GRIB …', 'GRIB sélectionné : {name}', 'Import direct qtVlm', 'Activer la réception qtVlm', 'En attente de qtVlm sur le port 5555.',
    'Réception qtVlm désactivée.', '{type} « {name} » importé{detail}.', 'Réflectivité radar', 'Couverture de glace', 'Épaisseur de glace', 'Point de rosée',
    'Route', 'Parcours', 'Fichier GRIB', 'POI', 'Archive de POI', 'Ensemble de barrières', 'Trace archivée', 'Le récepteur qtVlm n’est pas à l’écoute.'],
  gb: [...gribKeys.slice(0, 15), 'Loading GRIB …', 'GRIB selected: {name}', 'qtVlm direct import', 'Enable qtVlm receiver', 'Waiting for qtVlm on port 5555.',
    'qtVlm receiver disabled.', 'Imported {type} “{name}”{detail}.', 'Radar reflectivity', 'Ice cover', 'Ice thickness', 'Dew point',
    'Route', 'Pathway', 'GRIB file', 'POI', 'POI archive', 'Barrier set', 'Archived track', 'The qtVlm receiver is currently not listening.']
}
for (const [language, labels] of Object.entries(gribTranslations)) {
  Object.assign(translations[language], Object.fromEntries(gribKeys.map((key, index) => [key, labels[index]])))
}
for (const [language, date, confirm, deleted] of [
  ['de', 'GRIB-Datei „{name}“ am {date} um {time} Uhr importiert.', 'GRIB-Datei „{name}“ vom Signal-K-Pi löschen?', 'GRIB-Datei „{name}“ gelöscht.'],
  ['nl', 'GRIB-bestand ‘{name}’ geïmporteerd op {date} om {time}.', 'GRIB-bestand ‘{name}’ van de Signal K-Pi verwijderen?', 'GRIB-bestand ‘{name}’ verwijderd.'],
  ['fr', 'Fichier GRIB « {name} » importé le {date} à {time}.', 'Supprimer le fichier GRIB « {name} » du Pi Signal K ?', 'Fichier GRIB « {name} » supprimé.'],
  ['gb', 'GRIB file “{name}” imported on {date} at {time}.', 'Delete GRIB file “{name}” from the Signal K Pi?', 'GRIB file “{name}” deleted.']
]) {
  Object.assign(translations[language], { 'Stored GRIB import date': date, 'Delete saved GRIB': confirm, 'Stored GRIB deleted': deleted })
}
Object.assign(translations.de, { 'LTC POLAR DATA DIRECTORY': 'POLARDATEN-ORDNER RASPBERRY PI (JSON/ CSV)', 'Polar directory help': 'Der Pfad ist pro Pi einstellbar. Beispiel: /home/pi/LTC/Polardata/speech2polardata', 'CURRENT DATA DIRECTORY': 'STRÖMUNGSDATEN RASBERRY PI (IDX)' })
for (const [language, progress, complete] of [
  ['de', 'GRIB-Datei wird ausgewertet · {done}/{total} Wegpunkte', 'GRIB-Auswertung abgeschlossen.'],
  ['nl', 'GRIB-bestand verwerken · {done}/{total} waypoints', 'GRIB-verwerking voltooid.'],
  ['fr', 'Analyse du fichier GRIB · {done}/{total} points', 'Analyse du fichier GRIB terminée.'],
  ['gb', 'Evaluating GRIB file · {done}/{total} waypoints', 'GRIB evaluation complete.']
]) {
  Object.assign(translations[language], { 'GRIB evaluation progress': progress, 'GRIB evaluation complete': complete })
}
for (const [language, label, current] of [
  ['nl', 'MAP MET POLAIRE GEGEVENS RASPBERRY PI (JSON/CSV)', 'STROMINGSGEGEVENS RASPBERRY PI (IDX)'],
  ['fr', 'DOSSIER DES POLAIRES RASPBERRY PI (JSON/CSV)', 'DONNÉES DE COURANT RASPBERRY PI (IDX)'],
  ['gb', 'POLAR DATA FOLDER RASPBERRY PI (JSON/CSV)', 'CURRENT DATA RASPBERRY PI (IDX)']
]) {
  Object.assign(translations[language], { 'LTC POLAR DATA DIRECTORY': label, 'CURRENT DATA DIRECTORY': current })
}

function availableExtras(provider) {
  if (provider === LOCAL_GRIB) return selectedLocalGrib()?.extras || []
  const entry = state.weatherProviders.find(({ id }) => id === provider)
  if (!entry) return []
  const fields = entry.extras || (entry.kind ? [] : SMHI_EXTRAS)
  return provider === 'open-meteo' ? [...fields, ...MARINE_EXTRAS] : fields
}

function extraPreference(name) {
  try {
    const saved = JSON.parse(localStorage.getItem(`${SETTINGS_KEY}:${name}`) || '[]')
    return Array.isArray(saved) ? saved.filter((key) => Object.hasOwn(EXTRA_FIELDS, key)) : []
  } catch {
    return []
  }
}

function renderExtraPickers() {
  const provider = state.weatherProvider
  const available = availableExtras(provider)
  const visible = extraPreference('table-extras')
  const hasValues = new Set()
  for (const { records, marine } of state.weatherCache.values()) {
    for (const record of [...records, ...(marine || [])]) {
      for (const [key, value] of Object.entries(record.extras || {})) if (Number.isFinite(value)) hasValues.add(key)
    }
  }
  for (const [containerId, keys, storageKey] of [
    ['download-extra-options', available, `download-extras:${provider}`],
    ['table-extra-options', Object.keys(EXTRA_FIELDS).filter((key) => hasValues.has(key) || visible.includes(key)), 'table-extras']
  ]) {
    const container = document.getElementById(containerId)
    const selected = extraPreference(storageKey)
    container.replaceChildren()
    if (!keys.length) container.textContent = t('No extra data available')
    for (const key of keys) {
      if (provider === 'open-meteo' && containerId === 'download-extra-options' && key === MARINE_EXTRAS[0]) {
        const source = document.createElement('strong')
        source.className = 'extra-source'
        source.textContent = 'Open-Meteo Marine'
        container.append(source)
      }
      const label = document.createElement('label')
      const box = document.createElement('input')
      box.type = 'checkbox'
      box.checked = selected.includes(key)
      box.addEventListener('change', () => {
        const values = new Set(extraPreference(storageKey))
        if (box.checked) values.add(key)
        else values.delete(key)
        localStorage.setItem(`${SETTINGS_KEY}:${storageKey}`, JSON.stringify([...values]))
        if (storageKey === 'table-extras') {
          if (state.selectedRoute) renderTable()
          else renderEmpty(t('Select a route to calculate forecast'))
        }
      })
      label.append(box, document.createTextNode(t(EXTRA_FIELDS[key][0])))
      container.append(label)
    }
  }
}

function renderRouteTime(route) {
  const node = document.getElementById('route-time')
  const timestamp = Date.parse(route?.timestamp)
  node.hidden = !Number.isFinite(timestamp)
  node.textContent = node.hidden ? '' : `${t(route.id.startsWith('gpx-') ? 'GPX timestamp' : 'Transferred at')}: ${formatDateTime(new Date(timestamp))}`
}

function providerCoverage(id) {
  const model = id === 'ukmo-ukv-netcdf' ? 'ukmo-ukv' : id
  const area = (PROVIDER_COVERAGE[model] || WORLDWIDE)[state.language]
  const grid = PROVIDER_GRID_KM[id]
  if (grid) return `${area}, ${new Intl.NumberFormat(LOCALES[state.language]).format(grid)} km`
  if (id === 'open-meteo' || id === 'met-no') return `${area}, ${VARIABLE_GRID[state.language]}`
  return area
}

Object.assign(translations.de, { 'Route distance': 'Routendistanz', Waypoints: 'Wegpunkte', 'note-ukv-netcdf': 'Kostenloses Rasterarchiv. Lokale Auswertung benötigt python3-gdal auf dem Signal-K-Pi.' })
Object.assign(translations.nl, { 'Route distance': 'Routeafstand', Waypoints: 'Routepunten', 'note-ukv-netcdf': 'Gratis rasterarchief. Lokale verwerking vereist python3-gdal op de Signal K Pi.' })
Object.assign(translations.fr, { 'Route distance': 'Distance de la route', Waypoints: 'Points de route', 'note-ukv-netcdf': 'Archives raster gratuites. Le traitement local nécessite python3-gdal sur le Pi Signal K.' })
Object.assign(translations.gb, { 'Route distance': 'Route distance', Waypoints: 'Waypoints', 'note-ukv-netcdf': 'Free raster archive. Local processing requires python3-gdal on the Signal K Pi.' })

function providerOptionLabel(provider) {
  if (provider.id === LOCAL_GRIB) return t('Own GRIB file')
  const id = `${provider.id} ${provider.label}`.toLowerCase().includes('smhi') ? 'smhi' : provider.id
  return `${provider.label} (${provider.format || 'API'}, ${providerCoverage(id)})`
}

function updateWaypointRadiusLabel() {
  const meters = Number(elements['waypoint-radius'].value)
  elements['waypoint-radius-value'].textContent = `${new Intl.NumberFormat(LOCALES[state.language]).format(meters)} m`
}

function updateWindReachLabel() {
  const level = elements['wind-reach'].valueAsNumber
  const { distanceNm, minutes } = WIND_REACH_LEVELS[level - 1]
  const distance = new Intl.NumberFormat(LOCALES[state.language]).format(distanceNm)
  const duration = formatDuration(minutes * 60000)
  elements['wind-reach-limit'].textContent = t('Onboard wind limit', { distance, duration })
}

function setPage(page) {
  const pageNumber = page === 2 ? 2 : 1
  document.getElementById('page-one').hidden = pageNumber !== 1
  document.getElementById('page-two').hidden = pageNumber !== 2
  for (const button of document.querySelectorAll('[data-page-action="previous"]')) button.disabled = pageNumber === 1
  for (const button of document.querySelectorAll('[data-page-action="next"]')) button.disabled = pageNumber === 2
  const label = t('Page label', { current: pageNumber })
  elements['page-indicator'].textContent = label
  document.querySelector('.page-indicator-bottom').textContent = label
  localStorage.setItem(`${SETTINGS_KEY}:page`, String(pageNumber))
  if (pageNumber === 1 && state.ownWind === null) {
    refreshNavigation().catch((error) => setStatus(`Signal-K-Navigationsdaten konnten nicht aktualisiert werden: ${error.message}`))
  }
  if (pageNumber === 2) refreshRasterCache()
}

function renderProviderCards() {
  const container = elements['provider-cards']
  const fragment = document.createDocumentFragment()
  for (const provider of PROVIDER_CATALOG) {
    const card = document.createElement('article')
    card.className = 'provider-card'
    const heading = document.createElement('div')
    heading.className = 'provider-card-heading'
    const title = document.createElement('h2')
    title.textContent = provider.name
    const link = document.createElement('a')
    link.href = provider.url
    link.target = '_blank'
    link.rel = 'noopener noreferrer'
    link.textContent = t('Open provider access page')
    const access = document.createElement('div')
    access.className = 'provider-access'
    const coverage = document.createElement('small')
    coverage.textContent = t('Model coverage', { area: providerCoverage(provider.id) })
    access.append(link, coverage)
    heading.append(title, access)
    const note = document.createElement('p')
    note.textContent = t(provider.noteKey)
    card.append(heading, note)
    if (provider.key) {
      const controls = document.createElement('div')
      controls.className = 'credential-controls'
      const input = document.createElement('input')
      input.type = 'password'
      input.autocomplete = 'new-password'
      input.id = `provider-key-${provider.id}`
      input.placeholder = t('API key required')
      const save = document.createElement('button')
      save.type = 'button'
      save.className = 'small-button'
      save.dataset.saveCredential = provider.id
      save.textContent = t('Save key')
      const remove = document.createElement('button')
      remove.type = 'button'
      remove.className = 'small-button delete-button'
      remove.dataset.deleteCredential = provider.id
      remove.textContent = t('Delete key')
      const status = document.createElement('span')
      status.className = 'credential-status'
      status.id = `credential-status-${provider.id}`
      status.textContent = t(state.providerKeyStatus[provider.id] ? 'Key present' : 'Key missing')
      controls.append(input, save, remove, status)
      card.append(controls)
    } else {
      const status = document.createElement('span')
      status.className = 'credential-status no-key-required'
      status.textContent = t('No API key required')
      card.append(status)
    }
    if (provider.id === 'met-no') {
      const contact = document.createElement('div')
      contact.className = 'credential-controls metno-contact'
      const input = document.createElement('input')
      input.id = 'met-no-contact'
      input.type = 'text'
      input.autocomplete = 'email'
      input.placeholder = t('MET Norway contact')
      input.value = state.metNoContact
      const save = document.createElement('button')
      save.type = 'button'
      save.className = 'small-button'
      save.dataset.saveMetNoContact = 'true'
      save.textContent = t('Save contact')
      contact.append(input, save)
      card.append(contact)
      const help = document.createElement('small')
      help.textContent = t('Met no contact help')
      card.append(help)
    }
    fragment.append(card)
  }
  container.replaceChildren(fragment)
}

async function loadProviderSettings() {
  const credentials = await getJson(`${PLUGIN_API}/provider-credentials`)
  state.providerKeyStatus = credentials.providerKeys || {}
  state.metNoContact = credentials.metNoContact || ''
  renderProviderCards()
}

async function saveProviderCredential(providerId) {
  const input = document.getElementById(`provider-key-${providerId}`)
  const result = await putJson(`${PLUGIN_API}/provider-credentials`, {
    providerKeys: { [providerId]: input.value.trim() },
    metNoContact: state.metNoContact
  })
  state.providerKeyStatus = result.providerKeys || {}
  input.value = ''
  document.getElementById(`credential-status-${providerId}`).textContent = t(state.providerKeyStatus[providerId] ? 'Key present' : 'Key missing')
  setStatus(t('Credentials saved'))
}

async function saveMetNoContact() {
  const input = document.getElementById('met-no-contact')
  const result = await putJson(`${PLUGIN_API}/provider-credentials`, { providerKeys: {}, metNoContact: input.value.trim() })
  state.metNoContact = result.metNoContact || ''
  input.value = state.metNoContact
  setStatus(t('Credentials saved'))
}

async function deleteProviderCredential(providerId) {
  const response = await fetch(`${PLUGIN_API}/provider-credentials/${encodeURIComponent(providerId)}`, {
    method: 'DELETE', headers: { Accept: 'application/json' }, credentials: 'same-origin'
  })
  const result = await response.json().catch(() => null)
  if (!response.ok) throw new Error(result?.error || `${response.status} ${response.statusText}`)
  state.providerKeyStatus = result.providerKeys || {}
  document.getElementById(`credential-status-${providerId}`).textContent = t('Key missing')
  setStatus(t('Credentials deleted'))
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

async function loadRasterCache() {
  const result = await getJson(`${PLUGIN_API}/raster-cache`)
  const files = Array.isArray(result.files) ? result.files : []
  elements['raster-cache-path'].textContent = result.directory || ''
  elements['raster-cache-status'].textContent = files.length
    ? t('Raster cache count', { count: files.length, size: formatBytes(result.totalBytes || 0) })
    : t('Raster cache empty')
  const list = document.getElementById('raster-cache-files')
  list.replaceChildren(...files.map((file) => {
    const row = document.createElement('li')
    const name = document.createElement('code')
    name.textContent = file.name.replace(/^(ecmwf-ifs-(?:0p1-)?)(\d{4})(\d{2})(\d{2})(\d{2})(\.grib2)$/i, '$1$2_$3_$4_$5$6')
    name.title = file.name
    const runTime = rasterModelRun(file.name)
    const fileInfo = document.createElement('div')
    fileInfo.append(name)
    if (runTime) {
      const run = document.createElement('small')
      run.className = 'raster-model-run'
      run.textContent = `${t('Model run')}: ${new Intl.DateTimeFormat(LOCALES[state.language], { dateStyle: 'short', timeStyle: 'short', timeZone: 'UTC' }).format(runTime)} UTC`
      fileInfo.append(run)
    }
    const size = document.createElement('span')
    size.className = 'raster-file-size'
    size.textContent = formatBytes(file.bytes)
    const button = document.createElement('button')
    button.className = 'small-button delete-button'
    button.type = 'button'
    button.textContent = t('Delete')
    button.setAttribute('aria-label', `${button.textContent}: ${name.textContent}`)
    button.disabled = rasterDeletionPending
    button.addEventListener('click', () => deleteRasterCache(file.name))
    row.append(fileInfo, size, button)
    return row
  }))
  list.hidden = files.length === 0
  elements['delete-raster-cache'].disabled = rasterDeletionPending || list.hidden
}

function rasterModelRun(filename) {
  const ukv = filename.match(/^ukv-(\d{4})(\d{2})(\d{2})T(\d{2})00Z-PT(\d+)H00M-/)
  const grib = filename.match(/^(?:.*-)?(20\d{2})_?(\d{2})_?(\d{2})_?(\d{2})\.grib2$/)
  const match = ukv || grib
  if (!match) return null
  const [, year, month, day, hour, offset] = match
  const time = Date.parse(`${year}-${month}-${day}T${hour}:00:00Z`)
  if (!Number.isFinite(time)) return null
  return new Date(time - Number(offset || 0) * 3600000)
}

function refreshRasterCache() {
  return loadRasterCache().catch((error) => {
    elements['raster-cache-status'].textContent = t('Cache load failed', { error: error.message })
  })
}

let rasterDeletionPending = false

async function deleteRasterCache(file = null) {
  if (rasterDeletionPending || !window.confirm(t(file === null ? 'Delete raster cache confirmation' : 'Delete raster file?', { file }))) return
  const list = document.getElementById('raster-cache-files')
  rasterDeletionPending = true
  elements['delete-raster-cache'].disabled = true
  for (const button of list.querySelectorAll('button')) button.disabled = true
  try {
    const query = file === null ? '' : `?${new URLSearchParams({ file })}`
    const response = await fetch(`${PLUGIN_API}/raster-cache${query}`, { method: 'DELETE', headers: { Accept: 'application/json' }, credentials: 'same-origin' })
    const result = await response.json().catch(() => null)
    if (!response.ok) throw new Error(result?.error || `${response.status} ${response.statusText}`)
    setStatus(t(file === null ? 'Raster cache deleted' : 'Raster file deleted', { file }))
    await refreshRasterCache()
  } catch (error) {
    elements['raster-cache-status'].textContent = t('Cache delete failed', { error: error.message })
  } finally {
    rasterDeletionPending = false
    elements['delete-raster-cache'].disabled = list.hidden
    for (const button of list.querySelectorAll('button')) button.disabled = false
  }
}

function setConnection(message, level = '') {
  elements['connection-status'].textContent = message
  document.querySelector('.live-dot').className = `live-dot ${level}`
}

function renderInternetStatus() {
  const online = state.internetOnline
  setConnection(online === null ? t('Internet check') : online ? 'Online' : 'Offline', online === null ? '' : online ? 'ready' : 'error')
}

async function checkInternet() {
  if (state.checkingInternet) return
  state.checkingInternet = true
  try {
    state.internetOnline = (await getJson(`${PLUGIN_API}/internet-status`, { timeoutMs: 9000 })).online === true
  } catch (error) {
    state.internetOnline = null
    console.warn(error)
  } finally {
    state.checkingInternet = false
    renderInternetStatus()
  }
}

function showWeatherProgress(message, values = {}, total = null, done = null, finished = false) {
  state.weatherProgress = typeof message === 'function' ? message : message ? () => t(message, values) : null
  document.getElementById('weather-progress').hidden = !message
  document.getElementById('weather-progress-text').textContent = state.weatherProgress?.() || ''
  const bar = document.getElementById('weather-progress-bar')
  bar.hidden = finished
  if (total === null) bar.removeAttribute('value')
  else { bar.max = total; bar.value = done }
  if (!message || message === 'Local weather') showDownloadSize(null)
}

function showDownloadSize(bytes) {
  state.downloadBytes = bytes
  const size = document.getElementById('weather-download-size')
  size.hidden = bytes === null
  if (bytes === null) return
  if (bytes === 0) {
    size.textContent = t('No new weather download')
    return
  }
  const unit = bytes >= 1000000 ? 'MB' : 'kB'
  const value = bytes / (unit === 'MB' ? 1000000 : 1000)
  const format = new Intl.NumberFormat(document.documentElement.lang, { maximumFractionDigits: 1 })
  size.textContent = bytes < 100 ? `< ${format.format(0.1)} kB` : `${format.format(value)} ${unit}`
}

function setStatus(message) {
  elements['status-message'].textContent = message
  document.getElementById('provider-status-message').textContent = document.getElementById('page-two').hidden ? '' : message
}

async function readForecastStream(response, onBytes) {
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) throw new Error('Weather download ended before the forecast was received')
      const lines = (buffer + value).split('\n')
      buffer = lines.pop()
      for (const line of lines) {
        if (!line) continue
        const event = JSON.parse(line)
        if (event.bytes > 0 || event.result) onBytes(event.bytes)
        if (event.error) throw Object.assign(new Error(event.error), { statusCode: event.statusCode, retryAfter: event.retryAfter })
        if (event.result) return event.result
      }
    }
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

async function getJson(url, { timeoutMs = 15000, onBytes, method = 'GET' } = {}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(new Error('Signal K API request timed out')), timeoutMs)
  try {
    const response = await fetch(url, { method, headers: { Accept: onBytes ? 'application/x-ndjson' : 'application/json', 'Cache-Control': 'no-cache' }, credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
    if (onBytes && response.ok && response.headers.get('Content-Type')?.startsWith('application/x-ndjson')) {
      return await readForecastStream(response, onBytes)
    }
    const body = await response.json().catch(() => null)
    if (!response.ok) {
      const reason = body?.message || body?.error || `${response.status} ${response.statusText}`
      const error = new Error(reason)
      error.statusCode = response.status
      error.retryAfter = response.headers.get('Retry-After') || body?.retryAfter
      throw error
    }
    return body
  } finally {
    clearTimeout(timeout)
  }
}

function unpackWeatherProviders(payload) {
  const entries = Array.isArray(payload)
    ? payload.map((value, index) => [value?.id || value?.key || String(index), value])
    : Object.entries(payload || {})
  return entries.map(([key, value]) => {
    const id = typeof value === 'string' ? key : value?.id || value?.provider || key
    const label = typeof value === 'string' ? value : value?.name || value?.displayName || value?.title || value?.provider || id
    return { id: String(id), label: String(label) }
  }).filter((provider) => provider.id)
}

async function loadWeatherProviders() {
  try {
    const [registered, direct] = await Promise.all([
      getJson(`${API_ROOT}/weather/_providers`).then(unpackWeatherProviders).catch(() => []),
      getJson(`${PLUGIN_API}/providers`)
    ])
    const signalKProviders = registered.filter((provider) => `${provider.id} ${provider.label}`.toLowerCase().includes('smhi'))
    const providers = [...direct.filter((provider) => provider.id === LOCAL_GRIB),
      ...signalKProviders.map((provider) => ({ ...provider, available: true })), ...direct.filter((provider) => provider.id !== LOCAL_GRIB)]
    state.weatherProviders = providers
    const saved = localStorage.getItem(`${SETTINGS_KEY}:weather-provider`)
    const visibleProviders = elements['hide-raster-providers'].checked
      ? providers.filter((provider) => !provider.raster)
      : providers
    const selected = visibleProviders.find((provider) => provider.id === saved && provider.available !== false) ||
      visibleProviders.find((provider) => provider.id === 'smhi') ||
      visibleProviders.find((provider) => provider.id !== LOCAL_GRIB && provider.available !== false) || visibleProviders[0]
    elements['weather-provider-select'].replaceChildren()
    if (!visibleProviders.length) {
      const option = document.createElement('option')
      option.value = ''
      option.textContent = t('No weather providers')
      elements['weather-provider-select'].append(option)
      elements['weather-provider-select'].disabled = true
      state.weatherProvider = ''
      updateGribControls()
      renderExtraPickers()
      return
    }
    for (const provider of visibleProviders) {
      const option = document.createElement('option')
      option.value = provider.id
      option.textContent = providerOptionLabel(provider)
      option.disabled = provider.available === false
      elements['weather-provider-select'].append(option)
    }
    state.weatherProvider = selected?.id || ''
    updateGribControls()
    elements['weather-provider-select'].value = state.weatherProvider
    elements['weather-provider-select'].disabled = false
    renderExtraPickers()
    if (!state.weatherProvider) {
      setStatus(t('No provider selected'))
    }
  } catch (error) {
    state.weatherProviders = []
    state.weatherProvider = ''
    updateGribControls()
    elements['weather-provider-select'].replaceChildren(new Option(t('Providers unavailable'), ''))
    elements['weather-provider-select'].disabled = true
    renderExtraPickers()
    setStatus(`Wetteranbieter konnten nicht gelesen werden: ${error.message}`)
  }
}

function selectedLocalGrib() {
  return state.gribLibrary.files.find(({ id }) => id === state.localGribId)
}

function updateGribControls() {
  const local = state.weatherProvider === LOCAL_GRIB
  const selected = selectedLocalGrib()
  const busy = elements['refresh-button'].classList.contains('is-loading')
  elements['open-grib'].disabled = !local || busy || state.gribBusy
  elements['active-grib'].textContent = selected?.name || ''
  elements['active-grib'].hidden = !local || !selected
  elements['weather-action'].dataset.i18n = local ? 'Evaluate GRIB' : 'Fetch weather'
  elements['weather-action'].textContent = t(elements['weather-action'].dataset.i18n)
  elements['refresh-button'].disabled = busy || !state.selectedRoute || !state.weatherProvider ||
    (local && (!selected || state.gribBusy || state.deletingGribFiles.has(selected.id)))
}

async function refreshGribLibrary() {
  state.gribLibrary = await getJson(`${PLUGIN_API}/local-grib`)
  if (state.localGribId && !selectedLocalGrib()) {
    state.localGribId = ''
    localStorage.removeItem(`${SETTINGS_KEY}:local-grib`)
  }
  for (const [id, items, empty] of [
    ['grib-existing', state.gribLibrary.files, 'No saved GRIB files'],
    ['grib-source', state.gribLibrary.sources, 'No saved GRIB sources']
  ]) {
    const target = elements[id]
    const previous = id === 'grib-existing' ? state.localGribId : target.value
    target.replaceChildren(...(items.length ? items.map(({ id, name }) => new Option(name, id)) : [new Option(t(empty), '')]))
    if (items.some((item) => item.id === previous)) target.value = previous
    for (const control of target.form.elements) control.disabled = !items.length
  }
  updateGribControls()
  renderStoredGribs()
  renderExtraPickers()
}

function renderStoredGribs() {
  const locale = LOCALES[state.language]
  const dayFormat = new Intl.DateTimeFormat(locale, { year: 'numeric', month: '2-digit', day: '2-digit' })
  const timeFormat = new Intl.DateTimeFormat(locale, { timeStyle: 'short' })
  elements['qtvlm-grib-files'].replaceChildren(...state.gribLibrary.files.map((file) => {
    const row = document.createElement('li')
    const label = document.createElement('span')
    const imported = new Date(file.savedAt)
    label.textContent = Number.isFinite(imported.getTime())
      ? t('Stored GRIB import date', { name: file.name, date: dayFormat.format(imported), time: timeFormat.format(imported) })
      : t('qtVlm imported', { type: t('qtVlm GRIB'), name: file.name, detail: '' })
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'small-button delete-button'
    button.textContent = t('Delete')
    button.disabled = state.deletingGribFiles.has(file.id) ||
      (state.weatherProvider === LOCAL_GRIB && state.localGribId === file.id && elements['refresh-button'].classList.contains('is-loading'))
    button.addEventListener('click', () => deleteStoredGrib(file))
    row.append(label, button)
    return row
  }))
}

async function deleteStoredGrib(file) {
  if (state.deletingGribFiles.has(file.id) || !window.confirm(t('Delete saved GRIB', { name: file.name }))) return
  state.deletingGribFiles.add(file.id)
  updateGribControls()
  renderStoredGribs()
  try {
    await getJson(`${PLUGIN_API}/local-grib/${encodeURIComponent(file.id)}`, { method: 'DELETE' })
    await refreshGribLibrary()
    setStatus(t('Stored GRIB deleted', { name: file.name }))
  } catch (error) {
    setStatus(error.message)
  } finally {
    state.deletingGribFiles.delete(file.id)
    updateGribControls()
    renderStoredGribs()
  }
}

function selectLocalGrib(file) {
  if (!file) return
  state.localGribId = file.id
  localStorage.setItem(`${SETTINGS_KEY}:local-grib`, file.id)
  updateGribControls()
  renderExtraPickers()
  setStatus(t('GRIB selected', { name: file.name }))
  elements['grib-dialog'].close()
}

async function loadGribFrom(action) {
  if (state.gribBusy) return
  state.gribBusy = true
  updateGribControls()
  const dialog = elements['grib-dialog']
  const controls = [...dialog.querySelectorAll('.grib-form button, .grib-form input, .grib-form select')].filter((control) => !control.disabled)
  for (const control of controls) control.disabled = true
  elements['grib-status'].textContent = t('Loading GRIB')
  try {
    const file = await action()
    state.gribLibrary.files = [file, ...state.gribLibrary.files.filter(({ id }) => file.id !== id)]
    selectLocalGrib(file)
    await refreshGribLibrary()
  } catch (error) {
    elements['grib-status'].textContent = error.message
  } finally {
    for (const control of controls) control.disabled = false
    state.gribBusy = false
    updateGribControls()
  }
}

async function uploadGrib(file) {
  const response = await fetch(`${PLUGIN_API}/local-grib/upload?name=${encodeURIComponent(file.name)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, credentials: 'same-origin', body: file
  })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || response.statusText)
  return result
}

async function refreshQtVlm() {
  if (state.qtVlmBusy) return
  state.qtVlmBusy = true
  try {
    const result = await getJson(`${PLUGIN_API}/qtvlm`)
    elements['qtvlm-enable'].checked = result.enabled
    elements['qtvlm-enable'].disabled = false
    elements['qtvlm-status'].textContent = t(result.listening ? 'Waiting for qtVlm' : result.enabled ? 'qtVlm receiver inactive' : 'qtVlm receiver disabled')
    const types = {
      ROUTE: 'qtVlm route', PATHWAY: 'qtVlm pathway', GRIB: 'qtVlm GRIB', POI: 'qtVlm POI',
      ARCHIVE: 'qtVlm POI archive', BARRIER: 'qtVlm barrier set', TRACK: 'qtVlm archived track'
    }
    const fresh = result.history.filter(({ sequence }) => sequence > state.qtVlmSequence)
    state.qtVlmSequence = result.history[0]?.sequence || 0
    elements['qtvlm-history'].replaceChildren(...result.history.filter(({ kind }) => kind !== 'GRIB').map((item) => {
      const row = document.createElement('li')
      const label = document.createElement('span')
      const detail = item.count === undefined ? '' : ` (${new Intl.NumberFormat(LOCALES[state.language]).format(item.count)})`
      label.textContent = item.error || t('qtVlm imported', { type: t(types[item.kind]), name: item.name, detail })
      row.append(label)
      return row
    }))
    elements['qtvlm-barriers'].replaceChildren(...result.barriers.map((file) => {
      const row = document.createElement('li')
      const link = document.createElement('a')
      link.textContent = file
      link.href = `${PLUGIN_API}/qtvlm/barrier?file=${encodeURIComponent(file)}`
      row.append(link)
      return row
    }))
    if (fresh.some(({ kind }) => kind === 'ROUTE' || kind === 'PATHWAY')) await loadRoutes()
    if (fresh.some(({ kind }) => kind === 'TRACK')) await refreshGpxLibrary()
    if (fresh.some(({ kind }) => kind === 'GRIB')) await refreshGribLibrary()
  } catch (error) {
    elements['qtvlm-status'].textContent = error.message
  } finally {
    state.qtVlmBusy = false
  }
}

async function putJson(url, value) {
  const response = await fetch(url, {
    method: 'PUT',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(value)
  })
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    const reason = body?.message || body?.error || `${response.status} ${response.statusText}`
    throw new Error(reason)
  }
  return body
}

function unwrap(value) {
  return value && typeof value === 'object' && 'value' in value ? value.value : value
}

function readSignalKMeasurement(value) {
  const measurement = unwrap(value)
  return {
    value: Number.isFinite(measurement) ? measurement : null,
    source: typeof value?.$source === 'string' ? value.$source : null
  }
}

function finiteNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function formatCoordinate(point) {
  return `${point.latitude.toFixed(5)}, ${point.longitude.toFixed(5)}`
}

function normalizeRoute(routeId, resource) {
  const feature = resource?.feature || resource
  const geometry = feature?.geometry
  if (geometry?.type !== 'LineString' || !Array.isArray(geometry.coordinates)) return null

  const waypointDetails = feature?.properties?.waypoints || resource?.properties?.waypoints || []
  const points = geometry.coordinates.map((coordinate, index) => {
    const longitude = finiteNumber(coordinate?.[0])
    const latitude = finiteNumber(coordinate?.[1])
    if (longitude === null || latitude === null || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null
    const detail = waypointDetails[index] || {}
    return {
      latitude,
      longitude,
      name: typeof detail.name === 'string' && detail.name.trim() ? detail.name.trim() : `Wegpunkt ${index + 1}`
    }
  })
  if (points.some((point) => point === null) || points.length < 2) return null

  const destination = points.at(-1).name
  const rawName = resource?.name || resource?.properties?.name || feature?.properties?.name
  const name = typeof rawName === 'string' && rawName.trim()
    ? rawName.trim()
    : `Route ohne Namen · ${destination} · ${routeId.slice(0, 8)}`
  const properties = feature.properties
  // Earlier qtVlm imports stored the route name and the original position on each waypoint.
  const legacyQtVlm = typeof properties?.name === 'string' && properties.name === name &&
    !properties?.opencpnRouteGuid && Array.isArray(properties?.waypoints) &&
    properties.waypoints.length === geometry.coordinates.length &&
    properties.waypoints.every((waypoint, index) => {
      const position = waypoint?.position
      const coordinate = geometry.coordinates[index]
      return typeof waypoint?.name === 'string' && Array.isArray(position) &&
        position.length === 2 && position[0] === coordinate[0] && position[1] === coordinate[1]
    })
  const origin = properties?.importSource === 'qtVlm' || legacyQtVlm ? 'qtVlm' : 'Ocpn'
  return { id: routeId, name, points, timestamp: resource?.timestamp, origin }
}

function routeLabel(route) {
  return route.origin ? `${route.name} (${route.origin})` : route.name
}

function unpackRoutes(payload) {
  const records = Array.isArray(payload) ? payload.map((item) => [item.id || item.key || '', item]) : Object.entries(payload || {})
  return records.map(([id, value]) => normalizeRoute(id, value)).filter(Boolean)
}

function greatCircleMeters(a, b) {
  const toRad = (degrees) => degrees * Math.PI / 180
  const lat1 = toRad(a.latitude)
  const lat2 = toRad(b.latitude)
  const dLat = lat2 - lat1
  const dLon = toRad(b.longitude - a.longitude)
  const haversine = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(haversine)))
}

function bearingDegrees(a, b) {
  const toRad = (degrees) => degrees * Math.PI / 180
  const lat1 = toRad(a.latitude)
  const lat2 = toRad(b.latitude)
  const dLon = toRad(b.longitude - a.longitude)
  const y = Math.sin(dLon) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon)
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360
}

function formatLegCourse(point, nextPoint) {
  if (!point || !nextPoint || greatCircleMeters(point, nextPoint) < 0.01) return '—'
  return `${Math.round(bearingDegrees(point, nextPoint)) % 360}°`
}

function nearestWaypointIndex(points, position, maxDistance = Infinity) {
  let nearest = -1
  let shortest = Infinity
  for (const [index, point] of points.entries()) {
    const distance = greatCircleMeters(point, position)
    if (distance > maxDistance || distance >= shortest) continue
    nearest = index
    shortest = distance
  }
  return nearest
}

function signalKCourseForRoute(route) {
  const activeRoute = state.navigationCourse?.activeRoute
  const routeHref = typeof activeRoute?.href === 'string' ? activeRoute.href : ''
  const activeRouteId = routeHref.split(/[/?#]/).filter(Boolean).at(-1) || ''
  let decodedRouteId = activeRouteId
  try { decodedRouteId = decodeURIComponent(activeRouteId) } catch { /* Keep the literal resource id. */ }
  if (decodedRouteId !== route.id) return null

  const points = activeRoute.reverse ? [...route.points].reverse() : route.points
  const nextPosition = readPosition(state.navigationCourse?.nextPoint?.position)
  let nextIndex = nextPosition ? nearestWaypointIndex(points, nextPosition, 100) : -1
  if (nextIndex < 0) {
    const pointIndex = activeRoute.pointIndex
    if (pointIndex != null && Number.isInteger(Number(pointIndex)) && pointIndex >= 0 && pointIndex < points.length) nextIndex = Number(pointIndex)
  }
  return { points, nextIndex, reverse: Boolean(activeRoute.reverse) }
}

function routeTrackingFor(route, course) {
  const points = course?.points || route.points
  const key = `${SETTINGS_KEY}:progress:${route.id}:${course?.reverse ? 'reverse' : 'forward'}`
  const geometry = JSON.stringify(points.map(({ latitude, longitude }) => [latitude, longitude]))
  if (state.routeTracking?.key === key && state.routeTracking.geometry === geometry) return state.routeTracking

  let saved
  try { saved = JSON.parse(localStorage.getItem(key)) } catch { /* An unreadable entry is treated as new progress. */ }
  const nextIndex = saved?.geometry === geometry && Number.isInteger(saved.nextIndex) && saved.nextIndex > 0 && saved.nextIndex <= points.length
    ? saved.nextIndex : null
  const position = nextIndex === null ? null : readPosition(saved.position)
  state.routeTracking = { key, geometry, nextIndex, position }
  return state.routeTracking
}

function updateGpsRouteProgress(recheck = false) {
  const route = state.selectedRoute
  if (!route) return
  const course = signalKCourseForRoute(route)
  const points = course?.points || route.points
  const tracking = routeTrackingFor(route, course)
  const position = state.position
  if (!position) return
  const previous = recheck ? null : tracking.position
  if (previous && previous.latitude === position.latitude && previous.longitude === position.longitude) return
  tracking.position = position

  const radius = state.settings.waypointRadiusMeters
  const nextIndex = Math.max(tracking.nextIndex ?? 0, course?.nextIndex ?? -1)
  const lastReached = tracking.nextIndex === null ? null : points[tracking.nextIndex - 1]
  const distanceToLastReached = lastReached ? greatCircleMeters(position, lastReached) : Infinity
  let reached = -1
  let closest = Infinity
  for (let index = nextIndex; index < points.length; index++) {
    const distance = greatCircleMeters(position, points[index])
    if (distance > radius || distance >= closest) continue
    if (previous && greatCircleMeters(previous, points[index]) <= radius && distance >= distanceToLastReached) continue
    reached = index
    closest = distance
  }
  if (reached < 0) return
  tracking.nextIndex = reached + 1
  localStorage.setItem(tracking.key, JSON.stringify({ geometry: tracking.geometry, nextIndex: tracking.nextIndex, position }))
}

function resetGpsRouteProgress() {
  const route = state.selectedRoute
  if (!route) return
  const tracking = routeTrackingFor(route, signalKCourseForRoute(route))
  localStorage.removeItem(tracking.key)
  tracking.nextIndex = null
  tracking.position = state.position
  renderTable()
}

function progressForSelectedRoute(route) {
  const course = signalKCourseForRoute(route)
  const points = course?.points || route.points
  const tracking = routeTrackingFor(route, course)
  const establishedNextIndex = Math.max(tracking.nextIndex ?? -1, course?.nextIndex ?? -1)
  const approaching = establishedNextIndex < 0
  const nextIndex = approaching ? (state.position ? nearestWaypointIndex(points, state.position) : 0) : establishedNextIndex
  const firstLegStart = state.settings.gps && state.position ? state.position : approaching ? null : points[nextIndex - 1]
  return { points, progress: { nextIndex, approaching, firstLegStart } }
}

function gpsLegForRoute(routeState, position) {
  const { nextIndex, approaching } = routeState.progress
  const target = routeState.points[nextIndex]
  if (!target) return null
  const distanceMeters = position ? greatCircleMeters(position, target) : null
  const rowIndex = approaching ? nextIndex : Math.max(0, nextIndex - 1)
  return { rowIndex, target, distanceMeters }
}

function forecastCoordinateKey(point) {
  return `${point.latitude.toFixed(4)},${point.longitude.toFixed(4)}`
}

function cachedForecast(point, provider = state.activeSnapshot?.provider || state.weatherProvider) {
  const entry = state.weatherCache.get(forecastCoordinateKey(point))
  return entry?.provider === provider ? entry : null
}

function parseForecasts(payload) {
  if (Array.isArray(payload)) return payload
  if (Array.isArray(payload?.forecasts)) return payload.forecasts
  if (Array.isArray(payload?.data)) return payload.data
  return []
}

async function loadForecastForPoint(point, provider, requestId, selection, onBytes) {
  const key = forecastCoordinateKey(point)
  if (!provider) {
    const entry = { records: [], fetchedAt: Date.now(), error: t('No provider selected'), provider }
    if (requestId === state.weatherRequestId) state.weatherCache.set(key, entry)
    return entry
  }

  try {
    const params = new URLSearchParams({
      lat: point.latitude.toFixed(5),
      lon: point.longitude.toFixed(5),
      count: '100',
      provider
    })
    const weatherProvider = state.weatherProviders.find((item) => item.id === provider)
    if (provider === LOCAL_GRIB) {
      params.set('grib', state.localGribId)
      params.set('extras', [...selection.atmosphere, ...selection.marine].join(','))
    }
    if (provider === 'ukmo-ukv-netcdf' && state.internetOnline === false) params.set('localOnly', 'true')
    if (weatherProvider?.kind) {
      if (provider !== LOCAL_GRIB && selection.atmosphere.length) params.set('extras', selection.atmosphere.join(','))
      if (provider === 'open-meteo' && selection.marine.length) params.set('marine', selection.marine.join(','))
    }
    let payload
    if (weatherProvider?.kind) {
      payload = await getJson(`${PLUGIN_API}/forecasts/point?${params}`, { timeoutMs: weatherProvider.raster ? 270000 : 90000, onBytes: provider === LOCAL_GRIB ? undefined : onBytes })
    } else {
      payload = { forecasts: parseForecasts(await getJson(`${API_ROOT}/weather/forecasts/point?${params}`)) }
    }
    const records = parseForecasts(payload).map((record) => {
      if (weatherProvider?.kind) return record
      const outside = record.outside || {}
      const values = { visibility: outside.horizontalVisibility, precipitation: outside.precipitationVolume,
        cloud: outside.cloudCover, humidity: outside.relativeHumidity }
      const factors = { visibility: 1, precipitation: 1000, cloud: 100, humidity: 100 }
      return { ...record, extras: Object.fromEntries(selection.atmosphere.flatMap((field) => Number.isFinite(values[field]) ? [[field, values[field] * factors[field]]] : [])) }
    })
    if (records.length === 0 && !payload.marine?.length) throw new Error(`Keine Punktvorhersage von ${provider} für diese Koordinate`)
    const entry = { records, marine: payload.marine, marineError: payload.marineError, fetchedAt: Date.now(), error: '', provider }
    if (requestId === state.weatherRequestId && provider === state.weatherProvider) {
      state.weatherCache.set(key, entry)
    }
    return entry
  } catch (error) {
    const entry = { records: [], fetchedAt: Date.now(), error: error.message, statusCode: error.statusCode, retryAfter: error.retryAfter, provider }
    if (requestId === state.weatherRequestId && provider === state.weatherProvider) {
      state.weatherCache.set(key, entry)
    }
    return entry
  }
}

async function loadRouteForecasts(route, provider, requestId) {
  const points = [...new Map(route.points.map((point) => [forecastCoordinateKey(point), point])).values()]
  const progressLabel = provider === LOCAL_GRIB ? 'GRIB evaluation progress' : 'Weather download progress'
  const desired = extraPreference(`download-extras:${provider}`).filter((field) => availableExtras(provider).includes(field))
  const marineFields = provider === LOCAL_GRIB ? LOCAL_MARINE_EXTRAS : MARINE_EXTRAS
  const selection = { atmosphere: desired.filter((field) => !marineFields.includes(field)), marine: desired.filter((field) => marineFields.includes(field)) }
  let transferred = 0
  const fetchPoint = (point) => {
    const previous = transferred
    return loadForecastForPoint(point, provider, requestId, selection, (bytes) => {
      if (requestId !== state.weatherRequestId || !Number.isSafeInteger(bytes) || bytes < 0) return
      transferred = previous + bytes
      showDownloadSize(transferred)
    })
  }
  let done = 0
  let rateLimited = false
  for (const point of points) {
    if (requestId !== state.weatherRequestId || provider !== state.weatherProvider) return
    showWeatherProgress(progressLabel, { done, total: points.length }, points.length, done)
    let entry = await fetchPoint(point)
    if (requestId !== state.weatherRequestId || provider !== state.weatherProvider) return
    if (entry.statusCode === 429) {
      const header = entry.retryAfter
      const delay = !header ? 5000 : Number.isFinite(Number(header)) ? Number(header) * 1000 : Date.parse(header) - Date.now()
      const wait = Number.isFinite(delay) ? Math.max(1000, delay) : 5000
      if (wait <= 60000) {
        showWeatherProgress('Weather rate limit', { seconds: Math.ceil(wait / 1000) }, points.length, done)
        await new Promise((resolve) => setTimeout(resolve, wait))
        if (requestId !== state.weatherRequestId || provider !== state.weatherProvider) return
        entry = await fetchPoint(point)
      }
      if (entry.statusCode === 429) { rateLimited = true; break }
    }
    done += 1
  }
  if (requestId !== state.weatherRequestId || provider !== state.weatherProvider) return
  showWeatherProgress('Processing weather')
  const missing = route.points.filter((point) => {
    const cached = cachedForecast(point, provider)
    return !cached?.records.length && (provider !== LOCAL_GRIB || !cached?.marine?.length)
  })
  if (missing.length < route.points.length) await saveWeatherSnapshot(route, provider, requestId)
  const withoutMarine = selection.marine.length ? route.points.filter((point) => !cachedForecast(point, provider)?.marine?.length) : []
  const missingExtras = selection.atmosphere.filter((field) => !points.some((point) =>
    cachedForecast(point, provider)?.records.some((record) => Number.isFinite(record.extras?.[field]))))
  return { missing, rateLimited, withoutMarine, missingExtras }
}

async function saveWeatherSnapshot(route, provider = state.weatherProvider, requestId = state.weatherRequestId) {
  const points = route.points.map((point) => {
    const entry = cachedForecast(point, provider)
    return { latitude: point.latitude, longitude: point.longitude, name: point.name, records: entry?.records || [], error: entry?.error || '', marine: entry?.marine, marineError: entry?.marineError }
  })
  if (!points.some((point) => point.records.length || (provider === LOCAL_GRIB && point.marine?.length))) return
  try {
    const snapshot = await postJson(`${PLUGIN_API}/snapshots`, {
      routeId: route.id,
      routeName: route.name,
      provider,
      points
    })
    if (requestId !== state.weatherRequestId || provider !== state.weatherProvider) return
    state.selectedSnapshotId = snapshot.id
    await loadWeatherSnapshots(route.id, snapshot.id, { restore: false, requestId })
    if (requestId !== state.weatherRequestId || provider !== state.weatherProvider) return
    state.activeSnapshot = snapshot
    state.weatherFetchedAt = new Date(snapshot.fetchedAt)
    updateSnapshotPager()
    updateSnapshotMeta()
  } catch (error) {
    if (requestId === state.weatherRequestId) throw new Error(t('Snapshot save failed', { error: error.message }))
  }
}

async function loadWeatherSnapshots(routeId, preferredId = '', { restore = true, requestId = state.weatherRequestId } = {}) {
  const snapshots = await getJson(`${PLUGIN_API}/snapshots?routeId=${encodeURIComponent(routeId)}`)
  if (requestId !== state.weatherRequestId) return false
  state.snapshots = Array.isArray(snapshots) ? snapshots : []
  const select = elements['snapshot-select']
  select.replaceChildren()
  if (!state.snapshots.length) {
    select.append(new Option(t('No saved weather runs'), ''))
    select.disabled = true
    elements['delete-snapshot-button'].disabled = true
    state.selectedSnapshotId = ''
    state.activeSnapshot = null
    updateSnapshotPager()
    updateSnapshotMeta()
    return false
  }
  for (const item of state.snapshots) {
    const date = new Date(item.fetchedAt)
    const option = new Option(`${new Intl.DateTimeFormat(LOCALES[state.language], { dateStyle: 'short', timeStyle: 'short' }).format(date)} · ${item.provider}`, item.id)
    select.append(option)
  }
  const chosen = state.snapshots.find((item) => item.id === preferredId) || state.snapshots[0]
  select.value = chosen.id
  state.selectedSnapshotId = chosen.id
  select.disabled = false
  elements['delete-snapshot-button'].disabled = false
  if (restore) await restoreWeatherSnapshot(chosen.id)
  updateSnapshotPager()
  return true
}

function providerName(id, forecastSource = '') {
  if (id === LOCAL_GRIB) return forecastSource || t('Own GRIB file')
  return state.weatherProviders.find((provider) => provider.id === id)?.label || forecastSource || id || '—'
}

function updateSnapshotPager() {
  const index = state.snapshots.findIndex((snapshot) => snapshot.id === state.selectedSnapshotId)
  const current = index >= 0 ? index + 1 : 0
  elements['snapshot-page'].textContent = t('Snapshot page', { current, total: state.snapshots.length })
}

function updateSnapshotMeta() {
  if (!state.activeSnapshot) {
    elements['snapshot-meta'].textContent = t('No saved run details')
    if (state.snapshotDirectory) elements['snapshot-meta'].textContent += `\n${t('Snapshot storage path', { path: state.snapshotDirectory })}`
    return
  }
  const snapshot = state.activeSnapshot
  const fetchedAt = formatDateTime(new Date(snapshot.fetchedAt))
  const filename = `${state.snapshotDirectory || 'Signal K plugin data directory'}/${snapshot.id}.json`
  elements['snapshot-meta'].textContent = `${t('Snapshot meta', {
    provider: providerName(snapshot.provider),
    date: fetchedAt,
    route: snapshot.routeName,
    file: filename
  })}\n${t('Snapshot page', {
    current: Math.max(1, state.snapshots.findIndex((item) => item.id === snapshot.id) + 1),
    total: state.snapshots.length
  })}`
}

async function restoreWeatherSnapshot(id) {
  if (!id) return
  const requestId = ++state.snapshotRequestId
  const snapshot = await getJson(`${PLUGIN_API}/snapshots/${encodeURIComponent(id)}`)
  if (requestId !== state.snapshotRequestId) return
  state.weatherCache.clear()
  for (const point of snapshot.points) {
    state.weatherCache.set(forecastCoordinateKey(point), {
      records: Array.isArray(point.records) ? point.records : [],
      marine: Array.isArray(point.marine) ? point.marine : [],
      marineError: point.marineError,
      fetchedAt: Date.parse(snapshot.fetchedAt),
      error: point.error || '',
      provider: snapshot.provider
    })
  }
  state.selectedSnapshotId = snapshot.id
  state.activeSnapshot = snapshot
  state.weatherFetchedAt = new Date(snapshot.fetchedAt)
  renderExtraPickers()
  updateSnapshotPager()
  updateSnapshotMeta()
  await renderTable()
}

async function loadAppVersionAndStorage() {
  const result = await getJson(`${PLUGIN_API}/version`)
  if (result.appVersion) elements['app-version'].textContent = `v${result.appVersion}`
  state.snapshotDirectory = result.snapshotDirectory || ''
  updateSnapshotMeta()
}

async function postJson(url, value) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
    credentials: 'same-origin',
    cache: 'no-store',
    body: JSON.stringify(value)
  })
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new Error(body?.message || body?.error || `${response.status} ${response.statusText}`)
  return body
}

const deleteText = {
  de: ['Routen löschen', 'Wetterläufe löschen', 'Mit den ausgewählten Routen werden auch ihre gespeicherten Wetterläufe gelöscht.', 'Die ausgewählten Wetterläufe werden dauerhaft gelöscht.', 'Abbrechen', 'Auswahl löschen', 'Gelöscht: {count}'],
  nl: ['Routes verwijderen', 'Weerruns verwijderen', 'Ook de opgeslagen weerruns van de geselecteerde routes worden verwijderd.', 'De geselecteerde weerruns worden definitief verwijderd.', 'Annuleren', 'Selectie verwijderen', 'Verwijderd: {count}'],
  fr: ['Supprimer des routes', 'Supprimer des prévisions', 'Les prévisions enregistrées pour les routes sélectionnées seront également supprimées.', 'Les prévisions sélectionnées seront supprimées définitivement.', 'Annuler', 'Supprimer la sélection', 'Supprimés : {count}'],
  gb: ['Delete routes', 'Delete weather runs', 'The selected routes and their saved weather runs will be deleted.', 'The selected weather runs will be permanently deleted.', 'Cancel', 'Delete selected', 'Deleted: {count}']
}
const deleteKeys = ['Delete routes', 'Delete weather runs', 'Delete routes description', 'Delete runs description', 'Cancel deletion', 'Delete selected', 'Deleted items']
for (const [language, labels] of Object.entries(deleteText)) {
  Object.assign(translations[language], Object.fromEntries(deleteKeys.map((key, index) => [key, labels[index]])))
}

function openDeleteDialog(kind) {
  const routes = kind === 'routes'
  const items = routes ? state.routes : state.snapshots
  const selectedId = elements[routes ? 'route-select' : 'snapshot-select'].value
  if (!items.length || (routes && state.routeSource !== 'signalk')) return
  const dialog = document.getElementById('delete-dialog')
  dialog.dataset.kind = kind
  document.getElementById('delete-title').textContent = t(routes ? 'Delete routes' : 'Delete weather runs')
  document.getElementById('delete-description').textContent = t(routes ? 'Delete routes description' : 'Delete runs description')
  const options = document.getElementById('delete-options')
  options.replaceChildren()
  for (const item of items) {
    const label = document.createElement('label')
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.value = item.id
    box.checked = item.id === selectedId
    const name = routes ? routeLabel(item) : formatDateTime(new Date(item.fetchedAt)) + ' · ' + providerName(item.provider)
    label.append(box, document.createTextNode(name))
    options.append(label)
  }
  document.getElementById('delete-result').textContent = ''
  updateDeleteConfirm()
  dialog.showModal()
}

function updateDeleteConfirm() {
  const dialog = document.getElementById('delete-dialog')
  document.getElementById('delete-confirm').disabled = dialog.dataset.busy === 'true' || !dialog.querySelector('input:checked')
}

async function deleteSelected(event) {
  event.preventDefault()
  const dialog = document.getElementById('delete-dialog')
  const selected = Array.from(dialog.querySelectorAll('input:checked'))
  if (!selected.length || dialog.dataset.busy === 'true') return
  dialog.dataset.busy = 'true'
  const cancel = document.getElementById('delete-cancel')
  const resultText = document.getElementById('delete-result')
  cancel.disabled = true
  for (const input of dialog.querySelectorAll('input')) input.disabled = true
  updateDeleteConfirm()
  try {
    const kind = dialog.dataset.kind
    const result = await postJson(PLUGIN_API + '/deletions', { kind, ids: selected.map((box) => box.value) })
    const deleted = new Set(result.deleted)
    for (const box of selected) if (deleted.has(box.value)) box.closest('label').remove()
    const message = t('Deleted items', { count: deleted.size })
    resultText.textContent = [message, ...result.failed.map(({ id, error }) => {
      const box = selected.find((item) => item.value === id)
      return (box?.closest('label').textContent || id) + ' · ' + error
    })].join('\n')
    if (kind === 'routes') {
      const routeKey = SETTINGS_KEY + ':route'
      if (deleted.has(localStorage.getItem(routeKey))) localStorage.removeItem(routeKey)
      await loadRoutes({ quiet: true })
    } else if (state.selectedRoute) {
      const activeDeleted = deleted.has(state.selectedSnapshotId)
      if (activeDeleted) {
        state.weatherCache.clear()
        state.weatherFetchedAt = null
        renderExtraPickers()
      }
      await loadWeatherSnapshots(state.selectedRoute.id, activeDeleted ? '' : state.selectedSnapshotId)
      if (activeDeleted && !state.snapshots.length) await renderTable()
    }
    setStatus(message)
    if (!result.failed.length) dialog.close()
  } catch (error) {
    resultText.textContent = error.message
  } finally {
    dialog.dataset.busy = 'false'
    cancel.disabled = false
    for (const input of dialog.querySelectorAll('input')) input.disabled = false
    updateDeleteConfirm()
  }
}

function forecastTime(record) {
  const date = record?.date || record?.timestamp || record?.validTime || record?.time
  const timestamp = Date.parse(typeof date === 'string' && /^\d{4}-\d{2}-\d{2}T\d\d:\d\d(?::\d\d(?:\.\d+)?)?$/.test(date) ? `${date}Z` : date)
  return Number.isFinite(timestamp) ? timestamp : null
}

function closestForecast(records, targetTime, maxGapHours = 6) {
  let result = null
  let difference = Infinity
  let before = -Infinity
  let after = Infinity
  for (const record of records) {
    const timestamp = forecastTime(record)
    if (timestamp === null) continue
    if (timestamp <= targetTime) before = Math.max(before, timestamp)
    if (timestamp >= targetTime) after = Math.min(after, timestamp)
    const candidate = Math.abs(timestamp - targetTime)
    if (candidate < difference) {
      result = record
      difference = candidate
    }
  }
  return after - before <= maxGapHours * 60 * 60 * 1000 ? result : null
}

function windSpeedKnots(record) {
  const value = finiteNumber(record?.wind?.speedTrue ?? record?.wind?.averageSpeed ?? record?.wind?.speed)
  return value === null ? null : value * MS_TO_KNOTS
}

function windFromDegrees(record) {
  const direct = finiteNumber(record?.wind?.directionTrue)
  if (direct !== null) return (direct * 180 / Math.PI + 360) % 360
  const degrees = finiteNumber(record?.wind?.directionDegrees ?? record?.wind?.direction)
  return degrees === null ? null : degrees
}

function axisBracket(axis, value) {
  const values = axis.map(Number).filter(Number.isFinite).sort((a, b) => a - b)
  if (!values.length || value < values[0] || value > values.at(-1)) return null
  for (let index = 0; index < values.length - 1; index++) {
    if (value >= values[index] && value <= values[index + 1]) {
      const low = values[index]
      const high = values[index + 1]
      return { low, high, ratio: high === low ? 0 : (value - low) / (high - low) }
    }
  }
  return { low: values.at(-1), high: values.at(-1), ratio: 0 }
}

function polarSpeed(vpp, twa, tws) {
  const angleAxis = axisBracket(vpp.angles, twa)
  const windAxis = axisBracket(vpp.speeds, tws)
  if (!angleAxis || !windAxis) return null

  const rowValue = (angle) => {
    const row = vpp[String(angle)]
    if (!Array.isArray(row)) return null
    const windValues = vpp.speeds.map(Number)
    const ordered = windValues.map((wind, index) => ({ wind, speed: finiteNumber(row[index]) }))
      .filter((item) => item.speed !== null).sort((a, b) => a.wind - b.wind)
    const low = ordered.find((item) => item.wind === windAxis.low)
    const high = ordered.find((item) => item.wind === windAxis.high)
    if (!low || !high) return null
    return low.speed + (high.speed - low.speed) * windAxis.ratio
  }

  const low = rowValue(angleAxis.low)
  const high = rowValue(angleAxis.high)
  if (low === null || high === null) return null
  return low + (high - low) * angleAxis.ratio
}

function minPolarAngle(vpp, tws) {
  const angles = vpp.angles.map(Number).filter((angle) => Number.isFinite(angle) && angle >= 0 && angle <= 90).sort((a, b) => a - b)
  return angles.find((angle) => {
    const speed = polarSpeed(vpp, angle, tws)
    return speed !== null && speed > 0
  }) ?? null
}

function polarGroundProgress(vpp, bearing, windFrom, tws) {
  const delta = ((windFrom - bearing + 540) % 360) - 180
  const targetTwa = Math.abs(delta)
  const minimumTwa = minPolarAngle(vpp, tws)
  if (minimumTwa === null) return null
  const targetSpeed = polarSpeed(vpp, targetTwa, tws)
  if (targetTwa >= minimumTwa && targetSpeed !== null && targetSpeed > 0) return targetSpeed
  const twa = minimumTwa
  const stw = polarSpeed(vpp, twa, tws)
  if (stw === null || stw <= 0) return null

  const wind = windFrom * Math.PI / 180
  const target = bearing * Math.PI / 180
  const upwind = twa * Math.PI / 180
  const headingA = wind + upwind
  const headingB = wind - upwind
  const crossA = Math.sin(headingA - target)
  const crossB = Math.sin(headingB - target)
  if (crossA * crossB >= 0) {
    return stw * Math.max(0, Math.cos(headingA - target), Math.cos(headingB - target))
  }
  const weightA = Math.abs(crossB) / (Math.abs(crossA) + Math.abs(crossB))
  const along = weightA * Math.cos(headingA - target) + (1 - weightA) * Math.cos(headingB - target)
  return stw * Math.max(0, along)
}

function currentComponents(data) {
  const sample = data?.sample || data
  const east = finiteNumber(sample?.u ?? sample?.east ?? sample?.eastward)
  const north = finiteNumber(sample?.v ?? sample?.north ?? sample?.northward)
  if (east === null || north === null) return null
  return {
    eastMps: east,
    northMps: north,
    source: data?.source || sample?.source || '',
    dataset: data?.dataset || '',
    station: data?.station || '',
    distanceKm: finiteNumber(data?.distanceKm)
  }
}

async function currentForPoint(point, time) {
  const slot = Math.floor(time / (30 * 60 * 1000))
  const key = `${forecastCoordinateKey(point)}:${slot}`
  if (state.currentCache.has(key)) return state.currentCache.get(key)
  const params = new URLSearchParams({
    latitude: String(point.latitude),
    longitude: String(point.longitude),
    time: new Date(time).toISOString()
  })
  try {
    const data = await getJson(`${PLUGIN_API}/currents/predict?${params}`)
    const current = currentComponents(data)
    if (!current) throw new Error('Strömungsantwort enthält keinen Vektor u/v')
    state.currentCache.set(key, current)
    return current
  } catch (error) {
    const failed = { error: error.message }
    state.currentCache.set(key, failed)
    return failed
  }
}

function alongAndCrossKnots(current, bearing) {
  const radians = bearing * Math.PI / 180
  const eastKnots = current.eastMps * MS_TO_KNOTS
  const northKnots = current.northMps * MS_TO_KNOTS
  return {
    along: eastKnots * Math.sin(radians) + northKnots * Math.cos(radians),
    cross: eastKnots * Math.cos(radians) - northKnots * Math.sin(radians)
  }
}

function predictedGroundSpeed(boatSpeedKnots, current, bearing) {
  if (!Number.isFinite(boatSpeedKnots) || boatSpeedKnots <= 0) return null
  if (!current) return boatSpeedKnots
  const { along, cross } = alongAndCrossKnots(current, bearing)
  if (Math.abs(cross) >= boatSpeedKnots) return null
  return Math.sqrt(boatSpeedKnots ** 2 - cross ** 2) + along
}

function fallbackBoatSpeedKnots() {
  if (state.settings.engine) return Number(state.settings.motorSpeedKnots)
  if (state.settings.stw && Number.isFinite(state.stwMps) && state.stwMps > 0.15) return state.stwMps * MS_TO_KNOTS
  if (state.settings.gps && Number.isFinite(state.sogMps) && state.sogMps > 0.15) return state.sogMps * MS_TO_KNOTS
  if (state.settings.gps) return Number(state.settings.fallbackSpeedKnots)
  return null
}

function selectForecast(point, targetTime) {
  const cached = state.weatherCache.get(forecastCoordinateKey(point))
  if (cached?.provider === LOCAL_GRIB) return closestForecast(cached.records.filter(({ wind }) => Number.isFinite(wind?.speed)), targetTime, 24)
  return cached ? closestForecast(cached.records, targetTime) : null
}

function routeWindForLeg(forecast, onboardShare) {
  const onboard = state.settings.ownWind && onboardShare > 0 ? state.ownWind : null
  const provider = state.settings.forecastWind && forecast
    ? { speedKnots: windSpeedKnots(forecast), directionDegrees: windFromDegrees(forecast) }
    : null
  const hasOnboard = onboard && Number.isFinite(onboard.speedKnots) && Number.isFinite(onboard.directionDegrees)
  const hasProvider = provider && Number.isFinite(provider.speedKnots) && Number.isFinite(provider.directionDegrees)
  if (!hasOnboard && !hasProvider) return null

  const onboardWeight = hasOnboard && hasProvider ? Math.max(0, Math.min(1, onboardShare)) : hasOnboard ? 1 : 0
  const providerWeight = hasProvider && hasOnboard ? 1 - onboardWeight : hasProvider ? 1 : 0
  const toVector = (wind, weight) => {
    const radians = wind.directionDegrees * Math.PI / 180
    return { east: -wind.speedKnots * Math.sin(radians) * weight, north: -wind.speedKnots * Math.cos(radians) * weight }
  }
  const onboardVector = hasOnboard ? toVector(onboard, onboardWeight) : { east: 0, north: 0 }
  const providerVector = hasProvider ? toVector(provider, providerWeight) : { east: 0, north: 0 }
  const east = onboardVector.east + providerVector.east
  const north = onboardVector.north + providerVector.north
  const speedKnots = Math.hypot(east, north)
  if (hasOnboard && hasProvider) {
    const weightedSpeed = onboard.speedKnots * onboardWeight + provider.speedKnots * providerWeight
    if (speedKnots < weightedSpeed / 3) {
      const preferOnboard = onboardWeight >= providerWeight
      const selected = preferOnboard ? onboard : provider
      return {
        speedKnots: selected.speedKnots,
        directionDegrees: selected.directionDegrees,
        onboardPercent: preferOnboard ? 100 : 0,
        providerPercent: preferOnboard ? 0 : 100
      }
    }
  }
  const directionDegrees = speedKnots > 0.01 ? (Math.atan2(-east, -north) * 180 / Math.PI + 360) % 360 : null
  return {
    speedKnots,
    directionDegrees,
    onboardPercent: Math.round(onboardWeight * 100),
    providerPercent: Math.round(providerWeight * 100)
  }
}

function baseSpeedForLeg(bearing, wind, isNextLeg) {
  if (state.settings.engine) return { boatSpeedKnots: Number(state.settings.motorSpeedKnots), groundSpeedKnots: Number(state.settings.motorSpeedKnots), basis: t('Motor plan') }

  if (state.settings.polar && state.polar && wind) {
    const tws = wind.speedKnots
    const windFrom = wind.directionDegrees
    if (tws !== null && windFrom !== null) {
      const relativeWind = Math.abs(((windFrom - bearing + 540) % 360) - 180)
      const boatSpeed = polarSpeed(state.polar.vpp, relativeWind, tws)
      const groundSpeed = polarGroundProgress(state.polar.vpp, bearing, windFrom, tws)
      if (boatSpeed !== null && boatSpeed > 0 && groundSpeed !== null && groundSpeed > 0) {
        return { boatSpeedKnots: boatSpeed, groundSpeedKnots: groundSpeed, basis: t('Polar'), twsKnots: tws, twaDegrees: relativeWind, isPolar: true }
      }
    }
  }

  if (isNextLeg && state.settings.gps && Number.isFinite(state.sogMps) && state.sogMps > 0.15) {
    const sogKnots = state.sogMps * MS_TO_KNOTS
    const routeRadians = bearing * Math.PI / 180
    const cogRadians = Number.isFinite(state.cogDegrees) ? state.cogDegrees * Math.PI / 180 : routeRadians
    const speed = sogKnots * Math.max(0, Math.cos(cogRadians - routeRadians))
    if (speed > 0.1) return { boatSpeedKnots: speed, groundSpeedKnots: speed, basis: t('GPS SOG') }
  }
  if (state.settings.stw && Number.isFinite(state.stwMps) && state.stwMps > 0.15) {
    const speed = state.stwMps * MS_TO_KNOTS
    return { boatSpeedKnots: speed, groundSpeedKnots: speed, basis: t('STW') }
  }
  const fallback = state.settings.gps ? state.settings.fallbackSpeedKnots : null
  return fallback && fallback > 0 ? { boatSpeedKnots: fallback, groundSpeedKnots: fallback, basis: t('Planned speed') } : null
}

function applyCurrentToSpeed(speed, current, bearing, isGroundSpeed) {
  if (!speed || !current || current.error) return speed
  const { along, cross } = alongAndCrossKnots(current, bearing)
  if (isGroundSpeed) {
    return { ...speed, groundSpeedKnots: speed.groundSpeedKnots + along, currentAlongKnots: along, currentCrossKnots: cross }
  }
  if (Math.abs(cross) >= speed.boatSpeedKnots) {
    return { ...speed, groundSpeedKnots: null, currentAlongKnots: along, currentCrossKnots: cross }
  }
  if (speed.isPolar) {
    const trackKeepingFactor = Math.sqrt(1 - (cross / speed.boatSpeedKnots) ** 2)
    return {
      ...speed,
      groundSpeedKnots: speed.groundSpeedKnots * trackKeepingFactor + along,
      currentAlongKnots: along,
      currentCrossKnots: cross
    }
  }
  return {
    ...speed,
    groundSpeedKnots: Math.sqrt(speed.boatSpeedKnots ** 2 - cross ** 2) + along,
    currentAlongKnots: along,
    currentCrossKnots: cross
  }
}

async function routeEstimates(route, progress) {
  const waypointEstimates = route.points.map((point, index) => ({
    point,
    index,
    passed: index < progress.nextIndex,
    eta: null,
    distanceMeters: 0,
    speedKnots: null,
    basis: '',
    twsKnots: null,
    twaDegrees: null,
    onboardWindPercent: null,
    providerWindPercent: null,
    currentAlongKnots: null,
    currentSource: '',
    currentDataset: '',
    currentStation: '',
    currentDistanceKm: null,
    currentError: ''
  }))
  if (progress.nextIndex >= route.points.length) return { waypointEstimates, remainingNm: 0, remainingDurationMs: 0 }
  let totalRemainingMeters = 0
  const legs = waypointEstimates.slice(progress.nextIndex).map((estimate) => {
    const start = estimate.index === progress.nextIndex ? progress.firstLegStart : route.points[estimate.index - 1]
    const distanceMeters = start ? greatCircleMeters(start, estimate.point) : 0
    totalRemainingMeters += distanceMeters
    estimate.distanceMeters = totalRemainingMeters
    return { estimate, start, distanceMeters }
  })
  const now = Date.now()
  const windReach = WIND_REACH_LEVELS[state.settings.windReachLevel - 1]
  let arrivalAt = now
  for (const { estimate, start, distanceMeters } of legs) {
    if (!Number.isFinite(arrivalAt)) break
    const destination = estimate.point
    const bearing = start ? bearingDegrees(start, destination)
      : bearingDegrees(destination, route.points[estimate.index + 1] || destination)

    let tentativeEta = arrivalAt + (distanceMeters / 1852 / Math.max(0.1, fallbackBoatSpeedKnots() || 5)) * 3600000
    let selectedSpeed = null
    let selectedCurrent = null
    for (let iteration = 0; iteration < 2; iteration++) {
      const forecast = selectForecast(destination, tentativeEta)
      const distanceShare = estimate.distanceMeters / (windReach.distanceNm * 1852)
      const timeShare = (tentativeEta - now) / (windReach.minutes * 60000)
      const onboardShare = Math.max(0, 1 - Math.max(distanceShare, timeShare))
      const selectedWind = routeWindForLeg(forecast, onboardShare)
      estimate.twsKnots = selectedWind?.speedKnots ?? null
      estimate.twaDegrees = selectedWind?.directionDegrees === null || selectedWind?.directionDegrees === undefined
        ? null
        : Math.abs(((selectedWind.directionDegrees - bearing + 540) % 360) - 180)
      estimate.onboardWindPercent = selectedWind?.onboardPercent ?? null
      estimate.providerWindPercent = selectedWind?.providerPercent ?? null
      if (distanceMeters <= 1) {
        tentativeEta = arrivalAt
        break
      }
      selectedSpeed = baseSpeedForLeg(bearing, selectedWind, estimate.index === progress.nextIndex)
      const useCurrent = state.settings.current && state.currentAvailable && selectedSpeed && selectedSpeed.basis !== t('GPS SOG')
      selectedCurrent = useCurrent ? await currentForPoint(destination, tentativeEta) : null
      if (selectedCurrent && !selectedCurrent.error) {
        selectedSpeed = applyCurrentToSpeed(selectedSpeed, selectedCurrent, bearing, selectedSpeed.basis === t('GPS SOG'))
      }
      const groundSpeed = selectedSpeed?.groundSpeedKnots
      if (!Number.isFinite(groundSpeed) || groundSpeed <= 0) {
        tentativeEta = NaN
        break
      }
      tentativeEta = arrivalAt + (distanceMeters / 1852 / groundSpeed) * 3600000
    }

    if (Number.isFinite(tentativeEta)) {
      estimate.eta = new Date(tentativeEta)
      estimate.speedKnots = selectedSpeed?.groundSpeedKnots ?? null
      estimate.basis = selectedSpeed?.basis || ''
      estimate.currentAlongKnots = selectedSpeed?.currentAlongKnots ?? null
      estimate.currentSource = selectedCurrent?.source || ''
      estimate.currentDataset = selectedCurrent?.dataset || ''
      estimate.currentStation = selectedCurrent?.station || ''
      estimate.currentDistanceKm = selectedCurrent?.distanceKm ?? null
      estimate.currentError = selectedCurrent?.error || ''
    }
    arrivalAt = tentativeEta
  }

  const finishEstimate = waypointEstimates.at(-1)
  return {
    waypointEstimates,
    remainingNm: totalRemainingMeters / 1852,
    remainingDurationMs: finishEstimate?.eta ? finishEstimate.eta.getTime() - now : NaN
  }
}

function formatDateTime(value) {
  if (!value) return '—'
  return new Intl.DateTimeFormat(LOCALES[state.language], { dateStyle: 'medium', timeStyle: 'short' }).format(value)
}

function formatDuration(durationMs) {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return '—'
  let minutes = Math.round(durationMs / 60000)
  const days = Math.floor(minutes / 1440)
  minutes -= days * 1440
  const hours = Math.floor(minutes / 60)
  minutes -= hours * 60
  const parts = []
  if (days) parts.push(`${days} ${t('day short')}`)
  if (hours || days) parts.push(`${hours} ${t('hour short')}`)
  if (minutes || parts.length === 0) parts.push(`${minutes} ${t('minute short')}`)
  return parts.join(' ')
}

function displayWeather(record) {
  const wind = record?.wind || {}
  const outside = record?.outside || {}
  const speed = finiteNumber(wind.speedTrue ?? wind.averageSpeed ?? wind.speed)
  const gust = finiteNumber(wind.gust)
  const direction = finiteNumber(wind.directionTrue)
  const directionDegrees = direction === null ? null : (direction * 180 / Math.PI + 360) % 360
  const windText = speed === null ? '—' : `${(speed * MS_TO_KNOTS).toFixed(1)} kn`
  const gustText = gust === null ? t('No gusts') : `${t('Gusts')} ${(gust * MS_TO_KNOTS).toFixed(1)} kn`
  const temperature = finiteNumber(outside.temperature)
  const tempText = temperature === null ? '—' : `${(temperature - 273.15).toFixed(1)} °C`
  const pressure = finiteNumber(outside.pressure)
  const pressureText = pressure === null ? '—' : `${(pressure / 100).toFixed(0)} hPa`
  const symbolCode = finiteNumber(record?.symbolCode ?? record?.symbol_code ?? record?.Wsymb2 ?? record?.weatherSymbolCode ?? record?.weather?.symbolCode)
  const description = String(record?.description || record?.conditions || record?.weather?.description || '')
  return { windText, gustText, tempText, pressureText, directionDegrees, symbol: weatherSymbol(symbolCode, description, outside), description }
}

function weatherSymbol(code, description, outside) {
  const symbols = {
    1: '☀️', 2: '🌤️', 3: '🌤️', 4: '⛅', 5: '🌥️', 6: '☁️', 7: '🌫️',
    8: '🌦️', 9: '🌧️', 10: '🌧️', 11: '⛈️', 12: '🌨️', 13: '🌨️', 14: '🌨️',
    15: '🌨️', 16: '🌨️', 17: '🌨️', 18: '🌦️', 19: '🌧️', 20: '🌧️', 21: '⛈️',
    22: '🌨️', 23: '🌨️', 24: '🌨️', 25: '❄️', 26: '❄️', 27: '❄️'
  }
  if (code !== null && symbols[code]) return symbols[code]
  const text = description.toLocaleLowerCase()
  if (/thunder|storm|åska|orage|onweer/.test(text)) return '⛈️'
  if (/snow|sleet|snö|neige|sneeuw/.test(text)) return '🌨️'
  if (/rain|shower|drizzle|regn|pluie|regen/.test(text)) return '🌧️'
  if (/fog|mist|dimma|brouillard|mist/.test(text)) return '🌫️'
  if (/overcast|cloud|moln|nuage|bewolkt/.test(text)) return '☁️'
  if (/clear|sun|klart|soleil|zonnig/.test(text)) return '☀️'
  const precipitation = String(outside?.precipitationType || '').toLowerCase()
  if (precipitation.includes('snow')) return '🌨️'
  if (precipitation.includes('rain')) return '🌧️'
  const cloudCover = finiteNumber(outside?.cloudCover)
  if (cloudCover !== null) return cloudCover < 0.2 ? '☀️' : cloudCover < 0.55 ? '⛅' : cloudCover < 0.85 ? '🌥️' : '☁️'
  return '🌤️'
}

function appendWindCell(row, display, subText, gustText, provider) {
  const cell = document.createElement('td')
  const main = document.createElement('span')
  main.className = 'weather-main wind-main'
  const icon = document.createElement('span')
  icon.className = 'weather-symbol'
  icon.textContent = display.symbol
  icon.setAttribute('aria-label', display.description || t('Forecast'))
  main.append(icon)
  if (display.windText !== '—') {
    const speed = document.createElement('span')
    speed.className = 'wind-speed-value'
    speed.textContent = display.windText
    main.append(speed)
  }
  if (display.directionDegrees !== null) {
    const direction = document.createElement('span')
    direction.className = 'wind-direction'
    direction.textContent = '↑'
    direction.style.transform = `rotate(${display.directionDegrees}deg)`
    direction.setAttribute('aria-label', `${t('Wind from')} ${Math.round(display.directionDegrees)}°`)
    const directionValue = document.createElement('span')
    directionValue.className = 'wind-degrees'
    directionValue.textContent = `${Math.round(display.directionDegrees)}°`
    main.append(direction, directionValue)
  }
  cell.append(main)
  if (gustText) {
    const gust = document.createElement('span')
    gust.className = 'gust-value'
    gust.textContent = gustText
    cell.append(gust)
  }
  if (subText) {
    const sub = document.createElement('span')
    sub.className = 'weather-sub'
    sub.textContent = subText
    cell.append(sub)
  }
  const source = document.createElement('span')
  source.className = 'weather-provider-name'
  source.textContent = provider
  cell.append(source)
  row.append(cell)
}

function appendCell(row, mainText, subText = '', mainClass = '') {
  const cell = document.createElement('td')
  const main = document.createElement('span')
  main.className = mainClass || 'weather-main'
  main.textContent = mainText
  cell.append(main)
  if (subText) {
    const sub = document.createElement('span')
    sub.className = 'weather-sub'
    sub.textContent = subText
    cell.append(sub)
  }
  row.append(cell)
}

function renderExtraHeaders(keys) {
  const table = elements['forecast-rows'].closest('table')
  const header = table.tHead.rows[0]
  const columns = table.querySelector('colgroup')
  for (const node of table.querySelectorAll('[data-extra-column]')) node.remove()
  for (const key of keys) {
    const col = document.createElement('col')
    col.dataset.extraColumn = key
    columns.append(col)
    const th = document.createElement('th')
    th.scope = 'col'
    th.dataset.extraColumn = key
    th.textContent = t(EXTRA_FIELDS[key][0])
    header.append(th)
  }
  table.style.setProperty('--extra-width', `${keys.length * 145}px`)
}

function extraValue(key, cached, eta) {
  const local = cached?.provider === LOCAL_GRIB
  const marine = (local ? LOCAL_MARINE_EXTRAS : MARINE_EXTRAS).includes(key)
  const records = marine ? cached?.marine : cached?.records
  if (!records?.length) return '—'
  const record = local ? closestForecast(records.filter((entry) => Number.isFinite(entry.extras?.[key])), eta, 24) : closestForecast(records, eta)
  const value = record?.extras?.[key]
  if (!Number.isFinite(value)) return '—'
  const converted = key === 'visibility' ? value / 1852 : value
  const unit = EXTRA_FIELDS[key][1]
  const number = new Intl.NumberFormat(LOCALES[state.language], { maximumFractionDigits: ['°', '%'].includes(unit) ? 0 : 1 }).format(converted)
  return unit === '°' ? `${number}°` : `${number} ${unit}`
}

function appendWindVectorCell(row, estimate) {
  const value = estimate.twsKnots !== null && estimate.twaDegrees !== null
    ? `${estimate.twsKnots.toFixed(1)} kn / ${Math.round(estimate.twaDegrees)}°`
    : '—'
  appendCell(row, value, '', 'wind-vector-value')
}

function appendWindWeightCell(row, estimate) {
  if (estimate.onboardWindPercent === null || estimate.providerWindPercent === null) {
    appendCell(row, '—', '', 'wind-weight-value')
    return
  }
  const value = `${t('Onboard short')} ${estimate.onboardWindPercent}% – ${t('Forecast short')} ${estimate.providerWindPercent}%`
  appendCell(row, value, '', 'wind-weight-value')
}

function appendEtaCell(row, estimate) {
  const cell = document.createElement('td')
  const eta = document.createElement('span')
  eta.className = 'weather-main eta-time'
  eta.textContent = estimate.eta ? formatDateTime(estimate.eta) : t('ETA unavailable')
  cell.append(eta)
  if (estimate.basis) {
    const plan = document.createElement('span')
    plan.className = 'eta-plan'
    plan.textContent = estimate.basis
    cell.append(plan)
  }
  const distance = Number.isFinite(estimate.distanceMeters) ? Math.max(0, estimate.distanceMeters / 1852) : null
  if (distance !== null) {
    const distanceLabel = document.createElement('span')
    distanceLabel.className = 'eta-distance'
    distanceLabel.textContent = `${distance.toFixed(1)} nm`
    cell.append(distanceLabel)
  }
  row.append(cell)
}

async function renderTable() {
  const route = state.selectedRoute
  if (!route) return
  const serial = ++state.renderSerial
  const routeState = progressForSelectedRoute(route)
  elements['reset-route-progress'].disabled = state.routeTracking.nextIndex === null
  const gpsLeg = gpsLegForRoute(routeState, state.position)
  const distanceFormat = new Intl.NumberFormat(LOCALES[state.language], { maximumFractionDigits: 1 })
  const formatNm = (meters) => `${distanceFormat.format(meters / 1852)} nm`
  elements['next-waypoint-values'].textContent = gpsLeg && gpsLeg.distanceMeters !== null
    ? `${formatNm(gpsLeg.distanceMeters)} / ${formatLegCourse(state.position, gpsLeg.target)}`
    : '—'
  elements['next-waypoint-target'].textContent = !gpsLeg ? '' : gpsLeg.distanceMeters === null
    ? t('GPS position unavailable') : `GPS → ${gpsLeg.target.name}`
  const estimates = await routeEstimates({ ...route, points: routeState.points }, routeState.progress)
  const rows = document.createDocumentFragment()
  const extraColumns = extraPreference('table-extras')

  for (const estimate of estimates.waypointEstimates) {
    const row = document.createElement('tr')
    row.dataset.waypointKey = JSON.stringify([route.id, estimate.index, estimate.point.latitude, estimate.point.longitude])
    if (estimate.passed) {
      row.className = 'passed'
      row.dataset.passedLabel = t('Passed suffix')
    }
    const name = document.createElement('td')
    const waypointName = document.createElement('span')
    waypointName.className = 'wp-name'
    waypointName.textContent = estimate.point.name
    const coords = document.createElement('span')
    coords.className = 'wp-coord'
    coords.textContent = formatCoordinate(estimate.point)
    name.append(waypointName, coords)
    row.append(name)

    if (estimate.passed) {
      appendCell(row, t(routeState.progress.approaching ? 'Before route entry' : 'Already passed'), '', 'pending')
    } else if (!estimate.eta) {
      appendCell(row, t('ETA unavailable'), t('Enable ETA source'), 'pending')
    } else {
      appendEtaCell(row, estimate)
    }
    const nextPoint = routeState.points[estimate.index + 1]
    const legDistance = nextPoint ? formatNm(greatCircleMeters(estimate.point, nextPoint)) : '—'
    const isGpsLeg = gpsLeg?.rowIndex === estimate.index
    const showGpsDistance = isGpsLeg && gpsLeg.distanceMeters !== null
    const gpsLabel = showGpsDistance ? `GPS → ${gpsLeg.target.name}` : isGpsLeg ? t('GPS position unavailable') : ''
    const distance = showGpsDistance ? [nextPoint ? legDistance : '', formatNm(gpsLeg.distanceMeters)].filter(Boolean).join(' / ') : legDistance
    appendCell(row, distance, gpsLabel, 'leg-distance-value')
    appendCell(row, formatLegCourse(estimate.point, nextPoint), '', 'course-value')

    if (estimate.passed) {
      appendCell(row, '—')
      appendCell(row, '—')
      appendCell(row, '—')
      appendCell(row, '—')
      appendCell(row, '—')
      appendCell(row, '—')
    } else if (!estimate.eta) {
      appendCell(row, '—')
      appendWindVectorCell(row, estimate)
      appendWindWeightCell(row, estimate)
      appendCell(row, t('Weather follows ETA'))
      appendCell(row, '—')
      appendCell(row, '—')
    } else {
      appendCell(row, estimate.speedKnots === null ? '—' : `${estimate.speedKnots.toFixed(1)} kn`, '', 'knots-value')
      appendWindVectorCell(row, estimate)
      appendWindWeightCell(row, estimate)
      const cached = state.weatherCache.get(forecastCoordinateKey(estimate.point))
      if (cached?.error) {
        appendCell(row, t('Forecast missing'), cached.error, 'pending')
        appendCell(row, '—')
        appendCell(row, '—')
      } else {
        const forecast = cached ? closestForecast(cached.records, estimate.eta.getTime(), cached.provider === LOCAL_GRIB ? 24 : 6) : null
        if (!forecast) {
          appendCell(row, cached ? t('No matching forecast') : t('Loading forecast'), '', 'pending')
          appendCell(row, '—')
          appendCell(row, '—')
        } else {
          const display = displayWeather(forecast)
          const currentText = estimate.currentAlongKnots !== null
            ? ` · ${t('Current')} ${estimate.currentAlongKnots >= 0 ? '+' : ''}${estimate.currentAlongKnots.toFixed(1)} kn ${t('Along')}${estimate.currentStation ? ` · ${t('Current station')}: ${estimate.currentDataset} / ${estimate.currentStation}${estimate.currentDistanceKm === null ? '' : ` (${estimate.currentDistanceKm.toFixed(1)} km)`}` : estimate.currentSource ? ` (${estimate.currentSource})` : ''}`
            : estimate.currentError ? ` · Strom nicht abgefragt: ${estimate.currentError}` : ''
          const provider = providerName(cached.provider, typeof forecast.source === 'string' ? forecast.source : '')
          appendWindCell(row, display, `${t('Forecast')} ${formatDateTime(new Date(forecastTime(forecast)))}${currentText}`, display.gustText, provider)
          appendCell(row, display.tempText)
          appendCell(row, display.pressureText)
        }
      }
    }
    const cached = state.weatherCache.get(forecastCoordinateKey(estimate.point))
    for (const key of extraColumns) appendCell(row, !estimate.passed && estimate.eta ? extraValue(key, cached, estimate.eta.getTime()) : '—')
    rows.append(row)
  }

  if (serial !== state.renderSerial) return
  renderExtraHeaders(extraColumns)
  const headings = elements['forecast-rows'].closest('table').tHead.rows[0].cells
  for (const row of rows.children) {
    row.classList.toggle('is-highlighted', row.dataset.waypointKey === state.highlightedWaypoint)
    for (const cell of row.cells) {
      const heading = headings[cell.cellIndex]
      cell.title = heading.title || heading.textContent.trim()
    }
  }
  elements['forecast-rows'].replaceChildren(rows)
  elements['route-title'].textContent = route.name
  renderRouteTime(route)
  elements['waypoint-count'].textContent = String(route.points.length)
  const routeMeters = route.points.slice(1).reduce((meters, point, index) => meters + greatCircleMeters(route.points[index], point), 0)
  elements['route-total-distance'].textContent = `${(routeMeters / 1852).toFixed(1)} nm`
  elements['route-distance-endpoints'].textContent = `${route.points[0].name} – ${route.points.at(-1).name}`
  elements['route-distance'].textContent = `${estimates.remainingNm.toFixed(1)} nm`
  const durationText = formatDuration(estimates.remainingDurationMs)
  elements['route-duration'].textContent = durationText
  elements['top-route-duration'].textContent = durationText
  const durationHours = estimates.remainingDurationMs / 3600000
  const averageSpeed = durationHours > 0 ? estimates.remainingNm / durationHours : NaN
  const averageSpeedText = Number.isFinite(averageSpeed) ? `${averageSpeed.toFixed(1)} kn` : '—'
  elements['route-average-speed'].textContent = averageSpeedText
  elements['top-route-average-speed'].textContent = averageSpeedText
  elements['forecast-updated'].textContent = state.weatherFetchedAt ? formatDateTime(state.weatherFetchedAt) : '—'
}

function renderEmpty(message, isError = false) {
  elements['next-waypoint-values'].textContent = '—'
  elements['next-waypoint-target'].textContent = ''
  const row = document.createElement('tr')
  row.className = isError ? 'error-row' : 'empty-row'
  const cell = document.createElement('td')
  const extraColumns = extraPreference('table-extras')
  renderExtraHeaders(extraColumns)
  cell.colSpan = 10 + extraColumns.length
  cell.textContent = message
  row.append(cell)
  elements['forecast-rows'].replaceChildren(row)
}

function parseGpx(text, fileName) {
  const xml = new DOMParser().parseFromString(text, 'application/xml')
  const root = xml.documentElement
  if (xml.doctype || root?.localName !== 'gpx' || xml.getElementsByTagNameNS('*', 'parsererror').length) throw new Error(t('GPX invalid'))

  const children = (node, name) => Array.from(node.children).filter((child) => child.localName === name && child.namespaceURI === root.namespaceURI)
  const nameOf = (node) => children(node, 'name')[0]?.textContent.trim()
  const timestamp = children(children(root, 'metadata')[0] || root, 'time')[0]?.textContent.trim()
  const baseName = fileName.replace(/\.gpx$/i, '')
  const routes = []
  function addRoute(name, nodes) {
    if (nodes.length < 2) return
    const points = nodes.map((node, index) => {
      const lat = node.getAttribute('lat')?.trim()
      const lon = node.getAttribute('lon')?.trim()
      const position = lat && lon && readPosition({ latitude: lat, longitude: lon })
      if (!position) throw new Error(t('GPX invalid'))
      return { ...position, name: nameOf(node) || String(index + 1).padStart(3, '0') }
    })
    // A stable ID lets a reimport find the same weather runs on plain HTTP too.
    let hash = 0xcbf29ce484222325n
    for (const byte of new TextEncoder().encode(JSON.stringify([name, points]))) {
      hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n)
    }
    const id = `gpx-${hash.toString(16).padStart(16, '0')}`
    if (!routes.some((route) => route.id === id)) routes.push({ id, name, points, timestamp })
  }
  const gpxRoutes = children(root, 'rte')
  gpxRoutes.forEach((route, index) => addRoute(nameOf(route) || `${baseName} · ${index + 1}`, children(route, 'rtept')))
  children(root, 'trk').forEach((track, index) => {
    const name = nameOf(track) || `${baseName} · ${gpxRoutes.length + index + 1}`
    const segments = children(track, 'trkseg')
    segments.forEach((segment, part) => addRoute(segments.length > 1 ? `${name} · ${part + 1}` : name, children(segment, 'trkpt')))
  })
  if (!routes.length) throw new Error(t('GPX no routes'))
  return { fileName, routes }
}

function gpxFiles(source = state.routeSource) {
  if (source === 'gpx-win') return state.gpxLocal.map((gpx) => ({ key: `local:${gpx.fileName}`, name: gpx.fileName, gpx }))
  if (source !== 'gpx-pi') return []
  return [
    ...state.gpxLibrary.files.map((name) => ({ key: `pi:${JSON.stringify([state.gpxLibrary.directory, name])}`, name, directory: state.gpxLibrary.directory })),
    ...(state.gpxLibrary.qtVlmTrackDirectory !== state.gpxLibrary.directory ? state.gpxLibrary.qtVlmTracks || [] : [])
      .map((name) => ({ key: `pi:${JSON.stringify([state.gpxLibrary.qtVlmTrackDirectory, name])}`, name, directory: state.gpxLibrary.qtVlmTrackDirectory }))
  ]
}

function updateGpxControls() {
  const useGpx = state.routeSource !== 'signalk'
  const usePi = state.routeSource === 'gpx-pi'
  const files = gpxFiles()
  const routes = state.gpx?.routes || []
  const picker = elements['gpx-route']
  const preferredId = localStorage.getItem(`${SETTINGS_KEY}:gpx-route`)
  picker.replaceChildren(...routes.map((route) => new Option(route.name, route.id)))
  picker.value = routes.find((route) => route.id === preferredId)?.id || routes[0]?.id || ''
  elements['route-source'].value = state.routeSource
  elements['gpx-route-picker'].hidden = !useGpx || routes.length < 2
  elements['choose-gpx'].disabled = !useGpx || (usePi ? state.gpxBusy : state.gpxImporting)
  elements['choose-gpx'].textContent = usePi ? 'GPX (Pi)' : t('Choose GPX')
  elements['gpx-file'].disabled = state.routeSource !== 'gpx-win'
  elements['gpx-status'].textContent = state.gpxError || (useGpx && !files.length ? t('Choose a GPX file') : '')
  elements['gpx-files'].replaceChildren(...(usePi ? files.filter(({ key }) => state.gpx && key === state.gpxKey) : files).map((file) => {
    if (usePi) {
      const name = document.createElement('span')
      name.textContent = file.name
      return name
    }
    const row = document.createElement('span')
    row.className = 'gpx-local-file'
    const label = document.createElement('label')
    const active = state.gpxKey === file.key
    label.className = `gpx-file-choice${active ? ' is-selected' : ''}`
    const input = document.createElement('input')
    input.type = 'radio'
    input.name = 'gpx-active-file'
    input.checked = active
    input.disabled = state.gpxImporting
    input.addEventListener('change', () => selectGpxFile(file).catch((error) => setStatus(error.message)))
    const name = document.createElement('span')
    name.textContent = file.name
    label.append(input, name)
    row.append(label, gpxDeleteButton(file))
    return row
  }))
  elements['route-select'].parentElement.classList.toggle('is-inactive', useGpx)
  elements['route-select'].disabled = useGpx || !state.routes.length
  elements['delete-route-button'].disabled = useGpx || !state.routes.length
  elements['refresh-routes-button'].disabled = useGpx || state.loadingRoutes
  renderGpxLibrary()
}

function saveLocalGpx(files) {
  localStorage.setItem(`${SETTINGS_KEY}:gpx-library`, JSON.stringify(files))
  state.gpxLocal = files
}

async function importGpxFiles(files) {
  if (!files.length || state.routeSource !== 'gpx-win' || state.gpxImporting) return
  state.gpxImporting = true
  state.gpxError = null
  updateGpxControls()
  try {
    const collection = new Map(state.gpxLocal.map((gpx) => [gpx.fileName, gpx]))
    const imported = []
    const errors = []
    for (const file of files) {
      try {
        if (file.size > 2 * 1024 * 1024) throw new Error(t('GPX too large'))
        const gpx = parseGpx(await file.text(), file.name)
        collection.set(gpx.fileName, gpx)
        imported.push(`local:${gpx.fileName}`)
      } catch (error) { errors.push(`${file.name}: ${error.message}`) }
    }
    if (imported.length) {
      saveLocalGpx([...collection.values()])
      const key = imported.includes(state.gpxKey) ? state.gpxKey : imported[0]
      if (state.routeSource === 'gpx-win') {
        await selectGpxFile(gpxFiles().find((file) => file.key === key))
      }
    }
    if (state.routeSource === 'gpx-win') state.gpxError = errors.join(' · ')
  } catch (error) {
    if (state.routeSource === 'gpx-win') state.gpxError = t('GPX failed', { error: error.message })
  } finally {
    elements['gpx-file'].value = ''
    state.gpxImporting = false
    updateGpxControls()
  }
}

async function selectGpxFile(file) {
  if (state.routeSource === 'signalk' || (file && Boolean(file.directory) !== (state.routeSource === 'gpx-pi'))) return false
  const selectionKey = `${SETTINGS_KEY}:gpx-file:${state.routeSource}`
  const request = ++state.gpxRequest
  state.gpxKey = file?.key || ''
  state.gpx = file?.gpx || null
  state.gpxError = null
  updateGpxControls()
  if (file?.directory) {
    clearSelectedRoute(t('Loading GPX file'))
    try {
      const result = await getJson(`${PLUGIN_API}/gpx-files/content?${gpxFileQuery(file)}`)
      if (request !== state.gpxRequest) return false
      state.gpx = parseGpx(result.text, file.name)
    } catch (error) {
      if (request !== state.gpxRequest) return false
      state.gpxError = t('GPX failed', { error: error.message })
      clearSelectedRoute(state.gpxError)
      updateGpxControls()
      return false
    }
  }
  if (file) localStorage.setItem(selectionKey, file.key)
  updateGpxControls()
  await selectGpxRoute()
  return Boolean(file) && request === state.gpxRequest
}

function gpxFileQuery(file) {
  return new URLSearchParams({ directory: file.directory, file: file.name })
}

function preferredGpxFile() {
  const files = gpxFiles()
  const key = state.gpxKey || localStorage.getItem(`${SETTINGS_KEY}:gpx-file:${state.routeSource}`)
  return files.find((file) => file.key === key) || (state.routeSource === 'gpx-win' ? files[0] : undefined)
}

function gpxDeleteButton(file) {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'small-button delete-button'
  button.disabled = state.gpxBusy || (!file.directory && state.gpxImporting)
  button.textContent = t('Delete')
  button.setAttribute('aria-label', `${t('Delete')} ${file.name}`)
  button.addEventListener('click', () => deleteGpxFile(file))
  return button
}

function renderGpxLibrary() {
  const files = gpxFiles('gpx-pi')
  const form = elements['gpx-directory-form']
  for (const control of form.elements) control.disabled = state.gpxBusy
  elements['gpx-library-status'].textContent = state.gpxLibraryStatus ||
    (state.routeSource === 'gpx-pi' ? state.gpxError : '') ||
    (files.length ? t('GPX file count', { count: files.length }) : t('No GPX files'))
  elements['gpx-library-files'].replaceChildren(...files.map((file) => {
    const row = document.createElement('li')
    row.className = 'gpx-pi-file'
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'small-button'
    button.disabled = state.gpxBusy
    button.textContent = file.name
    button.title = `${file.directory}/${file.name}`
    button.addEventListener('click', async () => {
      if (await selectGpxFile(file)) elements['gpx-pi-dialog'].close()
    })
    row.append(button, gpxDeleteButton(file))
    return row
  }))
}

async function withGpxLibraryUpdate(update, { reload = false } = {}) {
  if (state.gpxBusy) return
  state.gpxBusy = true
  state.gpxLibraryStatus = ''
  updateGpxControls()
  try {
    await update()
    const file = preferredGpxFile()
    if (state.routeSource !== 'signalk' &&
        (file?.key !== (state.gpxKey || undefined) || (file && (!state.gpx || (reload && file.directory))))) {
      await selectGpxFile(file)
    }
  } catch (error) {
    state.gpxLibraryStatus = t('GPX failed', { error: error.message })
  } finally {
    state.gpxBusy = false
    updateGpxControls()
  }
}

function refreshGpxLibrary(save = false) {
  return withGpxLibraryUpdate(async () => {
    const input = elements['gpx-directory']
    state.gpxLibrary = save
      ? await putJson(`${PLUGIN_API}/gpx-files`, { directory: input.value.trim() })
      : await getJson(`${PLUGIN_API}/gpx-files`)
    input.value = state.gpxLibrary.directory
  }, { reload: true })
}

function deleteGpxFile(file) {
  const name = file.directory ? `${file.directory}/${file.name}` : file.name
  if (state.gpxBusy || !window.confirm(t(file.directory ? 'Delete Pi GPX?' : 'Delete browser GPX?', { name }))) return
  return withGpxLibraryUpdate(async () => {
    if (file.directory) {
      await getJson(`${PLUGIN_API}/gpx-files?${gpxFileQuery(file)}`, { method: 'DELETE' })
      if (file.directory !== state.gpxLibrary.directory) {
        state.gpxLibrary.qtVlmTracks = state.gpxLibrary.qtVlmTracks.filter((name) => name !== file.name)
      } else state.gpxLibrary.files = state.gpxLibrary.files.filter((name) => name !== file.name)
    } else saveLocalGpx(state.gpxLocal.filter((gpx) => gpx.fileName !== file.name))
    if (state.gpxKey === file.key) {
      state.gpxRequest += 1
      state.gpx = null
      state.gpxKey = ''
      localStorage.removeItem(`${SETTINGS_KEY}:gpx-file:${state.routeSource}`)
      clearSelectedRoute(t('Choose a GPX file'))
    }
  })
}

async function selectGpxRoute() {
  if (state.routeSource === 'signalk') return
  const id = elements['gpx-route'].value
  const route = state.gpx?.routes.find((item) => item.id === id)
  if (!route) {
    clearSelectedRoute(t('Choose a GPX file'))
    return
  }
  localStorage.setItem(`${SETTINGS_KEY}:gpx-route`, id)
  await activateRoute(route)
}

async function changeRouteSource(source) {
  state.gpxRequest += 1
  state.routeSource = source
  state.gpxKey = localStorage.getItem(`${SETTINGS_KEY}:gpx-file:${source}`) || ''
  localStorage.setItem(`${SETTINGS_KEY}:route-source`, state.routeSource)
  updateGpxControls()
  if (source !== 'signalk') {
    openGpxPicker()
    await selectGpxFile(preferredGpxFile())
  }
  else if (elements['route-select'].value) await selectRoute(elements['route-select'].value)
  else {
    clearSelectedRoute(t('No suitable routes'))
    await loadRoutes()
  }
}

function openGpxPicker() {
  if (state.routeSource === 'gpx-win') {
    elements['gpx-file'].click()
  } else if (state.routeSource === 'gpx-pi') {
    elements['gpx-pi-dialog'].showModal()
  }
}

let helpRequestId = 0

async function loadHelp() {
  const language = state.language
  const content = document.getElementById('help-content')
  const status = document.getElementById('help-status')
  const requestId = ++helpRequestId
  if (content.dataset.language === language) {
    status.hidden = true
    return
  }
  content.replaceChildren()
  delete content.dataset.language
  status.textContent = t('Help loading')
  status.hidden = false
  try {
    const response = await fetch(`help/${language}.html`, { credentials: 'same-origin', cache: 'no-cache' })
    if (!response.ok) throw new Error(String(response.status))
    const html = await response.text()
    if (requestId !== helpRequestId) return
    // The language is selected from the app's four locales and the HTML is bundled with the app.
    content.innerHTML = html
    content.dataset.language = language
    status.hidden = true
  } catch (error) {
    if (requestId === helpRequestId) status.textContent = t('Help load failed', { error: error.message })
  }
}

function openHelp() {
  const dialog = elements['help-dialog']
  document.getElementById('help-version').textContent = elements['app-version'].textContent
  dialog.showModal()
  dialog.scrollTop = 0
  loadHelp()
}

function readSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || localStorage.getItem(LEGACY_SETTINGS_KEY) || '{}')
    state.settings = { ...state.settings, ...saved }
    for (const suffix of [':route', ':weather-provider']) {
      const currentKey = `${SETTINGS_KEY}${suffix}`
      const previousKey = `${LEGACY_SETTINGS_KEY}${suffix}`
      if (!localStorage.getItem(currentKey) && localStorage.getItem(previousKey)) {
        localStorage.setItem(currentKey, localStorage.getItem(previousKey))
      }
    }
    const oldInterval = finiteNumber(saved.refreshHours)
    const refreshMinutes = finiteNumber(saved.refreshMinutes) ?? (oldInterval !== null ? oldInterval * 60 : 720)
    state.settings.refreshMinutes = [15, 30, 60, 120, 180, 360, 720, 1440].includes(refreshMinutes) ? refreshMinutes : 720
  } catch (error) {
    setStatus(`Gespeicherte Einstellungen konnten nicht gelesen werden: ${error.message}`)
  }
  for (const key of ['motorSpeedKnots', 'fallbackSpeedKnots']) {
    const value = finiteNumber(state.settings[key])
    state.settings[key] = value !== null ? Math.max(0.5, Math.min(40, value)) : 5
  }
  state.language = ['de', 'nl', 'fr', 'gb'].includes(localStorage.getItem(`${SETTINGS_KEY}:language`))
    ? localStorage.getItem(`${SETTINGS_KEY}:language`)
    : 'de'
  try {
    const saved = JSON.parse(localStorage.getItem(`${SETTINGS_KEY}:gpx-library`))
    const legacy = saved === null ? JSON.parse(localStorage.getItem(`${SETTINGS_KEY}:gpx`)) : null
    state.gpxLocal = (saved || (legacy ? [legacy] : [])).filter((gpx) => typeof gpx?.fileName === 'string' && Array.isArray(gpx.routes) && gpx.routes.length)
    const source = localStorage.getItem(`${SETTINGS_KEY}:route-source`)
    const previousKey = localStorage.getItem(`${SETTINGS_KEY}:gpx-file`) || ''
    const previousSource = previousKey.startsWith('pi:') ? 'gpx-pi' : 'gpx-win'
    if (previousKey && !localStorage.getItem(`${SETTINGS_KEY}:gpx-file:${previousSource}`)) {
      localStorage.setItem(`${SETTINGS_KEY}:gpx-file:${previousSource}`, previousKey)
    }
    localStorage.removeItem(`${SETTINGS_KEY}:gpx-file`)
    state.routeSource = source === 'gpx' ? previousSource : ['gpx-win', 'gpx-pi'].includes(source) ? source : 'signalk'
    state.gpxKey = localStorage.getItem(`${SETTINGS_KEY}:gpx-file:${state.routeSource}`) || ''
  } catch (error) {
    state.gpxError = t('GPX failed', { error: error.message })
  }
  elements['language-select'].value = state.language
  elements['source-gps'].checked = Boolean(state.settings.gps)
  elements['source-engine'].checked = Boolean(state.settings.engine)
  elements['source-stw'].checked = Boolean(state.settings.stw)
  elements['source-current'].checked = Boolean(state.settings.current)
  elements['source-polar'].checked = Boolean(state.settings.polar)
  elements['source-forecast-wind'].checked = Boolean(state.settings.forecastWind)
  elements['source-own-wind'].checked = Boolean(state.settings.ownWind)
  elements['source-heading'].checked = Boolean(state.settings.useHeading)
  elements['speed-input'].value = String(state.settings.fallbackSpeedKnots)
  elements['motor-speed-input'].value = String(state.settings.motorSpeedKnots)
  elements['motor-speed-input'].disabled = !state.settings.engine
  const radius = state.settings.waypointRadiusMeters
  state.settings.waypointRadiusMeters = Number.isInteger(radius) && radius >= 0 && radius <= 2000 ? radius : 100
  elements['waypoint-radius'].value = String(state.settings.waypointRadiusMeters)
  const windReachLevel = state.settings.windReachLevel
  state.settings.windReachLevel = Number.isInteger(windReachLevel) && windReachLevel >= 1 && windReachLevel <= WIND_REACH_LEVELS.length
    ? windReachLevel
    : DEFAULT_WIND_REACH_LEVEL
  elements['wind-reach'].value = String(state.settings.windReachLevel)
  elements['route-title'].textContent = t('No route selected')
  renderRouteTime(null)
  applyTranslations()
}

function saveLocalSettings() {
  state.settings.gps = elements['source-gps'].checked
  state.settings.engine = elements['source-engine'].checked
  elements['motor-speed-input'].disabled = !state.settings.engine
  state.settings.stw = elements['source-stw'].checked
  state.settings.current = elements['source-current'].checked
  state.settings.polar = elements['source-polar'].checked
  state.settings.forecastWind = elements['source-forecast-wind'].checked
  state.settings.ownWind = elements['source-own-wind'].checked || (elements['source-own-wind'].disabled && state.settings.ownWind)
  state.settings.useHeading = elements['source-heading'].checked || (elements['source-heading'].disabled && state.settings.useHeading)
  if (state.settings.engine) state.settings.motorSpeedKnots = Math.max(0.5, Math.min(40, finiteNumber(elements['motor-speed-input'].value) || 5))
  state.settings.fallbackSpeedKnots = Math.max(0.5, Math.min(40, finiteNumber(elements['speed-input'].value) || 5))
  state.settings.polarId = elements['polar-select'].value || state.settings.polarId
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings))
  if (state.selectedRoute) renderTable()
}

async function loadRoutes(options = {}) {
  if (state.routeLoadPromise) return state.routeLoadPromise
  const pending = loadRoutesOnce(options)
  state.routeLoadPromise = pending
  try {
    return await pending
  } finally {
    if (state.routeLoadPromise === pending) state.routeLoadPromise = null
  }
}

async function loadRoutesOnce({ quiet = false } = {}) {
  state.loadingRoutes = true
  const previousRoutes = state.routes
  const previousSelectedId = elements['route-select'].value || localStorage.getItem(`${SETTINGS_KEY}:route`)
  elements['refresh-routes-button'].disabled = true
  elements['refresh-routes-button'].classList.add('is-loading')
  let routeToSelect = null
  let resultStatus = ''
  let fetchSucceeded = false
  try {
    const url = `${API_ROOT}/resources/routes`
    const routes = unpackRoutes(await getJson(url, { timeoutMs: 10000 }))
    fetchSucceeded = true
    const sortedRoutes = routes.sort((a, b) => a.name.localeCompare(b.name, LOCALES[state.language]))
    const oldById = new Map(previousRoutes.map((route) => [route.id, route]))
    const added = sortedRoutes.filter((route) => !oldById.has(route.id))
    const removed = previousRoutes.filter((route) => !sortedRoutes.some((current) => current.id === route.id))
    const selectedChanged = sortedRoutes.some((route) => route.id === previousSelectedId && JSON.stringify(route) !== JSON.stringify(oldById.get(route.id)))
    state.routes = sortedRoutes
    const usingSignalK = state.routeSource === 'signalk'
    elements['route-select'].replaceChildren()
    if (state.routes.length === 0) {
      const option = document.createElement('option')
      option.value = ''
      option.textContent = t('No routes found')
      elements['route-select'].append(option)
      if (usingSignalK) {
        clearSelectedRoute(t('No suitable routes'))
        if (!quiet) resultStatus = t('No suitable routes')
      }
    } else {
      for (const route of state.routes) {
        const option = document.createElement('option')
        option.value = route.id
        option.textContent = routeLabel(route)
        elements['route-select'].append(option)
      }
      const selected = state.routes.find((route) => route.id === previousSelectedId) || state.routes[0]
      elements['route-select'].value = selected.id
      if (usingSignalK && (selected.id !== state.selectedRoute?.id || selectedChanged)) {
        routeToSelect = { id: selected.id }
      }
      if (usingSignalK && !quiet) {
        const details = [
          added.length ? `${added.length} neue Route(n)` : '',
          removed.length ? `${removed.length} entfernte Route(n)` : ''
        ].filter(Boolean).join(', ')
      resultStatus = details ? `Routenliste aktualisiert: ${details} gefunden. Die aktuelle Auswahl bleibt erhalten.` : t('Routes updated')
      } else if (usingSignalK && added.length) {
        resultStatus = t('New routes found', { count: added.length })
      }
    }
  } catch (error) {
    if (state.routeSource === 'signalk') {
      resultStatus = t('Route refresh failed', { error: error.message })
      if (!previousRoutes.length) renderEmpty(resultStatus, true)
    }
  } finally {
    state.loadingRoutes = false
    elements['refresh-routes-button'].classList.remove('is-loading')
    updateGpxControls()
  }
  if (resultStatus) setStatus(resultStatus)
  if (routeToSelect) await selectRoute(routeToSelect.id)
  return fetchSucceeded
}

async function selectRoute(id) {
  if (state.routeSource !== 'signalk') return
  const route = state.routes.find((item) => item.id === id)
  if (!route) return
  localStorage.setItem(`${SETTINGS_KEY}:route`, id)
  await activateRoute(route)
}

function clearRouteWeather() {
  state.weatherRequestId += 1
  state.renderSerial += 1
  state.snapshotRequestId += 1
  state.activeSnapshot = null
  state.weatherCache.clear()
  renderExtraPickers()
  state.weatherFetchedAt = null
  state.snapshots = []
  state.selectedSnapshotId = ''
  elements['snapshot-select'].replaceChildren(new Option(t('No saved weather runs'), ''))
  elements['snapshot-select'].disabled = true
  elements['delete-snapshot-button'].disabled = true
  updateSnapshotPager()
  updateSnapshotMeta()
  elements['forecast-updated'].textContent = '—'
}

function clearSelectedRoute(message) {
  clearRouteWeather()
  state.selectedRoute = null
  elements['route-title'].textContent = t('No route selected')
  renderRouteTime(null)
  elements['reset-route-progress'].disabled = true
  elements['refresh-button'].disabled = true
  for (const id of ['waypoint-count', 'route-total-distance', 'route-distance', 'route-duration', 'route-average-speed', 'top-route-duration', 'top-route-average-speed']) elements[id].textContent = '—'
  elements['route-distance-endpoints'].textContent = ''
  showWeatherProgress(null)
  renderEmpty(message)
}

async function activateRoute(route) {
  clearRouteWeather()
  const requestId = state.weatherRequestId
  state.selectedRoute = route
  updateGribControls()
  elements['route-title'].textContent = routeLabel(route)
  renderRouteTime(route)
  elements['waypoint-count'].textContent = String(route.points.length)
  elements['route-distance'].textContent = 'Berechne …'
  elements['route-total-distance'].textContent = '—'
  elements['route-distance-endpoints'].textContent = ''
  elements['route-duration'].textContent = '—'
  elements['route-average-speed'].textContent = '—'
  elements['top-route-duration'].textContent = '—'
  elements['top-route-average-speed'].textContent = '—'
  renderEmpty(t('Loading route weather'))
  showWeatherProgress('Local weather')
  try {
    await loadWeatherSnapshots(route.id)
    if (requestId === state.weatherRequestId) showWeatherProgress(null)
  } catch (error) {
    if (requestId === state.weatherRequestId) {
      showWeatherProgress('Local weather error', {}, null, null, true)
      setStatus(`Gespeicherte Wetterläufe konnten nicht geladen werden: ${error.message}`)
    }
  }
  await refreshNavigation()
  if (state.selectedRoute !== route) return
  await probeCurrentSource(route.points[0])
  if (state.selectedRoute !== route) return
  loadCurrentDatasetCoverage(route).catch((error) => {
    elements['current-datasets-status'].textContent = t('Current folder check failed', { error: error.message })
  })
  await renderTable()
}

async function refreshPage() {
  const button = elements['refresh-button']
  const route = state.selectedRoute
  const provider = state.weatherProvider
  if (!route || button.disabled) return
  if (!provider) { setStatus(t('No provider selected')); return }
  document.getElementById('download-extras').open = false
  const requestId = ++state.weatherRequestId
  state.snapshotRequestId += 1
  state.activeSnapshot = null
  state.weatherFetchedAt = null
  state.weatherCache.clear()
  showDownloadSize(null)
  button.disabled = true
  button.classList.add('is-loading')
  updateGribControls()
  renderStoredGribs()
  try {
    const [result] = await Promise.all([loadRouteForecasts(route, provider, requestId), refreshNavigation()])
    if (!result || requestId !== state.weatherRequestId) return
    renderExtraPickers()
    await renderTable()
    if (requestId !== state.weatherRequestId) return
    const points = result.missing.map((point) => point.name).join(', ')
    const firstError = result.missing.length === route.points.length
      ? result.missing.map((point) => cachedForecast(point, provider)?.error).find(Boolean)
      : null
    const message = () => {
      const completeLabel = provider === LOCAL_GRIB ? 'GRIB evaluation complete' : 'Weather complete'
      const summary = points ? t('Missing waypoint weather', { points }) : t(completeLabel)
      const withoutMarine = result.withoutMarine
      const marineError = withoutMarine.map((point) => cachedForecast(point, provider)?.marineError).find(Boolean)
      const marineMessage = withoutMarine.length ? `${t('Marine data unavailable')} (${withoutMarine.length})${marineError ? ` · ${marineError}` : ''}` : ''
      const extraMessage = result.missingExtras.length ? `${t('No extra data available')}: ${result.missingExtras.map((field) => t(EXTRA_FIELDS[field][0])).join(', ')}` : ''
      return result.rateLimited ? `${t('Weather rate limit stopped')} ${summary}` : [summary, firstError, marineMessage, extraMessage].filter(Boolean).join(' · ')
    }
    showWeatherProgress(message, {}, null, null, true)
    setStatus(message())
  } catch (error) {
    if (requestId === state.weatherRequestId) {
      showWeatherProgress(error.message, {}, null, null, true)
      setStatus(error.message)
    }
  } finally {
    button.classList.remove('is-loading')
    updateGribControls()
    renderStoredGribs()
  }
}

function readPosition(value) {
  const normalized = unwrap(value)
  if (normalized?.latitude == null || normalized?.longitude == null) return null
  const latitude = finiteNumber(normalized?.latitude)
  const longitude = finiteNumber(normalized?.longitude)
  return latitude !== null && longitude !== null && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180
    ? { latitude, longitude }
    : null
}

async function refreshNavigation() {
  if (state.navigationRefreshPromise) return state.navigationRefreshPromise
  const pending = refreshNavigationOnce()
  state.navigationRefreshPromise = pending
  try {
    await pending
  } finally {
    if (state.navigationRefreshPromise === pending) state.navigationRefreshPromise = null
  }
}

async function refreshNavigationOnce() {
  const requests = await Promise.allSettled([
    getJson(`${API_V1}/vessels/self/navigation/position`),
    getJson(`${API_V1}/vessels/self/navigation/speedOverGround`),
    getJson(`${API_V1}/vessels/self/navigation/speedThroughWater`),
    getJson(`${API_V1}/vessels/self/navigation/courseOverGroundTrue`),
    getJson(`${API_V1}/vessels/self/environment/wind/speedTrue`),
    getJson(`${API_V1}/vessels/self/environment/wind/directionTrue`),
    getJson(`${API_V1}/vessels/self/environment/wind/speedApparent`),
    getJson(`${API_V1}/vessels/self/environment/wind/angleApparent`),
    getJson(`${API_V1}/vessels/self/navigation/headingTrue`),
    getJson(`${API_ROOT}/vessels/self/navigation/course`)
  ])
  state.navigationCourse = requests[9].status === 'fulfilled' ? unwrap(requests[9].value) : null
  state.position = requests[0].status === 'fulfilled' ? readPosition(requests[0].value) : null
  updateGpsRouteProgress()
  const sog = requests[1].status === 'fulfilled' ? unwrap(requests[1].value) : null
  const stw = requests[2].status === 'fulfilled' ? unwrap(requests[2].value) : null
  state.sogMps = typeof sog === 'number' && Number.isFinite(sog) && sog >= 0 ? sog : null
  state.stwMps = typeof stw === 'number' && Number.isFinite(stw) && stw >= 0 ? stw : null
  const cogRadians = requests[3].status === 'fulfilled' ? readSignalKMeasurement(requests[3].value).value : null
  state.cogDegrees = cogRadians === null ? null : (cogRadians * 180 / Math.PI + 360) % 360
  const headingRadians = requests[8].status === 'fulfilled' ? readSignalKMeasurement(requests[8].value).value : null
  state.headingDegrees = headingRadians === null ? null : (headingRadians * 180 / Math.PI + 360) % 360
  const trueSpeedMeasurement = requests[4].status === 'fulfilled' ? readSignalKMeasurement(requests[4].value) : { value: null, source: null }
  const trueDirectionMeasurement = requests[5].status === 'fulfilled' ? readSignalKMeasurement(requests[5].value) : { value: null, source: null }
  const directWindSpeed = trueSpeedMeasurement.value
  const directWindDirection = trueDirectionMeasurement.value
  const directWindSourcesMatch = !trueSpeedMeasurement.source || !trueDirectionMeasurement.source || trueSpeedMeasurement.source === trueDirectionMeasurement.source
  let trueWind = directWindSpeed !== null && directWindSpeed >= 0 && directWindDirection !== null && directWindSourcesMatch
    ? { eastMps: -directWindSpeed * Math.sin(directWindDirection), northMps: -directWindSpeed * Math.cos(directWindDirection), source: t('Signal K true wind') }
    : null
  const windInputMissing = []
  const apparentSpeed = requests[6].status === 'fulfilled' ? readSignalKMeasurement(requests[6].value).value : null
  if (!trueWind) {
    const apparentAngle = requests[7].status === 'fulfilled' ? readSignalKMeasurement(requests[7].value).value : null
    const throughWaterSpeed = state.stwMps
    const speedOverGround = state.sogMps
    const vesselSpeed = throughWaterSpeed ?? speedOverGround
    const headingAvailable = state.headingDegrees !== null
    const useHeading = state.settings.useHeading && headingAvailable
    const windReferenceCourse = useHeading ? state.headingDegrees : state.cogDegrees
    const vesselCourse = throughWaterSpeed !== null ? windReferenceCourse : state.cogDegrees
    if (apparentSpeed !== null && apparentSpeed >= 0 && apparentAngle !== null && vesselSpeed !== null && windReferenceCourse !== null && vesselCourse !== null) {
      const apparentFrom = (windReferenceCourse + apparentAngle * 180 / Math.PI) * Math.PI / 180
      const vesselCourseRadians = vesselCourse * Math.PI / 180
      const trueEast = -apparentSpeed * Math.sin(apparentFrom) + vesselSpeed * Math.sin(vesselCourseRadians)
      const trueNorth = -apparentSpeed * Math.cos(apparentFrom) + vesselSpeed * Math.cos(vesselCourseRadians)
      const trueSpeed = Math.hypot(trueEast, trueNorth)
      const source = throughWaterSpeed !== null
        ? (useHeading ? t('AWS/AWA with STW and heading') : t('AWS/AWA with STW and COG'))
        : t('AWS/AWA with SOG and COG')
      trueWind = { eastMps: trueEast, northMps: trueNorth, source }
    }
    if (apparentSpeed === null || apparentSpeed < 0) windInputMissing.push('environment.wind.speedApparent (AWS)')
    if (apparentAngle === null) windInputMissing.push('environment.wind.angleApparent (AWA)')
    if (vesselSpeed === null) windInputMissing.push('navigation.speedThroughWater / navigation.speedOverGround')
    if (windReferenceCourse === null || vesselCourse === null) windInputMissing.push(state.settings.useHeading
      ? 'navigation.headingTrue oder navigation.courseOverGroundTrue'
      : 'navigation.courseOverGroundTrue')
    if (directWindSpeed !== null && directWindDirection === null) windInputMissing.push('environment.wind.directionTrue (TWD)')
    if (!directWindSourcesMatch && directWindSpeed !== null && directWindDirection !== null) {
      windInputMissing.push(`TWS/TWD stammen aus verschiedenen Quellen (${trueSpeedMeasurement.source} / ${trueDirectionMeasurement.source})`)
    }
  }
  if (trueWind) {
    const speedMps = Math.hypot(trueWind.eastMps, trueWind.northMps)
    const fromDegrees = (Math.atan2(-trueWind.eastMps, -trueWind.northMps) * 180 / Math.PI + 360) % 360
    state.ownWind = { speedKnots: speedMps * MS_TO_KNOTS, directionDegrees: fromDegrees, source: trueWind.source }
  } else state.ownWind = null
  elements['source-own-wind'].disabled = !state.ownWind
  elements['source-own-wind'].checked = Boolean(state.ownWind && state.settings.ownWind)
  elements['source-heading'].disabled = state.headingDegrees === null
  elements['source-heading'].checked = Boolean(state.settings.useHeading && state.headingDegrees !== null)
  elements['heading-status'].textContent = state.headingDegrees === null ? t('Heading missing COG fallback') : t('Heading available')
  elements['own-wind-status'].textContent = state.ownWind
    ? t('Onboard wind available', { speed: state.ownWind.speedKnots.toFixed(1), direction: Math.round(state.ownWind.directionDegrees), source: state.ownWind.source })
    : [
        apparentSpeed !== null && apparentSpeed >= 0 ? t('AWS reading', { speed: (apparentSpeed * MS_TO_KNOTS).toFixed(1) }) : '',
        t('Onboard wind missing inputs', { inputs: windInputMissing.join(', ') || 'TWS + directionTrue' })
      ].filter(Boolean).join(' · ')
  if (state.settings.gps && !state.position) setStatus(t('GPS missing'))
  else if (!state.settings.gps && !state.settings.engine && !state.settings.stw && !state.settings.polar) {
    setStatus(t('No ETA source'))
  }
}

async function probeCurrentSource(point) {
  try {
    let probePoint = point
    if (state.selectedRoute && state.settings.currentDirectory) {
      const routePoints = state.selectedRoute.points.map(({ latitude, longitude }) => ({ latitude, longitude }))
      const coverageQuery = new URLSearchParams({ points: JSON.stringify(routePoints) })
      const coverage = await getJson(`${PLUGIN_API}/current-datasets?${coverageQuery}`)
      const coveredIndex = coverage.routeMatches.findIndex((match) => match && match.distanceKm <= 15)
      if (coveredIndex >= 0) probePoint = state.selectedRoute.points[coveredIndex]
    }
    const query = new URLSearchParams({ latitude: String(probePoint.latitude), longitude: String(probePoint.longitude), time: new Date().toISOString() })
    const data = await getJson(`${PLUGIN_API}/currents/predict?${query}`)
    const current = currentComponents(data)
    if (!current) throw new Error('API lieferte keinen erkennbaren Ost-/Nordvektor')
    state.currentAvailable = true
    elements['source-current'].disabled = false
    elements['current-status'].textContent = t('Current available', { source: `${data.dataset} / ${data.station} (${data.distanceKm.toFixed(1)} km)` })
  } catch (error) {
    state.currentAvailable = false
    state.settings.current = false
    elements['source-current'].checked = false
    elements['source-current'].disabled = true
    elements['current-status'].textContent = t('Current source unavailable', { error: error.message })
  }
}

async function loadPolarSettings() {
  try {
    const settings = await getJson(`${PLUGIN_API}/settings`)
    state.settings.polarDirectory = settings.polarDirectory || ''
    state.settings.currentDirectory = settings.currentDirectory || ''
    elements['polar-directory'].value = state.settings.polarDirectory
    elements['current-directory'].value = state.settings.currentDirectory
    await loadPolarFiles()
    if (state.selectedRoute) {
      await probeCurrentSource(state.selectedRoute.points[0])
      await loadCurrentDatasetCoverage(state.selectedRoute)
    }
  } catch (error) {
    elements['polar-status'].textContent = `LTC-Polarzugriff nicht verfügbar: ${error.message}`
  }
}

async function loadCurrentDatasetCoverage(route = state.selectedRoute) {
  if (!state.settings.currentDirectory || !route) return
  const points = route.points.map(({ latitude, longitude }) => ({ latitude, longitude }))
  const query = new URLSearchParams({ points: JSON.stringify(points) })
  const result = await getJson(`${PLUGIN_API}/current-datasets?${query}`)
  if (!result.configured || !result.datasets.length) {
    elements['current-datasets-status'].textContent = t('No current pairs')
    return
  }
  const nearest = result.datasets[0]
  const covered = result.routeMatches.filter((match) => match && match.distanceKm <= 15).length
  const areas = [...new Set(result.routeMatches.filter(Boolean).map((match) => match.datasetName))].join(', ')
  elements['current-datasets-status'].textContent = t('Current coverage', { datasets: result.datasets.length, best: nearest.name, covered, total: route.points.length, areas })
}

async function saveCurrentDirectory() {
  const button = elements['save-current-directory']
  button.disabled = true
  try {
    const saved = await putJson(`${PLUGIN_API}/settings`, {
      polarDirectory: elements['polar-directory'].value.trim(),
      currentDirectory: elements['current-directory'].value.trim()
    })
    state.settings.currentDirectory = saved.currentDirectory
    if (state.selectedRoute) {
      await loadCurrentDatasetCoverage()
      await probeCurrentSource(state.selectedRoute.points[0])
    }
    setStatus(t('Current folder checked'))
  } catch (error) {
    elements['current-datasets-status'].textContent = t('Current path invalid', { error: error.message })
    setStatus(t('Current path rejected', { error: error.message }))
  } finally {
    button.disabled = false
  }
}

async function loadPolarFiles() {
  const result = await getJson(`${PLUGIN_API}/polars`)
  state.polarFiles = result.files || []
  state.polarWarnings = result.warnings || []
  elements['polar-select'].replaceChildren()
  if (!result.configured) {
    const option = document.createElement('option')
    option.value = ''
    option.textContent = 'Zuerst Polardaten-Ordner konfigurieren'
    elements['polar-select'].append(option)
    elements['polar-select'].disabled = true
    elements['source-polar'].disabled = true
    elements['polar-status'].textContent = 'Serverordner ist noch nicht gesetzt.'
    return
  }
  if (state.polarFiles.length === 0) {
    const option = document.createElement('option')
    option.value = ''
    option.textContent = 'Keine gültige LTC-Polar gefunden'
    elements['polar-select'].append(option)
    elements['polar-select'].disabled = true
    elements['source-polar'].disabled = true
    elements['polar-status'].textContent = state.polarWarnings.length
      ? `Ordner lesbar, ${state.polarWarnings.length} Datei(en) haben ein nicht unterstütztes Format.`
      : 'Ordner lesbar, aber noch keine gespeicherte eigene LTC-Polar gefunden.'
    return
  }
  for (const polar of state.polarFiles) {
    const option = document.createElement('option')
    option.value = polar.id
    option.textContent = `${polar.name}${polar.boatType ? ` · ${polar.boatType}` : ''}`
    elements['polar-select'].append(option)
  }
  elements['polar-select'].disabled = false
  elements['source-polar'].disabled = false
  const preferred = state.polarFiles.find((polar) => polar.id === state.settings.polarId) || state.polarFiles[0]
  elements['polar-select'].value = preferred.id
  await selectPolar(preferred.id)
  elements['polar-status'].textContent = `${state.polarFiles.length} LTC-Polar(en) gefunden. Windwinkel und TWS müssen in der Polare abgedeckt sein.`
}

async function selectPolar(id) {
  if (!id) {
    state.polar = null
    return
  }
  const selected = await getJson(`${PLUGIN_API}/polars/${encodeURIComponent(id)}`)
  if (!selected.vpp || !Array.isArray(selected.vpp.speeds) || !Array.isArray(selected.vpp.angles)) {
    throw new Error('LTC-Datei enthält keine gültige VPP-Polartabelle')
  }
  state.polar = selected
  state.settings.polarId = id
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings))
  if (state.selectedRoute) await renderTable()
}

async function savePolarDirectory() {
  elements['save-polar-directory'].disabled = true
  try {
    const saved = await putJson(`${PLUGIN_API}/settings`, { polarDirectory: elements['polar-directory'].value.trim() })
    state.settings.polarDirectory = saved.polarDirectory
    await loadPolarFiles()
    setStatus('LTC-Polardaten-Ordner geprüft und übernommen.')
  } catch (error) {
    setStatus(`Polardaten-Ordner nicht übernommen: ${error.message}`)
  } finally {
    elements['save-polar-directory'].disabled = false
  }
}

function bindEvents() {
  elements['forecast-rows'].addEventListener('click', (event) => {
    const row = event.target.closest('tr[data-waypoint-key]')
    if (!row) return
    const previous = elements['forecast-rows'].querySelector('.is-highlighted')
    const selected = previous !== row
    previous?.classList.remove('is-highlighted')
    row.classList.toggle('is-highlighted', selected)
    state.highlightedWaypoint = selected ? row.dataset.waypointKey : null
  })
  document.addEventListener('click', (event) => {
    for (const picker of document.querySelectorAll('.extra-picker[open]')) {
      if (!picker.contains(event.target) && event.target !== elements['weather-provider-select']) picker.open = false
    }
  })
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return
    const picker = event.target.closest?.('.extra-picker[open]')
    if (!picker) return
    picker.open = false
    picker.querySelector('summary').focus()
  })
  elements['open-help'].addEventListener('click', openHelp)
  elements['choose-gpx'].addEventListener('click', openGpxPicker)
  elements['gpx-file'].addEventListener('change', (event) => importGpxFiles(Array.from(event.target.files)))
  elements['gpx-route'].addEventListener('change', () => selectGpxRoute().catch((error) => setStatus(error.message)))
  elements['route-source'].addEventListener('change', (event) => changeRouteSource(event.target.value).catch((error) => setStatus(error.message)))
  elements['gpx-directory-form'].addEventListener('submit', (event) => { event.preventDefault(); refreshGpxLibrary(true) })
  elements['reload-gpx-library'].addEventListener('click', () => refreshGpxLibrary())
  elements['waypoint-radius'].addEventListener('input', updateWaypointRadiusLabel)
  elements['waypoint-radius'].addEventListener('change', () => {
    state.settings.waypointRadiusMeters = Number(elements['waypoint-radius'].value)
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings))
    updateGpsRouteProgress(true)
    if (state.selectedRoute) renderTable()
  })
  elements['reset-route-progress'].addEventListener('click', resetGpsRouteProgress)
  elements['wind-reach'].addEventListener('input', updateWindReachLabel)
  elements['wind-reach'].addEventListener('change', () => {
    state.settings.windReachLevel = elements['wind-reach'].valueAsNumber
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings))
    if (state.selectedRoute) renderTable()
  })
  elements['route-select'].addEventListener('change', (event) => selectRoute(event.target.value))
  elements['refresh-routes-button'].addEventListener('click', () => loadRoutes().catch((error) => setStatus(`Routenaktualisierung fehlgeschlagen: ${error.message}`)))
  elements['delete-route-button'].addEventListener('click', () => openDeleteDialog('routes'))
  elements['snapshot-select'].addEventListener('change', async (event) => {
    const requestId = ++state.weatherRequestId
    showWeatherProgress('Local weather')
    try {
      await restoreWeatherSnapshot(event.target.value)
      if (requestId === state.weatherRequestId) showWeatherProgress(null)
    } catch (error) {
      if (requestId !== state.weatherRequestId) return
      showWeatherProgress('Local weather error', {}, null, null, true)
      setStatus(error.message)
    }
  })
  elements['delete-snapshot-button'].addEventListener('click', () => openDeleteDialog('snapshots'))
  const deleteDialog = document.getElementById('delete-dialog')
  deleteDialog.addEventListener('change', updateDeleteConfirm)
  deleteDialog.addEventListener('cancel', (event) => {
    if (deleteDialog.dataset.busy === 'true') event.preventDefault()
  })
  document.getElementById('delete-cancel').addEventListener('click', () => deleteDialog.close())
  document.getElementById('delete-form').addEventListener('submit', deleteSelected)
  elements['language-select'].addEventListener('change', (event) => {
    state.language = ['de', 'nl', 'fr', 'gb'].includes(event.target.value) ? event.target.value : 'de'
    localStorage.setItem(`${SETTINGS_KEY}:language`, state.language)
    applyTranslations()
    renderProviderCards()
    setPage(Number(localStorage.getItem(`${SETTINGS_KEY}:page`)) || 1)
    updateSnapshotPager()
    updateSnapshotMeta()
    renderInternetStatus()
    setStatus(t('Status help'))
    if (!state.selectedRoute) elements['route-title'].textContent = t('No route selected')
    refreshNavigation().then(() => state.selectedRoute ? renderTable() : undefined)
    if (state.selectedRoute) probeCurrentSource(state.selectedRoute.points[0])
    loadPolarFiles().catch((error) => setStatus(error.message))
  })
  elements['weather-provider-select'].addEventListener('change', (event) => {
    if (elements['refresh-button'].classList.contains('is-loading')) {
      state.weatherRequestId += 1
      showWeatherProgress(null)
    }
    state.weatherProvider = event.target.value
    updateGribControls()
    renderExtraPickers()
    document.getElementById('download-extras').open = Boolean(state.weatherProvider)
    localStorage.setItem(`${SETTINGS_KEY}:weather-provider`, state.weatherProvider)
    if (state.weatherProvider === LOCAL_GRIB && selectedLocalGrib()) setStatus(t('GRIB selected', { name: selectedLocalGrib().name }))
    else if (state.weatherProvider) setStatus(t(state.weatherProvider === LOCAL_GRIB ? 'Load GRIB file' : 'Fetch weather manually'))
  })

  elements['open-grib'].addEventListener('click', () => {
    elements['grib-status'].textContent = ''
    elements['grib-dialog'].showModal()
    refreshGribLibrary().catch((error) => { elements['grib-status'].textContent = error.message })
  })
  elements['grib-existing-form'].addEventListener('submit', (event) => {
    event.preventDefault()
    selectLocalGrib(state.gribLibrary.files.find(({ id }) => id === elements['grib-existing'].value))
  })
  elements['grib-browse'].addEventListener('click', () => elements['grib-upload'].click())
  elements['grib-upload'].addEventListener('change', (event) => {
    const file = event.target.files[0]
    event.target.value = ''
    if (file) loadGribFrom(() => uploadGrib(file))
  })
  for (const [id, values] of [
    ['grib-path-form', () => ({ filePath: elements['grib-path'].value.trim() })],
    ['grib-source-form', () => ({ sourceId: elements['grib-source'].value })],
    ['grib-url-form', () => ({ url: elements['grib-url'].value.trim(), sourceName: elements['grib-source-name'].value.trim() })]
  ]) {
    elements[id].addEventListener('submit', (event) => {
      event.preventDefault()
      const payload = values()
      loadGribFrom(() => postJson(`${PLUGIN_API}/local-grib`, payload))
    })
  }
  elements['qtvlm-enable'].addEventListener('change', async (event) => {
    const input = event.target
    input.disabled = true
    try {
      await putJson(`${PLUGIN_API}/qtvlm`, { enabled: input.checked })
      await refreshQtVlm()
    } catch (error) {
      input.checked = !input.checked
      elements['qtvlm-status'].textContent = error.message
    } finally {
      input.disabled = false
    }
  })
  elements['hide-raster-providers'].addEventListener('change', () => loadWeatherProviders().catch((error) => setStatus(error.message)))
  for (const button of document.querySelectorAll('[data-page-action]')) {
    button.addEventListener('click', () => setPage(button.dataset.pageAction === 'next' ? 2 : 1))
  }
  elements['provider-cards'].addEventListener('click', (event) => {
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    const saveId = target.dataset.saveCredential
    const deleteId = target.dataset.deleteCredential
    if (saveId) saveProviderCredential(saveId).catch((error) => setStatus(t('Credentials failed', { error: error.message })))
    if (deleteId) deleteProviderCredential(deleteId).catch((error) => setStatus(t('Credential delete failed', { error: error.message })))
    if (target.dataset.saveMetNoContact) saveMetNoContact().catch((error) => setStatus(t('Credentials failed', { error: error.message })))
  })
  elements['delete-raster-cache'].addEventListener('click', () => deleteRasterCache())
  elements['refresh-button'].addEventListener('click', refreshPage)
  elements['save-polar-directory'].addEventListener('click', savePolarDirectory)
  elements['save-current-directory'].addEventListener('click', saveCurrentDirectory)
  elements['polar-select'].addEventListener('change', (event) => {
    selectPolar(event.target.value).then(() => {
      saveLocalSettings()
      if (state.selectedRoute) renderTable()
    }).catch((error) => setStatus(`LTC-Polar konnte nicht geladen werden: ${error.message}`))
  })
  for (const element of [elements['source-gps'], elements['source-engine'], elements['source-stw'], elements['source-current'], elements['source-polar'], elements['source-forecast-wind'], elements['source-own-wind'], elements['source-heading'], elements['speed-input'], elements['motor-speed-input']]) {
    element.addEventListener('change', saveLocalSettings)
  }
  elements['source-heading'].addEventListener('change', () => {
    refreshNavigation().then(() => state.selectedRoute ? renderTable() : undefined)
  })
  document.querySelector('.eta-panel').addEventListener('toggle', saveLocalSettings)
}

readSettings()
state.localGribId = localStorage.getItem(`${SETTINGS_KEY}:local-grib`) || ''
bindEvents()
refreshGribLibrary().catch((error) => setStatus(error.message))
refreshQtVlm()
setInterval(refreshQtVlm, 4000)
refreshGpxLibrary().then(() => {
  if (state.routeSource !== 'signalk' && !state.gpx && !state.gpxError) return selectGpxFile(preferredGpxFile())
}).catch((error) => setStatus(error.message))
setPage(Number(localStorage.getItem(`${SETTINGS_KEY}:page`)) || 1)
renderProviderCards()
renderInternetStatus()
checkInternet()
setInterval(checkInternet, 60000)
window.addEventListener('online', checkInternet)
window.addEventListener('offline', checkInternet)
loadAppVersionAndStorage().catch((error) => setStatus(`Versions-/Speicherinfo konnte nicht geladen werden: ${error.message}`))
loadProviderSettings().catch((error) => {
  setStatus(`Providerzugang konnte nicht geladen werden: ${error.message}`)
})
loadWeatherProviders().then(() => Promise.all([loadRoutes(), loadPolarSettings()])).catch((error) => {
  setStatus(error.message)
})
setInterval(async () => {
  await refreshNavigation()
  if (state.selectedRoute) await renderTable()
}, 60 * 1000)
