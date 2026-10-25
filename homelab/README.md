# Carte Suménium sur le homelab

La carte 3D de l'Overworld (±10 000 blocs) tourne sur le PC maison et s'affiche sur le site GitHub.
Les joueurs n'installent rien : ils ouvrent le site, la carte est dedans.

## Ce qui est protégé

- **Aucun port ouvert sur la box.** Le seul accès depuis Internet passe par le tunnel Cloudflare déjà en place. Les visiteurs ne voient que les adresses de Cloudflare, jamais l'IP de la maison.
- **Le serveur web ne voit que la carte.** Il est en lecture seule, n'accepte que GET/HEAD, ne liste pas les dossiers et limite le nombre de requêtes par visiteur. Il n'écoute que sur `127.0.0.1` (ni le réseau local ni Internet ne peuvent le joindre directement).
- **Seul le site Suménium peut intégrer la carte** (en-tête `frame-ancestors`).
- **Conteneurs sans privilèges** : utilisateur non root, système de fichiers en lecture seule, aucune capacité Linux.
- **Rien du Nether ni de l'End n'est copié.** Le conteneur ne télécharge que les régions de l'Overworld, `level.dat` et la bordure. Aucun fichier de joueur.
- Le mot de passe SFTP reste dans `.env`, lisible uniquement par toi (`chmod 600`).

## Installation

Sur le homelab, dans le dossier de ton choix :

```bash
git clone https://github.com/DeedG/Sumenium.git
cd Sumenium/homelab
cp .env.example .env && chmod 600 .env
nano .env                          # remplir SFTP_HOST, SFTP_PORT, SFTP_USER, SFTP_PASSWORD
mkdir -p data/web && sudo chown -R 1000:1000 data
docker compose up -d --build
docker compose logs -f carte       # suivre la copie puis le rendu (Ctrl+C pour quitter)
```

Le premier passage copie environ 1 600 régions (une quinzaine de Go) puis dessine toute la carte : compte **1 à 2 jours** en tâche de fond. La carte se remplit au fur et à mesure. Ensuite, chaque passage (toutes les heures) ne copie et ne redessine que ce qui a changé.

Pour que le premier rendu gêne moins Jellyfin, baisse `RENDER_THREADS` et `CARTE_CPUS` dans `.env` (par exemple 6), puis `docker compose up -d`.

## Brancher le tunnel Cloudflare

Dans Cloudflare : **Zero Trust → Networks → Tunnels →** ton tunnel **→ Public hostnames → Add a public hostname** :

- Subdomain : `carte`, Domain : `sumenium.com`
- Service : **HTTP**, URL :
  - `localhost:8100` si `cloudflared` est installé directement sur le PC ;
  - `sumenium-carte-web:8080` si `cloudflared` tourne dans Docker. Dans ce cas, relie-le au réseau de la carte une fois : `docker network connect carte <nom du conteneur cloudflared>`.

Puis, conseillé :

1. **Cache** : *Caching → Cache Rules → Create rule*, si *Hostname* égal à `carte.sumenium.com` → *Eligible for cache*, *Edge TTL* 15 minutes. Cloudflare sert alors presque toutes les tuiles sans solliciter ta connexion.
2. **Limite de requêtes** (facultatif) : *Security → WAF → Rate limiting rules*, sur `carte.sumenium.com`, par exemple 600 requêtes par 10 secondes et par IP.

Vérifie ensuite que `https://carte.sumenium.com` affiche la carte. Le site GitHub l'intègre automatiquement.

## Réglages (`.env`)

| Variable | Rôle |
|---|---|
| `MAP_CENTER_X`, `MAP_CENTER_Z`, `MAP_RADIUS` | Zone dessinée : `auto` (défaut) suit la bordure du monde, 10 000 minimum ; un nombre = carré fixe de ±`MAP_RADIUS` autour du centre. Seules les régions explorées sont copiées et rendues |
| `INTERVAL_MINUTES` | Fréquence des mises à jour (60 par défaut) |
| `RENDER_THREADS`, `CARTE_CPUS`, `JAVA_XMX` | Ressources accordées au rendu |
| `FOG_COLOR` | Couleur de la zone masquée hors bordure |

Après une modification : `docker compose up -d`.

## Anti-spoil

La bordure est tracée en jaune et mise à jour à chaque passage. Tout ce qui est au-delà est recouvert par un calque « Masquer hors bordure ». Sur le site, la case **« Voir toute la carte (spoil) »** l'enlève ; dans la carte en plein écran, c'est dans le menu des marqueurs. Ce calque évite de se spoiler sans le vouloir, il ne protège pas un joueur qui veut vraiment voir.

## Compatibilité Minecraft 26.3

La dernière version publiée de BlueMap (5.23) ne gère pas le format de la 26.3. Sa version en développement oui : l'image la compile depuis le code source (commit fixé par `BLUEMAP_COMMIT` dans `carte/Dockerfile`). La première construction prend quelques minutes. Quand une version officielle compatible sortira, on pourra revenir à un simple téléchargement.

## Sauvegarde de la base du site

Le service `sauvegarde` copie chaque semaine (lundi 4 h par défaut) toute la base du site (fiches, factions, usines, projets, candidatures, votes, historique) dans `homelab/sauvegardes/sumenium-AAAA-MM-JJ.json.gz`, et garde les 12 dernières. Ce dossier contient des données personnelles : il reste sur le NAS (fichiers lisibles par toi seul), jamais dans Git.

1. Choisis un jeton : `openssl rand -hex 32`.
2. Mets-le dans les secrets GitHub du dépôt sous le nom `BACKUP_TOKEN`, puis relance « Déployer l'Espace » (onglet Actions).
3. Mets le même dans `.env` : `BACKUP_TOKEN=…` (et `PUID`/`PGID` = résultat de la commande `id`).
4. `mkdir -p sauvegardes && docker compose up -d sauvegarde`, puis `docker compose logs sauvegarde` : la première sauvegarde part tout de suite.

Sauvegarde immédiate : `docker compose run --rm sauvegarde python /app/sauvegarde.py --once`.

Restaurer (sur une base D1 vide) : `python3 sauvegarde/restaurer.py sauvegardes/sumenium-AAAA-MM-JJ.json.gz > restauration.sql`, puis depuis `worker/` : `npx wrangler d1 execute sumenium --remote --file ../homelab/restauration.sql`.

## Commandes utiles

```bash
docker compose logs --tail 50 carte      # derniers messages
docker compose restart carte             # relancer un passage maintenant
docker compose down                      # tout arrêter
git pull && docker compose up -d --build # mettre à jour
```
