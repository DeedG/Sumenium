// Chargé dans la carte BlueMap : permet au site Suménium d'afficher ou masquer
// la zone hors bordure (marqueur "brouillard") depuis son propre bouton.
(function () {
  var ALLOWED = (window.SUMENIUM_ALLOWED_ORIGINS || ["https://deedg.github.io", "https://sumenium.alheon.fr", "https://sumenium.com", "https://www.sumenium.com"]);
  var wanted = null;

  function find(set, id) {
    if (!set || !set.markerSets) return null;
    var found = null;
    set.markerSets.forEach(function (s, key) {
      if (found) return;
      if (key === id) found = s; else found = find(s, id);
    });
    return found;
  }

  function apply() {
    if (wanted === null) return;
    var bm = window.bluemap;
    var fog = bm && bm.mapViewer && find(bm.mapViewer.markers, "brouillard");
    if (fog) fog.visible = !wanted;
  }

  window.addEventListener("message", function (e) {
    if (ALLOWED.indexOf(e.origin) === -1) return;
    var d = e.data || {};
    if (d.type === "sumenium-spoil") { wanted = !!d.show; apply(); }
  });

  // Les marqueurs sont rechargés régulièrement : on réapplique le choix.
  setInterval(apply, 1500);
})();
