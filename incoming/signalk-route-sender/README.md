# Signal K Route Sender 0.5.6

Windows x86 plugin for OpenCPN 5.14.2 that sends one or more routes to Signal K.

## Use

1. Under **Options > Connections** in OpenCPN, configure and enable a Signal K connection. Paste the server's token into **Advanced > Auth Token** if authentication is required. Confirm the OpenCPN settings.
2. For a single route, right-click it and choose **Route an Signal K senden**. For multiple routes, open **Signal K Route Sender** from the toolbar, tick the routes and click **Senden**.
3. The result shows the automatically selected destination and the status of each route.

The sender uses the sole valid enabled Signal K connection, including custom ports. If multiple valid connections are enabled, it uses the sole entry on port 3000. If the configuration does not identify a unique destination, the sender explains why. It uses the Signal K HTTP route API at /signalk/v2/api/resources/routes and uploads each route as a separate GeoJSON LineString with its waypoint metadata. Later sends update the saved resource ID. When the server address and port match an older sender profile, its saved route ID can be reused.

To generate a token for an existing user with route write permission, run on the destination Signal K server:

    signalk-generate-token -u opencpn -e 1y -s ~/.signalk/security.json

Replace opencpn with the Signal K username and adjust the expiry and security.json path as needed. Enter the output in the OpenCPN connection. The sender stores route IDs for updates and reads the token directly from the connection.

## Build

From the project directory, using the configured Visual Studio 2022 x86 build:

```powershell
cmake --build build-win32 --config Release --target signalk_route_sender_pi -- /m:4
```

Create the OpenCPN Plugin Manager tarball from the workspace root with:

```powershell
.\Create-RouteSender-PluginTarball.ps1
```

