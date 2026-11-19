#include <wx/wxprec.h>

#ifndef WX_PRECOMP
#include <wx/wx.h>
#endif

#include "ocpn_plugin.h"
#include "route_sender_icon.h"

#include <wx/checklst.h>
#include <wx/imagpng.h>
#include <wx/mstream.h>
#include <wx/fileconf.h>
#include <wx/filename.h>
#include <wx/sizer.h>
#include <wx/textfile.h>
#include <wx/textctrl.h>

#include <curl/curl.h>

#include <algorithm>
#include <atomic>
#include <cctype>
#include <chrono>
#include <cmath>
#include <future>
#include <functional>
#include <iomanip>
#include <locale>
#include <memory>
#include <sstream>
#include <string>
#include <utility>
#include <vector>

namespace {

constexpr int kVersionMajor = 0;
constexpr int kVersionMinor = 5;
constexpr int kVersionPatch = 6;
constexpr char kConfigPath[] = "/PlugIns/SignalKRouteSender";
constexpr char kRouteEndpoint[] = "/signalk/v2/api/resources/routes";
constexpr std::size_t kMaxResponseBytes = 1024 * 1024;

struct SignalKConnection {
  wxString name;
  wxString host;
  wxString port;
  wxString token;
};

struct TransferResult {
  bool success = false;
  bool created = false;
  long status = 0;
  wxString resourceId;
  wxString message;
};

std::string Utf8(const wxString& value) {
  const wxScopedCharBuffer bytes = value.ToUTF8();
  return bytes.data() ? std::string(bytes.data(), bytes.length()) : std::string();
}

wxBitmap CreateSignalKIcon(int size) {
  wxMemoryInputStream stream(kRouteSenderIcon, sizeof(kRouteSenderIcon));
  wxPNGHandler png;
  wxImage image;
  if (!png.LoadFile(&image, stream) || !image.HasAlpha()) return wxNullBitmap;
  // Match the toolbar cell and leave its corners transparent.
  const int margin = size / 16;
  const int artworkInset = margin + 1;
  const int artworkSize = size - 2 * artworkInset;
  const wxImage artwork = image.Scale(artworkSize, artworkSize, wxIMAGE_QUALITY_HIGH);
  wxImage icon(size, size);
  icon.InitAlpha();
  const double center = size / 2.0;
  const double radius = size * 0.21;
  const double straightEdge = center - margin - radius;
  static constexpr unsigned char grey = 180;
  for (int y = 0; y < size; ++y) {
    for (int x = 0; x < size; ++x) {
      const double dx = std::max(0.0, std::abs(x + 0.5 - center) - straightEdge);
      const double dy = std::max(0.0, std::abs(y + 0.5 - center) - straightEdge);
      const double backgroundAlpha = std::clamp(radius + 0.5 - std::hypot(dx, dy), 0.0, 1.0);
      const int artX = x - artworkInset;
      const int artY = y - artworkInset;
      const bool inside = artX >= 0 && artX < artworkSize && artY >= 0 && artY < artworkSize;
      const double artworkAlpha = inside ? artwork.GetAlpha(artX, artY) / 255.0 : 0.0;
      const double greyAlpha = backgroundAlpha * (1.0 - artworkAlpha);
      const double alpha = artworkAlpha + greyAlpha;
      const auto blend = [artworkAlpha, greyAlpha, alpha](unsigned char channel) {
        return static_cast<unsigned char>(alpha > 0.0
            ? std::lround((channel * artworkAlpha + grey * greyAlpha) / alpha)
            : 0);
      };
      icon.SetRGB(x, y, blend(inside ? artwork.GetRed(artX, artY) : 0),
                  blend(inside ? artwork.GetGreen(artX, artY) : 0),
                  blend(inside ? artwork.GetBlue(artX, artY) : 0));
      icon.SetAlpha(x, y, static_cast<unsigned char>(std::lround(alpha * 255.0)));
    }
  }
  return wxBitmap(icon, 32);
}

std::string JsonEscape(const wxString& value) {
  const std::string input = Utf8(value);
  std::ostringstream output;
  output.imbue(std::locale::classic());
  output << '"';
  for (const unsigned char ch : input) {
    switch (ch) {
      case '"': output << "\\\""; break;
      case '\\': output << "\\\\"; break;
      case '\b': output << "\\b"; break;
      case '\f': output << "\\f"; break;
      case '\n': output << "\\n"; break;
      case '\r': output << "\\r"; break;
      case '\t': output << "\\t"; break;
      default:
        if (ch < 0x20) {
          output << "\\u00" << std::hex << std::setw(2) << std::setfill('0')
                 << static_cast<unsigned int>(ch) << std::dec;
        } else {
          output << static_cast<char>(ch);
        }
    }
  }
  output << '"';
  return output.str();
}

std::string JsonNumber(double value) {
  std::ostringstream output;
  output.imbue(std::locale::classic());
  output << std::fixed << std::setprecision(8) << value;
  return output.str();
}

bool ExtractJsonString(const std::string& json, const std::string& key,
                       std::string* value) {
  const std::string quotedKey = "\"" + key + "\"";
  std::size_t pos = json.find(quotedKey);
  if (pos == std::string::npos) return false;
  pos = json.find(':', pos + quotedKey.size());
  if (pos == std::string::npos) return false;
  ++pos;
  while (pos < json.size() && std::isspace(static_cast<unsigned char>(json[pos]))) ++pos;
  if (pos >= json.size() || json[pos] != '"') return false;
  ++pos;
  std::string result;
  while (pos < json.size()) {
    const char ch = json[pos++];
    if (ch == '"') {
      *value = std::move(result);
      return true;
    }
    if (ch == '\\') {
      if (pos >= json.size()) return false;
      const char escaped = json[pos++];
      if (escaped == '"' || escaped == '\\' || escaped == '/') result += escaped;
      else if (escaped == 'b') result += '\b';
      else if (escaped == 'f') result += '\f';
      else if (escaped == 'n') result += '\n';
      else if (escaped == 'r') result += '\r';
      else if (escaped == 't') result += '\t';
      else return false;
    } else {
      result += ch;
    }
  }
  return false;
}

struct CurlResponse {
  std::string body;
};

std::size_t CurlWrite(char* data, std::size_t size, std::size_t count, void* userData) {
  const std::size_t bytes = size * count;
  auto* response = static_cast<CurlResponse*>(userData);
  if (bytes > kMaxResponseBytes - response->body.size()) return 0;
  response->body.append(data, bytes);
  return bytes;
}

int CurlProgress(void* userData, curl_off_t, curl_off_t, curl_off_t, curl_off_t) {
  const auto* cancelled = static_cast<const std::atomic_bool*>(userData);
  return cancelled->load() ? 1 : 0;
}

TransferResult RequestSignalK(const std::string& baseUrl, const std::string& token,
                              const std::string& payload, const std::string& existingId,
                              const std::shared_ptr<std::atomic_bool>& cancelled) {
  auto request = [&](const std::string& url, const char* method) {
    TransferResult result;
    CURL* curl = curl_easy_init();
    if (!curl) {
      result.message = "Der HTTP-Client konnte nicht gestartet werden.";
      return result;
    }

    CurlResponse response;
    struct curl_slist* headers = nullptr;
    const std::string auth = "Authorization: Bearer " + token;
    if (!token.empty()) headers = curl_slist_append(headers, auth.c_str());
    headers = curl_slist_append(headers, "Content-Type: application/json");
    headers = curl_slist_append(headers, "Accept: application/json");
    headers = curl_slist_append(headers, "Expect:");

    curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
    curl_easy_setopt(curl, CURLOPT_POSTFIELDS, payload.c_str());
    curl_easy_setopt(curl, CURLOPT_POSTFIELDSIZE, static_cast<long>(payload.size()));
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, CurlWrite);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &response);
    curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT_MS, 4000L);
    curl_easy_setopt(curl, CURLOPT_TIMEOUT_MS, 15000L);
    curl_easy_setopt(curl, CURLOPT_NOSIGNAL, 1L);
    curl_easy_setopt(curl, CURLOPT_FOLLOWLOCATION, 0L);
    curl_easy_setopt(curl, CURLOPT_NOPROGRESS, 0L);
    curl_easy_setopt(curl, CURLOPT_XFERINFOFUNCTION, CurlProgress);
    curl_easy_setopt(curl, CURLOPT_XFERINFODATA, cancelled.get());
    if (std::string(method) == "POST") {
      curl_easy_setopt(curl, CURLOPT_POST, 1L);
    } else {
      curl_easy_setopt(curl, CURLOPT_CUSTOMREQUEST, method);
    }

    const CURLcode code = curl_easy_perform(curl);
    curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &result.status);
    curl_slist_free_all(headers);
    curl_easy_cleanup(curl);

    if (code != CURLE_OK && cancelled->load()) {
      result.message = "Übertragung abgebrochen.";
      return result;
    }
    if (code != CURLE_OK) {
      result.message = wxString::FromUTF8(curl_easy_strerror(code));
      return result;
    }
    if (result.status < 200 || result.status >= 300) {
      result.message = wxString::Format("Signal K antwortete mit HTTP %ld.", result.status);
      if (result.status == 401 || result.status == 403) {
        result.message += " Auth Token und Schreibrechte der gewählten OpenCPN-Verbindung prüfen.";
      }
      return result;
    }
    result.success = true;
    if (std::string(method) == "POST") {
      std::string resourceId;
      if (ExtractJsonString(response.body, "id", &resourceId)) {
        result.created = true;
        result.resourceId = wxString::FromUTF8(resourceId.c_str());
      } else {
        result.success = false;
        result.message = "Signal K hat die Route angenommen, aber keine Routen-ID zurückgegeben.";
      }
    }
    return result;
  };

  if (!existingId.empty()) {
    const std::string putUrl = baseUrl + "/" + existingId;
    TransferResult updated = request(putUrl, "PUT");
    if (updated.success || updated.status != 404) return updated;
    if (cancelled->load()) return updated;
  }

  TransferResult created = request(baseUrl, "POST");
  return created;
}

struct PendingRoute {
  wxString guid;
  wxString name;
  std::string payload;
  std::string existingId;
  wxString error;
};

using BatchResults = std::vector<TransferResult>;

class TransferMonitor final : public wxEvtHandler {
 public:
  TransferMonitor() : m_timer(this) {
    Bind(wxEVT_TIMER, &TransferMonitor::OnTimer, this);
  }

  ~TransferMonitor() override { StopAndWait(); }

  bool IsBusy() const { return m_busy; }

  bool Start(std::function<BatchResults(const std::shared_ptr<std::atomic_bool>&)> job,
             std::function<void(BatchResults, wxString, bool)> completion, wxString* error) {
    if (m_busy) return false;
    m_cancelled = std::make_shared<std::atomic_bool>(false);
    m_completion = std::move(completion);
    const auto cancelled = m_cancelled;
    try {
      m_future = std::async(std::launch::async,
                            [job = std::move(job), cancelled]() { return job(cancelled); });
    } catch (const std::exception& exception) {
      m_completion = {};
      m_cancelled.reset();
      *error = wxString::FromUTF8(exception.what());
      return false;
    }
    m_busy = true;
    m_timer.Start(100);
    return true;
  }

  void StopAndWait() {
    m_timer.Stop();
    if (m_cancelled) m_cancelled->store(true);
    if (m_future.valid()) Finish(false);
  }

 private:
  void OnTimer(wxTimerEvent&) {
    if (!m_busy || !m_future.valid() ||
        m_future.wait_for(std::chrono::milliseconds(0)) != std::future_status::ready) {
      return;
    }
    m_timer.Stop();
    Finish(true);
  }

  void Finish(bool showReport) {
    BatchResults results;
    wxString failure;
    try {
      results = m_future.get();
    } catch (const std::exception& error) {
      failure = wxString::FromUTF8(error.what());
    }
    m_busy = false;
    auto callback = std::move(m_completion);
    m_cancelled.reset();
    if (callback) callback(std::move(results), failure, showReport);
  }

  wxTimer m_timer;
  std::future<BatchResults> m_future;
  std::shared_ptr<std::atomic_bool> m_cancelled;
  std::function<void(BatchResults, wxString, bool)> m_completion;
  bool m_busy = false;
};

void ShowSenderHelp(wxWindow* parent) {
    wxFileName helpPath(GetPluginDataDir("signalk_route_sender_pi"),
                        "SignalKRouteSender_Hilfe_DE.txt");
    wxTextFile helpFile;
    if (!helpFile.Open(helpPath.GetFullPath())) {
      wxMessageBox("Die Hilfedatei wurde nicht gefunden:\n" + helpPath.GetFullPath(),
                   "Signal K Route Sender", wxOK | wxICON_ERROR, parent);
      return;
    }

    wxString helpText;
    for (std::size_t i = 0; i < helpFile.GetLineCount(); ++i) {
      if (i != 0) helpText += "\n";
      helpText += helpFile.GetLine(i);
    }
    helpFile.Close();

    wxDialog helpDialog(parent, wxID_ANY, "Signal K Route Sender – Hilfe",
                        wxDefaultPosition, wxSize(700, 560),
                        wxDEFAULT_DIALOG_STYLE | wxRESIZE_BORDER);
    auto* sizer = new wxBoxSizer(wxVERTICAL);
    auto* text = new wxTextCtrl(&helpDialog, wxID_ANY, helpText,
                                wxDefaultPosition, wxDefaultSize,
                                wxTE_MULTILINE | wxTE_READONLY | wxTE_DONTWRAP);
    sizer->Add(text, 1, wxALL | wxEXPAND, 10);
    sizer->Add(helpDialog.CreateButtonSizer(wxOK), 0,
               wxLEFT | wxRIGHT | wxBOTTOM | wxALIGN_RIGHT, 10);
    helpDialog.SetSizerAndFit(sizer);
    helpDialog.SetMinSize(wxSize(600, 420));
    helpDialog.ShowModal();
  }

}  // namespace

class SignalKRouteSender final : public opencpn_plugin_121 {
 public:
  explicit SignalKRouteSender(void* manager) : opencpn_plugin_121(manager) {}

  int Init() override {
    m_config = GetOCPNConfigObject();
    const CURLcode curlStatus = curl_global_init(CURL_GLOBAL_DEFAULT);
    if (curlStatus != CURLE_OK) {
      wxLogError("Signal K Route Sender: HTTP library initialization failed: %s",
                 curl_easy_strerror(curlStatus));
      m_startupWarning += (m_startupWarning.IsEmpty() ? "" : "\n\n");
      m_startupWarning += "Die HTTP-Bibliothek konnte nicht initialisiert werden. "
                          "Der Versand ist bis zur Behebung deaktiviert.";
    } else {
      m_curlInitialized = true;
    }

    m_menuItem = std::make_unique<wxMenuItem>(nullptr, wxID_ANY, "Route an Signal K senden");
    m_menuId = AddCanvasContextMenuItemExt(m_menuItem.get(), this, "Route");
    if (m_menuId < 0) {
      m_menuItem.reset();
      wxLogError("Signal K Route Sender: OpenCPN konnte den Routen-Menüpunkt nicht registrieren.");
      m_startupWarning += (m_startupWarning.IsEmpty() ? "" : "\n\n");
      m_startupWarning += "OpenCPN konnte den Routen-Menüpunkt nicht registrieren. "
                          "Die Einstellungen bleiben verfügbar.";
    }
    auto icon = CreateSignalKIcon(32);
    m_toolbarId = InsertPlugInTool("Signal K Route Sender", &icon, &icon, wxITEM_NORMAL,
                                  "Routen an Signal K senden", "", nullptr, -1, 0, this);
    m_transfer = std::make_unique<TransferMonitor>();
    return WANTS_PREFERENCES |
           (m_menuId >= 0 ? INSTALLS_CONTEXTMENU_ITEMS : 0) |
           (m_toolbarId >= 0 ? INSTALLS_TOOLBAR_TOOL | WANTS_TOOLBAR_CALLBACK : 0);
  }

  bool DeInit() override {
    if (m_transfer) {
      m_transfer->StopAndWait();
      m_transfer.reset();
    }
    if (m_menuId >= 0) {
      RemoveCanvasContextMenuItem(m_menuId);
      m_menuId = -1;
    }
    m_menuItem.reset();
    if (m_toolbarId >= 0) {
      RemovePlugInTool(m_toolbarId);
      m_toolbarId = -1;
    }
    if (m_curlInitialized) {
      curl_global_cleanup();
      m_curlInitialized = false;
    }
    return true;
  }

  int GetAPIVersionMajor() override { return 1; }
  int GetAPIVersionMinor() override { return 21; }
  int GetPlugInVersionMajor() override { return kVersionMajor; }
  int GetPlugInVersionMinor() override { return kVersionMinor; }
  int GetPlugInVersionPatch() override { return kVersionPatch; }
  int GetToolbarToolCount() override { return 1; }
  wxString GetCommonName() override { return "Signal K Route Sender"; }
  wxString GetShortDescription() override { return "Send complete OpenCPN routes to Signal K"; }
  wxString GetLongDescription() override {
    return "Transfers all waypoints of a selected OpenCPN route to a configured Signal K server as a route resource.";
  }

  wxBitmap* GetPlugInBitmap() override {
    if (!m_pluginBitmap.IsOk()) m_pluginBitmap = CreateSignalKIcon(48);
    return &m_pluginBitmap;
  }

  void ShowPreferencesDialog(wxWindow* parent) override {
    if (!m_startupWarning.IsEmpty())
      wxMessageBox(m_startupWarning, "Signal K", wxOK | wxICON_WARNING, parent);
    ShowSenderHelp(parent);
  }

  void OnToolbarToolCallback(int id) override {
    if (id == m_toolbarId) OpenSendDialog({});
  }

  void OnContextMenuItemCallbackExt(int id, std::string objIdent,
                                    std::string objType, double, double) override {
    if (id == m_menuId && objType == "Route") OpenSendDialog(wxString::FromUTF8(objIdent.c_str()));
  }

 private:
  bool FindConnection(SignalKConnection& selected, wxString& reason) const {
    if (!m_config) {
      reason = "Die OpenCPN-Konfiguration ist nicht verfügbar.";
      return false;
    }
    const auto serialized = m_config->Read("/Settings/NMEADataSource/DataConnections", wxEmptyString);
    bool configured = false;
    bool enabled = false;
    bool incomplete = false;
    std::size_t validCount = 0;
    std::size_t defaultPortCount = 0;
    for (const auto& record : wxSplit(serialized, '|', '\0')) {
      // OpenCPN 5.14 ConnectionParams::Serialize: NETWORK=1, SIGNALK=3.
      const auto fields = wxSplit(record, ';', '\0');
      if (fields.size() < 2 || fields[0] != "1" || fields[1] != "3") continue;
      configured = true;
      if (fields.size() < 18) {
        incomplete = true;
        continue;
      }
      if (fields[17] != "1") continue;
      enabled = true;
      auto host = fields[2].Strip(wxString::both);
      if (host.StartsWith("[") && host.EndsWith("]")) host = host.Mid(1, host.size() - 2);
      unsigned long port = 0;
      if (host.IsEmpty() ||
          host.find_first_not_of("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-_:") != wxString::npos ||
          !fields[3].ToULong(&port) || port == 0 || port > 65535) continue;
      auto token = fields.size() > 23 ? fields[23].Strip(wxString::both) : wxString();
      if (token.find_first_of("\r\n") != wxString::npos) continue;
      const auto portText = wxString::Format("%lu", port);
      auto label = (host.Contains(":") ? "[" + host + "]" : host) + ":" + portText;
      if (fields.size() > 18 && !fields[18].IsEmpty()) label = fields[18] + " (" + label + ")";
      if (token.IsEmpty()) label += " [ohne Auth Token]";
      ++validCount;
      if (port == 3000) ++defaultPortCount;
      if (validCount == 1 || port == 3000) selected = {label, host, portText, token};
    }
    if (validCount == 1 || defaultPortCount == 1) return true;
    if (!configured) reason = "Es ist keine Signal-K-Verbindung eingerichtet.";
    else if (!enabled && !incomplete) reason = "Alle Signal-K-Verbindungen sind deaktiviert.";
    else if (!validCount) reason = "Die gespeicherten Signal-K-Verbindungsdaten sind ungültig oder unvollständig.";
    else reason = "Mehrere aktivierte Signal-K-Verbindungen kommen als Ziel infrage. "
                  "Aktiviere nur die gewünschte Verbindung oder verwende Port 3000 eindeutig.";
    return false;
  }

  PendingRoute PrepareRoute(const SignalKConnection& connection, const wxString& guid) {
    PendingRoute pending;
    pending.guid = guid;
    const auto route = GetRouteExV2_Plugin(guid);
    pending.name = route && !route->m_NameString.IsEmpty() ? route->m_NameString : "(Unbenannte Route)";
    if (!route || !route->pWaypointList) {
      pending.error = "Route konnte nicht gelesen werden.";
    } else if (BuildRouteResource(*route, &pending.payload, &pending.error)) {
      pending.existingId = Utf8(LoadConnectionResourceId(connection, guid));
    }
    return pending;
  }

  void OpenSendDialog(const wxString& clickedRoute) {
    auto* parent = GetOCPNCanvasWindow();
    if (!m_curlInitialized || !m_transfer || m_transfer->IsBusy()) {
      wxMessageBox(!m_curlInitialized ? "Der HTTP-Versand ist nicht verfügbar."
                                       : "Eine Routenübertragung läuft bereits.",
                   "Signal K", wxOK | wxICON_WARNING, parent);
      return;
    }
    SignalKConnection connection;
    wxString reason;
    if (!FindConnection(connection, reason)) {
      wxMessageBox(reason + "\n\nEinstellungen: OpenCPN > Optionen > Verbindungen.",
                   "Signal K", wxOK | wxICON_WARNING, parent);
      return;
    }
    if (!clickedRoute.IsEmpty()) {
      SendRoutes(connection, {PrepareRoute(connection, clickedRoute)});
      return;
    }

    wxArrayString routeNames;
    wxArrayString routeIds;
    for (const auto& guid : GetRouteGUIDArray()) {
      const auto route = GetRouteExV2_Plugin(guid);
      if (!route || !route->pWaypointList || route->pWaypointList->GetCount() < 2) continue;
      const wxString name = route->m_NameString.IsEmpty() ? "(Unbenannte Route)" : route->m_NameString;
      routeNames.Add(wxString::Format("%s (%zu Wegpunkte)", name, route->pWaypointList->GetCount()));
      routeIds.Add(guid);
    }
    if (routeIds.IsEmpty()) {
      wxMessageBox("In OpenCPN sind keine Routen mit mindestens zwei Wegpunkten vorhanden.",
                   "Signal K", wxOK | wxICON_INFORMATION, parent);
      return;
    }

    wxDialog dialog(parent, wxID_ANY, "Routen an Signal K senden", wxDefaultPosition,
                    wxDefaultSize, wxDEFAULT_DIALOG_STYLE | wxRESIZE_BORDER);
    auto* layout = new wxBoxSizer(wxVERTICAL);
    layout->Add(new wxStaticText(&dialog, wxID_ANY,
                                 "Automatisch gewähltes Ziel: " + connection.name),
                0, wxALL | wxEXPAND, 12);
    layout->Add(new wxStaticText(&dialog, wxID_ANY, "Zu sendende Routen"), 0, wxLEFT | wxRIGHT, 12);
    auto* list = new wxCheckListBox(&dialog, wxID_ANY, wxDefaultPosition, wxSize(440, 230), routeNames);
    layout->Add(list, 1, wxALL | wxEXPAND, 12);
    auto* buttons = dialog.CreateStdDialogButtonSizer(wxOK | wxCANCEL);
    auto* send = static_cast<wxButton*>(dialog.FindWindow(wxID_OK));
    send->SetLabel("Senden");
    send->Disable();
    list->Bind(wxEVT_CHECKLISTBOX, [list, send](wxCommandEvent&) {
      wxArrayInt checked;
      send->Enable(list->GetCheckedItems(checked) != 0);
    });
    layout->Add(buttons, 0, wxLEFT | wxRIGHT | wxBOTTOM | wxEXPAND, 12);
    dialog.SetSizerAndFit(layout);
    dialog.SetMinSize(dialog.GetSize());
    dialog.CentreOnParent();
    if (dialog.ShowModal() != wxID_OK) return;

    wxArrayInt checked;
    list->GetCheckedItems(checked);
    if (checked.IsEmpty()) return;
    std::vector<PendingRoute> routes;
    for (int index : checked) {
      routes.push_back(PrepareRoute(connection, routeIds[index]));
    }
    SendRoutes(connection, std::move(routes));
  }

  void SendRoutes(const SignalKConnection& connection, std::vector<PendingRoute> routes) {
    const auto batch = std::make_shared<const std::vector<PendingRoute>>(std::move(routes));
    const auto url = BuildRouteUrl(connection);
    const auto token = Utf8(connection.token);
    const auto storageId = ConnectionStorageId(connection);
    const auto name = connection.name;
    wxString startError;
    const bool started = m_transfer->Start(
        [batch, url, token](const std::shared_ptr<std::atomic_bool>& cancelled) {
          BatchResults results;
          results.reserve(batch->size());
          for (const auto& route : *batch) {
            if (cancelled->load()) break;
            if (route.error.IsEmpty()) {
              results.push_back(RequestSignalK(url, token, route.payload, route.existingId, cancelled));
            } else {
              TransferResult result;
              result.message = route.error;
              results.push_back(std::move(result));
            }
          }
          return results;
        },
        [this, batch, storageId, name](BatchResults results, wxString failure, bool showReport) {
          std::size_t sent = 0;
          wxString details;
          for (std::size_t index = 0; index < batch->size(); ++index) {
            const auto& route = (*batch)[index];
            details += "\n" + route.name + " – ";
            if (index >= results.size()) {
              details += "kein Ergebnis";
              continue;
            }
            const auto& result = results[index];
            if (!result.success) {
              details += result.message;
              continue;
            }
            ++sent;
            details += "übertragen";
            const auto resourceId = result.created ? result.resourceId
                                                   : wxString::FromUTF8(route.existingId.c_str());
            if (!SaveResourceId(storageId, route.guid, resourceId)) {
              details += " (Signal-K-ID konnte nicht lokal gespeichert werden)";
              wxLogWarning("Signal K Route Sender: Signal-K-ID konnte nicht lokal gespeichert werden.");
            }
          }
          if (!showReport) {
            if (!failure.IsEmpty()) wxLogWarning("Signal K Route Sender: %s", failure);
            return;
          }
          wxString message = "Automatisch gewähltes Ziel: " + name + "\n";
          message += wxString::Format("%zu von %zu Routen übertragen.\n", sent, batch->size());
          if (!failure.IsEmpty()) message += "\n" + failure;
          wxDialog summary(GetOCPNCanvasWindow(), wxID_ANY, "Signal-K-Übertragung",
                           wxDefaultPosition, wxSize(540, 370),
                           wxDEFAULT_DIALOG_STYLE | wxRESIZE_BORDER);
          auto* layout = new wxBoxSizer(wxVERTICAL);
          auto* report = new wxTextCtrl(&summary, wxID_ANY, message + details,
                                        wxDefaultPosition, wxDefaultSize,
                                        wxTE_MULTILINE | wxTE_READONLY);
          layout->Add(report, 1, wxALL | wxEXPAND, 10);
          layout->Add(summary.CreateButtonSizer(wxOK), 0, wxALL | wxEXPAND, 10);
          summary.SetSizer(layout);
          summary.CentreOnParent();
          summary.ShowModal();
        }, &startError);
    if (!started) {
      wxMessageBox("Die Übertragung konnte nicht gestartet werden.\n" + startError,
                   "Signal K", wxOK | wxICON_WARNING, GetOCPNCanvasWindow());
    }
  }

  wxString ConnectionStorageId(const SignalKConnection& connection) const {
    return "connection-" + connection.host.Lower() + "-" + connection.port;
  }

  wxString LoadConnectionResourceId(const SignalKConnection& connection, const wxString& guid) {
    const auto stored = LoadResourceId(ConnectionStorageId(connection), guid);
    if (!stored.IsEmpty() || !m_config) return stored;
    const auto legacyIds = m_config->Read(wxString(kConfigPath) + "/ProfileIds", wxEmptyString);
    for (const auto& id : wxSplit(legacyIds, ',')) {
      if (id.IsEmpty()) continue;
      const auto path = wxString(kConfigPath) + "/Profiles/" + id;
      auto host = m_config->Read(path + "/Host", wxEmptyString).Strip(wxString::both);
      if (host.StartsWith("[") && host.EndsWith("]")) host = host.Mid(1, host.size() - 2);
      unsigned long port = 0;
      if (host.CmpNoCase(connection.host) != 0 ||
          !m_config->Read(path + "/Port", wxEmptyString).ToULong(&port) ||
          wxString::Format("%lu", port) != connection.port) continue;
      const auto resourceId = LoadResourceId(id, guid);
      if (!resourceId.IsEmpty()) return resourceId;
    }
    return wxString();
  }

  wxString LoadResourceId(const wxString& profileId, const wxString& routeGuid) {
    if (!m_config) return wxString();
    const wxString previousPath = m_config->GetPath();
    m_config->SetPath(wxString(kConfigPath) + "/Profiles/" + profileId + "/RouteIds");
    wxString resourceId;
    m_config->Read(routeGuid, &resourceId, wxEmptyString);
    m_config->SetPath(previousPath);
    return resourceId;
  }

  bool SaveResourceId(const wxString& profileId, const wxString& routeGuid,
                      const wxString& resourceId) {
    if (!m_config) return false;
    const wxString previousPath = m_config->GetPath();
    m_config->SetPath(wxString(kConfigPath) + "/Profiles/" + profileId + "/RouteIds");
    const bool saved = m_config->Write(routeGuid, resourceId) && m_config->Flush();
    m_config->SetPath(previousPath);
    return saved;
  }

  bool BuildRouteResource(const PlugIn_Route_ExV2& route, std::string* payload,
                          wxString* error) const {
    std::ostringstream coordinates;
    std::ostringstream waypointData;
    coordinates.imbue(std::locale::classic());
    waypointData.imbue(std::locale::classic());
    coordinates << std::fixed << std::setprecision(8);
    waypointData << std::fixed << std::setprecision(8);

    std::size_t count = 0;
    auto* node = route.pWaypointList->GetFirst();
    while (node) {
      const PlugIn_Waypoint_ExV2* waypoint = node->GetData();
      node = node->GetNext();
      if (!waypoint) continue;
      if (!std::isfinite(waypoint->m_lat) || !std::isfinite(waypoint->m_lon) ||
          waypoint->m_lat < -90.0 || waypoint->m_lat > 90.0 ||
          waypoint->m_lon < -180.0 || waypoint->m_lon > 180.0) {
        *error = wxString::Format("Wegpunkt %zu hat ungültige Koordinaten.", count + 1);
        return false;
      }
      if (count > 0) {
        coordinates << ',';
        waypointData << ',';
      }
      coordinates << '[' << waypoint->m_lon << ',' << waypoint->m_lat << ']';
      waypointData << "{\"name\":" << JsonEscape(waypoint->m_MarkName)
                   << ",\"guid\":" << JsonEscape(waypoint->m_GUID)
                   << ",\"latitude\":" << JsonNumber(waypoint->m_lat)
                   << ",\"longitude\":" << JsonNumber(waypoint->m_lon);
      if (std::isfinite(waypoint->m_PlannedSpeed) && waypoint->m_PlannedSpeed > 0.0) {
        waypointData << ",\"plannedSpeedKnots\":" << JsonNumber(waypoint->m_PlannedSpeed);
      }
      waypointData << '}';
      ++count;
    }
    if (count < 2) {
      *error = "Eine Signal-K-Route benötigt mindestens zwei gültige Wegpunkte.";
      return false;
    }

    *payload = "{\"name\":" + JsonEscape(route.m_NameString) +
               ",\"description\":" + JsonEscape(route.m_Description) +
               ",\"feature\":{\"type\":\"Feature\",\"geometry\":{\"type\":\"LineString\",\"coordinates\":[" +
               coordinates.str() +"]},\"properties\":{\"opencpnRouteGuid\":" +
               JsonEscape(route.m_GUID) + ",\"waypoints\":[" + waypointData.str() + "]}}}";
    return true;
  }

  std::string BuildRouteUrl(const SignalKConnection& connection) const {
    std::string host = Utf8(connection.host);
    if (host.find(':') != std::string::npos && (host.empty() || host.front() != '[')) {
      host = "[" + host + "]";
    }
    return "http://" + host + ":" + Utf8(connection.port) + kRouteEndpoint;
  }

  wxFileConfig* m_config = nullptr;
  wxString m_startupWarning;
  int m_toolbarId = -1;
  std::unique_ptr<TransferMonitor> m_transfer;
  std::unique_ptr<wxMenuItem> m_menuItem;
  int m_menuId = -1;
  bool m_curlInitialized = false;
  wxBitmap m_pluginBitmap;
};

extern "C" DECL_EXP opencpn_plugin* create_pi(void* manager) {
  return new SignalKRouteSender(manager);
}

extern "C" DECL_EXP void destroy_pi(opencpn_plugin* plugin) {
  delete plugin;
}


