// Commandes réservées au staff (mod Sumenium Economy 2.0.0) : servies seulement aux comptes Discord staff.
export const COMMANDES_STAFF = {
  intro: "Réservées aux opérateurs. Sans /sumeco bypass, un admin utilise les boutiques comme un joueur.",
  sections: [
    { titre: "FISC", intro: "Regarder le coffre ou le tonneau du FISC.", lignes: [
      ["/fisc rachat <prix unitaire>", "Le coffre devient un point de rachat de l'item en main (ex. /fisc rachat 70 avec un minerai de diamant)"],
      ["/fisc vente <prix> <quantité>", "Le FISC vend l'item en main, stock infini (ex. hopper filtre à 1500)"],
      ["/fisc prix <prix>", "Change le prix d'une boutique du FISC"],
      ["/fisc cacher", "En regardant le coffre : la boutique (du FISC ou d'un joueur) disparaît de l'annuaire, du site et de la carte, mais reste utilisable par qui la trouve. Ex. shop d'items cheat : /fisc vente <prix> <quantité> puis /fisc cacher. Le panneau affiche toujours « FISC » : le casser en /sumeco bypass, la boutique marche sans"],
      ["/fisc montrer", "Rend de nouveau visible une boutique cachée"],
    ] },
    { titre: "Argent", lignes: [
      ["/eco voir <joueur>", "Solde d'un joueur et de sa faction"],
      ["/eco donner <joueur> <montant>", "Ajoute de l'argent"],
      ["/eco retirer <joueur> <montant>", "Retire de l'argent"],
      ["/eco definir <joueur> <montant>", "Fixe le solde"],
      ["/eco faction <faction> donner|retirer|definir <montant>", "Pareil pour une banque de faction"],
    ] },
    { titre: "Factions", lignes: [
      ["/faction admin creer <id> <tag> <couleur>", "Crée une faction"],
      ["/faction admin supprimer <faction>", "Supprime une faction (la banque va au chef)"],
      ["/faction admin ajouter <joueur> <faction>", "Ajoute un joueur (le premier devient chef)"],
      ["/faction admin retirer <joueur>", "Retire un joueur de sa faction"],
      ["/faction admin role <joueur> <membre|tresorier|chef>", "Change un rôle dans n'importe quelle faction"],
      ["/faction admin tag <faction> <tag>", "Change le tag affiché"],
      ["/faction admin couleur <faction> <couleur>", "Change la couleur"],
      ["/faction admin importer-equipes", "Crée les factions depuis les équipes vanilla (ignore BACAP et AFK)"],
    ] },
    { titre: "Outils", lignes: [
      ["/sumeco bypass", "Mode gestion : ouvrir, casser et gérer toutes les boutiques. Retaper pour l'arrêter (s'arrête aussi au redémarrage)"],
      ["/sumeco surnom <joueur> <surnom>", "Donne un surnom affiché dans le chat et le tab, le pseudo réel ne change pas (espaces acceptés, 32 caractères max). Ex. /sumeco surnom Bidule42 DeedG (2e compte)"],
      ["/sumeco surnom <joueur> retirer", "Enlève le surnom"],
      ["/sumeco surnom", "Liste des joueurs qui ont un surnom"],
      ["/sumeco stats", "Argent en circulation, nombre de boutiques et factions"],
      ["/sumeco exporter", "Sauvegarde et réécrit tout de suite les fichiers pour le site"],
      ["/sumeco recharger", "Recharge config/sumenium-economy.json"],
      ["/sumeco importer-savs [soldes|boutiques|forcer]", "Reprise des données de Savs (une seule fois, sauf forcer)"],
    ] },
    { titre: "Hôtel des ventes et annuaire", lignes: [
      ["/hdv pnj", "Place le PNJ de l'hôtel des ventes à ta position (immobile, invulnérable, tourné vers toi)"],
      ["/hdv pnj retirer", "Retire le PNJ le plus proche (6 blocs)"],
      ["/hdv boite", "Le coffre ou tonneau visé devient une boîte aux lettres"],
      ["/hdv boite retirer", "Retire la boîte aux lettres visée"],
      ["/hdv annuler <n°>", "Avec /sumeco bypass, retire n'importe quelle annonce sans offre"],
      ["/annuaire lutrin", "Le lutrin visé affiche l'annuaire des boutiques"],
      ["/annuaire retirer", "Le lutrin visé n'affiche plus l'annuaire"],
    ], note: "Le PNJ, la boîte aux lettres et le lutrin ne se cassent qu'avec /sumeco bypass. Pour le site : sumenium-data/export/hdv.json (annonces) et bluemap-markers.json (boutiques, FISC et hôtel des ventes au format BlueMap)." },
  ],
};
