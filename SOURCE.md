# Source code

This source snapshot contains the Signal K app **1.1.47** and the OpenCPN
Route Sender **0.5.6**. Publishing the source does not create new app versions.

- [Signal K app](incoming/signalk-route-weather/): server plugin, web app,
  translated help, screenshots and qtVlm tests.
- [OpenCPN Route Sender](incoming/signalk-route-sender/): active C++ source,
  CMake project and plugin assets.
- [Licenses](LICENSING.md): MIT for the Signal K app; GPL-2.0-or-later for the
  OpenCPN sender.

## Get the source

```sh
git clone --recurse-submodules https://github.com/SignalKuser/LTC_Ocpn_Route_Importer.git
cd LTC_Ocpn_Route_Importer
```

For an existing clone, run `git submodule update --init --recursive`.
GitHub's automatic ZIP download does not include submodule contents.
The OpenCPN libraries are pinned to upstream commit
`8544820e9ea678877437f800ff9b5607752af276`.

## Signal K app

Requires Node.js 18 or later. Run the included tests from the repository root:

```sh
node --test incoming/signalk-route-weather/test/qtvlm.test.js
```

Create an npm package from its source directory:

```sh
cd incoming/signalk-route-weather
npm pack
```

Install the resulting package in the Signal K server's configuration directory,
then restart Signal K. See the app's README for configuration and system tools
required by individual weather providers.

## OpenCPN Route Sender

The existing binary targets Windows x86, OpenCPN 5.14.2 and wxWidgets 3.2.
Building requires CMake 3.16 or later, a C++17 compiler, wxWidgets (core,
base and net), libcurl development files and the pinned OpenCPN API submodule.
On Windows all dependencies must match the x86 target and compiler runtime.

Configure a build with dependency locations appropriate for your machine:

```sh
cmake -S incoming/signalk-route-sender -B incoming/signalk-route-sender/build-win32 -A Win32
cmake --build incoming/signalk-route-sender/build-win32 --config Release --target signalk_route_sender_pi
```

The configure example uses Visual Studio on Windows; provide the wxWidgets and
CURL CMake locations if they are not discoverable. See CMakeLists.txt for the
required components. A fresh C++ build was not performed for this source upload.

After a successful Windows x86 build, `Create-RouteSender-PluginTarball.ps1`
creates the Plugin Manager archive. Built binaries, downloaded build tools,
old source backups and local installation settings are not part of this snapshot.
