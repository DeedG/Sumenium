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
3. **Premier lancement** : onglet *Actions → Mise à jour du site → Run workflow*. Le site est ensuite à l'adresse `https://deedg.github.io/Sumenium/`.

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

## Espace joueurs (sumenium.alheon.fr)

Remplace le Google Sheet de la saison : fiches RP, factions, usines, élections, prix du FISC et tailles RP. Connexion avec Discord ; les droits viennent des rôles du serveur Discord :

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

1. Application Discord « Sumenium 2 » → *OAuth2* → *Redirects* : ajouter `https://sumenium.alheon.fr/api/auth/callback`.
2. Dans GitHub, *Settings → Secrets and variables → Actions* :
   - secret `DISCORD_CLIENT_SECRET` (Discord → *OAuth2* → *Client Secret*) ;
   - secret `CLOUDFLARE_ACCOUNT_ID` (Cloudflare → page d'accueil du compte → *Account ID*) ;
   - secret `CLOUDFLARE_API_TOKEN` : jeton personnalisé avec *Account › Workers Scripts : Edit*, *Account › D1 : Edit*, *Account › Account Settings : Read*, *Zone (alheon.fr) › Workers Routes : Edit*, *Zone › DNS : Edit*, *Zone › Zone : Read* ;
   - onglet *Variables* : `DISCORD_GUILD_ID` (clic droit sur le serveur Discord → *Copier l'identifiant du serveur*, mode développeur activé).
3. *Actions → Déployer l'Espace → Run workflow*. La base, le domaine et le Worker sont créés automatiquement.
4. Import du Google Sheet : télécharger le sheet en `.xlsx`, puis `python tools/import_sheet.py Saison.xlsx import.json`, et envoyer `import.json` depuis l'onglet *Staff → Importer*. Ce fichier contient des données personnelles : ne pas le commiter.

## Bon à savoir

- Si le SFTP ne répond pas, le site garde les dernières données et affiche un bandeau d'avertissement.
- GitHub met en pause les tâches planifiées d'un dépôt public sans activité pendant 60 jours. Si le site ne se met plus à jour, relancer le workflow depuis l'onglet *Actions*.
- Le catalogue des succès (`site/catalog.json`) est tiré des datapacks BACAP 1.21.1, BACAP Enhanced Discoveries 2.9.4 et WB-Addon. Après une mise à jour d'un de ces datapacks, le regénérer avec `tools/build_catalog.py`.
