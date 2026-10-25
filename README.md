# Suménium · Bordure du monde

Site qui affiche, presque en temps réel, la taille de la bordure du serveur Suménium et les succès BACAP qui peuvent encore l'agrandir : combien de blocs chacun rapporte, qui est le plus avancé dessus, et les étapes à faire.

Toutes les 10 minutes, GitHub Actions lit le serveur en SFTP, calcule les données et republie le site sur GitHub Pages. Le serveur n'est jamais modifié : le script ne fait que lire des fichiers.

## Mise en route (une seule fois)

1. **Secrets** : dans *Settings → Secrets and variables → Actions → New repository secret*, ajouter :

   | Nom | Valeur |
   |---|---|
   | `SFTP_HOST` | l'adresse SFTP indiquée dans le panel MineStrator |
   | `SFTP_PORT` | le port SFTP (souvent `2022` ou `22`) |
   | `SFTP_USER` | l'identifiant SFTP |
   | `SFTP_PASSWORD` | le mot de passe SFTP |
   | `SFTP_ROOT` | *(facultatif)* le dossier du serveur, si `server.properties` n'est pas à la racine du SFTP |

2. **Pages** : dans *Settings → Pages*, choisir *Source : GitHub Actions*.
3. **Premier lancement** : onglet *Actions → Mise à jour du site → Run workflow*. Le site est ensuite à l'adresse `https://sumenium.com/` (l'ancienne adresse `deedg.github.io/Sumenium` y renvoie).

## Navigation du site

| Onglet | Contenu |
|---|---|
| Accueil (`#accueil`, logo et nom) | Statut du serveur (MOTD, joueurs en ligne), chiffres clés, « en ce moment », raccourcis |
| Monde | `#monde/carte`, `#monde/succes` (bordure et succès), `#monde/projets` |
| Communauté | `#communaute/joueurs`, `factions`, `usines`, `elections`, fiches `#communaute/joueur/<pseudo>` et `#communaute/faction/<id>` |
| Marché | `#marche/boutiques`, `hdv`, `fisc`, `economie` |
| Classements | `#classements/tableau`, `richesse`, `stats` |
| Aide | `#aide/rejoindre`, `#aide/commandes`, page Confidentialité |
| Mon espace (bouton en haut à droite) | `#espace/fiche`, `historique`, `staff` |

Tout se lit sans connexion ; voter, remplir sa fiche ou modifier sa faction demande la connexion Discord. Les anciens liens (`#classement`, `#economie/boutiques`, `#espace/factions`…) renvoient au bon endroit. Le statut du serveur vient de `/api/status` (le Worker interroge le serveur Minecraft comme la liste des serveurs du jeu, `MC_HOST`/`MC_PORT` dans `worker/wrangler.toml`, 30 s de cache).

## Ce que le script lit sur le serveur

- `server.properties` : nom du monde
- `<monde>/data/minecraft/scoreboard.dat` : succès déjà comptés par le WB-Addon, valeurs en blocs, mode de récompense, équipes
- `<monde>/data/bacap_wb_addon/command_storage.dat` : taille du monde et multiplicateur
- `<monde>/players/advancements/*.json` et `usercache.json` : progression et pseudos des joueurs

Minecraft n'écrit ces fichiers sur le disque qu'à la sauvegarde automatique (toutes les 5 minutes), d'où un décalage de 5 à 15 minutes avec le jeu.

## Classements

Le même passage écrit `site/stats.json` (script `scripts/stats.py`) :

- **Classement** : les trois compteurs du Tab en jeu (`bac_advancements`, `bac_advfirst`, `Morts`) et leur total par faction ;
- **Statistiques** : toutes les statistiques Minecraft (`<monde>/players/stats/`) avec un classement par statistique, plus les causes de mort du mod Player Stats (`stats/player_data/`) ;
- **Économie** : baltop, magasins et échanges de Savs Common Economy (`config/savs-common-economy/` et `logs/economy.log`).

## Carte du monde

La carte 3D est hébergée sur le homelab et intégrée au site : voir [homelab/README.md](homelab/README.md). Son adresse est réglée dans `site/index.html` (`MAP_URL`).

## Espace joueurs (sumenium.com)

Remplace le Google Sheet de la saison : fiches RP, factions, projets, usines, élections et tailles RP (les prix du FISC sont dans l'onglet Économie, lus sur le serveur). Connexion avec Discord ; les droits viennent des rôles du serveur Discord :

| Rôle | Droits |
|---|---|
| Staff, Admins | tout modifier, outils staff, historique avec annulation, import |
| En attente de vérification | lecture seule (même s'il a déjà Suménien) |
| Suménien | sa fiche, sa candidature, son vote ; sa faction (infos, usines, coordonnées) |
| aucun de ces rôles | refusé |

Fonctionnement :

- `worker/` : un Worker Cloudflare sert le site (copie de GitHub Pages) et l'API `/api/*`, avec une base D1. Déployé par `.github/workflows/deploy-worker.yml` à chaque modification de `worker/`.
- Un joueur relie son compte Discord à **un** pseudo de la whitelist. La mise à jour toutes les 10 minutes envoie `whitelist.json` à l'Espace.
- Les coordonnées ne sont visibles que par la faction concernée et le staff ; la taille IRL seulement par le joueur et le staff ; les votes sont secrets (le staff voit les totaux).
- Chaque modification est inscrite dans l'historique (onglet Staff) et peut être annulée. Une suppression est toujours annulable.

Mise en route :

1. Application Discord « Sumenium 2 » → *OAuth2* → *Redirects* : ajouter `https://sumenium.com/api/auth/callback`.
2. Dans GitHub, *Settings → Secrets and variables → Actions* :
   - secret `DISCORD_CLIENT_SECRET` (Discord → *OAuth2* → *Client Secret*) ;
   - secret `CLOUDFLARE_ACCOUNT_ID` (Cloudflare → page d'accueil du compte → *Account ID*) ;
   - secret `CLOUDFLARE_API_TOKEN` : jeton personnalisé avec *Account › Workers Scripts : Edit*, *Account › D1 : Edit*, *Account › Account Settings : Read*, *Zone (sumenium.com) › Workers Routes : Edit*, *Zone › DNS : Edit*, *Zone › Zone : Read* ;
   - onglet *Variables* : `DISCORD_GUILD_ID` (clic droit sur le serveur Discord → *Copier l'identifiant du serveur*, mode développeur activé).
3. *Actions → Déployer l'Espace → Run workflow*. La base, le domaine et le Worker sont créés automatiquement.
4. Import du Google Sheet : télécharger le sheet en `.xlsx`, puis `python tools/import_sheet.py Saison.xlsx import.json`, et envoyer `import.json` depuis l'onglet *Staff → Importer*. Ce fichier contient des données personnelles : ne pas le commiter.

## Mise à jour fiable toutes les 10 minutes

Le cron de GitHub Actions est souvent retardé de plusieurs heures (limite de GitHub, pas une panne). Le Worker Cloudflare lance donc lui-même la mise à jour toutes les 10 minutes. Il lui faut un jeton GitHub :

1. GitHub → *Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate*.
2. *Repository access* : seulement `DeedG/Sumenium`. *Permissions → Repository → Actions : Read and write*. Expiration : 1 an.
3. Copier le jeton dans un secret du dépôt nommé `GH_DISPATCH_TOKEN`, puis relancer *Déployer l'Espace*.

## Économie (mod Sumenium Economy)

Toutes les 5 minutes, la mise à jour lit `sumenium-data/` à la racine du serveur (jamais `sumenium-data/data/`, réservé au mod) :

- `export/*.json` et `masse-monetaire.jsonl` → `site/eco.json` (public) : onglet **Économie** (aperçu, boutiques, hôtel des ventes, FISC, factions, baltop). Montants en Su.
- `journal/AAAA-MM-JJ.jsonl` → envoyé au Worker (base D1, table `tx`), **jamais publié** : onglet *Espace → Mon historique*, et historique de n'importe quel joueur dans *Outils staff*. Montants en **centimes** dans le journal (÷ 100 à l'affichage). Gardé 180 jours.
- Un fichier absent ou vide affiche « données indisponibles » à l'endroit concerné.
- Cache : les fichiers de données sont toujours revalidés, le reste du site est gardé au plus 5 minutes.
- Carte : le conteneur `carte` du homelab fusionne `export/bluemap-markers.json` dans les marqueurs de la carte toutes les 5 minutes (`MARKERS_MINUTES`), en ne remplaçant que les ensembles `sumenium-*`.

## Bon à savoir

- Si le SFTP ne répond pas, le site garde les dernières données et affiche un bandeau d'avertissement.
- GitHub met en pause les tâches planifiées d'un dépôt public sans activité pendant 60 jours. Si le site ne se met plus à jour, relancer le workflow depuis l'onglet *Actions*.
- Le catalogue des succès (`site/catalog.json`) est tiré des datapacks BACAP 1.21.1, BACAP Enhanced Discoveries 2.9.4 et WB-Addon. Après une mise à jour d'un de ces datapacks, le regénérer avec `tools/build_catalog.py`, puis `tools/build_tech.py` (détection technique de chaque succès, `site/tech.json`).
