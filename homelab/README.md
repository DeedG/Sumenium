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

- Subdomain : `carte`, Domain : `alheon.fr`
- Service : **HTTP**, URL :
  - `localhost:8100` si `cloudflared` est installé directement sur le PC ;
  - `sumenium-carte-web:8080` si `cloudflared` tourne dans Docker. Dans ce cas, relie-le au réseau de la carte une fois : `docker network connect carte <nom du conteneur cloudflared>`.

Puis, conseillé :

1. **Cache** : *Caching → Cache Rules → Create rule*, si *Hostname* égal à `carte.alheon.fr` → *Eligible for cache*, *Edge TTL* 15 minutes. Cloudflare sert alors presque toutes les tuiles sans solliciter ta connexion.
2. **Limite de requêtes** (facultatif) : *Security → WAF → Rate limiting rules*, sur `carte.alheon.fr`, par exemple 600 requêtes par 10 secondes et par IP.

Vérifie ensuite que `https://carte.alheon.fr` affiche la carte. Le site GitHub l'intègre automatiquement.

## Réglages (`.env`)

| Variable | Rôle |
|---|---|
| `MAP_CENTER_X`, `MAP_CENTER_Z`, `MAP_RADIUS` | Zone dessinée : carré de ±`MAP_RADIUS` autour du centre (10 000 par défaut, comme la prégénération) |
| `INTERVAL_MINUTES` | Fréquence des mises à jour (60 par défaut) |
| `RENDER_THREADS`, `CARTE_CPUS`, `JAVA_XMX` | Ressources accordées au rendu |
| `FOG_COLOR` | Couleur de la zone masquée hors bordure |

Après une modification : `docker compose up -d`.

## Anti-spoil

La bordure est tracée en jaune et mise à jour à chaque passage. Tout ce qui est au-delà est recouvert par un calque « Masquer hors bordure ». Sur le site, la case **« Voir toute la carte (spoil) »** l'enlève ; dans la carte en plein écran, c'est dans le menu des marqueurs. Ce calque évite de se spoiler sans le vouloir, il ne protège pas un joueur qui veut vraiment voir.

## Compatibilité Minecraft 26.3

BlueMap 5.23 ne sait pas lire le nouveau format des chunks de la 26.3 (palette de blocs écrite en chaînes ou en `{id, properties}`). L'image corrige ce point au moment de la construction : `carte/patches/` contient la classe corrigée, compilée puis injectée dans le jar officiel. Quand BlueMap publiera une version compatible, il suffira de changer `BLUEMAP_VERSION` dans `carte/Dockerfile` et de supprimer le dossier `patches/`.

## Commandes utiles

```bash
docker compose logs --tail 50 carte      # derniers messages
docker compose restart carte             # relancer un passage maintenant
docker compose down                      # tout arrêter
git pull && docker compose up -d --build # mettre à jour
```
