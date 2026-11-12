## **LTC\_Ocpn\_Route\_Importer   v.1.1.25**

Multi De, NL, GB, FR

Download: https://github.com/SignalKuser?tab=repositories

## **Requirements:**



OpenCPN 32Bit Version Windows
Signal K, Raspberry Pi ARM64



##### **Signal K Vorbereitung:**



Das Signal K Plugin (LTC\_Ocpn\_Route\_Importer) kann kann lokale GPX Dateien verwenden, die auf Windows oder Raspberry liegen.

Eleganter ist allerdings, die Route in OpenCPN zu zeichnen und dann "on the fly" an Signal K zu senden.



Dazu legt man in Signal K einen User "opencpn"  mit Lese/Schreibrechten an,

und muss dann im PI-Terminal mit folgendem Befehl einen Token erstellen:



**signalk-generate-token -u opencpn -e 1y -s \~/.signalk/security.json**



Das ist nötig, damit später Signal K die Opencpn Daten reinlässt. den Token für später merken bzw. kopieren und speichern.

**LTC\_Ocpn\_Route\_Importer Installation:**



das Powershellscript am besten mit dem Plugin in einen Ordner packen und dann dort starten.
das Plugin und der Signal K Plugin Ordner auf dem Pi  wird automatisch gefunden und dort installiert.
läuft Signal K schon einmal neu starten und danach in der Signal K Plugin Konfiguration auf "enable" setzen.
Das Plugin selber erreicht man unter Webapps.





**weitere Installationen:**



Rasterprovider: Um die Grib Dateien auslesen zu können benötigt der PI "grib\_get"
deshalb installiert man bei Onlinezugang auf dem PI am Terminal:



sudo apt-get update

sudo apt-get install libeccodes-tools



und

sudo apt-get install bzip2

(für DWD)





**erwartete Signal K Plugins:**



Ich habe das Plugin eigentlich geschrieben wegen SMHI. Das Swedish Meteorological and Hydrological Institute
stellt neuerdings ein Signal K Plugin zur Verfügung: SMHI Weather Provider
Wer die diese Daten für Schweden abgreifen will sollte in Signal K das Plugin installieren.



##### **OpenCPN Vorbereitung:**



Das Plugin "Signal K Route Sender" in Ocpn über "Plugins/ Plugin importieren" hinzufügen, danach aktivieren und
in den Einstellungen die IP zu Signal K eintragen, der Port ist üblicherweise 3000 zu Signal K.
dann den vorher erstellten Signal K Token in das Plugin eintragen.
Damit ist das Plugin fertig eingerichtet und benötigt keine weiteren Verbindungseinstellungen seitens Ocpn!



**Opencpn Benutzung:**

In Ocpn eine Route zeichnen. mit der rechten Maus (Kontextmenü) auf einen Wegpunkt, Route und dort am besten unter Eigenschaften einen Namen geben.
Danach unten unter Route "an Signal K senden".
Die GPX Route wird damit nach Signal übertragen und liegt anschliessend unter /signalk/v2/api/resources/routes
auch andere Signal K Plugins legen dort ihre Routen ab, auch diese können mit LTC\_Ocpn\_Route\_Importer verwendet werden, z.b. Freeboard-SK, Binnacle usw.



**LTC\_Ocpn\_Route\_Importer Benutzung:**





Entweder die Route auswählen oder Routenquelle auf GPX umschalten und Datei auswählen. Enthält eine GPX Datei mehrere Routen kann man die separat anwählen. Auch sind mehrere GPX Dateien möglich (Mehrfachauswahl). Die Wegpunkte erscheinen unten. Unter Provider einen der Wetteranbieter auswählen, dort gibt es unterschiedliche Anbieter. Manche bieten das Wetter für einen bestimmten Zeitpunkt
nach Koordinaten an, Bei anderen werden automatisch Grib Dateien heruntergeladen, die entsprechenen Koordianten der Wegpunkte der Grib Datei zugeordnet und so das Wetter ermittelt.

**Wetter downloaden:**
das Wetter wird heruntergeladen, den Wegpunkten zeitlich zugeordnet und  direkt gespeichert. Auswahl über "Gespeicherter Wetterlauf".



Gespeicherter Wetterlauf:
Auswahl für mehrere Versionen vom gleichen oder anderen Providern. Kann dort gelöscht werden.
Kann sinnvoll sein um verschiedene Provider bei einer Route zu vergleichen.

**SOG Planwert:**
Das ist der theoretische, angenommene Speed over Ground bei Boot ohne Fahrt (Hafenplanung).
Nachdem man den Wind eingeschätzt hat kann man dort den anzunehmenden SOG eintragen.
Das ist sozusagen die Vorstufe für die ETA- Berechnung.

**ETA- Berechnung:**



**GPS,SOG,COG:**
Am besten aktivieren für die ETA. Position und tatsächliche Fahrt über Grund; enthält bereits Wind- und Strömungseinfluss.
Wenn GPS, SOG und COG aktiv sind und die ETA auf GPS-Daten basiert, nimmt die App die gemessene SOG und berechnet mit COG,
wie viel davon in Richtung des jeweiligen Routenabschnitts wirkt.



Die Strömung an aktueller Position steckt bereits in der gemessenen Fahrt über Grund.
Bei ausgeschaltetem Strömungsvektor berechnet die App keine zusätzliche Strömungsvorhersage für spätere Abschnitte.
Fehlt eine brauchbare GPS-SOG und greift keine andere Geschwindigkeitsquelle, verwendet sie den SOG-Planwert.

Für eine Schätzung der Strömung aus Bordmessungen werden beide Bewegungen als Vektoren gebraucht:

\- SOG und COG geben an, wie schnell und in welche Richtung sich das Boot über Grund bewegt.

\- STW und die tatsächliche Bewegungsrichtung durchs Wasser geben an, wie sich das Boot relativ zum Wasser bewegt.

&#x20;Heading kann dafür als Näherung dienen. Bei seitlicher Windabdrift wird die Schätzung ungenauer.

Die Differenz dieser Vektoren ergibt die geschätzte Strömung. STW allein reicht dafür nicht!

**Strömungsvektor:**

Die App zieht HARMONIC und HARMONIC.IDX für die ETA heran, wenn „Strömungsvektor“ aktiviert ist, passende Daten verfügbar sind und die Geschwindigkeit für den Abschnitt aus Motor-SOG, LTC-Polare, STW oder dem SOG-Planwert kommt.
Passende Daten: Die App schaut in den IDX Dateien ob die Wegpunktkoordinaten passen.Am besten einen Ordner mit allen IDX Dateien anlegen, die App sucht rekusiv die passenden IDX automatisch heraus und zeigt sie auch pro Wegpunkt an. So können auch unterschiedliche IDX Dateien für eine Route benutzt werden.
IDX Dateien für Europa, Nordsee, Deutsche Bucht und Ostsee usw: **https://github.com/SignalKuser?tab=repositories**



Für jeden solchen Abschnitt fragt sie die Strömung am Zielwegpunkt zur vorläufig geschätzten Ankunftszeit ab.
Daraus berechnet sie, wie viel Strömung längs und quer zum Abschnitt wirkt, und korrigiert damit die ETA. Eine STW-Messung ist dafür optional.

Basiert ein Abschnitt auf gemessener GPS-SOG, lässt die App die IDX-Korrektur für diesen Abschnitt aus.
Beim Laden einer Route kann sie trotzdem schon prüfen und anzeigen, ob passende Strömungsstationen verfügbar sind. Diese Prüfung allein verändert die ETA nicht.

**STW – Speed Through Water:**



Wenn GPS/SOG fehlt, kann STW als Geschwindigkeitsbasis für die ETA dienen;
mit Strömungsvektor wird die Fahrt über Grund prognostiziert. Ohne GPS-Position bleibt der tatsächliche Routenfortschritt unbekannt.



**AWS – Apparent Wind Speed:**

Für die ETA wird der aktuelle Signal-K-Wind für die künftigen Streckenabschnitte angenommen. Fehlt wahrer Wind,
leitet die App ihn aus AWS/AWA sowie Bootsgeschwindigkeit und Kurs ab. Die LTC-Polare wird nur gelesen, nicht verändert.



**Heading True verwenden:**

Wenn aktiviert, richtet die App AWS/AWA mit "navigation.headingTrue" aus. Sonst nutzt sie COG als Näherung.
Vorhandene STW wird für die Windberechnung aus AWS/AWA genutzt, sofern verfügbar. "STW – Speed Through Water steuert nur,

ob STW zusätzlich als ETA-Geschwindigkeitsbasis dient.

Gibt es keine  Headingquelle in Signal K wird COG wird als Näherung genutzt.



**Maschine an/aus:**



Sobald  „Maschine an/aus“ aktiviert ist,  verwendet die App Motor-SOG als Basis für alle verbleibenden Routenabschnitte.
Der Wert hat dann Vorrang vor GPS-SOG, LTC-Polare, STW und dem SOG-Planwert.

Ist auch der Strömungsvektor aktiv (Mit passenden IDX Dateien, korrigiert die App die Motor-SOG für den jeweiligen Abschnitt.

**Polardaten:**

Polare bestimmen die geschätzte Geschwindigkeit für jeden Routenabschnitt, wenn sie aktiviert und eine passende Datei ausgewählt ist. Die App nimmt die erwartete wahre Windstärke (TWS) und den Winkel des Winds zum Abschnitt (TWA). Daraus schätzt sie, wie schnell das Boot in Richtung des nächsten Wegpunkts vorankommt. Bei Gegenwind kann die Berechnung auch das Kreuzen berücksichtigen.

Beispiel: Ein Abschnitt von 20 sm dauert mit einem SOG-Planwert von 5 kn etwa 4 Stunden. Ergibt die Polare wegen Gegenwind nur 4 kn Fortschritt zum Ziel,

rechnet die App mit 5 Stunden. Dadurch verschieben sich auch die ETAs der folgenden Wegpunkte und gegebenenfalls die dazu angezeigten Vorhersagezeiten.



Motor-SOG hat Vorrang, wenn die Maschine aktiviert ist. Im Segelmodus hat eine nutzbare Polare Vorrang vor GPS-SOG, STW und dem SOG-Planwert.

Wie gut die ETA passt, hängt also auch davon ab, wie gut die gewählte Polare das Boot abbildet.



**Wegpunktradius:**

Der Wegpunkt gilt als erreicht bei eingestelltem Radius.



**Entfernung und Kurs zum nächsten Wegpunkt:**



Es Ist möglich, dass die aktuelle Position sich gar nicht gar nicht in der Nähe der Route befindet.
Hier wird Entfernung und Kurswinkel zum nächstgelegen Wegpunkt der Route angezeigt.
Erreicht man diesen Wegpunkt gelten alle Wegpunkte davor als abgefahren.





**Windgewichtung:**



Der angezeigte Wind kommt vom Provider und ist foreccast. Der selbst gemessene Wind ist viel genauer und wird deshalb berücksichtig. Desto weiter man sich räumlich und zeitlich
entfernt, nimmt der Bootswind (Windvektor = Windstärke und Richtung) mit der Gewichtung ab und spielt kaum eine Rolle. Nähert man sich einem Wegpunkt nimmt er wieder zu.



Der Anteil richtet sich nach der verbleibenden Strecke. Liegt ein Wegpunkt zunächst 3 nm vor dir und das Ziel insgesamt 6 nm entfernt, erhält er 50 % Bootswind und 50 % Providerwind. fährt man 2 nm weiter, sind es für denselben Wegpunkt 75 %  Bootswind und 25 % Providerwind. Passt sich dynamisch an.



Handbreit/C



&#x20;

