## LTC_Ocpn_Route_Importer v.1.1.25

Multi-language (DE, NL, GB, FR)
Download: [https://github.com/SignalKuser?tab=repositories](https://github.com/SignalKuser/LTC_Ocpn_Route_Importer/releases)

# Requirements:

OpenCPN 32-bit version for Windows
Signal K, Raspberry Pi ARM64

# Signal K Preparation:

The Signal K plugin (LTC_Ocpn_Route_Importer) can use local GPX files stored on Windows or a Raspberry Pi.
However, a more elegant approach is to plot the route in OpenCPN and send it to Signal K "on the fly."

To do this, create a user named "opencpn" in Signal K with read/write permissions,
and then generate a token using the following command in the Raspberry Pi terminal:

# signalk-generate-token -u opencpn -e 1y -s ~/.signalk/security.json

This is necessary to allow Signal K to accept data from OpenCPN. Make sure to note down, copy, or save the token for later use.
LTC_Ocpn_Route_Importer Installation:

It is best to place the PowerShell script in the same folder as the plugin and run it from there.
The script will automatically locate the plugin and the Signal K plugin directory on the Raspberry Pi and perform the installation.
If Signal K is already running, restart it, then go to the Signal K plugin configuration and set it to "enable."
The plugin itself can be accessed via the Webapps section.

# Additional Installations:

Raster provider: To read GRIB files, the Raspberry Pi requires "grib_get."
Therefore, if the Raspberry Pi has internet access, run the following commands in the terminal:

sudo apt-get update
sudo apt-get install libeccodes-tools

and 

sudo apt-get install bzip2
(for DWD provider)

# OpenCPN Preparation:

Add the "Signal K Route Sender" plugin to OpenCPN via "Plugins" > "Import Plugins," then activate it. In the plugin settings, enter the IP address for your Signal K instance (the default port for Signal K is usually 3000). Next, enter the previously generated Signal K token into the plugin.
The plugin is now fully configured; no further connection settings are required within OpenCPN!

# Using OpenCPN:

Draw a route in OpenCPN. Right-click on a waypoint or the route itself to open the context menu, and—ideally—assign a name via the "Properties" option.
Then, select "Send to Signal K" under the route options at the bottom.
The GPX route will be transmitted to Signal K and stored at `/signalk/v2/api/resources/routes`.
Other Signal K plugins (such as Freeboard-SK, Binnacle, etc.) also store their routes here; these can likewise be used with the `LTC_Ocpn_Route_Importer`.

# Using `LTC_Ocpn_Route_Importer`:

Either select a route directly or switch the route source to "GPX" and choose a file. If a GPX file contains multiple routes, you can select them individually. You can also select multiple GPX files at once. The waypoints will appear at the bottom. Choose a weather provider from the "Provider" menu; various options are available. Some providers offer weather data for specific coordinates at a given time, while others automatically download GRIB files, map the waypoint coordinates to the GRIB data, and determine the weather accordingly.
Downloading weather:
The weather data is downloaded, assigned to the waypoints based on time, and saved directly. You can access these via "Saved Weather Run."

# Saved Weather Run:

This section allows you to manage multiple versions from the same or different providers. You can also delete entries here.
This is useful for comparing data from different providers for a specific route. Planned SOG (Speed ​​Over Ground):
This is the theoretical, assumed speed over ground for a vessel that is not yet underway (used for voyage planning).
Once the wind conditions have been assessed, the estimated SOG can be entered here.
This serves, in effect, as a preliminary step for calculating the ETA (Estimated Time of Arrival).

# ETA Calculation:
GPS, SOG, COG:
It is best to enable these for ETA calculations. They provide your position and actual speed over ground (SOG), which already accounts for the effects of wind and current.
When GPS, SOG, and COG are active and the ETA is based on GPS data, the app uses the measured SOG and, in combination with the course over ground (COG), calculates the component of that speed acting along the specific route segment.
The current at your current position is already factored into the measured speed over ground.
If the "current vector" feature is disabled, the app will not calculate additional current forecasts for subsequent route segments.
If no reliable GPS-based SOG is available—and no other speed source is present—the app will use the planned SOG value.
To estimate the current based on onboard measurements, both types of motion are required as vectors:
- SOG and COG indicate the speed and direction of the boat's movement over the ground.
- Speed ​​through water (STW) and the actual direction of movement through the water indicate how the boat is moving relative to the water. (The vessel's heading can serve as an approximation here, though the estimate becomes less accurate if there is significant leeway due to wind.)
The difference between these vectors yields the estimated current. STW alone is not sufficient for this calculation!

# Current Vector:

When the "current vector" feature is enabled and relevant data is available, the app incorporates HARMONIC and HARMONIC.IDX files into its ETA calculations—provided the speed for a given segment is derived from engine-based SOG, LTC polars, STW, or the planned SOG value.
Relevant data: The app checks the IDX files to see if the waypoint coordinates match. It is recommended to store all IDX files in a single folder; the app will automatically search through them recursively to identify the appropriate files, which are then displayed for each individual waypoint. This allows for the use of different IDX files along a single route. IDX files for Europe, the North Sea, the German Bight, the Baltic Sea, etc.: https://github.com/SignalKuser?tab=repositories

For each such segment, the app queries the current at the destination waypoint for the tentatively estimated time of arrival (ETA).
Based on this, it calculates the current components acting along and across the segment and uses them to adjust the ETA. A measurement of Speed ​​Through Water (STW) is optional for this purpose.
If a segment is based on measured GPS-SOG (Speed ​​Over Ground), the app omits the IDX correction for that segment.
When loading a route, the app can still check for and indicate whether relevant current stations are available. This check alone does not alter the ETA.

# STW – Speed ​​Through Water:

If GPS/SOG data is unavailable, STW (Speed ​​Through Water) can serve as the speed basis for calculating the ETA;
the course over ground (COG) for future route segments is then projected by incorporating the current/tide vector. Without a GPS position, the actual progress along the route remains unknown.

# AWS – Apparent Wind Speed:

For ETA calculations, the current Signal K wind data is assumed to apply to future route segments. If true wind data is missing,
the app derives it from the AWS/AWA (Apparent Wind Speed/Angle) in combination with the boat's speed and heading. The LTC polar data is read-only and cannot be modified.

Use True Heading:
When enabled, the app aligns AWS/AWA data using "navigation.headingTrue." Otherwise, it uses COG as an approximation.
If available, STW is used for wind calculations derived from AWS/AWA. The "STW – Speed ​​Through Water" setting specifically determines
whether STW should also be used as a basis for calculating the ETA.
If no heading source is available in Signal K, COG is used as an approximation.

# Engine On/Off:

Once "Engine On/Off" is activated, the app uses the "motor SOG" (speed over ground under engine power) as the basis for all remaining route segments.
In this case, this value takes precedence over GPS-based SOG, LTC polar data, STW, and any planned SOG values. If the current vector is also active (provided suitable IDX files are available), the app adjusts the "motor-SOG" (speed over ground under engine power) for the respective leg.

# Polar data:

When enabled and a suitable file is selected, polar data determines the estimated speed for each leg of the route. The app uses the expected true wind speed (TWS) and the true wind angle (TWA) relative to the leg to estimate how quickly the boat will progress toward the next waypoint. In the case of a headwind, the calculation can also account for tacking (beating).
Example: A 20-nautical-mile leg, based on a planned SOG of 5 knots, would take approximately 4 hours. If the polar data indicates a progress speed of only 4 knots toward the destination due to a headwind, the app calculates a duration of 5 hours. Consequently, the estimated times of arrival (ETAs) for subsequent waypoints—and any associated predicted arrival times—are shifted accordingly.
When the engine is active, the "motor-SOG" takes precedence. In sailing mode, valid polar data takes precedence over GPS-based SOG, speed through the water (STW), and the planned SOG value.
Therefore, the accuracy of the ETA depends on how well the selected polar data represents the boat's actual performance.


# Waypoint Radius:
A waypoint is considered reached once the vessel enters the defined radius.

# Distance and Bearing to the Next Waypoint:

It is possible for your current position to be some distance away from the planned route.
In such cases, the system displays the distance and bearing to the nearest waypoint on the route.
Once this waypoint is reached, all preceding waypoints are considered passed.

# Wind Weighting:

The wind data provided by the external source is a forecast. Since locally measured wind data is significantly more accurate, it is incorporated into the calculation. As the distance (in terms of both space and time) from a waypoint increases, the weight given to the "on-board" wind data (the wind vector, comprising speed and direction) decreases, eventually becoming negligible. As you approach a waypoint, the weight of the on-board data increases again.

The weighting is determined by the remaining distance. For example, if a waypoint is 3 nautical miles (nm) ahead and the final destination is 6 nm away, the calculation will use 50% on-board wind data and 50% forecast data. If you travel another 2 nm closer, the weighting for that same waypoint shifts to 75% on-board wind data and 25% forecast data. This adjustment happens dynamically.

Cheers/C

--------------- German

# LTC_Ocpn_Route_Importer   v.1.1.25
Multi De, NL, GB, FR
Download:  [https://github.com/SignalKuser?tab=repositories](https://github.com/SignalKuser/LTC_Ocpn_Route_Importer/releases)


# Requirements:

OpenCPN 32Bit Version Windows
Signal K, Raspberry Pi ARM64

# Signal K Vorbereitung:

Das Signal K Plugin (LTC_Ocpn_Route_Importer) kann kann lokale GPX Dateien verwenden, die auf Windows oder Raspberry liegen.
Eleganter ist allerdings, die Route in OpenCPN zu zeichnen und dann "on the fly" an Signal K zu senden.

Dazu legt man in Signal K einen User "opencpn"  mit Lese/Schreibrechten an,
und muss dann im PI-Terminal mit folgendem Befehl einen Token erstellen:

signalk-generate-token -u opencpn -e 1y -s ~/.signalk/security.json

Das ist nötig, damit später Signal K die Opencpn Daten reinlässt. den Token für später merken bzw. kopieren und speichern.
LTC_Ocpn_Route_Importer Installation:

das Powershellscript am besten mit dem Plugin in einen Ordner packen und dann dort starten.
das Plugin und der Signal K Plugin Ordner auf dem Pi  wird automatisch gefunden und dort installiert.
läuft Signal K schon einmal neu starten und danach in der Signal K Plugin Konfiguration auf "enable" setzen.
Das Plugin selber erreicht man unter Webapps.


weitere Installationen:

Rasterprovider: Um die Grib Dateien auslesen zu können benötigt der PI "grib_get"
deshalb installiert man bei Onlinezugang auf dem PI am Terminal:

sudo apt-get update
sudo apt-get install libeccodes-tools


# OpenCPN Vorbereitung:

Das Plugin "Signal K Route Sender" in Ocpn über "Plugins/ Plugin importieren" hinzufügen, danach aktivieren und
in den Einstellungen die IP zu Signal K eintragen, der Port ist üblicherweise 3000 zu Signal K.
dann den vorher erstellten Signal K Token in das Plugin eintragen.
Damit ist das Plugin fertig eingerichtet und benötigt keine weiteren Verbindungseinstellungen seitens Ocpn!

# Opencpn Benutzung:
In Ocpn eine Route zeichnen. mit der rechten Maus (Kontextmenü) auf einen Wegpunkt, Route und dort am besten unter Eigenschaften einen Namen geben.
Danach unten unter Route "an Signal K senden".
Die GPX Route wird damit nach Signal übertragen und liegt anschliessend unter /signalk/v2/api/resources/routes
auch andere Signal K Plugins legen dort ihre Routen ab, auch diese können mit LTC_Ocpn_Route_Importer verwendet werden, z.b. Freeboard-SK, Binnacle usw.

# LTC_Ocpn_Route_Importer Benutzung:


Entweder die Route auswählen oder Routenquelle auf GPX umschalten und Datei auswählen. Enthält eine GPX Datei mehrere Routen kann man die separat anwählen. Auch sind mehrere GPX Dateien möglich (Mehrfachauswahl). Die Wegpunkte erscheinen unten. Unter Provider einen der Wetteranbieter auswählen, dort gibt es unterschiedliche Anbieter. Manche bieten das Wetter für einen bestimmten Zeitpunkt
nach Koordinaten an, Bei anderen werden automatisch Grib Dateien heruntergeladen, die entsprechenen Koordianten der Wegpunkte der Grib Datei zugeordnet und so das Wetter ermittelt.
Wetter downloaden:
das Wetter wird heruntergeladen, den Wegpunkten zeitlich zugeordnet und  direkt gespeichert. Auswahl über "Gespeicherter Wetterlauf".

# Gespeicherter Wetterlauf:
Auswahl für mehrere Versionen vom gleichen oder anderen Providern. Kann dort gelöscht werden.
Kann sinnvoll sein um verschiedene Provider bei einer Route zu vergleichen.
SOG Planwert:
Das ist der theoretische, angenommene Speed over Ground bei Boot ohne Fahrt (Hafenplanung).
Nachdem man den Wind eingeschätzt hat kann man dort den anzunehmenden SOG eintragen.
Das ist sozusagen die Vorstufe für die ETA- Berechnung.

# ETA- Berechnung:
GPS,SOG,COG:
Am besten aktivieren für die ETA. Position und tatsächliche Fahrt über Grund; enthält bereits Wind- und Strömungseinfluss.
Wenn GPS, SOG und COG aktiv sind und die ETA auf GPS-Daten basiert, nimmt die App die gemessene SOG und berechnet mit COG,
wie viel davon in Richtung des jeweiligen Routenabschnitts wirkt.

Die Strömung an aktueller Position steckt bereits in der gemessenen Fahrt über Grund.
Bei ausgeschaltetem Strömungsvektor berechnet die App keine zusätzliche Strömungsvorhersage für spätere Abschnitte.
Fehlt eine brauchbare GPS-SOG und greift keine andere Geschwindigkeitsquelle, verwendet sie den SOG-Planwert.
Für eine Schätzung der Strömung aus Bordmessungen werden beide Bewegungen als Vektoren gebraucht:
- SOG und COG geben an, wie schnell und in welche Richtung sich das Boot über Grund bewegt.
- STW und die tatsächliche Bewegungsrichtung durchs Wasser geben an, wie sich das Boot relativ zum Wasser bewegt.
 Heading kann dafür als Näherung dienen. Bei seitlicher Windabdrift wird die Schätzung ungenauer.
Die Differenz dieser Vektoren ergibt die geschätzte Strömung. STW allein reicht dafür nicht!
Strömungsvektor:
Die App zieht HARMONIC und HARMONIC.IDX für die ETA heran, wenn „Strömungsvektor“ aktiviert ist, passende Daten verfügbar sind und die Geschwindigkeit für den Abschnitt aus Motor-SOG, LTC-Polare, STW oder dem SOG-Planwert kommt.
Passende Daten: Die App schaut in den IDX Dateien ob die Wegpunktkoordinaten passen.Am besten einen Ordner mit allen IDX Dateien anlegen, die App sucht rekusiv die passenden IDX automatisch heraus und zeigt sie auch pro Wegpunkt an. So können auch unterschiedliche IDX Dateien für eine Route benutzt werden.
IDX Dateien für Europa, Nordsee, Deutsche Bucht und Ostsee usw: https://github.com/SignalKuser?tab=repositories

Für jeden solchen Abschnitt fragt sie die Strömung am Zielwegpunkt zur vorläufig geschätzten Ankunftszeit ab.
Daraus berechnet sie, wie viel Strömung längs und quer zum Abschnitt wirkt, und korrigiert damit die ETA. Eine STW-Messung ist dafür optional.
Basiert ein Abschnitt auf gemessener GPS-SOG, lässt die App die IDX-Korrektur für diesen Abschnitt aus.
Beim Laden einer Route kann sie trotzdem schon prüfen und anzeigen, ob passende Strömungsstationen verfügbar sind. Diese Prüfung allein verändert die ETA nicht.
STW – Speed Through Water:

Wenn GPS/SOG fehlt, kann STW als Geschwindigkeitsbasis für die ETA dienen;
mit Strömungsvektor wird die Fahrt über Grund prognostiziert. Ohne GPS-Position bleibt der tatsächliche Routenfortschritt unbekannt.

# AWS – Apparent Wind Speed:
Für die ETA wird der aktuelle Signal-K-Wind für die künftigen Streckenabschnitte angenommen. Fehlt wahrer Wind,
leitet die App ihn aus AWS/AWA sowie Bootsgeschwindigkeit und Kurs ab. Die LTC-Polare wird nur gelesen, nicht verändert.

# Heading True verwenden:
Wenn aktiviert, richtet die App AWS/AWA mit "navigation.headingTrue" aus. Sonst nutzt sie COG als Näherung.
Vorhandene STW wird für die Windberechnung aus AWS/AWA genutzt, sofern verfügbar. "STW – Speed Through Water steuert nur,
ob STW zusätzlich als ETA-Geschwindigkeitsbasis dient.
Gibt es keine  Headingquelle in Signal K wird COG wird als Näherung genutzt.

Maschine an/aus:

Sobald  „Maschine an/aus“ aktiviert ist,  verwendet die App Motor-SOG als Basis für alle verbleibenden Routenabschnitte.
Der Wert hat dann Vorrang vor GPS-SOG, LTC-Polare, STW und dem SOG-Planwert.
Ist auch der Strömungsvektor aktiv (Mit passenden IDX Dateien, korrigiert die App die Motor-SOG für den jeweiligen Abschnitt.
Polardaten:
Polare bestimmen die geschätzte Geschwindigkeit für jeden Routenabschnitt, wenn sie aktiviert und eine passende Datei ausgewählt ist. Die App nimmt die erwartete wahre Windstärke (TWS) und den Winkel des Winds zum Abschnitt (TWA). Daraus schätzt sie, wie schnell das Boot in Richtung des nächsten Wegpunkts vorankommt. Bei Gegenwind kann die Berechnung auch das Kreuzen berücksichtigen.
Beispiel: Ein Abschnitt von 20 sm dauert mit einem SOG-Planwert von 5 kn etwa 4 Stunden. Ergibt die Polare wegen Gegenwind nur 4 kn Fortschritt zum Ziel,
rechnet die App mit 5 Stunden. Dadurch verschieben sich auch die ETAs der folgenden Wegpunkte und gegebenenfalls die dazu angezeigten Vorhersagezeiten.

Motor-SOG hat Vorrang, wenn die Maschine aktiviert ist. Im Segelmodus hat eine nutzbare Polare Vorrang vor GPS-SOG, STW und dem SOG-Planwert.
Wie gut die ETA passt, hängt also auch davon ab, wie gut die gewählte Polare das Boot abbildet.

# Wegpunktradius:
Der Wegpunkt gilt als erreicht bei eingestelltem Radius.

Entfernung und Kurs zum nächsten Wegpunkt:

Es Ist möglich, dass die aktuelle Position sich gar nicht gar nicht in der Nähe der Route befindet.
Hier wird Entfernung und Kurswinkel zum nächstgelegen Wegpunkt der Route angezeigt.
Erreicht man diesen Wegpunkt gelten alle Wegpunkte davor als abgefahren.


# Windgewichtung:

Der angezeigte Wind kommt vom Provider und ist foreccast. Der selbst gemessene Wind ist viel genauer und wird deshalb berücksichtig. Desto weiter man sich räumlich und zeitlich
entfernt, nimmt der Bootswind (Windvektor = Windstärke und Richtung) mit der Gewichtung ab und spielt kaum eine Rolle. Nähert man sich einem Wegpunkt nimmt er wieder zu.

Der Anteil richtet sich nach der verbleibenden Strecke. Liegt ein Wegpunkt zunächst 3 nm vor dir und das Ziel insgesamt 6 nm entfernt, erhält er 50 % Bootswind und 50 % Providerwind. fährt man 2 nm weiter, sind es für denselben Wegpunkt 75 %  Bootswind und 25 % Providerwind. Passt sich dynamisch an.

Handbreit/C

 <img width="1301" height="906" alt="Screenshot 2026-11-12 191952" src="https://github.com/user-attachments/assets/e3c17b43-54ac-4680-ab11-7a2f2379c03b" />

<img width="1909" height="912" alt="Screenshot 2026-11-12 192500" src="https://github.com/user-attachments/assets/45a9b08d-8abe-4370-ae3a-f9a74194696c" />
<img width="1892" height="894" alt="Screenshot 2026-11-12 192119" src="https://github.com/user-attachments/assets/26474062-221c-48c4-ad83-8cdb0bbe8283" />

<img width="1495" height="827" alt="Screenshot 2026-11-12 195547" src="https://github.com/user-attachments/assets/ca0106f7-41f7-426f-8a75-fb4a6750c3a7" />

