import { apiGet } from "./api-client";
import { bindModalEvents, openModal } from "./modal";

async function loadInsights() {
  var body = document.getElementById("insightsBody");
  var err = document.getElementById("insightsError");
  if (!body || !err) return;
  err.textContent = "";

  try {
    var data = await apiGet("/api/insights");
    var items = data.items || data;
    body.innerHTML = "";
    items.forEach(function (x: any) {
      var tr = document.createElement("tr");
      var tables = (x.affected_tables || []).join(", ");
      tr.innerHTML = "<td>" + (x.root_cause_summary || x.root_cause_category || "") + "</td><td>" + tables + "</td><td>" + (x.created_at || "") + "</td><td><button type='button'>Xem</button></td>";
      (tr.querySelector("button") as HTMLButtonElement).addEventListener("click", function () {
        openModal("Insight Detail", "<pre>" + JSON.stringify(x, null, 2) + "</pre>");
      });
      body.appendChild(tr);
    });
  } catch (_e) {
    err.textContent = "Khong tai duoc insights.";
  }
}

(document.getElementById("reloadInsights") as HTMLButtonElement).addEventListener("click", loadInsights);
bindModalEvents();
loadInsights();
